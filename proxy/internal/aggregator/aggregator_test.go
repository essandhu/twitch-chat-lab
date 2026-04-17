package aggregator

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"
)

// discardLogger returns a slog.Logger that drops every record. Keeps test
// output clean while still exercising logging code paths.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

// Notification frames must be wrapped as
//
//	{stream_login, event_type, payload}
//
// where event_type is drawn from payload.subscription.type and payload is the
// ENTIRE original EventSub frame (metadata + payload), not just the event.
func TestWrapNotificationForwardsEnvelope(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"metadata":{"message_type":"notification","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload":{"subscription":{"type":"channel.chat.message"},"event":{"message_id":"m1"}}
	}`)

	var captured []byte
	hook := Wrap("streamer_a", func(envelope []byte) {
		captured = append([]byte(nil), envelope...)
	}, discardLogger())

	hook(raw)

	if captured == nil {
		t.Fatal("onEnvelope never called for notification frame")
	}

	var env struct {
		StreamLogin string          `json:"stream_login"`
		EventType   string          `json:"event_type"`
		Payload     json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(captured, &env); err != nil {
		t.Fatalf("envelope json invalid: %v", err)
	}

	if env.StreamLogin != "streamer_a" {
		t.Fatalf("stream_login = %q, want streamer_a", env.StreamLogin)
	}
	if env.EventType != "channel.chat.message" {
		t.Fatalf("event_type = %q, want channel.chat.message", env.EventType)
	}
	// Payload must be the full original frame — assert metadata field survives.
	var roundTrip map[string]any
	if err := json.Unmarshal(env.Payload, &roundTrip); err != nil {
		t.Fatalf("payload json invalid: %v", err)
	}
	if _, ok := roundTrip["metadata"]; !ok {
		t.Fatal("payload should contain full original frame with metadata; metadata missing")
	}
}

// session_welcome frames are proxy-internal lifecycle — they must NOT be
// forwarded to the downstream websocket.
func TestWrapDropsSessionWelcome(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"metadata":{"message_type":"session_welcome","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload":{"session":{"id":"abc","keepalive_timeout_seconds":10}}
	}`)

	called := false
	hook := Wrap("streamer_a", func(envelope []byte) { called = true }, discardLogger())
	hook(raw)

	if called {
		t.Fatal("session_welcome must not reach onEnvelope")
	}
}

// session_reconnect is also proxy-internal and must be dropped.
func TestWrapDropsSessionReconnect(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"metadata":{"message_type":"session_reconnect","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload":{"session":{"id":"abc","reconnect_url":"wss://x"}}
	}`)

	called := false
	hook := Wrap("streamer_a", func(envelope []byte) { called = true }, discardLogger())
	hook(raw)

	if called {
		t.Fatal("session_reconnect must not reach onEnvelope")
	}
}

// session_keepalive frames are forwarded with event_type="session_keepalive"
// so the frontend latency fallback has a signal.
func TestWrapForwardsKeepalive(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"metadata":{"message_type":"session_keepalive","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload":{}
	}`)

	var captured []byte
	hook := Wrap("streamer_a", func(envelope []byte) {
		captured = append([]byte(nil), envelope...)
	}, discardLogger())
	hook(raw)

	if captured == nil {
		t.Fatal("session_keepalive must be forwarded")
	}

	var env struct {
		EventType string `json:"event_type"`
	}
	if err := json.Unmarshal(captured, &env); err != nil {
		t.Fatalf("envelope json invalid: %v", err)
	}
	if env.EventType != "session_keepalive" {
		t.Fatalf("event_type = %q, want session_keepalive", env.EventType)
	}
}

// Malformed JSON must be logged and dropped, never panicking.
func TestWrapDropsMalformedJSON(t *testing.T) {
	t.Parallel()

	called := false
	hook := Wrap("streamer_a", func(envelope []byte) { called = true }, discardLogger())

	// The closure must not panic.
	hook([]byte("not json at all"))

	if called {
		t.Fatal("malformed frame must not reach onEnvelope")
	}
}

// UpstreamLostEnvelope returns a pre-marshalled sentinel for session teardown.
func TestUpstreamLostEnvelope(t *testing.T) {
	t.Parallel()

	env := UpstreamLostEnvelope("streamer_b")

	var parsed struct {
		Error       string `json:"error"`
		StreamLogin string `json:"stream_login"`
	}
	if err := json.Unmarshal(env, &parsed); err != nil {
		t.Fatalf("envelope json invalid: %v", err)
	}
	if parsed.Error != "upstream_lost" {
		t.Fatalf("error = %q, want upstream_lost", parsed.Error)
	}
	if parsed.StreamLogin != "streamer_b" {
		t.Fatalf("stream_login = %q, want streamer_b", parsed.StreamLogin)
	}
}
