// Run with -race in CI (requires CGO).
//
// Task P4-11 end-to-end integration test.
//
// Wires the full gin router (session routes + ws route) to a real
// aggregator.Registry. Backs it with three fake EventSub WS servers (one per
// channel) and a fake Helix HTTP server (token validate + users +
// eventsub/subscriptions). A real gorilla/websocket client dials /ws/{id}
// and reads 1000 envelopes spread across the three channels. Asserts per-
// stream monotonic ordering of seq-N ids, total count, clean teardown on
// DELETE, and no goroutine leak.
package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
)

// TestE2E_ThreeChannelFanIn is the P4-11 end-to-end. It spins up the full
// stack (gin + ws + fake Helix + 3 fake EventSub servers), POSTs /session,
// reads 1000 envelopes from /ws/{id}, asserts ordering + count + teardown.
func TestE2E_ThreeChannelFanIn(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const totalFrames = 1000
	logins := []string{"streamer_a", "streamer_b", "streamer_c"}
	broadcasterIDs := map[string]string{
		"streamer_a": "bcast-a",
		"streamer_b": "bcast-b",
		"streamer_c": "bcast-c",
	}

	baselineGoroutines := runtime.NumGoroutine()

	// Distribute frames across channels (333/333/334) with a per-channel
	// sequence number, so the reader can verify per-channel monotonicity.
	scripts := map[string][][]byte{}
	perChannelCounts := map[string]int{}
	for i := 0; i < totalFrames; i++ {
		login := logins[i%len(logins)]
		idx := perChannelCounts[login]
		scripts[login] = append(scripts[login], buildChatNotification(login, idx))
		perChannelCounts[login] = idx + 1
	}

	// Per-channel fake EventSub WS server.
	type fakeSrv struct {
		url      string
		closed   chan struct{} // signalled when server observes client disconnect
		server   *httptest.Server
		clientOn sync.WaitGroup // tracks in-flight handler invocations
	}
	servers := map[string]*fakeSrv{}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

	for _, login := range logins {
		login := login
		fs := &fakeSrv{closed: make(chan struct{}, 1)}
		script := scripts[login]
		fs.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fs.clientOn.Add(1)
			defer fs.clientOn.Done()

			c, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close()

			// Signal client-close exactly once when the read loop exits.
			defer func() {
				select {
				case fs.closed <- struct{}{}:
				default:
				}
			}()

			// Welcome frame. Session ID embeds the login so log noise is
			// easier to correlate.
			welcome := fmt.Sprintf(`{
				"metadata":{"message_type":"session_welcome","message_timestamp":"2026-04-17T12:00:00Z"},
				"payload":{"session":{"id":"ws-%s","keepalive_timeout_seconds":30,"status":"connected"}}
			}`, login)
			if err := c.WriteMessage(websocket.TextMessage, []byte(welcome)); err != nil {
				return
			}

			// Emit scripted notifications in small batches so the
			// aggregator's non-blocking FrameOut send doesn't overflow the
			// 256-envelope default buffer. Real Twitch paces chat events
			// via natural message cadence; here we pause every 32 frames to
			// give the downstream ws writer (and slow Windows IO) a chance
			// to drain.
			for i, frame := range script {
				if err := c.WriteMessage(websocket.TextMessage, frame); err != nil {
					return
				}
				if (i+1)%32 == 0 {
					time.Sleep(10 * time.Millisecond)
				}
			}

			// Hold the connection open until the client disconnects (DELETE
			// /session or ws close frame triggers this read to fail).
			for {
				if _, _, err := c.ReadMessage(); err != nil {
					return
				}
			}
		}))
		fs.url = "ws" + strings.TrimPrefix(fs.server.URL, "http")
		servers[login] = fs
	}
	defer func() {
		for _, fs := range servers {
			fs.server.Close()
		}
	}()

	// Fake Helix: /oauth2/validate, /users, /eventsub/subscriptions (POST+DELETE).
	helixMux := http.NewServeMux()
	helixMux.HandleFunc("/oauth2/validate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"user_id":"u-1","login":"viewer","expires_in":3600}`))
	})
	helixMux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
		logins := r.URL.Query()["login"]
		out := make([]map[string]string, 0, len(logins))
		for _, l := range logins {
			id, ok := broadcasterIDs[l]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			out = append(out, map[string]string{"id": id, "login": l})
		}
		body := map[string]any{"data": out}
		raw, _ := json.Marshal(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
	})
	helixMux.HandleFunc("/eventsub/subscriptions", func(w http.ResponseWriter, r *http.Request) {
		// Accept every POST (Register), no-op on DELETE (Unsubscribe best
		// effort). The handler's bookkeeping only needs a subscription id.
		switch r.Method {
		case http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"data":[{"id":"sub-xyz","status":"enabled"}]}`))
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	})
	helixSrv := httptest.NewServer(helixMux)
	defer helixSrv.Close()

	// Build the router with a custom OpenConn seam that routes each StreamLogin
	// to its dedicated fake EventSub server.
	var logBuf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	cfg := &config.Config{
		ClientID:       "client-test",
		Port:           "0",
		AllowedOrigins: []string{"http://allowed"},
	}
	reg := aggregator.NewRegistry()
	defer reg.CloseAll()

	openConn := func(ctx context.Context, params eventsub.OpenParams) (aggregator.Conn, error) {
		fs, ok := servers[params.StreamLogin]
		if !ok {
			return nil, fmt.Errorf("no fake server for %s", params.StreamLogin)
		}
		params.URL = fs.url
		return eventsub.Open(ctx, params)
	}

	r := api.BuildRouter(cfg, log)
	api.RegisterSessionRoutes(r, api.SessionHandlerDeps{
		Registry:     reg,
		Logger:       log,
		Config:       cfg,
		HTTPClient:   http.DefaultClient,
		HelixBaseURL: helixSrv.URL,
		ValidateURL:  helixSrv.URL + "/oauth2/validate",
		EventSubURL:  "", // OpenConn overrides per-login.
		OpenConn:     openConn,
	})
	api.RegisterWebSocketRoute(r, api.WebSocketHandlerDeps{
		Registry: reg,
		Logger:   log,
		Config:   cfg,
	})

	appSrv := httptest.NewServer(r)
	defer appSrv.Close()

	// Hard timeout on the whole test.
	overallDeadline := time.Now().Add(10 * time.Second)
	testCtx, testCancel := context.WithDeadline(context.Background(), overallDeadline)
	defer testCancel()

	// POST /session.
	reqBody := fmt.Sprintf(`{"channels":["streamer_a","streamer_b","streamer_c"],"user_id":"u-1","access_token":"tok-%d"}`, time.Now().UnixNano())
	postReq, err := http.NewRequestWithContext(testCtx, http.MethodPost, appSrv.URL+"/session", strings.NewReader(reqBody))
	if err != nil {
		t.Fatalf("build POST: %v", err)
	}
	postReq.Header.Set("Content-Type", "application/json")
	postResp, err := http.DefaultClient.Do(postReq)
	if err != nil {
		t.Fatalf("POST /session: %v", err)
	}
	if postResp.StatusCode != http.StatusCreated {
		body, _ := readAllResp(postResp)
		t.Fatalf("POST /session status=%d body=%s", postResp.StatusCode, body)
	}
	var postBody struct {
		SessionID string `json:"session_id"`
	}
	if err := json.NewDecoder(postResp.Body).Decode(&postBody); err != nil {
		t.Fatalf("decode POST body: %v", err)
	}
	postResp.Body.Close()
	sessionID := postBody.SessionID
	if sessionID == "" {
		t.Fatal("POST /session returned empty session_id")
	}

	// Dial /ws/{id}.
	dialer := websocket.Dialer{HandshakeTimeout: 3 * time.Second}
	wsURL := "ws" + strings.TrimPrefix(appSrv.URL, "http") + "/ws/" + sessionID
	header := http.Header{}
	header.Set("Origin", "http://allowed")
	wsConn, wsResp, err := dialer.DialContext(testCtx, wsURL, header)
	if err != nil {
		var status int
		if wsResp != nil {
			status = wsResp.StatusCode
		}
		t.Fatalf("WS dial failed: %v (status=%d)", err, status)
	}
	defer wsConn.Close()

	// Read envelopes until we have `totalFrames` notifications. Ignore any
	// non-notification envelopes (e.g., upstream_lost sentinels from the
	// fake server if it exits early — shouldn't happen here).
	type envelope struct {
		StreamLogin string          `json:"stream_login"`
		EventType   string          `json:"event_type"`
		Payload     json.RawMessage `json:"payload"`
		Error       string          `json:"error,omitempty"`
	}

	perStreamLastSeq := map[string]int{}
	for k := range perStreamLastSeq {
		perStreamLastSeq[k] = -1
	}
	streamCounts := map[string]int{}
	received := 0

	_ = wsConn.SetReadDeadline(overallDeadline)
	for received < totalFrames {
		_, data, err := wsConn.ReadMessage()
		if err != nil {
			t.Fatalf("ws read failed after %d frames: %v", received, err)
		}
		var env envelope
		if err := json.Unmarshal(data, &env); err != nil {
			t.Fatalf("envelope not JSON: %v body=%s", err, string(data))
		}
		if env.Error == "upstream_lost" {
			t.Fatalf("unexpected upstream_lost envelope: %s", string(data))
		}
		if env.EventType != "channel.chat.message" {
			// The welcome frame is dropped by aggregator; keepalives we don't
			// emit here. Anything else is a test bug.
			t.Fatalf("unexpected event_type=%q body=%s", env.EventType, string(data))
		}
		var inner struct {
			Payload struct {
				Event struct {
					MessageID string `json:"message_id"`
				} `json:"event"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(env.Payload, &inner); err != nil {
			t.Fatalf("decode payload: %v body=%s", err, string(data))
		}
		var seq int
		if _, err := fmt.Sscanf(inner.Payload.Event.MessageID, "seq-%d", &seq); err != nil {
			t.Fatalf("bad message_id %q: %v", inner.Payload.Event.MessageID, err)
		}
		last, seen := perStreamLastSeq[env.StreamLogin]
		if seen && seq <= last {
			t.Fatalf("ordering violation on %s: got seq-%d after seq-%d", env.StreamLogin, seq, last)
		}
		perStreamLastSeq[env.StreamLogin] = seq
		streamCounts[env.StreamLogin]++
		received++
	}

	if received != totalFrames {
		t.Fatalf("received %d frames, want %d", received, totalFrames)
	}
	for login, want := range perChannelCounts {
		if streamCounts[login] != want {
			t.Fatalf("stream %s got %d frames, want %d", login, streamCounts[login], want)
		}
	}

	// Send DELETE /session/{id} and verify every fake EventSub server
	// observes a client-close within 2s. We do this before closing the ws
	// so pumpWebSocket's writer hits the "channel closed" branch.
	delReq, _ := http.NewRequestWithContext(testCtx, http.MethodDelete, appSrv.URL+"/session/"+sessionID, nil)
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil {
		t.Fatalf("DELETE /session failed: %v", err)
	}
	if delResp.StatusCode != http.StatusNoContent {
		body, _ := readAllResp(delResp)
		t.Fatalf("DELETE /session status=%d body=%s", delResp.StatusCode, body)
	}
	delResp.Body.Close()

	// Wait for each fake server's handler to notice the close (with a 2s
	// budget from DELETE).
	for _, login := range logins {
		select {
		case <-servers[login].closed:
		case <-time.After(2 * time.Second):
			t.Fatalf("fake EventSub server for %s did not observe close within 2s", login)
		}
	}

	// Close our ws client too (cleanup) — ignore errors since session is
	// already gone.
	_ = wsConn.Close()

	// Verify no major goroutine leak. httptest keeps a pool alive and slog
	// may retain a worker or two, so we allow a small band above baseline.
	// Reaping isn't perfectly synchronous on Linux CI under -race (observed
	// ~11 stragglers 150ms after DELETE), so poll until we're under the
	// tolerance or a 2s deadline fires.
	tolerance := 5
	if runtime.GOOS == "windows" {
		tolerance = 20
	}
	deadline := time.Now().Add(2 * time.Second)
	final := runtime.NumGoroutine()
	for time.Now().Before(deadline) {
		final = runtime.NumGoroutine()
		if final <= baselineGoroutines+tolerance {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if final > baselineGoroutines+tolerance {
		t.Fatalf("goroutine leak: baseline=%d final=%d (tolerance=%d, goos=%s)",
			baselineGoroutines, final, tolerance, runtime.GOOS)
	}
}

// buildChatNotification returns a minimal channel.chat.message notification
// tagged with the broadcaster_user_login and a per-channel sequence.
func buildChatNotification(streamLogin string, seq int) []byte {
	return []byte(fmt.Sprintf(`{
		"metadata":{"message_type":"notification","message_timestamp":"2026-04-17T12:00:00.000Z"},
		"payload":{
			"subscription":{"type":"channel.chat.message","version":"1","status":"enabled"},
			"event":{
				"message_id":"seq-%d",
				"broadcaster_user_login":%q,
				"message":{"text":"msg-%d","fragments":[]}
			}
		}
	}`, seq, streamLogin, seq))
}

// readAllResp reads and returns the response body as a string.
func readAllResp(resp *http.Response) (string, error) {
	defer resp.Body.Close()
	var sb strings.Builder
	buf := make([]byte, 1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			sb.Write(buf[:n])
		}
		if err != nil {
			break
		}
	}
	return sb.String(), nil
}
