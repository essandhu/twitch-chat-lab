// Run with -race in CI (requires CGO).
//
// Covers eventsub.Connection (P4-03) end-to-end:
//
//   1. Happy-path session_welcome — Open blocks until welcome, SessionID populated.
//   2. Notification frames are forwarded to OnFrame verbatim.
//   3. session_reconnect swaps the WS before closing the old one (zero-loss).
//   4. Unexpected drops trigger exponential backoff (1s, 2s, 4s) via fake Clock.
//   5. Five consecutive failures → Run returns ErrUpstreamLost; Clock records
//      5 sleeps totalling 1+2+4+8+16 = 31s of simulated time.
package eventsub

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// fakeClock records every Sleep call and returns instantly. Mirrors the
// production Clock interface with no cancellation semantics — sleepCtx slices
// the wait so ctx cancel is still respected at the caller.
type fakeClock struct {
	mu     sync.Mutex
	sleeps []time.Duration
}

func (c *fakeClock) Sleep(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sleeps = append(c.sleeps, d)
}

func (c *fakeClock) total() time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	var total time.Duration
	for _, d := range c.sleeps {
		total += d
	}
	return total
}

func (c *fakeClock) callCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sleeps)
}

// silentSlog returns a logger that drops everything — keeps test output clean.
func silentSlog() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

// captureSlog returns a logger + backing buffer for tests that assert log
// content (e.g., reconnect.attempt entries).
func captureSlog() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(h), &buf
}

// welcomeBytes builds a minimal session_welcome frame.
func welcomeBytes(sessionID string, keepalive int) []byte {
	return []byte(fmt.Sprintf(`{
		"metadata":{"message_type":"session_welcome","message_timestamp":"2026-04-17T12:00:00.000Z"},
		"payload":{"session":{"id":%q,"keepalive_timeout_seconds":%d,"status":"connected"}}
	}`, sessionID, keepalive))
}

// notificationBytes builds a minimal notification frame with a stable
// message_id so tests can match forwarded bytes.
func notificationBytes(messageID string) []byte {
	return []byte(fmt.Sprintf(`{
		"metadata":{"message_type":"notification","message_timestamp":"2026-04-17T12:00:00.000Z"},
		"payload":{"subscription":{"type":"channel.chat.message"},"event":{"message_id":%q}}
	}`, messageID))
}

// reconnectBytes builds a session_reconnect frame pointing at reconnectURL.
func reconnectBytes(sessionID, reconnectURL string) []byte {
	return []byte(fmt.Sprintf(`{
		"metadata":{"message_type":"session_reconnect","message_timestamp":"2026-04-17T12:00:00.000Z"},
		"payload":{"session":{"id":%q,"status":"reconnecting","reconnect_url":%q}}
	}`, sessionID, reconnectURL))
}

// wsURLFromHTTP returns the ws:// URL for an httptest.Server.URL.
func wsURLFromHTTP(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http")
}

// upgrader accepts any origin — httptest servers have no realistic origin.
var testUpgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

// Test 1: Open completes successfully on a server that sends session_welcome.
func TestConnection_OpenHappyPath(t *testing.T) {
	welcome := welcomeBytes("sess-happy", 10)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, welcome)
		// Block until client closes.
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	var framesSeen atomic.Int64
	conn, err := Open(context.Background(), OpenParams{
		URL:         wsURLFromHTTP(srv.URL),
		StreamLogin: "streamer_a",
		OnFrame:     func(raw []byte) { framesSeen.Add(1) },
		Logger:      silentSlog(),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer conn.Close()

	if got := conn.SessionID(); got != "sess-happy" {
		t.Fatalf("SessionID = %q, want sess-happy", got)
	}
	// Open forwards the welcome frame to OnFrame as well.
	if framesSeen.Load() != 1 {
		t.Fatalf("expected 1 frame delivered (welcome), got %d", framesSeen.Load())
	}
}

// Test 2: Notification frames sent by the fake server are forwarded to
// OnFrame byte-for-byte.
func TestConnection_NotificationForwardedToOnFrame(t *testing.T) {
	welcome := welcomeBytes("sess-notif", 10)
	notif := notificationBytes("msg-abc")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, welcome)
		_ = c.WriteMessage(websocket.TextMessage, notif)
		// Hold the connection open until the test closes it.
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer srv.Close()

	var mu sync.Mutex
	var captured [][]byte
	onFrame := func(raw []byte) {
		cp := append([]byte(nil), raw...)
		mu.Lock()
		captured = append(captured, cp)
		mu.Unlock()
	}

	conn, err := Open(context.Background(), OpenParams{
		URL:         wsURLFromHTTP(srv.URL),
		StreamLogin: "streamer_a",
		OnFrame:     onFrame,
		Logger:      silentSlog(),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	runDone := make(chan error, 1)
	go func() { runDone <- conn.Run(context.Background()) }()

	// Wait until the notification arrives.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(captured)
		mu.Unlock()
		if n >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	mu.Lock()
	if len(captured) < 2 {
		mu.Unlock()
		t.Fatalf("expected welcome + notification, got %d frames", len(captured))
	}
	got := captured[1]
	mu.Unlock()

	if !bytes.Equal(got, notif) {
		t.Fatalf("notification not forwarded verbatim:\n got: %s\nwant: %s", string(got), string(notif))
	}

	// Close() unblocks the read loop immediately (closes the underlying
	// socket) so Run returns without waiting for the ReadDeadline.
	_ = conn.Close()
	select {
	case <-runDone:
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not exit within 3s after Close")
	}
}

// Test 3: session_reconnect — server A instructs the client to reconnect to
// server B. Verifies that (a) OnFrame continues receiving frames from B after
// the swap, and (b) server B observed a handshake BEFORE server A observed
// the old socket close (zero-loss contract).
func TestConnection_SessionReconnectSwapsBeforeClose(t *testing.T) {
	// Use a mutex-guarded slice with a monotonic sequence counter instead of
	// time.Now — Windows time resolution is too coarse to distinguish events
	// that happen within the same millisecond. The slice is also safer than
	// a channel: handlers can't panic sending on a closed channel after the
	// test returns.
	type evt struct {
		src  string
		kind string
		seq  int64
	}
	var evMu sync.Mutex
	var events []evt
	var seqCounter int64
	record := func(src, kind string) {
		evMu.Lock()
		seqCounter++
		events = append(events, evt{src: src, kind: kind, seq: seqCounter})
		evMu.Unlock()
	}

	// Server B: accepts a handshake, sends welcome + a distinctive notification,
	// then holds the connection until the client closes.
	notifB := notificationBytes("msg-from-B")
	srvB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record("B", "handshake")
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, welcomeBytes("sess-B", 10))
		_ = c.WriteMessage(websocket.TextMessage, notifB)
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				record("B", "read_err")
				return
			}
		}
	}))
	defer srvB.Close()

	// Server A: accepts a handshake, sends welcome + session_reconnect pointing
	// at server B. Then the client should close A's socket. We record that.
	srvA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record("A", "handshake")
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, welcomeBytes("sess-A", 10))
		_ = c.WriteMessage(websocket.TextMessage, reconnectBytes("sess-A", wsURLFromHTTP(srvB.URL)))
		// Wait for the client to close A — that's the signal the swap
		// completed.
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				record("A", "read_err")
				return
			}
		}
	}))
	defer srvA.Close()

	var mu sync.Mutex
	var captured [][]byte
	onFrame := func(raw []byte) {
		cp := append([]byte(nil), raw...)
		mu.Lock()
		captured = append(captured, cp)
		mu.Unlock()
	}

	conn, err := Open(context.Background(), OpenParams{
		URL:         wsURLFromHTTP(srvA.URL),
		StreamLogin: "streamer_a",
		OnFrame:     onFrame,
		Logger:      silentSlog(),
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	runDone := make(chan error, 1)
	go func() { runDone <- conn.Run(context.Background()) }()

	// Wait for the B-notification to appear in captured (signals swap done).
	deadline := time.Now().Add(3 * time.Second)
	sawNotifB := false
	for time.Now().Before(deadline) && !sawNotifB {
		mu.Lock()
		for _, f := range captured {
			if bytes.Equal(f, notifB) {
				sawNotifB = true
				break
			}
		}
		mu.Unlock()
		if sawNotifB {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !sawNotifB {
		t.Fatalf("did not see notification from server B after reconnect")
	}

	// Wait for server A to observe the close (that's what we need to verify
	// ordering against B.handshake). Happens after handleReconnect completes.
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		evMu.Lock()
		haveAClose := false
		for _, e := range events {
			if e.src == "A" && e.kind == "read_err" {
				haveAClose = true
				break
			}
		}
		evMu.Unlock()
		if haveAClose {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}

	// Close the connection to let Run exit, then wait for it.
	_ = conn.Close()
	select {
	case <-runDone:
	case <-time.After(3 * time.Second):
		t.Fatal("Run did not exit within 3s after Close")
	}

	// Inspect recorded events. Need: B handshake, then A read_err.
	evMu.Lock()
	eventsCopy := append([]evt(nil), events...)
	evMu.Unlock()

	var bHandshake, aClose int64
	var haveB, haveAClose bool
	for _, e := range eventsCopy {
		switch {
		case e.src == "B" && e.kind == "handshake" && !haveB:
			bHandshake = e.seq
			haveB = true
		case e.src == "A" && e.kind == "read_err" && !haveAClose:
			aClose = e.seq
			haveAClose = true
		}
	}
	if !haveB {
		t.Fatal("server B never observed a handshake")
	}
	if !haveAClose {
		t.Fatal("server A never observed a read error (client never closed old socket)")
	}
	if bHandshake >= aClose {
		t.Fatalf("expected B.handshake (seq=%d) before A.close (seq=%d) — swap violated zero-loss contract; events=%v",
			bHandshake, aClose, eventsCopy)
	}
}

// Test 4: Unexpected drop triggers exponential backoff. We inject a fake
// clock and verify the first three backoff delays are 1s, 2s, 4s. The
// server sends a welcome only on the very first dial so Open succeeds; every
// subsequent handshake closes mid-welcome, so dialAndWelcome fails and the
// failure counter climbs linearly (never resetting).
func TestConnection_ExponentialBackoffOnDrop(t *testing.T) {
	attempts := atomic.Int32{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := attempts.Add(1)
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		if n == 1 {
			// First dial — send welcome so Open returns. Then immediately
			// close to force a read-loop error that bumps the failure count.
			_ = c.WriteMessage(websocket.TextMessage, welcomeBytes("sess-1", 10))
		}
		_ = c.Close()
	}))
	defer srv.Close()

	clock := &fakeClock{}
	log, buf := captureSlog()

	conn, err := Open(context.Background(), OpenParams{
		URL:         wsURLFromHTTP(srv.URL),
		StreamLogin: "streamer_a",
		OnFrame:     func(raw []byte) {},
		Logger:      log,
		Clock:       clock,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer conn.Close()

	// Run in background; it terminates with ErrUpstreamLost after 5 failed
	// attempts (test 5 covers that explicitly). Here we only care about the
	// first three sleep durations.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runDone := make(chan error, 1)
	go func() { runDone <- conn.Run(ctx) }()

	// Poll until we have enough sleep slices to cover 3 logical attempts
	// (1s+2s+4s=7s, each sliced in 100ms ⇒ ~70 slices). We stop a bit past
	// that so the 3rd sleep is fully captured.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if clock.total() >= 7200*time.Millisecond {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}

	// Cancel so Run exits; we don't need the full 5-attempt sequence here.
	cancel()
	select {
	case <-runDone:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not terminate within 5s after cancel")
	}

	// sleepCtx slices Sleep into 100ms chunks — so each logical backoff delay
	// shows up as many calls. Reconstruct per-attempt totals by summing
	// consecutive slices until we've accounted for baseBackoff<<n.
	//
	// Simpler robust check: sum the totals and verify the cumulative is
	// ≥ 1s+2s+4s=7s (the first three attempts) — which proves exponential
	// growth regardless of slice granularity.
	clock.mu.Lock()
	sleeps := append([]time.Duration(nil), clock.sleeps...)
	clock.mu.Unlock()

	var total time.Duration
	for _, d := range sleeps {
		total += d
	}
	if total < 7*time.Second {
		t.Fatalf("total backoff %v < 7s (1+2+4) after %d sleeps: %v", total, len(sleeps), sleeps)
	}

	// Reconstruct discrete per-attempt delays by summing slices. Slices are
	// emitted in runs of 100ms (with a possible short final chunk). Group
	// them until the running total is at least the expected attempt delay.
	var attemptDelays []time.Duration
	expected := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}
	cursor := 0
	for _, want := range expected {
		var got time.Duration
		for cursor < len(sleeps) && got < want {
			got += sleeps[cursor]
			cursor++
		}
		if got < want {
			t.Fatalf("attempt %d delay %v < %v; sleeps=%v", len(attemptDelays)+1, got, want, sleeps)
		}
		attemptDelays = append(attemptDelays, got)
	}
	for i, want := range expected {
		// Allow up to one extra 100ms slice above the target because the last
		// slice is taken in full ("100ms step"), never trimmed.
		if attemptDelays[i] < want || attemptDelays[i] > want+120*time.Millisecond {
			t.Fatalf("attempt %d delay = %v, want ≈%v", i+1, attemptDelays[i], want)
		}
	}

	// Log assertions: reconnect.attempt entries should have attempt 1,2,3
	// with corresponding delayMs.
	logged := buf.String()
	for _, want := range []string{"\"attempt\":1", "\"attempt\":2", "\"attempt\":3"} {
		if !strings.Contains(logged, want) {
			t.Fatalf("expected log to contain %s, got:\n%s", want, logged)
		}
	}
	if !strings.Contains(logged, "eventsub.reconnect.attempt") {
		t.Fatalf("expected eventsub.reconnect.attempt log, got:\n%s", logged)
	}
}

// Test 5: After 5 consecutive failures Run returns ErrUpstreamLost. Fake
// clock should have exactly 5 logical sleeps totalling 31s (1+2+4+8+16).
// Note: production sleepCtx slices each backoff into 100ms chunks, so the
// recorded slice count is larger than 5 — we assert per-attempt logical
// delays by grouping slices.
func TestConnection_UpstreamLostAfter5Failures(t *testing.T) {
	attempts := atomic.Int32{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := attempts.Add(1)
		c, err := testUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		// Only the first attempt sends a welcome (simulates "connect +
		// immediate drop"). All subsequent attempts close during welcome so
		// dialAndWelcome fails outright — matches spec "server always closes
		// mid-handshake" for attempts 2..5.
		if n == 1 {
			_ = c.WriteMessage(websocket.TextMessage, welcomeBytes("sess-1", 10))
		}
		_ = c.Close()
	}))
	defer srv.Close()

	clock := &fakeClock{}
	log := silentSlog()

	conn, err := Open(context.Background(), OpenParams{
		URL:         wsURLFromHTTP(srv.URL),
		StreamLogin: "streamer_a",
		OnFrame:     func(raw []byte) {},
		Logger:      log,
		Clock:       clock,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer conn.Close()

	runDone := make(chan error, 1)
	go func() { runDone <- conn.Run(context.Background()) }()

	select {
	case err := <-runDone:
		if err == nil {
			t.Fatal("expected ErrUpstreamLost, got nil")
		}
		if !errors.Is(err, ErrUpstreamLost) {
			t.Fatalf("expected ErrUpstreamLost, got %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not terminate within 10s")
	}

	// 5 logical sleeps: 1, 2, 4, 8, 16 seconds = 31s total.
	total := clock.total()
	// Allow small floating excess because the final 100ms slice is always
	// taken in full (never trimmed below the slice size).
	if total < 31*time.Second {
		t.Fatalf("total backoff %v < 31s expected", total)
	}
	if total > 31*time.Second+5*120*time.Millisecond {
		t.Fatalf("total backoff %v > 31s + slop", total)
	}

	// Group slices into 5 logical delays and compare each.
	clock.mu.Lock()
	sleeps := append([]time.Duration(nil), clock.sleeps...)
	clock.mu.Unlock()

	expected := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second}
	cursor := 0
	for i, want := range expected {
		var got time.Duration
		for cursor < len(sleeps) && got < want {
			got += sleeps[cursor]
			cursor++
		}
		if got < want || got > want+120*time.Millisecond {
			t.Fatalf("logical sleep %d = %v, want ≈%v", i+1, got, want)
		}
	}
	if cursor != len(sleeps) {
		t.Fatalf("unexpected trailing sleeps: cursor=%d total=%d sleeps=%v", cursor, len(sleeps), sleeps)
	}
}
