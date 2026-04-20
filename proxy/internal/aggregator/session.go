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

	mu             sync.Mutex
	conns          []attachedConn
	started        bool
	stopped        bool
	wsActive       bool
	orphanTimer    *time.Timer
	orphanCanceled bool
	wg             sync.WaitGroup
	stopCh         chan struct{}
}

// StartOrphanTimer schedules onExpire after d if TryAcquireWS has not been
// called by then. Called once by the POST /session handler right before
// returning the session id to the client; if the client never follows up
// with a /ws connect, the reaper fires and the handler tears the session
// down so the upstream EventSub WebSocket transport slot is returned.
// Safe to call at most once per session. No-op if already stopped.
func (s *Session) StartOrphanTimer(d time.Duration, onExpire func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped || s.wsActive || s.orphanTimer != nil || s.orphanCanceled {
		return
	}
	s.orphanTimer = time.AfterFunc(d, func() {
		s.mu.Lock()
		if s.orphanCanceled {
			s.mu.Unlock()
			return
		}
		s.orphanCanceled = true
		s.orphanTimer = nil
		s.mu.Unlock()
		onExpire()
	})
}

// TryAcquireWS atomically claims the single downstream WebSocket slot for
// this session AND cancels the orphan reaper (if any). Returns true on
// success, false if another client already holds the slot or the orphan
// reaper has already fired. Use ReleaseWS when the WebSocket closes so
// reconnects can reattach.
func (s *Session) TryAcquireWS() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wsActive {
		return false
	}
	// The orphan reaper and WS acquisition race: if the timer already fired
	// (orphanCanceled=true with the session about to be removed), we must
	// refuse the acquire so the client reconnects to a fresh session.
	if s.orphanCanceled && s.orphanTimer == nil {
		return false
	}
	if s.orphanTimer != nil {
		s.orphanTimer.Stop()
		s.orphanTimer = nil
		s.orphanCanceled = true
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

// AttachConnLive registers a Conn and spawns its runner on an
// already-started session. Used by PATCH /session to add channels without
// tearing the whole session down. Returns false if the session has
// stopped — the caller is expected to close the conn itself in that case.
//
// StreamLogins is updated so the live list of channels the session is
// serving remains accurate; PATCH depends on this for subsequent
// DetachConn lookups and for the DELETE handler's ReleaseIdlePool loop.
func (s *Session) AttachConnLive(streamLogin string, c Conn) bool {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return false
	}
	s.conns = append(s.conns, attachedConn{streamLogin: streamLogin, conn: c})
	s.StreamLogins = append(s.StreamLogins, streamLogin)
	ac := s.conns[len(s.conns)-1]
	// If Start hasn't fired yet, defer runner launch to Start — it reads
	// s.conns under the lock and will spawn runConn for us.
	if !s.started {
		s.mu.Unlock()
		return true
	}
	s.wg.Add(1)
	s.mu.Unlock()
	go s.runConn(ac)
	return true
}

// DetachConn removes the conn associated with streamLogin, closes it, and
// drops streamLogin from StreamLogins. Safe post-Start — the runner
// goroutine will exit when Conn.Close unblocks Conn.Run, and the
// upstream_lost envelope emitted by runConn is suppressed because the
// streamLogin is no longer in s.conns.
//
// Returns true if a matching conn was found and detached. No-op (false)
// if the streamLogin isn't attached or the session has already stopped.
// Close is invoked OUTSIDE the lock to mirror Registry.Remove's pattern.
func (s *Session) DetachConn(streamLogin string) bool {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return false
	}
	idx := -1
	for i, ac := range s.conns {
		if ac.streamLogin == streamLogin {
			idx = i
			break
		}
	}
	if idx < 0 {
		s.mu.Unlock()
		return false
	}
	victim := s.conns[idx]
	s.conns = append(s.conns[:idx], s.conns[idx+1:]...)
	for i, l := range s.StreamLogins {
		if l == streamLogin {
			s.StreamLogins = append(s.StreamLogins[:i], s.StreamLogins[i+1:]...)
			break
		}
	}
	s.mu.Unlock()

	_ = victim.conn.Close()
	return true
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
	// channel that's about to be drained & closed by Stop. Also skip if
	// this streamLogin has been detached via DetachConn (PATCH remove):
	// the runner exit is expected and the client does not want an
	// upstream_lost envelope for a channel it deliberately dropped.
	s.mu.Lock()
	stopped := s.stopped
	stillAttached := false
	for _, a := range s.conns {
		if a.streamLogin == ac.streamLogin {
			stillAttached = true
			break
		}
	}
	s.mu.Unlock()
	if stopped || !stillAttached {
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
	if s.orphanTimer != nil {
		s.orphanTimer.Stop()
		s.orphanTimer = nil
		s.orphanCanceled = true
	}
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
