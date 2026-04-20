package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
	"github.com/erick/twitch-chat-lab/proxy/internal/upstream"
)

// patchFixture holds everything a PATCH test needs: the router, registry,
// a pre-seeded session, an observed Subscribe + ReleaseIdlePool seam, and
// per-test counters/hooks. Each fixture gets its own helix stub so cached
// token validations don't cross-contaminate.
type patchFixture struct {
	engine          *gin.Engine
	registry        *aggregator.Registry
	session         *aggregator.Session
	helix           *httptest.Server
	subscribeCalls  int32
	releaseCalls    []struct{ login, userID string }
	releaseCallsMu  sync.Mutex
	openedConns     []*fakeConn
	openedConnsMu   sync.Mutex
	subscribeErr    atomic.Value // error — set to force subscribe failures
	subscribeErrFor string       // if non-empty, only the given login errors
}

func (p *patchFixture) currentSubscribeErr() error {
	v := p.subscribeErr.Load()
	if v == nil {
		return nil
	}
	err, _ := v.(error)
	return err
}

// buildPatchFixture wires a gin engine with real PATCH + DELETE handlers,
// a fake Helix that always validates the supplied token and returns
// broadcaster ids for any requested login (so any add succeeds unless
// subscribeErr is set), and a session pre-loaded with startLogins.
func buildPatchFixture(t *testing.T, userID, token string, startLogins []string) *patchFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)

	f := &patchFixture{}

	helixMux := http.NewServeMux()
	helixMux.HandleFunc("/oauth2/validate", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(fmt.Sprintf(`{"user_id":"%s","login":"viewer","expires_in":3600}`, userID)))
	})
	helixMux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
		logins := r.URL.Query()["login"]
		out := make([]map[string]string, 0, len(logins))
		for _, l := range logins {
			out = append(out, map[string]string{"id": "bcast-" + l, "login": l, "display_name": l})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": out})
	})
	f.helix = httptest.NewServer(helixMux)
	t.Cleanup(f.helix.Close)

	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelError}))
	cfg := &config.Config{ClientID: "client-test", Port: "0"}

	f.registry = aggregator.NewRegistry()
	t.Cleanup(f.registry.CloseAll)

	sess := aggregator.NewSession(context.Background(), "sess-patch", userID, startLogins, log)
	// Pre-attach a fakeConn for each start login so DetachConn has something
	// to remove. Start is a no-op for the runners we care about in these
	// handler-level tests — the test fake just returns from Run on Close.
	for _, login := range startLogins {
		c := newFakeConn("conn-" + login)
		sess.AttachConn(login, c)
	}
	sess.Start()
	f.registry.Add(sess)
	f.session = sess

	subscribe := func(ctx context.Context, params upstream.SubscribeParams) (aggregator.Conn, error) {
		atomic.AddInt32(&f.subscribeCalls, 1)
		if err := f.currentSubscribeErr(); err != nil {
			if f.subscribeErrFor == "" || f.subscribeErrFor == params.StreamLogin {
				return nil, err
			}
		}
		c := newFakeConn("conn-" + params.StreamLogin)
		f.openedConnsMu.Lock()
		f.openedConns = append(f.openedConns, c)
		f.openedConnsMu.Unlock()
		return c, nil
	}
	release := func(streamLogin, userID string) {
		f.releaseCallsMu.Lock()
		defer f.releaseCallsMu.Unlock()
		f.releaseCalls = append(f.releaseCalls, struct{ login, userID string }{streamLogin, userID})
	}

	deps := api.SessionHandlerDeps{
		Registry:        f.registry,
		Logger:          log,
		Config:          cfg,
		HTTPClient:      http.DefaultClient,
		HelixBaseURL:    f.helix.URL,
		ValidateURL:     f.helix.URL + "/oauth2/validate",
		Subscribe:       subscribe,
		ReleaseIdlePool: release,
	}
	engine := gin.New()
	api.RegisterSessionRoutes(engine, deps)
	f.engine = engine
	return f
}

func patchSession(t *testing.T, f *patchFixture, id string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/session/"+id, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	f.engine.ServeHTTP(rr, req)
	return rr
}

// Happy path: add + remove, PATCH returns 200 with the final channel list,
// Subscribe is called once per add, ReleaseIdlePool is called once per
// remove.
func TestPatchSession_HappyPath_AddAndRemove(t *testing.T) {
	f := buildPatchFixture(t, "u-1", "tok-patch-1", []string{"alice", "bob"})

	body := `{"add":["carol"],"remove":["alice"],"user_id":"u-1","access_token":"tok-patch-1"}`
	rr := patchSession(t, f, "sess-patch", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var parsed struct {
		SessionID string   `json:"session_id"`
		Channels  []string `json:"channels"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	if parsed.SessionID != "sess-patch" {
		t.Fatalf("expected session_id=sess-patch, got %q", parsed.SessionID)
	}
	gotLogins := map[string]bool{}
	for _, l := range parsed.Channels {
		gotLogins[l] = true
	}
	if gotLogins["alice"] || !gotLogins["bob"] || !gotLogins["carol"] {
		t.Fatalf("unexpected final channels: %v", parsed.Channels)
	}

	if atomic.LoadInt32(&f.subscribeCalls) != 1 {
		t.Fatalf("expected 1 subscribe call, got %d", f.subscribeCalls)
	}
	f.releaseCallsMu.Lock()
	defer f.releaseCallsMu.Unlock()
	if len(f.releaseCalls) != 1 || f.releaseCalls[0].login != "alice" || f.releaseCalls[0].userID != "u-1" {
		t.Fatalf("expected 1 ReleaseIdlePool(alice,u-1), got %v", f.releaseCalls)
	}
}

// Add-only: no ReleaseIdlePool calls fire, Subscribe fires once.
func TestPatchSession_AddOnly(t *testing.T) {
	f := buildPatchFixture(t, "u-1", "tok-patch-2", []string{"alice"})

	body := `{"add":["bob"],"remove":[],"user_id":"u-1","access_token":"tok-patch-2"}`
	rr := patchSession(t, f, "sess-patch", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	if atomic.LoadInt32(&f.subscribeCalls) != 1 {
		t.Fatalf("expected 1 subscribe, got %d", f.subscribeCalls)
	}
	f.releaseCallsMu.Lock()
	defer f.releaseCallsMu.Unlock()
	if len(f.releaseCalls) != 0 {
		t.Fatalf("expected 0 releases, got %d", len(f.releaseCalls))
	}
}

// Remove-only: no Subscribe calls fire, ReleaseIdlePool fires once.
func TestPatchSession_RemoveOnly(t *testing.T) {
	f := buildPatchFixture(t, "u-1", "tok-patch-3", []string{"alice", "bob"})

	body := `{"add":[],"remove":["bob"],"user_id":"u-1","access_token":"tok-patch-3"}`
	rr := patchSession(t, f, "sess-patch", body)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	if atomic.LoadInt32(&f.subscribeCalls) != 0 {
		t.Fatalf("expected 0 subscribes, got %d", f.subscribeCalls)
	}
	f.releaseCallsMu.Lock()
	defer f.releaseCallsMu.Unlock()
	if len(f.releaseCalls) != 1 || f.releaseCalls[0].login != "bob" {
		t.Fatalf("expected 1 ReleaseIdlePool(bob), got %v", f.releaseCalls)
	}
}

func TestPatchSession_Returns404OnUnknownSession(t *testing.T) {
	f := buildPatchFixture(t, "u-1", "tok-patch-4", []string{"alice"})
	body := `{"add":["bob"],"user_id":"u-1","access_token":"tok-patch-4"}`
	rr := patchSession(t, f, "does-not-exist", body)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestPatchSession_BadRequestCases(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"empty-add-and-remove", `{"add":[],"remove":[],"user_id":"u-1","access_token":"tok-bad-1"}`},
		{"overlap-add-remove", `{"add":["alice"],"remove":["alice"],"user_id":"u-1","access_token":"tok-bad-2"}`},
		{"duplicate-in-add", `{"add":["carol","carol"],"user_id":"u-1","access_token":"tok-bad-3"}`},
		{"empty-string-in-add", `{"add":[""],"user_id":"u-1","access_token":"tok-bad-4"}`},
		{"missing-user-id", `{"add":["carol"],"access_token":"tok-bad-5"}`},
		{"missing-token", `{"add":["carol"],"user_id":"u-1"}`},
		{"remove-not-in-session", `{"remove":["zoe"],"user_id":"u-1","access_token":"tok-bad-6"}`},
		{"add-already-in-session", `{"add":["alice"],"user_id":"u-1","access_token":"tok-bad-7"}`},
		{"final-count-exceeds-max", `{"add":["carol","dave"],"user_id":"u-1","access_token":"tok-bad-8"}`},
		{"not-json", `not json`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := buildPatchFixture(t, "u-1", "tok-bad-fixture-"+tc.name, []string{"alice", "bob"})
			rr := patchSession(t, f, "sess-patch", tc.body)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d body=%s", rr.Code, rr.Body.String())
			}
			var parsed map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
				t.Fatalf("body not JSON: %v", err)
			}
			if parsed["error"] != "bad_request" {
				t.Fatalf("expected error=bad_request, got %v", parsed)
			}
		})
	}
}

// UserID in body not matching the session's → 401 (before validating the
// token, so no helix round trip).
func TestPatchSession_Returns401OnUserMismatch(t *testing.T) {
	f := buildPatchFixture(t, "u-owner", "tok-owner-1", []string{"alice"})

	body := `{"add":["bob"],"user_id":"u-other","access_token":"tok-owner-1"}`
	rr := patchSession(t, f, "sess-patch", body)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	// Subscribe must NOT have been attempted before auth.
	if atomic.LoadInt32(&f.subscribeCalls) != 0 {
		t.Fatalf("expected 0 subscribes before auth, got %d", f.subscribeCalls)
	}
}

// Subscribe failure: removes are NOT rolled back (documented behaviour),
// added conns ARE rolled back via DetachConn + ReleaseIdlePool, and the
// response is 502.
func TestPatchSession_SubscribeFailure_RollsBackAdded(t *testing.T) {
	f := buildPatchFixture(t, "u-1", "tok-rb-1", []string{"alice", "bob"})
	f.subscribeErr.Store(errors.New("boom"))
	f.subscribeErrFor = "dave" // let carol succeed, dave fail

	body := `{"add":["carol","dave"],"remove":["alice"],"user_id":"u-1","access_token":"tok-rb-1"}`
	rr := patchSession(t, f, "sess-patch", body)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d body=%s", rr.Code, rr.Body.String())
	}

	// alice's remove stays applied; carol was rolled back; dave never
	// attached. Final channel list should be [bob] only.
	logins := append([]string(nil), f.session.StreamLogins...)
	gotLogins := map[string]bool{}
	for _, l := range logins {
		gotLogins[l] = true
	}
	if gotLogins["alice"] || gotLogins["carol"] || gotLogins["dave"] || !gotLogins["bob"] {
		t.Fatalf("unexpected session state after rollback: %v", logins)
	}

	// ReleaseIdlePool called once for alice (remove) and once for carol
	// (rollback of the successful add).
	f.releaseCallsMu.Lock()
	defer f.releaseCallsMu.Unlock()
	released := map[string]int{}
	for _, rc := range f.releaseCalls {
		released[rc.login]++
	}
	if released["alice"] != 1 || released["carol"] != 1 {
		t.Fatalf("expected releases for alice+carol, got %v", f.releaseCalls)
	}
}

// Sanity: a POST /session → PATCH add → PATCH remove cycle leaves the
// session with exactly the expected channels.
func TestPatchSession_SequentialAddRemove(t *testing.T) {
	f := buildPatchFixture(t, "u-1", "tok-seq-1", []string{"alice"})

	rr := patchSession(t, f, "sess-patch", `{"add":["bob"],"user_id":"u-1","access_token":"tok-seq-1"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("add bob: expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	rr = patchSession(t, f, "sess-patch", `{"remove":["alice"],"user_id":"u-1","access_token":"tok-seq-1"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("remove alice: expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}

	logins := append([]string(nil), f.session.StreamLogins...)
	if len(logins) != 1 || logins[0] != "bob" {
		t.Fatalf("expected StreamLogins=[bob], got %v", logins)
	}
}

// Silence unused imports when future tests grow — these are referenced by
// the fixture builder only.
var _ = eventsub.ErrUpstreamLost
