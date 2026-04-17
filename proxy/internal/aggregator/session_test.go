// Run with -race in CI (requires CGO).
//
// This test file covers aggregator.Session (P4-05) end-to-end:
//
//   1. Fan-in ordering preserved within a single stream.
//   2. Fan-in preserves per-stream ordering when multiple streams interleave.
//   3. Backpressure: full FrameOut drops envelopes and logs, never deadlocks.
//   4. Clean teardown on parent ctx cancel: no goroutine leaks, FrameOut closed.
//   5. upstream_lost envelope is emitted when a Conn's Run returns ErrUpstreamLost.
//
// Tests use a fakeConn implementing aggregator.Conn that accepts a per-run
// "script" of raw frames it pushes into a supplied OnFrame-equivalent hook.
// The hook is not part of aggregator.Conn — Session itself doesn't invoke
// OnFrame; that hook is plumbed in by the handler layer (see api/handler.go's
// use of aggregator.Wrap). To keep these unit tests focused on Session, the
// fake conn emits directly into session.FrameOut via a per-conn Wrap hook the
// test installs before Start.
package aggregator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeConn implements aggregator.Conn. Run pushes every frame in script into
// the supplied emit function and then blocks until ctx is cancelled or Close
// is called. runErr, if set, is returned from Run after the emit loop — this
// is how test 5 delivers ErrUpstreamLost.
type fakeConn struct {
	id     string
	emit   func([]byte) // called once per frame during Run
	script [][]byte
	runErr error

	mu     sync.Mutex
	closed bool
	done   chan struct{}
}

func newFakeConn(id string, script [][]byte) *fakeConn {
	return &fakeConn{
		id:     id,
		script: script,
		done:   make(chan struct{}),
	}
}

func (f *fakeConn) SessionID() string { return f.id }

func (f *fakeConn) Run(ctx context.Context) error {
	for _, frame := range f.script {
		if f.emit != nil {
			f.emit(frame)
		}
	}

	if f.runErr != nil {
		return f.runErr
	}

	// Block until closed or cancelled so Session.Stop has something to tear
	// down. This matches real eventsub.Connection.Run semantics.
	select {
	case <-ctx.Done():
		return nil
	case <-f.done:
		return nil
	}
}

func (f *fakeConn) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	close(f.done)
	return nil
}

// buildNotificationFrame produces a minimal EventSub notification frame that
// Wrap will accept. seq is encoded as message_id so tests can reconstruct
// ordering from the downstream envelope payload.
func buildNotificationFrame(streamLogin string, seq int) []byte {
	return []byte(fmt.Sprintf(`{
		"metadata":{"message_type":"notification","message_timestamp":"2026-04-17T12:00:00Z"},
		"payload":{"subscription":{"type":"channel.chat.message"},"event":{"message_id":"seq-%d","broadcaster_user_login":%q}}
	}`, seq, streamLogin))
}

// extractSeq pulls the numeric sequence out of payload.payload.event.message_id.
// Returns -1 if not found. Works on wrapped envelopes (which carry the full
// original frame in envelope.payload).
func extractSeq(envelope []byte) (streamLogin string, seq int, ok bool) {
	var env struct {
		StreamLogin string          `json:"stream_login"`
		EventType   string          `json:"event_type"`
		Payload     json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(envelope, &env); err != nil {
		return "", -1, false
	}
	var inner struct {
		Payload struct {
			Event struct {
				MessageID string `json:"message_id"`
			} `json:"event"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(env.Payload, &inner); err != nil {
		return env.StreamLogin, -1, false
	}
	if !strings.HasPrefix(inner.Payload.Event.MessageID, "seq-") {
		return env.StreamLogin, -1, false
	}
	var n int
	if _, err := fmt.Sscanf(inner.Payload.Event.MessageID, "seq-%d", &n); err != nil {
		return env.StreamLogin, -1, false
	}
	return env.StreamLogin, n, true
}

// silentLogger returns a logger that drops everything. Useful for tests that
// don't care about log content.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

// captureLogger returns a logger + buffer so tests can assert structured
// log output. Level is Debug so backpressure warnings are visible.
func captureLogger() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	h := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	return slog.New(h), &buf
}

// attachConnWithWrap wires a fakeConn's emit field through aggregator.Wrap so
// the session's FrameOut sees properly-formed envelopes. This mirrors how the
// real handler (internal/api/handler.go) wires the frame hook.
func attachConnWithWrap(sess *Session, streamLogin string, fc *fakeConn, log *slog.Logger) {
	hook := Wrap(streamLogin, func(env []byte) {
		// Non-blocking send mirrors the production hook's backpressure posture.
		select {
		case sess.FrameOut <- env:
		default:
			if log != nil {
				log.Warn("frame.drop.backpressure",
					"sessionId", sess.ID,
					"streamLogin", streamLogin,
				)
			}
		}
	}, log)
	fc.emit = hook
	sess.AttachConn(streamLogin, fc)
}

// Test 1: Fan-in ordering within a single stream must preserve message_id
// order (1, 2, 3, ...) on FrameOut.
func TestSession_FanInOrderingSingleStream(t *testing.T) {
	log := silentLogger()
	const N = 100

	script := make([][]byte, 0, N)
	for i := 0; i < N; i++ {
		script = append(script, buildNotificationFrame("streamer_a", i))
	}

	sess := NewSession(context.Background(), "s1", "u1", []string{"streamer_a"}, log)
	fc := newFakeConn("sess-a", script)
	attachConnWithWrap(sess, "streamer_a", fc, log)

	sess.Start()

	received := make([]int, 0, N)
	timeout := time.After(5 * time.Second)
	for len(received) < N {
		select {
		case env, ok := <-sess.FrameOut:
			if !ok {
				t.Fatalf("FrameOut closed unexpectedly after %d frames", len(received))
			}
			login, seq, ok := extractSeq(env)
			if !ok {
				// Ignore non-notification frames (e.g., upstream_lost envelope
				// if Run returns early). Shouldn't happen here.
				t.Fatalf("failed to extract seq from envelope: %s", string(env))
			}
			if login != "streamer_a" {
				t.Fatalf("unexpected stream_login %q", login)
			}
			received = append(received, seq)
		case <-timeout:
			t.Fatalf("timed out after %d/%d frames", len(received), N)
		}
	}

	for i, got := range received {
		if got != i {
			t.Fatalf("ordering violation at position %d: got seq-%d, want seq-%d", i, got, i)
		}
	}

	sess.Stop()
}

// Test 2: 3 streams × 50 frames each, emitted concurrently. Every envelope
// must carry the correct stream_login tag, and per-stream order must be
// preserved (even though cross-stream interleaving is arbitrary).
func TestSession_FanInOrderingAcrossStreams(t *testing.T) {
	log := silentLogger()
	logins := []string{"streamer_a", "streamer_b", "streamer_c"}
	const perStream = 50
	total := perStream * len(logins)

	sess := newSessionForTest(context.Background(), "s2", "u1", logins, log, 1024)

	for _, login := range logins {
		script := make([][]byte, 0, perStream)
		for i := 0; i < perStream; i++ {
			script = append(script, buildNotificationFrame(login, i))
		}
		fc := newFakeConn("conn-"+login, script)
		attachConnWithWrap(sess, login, fc, log)
	}

	sess.Start()

	perStreamLast := map[string]int{}
	counts := map[string]int{}
	got := 0
	timeout := time.After(5 * time.Second)
	for got < total {
		select {
		case env, ok := <-sess.FrameOut:
			if !ok {
				t.Fatalf("FrameOut closed after %d/%d frames", got, total)
			}
			login, seq, ok := extractSeq(env)
			if !ok {
				t.Fatalf("could not extract seq: %s", string(env))
			}
			last, seen := perStreamLast[login]
			if seen && seq <= last {
				t.Fatalf("ordering violation on %s: got seq-%d after seq-%d", login, seq, last)
			}
			perStreamLast[login] = seq
			counts[login]++
			got++
		case <-timeout:
			t.Fatalf("timed out: got %d/%d frames, counts=%v", got, total, counts)
		}
	}

	for _, login := range logins {
		if counts[login] != perStream {
			t.Fatalf("stream %s got %d frames, want %d", login, counts[login], perStream)
		}
	}

	sess.Stop()
}

// Test 3: Backpressure — small buffer, pump without draining. Session must
// not deadlock; dropped frames must be logged as frame.drop.backpressure.
func TestSession_BackpressureDropsOnFullBuffer(t *testing.T) {
	log, buf := captureLogger()

	const bufSize = 4
	const frames = 100

	script := make([][]byte, 0, frames)
	for i := 0; i < frames; i++ {
		script = append(script, buildNotificationFrame("streamer_a", i))
	}

	sess := newSessionForTest(context.Background(), "s3", "u1", []string{"streamer_a"}, log, bufSize)
	fc := newFakeConn("conn-a", script)
	attachConnWithWrap(sess, "streamer_a", fc, log)

	sess.Start()

	// Give the runner a moment to overflow the buffer. Because we never read
	// from FrameOut, only the first `bufSize` frames land; the rest are
	// dropped with a log line. The runner must not deadlock waiting to write.
	runnerDone := make(chan struct{})
	go func() {
		// When the script ends, fakeConn.Run blocks until Close. We just
		// wait a short bounded time — long enough for the runner to have
		// attempted every write (and dropped the overflow) but short enough
		// that a real deadlock would still fall through to the outer
		// timeout check below.
		time.Sleep(200 * time.Millisecond)
		close(runnerDone)
	}()

	select {
	case <-runnerDone:
	case <-time.After(2 * time.Second):
		t.Fatal("runner did not make progress within 2s — possible deadlock")
	}

	// Drain whatever made it through so Stop can close FrameOut cleanly.
	drained := 0
drainLoop:
	for {
		select {
		case env, ok := <-sess.FrameOut:
			if !ok {
				break drainLoop
			}
			_, _, okParse := extractSeq(env)
			if !okParse {
				// Non-notification (e.g., upstream_lost) — count it but don't parse.
			}
			drained++
		case <-time.After(100 * time.Millisecond):
			break drainLoop
		}
	}
	if drained < 1 || drained > frames {
		t.Fatalf("drained %d frames, want 1..%d", drained, frames)
	}

	// Stop to ensure no goroutine is wedged. Must return promptly.
	stopDone := make(chan struct{})
	go func() {
		sess.Stop()
		close(stopDone)
	}()
	select {
	case <-stopDone:
	case <-time.After(3 * time.Second):
		t.Fatal("Stop() did not return within 3s — runner deadlocked")
	}

	// At least one backpressure log line should have been emitted.
	if !strings.Contains(buf.String(), "frame.drop.backpressure") {
		t.Fatalf("expected frame.drop.backpressure log, got:\n%s", buf.String())
	}
}

// Test 4: Cancelling the parent context tears down all runners, closes
// FrameOut, and leaves no stray goroutines. Subsequent Stop() is a no-op.
func TestSession_CleanTeardownOnContextCancel(t *testing.T) {
	log := silentLogger()

	baseGoroutines := runtime.NumGoroutine()

	parentCtx, parentCancel := context.WithCancel(context.Background())
	logins := []string{"streamer_a", "streamer_b"}
	sess := NewSession(parentCtx, "s4", "u1", logins, log)

	for _, login := range logins {
		// Script with a handful of frames; runner blocks afterwards.
		script := [][]byte{
			buildNotificationFrame(login, 0),
			buildNotificationFrame(login, 1),
		}
		fc := newFakeConn("conn-"+login, script)
		attachConnWithWrap(sess, login, fc, log)
	}

	sess.Start()

	// Drain a couple of frames so we know the runners are live.
	for i := 0; i < 2; i++ {
		select {
		case <-sess.FrameOut:
		case <-time.After(1 * time.Second):
			t.Fatalf("no frame delivered by iter %d", i)
		}
	}

	// Cancel parent — Session.Stop is NOT invoked from cancel alone; the
	// runner goroutines exit, but FrameOut stays open until Stop runs. Call
	// Stop to complete teardown (spec allows parent-cancel to propagate; in
	// practice the handler layer calls Stop from DELETE /session or on ws
	// close).
	parentCancel()

	stopDone := make(chan struct{})
	go func() {
		sess.Stop()
		close(stopDone)
	}()
	select {
	case <-stopDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop() did not return within 2s after ctx cancel")
	}

	// Drain any leftover envelopes and verify FrameOut closes.
	closed := false
	deadline := time.After(1 * time.Second)
drain:
	for {
		select {
		case _, ok := <-sess.FrameOut:
			if !ok {
				closed = true
				break drain
			}
		case <-deadline:
			break drain
		}
	}
	if !closed {
		t.Fatal("FrameOut was not closed after Stop()")
	}

	// Second Stop must be a no-op (not panic/deadlock).
	sess.Stop()

	// Give the runtime a beat to reap exiting goroutines.
	time.Sleep(100 * time.Millisecond)

	// Allow some tolerance — slog/gin internals may retain worker goroutines
	// across tests in the same binary. We check for a hard leak, not a
	// perfect baseline match.
	finalGoroutines := runtime.NumGoroutine()
	if finalGoroutines > baseGoroutines+3 {
		t.Fatalf("goroutine leak: baseline=%d final=%d", baseGoroutines, finalGoroutines)
	}
}

// Test 5: When a Conn's Run returns ErrUpstreamLost, Session emits an
// upstream_lost envelope on FrameOut.
func TestSession_UpstreamLostEnvelopeEmitted(t *testing.T) {
	log := silentLogger()

	fc := newFakeConn("conn-a", nil) // empty script — Run returns immediately
	fc.runErr = ErrUpstreamLost

	sess := NewSession(context.Background(), "s5", "u1", []string{"streamer_a"}, log)
	attachConnWithWrap(sess, "streamer_a", fc, log)

	sess.Start()

	select {
	case env, ok := <-sess.FrameOut:
		if !ok {
			t.Fatal("FrameOut closed before receiving upstream_lost envelope")
		}
		expected := UpstreamLostEnvelope("streamer_a")
		if !bytes.Equal(env, expected) {
			t.Fatalf("envelope mismatch:\n got: %s\nwant: %s", string(env), string(expected))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive upstream_lost envelope within 2s")
	}

	sess.Stop()
}
