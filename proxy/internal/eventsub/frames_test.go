package eventsub

import (
	"encoding/json"
	"testing"
)

// Round-trip smoke test: marshalling then unmarshalling an Envelope must
// preserve metadata fields and the opaque payload bytes.
func TestEnvelopeRoundTrip(t *testing.T) {
	t.Parallel()

	original := Envelope{
		Metadata: Metadata{
			MessageType:      "notification",
			MessageTimestamp: "2026-04-17T12:00:00Z",
		},
		Payload: json.RawMessage(`{"subscription":{"type":"channel.chat.message"},"event":{"foo":"bar"}}`),
	}

	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var round Envelope
	if err := json.Unmarshal(raw, &round); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if round.Metadata.MessageType != "notification" {
		t.Fatalf("metadata.message_type = %q, want notification", round.Metadata.MessageType)
	}
	if round.Metadata.MessageTimestamp != "2026-04-17T12:00:00Z" {
		t.Fatalf("metadata.message_timestamp = %q", round.Metadata.MessageTimestamp)
	}
	if string(round.Payload) == "" {
		t.Fatal("payload lost during round-trip")
	}
}

// session_welcome frames carry session.id and keepalive_timeout_seconds in
// payload.session — the Connection needs to decode both reliably.
func TestSessionWelcomeFrameDecode(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"metadata": {"message_type":"session_welcome","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload": {"session":{"id":"abc123","keepalive_timeout_seconds":10,"status":"connected"}}
	}`)

	var frame SessionWelcomeFrame
	if err := json.Unmarshal(raw, &frame); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if frame.Payload.Session.ID != "abc123" {
		t.Fatalf("session.id = %q, want abc123", frame.Payload.Session.ID)
	}
	if frame.Payload.Session.KeepaliveTimeoutSeconds != 10 {
		t.Fatalf("keepalive_timeout_seconds = %d, want 10", frame.Payload.Session.KeepaliveTimeoutSeconds)
	}
}

// session_reconnect frames carry a reconnect_url the Connection must dial
// BEFORE closing the existing websocket.
func TestSessionReconnectFrameDecode(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
		"metadata":{"message_type":"session_reconnect","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload":{"session":{"id":"new999","status":"reconnecting","reconnect_url":"wss://eventsub.wss.twitch.tv/ws?reconnect=1"}}
	}`)

	var frame SessionReconnectFrame
	if err := json.Unmarshal(raw, &frame); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if frame.Payload.Session.ID != "new999" {
		t.Fatalf("session.id = %q", frame.Payload.Session.ID)
	}
	if frame.Payload.Session.ReconnectURL == "" {
		t.Fatal("reconnect_url missing")
	}
}
