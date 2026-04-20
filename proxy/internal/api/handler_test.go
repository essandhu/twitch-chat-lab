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
	"time"

	"github.com/gin-gonic/gin"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
	"github.com/erick/twitch-chat-lab/proxy/internal/upstream"
)

// fakeConn is a noop aggregator.Conn used by handler tests so we don't open
// real WebSockets. It implements the interface's three methods with
// predictable, instantly-returning behaviour.
type fakeConn struct {
	id     string
	closed chan struct{}
	once   sync.Once
}

func newFakeConn(id string) *fakeConn {
	return &fakeConn{id: id, closed: make(chan struct{})}
}

func (f *fakeConn) SessionID() string { return f.id }
func (f *fakeConn) Run(ctx context.Context) error {
	select {
	case <-ctx.Done():
	case <-f.closed:
	}
	return nil
}
func (f *fakeConn) Close() error {
	f.once.Do(func() { close(f.closed) })
	return nil
}

// stubHelix builds an httptest.Server that answers /oauth2/validate and
// /users with canned payloads. Each invocation gets a fresh server so tests
// can't cross-contaminate the Validate cache — the cache is keyed on the
// SHA-256 of the access token, so using distinct tokens per test gives us
// independent cache entries.
func stubHelix(t *testing.T, validateStatus int, validateBody string, usersStatus int, usersBody string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/validate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(validateStatus)
		_, _ = w.Write([]byte(validateBody))
	})
	mux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(usersStatus)
		_, _ = w.Write([]byte(usersBody))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func buildRouterWithSession(t *testing.T, validateURL, helixURL string, openConn func(ctx context.Context, params eventsub.OpenParams) (aggregator.Conn, error)) (*gin.Engine, *aggregator.Registry, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	log := slog.New(h).With("service", "proxy")
	cfg := &config.Config{ClientID: "client-test", Port: "0"}
	r := api.BuildRouter(cfg, log)
	reg := aggregator.NewRegistry()
	t.Cleanup(reg.CloseAll)

	deps := api.SessionHandlerDeps{
		Registry:     reg,
		Logger:       log,
		Config:       cfg,
		HTTPClient:   http.DefaultClient,
		HelixBaseURL: helixURL,
		ValidateURL:  validateURL,
		OpenConn:     openConn,
	}
	api.RegisterSessionRoutes(r, deps)
	return r, reg, &buf
}

func TestPostSession_Returns400OnMissingFields(t *testing.T) {
	r, _, _ := buildRouterWithSession(t, "", "", nil)
	for _, tc := range []struct {
		name string
		body string
	}{
		{"empty", `{}`},
		{"no-channels", `{"channels":[],"user_id":"u","access_token":"t"}`},
		{"too-many-channels", `{"channels":["a","b","c","d"],"user_id":"u","access_token":"t"}`},
		{"missing-user", `{"channels":["a"],"access_token":"t"}`},
		{"missing-token", `{"channels":["a"],"user_id":"u"}`},
		{"not-json", `not json`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d body=%s", rr.Code, rr.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("body not JSON: %v", err)
			}
			if body["error"] != "bad_request" {
				t.Fatalf("expected error=bad_request, got %v", body)
			}
		})
	}
}

func TestPostSession_Returns401OnInvalidToken(t *testing.T) {
	helix := stubHelix(t, http.StatusUnauthorized, `{"status":401,"message":"invalid"}`, http.StatusOK, `{"data":[]}`)

	r, _, _ := buildRouterWithSession(t, helix.URL+"/oauth2/validate", helix.URL, nil)

	body := `{"channels":["alice"],"user_id":"u-1","access_token":"bad-token-1"}`
	req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if parsed["error"] != "invalid_token" {
		t.Fatalf("expected error=invalid_token, got %v", parsed)
	}
}

func TestPostSession_Returns401OnUserIDMismatch(t *testing.T) {
	helix := stubHelix(t,
		http.StatusOK, `{"user_id":"actual-user","login":"actual","expires_in":3600}`,
		http.StatusOK, `{"data":[{"id":"b-1","login":"alice"}]}`,
	)

	r, _, _ := buildRouterWithSession(t, helix.URL+"/oauth2/validate", helix.URL, nil)

	body := `{"channels":["alice"],"user_id":"wrong-user","access_token":"mismatch-token-1"}`
	req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if parsed["error"] != "user_id_mismatch" {
		t.Fatalf("expected error=user_id_mismatch, got %v", parsed)
	}
}

func TestPostSession_Returns404WhenChannelMissing(t *testing.T) {
	helix := stubHelix(t,
		http.StatusOK, `{"user_id":"u-1","login":"u","expires_in":3600}`,
		http.StatusOK, `{"data":[{"id":"b-1","login":"alice"}]}`, // requested bob but missing
	)

	r, _, _ := buildRouterWithSession(t, helix.URL+"/oauth2/validate", helix.URL, nil)

	body := `{"channels":["alice","bob"],"user_id":"u-1","access_token":"channel-missing-1"}`
	req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", rr.Code, rr.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if parsed["error"] != "channel_not_found" {
		t.Fatalf("expected error=channel_not_found, got %v", parsed)
	}
	if parsed["channel"] != "bob" {
		t.Fatalf("expected channel=bob, got %v", parsed)
	}
}

func TestDeleteSession_Returns204OnKnownID(t *testing.T) {
	r, reg, _ := buildRouterWithSession(t, "", "", nil)

	// Seed a session so DELETE has something to remove.
	sess := aggregator.NewSession(context.Background(), "sess-1", "u", []string{"alice"}, nil)
	sess.Start()
	reg.Add(sess)

	req := httptest.NewRequest(http.MethodDelete, "/session/sess-1", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}
	if _, ok := reg.Get("sess-1"); ok {
		t.Fatalf("session still present after DELETE")
	}
}

// TestDeleteSession_ReleasesIdlePools verifies Fix 2: DELETE /session
// calls ReleaseIdlePool for each of the session's StreamLogins so the
// proxy doesn't leave old pools draining while the client tries to open
// replacements on the same per-user WS transport quota.
func TestDeleteSession_ReleasesIdlePools(t *testing.T) {
	_, reg, _ := buildRouterWithSession(t, "", "", nil)

	sess := aggregator.NewSession(context.Background(), "sess-release", "user-42",
		[]string{"alice", "bob"}, nil)
	sess.Start()
	reg.Add(sess)

	var releaseMu sync.Mutex
	var releases []struct {
		login  string
		userID string
	}
	deps := api.SessionHandlerDeps{
		Registry:    reg,
		HelixBaseURL: "",
		ValidateURL:  "",
		ReleaseIdlePool: func(streamLogin, userID string) {
			releaseMu.Lock()
			releases = append(releases, struct {
				login  string
				userID string
			}{streamLogin, userID})
			releaseMu.Unlock()
		},
	}
	// Fresh engine with our observed deps so we can assert the release
	// call-through without leaking state into the other tests.
	engine := gin.New()
	api.RegisterSessionRoutes(engine, deps)

	req := httptest.NewRequest(http.MethodDelete, "/session/sess-release", nil)
	rr := httptest.NewRecorder()
	engine.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d body=%s", rr.Code, rr.Body.String())
	}

	releaseMu.Lock()
	defer releaseMu.Unlock()
	if len(releases) != 2 {
		t.Fatalf("expected 2 ReleaseIdlePool calls, got %d: %v", len(releases), releases)
	}
	gotLogins := map[string]bool{}
	for _, rel := range releases {
		if rel.userID != "user-42" {
			t.Fatalf("expected userID=user-42, got %q", rel.userID)
		}
		gotLogins[rel.login] = true
	}
	if !gotLogins["alice"] || !gotLogins["bob"] {
		t.Fatalf("expected releases for alice+bob, got %v", gotLogins)
	}
}

// TestPostSession_CompressesDrainOnPartialFailure verifies that when
// POST /session fails mid-loop (e.g. Twitch 429s the 3rd subscribe),
// teardown calls CompressDrain with a short grace for the
// already-attached channels. Without this, their Twitch WS transport
// slots would stay held for 30s and the user's immediate retry would
// hit the per-user transport cap and cascade into 429/502 storms.
// Strict ReleaseIdlePool is the wrong tool here — we want to keep the
// pool warm for a ~2s retry, not tear it down immediately.
func TestPostSession_CompressesDrainOnPartialFailure(t *testing.T) {
	helix := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/validate":
			_, _ = w.Write([]byte(`{"user_id":"u-42","login":"u","expires_in":3600}`))
		case "/users":
			logins := r.URL.Query()["login"]
			out := make([]map[string]string, 0, len(logins))
			for _, l := range logins {
				out = append(out, map[string]string{"id": "bcast-" + l, "login": l, "display_name": l})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": out})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(helix.Close)

	log := slog.New(slog.NewJSONHandler(bytes.NewBuffer(nil), &slog.HandlerOptions{Level: slog.LevelError}))
	cfg := &config.Config{ClientID: "client-test", Port: "0"}
	reg := aggregator.NewRegistry()
	t.Cleanup(reg.CloseAll)

	var subscribeCount atomic.Int32
	var compressMu sync.Mutex
	type compressCall struct {
		login, userID string
		grace         time.Duration
	}
	var compressCalls []compressCall
	var releaseMu sync.Mutex
	var releaseCalls []string // logins — the failure path must NOT call release

	subscribe := func(ctx context.Context, p upstream.SubscribeParams) (aggregator.Conn, error) {
		subscribeCount.Add(1)
		if p.StreamLogin == "carol" {
			// Mirror the real failure mode: Twitch rejected the subscribe,
			// Hub.Subscribe surfaces it up through this seam.
			return nil, errors.New("upstream: websocket transports limit exceeded")
		}
		return newFakeConn("conn-" + p.StreamLogin), nil
	}
	compress := func(streamLogin, userID string, grace time.Duration) {
		compressMu.Lock()
		defer compressMu.Unlock()
		compressCalls = append(compressCalls, compressCall{streamLogin, userID, grace})
	}
	release := func(streamLogin, userID string) {
		releaseMu.Lock()
		defer releaseMu.Unlock()
		releaseCalls = append(releaseCalls, streamLogin)
	}

	engine := gin.New()
	api.RegisterSessionRoutes(engine, api.SessionHandlerDeps{
		Registry:        reg,
		Logger:          log,
		Config:          cfg,
		HTTPClient:      http.DefaultClient,
		HelixBaseURL:    helix.URL,
		ValidateURL:     helix.URL + "/oauth2/validate",
		OrphanTimeout:   5 * time.Second, // well past test runtime
		Subscribe:       subscribe,
		CompressDrain:   compress,
		ReleaseIdlePool: release,
	})

	body := `{"channels":["alice","bob","carol"],"user_id":"u-42","access_token":"partial-fail-tok-1"}`
	req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	engine.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d body=%s", rr.Code, rr.Body.String())
	}
	if subscribeCount.Load() != 3 {
		t.Fatalf("expected 3 Subscribe calls (alice, bob, carol), got %d", subscribeCount.Load())
	}

	compressMu.Lock()
	defer compressMu.Unlock()
	compressed := map[string]time.Duration{}
	for _, c := range compressCalls {
		if c.userID != "u-42" {
			t.Fatalf("expected userID=u-42, got %q", c.userID)
		}
		compressed[c.login] = c.grace
	}
	// alice + bob were attached before carol failed — both must be
	// compressed. carol never attached so it should NOT appear.
	if _, ok := compressed["alice"]; !ok {
		t.Fatalf("expected CompressDrain for alice, got %v", compressCalls)
	}
	if _, ok := compressed["bob"]; !ok {
		t.Fatalf("expected CompressDrain for bob, got %v", compressCalls)
	}
	if _, ok := compressed["carol"]; ok {
		t.Fatalf("carol never attached; should not be in CompressDrain calls: %v", compressCalls)
	}
	if len(compressCalls) != 2 {
		t.Fatalf("expected exactly 2 CompressDrain calls, got %d: %v", len(compressCalls), compressCalls)
	}
	// Grace window must be short enough to beat a single-stream reconnect
	// to Twitch's transport cap. We hardcode 2s to catch accidental
	// regressions to a longer value; if we intentionally tune this, the
	// test should be updated in the same commit.
	for login, grace := range compressed {
		if grace != 2*time.Second {
			t.Fatalf("expected 2s grace for %s, got %v", login, grace)
		}
	}

	// The strict release path must NOT have fired on this failure — we
	// want warm pools for immediate retries, not immediate teardown.
	releaseMu.Lock()
	defer releaseMu.Unlock()
	if len(releaseCalls) != 0 {
		t.Fatalf("POST teardown should not call ReleaseIdlePool; got %v", releaseCalls)
	}
}

func TestDeleteSession_Returns404OnUnknownID(t *testing.T) {
	r, _, _ := buildRouterWithSession(t, "", "", nil)

	req := httptest.NewRequest(http.MethodDelete, "/session/nope", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["error"] != "session_not_found" {
		t.Fatalf("expected error=session_not_found, got %v", body)
	}
}

func TestValidate_SurfacesErrInvalidToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"status":401}`))
	}))
	defer srv.Close()
	_, err := api.Validate(context.Background(), http.DefaultClient, srv.URL, "validate-bad-tok-1")
	if err == nil {
		t.Fatalf("expected error")
	}
	if !errors.Is(err, api.ErrInvalidToken) {
		t.Fatalf("expected ErrInvalidToken, got %v", err)
	}
}

func TestGetBroadcasterIDs_SurfacesErrChannelNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":[{"id":"b1","login":"alice"}]}`)
	}))
	defer srv.Close()
	_, err := api.GetBroadcasterIDs(context.Background(), http.DefaultClient, srv.URL, "client", "tok", []string{"alice", "bob"})
	if err == nil {
		t.Fatalf("expected error")
	}
	if !errors.Is(err, api.ErrChannelNotFound) {
		t.Fatalf("expected ErrChannelNotFound, got %v", err)
	}
}
