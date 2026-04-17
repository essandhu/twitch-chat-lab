package api_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
)

func buildWSServer(t *testing.T, cfg *config.Config) (*httptest.Server, *aggregator.Registry) {
	t.Helper()
	log := slog.New(slog.NewJSONHandler(new(nullWriter), &slog.HandlerOptions{Level: slog.LevelWarn}))
	reg := aggregator.NewRegistry()
	t.Cleanup(reg.CloseAll)

	r := api.BuildRouter(cfg, log)
	api.RegisterWebSocketRoute(r, api.WebSocketHandlerDeps{
		Registry: reg,
		Logger:   log,
		Config:   cfg,
	})
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, reg
}

type nullWriter struct{}

func (*nullWriter) Write(p []byte) (int, error) { return len(p), nil }

func wsURL(httpURL, path string) string {
	return strings.Replace(httpURL, "http://", "ws://", 1) + path
}

func TestWS_UnknownSessionReturns404BeforeUpgrade(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{ClientID: "test", Port: "0", AllowedOrigins: []string{"http://allowed"}}
	srv, _ := buildWSServer(t, cfg)

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/ws/nope", nil)
	req.Header.Set("Origin", "http://allowed")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["error"] != "session_not_found" {
		t.Fatalf("expected session_not_found, got %v", body)
	}
}

func TestWS_DoubleConnectReturns409(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{ClientID: "test", Port: "0", AllowedOrigins: []string{"http://allowed"}}
	srv, reg := buildWSServer(t, cfg)

	sess := aggregator.NewSession(context.Background(), "sess-1", "u", []string{"a"}, nil)
	sess.Start()
	reg.Add(sess)

	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	header := http.Header{}
	header.Set("Origin", "http://allowed")

	c1, resp1, err := dialer.Dial(wsURL(srv.URL, "/ws/sess-1"), header)
	if err != nil {
		t.Fatalf("first dial failed: %v, resp=%v", err, resp1)
	}
	defer c1.Close()

	// Second dial must be rejected with 409 BEFORE upgrade.
	_, resp2, err := dialer.Dial(wsURL(srv.URL, "/ws/sess-1"), header)
	if err == nil {
		t.Fatalf("expected second dial to fail")
	}
	if resp2 == nil {
		t.Fatalf("expected HTTP response on rejection, got nil (err=%v)", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409, got %d", resp2.StatusCode)
	}
}

func TestWS_MissingOriginReturns403(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{ClientID: "test", Port: "0", AllowedOrigins: []string{"http://allowed"}}
	srv, reg := buildWSServer(t, cfg)

	sess := aggregator.NewSession(context.Background(), "sess-2", "u", []string{"a"}, nil)
	sess.Start()
	reg.Add(sess)

	// Use bare HTTP client without Origin.
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/ws/sess-2", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("req failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 without Origin, got %d", resp.StatusCode)
	}
}

func TestSession_TryAcquireReleaseWS(t *testing.T) {
	sess := aggregator.NewSession(context.Background(), "s", "u", []string{"a"}, nil)
	sess.Start()
	defer sess.Stop()

	if !sess.TryAcquireWS() {
		t.Fatal("first acquire should succeed")
	}
	if sess.TryAcquireWS() {
		t.Fatal("second acquire should fail")
	}
	sess.ReleaseWS()
	if !sess.TryAcquireWS() {
		t.Fatal("acquire after release should succeed")
	}
}
