package eventsub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// defaultEventSubURL is the canonical Twitch EventSub WebSocket endpoint.
// Tests inject their own URL via OpenParams.URL to avoid live dials.
const defaultEventSubURL = "wss://eventsub.wss.twitch.tv/ws"

// Reconnect tuning. After maxReconnectAttempts consecutive dial/read failures
// without a fresh session_welcome in between, Run gives up and returns
// ErrUpstreamLost so the owning Session can tear down.
const (
	maxReconnectAttempts = 5
	maxBackoff           = 30 * time.Second
	baseBackoff          = 1 * time.Second
	readDeadlineSlack    = 5 * time.Second
)

// ErrUpstreamLost is returned by Run when reconnection has failed the
// configured number of times. Callers (aggregator.Session) map this into a
// downstream "upstream_lost" envelope.
var ErrUpstreamLost = errors.New("upstream_lost")

// Clock is a minimal sleep seam so tests can fast-forward backoff delays
// without spending real wall-clock time. Only Sleep is required today;
// expanding this later (After, Now) stays backward-compatible.
type Clock interface {
	Sleep(d time.Duration)
}

// realClock is the production Clock — it just defers to time.Sleep.
type realClock struct{}

func (realClock) Sleep(d time.Duration) { time.Sleep(d) }

// OpenParams bundles everything required to Open a Connection. Optional
// seams (Clock, Dialer) default to production implementations when nil.
type OpenParams struct {
	URL         string
	StreamLogin string
	OnFrame     func(raw []byte)
	Logger      *slog.Logger
	Clock       Clock
	Dialer      *websocket.Dialer
}

// Connection owns a single upstream EventSub WebSocket for exactly one
// stream login. It is safe to Close concurrently with Run; all mutable
// state is guarded by mu.
//
// Lifecycle: New → Open (blocks until session_welcome) → Run (read loop
// with reconnect) → Close (idempotent).
type Connection struct {
	mu          sync.Mutex
	ws          *websocket.Conn
	sessionID   string
	keepalive   time.Duration
	streamLogin string
	url         string
	onFrame     func(raw []byte)
	logger      *slog.Logger
	clock       Clock
	dialer      *websocket.Dialer
	closed      bool
}

// Open dials the upstream WebSocket and blocks until the initial
// session_welcome frame has been consumed. On context cancellation or any
// dial/read error the partial connection is torn down and the error
// returned.
func Open(ctx context.Context, params OpenParams) (*Connection, error) {
	if params.OnFrame == nil {
		return nil, errors.New("eventsub: OpenParams.OnFrame is required")
	}
	if params.Logger == nil {
		return nil, errors.New("eventsub: OpenParams.Logger is required")
	}

	url := params.URL
	if url == "" {
		url = defaultEventSubURL
	}
	clock := params.Clock
	if clock == nil {
		clock = realClock{}
	}
	dialer := params.Dialer
	if dialer == nil {
		dialer = websocket.DefaultDialer
	}

	c := &Connection{
		streamLogin: params.StreamLogin,
		url:         url,
		onFrame:     params.OnFrame,
		logger:      params.Logger,
		clock:       clock,
		dialer:      dialer,
	}

	if err := c.dialAndWelcome(ctx, url); err != nil {
		return nil, err
	}
	return c, nil
}

// dialAndWelcome performs a single dial + session_welcome handshake. On
// success, the websocket and sessionID are stored on c under the mutex.
// On any failure the partial socket is closed and the error is returned
// unchanged — retry policy lives one level up in Run.
func (c *Connection) dialAndWelcome(ctx context.Context, url string) error {
	c.logger.Info("eventsub.connect.open",
		"streamLogin", c.streamLogin,
		"url", url,
	)

	ws, _, err := c.dialer.DialContext(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("dial %s: %w", url, err)
	}

	// Read the first frame; it must be session_welcome per the EventSub
	// WebSocket transport contract.
	_, data, err := ws.ReadMessage()
	if err != nil {
		_ = ws.Close()
		return fmt.Errorf("read welcome: %w", err)
	}

	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		_ = ws.Close()
		return fmt.Errorf("decode welcome envelope: %w", err)
	}
	if env.Metadata.MessageType != MessageTypeSessionWelcome {
		_ = ws.Close()
		return fmt.Errorf("expected session_welcome, got %q", env.Metadata.MessageType)
	}

	var welcome SessionWelcomeFrame
	if err := json.Unmarshal(data, &welcome); err != nil {
		_ = ws.Close()
		return fmt.Errorf("decode welcome: %w", err)
	}

	keepalive := time.Duration(welcome.Payload.Session.KeepaliveTimeoutSeconds) * time.Second
	if keepalive <= 0 {
		// Twitch default is 10s; guard against zero-values from mocks so
		// the read deadline math below can't underflow.
		keepalive = 10 * time.Second
	}

	c.mu.Lock()
	c.ws = ws
	c.sessionID = welcome.Payload.Session.ID
	c.keepalive = keepalive
	c.mu.Unlock()

	// Forward the raw welcome frame so callers who care (tests, diagnostics)
	// still see it; the aggregator drops it downstream.
	c.onFrame(data)

	c.logger.Info("eventsub.session.welcome",
		"streamLogin", c.streamLogin,
		"sessionId", welcome.Payload.Session.ID,
		"keepaliveSeconds", welcome.Payload.Session.KeepaliveTimeoutSeconds,
	)
	return nil
}

// SessionID returns the current EventSub session id. Safe for concurrent
// use. Returns an empty string before Open completes.
func (c *Connection) SessionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sessionID
}

// currentWS returns the active websocket and its keepalive duration under
// the mutex so swaps during session_reconnect are race-free.
func (c *Connection) currentWS() (*websocket.Conn, time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ws, c.keepalive
}

// Run blocks, reading frames until ctx is cancelled, the connection closes
// cleanly, or reconnect attempts are exhausted (ErrUpstreamLost). Each
// frame is dispatched to OnFrame synchronously; OnFrame should not block.
func (c *Connection) Run(ctx context.Context) error {
	failureCount := 0
	var lastErr error

	for {
		if ctx.Err() != nil {
			c.logger.Info("eventsub.connect.close",
				"streamLogin", c.streamLogin,
				"reason", "context_cancelled",
			)
			return nil
		}
		if c.isClosed() {
			c.logger.Info("eventsub.connect.close",
				"streamLogin", c.streamLogin,
				"reason", "closed",
			)
			return nil
		}

		err := c.readLoop(ctx)
		switch {
		case err == nil:
			// Clean exit (context cancel or Close).
			c.logger.Info("eventsub.connect.close",
				"streamLogin", c.streamLogin,
				"reason", "clean",
			)
			return nil
		case errors.Is(err, errSessionReconnectHandled):
			// readLoop already swapped sockets — reset failure counter.
			failureCount = 0
			continue
		}

		// Unexpected drop: reconnect with exponential backoff.
		lastErr = err
		failureCount++
		if failureCount > maxReconnectAttempts {
			c.logger.Error("eventsub.upstream.lost",
				"streamLogin", c.streamLogin,
				"attempts", failureCount-1,
				"error", lastErr.Error(),
			)
			return fmt.Errorf("%w: %v", ErrUpstreamLost, lastErr)
		}

		delay := backoffFor(failureCount)
		c.logger.Warn("eventsub.reconnect.attempt",
			"streamLogin", c.streamLogin,
			"attempt", failureCount,
			"delayMs", delay.Milliseconds(),
			"error", err.Error(),
		)

		// Sleep respecting cancellation: split sleep via Clock but also
		// poll ctx so a shutdown during backoff doesn't stall.
		if !c.sleepCtx(ctx, delay) {
			c.logger.Info("eventsub.connect.close",
				"streamLogin", c.streamLogin,
				"reason", "context_cancelled_during_backoff",
			)
			return nil
		}

		if err := c.dialAndWelcome(ctx, c.url); err != nil {
			// Continue with escalating backoff. The next loop iteration
			// will either retry or give up.
			lastErr = err
			continue
		}
		// Fresh welcome → reset counter.
		failureCount = 0
	}
}

// errSessionReconnectHandled is a private sentinel used by readLoop to
// signal "I successfully swapped to the reconnect_url socket, please keep
// looping without counting this as a failure".
var errSessionReconnectHandled = errors.New("session_reconnect_handled")

// readLoop reads frames from the current websocket until it terminates
// (error, EOF, context cancel) or a session_reconnect has been handled.
func (c *Connection) readLoop(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			return nil
		}
		if c.isClosed() {
			return nil
		}

		ws, keepalive := c.currentWS()
		if ws == nil {
			return errors.New("no active websocket")
		}

		// Per-frame read deadline: keepalive + slack. Twitch sends a
		// keepalive every keepalive_timeout_seconds, so exceeding that
		// budget is a hard drop signal.
		_ = ws.SetReadDeadline(time.Now().Add(keepalive + readDeadlineSlack))

		_, data, err := ws.ReadMessage()
		if err != nil {
			if ctx.Err() != nil || c.isClosed() {
				return nil
			}
			return err
		}

		// Peek message_type for routing. Malformed frames are forwarded
		// raw — the aggregator drops them with a malformed log; we do not
		// want the connection state machine to crash on invalid JSON.
		var env Envelope
		if err := json.Unmarshal(data, &env); err == nil {
			if env.Metadata.MessageType == MessageTypeSessionReconnect {
				if swapErr := c.handleReconnect(ctx, data); swapErr != nil {
					// Swap failed — fall through to outer reconnect
					// policy by returning the error.
					return swapErr
				}
				// Forward the reconnect frame to listeners, then signal
				// "reconnect handled" so the outer loop keeps going.
				c.onFrame(data)
				return errSessionReconnectHandled
			}
		}

		c.onFrame(data)
	}
}

// handleReconnect dials the provided reconnect_url first, and only on
// success swaps the stored websocket. This is the zero-loss transition
// required by Twitch's session_reconnect contract.
func (c *Connection) handleReconnect(ctx context.Context, data []byte) error {
	var frame SessionReconnectFrame
	if err := json.Unmarshal(data, &frame); err != nil {
		return fmt.Errorf("decode reconnect: %w", err)
	}
	newURL := frame.Payload.Session.ReconnectURL
	if newURL == "" {
		return errors.New("session_reconnect missing reconnect_url")
	}

	// Capture old state before any mutation for logging.
	c.mu.Lock()
	oldSession := c.sessionID
	oldWS := c.ws
	c.mu.Unlock()

	newWS, _, err := c.dialer.DialContext(ctx, newURL, nil)
	if err != nil {
		return fmt.Errorf("dial reconnect_url: %w", err)
	}

	// First frame on the new socket must also be session_welcome.
	_, welcomeData, err := newWS.ReadMessage()
	if err != nil {
		_ = newWS.Close()
		return fmt.Errorf("read reconnect welcome: %w", err)
	}
	var welcomeEnv Envelope
	if err := json.Unmarshal(welcomeData, &welcomeEnv); err != nil {
		_ = newWS.Close()
		return fmt.Errorf("decode reconnect welcome envelope: %w", err)
	}
	if welcomeEnv.Metadata.MessageType != MessageTypeSessionWelcome {
		_ = newWS.Close()
		return fmt.Errorf("expected session_welcome on reconnect, got %q", welcomeEnv.Metadata.MessageType)
	}
	var welcome SessionWelcomeFrame
	if err := json.Unmarshal(welcomeData, &welcome); err != nil {
		_ = newWS.Close()
		return fmt.Errorf("decode reconnect welcome: %w", err)
	}
	keepalive := time.Duration(welcome.Payload.Session.KeepaliveTimeoutSeconds) * time.Second
	if keepalive <= 0 {
		keepalive = 10 * time.Second
	}

	// Swap under lock.
	c.mu.Lock()
	c.ws = newWS
	c.sessionID = welcome.Payload.Session.ID
	c.keepalive = keepalive
	c.url = newURL
	c.mu.Unlock()

	// Forward the new welcome raw, then close the old socket.
	c.onFrame(welcomeData)
	if oldWS != nil {
		_ = oldWS.Close()
	}

	c.logger.Info("eventsub.session.reconnect",
		"streamLogin", c.streamLogin,
		"oldSessionId", oldSession,
		"newSessionId", welcome.Payload.Session.ID,
	)
	return nil
}

// Close tears down the underlying websocket. Safe to call multiple times
// and concurrently with Run.
func (c *Connection) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	ws := c.ws
	c.ws = nil
	c.mu.Unlock()

	if ws != nil {
		return ws.Close()
	}
	return nil
}

// isClosed reports whether Close has been called. Used by read loops to
// terminate cleanly on Close rather than propagating spurious read errors.
func (c *Connection) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

// sleepCtx waits d using the injected Clock while remaining cancellable.
// Returns false if ctx was cancelled mid-sleep so the caller can bail.
//
// Implementation note: we cannot pre-empt Clock.Sleep once started, so we
// divide the wait into short slices (100 ms) and poll ctx between them.
// Tests inject a fake clock that returns instantly, making this loop a
// no-op in unit tests.
func (c *Connection) sleepCtx(ctx context.Context, d time.Duration) bool {
	const slice = 100 * time.Millisecond
	remaining := d
	for remaining > 0 {
		if ctx.Err() != nil {
			return false
		}
		step := slice
		if remaining < step {
			step = remaining
		}
		c.clock.Sleep(step)
		remaining -= step
	}
	return ctx.Err() == nil
}

// backoffFor computes the per-attempt backoff: 1s, 2s, 4s, 8s, 16s, 30s
// (capped at maxBackoff). attempt is 1-based.
func backoffFor(attempt int) time.Duration {
	if attempt <= 0 {
		return baseBackoff
	}
	// Guard against overflow: shift past 30 still gets capped.
	if attempt > 30 {
		return maxBackoff
	}
	d := baseBackoff << (attempt - 1)
	if d > maxBackoff || d <= 0 {
		return maxBackoff
	}
	return d
}
