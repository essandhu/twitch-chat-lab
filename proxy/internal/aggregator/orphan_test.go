package aggregator

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// Orphan reaper: StartOrphanTimer fires onExpire if TryAcquireWS is never
// called before the deadline.
func TestSession_OrphanTimerFiresWhenWSNeverAcquired(t *testing.T) {
	log := silentLogger()
	sess := NewSession(context.Background(), "s-orphan-1", "u", []string{"alice"}, log)

	var fired atomic.Bool
	sess.StartOrphanTimer(20*time.Millisecond, func() {
		fired.Store(true)
	})

	// Give the timer time to fire.
	time.Sleep(100 * time.Millisecond)
	if !fired.Load() {
		t.Fatal("orphan timer did not fire")
	}
	// Subsequent acquire must be refused — session is considered reaped.
	if sess.TryAcquireWS() {
		t.Fatal("TryAcquireWS should return false after reaper fired")
	}
	sess.Stop()
}

// TryAcquireWS before the timer fires cancels the reaper so onExpire never
// runs.
func TestSession_OrphanTimerCancelledByTryAcquireWS(t *testing.T) {
	log := silentLogger()
	sess := NewSession(context.Background(), "s-orphan-2", "u", []string{"alice"}, log)

	var fired atomic.Bool
	sess.StartOrphanTimer(50*time.Millisecond, func() {
		fired.Store(true)
	})

	if !sess.TryAcquireWS() {
		t.Fatal("TryAcquireWS should succeed before reaper fires")
	}

	// Wait past the original deadline; timer must have been cancelled.
	time.Sleep(150 * time.Millisecond)
	if fired.Load() {
		t.Fatal("orphan timer fired despite TryAcquireWS")
	}
	sess.Stop()
}

// Stop cancels a pending timer so onExpire never runs.
func TestSession_OrphanTimerCancelledByStop(t *testing.T) {
	log := silentLogger()
	sess := NewSession(context.Background(), "s-orphan-3", "u", []string{"alice"}, log)

	var fired atomic.Bool
	sess.StartOrphanTimer(50*time.Millisecond, func() {
		fired.Store(true)
	})
	sess.Stop()

	time.Sleep(150 * time.Millisecond)
	if fired.Load() {
		t.Fatal("orphan timer fired after Stop")
	}
}

// StartOrphanTimer is safe to call on a stopped session — it must no-op
// rather than leak a timer goroutine.
func TestSession_StartOrphanTimer_AfterStopIsNoOp(t *testing.T) {
	log := silentLogger()
	sess := NewSession(context.Background(), "s-orphan-4", "u", []string{"alice"}, log)
	sess.Stop()

	var fired atomic.Bool
	sess.StartOrphanTimer(20*time.Millisecond, func() {
		fired.Store(true)
	})
	time.Sleep(80 * time.Millisecond)
	if fired.Load() {
		t.Fatal("orphan timer should not fire after Stop")
	}
}
