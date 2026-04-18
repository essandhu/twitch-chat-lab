package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/upstream"
)

// inertConn is a minimal aggregator.Conn used by the orphan-reaper handler
// test. Run blocks until Close; nothing emits frames.
type inertConn struct {
	closed chan struct{}
}

func newInertConn() *inertConn {
	return &inertConn{closed: make(chan struct{})}
}

func (c *inertConn) SessionID() string { return "inert" }

func (c *inertConn) Run(ctx context.Context) error {
	select {
	case <-ctx.Done():
	case <-c.closed:
	}
	return nil
}

func (c *inertConn) Close() error {
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
	return nil
}

// orphanStubHelix answers /oauth2/validate and /users with canned bodies so
// POST /session can reach the Subscribe seam without dialing real Twitch.
func orphanStubHelix(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2/validate", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"user_id":"u-1","login":"u","expires_in":3600}`))
	})
	mux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"b-1","login":"alice"}]}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// POST /session succeeds, no /ws connection arrives, and after the orphan
// timeout the session is removed from the registry and a session.orphaned
// log line is emitted.
func TestPostSession_OrphanReaperRemovesUnconnectedSession(t *testing.T) {
	helix := orphanStubHelix(t)

	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := &config.Config{ClientID: "client-test", Port: "0"}
	r := api.BuildRouter(cfg, log)
	reg := aggregator.NewRegistry()
	t.Cleanup(reg.CloseAll)

	var subCount atomic.Int32
	api.RegisterSessionRoutes(r, api.SessionHandlerDeps{
		Registry:      reg,
		Logger:        log,
		Config:        cfg,
		HTTPClient:    http.DefaultClient,
		HelixBaseURL:  helix.URL,
		ValidateURL:   helix.URL + "/oauth2/validate",
		OrphanTimeout: 50 * time.Millisecond,
		Subscribe: func(ctx context.Context, p upstream.SubscribeParams) (aggregator.Conn, error) {
			subCount.Add(1)
			return newInertConn(), nil
		},
	})

	body := `{"channels":["alice"],"user_id":"u-1","access_token":"orphan-tok-1"}`
	req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s logs=%s", rr.Code, rr.Body.String(), buf.String())
	}
	var parsed struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	if subCount.Load() != 1 {
		t.Fatalf("expected Subscribe called once, got %d", subCount.Load())
	}

	if _, ok := reg.Get(parsed.SessionID); !ok {
		t.Fatal("session missing from registry immediately after POST")
	}

	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := reg.Get(parsed.SessionID); !ok {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if _, ok := reg.Get(parsed.SessionID); ok {
		t.Fatalf("session %s still present after reap (logs=%s)", parsed.SessionID, buf.String())
	}
	if !strings.Contains(buf.String(), "session.orphaned") {
		t.Fatalf("expected session.orphaned log, got:\n%s", buf.String())
	}
}

// Subscribing via the Subscribe seam also wires the session into the
// registry correctly (sanity: no regression of the happy path).
func TestPostSession_SubscribeSeamReturnsCreated(t *testing.T) {
	helix := orphanStubHelix(t)

	log := slog.New(slog.NewJSONHandler(bytes.NewBuffer(nil), &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := &config.Config{ClientID: "client-test", Port: "0"}
	r := api.BuildRouter(cfg, log)
	reg := aggregator.NewRegistry()
	t.Cleanup(reg.CloseAll)

	api.RegisterSessionRoutes(r, api.SessionHandlerDeps{
		Registry:      reg,
		Logger:        log,
		Config:        cfg,
		HTTPClient:    http.DefaultClient,
		HelixBaseURL:  helix.URL,
		ValidateURL:   helix.URL + "/oauth2/validate",
		OrphanTimeout: 5 * time.Second, // well past test runtime
		Subscribe: func(ctx context.Context, p upstream.SubscribeParams) (aggregator.Conn, error) {
			return newInertConn(), nil
		},
	})

	body := `{"channels":["alice"],"user_id":"u-1","access_token":"happy-tok-1"}`
	req := httptest.NewRequest(http.MethodPost, "/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rr.Code, rr.Body.String())
	}
}
