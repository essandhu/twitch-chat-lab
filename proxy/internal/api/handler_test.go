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
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
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
