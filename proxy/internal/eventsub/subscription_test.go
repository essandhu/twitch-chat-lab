package eventsub_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
)

// fakeHelix is a minimal httptest-based Helix stand-in. For each incoming
// subscription request it responds according to the routing table keyed on
// payload.type. It also records every inbound request so tests can assert
// ordering, body shape and header presence.
type fakeHelix struct {
	mu           sync.Mutex
	reqs         []recordedReq
	routes       map[string]helixRoute // subscription type -> response
	deleteStatus int                    // status for DELETE /eventsub/subscriptions
	deleteIDs    []string
}

type helixRoute struct {
	status int
	body   string
}

type recordedReq struct {
	method string
	path   string
	query  string
	header http.Header
	body   []byte
}

func newFakeHelix(routes map[string]helixRoute) *fakeHelix {
	return &fakeHelix{routes: routes, deleteStatus: http.StatusNoContent}
}

func (f *fakeHelix) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rec := recordedReq{
			method: r.Method,
			path:   r.URL.Path,
			query:  r.URL.RawQuery,
			header: r.Header.Clone(),
			body:   append([]byte(nil), body...),
		}
		f.mu.Lock()
		f.reqs = append(f.reqs, rec)
		f.mu.Unlock()

		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/eventsub/subscriptions":
			var reqBody struct {
				Type string `json:"type"`
			}
			_ = json.Unmarshal(body, &reqBody)
			route, ok := f.routes[reqBody.Type]
			if !ok {
				http.Error(w, "unknown type", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(route.status)
			_, _ = w.Write([]byte(route.body))
		case r.Method == http.MethodDelete && r.URL.Path == "/eventsub/subscriptions":
			id := r.URL.Query().Get("id")
			f.mu.Lock()
			f.deleteIDs = append(f.deleteIDs, id)
			f.mu.Unlock()
			w.WriteHeader(f.deleteStatus)
		default:
			http.NotFound(w, r)
		}
	})
}

func (f *fakeHelix) requests() []recordedReq {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]recordedReq, len(f.reqs))
	copy(out, f.reqs)
	return out
}

func successBody(id string) string {
	return `{"data":[{"id":"` + id + `","status":"enabled"}]}`
}

func newTestLogger() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(h), &buf
}

func TestRegister_Success_MandatoryPlusFiveForbidden(t *testing.T) {
	routes := map[string]helixRoute{
		"channel.chat.message":      {status: http.StatusAccepted, body: successBody("sub-chat")},
		"channel.subscribe":         {status: http.StatusForbidden, body: `{"error":"Forbidden","status":403,"message":"missing scope"}`},
		"channel.subscription.gift": {status: http.StatusForbidden, body: `{"error":"Forbidden","status":403}`},
		"channel.raid":              {status: http.StatusForbidden, body: `{"error":"Forbidden","status":403}`},
		"channel.hype_train.begin":  {status: http.StatusForbidden, body: `{"error":"Forbidden","status":403}`},
		"channel.hype_train.end":    {status: http.StatusForbidden, body: `{"error":"Forbidden","status":403}`},
	}
	fh := newFakeHelix(routes)
	srv := httptest.NewServer(fh.handler())
	defer srv.Close()

	log, _ := newTestLogger()
	res, err := eventsub.Register(context.Background(), eventsub.RegisterArgs{
		HTTPClient:    srv.Client(),
		HelixBaseURL:  srv.URL,
		ClientID:      "client-123",
		AccessToken:   "secret-token-abc",
		SessionID:     "sess-xyz",
		BroadcasterID: "bcast-42",
		UserID:        "user-42",
		StreamLogin:   "loginA",
		Logger:        log,
	})
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if len(res.Registered) != 1 {
		t.Fatalf("expected 1 registered, got %d: %+v", len(res.Registered), res.Registered)
	}
	if res.Registered[0].Type != "channel.chat.message" {
		t.Fatalf("expected channel.chat.message, got %q", res.Registered[0].Type)
	}
	if res.Registered[0].SubscriptionID != "sub-chat" {
		t.Fatalf("expected subscriptionID sub-chat, got %q", res.Registered[0].SubscriptionID)
	}
	if len(res.Skipped) != 5 {
		t.Fatalf("expected 5 skipped, got %d: %+v", len(res.Skipped), res.Skipped)
	}
	// Verify required headers on the first request.
	reqs := fh.requests()
	if len(reqs) != 6 {
		t.Fatalf("expected 6 requests, got %d", len(reqs))
	}
	first := reqs[0]
	if got := first.header.Get("Authorization"); got != "Bearer secret-token-abc" {
		t.Fatalf("expected Authorization=Bearer secret-token-abc, got %q", got)
	}
	if got := first.header.Get("Client-Id"); got != "client-123" {
		t.Fatalf("expected Client-Id=client-123, got %q", got)
	}
	if got := first.header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected Content-Type=application/json, got %q", got)
	}
	// Verify body shape: chat.message uses broadcaster_user_id + user_id.
	var chatReq map[string]any
	if err := json.Unmarshal(first.body, &chatReq); err != nil {
		t.Fatalf("first body not JSON: %v body=%s", err, string(first.body))
	}
	if chatReq["type"] != "channel.chat.message" {
		t.Fatalf("expected type=channel.chat.message, got %v", chatReq["type"])
	}
	if chatReq["version"] != "1" {
		t.Fatalf("expected version=1, got %v", chatReq["version"])
	}
	cond, ok := chatReq["condition"].(map[string]any)
	if !ok {
		t.Fatalf("condition not an object: %v", chatReq["condition"])
	}
	if cond["broadcaster_user_id"] != "bcast-42" {
		t.Fatalf("expected broadcaster_user_id=bcast-42, got %v", cond["broadcaster_user_id"])
	}
	if cond["user_id"] != "user-42" {
		t.Fatalf("expected user_id=user-42, got %v", cond["user_id"])
	}
	tr, ok := chatReq["transport"].(map[string]any)
	if !ok {
		t.Fatalf("transport not an object: %v", chatReq["transport"])
	}
	if tr["method"] != "websocket" || tr["session_id"] != "sess-xyz" {
		t.Fatalf("transport incorrect: %v", tr)
	}
}

func TestRegister_MandatoryForbidden_ReturnsError(t *testing.T) {
	routes := map[string]helixRoute{
		"channel.chat.message":      {status: http.StatusForbidden, body: `{"error":"Forbidden","status":403}`},
		"channel.subscribe":         {status: http.StatusForbidden, body: `{}`},
		"channel.subscription.gift": {status: http.StatusForbidden, body: `{}`},
		"channel.raid":              {status: http.StatusForbidden, body: `{}`},
		"channel.hype_train.begin":  {status: http.StatusForbidden, body: `{}`},
		"channel.hype_train.end":    {status: http.StatusForbidden, body: `{}`},
	}
	fh := newFakeHelix(routes)
	srv := httptest.NewServer(fh.handler())
	defer srv.Close()

	log, _ := newTestLogger()
	_, err := eventsub.Register(context.Background(), eventsub.RegisterArgs{
		HTTPClient:    srv.Client(),
		HelixBaseURL:  srv.URL,
		ClientID:      "client-123",
		AccessToken:   "secret",
		SessionID:     "sess",
		BroadcasterID: "b",
		UserID:        "u",
		StreamLogin:   "login",
		Logger:        log,
	})
	if err == nil {
		t.Fatalf("expected error on mandatory 403, got nil")
	}
}

func TestRegister_BodyScrubbing_TokenNeverLogged(t *testing.T) {
	// Response body contains the token (simulates a misbehaving server that
	// echoes authorization material). Register must scrub it before logging.
	token := "super-secret-token-xyz"
	routes := map[string]helixRoute{
		"channel.chat.message":      {status: http.StatusAccepted, body: successBody("sub-chat")},
		"channel.subscribe":         {status: http.StatusForbidden, body: `{"error":"bad token ` + token + `"}`},
		"channel.subscription.gift": {status: http.StatusForbidden, body: `{"error":"bad token ` + token + `"}`},
		"channel.raid":              {status: http.StatusForbidden, body: `{"error":"bad token ` + token + `"}`},
		"channel.hype_train.begin":  {status: http.StatusForbidden, body: `{"error":"bad token ` + token + `"}`},
		"channel.hype_train.end":    {status: http.StatusForbidden, body: `{"error":"bad token ` + token + `"}`},
	}
	fh := newFakeHelix(routes)
	srv := httptest.NewServer(fh.handler())
	defer srv.Close()

	log, buf := newTestLogger()
	_, err := eventsub.Register(context.Background(), eventsub.RegisterArgs{
		HTTPClient:    srv.Client(),
		HelixBaseURL:  srv.URL,
		ClientID:      "client-123",
		AccessToken:   token,
		SessionID:     "sess",
		BroadcasterID: "b",
		UserID:        "u",
		StreamLogin:   "login",
		Logger:        log,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(buf.String(), token) {
		t.Fatalf("token leaked into logs:\n%s", buf.String())
	}
}

func TestRegister_MandatoryTransportError_ReturnsError(t *testing.T) {
	// Server that returns 500 on the mandatory path — should surface as an
	// error (non-403, non-2xx).
	routes := map[string]helixRoute{
		"channel.chat.message": {status: http.StatusInternalServerError, body: `{"error":"server boom"}`},
	}
	fh := newFakeHelix(routes)
	srv := httptest.NewServer(fh.handler())
	defer srv.Close()

	log, _ := newTestLogger()
	_, err := eventsub.Register(context.Background(), eventsub.RegisterArgs{
		HTTPClient:    srv.Client(),
		HelixBaseURL:  srv.URL,
		ClientID:      "client-123",
		AccessToken:   "tok",
		SessionID:     "sess",
		BroadcasterID: "b",
		UserID:        "u",
		StreamLogin:   "login",
		Logger:        log,
	})
	if err == nil {
		t.Fatal("expected error on mandatory 500, got nil")
	}
}

func TestUnsubscribe_BestEffort_DeletesAll(t *testing.T) {
	fh := newFakeHelix(nil)
	srv := httptest.NewServer(fh.handler())
	defer srv.Close()

	if err := eventsub.Unsubscribe(context.Background(), srv.Client(), srv.URL, "client", "tok", []string{"id-1", "id-2", "id-3"}); err != nil {
		t.Fatalf("unsubscribe returned error: %v", err)
	}
	reqs := fh.requests()
	if len(reqs) != 3 {
		t.Fatalf("expected 3 delete requests, got %d", len(reqs))
	}
	for i, r := range reqs {
		if r.method != http.MethodDelete {
			t.Fatalf("request %d: expected DELETE, got %s", i, r.method)
		}
		if !strings.Contains(r.query, "id=id-") {
			t.Fatalf("request %d: expected id query, got %q", i, r.query)
		}
	}
}

func TestUnsubscribe_IgnoresServerErrors(t *testing.T) {
	fh := newFakeHelix(nil)
	fh.deleteStatus = http.StatusInternalServerError
	srv := httptest.NewServer(fh.handler())
	defer srv.Close()

	log, _ := newTestLogger()
	_ = log
	// Should NOT return an error even when every DELETE fails.
	if err := eventsub.Unsubscribe(context.Background(), srv.Client(), srv.URL, "client", "tok", []string{"id-1"}); err != nil {
		t.Fatalf("unsubscribe surfaced error: %v", err)
	}
}
