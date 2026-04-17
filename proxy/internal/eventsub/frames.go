// Package eventsub manages upstream WebSocket connections to Twitch EventSub
// and defines the minimal frame types the proxy needs to classify and route
// incoming messages. Only fields the proxy actually inspects are modelled —
// the full, opaque frame is still forwarded byte-for-byte to downstream
// clients via the aggregator.
package eventsub

import "encoding/json"

// Message-type string constants — populated in metadata.message_type for
// every EventSub frame. Centralising them avoids magic strings scattered
// across the connection state machine and aggregator router.
const (
	MessageTypeSessionWelcome   = "session_welcome"
	MessageTypeSessionKeepalive = "session_keepalive"
	MessageTypeSessionReconnect = "session_reconnect"
	MessageTypeNotification     = "notification"
	MessageTypeRevocation       = "revocation"
)

// Metadata is the common header present on every EventSub frame. The proxy
// only needs message_type (to route) and message_timestamp (for latency
// accounting), so other fields are intentionally elided.
type Metadata struct {
	MessageType      string `json:"message_type"`
	MessageTimestamp string `json:"message_timestamp"`
}

// Envelope is the minimal "just enough" view of an EventSub frame: metadata
// plus the opaque payload. Consumers that need typed access to specific
// payload shapes (welcome, reconnect, notification) decode the full frame
// into the more specific struct below.
type Envelope struct {
	Metadata Metadata        `json:"metadata"`
	Payload  json.RawMessage `json:"payload"`
}

// SessionWelcomeFrame models the minimal fields Connection needs from a
// session_welcome message: the session id (required later for subscription
// registration in P4-04) and the keepalive timeout used to set read
// deadlines.
type SessionWelcomeFrame struct {
	Payload struct {
		Session struct {
			ID                      string `json:"id"`
			KeepaliveTimeoutSeconds int    `json:"keepalive_timeout_seconds"`
		} `json:"session"`
	} `json:"payload"`
}

// SessionReconnectFrame instructs the client to dial a new URL and swap the
// WebSocket with zero message loss. Connection dials ReconnectURL BEFORE
// closing the old socket so pending frames buffered upstream are still
// delivered on the new session.
type SessionReconnectFrame struct {
	Payload struct {
		Session struct {
			ID           string `json:"id"`
			ReconnectURL string `json:"reconnect_url"`
		} `json:"session"`
	} `json:"payload"`
}

// SessionKeepaliveFrame is a no-op heartbeat frame. The struct is declared
// for symmetry and future use (e.g., timestamp-based liveness accounting);
// the connection state machine does not currently inspect its body.
type SessionKeepaliveFrame struct {
	Metadata Metadata `json:"metadata"`
}

// NotificationFrame carries an actual subscription event. The proxy only
// peeks at payload.subscription.type for event routing; the full frame is
// forwarded opaquely to downstream clients.
type NotificationFrame struct {
	Metadata Metadata `json:"metadata"`
	Payload  struct {
		Subscription struct {
			Type string `json:"type"`
		} `json:"subscription"`
		Event json.RawMessage `json:"event"`
	} `json:"payload"`
}

// RevocationFrame signals a subscription was revoked (permission loss,
// user unsubbed, etc). Forwarded downstream so the UI can surface the loss.
type RevocationFrame struct {
	Metadata Metadata `json:"metadata"`
	Payload  struct {
		Subscription struct {
			Type   string `json:"type"`
			Status string `json:"status"`
		} `json:"subscription"`
	} `json:"payload"`
}
