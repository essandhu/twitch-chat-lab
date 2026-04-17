package aggregator

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// defaultFrameOutBuffer is the buffered size of Session.FrameOut. Chosen to
// absorb short downstream stalls (~2-3 s of chat) without OOMing the
// proxy; backpressure logs kick in well before memory pressure.
const defaultFrameOutBuffer = 256

// connCloseTimeout caps how long Stop waits for any single Conn to close
// before moving on. The 2s budget matches Architecture §10's "shutdown
// under 10s" rule even with multiple conns in parallel.
const connCloseTimeout = 2 * time.Second

// Conn is the minimal interface Session uses to drive an upstream connection.
// eventsub.Connection satisfies it; tests inject a fake.
type Conn interface {
	SessionID() string
	Run(ctx context.Context) error
	Close() error
}

// attachedConn pairs a Conn with the stream_login it serves so Session
// runners can log and emit upstream_lost envelopes tagged correctly.
type attachedConn struct {
	streamLogin string
	conn        Conn
}

// Session owns a downstream client's worth of upstream EventSub
// connections — one per stream_login in StreamLogins. It fans frames from
// each Conn into a single FrameOut channel consumed by the websocket
// handler (P4-08).
//
// State machine: NewSession → AttachConn (zero or more) → Start → Stop.
// Start and Stop are each safe to call at most once and any number of
// times respectively (Stop is idempotent).
type Session struct {
	ID           string
	UserID       string
	StreamLogins []string
	FrameOut     chan []byte

	ctx    context.Context
	cancel context.CancelFunc
	logger *slog.Logger

	mu       sync.Mutex
	conns    []attachedConn
	started  bool
	stopped  bool
	wsActive bool
	wg       sync.WaitGroup
	stopCh   chan struct{}
}

// TryAcquireWS atomically claims the single downstream WebSocket slot for
// this session. Returns true on success, false if another client already
// holds it. Use ReleaseWS when the WebSocket closes so reconnects can
// reattach.
func (s *Session) TryAcquireWS() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wsActive {
		return false
	}
	s.wsActive = true
	return true
}

// ReleaseWS clears the downstream-WebSocket-in-use flag. Safe to call
// multiple times; a release on an unheld slot is a no-op.
func (s *Session) ReleaseWS() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.wsActive = false
}

// NewSession constructs a Session bound to parent ctx. Cancelling parent
// automatically tears the session down via Stop().
func NewSession(parent context.Context, id, userID string, streamLogins []string, logger *slog.Logger) *Session {
	return newSessionForTest(parent, id, userID, streamLogins, logger, defaultFrameOutBuffer)
}

// newSessionForTest mirrors NewSession but lets tests (P4-09) override the
// FrameOut buffer size to force backpressure deterministically.
func newSessionForTest(parent context.Context, id, userID string, streamLogins []string, logger *slog.Logger, bufferSize int) *Session {
	if bufferSize <= 0 {
		bufferSize = defaultFrameOutBuffer
	}
	ctx, cancel := context.WithCancel(parent)
	return &Session{
		ID:           id,
		UserID:       userID,
		StreamLogins: append([]string(nil), streamLogins...),
		FrameOut:     make(chan []byte, bufferSize),
		ctx:          ctx,
		cancel:       cancel,
		logger:       logger,
		stopCh:       make(chan struct{}),
	}
}

// AttachConn registers a Conn to be driven by Start. Must be called before
// Start; calls after Start are ignored with a log so the caller notices
// without the service crashing.
func (s *Session) AttachConn(streamLogin string, c Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		if s.logger != nil {
			s.logger.Warn("session.attach.after_start",
				"sessionId", s.ID,
				"streamLogin", streamLogin,
			)
		}
		return
	}
	s.conns = append(s.conns, attachedConn{streamLogin: streamLogin, conn: c})
}

// Start launches one runner goroutine per attached Conn. Each runner
// executes Conn.Run under the session context and emits an upstream_lost
// envelope to FrameOut when Run returns (error or nil).
func (s *Session) Start() {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	conns := make([]attachedConn, len(s.conns))
	copy(conns, s.conns)
	s.mu.Unlock()

	for _, ac := range conns {
		s.wg.Add(1)
		go s.runConn(ac)
	}
}

// runConn drives a single Conn.Run and, on exit, emits an upstream_lost
// envelope to FrameOut unless the session is already stopped.
func (s *Session) runConn(ac attachedConn) {
	defer s.wg.Done()
	err := ac.conn.Run(s.ctx)
	if s.logger != nil {
		attrs := []any{
			"sessionId", s.ID,
			"streamLogin", ac.streamLogin,
		}
		if err != nil {
			attrs = append(attrs, "error", err.Error())
		}
		s.logger.Info("session.runner.exit", attrs...)
	}

	// Skip upstream_lost emission if Stop has already been called — the
	// downstream will have been closed and we'd be writing into a
	// channel that's about to be drained & closed by Stop.
	s.mu.Lock()
	stopped := s.stopped
	s.mu.Unlock()
	if stopped {
		return
	}

	// Non-blocking send: if the downstream is backpressured we'd rather
	// drop the terminal envelope than wedge the session shutdown.
	env := UpstreamLostEnvelope(ac.streamLogin)
	select {
	case s.FrameOut <- env:
	default:
		if s.logger != nil {
			s.logger.Warn("frame.drop.backpressure",
				"sessionId", s.ID,
				"streamLogin", ac.streamLogin,
				"reason", "upstream_lost_envelope",
			)
		}
	}
}

// Stop cancels the session context, closes every attached Conn in
// parallel (2s timeout each), waits for runners to exit, then closes
// FrameOut exactly once. Safe to call multiple times from any goroutine.
func (s *Session) Stop() {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	s.stopped = true
	conns := make([]attachedConn, len(s.conns))
	copy(conns, s.conns)
	s.mu.Unlock()

	// Cancel first so any runner blocked on Run unblocks without waiting
	// for Close to complete.
	s.cancel()

	// Close each conn in parallel with a per-conn timeout. We don't care
	// about the error — best-effort teardown.
	var closeWG sync.WaitGroup
	for _, ac := range conns {
		closeWG.Add(1)
		go func(c Conn) {
			defer closeWG.Done()
			done := make(chan struct{})
			go func() {
				_ = c.Close()
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(connCloseTimeout):
				// Leak the close goroutine; underlying socket will be
				// reaped by OS. Better than deadlocking Stop.
			}
		}(ac.conn)
	}
	closeWG.Wait()

	// Wait for runners to exit before closing FrameOut so we never send
	// on a closed channel.
	s.wg.Wait()

	close(s.FrameOut)
	close(s.stopCh)

	if s.logger != nil {
		s.logger.Info("session.stop", "sessionId", s.ID)
	}
}
