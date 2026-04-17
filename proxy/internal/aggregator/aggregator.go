// Package aggregator fans-in raw EventSub frames from multiple upstream
// connections into a single downstream envelope stream tagged with the
// originating stream_login.
//
// The package intentionally exposes two pure pieces (Wrap + the sentinel
// envelope builder) plus two stateful pieces (Session, Registry). The pure
// pieces make routing easy to unit test; the stateful pieces manage
// goroutines that own the EventSub connections.
package aggregator

import (
	"encoding/json"
	"log/slog"

	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
)

// ErrUpstreamLost re-exports the eventsub sentinel so downstream consumers
// of the aggregator package don't need to import eventsub directly just to
// compare error values.
var ErrUpstreamLost = eventsub.ErrUpstreamLost

// FrameHook matches the signature expected by eventsub.OpenParams.OnFrame.
// Wrap returns one of these closures.
type FrameHook = func(raw []byte)

// peekedFrame is the minimal schema Wrap needs to classify a frame.
// message_type is always present; subscription.type is only populated on
// notification/revocation frames.
type peekedFrame struct {
	Metadata struct {
		MessageType string `json:"message_type"`
	} `json:"metadata"`
	Payload struct {
		Subscription struct {
			Type string `json:"type"`
		} `json:"subscription"`
	} `json:"payload"`
}

// downstreamEnvelope is the single shape emitted to the downstream client
// regardless of upstream event type. stream_login lets the frontend split a
// multi-stream channel into per-stream lanes.
type downstreamEnvelope struct {
	StreamLogin string          `json:"stream_login"`
	EventType   string          `json:"event_type"`
	Payload     json.RawMessage `json:"payload"`
}

// Wrap returns a frame hook bound to streamLogin + onEnvelope. The closure
// has no shared mutable state so it is safe to use concurrently from
// multiple goroutines; each call classifies the raw frame and either
// forwards a wrapped envelope to onEnvelope or drops the frame silently
// (session_welcome, session_reconnect, malformed JSON).
func Wrap(streamLogin string, onEnvelope func(envelope []byte), logger *slog.Logger) FrameHook {
	return func(raw []byte) {
		var peek peekedFrame
		if err := json.Unmarshal(raw, &peek); err != nil {
			if logger != nil {
				logger.Warn("aggregator.frame.malformed",
					"streamLogin", streamLogin,
					"error", err.Error(),
				)
			}
			return
		}

		var eventType string
		switch peek.Metadata.MessageType {
		case eventsub.MessageTypeNotification, eventsub.MessageTypeRevocation:
			eventType = peek.Payload.Subscription.Type
			if eventType == "" {
				// Fall back to the outer message_type so downstream still
				// sees a non-empty event_type tag.
				eventType = peek.Metadata.MessageType
			}
		case eventsub.MessageTypeSessionKeepalive:
			eventType = eventsub.MessageTypeSessionKeepalive
		case eventsub.MessageTypeSessionWelcome, eventsub.MessageTypeSessionReconnect:
			// Proxy-internal lifecycle — do not forward.
			return
		default:
			// Unknown frame types: pass through using the raw message_type
			// so ops has visibility without the proxy having to release
			// for each new EventSub feature.
			eventType = peek.Metadata.MessageType
			if eventType == "" {
				if logger != nil {
					logger.Warn("aggregator.frame.malformed",
						"streamLogin", streamLogin,
						"error", "missing metadata.message_type",
					)
				}
				return
			}
		}

		// Payload is the FULL original EventSub frame, not just
		// payload.event — downstream consumers often need metadata
		// (timestamps, message ids) for latency accounting.
		env := downstreamEnvelope{
			StreamLogin: streamLogin,
			EventType:   eventType,
			Payload:     json.RawMessage(raw),
		}

		bytes, err := json.Marshal(env)
		if err != nil {
			if logger != nil {
				logger.Warn("aggregator.frame.malformed",
					"streamLogin", streamLogin,
					"error", err.Error(),
				)
			}
			return
		}
		onEnvelope(bytes)
	}
}

// UpstreamLostEnvelope returns a pre-marshalled sentinel envelope emitted
// by Session when a Conn runner exits. It mirrors the downstream envelope
// shape used by Wrap but without a payload — the downstream treats it as
// terminal for this stream_login.
func UpstreamLostEnvelope(streamLogin string) []byte {
	// Hand-rolling the bytes keeps this allocation-free-ish and avoids
	// marshal errors on a fixed-shape struct.
	env := struct {
		Error       string `json:"error"`
		StreamLogin string `json:"stream_login"`
	}{
		Error:       "upstream_lost",
		StreamLogin: streamLogin,
	}
	b, err := json.Marshal(env)
	if err != nil {
		// Should never happen for a fixed struct of string fields.
		return []byte(`{"error":"upstream_lost","stream_login":""}`)
	}
	return b
}
