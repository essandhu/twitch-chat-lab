package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/logger"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	m.Run()
}

func newRouter(t *testing.T, origins []string) (*gin.Engine, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	log := slog.New(h).With("service", "proxy")
	cfg := &config.Config{
		ClientID:       "test-client",
		Port:           "0",
		AllowedOrigins: origins,
	}
	r := api.BuildRouter(cfg, log)
	return r, &buf
}

func TestHealthzReturnsOK(t *testing.T) {
	r, _ := newRouter(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("healthz body not JSON: %v body=%s", err, rr.Body.String())
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body)
	}
}

func TestNotFoundReturnsJSON(t *testing.T) {
	r, _ := newRouter(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/no-such-route", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("404 body not JSON: %v body=%s", err, rr.Body.String())
	}
	if body["error"] != "not_found" {
		t.Fatalf("expected error=not_found, got %v", body)
	}
}

func TestCORSAllowsListedOrigin(t *testing.T) {
	r, _ := newRouter(t, []string{"http://localhost:5173"})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for allowed origin, got %d", rr.Code)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("expected ACAO=http://localhost:5173, got %q", got)
	}
}

func TestCORSRejectsUnlistedOrigin(t *testing.T) {
	r, _ := newRouter(t, []string{"http://localhost:5173"})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://evil.example")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unlisted origin, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCORSAllowsRequestWithoutOrigin(t *testing.T) {
	r, _ := newRouter(t, []string{"http://localhost:5173"})

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 when no Origin header, got %d", rr.Code)
	}
}

func TestCORSPreflightAllowsListedOrigin(t *testing.T) {
	r, _ := newRouter(t, []string{"http://localhost:5173"})

	req := httptest.NewRequest(http.MethodOptions, "/healthz", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "Content-Type,Authorization")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204 preflight, got %d body=%s", rr.Code, rr.Body.String())
	}
	allowMethods := rr.Header().Get("Access-Control-Allow-Methods")
	for _, m := range []string{"GET", "POST", "DELETE"} {
		if !strings.Contains(allowMethods, m) {
			t.Fatalf("expected Allow-Methods to include %s, got %q", m, allowMethods)
		}
	}
	allowHeaders := rr.Header().Get("Access-Control-Allow-Headers")
	for _, h := range []string{"Content-Type", "Authorization", "Upgrade"} {
		if !strings.Contains(allowHeaders, h) {
			t.Fatalf("expected Allow-Headers to include %s, got %q", h, allowHeaders)
		}
	}
}

func TestCorrelationIDStampedOnContext(t *testing.T) {
	// Use a custom engine that exposes a route reading the correlation ID.
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	log := slog.New(h).With("service", "proxy")
	cfg := &config.Config{ClientID: "test", Port: "0"}
	r := api.BuildRouter(cfg, log)

	var captured string
	r.GET("/_probe", func(c *gin.Context) {
		if v, ok := c.Request.Context().Value(logger.CtxKeyCorrelationID).(string); ok {
			captured = v
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/_probe", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if captured == "" {
		t.Fatal("expected correlation ID on request context, got empty string")
	}
	if len(captured) < 8 {
		t.Fatalf("correlation ID looks too short: %q", captured)
	}
}

func TestRequestLoggedAsJSON(t *testing.T) {
	r, buf := newRouter(t, nil)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	var sawStart, sawFinish bool
	for _, line := range lines {
		if line == "" {
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("log line not JSON: %v line=%s", err, line)
		}
		if entry["service"] != "proxy" {
			t.Fatalf("expected service=proxy on every line, got %v", entry["service"])
		}
		if _, ok := entry["correlationId"].(string); !ok {
			t.Fatalf("expected correlationId string on request log, got %v", entry["correlationId"])
		}
		switch entry["msg"] {
		case "request.start":
			sawStart = true
		case "request.finish":
			sawFinish = true
		}
	}
	if !sawStart || !sawFinish {
		t.Fatalf("expected request.start and request.finish log lines, start=%v finish=%v\n%s", sawStart, sawFinish, buf.String())
	}
}

// compile-time sanity that we can use io.Discard to silence unused imports
// when editing the file in isolation.
var _ = io.Discard
var _ context.Context
