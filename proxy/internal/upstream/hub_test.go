package upstream

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
)

// fakeConn implements upstreamConn. Run blocks until either the supplied
// ctx cancels, Close is called, or SimulateUpstreamLost closes the lost
// channel — in which case Run returns eventsub.ErrUpstreamLost so the pool
// fans out the sentinel to subscribers.
type fakeConn struct {
	id string

	mu     sync.Mutex
	closed bool

	closeCh chan struct{}
	lostCh  chan struct{}
}

func newFakeConn(id string) *fakeConn {
	return &fakeConn{id: id, closeCh: make(chan struct{}), lostCh: make(chan struct{})}
}

func (f *fakeConn) SessionID() string { return f.id }

func (f *fakeConn) Run(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return nil
	case <-f.closeCh:
		return nil
	case <-f.lostCh:
		return eventsub.ErrUpstreamLost
	}
}

func (f *fakeConn) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil
	}
	f.closed = true
	close(f.closeCh)
	return nil
}

func (f *fakeConn) SimulateUpstreamLost() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return
	}
	f.closed = true
	close(f.lostCh)
}

// manualTimer is a stoppableTimer that never auto-fires. Tests drive it via
// Fire() to observe drain behavior deterministically.
type manualTimer struct {
	fn      func()
	stopped atomic.Bool
}

func (m *manualTimer) Stop() bool {
	if m.stopped.Swap(true) {
		return false
	}
	return true
}

func (m *manualTimer) Fire() {
	if m.stopped.Load() {
		return
	}
	m.fn()
}

// hubFixture bundles a Hub wired with test seams plus the handles tests
// need to poke at the upstream connection.
type hubFixture struct {
	hub   *Hub
	conns []*fakeConn

	openCount     atomic.Int32
	registerCount atomic.Int32
	unsubCount    atomic.Int32
	unsubIDs      []string

	timersMu sync.Mutex
	timers   []*manualTimer

	openErr error
	regErr  error

	mu sync.Mutex
}

func newHubFixture(t *testing.T) *hubFixture {
	t.Helper()
	f := &hubFixture{}
	log := slog.New(slog.NewJSONHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
	h := NewHub(HubConfig{
		Logger:     log,
		HTTPClient: http.DefaultClient,
		ClientID:   "client-test",
		DrainGrace: 50 * time.Millisecond,
	})
	h.openFn = func(ctx context.Context, params eventsub.OpenParams) (upstreamConn, error) {
		f.openCount.Add(1)
		if f.openErr != nil {
			return nil, f.openErr
		}
		c := newFakeConn(params.StreamLogin + "-session")
		f.mu.Lock()
		f.conns = append(f.conns, c)
		f.mu.Unlock()
		return c, nil
	}
	h.registerFn = func(ctx context.Context, args eventsub.RegisterArgs) (eventsub.RegisterResult, error) {
		if f.regErr != nil {
			return eventsub.RegisterResult{}, f.regErr
		}
		f.registerCount.Add(1)
		return eventsub.RegisterResult{
			Registered: []eventsub.Registered{
				{Type: "channel.chat.message", SubscriptionID: "sub-" + args.StreamLogin},
			},
		}, nil
	}
	h.unsubscribeFn = func(ctx context.Context, httpClient *http.Client, helixBaseURL, clientID, accessToken string, subIDs []string) error {
		f.mu.Lock()
		f.unsubIDs = append(f.unsubIDs, subIDs...)
		f.mu.Unlock()
		f.unsubCount.Add(1)
		return nil
	}
	h.newTimer = func(d time.Duration, fn func()) stoppableTimer {
		t := &manualTimer{fn: fn}
		f.timersMu.Lock()
		f.timers = append(f.timers, t)
		f.timersMu.Unlock()
		return t
	}
	f.hub = h
	return f
}

func (f *hubFixture) latestTimer() *manualTimer {
	f.timersMu.Lock()
	defer f.timersMu.Unlock()
	if len(f.timers) == 0 {
		return nil
	}
	return f.timers[len(f.timers)-1]
}

// waitCond polls cond() until true or deadline reached. Returns whether cond
// became true before timeout. Kept local so tests don't drag a third-party
// eventually-library in.
func waitCond(timeout time.Duration, cond func() bool) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(2 * time.Millisecond)
	}
	return cond()
}

// dispatchFromConn finds the pool that owns conn and dispatches raw to it.
// Exists because the fakeConn's OnFrame hook is stashed inside Hub, not
// exposed — but tests can reach into the pool directly via the hub's map.
func (f *hubFixture) dispatchFromConn(conn *fakeConn, raw []byte) {
	f.hub.mu.Lock()
	var target *pool
	for _, p := range f.hub.pools {
		if p.conn == conn {
			target = p
			break
		}
	}
	f.hub.mu.Unlock()
	if target != nil {
		target.dispatch(raw)
	}
}

func baseParams(login, userID string) SubscribeParams {
	return SubscribeParams{
		StreamLogin:   login,
		UserID:        userID,
		BroadcasterID: "b-" + login,
		AccessToken:   "tok-" + userID,
	}
}

// Test: two subscribers to the same (login, userID) share one upstream
// connection (openFn called once), and both receive dispatched frames.
func TestHub_Subscribe_SharesUpstreamPerKey(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	var got1, got2 [][]byte
	var mu sync.Mutex

	p1 := baseParams("alice", "u1")
	p1.OnFrame = func(b []byte) { mu.Lock(); got1 = append(got1, b); mu.Unlock() }
	p2 := baseParams("alice", "u1")
	p2.OnFrame = func(b []byte) { mu.Lock(); got2 = append(got2, b); mu.Unlock() }

	s1, err := f.hub.Subscribe(context.Background(), p1)
	if err != nil {
		t.Fatalf("subscribe 1: %v", err)
	}
	s2, err := f.hub.Subscribe(context.Background(), p2)
	if err != nil {
		t.Fatalf("subscribe 2: %v", err)
	}

	if f.openCount.Load() != 1 {
		t.Fatalf("expected 1 open call, got %d", f.openCount.Load())
	}
	if f.registerCount.Load() != 1 {
		t.Fatalf("expected 1 register call, got %d", f.registerCount.Load())
	}

	f.mu.Lock()
	conn := f.conns[0]
	f.mu.Unlock()
	f.dispatchFromConn(conn, []byte("frame-a"))
	f.dispatchFromConn(conn, []byte("frame-b"))

	mu.Lock()
	if len(got1) != 2 || len(got2) != 2 {
		mu.Unlock()
		t.Fatalf("fan-out mismatch: got1=%d got2=%d", len(got1), len(got2))
	}
	mu.Unlock()

	_ = s1.Close()
	_ = s2.Close()
}

// Test: different user_ids for the same stream get separate pools.
func TestHub_Subscribe_DifferentUserIDsAreSeparatePools(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	p1 := baseParams("alice", "u1")
	p1.OnFrame = func([]byte) {}
	p2 := baseParams("alice", "u2")
	p2.OnFrame = func([]byte) {}

	if _, err := f.hub.Subscribe(context.Background(), p1); err != nil {
		t.Fatalf("subscribe 1: %v", err)
	}
	if _, err := f.hub.Subscribe(context.Background(), p2); err != nil {
		t.Fatalf("subscribe 2: %v", err)
	}
	if f.openCount.Load() != 2 {
		t.Fatalf("expected 2 opens (separate user_ids), got %d", f.openCount.Load())
	}
}

// Test: drain grace — last Close starts the timer; firing it tears the
// upstream down and revokes helix subscriptions.
func TestHub_Subscribe_DrainTearsDownUpstream(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	p := baseParams("alice", "u1")
	p.OnFrame = func([]byte) {}

	sub, err := f.hub.Subscribe(context.Background(), p)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	// No drain timer before Close — sanity.
	if f.latestTimer() != nil {
		t.Fatalf("unexpected drain timer before Close")
	}
	_ = sub.Close()

	tim := f.latestTimer()
	if tim == nil {
		t.Fatalf("expected drain timer after last Close")
	}

	// Fire the timer synchronously — pool should tear down.
	tim.Fire()

	if !waitCond(1*time.Second, func() bool { return f.unsubCount.Load() == 1 }) {
		t.Fatalf("unsubscribe never called after drain (got %d)", f.unsubCount.Load())
	}
	if !waitCond(1*time.Second, func() bool {
		f.hub.mu.Lock()
		defer f.hub.mu.Unlock()
		return len(f.hub.pools) == 0
	}) {
		t.Fatalf("pool still registered after drain")
	}
}

// Test: a new Subscribe during the drain grace cancels the timer and
// re-uses the existing pool (no second open).
func TestHub_Subscribe_DuringDrainReusesPool(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	p := baseParams("alice", "u1")
	p.OnFrame = func([]byte) {}

	sub, err := f.hub.Subscribe(context.Background(), p)
	if err != nil {
		t.Fatalf("subscribe 1: %v", err)
	}
	_ = sub.Close()

	tim := f.latestTimer()
	if tim == nil {
		t.Fatalf("expected drain timer after Close")
	}

	// New subscriber arrives before the timer fires.
	sub2, err := f.hub.Subscribe(context.Background(), p)
	if err != nil {
		t.Fatalf("subscribe 2: %v", err)
	}
	defer sub2.Close()

	if f.openCount.Load() != 1 {
		t.Fatalf("expected pool reuse (1 open), got %d", f.openCount.Load())
	}
	// Firing the (now-stopped) timer must be a no-op.
	tim.Fire()
	if f.unsubCount.Load() != 0 {
		t.Fatalf("drain should have been cancelled — unsubscribe count = %d", f.unsubCount.Load())
	}
}

// Test: when the upstream reports lost, every subscriber's Run returns
// ErrUpstreamLost and OnUpstreamLost hooks fire.
func TestHub_Subscribe_UpstreamLostFansOut(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	var lost1, lost2 atomic.Bool

	p1 := baseParams("alice", "u1")
	p1.OnFrame = func([]byte) {}
	p1.OnUpstreamLost = func() { lost1.Store(true) }
	p2 := baseParams("alice", "u1")
	p2.OnFrame = func([]byte) {}
	p2.OnUpstreamLost = func() { lost2.Store(true) }

	s1, err := f.hub.Subscribe(context.Background(), p1)
	if err != nil {
		t.Fatalf("subscribe 1: %v", err)
	}
	s2, err := f.hub.Subscribe(context.Background(), p2)
	if err != nil {
		t.Fatalf("subscribe 2: %v", err)
	}

	f.mu.Lock()
	conn := f.conns[0]
	f.mu.Unlock()
	conn.SimulateUpstreamLost()

	// Each subscriber's Run should surface ErrUpstreamLost.
	runDone := make(chan error, 2)
	go func() { runDone <- s1.Run(context.Background()) }()
	go func() { runDone <- s2.Run(context.Background()) }()
	for i := 0; i < 2; i++ {
		select {
		case err := <-runDone:
			if !errors.Is(err, ErrUpstreamLost) {
				t.Fatalf("expected ErrUpstreamLost, got %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("Run did not return after upstream lost (iteration %d)", i)
		}
	}

	if !lost1.Load() || !lost2.Load() {
		t.Fatalf("OnUpstreamLost not fired: lost1=%v lost2=%v", lost1.Load(), lost2.Load())
	}
}

// Test: Subscribe failures (open error) clean up the pool so the next call
// retries from scratch.
func TestHub_Subscribe_OpenFailureRetriesCleanly(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	f.openErr = errors.New("dial failed")

	p := baseParams("alice", "u1")
	p.OnFrame = func([]byte) {}

	if _, err := f.hub.Subscribe(context.Background(), p); err == nil {
		t.Fatalf("expected error from failed open")
	}
	// Pool must be gone so a fresh attempt tries to open again.
	f.hub.mu.Lock()
	pools := len(f.hub.pools)
	f.hub.mu.Unlock()
	if pools != 0 {
		t.Fatalf("expected 0 pools after failed open, got %d", pools)
	}

	f.openErr = nil
	if _, err := f.hub.Subscribe(context.Background(), p); err != nil {
		t.Fatalf("retry after failure: %v", err)
	}
	if f.openCount.Load() != 2 {
		t.Fatalf("expected 2 open attempts, got %d", f.openCount.Load())
	}
}

// Test: concurrent Subscribe calls for the same key serialize on pool init
// — exactly one open + register regardless of caller count.
func TestHub_Subscribe_ConcurrentSameKeyOpensOnce(t *testing.T) {
	f := newHubFixture(t)
	defer f.hub.Shutdown()

	const N = 8
	var wg sync.WaitGroup
	errs := make(chan error, N)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p := baseParams("alice", "u1")
			p.OnFrame = func([]byte) {}
			_, err := f.hub.Subscribe(context.Background(), p)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent subscribe: %v", err)
		}
	}
	if f.openCount.Load() != 1 {
		t.Fatalf("expected 1 open for concurrent same-key, got %d", f.openCount.Load())
	}
	if f.registerCount.Load() != 1 {
		t.Fatalf("expected 1 register for concurrent same-key, got %d", f.registerCount.Load())
	}
}
