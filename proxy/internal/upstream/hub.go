// Package upstream owns the proxy's pool of EventSub WebSocket connections
// and fans each upstream frame out to every downstream session subscribed to
// the same (stream_login, user_id) key.
//
// Motivation: Twitch caps each user account to 3 simultaneous EventSub
// WebSocket transports. The demo runs every visitor's session under the same
// demo user, so one WS per visitor per channel burns the quota immediately.
// Sharing one upstream across N downstream sessions keeps us under the cap
// even with many concurrent viewers.
//
// Lifecycle: Hub.Subscribe either joins an existing pool (bumping refcount)
// or constructs a new one (Open + Register). When the last subscriber of a
// pool Closes, a drain-grace timer starts; if no new subscriber arrives
// before it fires, the upstream connection is torn down and Helix
// subscriptions are revoked. Upstream-lost (reconnect exhausted) fans out
// to every subscriber and drops the pool.
package upstream

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
)

// DefaultDrainGrace is the default interval a pool lingers after its last
// subscriber leaves. Long enough that a browser tab reload (typical ~1s)
// does not churn the upstream connection; short enough that an abandoned
// session returns its WS transport slot promptly.
const DefaultDrainGrace = 30 * time.Second

// unsubscribeTimeout bounds the best-effort revoke call emitted after a
// pool tears down. Twitch's /eventsub/subscriptions DELETE is usually fast
// but we don't want a hung teardown to wedge goroutine cleanup.
const unsubscribeTimeout = 5 * time.Second

// ErrUpstreamLost mirrors the eventsub sentinel so downstream packages can
// compare without importing eventsub.
var ErrUpstreamLost = eventsub.ErrUpstreamLost

// SubscribeParams is the complete input bundle for Hub.Subscribe. Every
// field is required (the zero value is not meaningful for any of them).
type SubscribeParams struct {
	StreamLogin    string
	UserID         string
	BroadcasterID  string
	AccessToken    string
	OnFrame        func(raw []byte)
	OnUpstreamLost func()
}

// Subscription is the handle returned by Hub.Subscribe. Its Run/Close/
// SessionID methods are shaped to satisfy aggregator.Conn so sessions can
// drop the subscription in place of a dedicated upstream connection.
type Subscription struct {
	pool *pool
	id   uint64

	onFrame        func([]byte)
	onUpstreamLost func()

	closeCh chan struct{}
	lostCh  chan struct{}

	closeOnce sync.Once
	lostOnce  sync.Once
}

// SessionID returns the upstream EventSub session id of the shared pool.
// Primarily useful for structured logging; returns an empty string after
// the pool has torn down.
func (s *Subscription) SessionID() string {
	return s.pool.sessionID()
}

// Run blocks until Close is called (returns nil) or the upstream pool
// signals that its connection is permanently lost (returns ErrUpstreamLost).
// Context cancellation is treated as a clean exit.
func (s *Subscription) Run(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return nil
	case <-s.closeCh:
		return nil
	case <-s.lostCh:
		return ErrUpstreamLost
	}
}

// Close unregisters the subscription from its pool. Safe to call multiple
// times and concurrently with Run. If this was the pool's last subscriber,
// the pool schedules its drain-grace teardown.
func (s *Subscription) Close() error {
	s.closeOnce.Do(func() {
		s.pool.removeSubscriber(s.id)
		close(s.closeCh)
	})
	return nil
}

// signalLost is invoked by the pool when the upstream connection is lost
// beyond recovery.
func (s *Subscription) signalLost() {
	s.lostOnce.Do(func() {
		close(s.lostCh)
	})
	if s.onUpstreamLost != nil {
		s.onUpstreamLost()
	}
}

// poolKey is the (stream_login, user_id) tuple that groups subscribers.
// user_id is included because real users hold their own per-user WS quota
// — pooling across user_ids would break that per-user auth boundary.
type poolKey struct {
	StreamLogin string
	UserID      string
}

// Hub is the process-wide registry of shared upstream pools.
type Hub struct {
	helixBaseURL string
	eventSubURL  string
	clientID     string
	httpClient   *http.Client
	logger       *slog.Logger
	drainGrace   time.Duration

	// Seams — only overridden by tests.
	openFn        func(ctx context.Context, params eventsub.OpenParams) (upstreamConn, error)
	registerFn    func(ctx context.Context, args eventsub.RegisterArgs) (eventsub.RegisterResult, error)
	unsubscribeFn func(ctx context.Context, httpClient *http.Client, helixBaseURL, clientID, accessToken string, subIDs []string) error
	newTimer      func(d time.Duration, f func()) stoppableTimer

	mu    sync.Mutex
	pools map[poolKey]*pool
}

// HubConfig collects the production-configurable Hub dependencies. URLs
// default to the canonical Twitch endpoints when empty.
type HubConfig struct {
	HelixBaseURL string
	EventSubURL  string
	ClientID     string
	HTTPClient   *http.Client
	Logger       *slog.Logger
	DrainGrace   time.Duration
}

// NewHub builds a production Hub wired to live eventsub.Open + Register +
// Unsubscribe.
func NewHub(cfg HubConfig) *Hub {
	h := &Hub{
		helixBaseURL: cfg.HelixBaseURL,
		eventSubURL:  cfg.EventSubURL,
		clientID:     cfg.ClientID,
		httpClient:   cfg.HTTPClient,
		logger:       cfg.Logger,
		drainGrace:   cfg.DrainGrace,
		pools:        make(map[poolKey]*pool),
	}
	if h.drainGrace <= 0 {
		h.drainGrace = DefaultDrainGrace
	}
	if h.httpClient == nil {
		h.httpClient = http.DefaultClient
	}
	h.openFn = func(ctx context.Context, params eventsub.OpenParams) (upstreamConn, error) {
		c, err := eventsub.Open(ctx, params)
		if err != nil {
			return nil, err
		}
		return c, nil
	}
	h.registerFn = eventsub.Register
	h.unsubscribeFn = eventsub.Unsubscribe
	h.newTimer = func(d time.Duration, f func()) stoppableTimer {
		return realTimer{t: time.AfterFunc(d, f)}
	}
	return h
}

// Subscribe registers a subscriber for (params.StreamLogin, params.UserID).
// If no pool exists for that key, Subscribe opens a fresh EventSub
// connection and registers subscriptions; otherwise it joins the existing
// pool.
func (h *Hub) Subscribe(ctx context.Context, params SubscribeParams) (*Subscription, error) {
	if params.StreamLogin == "" || params.UserID == "" || params.BroadcasterID == "" {
		return nil, errors.New("upstream: SubscribeParams missing required field")
	}
	if params.OnFrame == nil {
		return nil, errors.New("upstream: SubscribeParams.OnFrame is required")
	}

	key := poolKey{StreamLogin: params.StreamLogin, UserID: params.UserID}

	for {
		h.mu.Lock()
		p, existing := h.pools[key]
		if !existing {
			p = newPool(h, key)
			h.pools[key] = p
		}
		h.mu.Unlock()

		if !existing {
			initErr := p.init(ctx, params)
			p.initErr = initErr
			close(p.ready)
			if initErr != nil {
				h.mu.Lock()
				if h.pools[key] == p {
					delete(h.pools, key)
				}
				h.mu.Unlock()
				return nil, initErr
			}
		} else {
			select {
			case <-p.ready:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			if p.initErr != nil {
				continue
			}
		}

		sub, attached := p.addSubscriber(params)
		if !attached {
			// Pool was torn down between ready and addSubscriber. Drop the
			// stale map entry and retry.
			h.mu.Lock()
			if h.pools[key] == p {
				delete(h.pools, key)
			}
			h.mu.Unlock()
			continue
		}
		return sub, nil
	}
}

// Shutdown tears every pool down synchronously. Intended for process exit.
// Does not emit upstream_lost — subscribers see a clean Run return (nil).
func (h *Hub) Shutdown() {
	h.mu.Lock()
	pools := make([]*pool, 0, len(h.pools))
	for _, p := range h.pools {
		pools = append(pools, p)
	}
	h.pools = make(map[poolKey]*pool)
	h.mu.Unlock()

	var wg sync.WaitGroup
	for _, p := range pools {
		wg.Add(1)
		go func(p *pool) {
			defer wg.Done()
			p.cleanShutdown()
		}(p)
	}
	wg.Wait()
}

// removePool drops the pool from the hub's map if (and only if) the map
// still points at this exact pool.
func (h *Hub) removePool(p *pool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.pools[p.key] == p {
		delete(h.pools, p.key)
	}
}

// pool holds exactly one upstream EventSub connection along with the set
// of downstream subscribers fanning off it.
type pool struct {
	hub *Hub
	key poolKey

	ready   chan struct{}
	initErr error

	// Owned by runLoop after init; read-only elsewhere.
	conn          upstreamConn
	helixSubIDs   []string
	accessToken   string
	broadcasterID string
	runCancel     context.CancelFunc

	mu          sync.RWMutex
	subscribers map[uint64]*Subscription
	nextSubID   uint64
	tornDown    bool
	drainTimer  stoppableTimer
}

// upstreamConn is the subset of *eventsub.Connection the pool needs. Narrow
// interface makes Hub tests easy to fake without a real websocket.
type upstreamConn interface {
	SessionID() string
	Run(ctx context.Context) error
	Close() error
}

// stoppableTimer abstracts time.Timer so tests can install a
// synchronously-controllable fake. Only Stop is needed; firing is done via
// the AfterFunc callback passed at construction.
type stoppableTimer interface {
	Stop() bool
}

// realTimer adapts *time.Timer.
type realTimer struct{ t *time.Timer }

func (r realTimer) Stop() bool { return r.t.Stop() }

// newPool returns an un-initialized pool. init must be called exactly once
// before any subscriber is attached.
func newPool(h *Hub, key poolKey) *pool {
	return &pool{
		hub:         h,
		key:         key,
		ready:       make(chan struct{}),
		subscribers: make(map[uint64]*Subscription),
	}
}

// sessionID returns the upstream EventSub session id (or "" post-teardown).
func (p *pool) sessionID() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.conn == nil {
		return ""
	}
	return p.conn.SessionID()
}

// init opens the upstream connection, registers Helix subscriptions, and
// spawns the run-loop goroutine. Returns an error if any step fails.
func (p *pool) init(ctx context.Context, params SubscribeParams) error {
	frameHook := func(raw []byte) {
		p.dispatch(raw)
	}

	openParams := eventsub.OpenParams{
		URL:         p.hub.eventSubURL,
		StreamLogin: params.StreamLogin,
		OnFrame:     frameHook,
		Logger:      p.hub.logger,
	}
	conn, err := p.hub.openFn(ctx, openParams)
	if err != nil {
		return fmt.Errorf("upstream open %s: %w", params.StreamLogin, err)
	}

	regRes, err := p.hub.registerFn(ctx, eventsub.RegisterArgs{
		HTTPClient:    p.hub.httpClient,
		HelixBaseURL:  p.hub.helixBaseURL,
		ClientID:      p.hub.clientID,
		AccessToken:   params.AccessToken,
		SessionID:     conn.SessionID(),
		BroadcasterID: params.BroadcasterID,
		UserID:        params.UserID,
		StreamLogin:   params.StreamLogin,
		Logger:        p.hub.logger,
	})
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("upstream register %s: %w", params.StreamLogin, err)
	}

	subIDs := make([]string, 0, len(regRes.Registered))
	for _, reg := range regRes.Registered {
		subIDs = append(subIDs, reg.SubscriptionID)
	}

	runCtx, cancel := context.WithCancel(context.Background())
	p.mu.Lock()
	p.conn = conn
	p.helixSubIDs = subIDs
	p.accessToken = params.AccessToken
	p.broadcasterID = params.BroadcasterID
	p.runCancel = cancel
	p.mu.Unlock()

	go p.runLoop(runCtx)

	if p.hub.logger != nil {
		p.hub.logger.Info("upstream.pool.open",
			"streamLogin", p.key.StreamLogin,
			"userId", p.key.UserID,
			"sessionId", conn.SessionID(),
			"helixSubs", len(subIDs),
		)
	}
	return nil
}

// dispatch fans a raw upstream frame out to every current subscriber. Holds
// the pool's read lock so a concurrent Close cannot delete a subscriber
// mid-dispatch (a delete would wait for the RLock to drop).
func (p *pool) dispatch(raw []byte) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, s := range p.subscribers {
		if s.onFrame != nil {
			s.onFrame(raw)
		}
	}
}

// addSubscriber registers a new subscriber. Returns (nil, false) if the
// pool has already been torn down between Subscribe's ready-wait and here
// — the caller retries with a fresh pool.
func (p *pool) addSubscriber(params SubscribeParams) (*Subscription, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.tornDown {
		return nil, false
	}
	if p.drainTimer != nil {
		p.drainTimer.Stop()
		p.drainTimer = nil
	}
	p.nextSubID++
	sub := &Subscription{
		pool:           p,
		id:             p.nextSubID,
		onFrame:        params.OnFrame,
		onUpstreamLost: params.OnUpstreamLost,
		closeCh:        make(chan struct{}),
		lostCh:         make(chan struct{}),
	}
	p.subscribers[sub.id] = sub
	return sub, true
}

// removeSubscriber is called by Subscription.Close. Starts a drain-grace
// timer when the last subscriber departs; if fired, the timer triggers
// pool teardown.
func (p *pool) removeSubscriber(id uint64) {
	p.mu.Lock()
	if _, ok := p.subscribers[id]; !ok {
		p.mu.Unlock()
		return
	}
	delete(p.subscribers, id)
	remaining := len(p.subscribers)
	if remaining == 0 && !p.tornDown && p.drainTimer == nil {
		p.drainTimer = p.hub.newTimer(p.hub.drainGrace, p.onDrainExpire)
	}
	p.mu.Unlock()
}

// onDrainExpire runs (off the timer goroutine) when the drain grace elapses
// with no new subscriber. If the pool is still subscriber-free, tear down.
func (p *pool) onDrainExpire() {
	p.mu.Lock()
	if p.tornDown || len(p.subscribers) > 0 {
		p.drainTimer = nil
		p.mu.Unlock()
		return
	}
	p.drainTimer = nil
	p.tornDown = true
	p.mu.Unlock()

	if p.hub.logger != nil {
		p.hub.logger.Info("upstream.pool.drain",
			"streamLogin", p.key.StreamLogin,
			"userId", p.key.UserID,
		)
	}
	p.hub.removePool(p)
	if p.runCancel != nil {
		p.runCancel()
	}
	// runLoop will observe cancel, emit upstream.pool.run.exit, and call
	// unsubscribe. Nothing more to do here.
}

// cleanShutdown is called from Hub.Shutdown. Cancels run (no upstream_lost
// fan-out) and closes all subscribers so their Run returns nil.
func (p *pool) cleanShutdown() {
	p.mu.Lock()
	if p.tornDown {
		p.mu.Unlock()
		return
	}
	p.tornDown = true
	if p.drainTimer != nil {
		p.drainTimer.Stop()
		p.drainTimer = nil
	}
	subsSnapshot := make([]*Subscription, 0, len(p.subscribers))
	for _, s := range p.subscribers {
		subsSnapshot = append(subsSnapshot, s)
	}
	p.mu.Unlock()

	// Close subscribers first so no more dispatch happens.
	for _, s := range subsSnapshot {
		s.closeOnce.Do(func() { close(s.closeCh) })
	}

	if p.runCancel != nil {
		p.runCancel()
	}
	if p.conn != nil {
		_ = p.conn.Close()
	}
	// runLoop also fires unsubscribe; cleanShutdown does not duplicate it.
}

// runLoop drives Conn.Run on a long-lived context. When Run returns, the
// pool is marked torn-down; an upstream-lost exit fans out to all
// subscribers.
func (p *pool) runLoop(ctx context.Context) {
	err := p.conn.Run(ctx)
	lost := err != nil && errors.Is(err, eventsub.ErrUpstreamLost)

	if p.hub.logger != nil {
		attrs := []any{
			"streamLogin", p.key.StreamLogin,
			"userId", p.key.UserID,
			"lost", lost,
		}
		if err != nil {
			attrs = append(attrs, "error", err.Error())
		}
		p.hub.logger.Info("upstream.pool.run.exit", attrs...)
	}

	p.mu.Lock()
	alreadyTornDown := p.tornDown
	if !alreadyTornDown {
		p.tornDown = true
		if p.drainTimer != nil {
			p.drainTimer.Stop()
			p.drainTimer = nil
		}
	}
	subsSnapshot := make([]*Subscription, 0, len(p.subscribers))
	for _, s := range p.subscribers {
		subsSnapshot = append(subsSnapshot, s)
	}
	p.mu.Unlock()

	if lost {
		for _, s := range subsSnapshot {
			s.signalLost()
		}
	}

	if !alreadyTornDown {
		p.hub.removePool(p)
	}

	if len(p.helixSubIDs) > 0 {
		unsubCtx, cancel := context.WithTimeout(context.Background(), unsubscribeTimeout)
		_ = p.hub.unsubscribeFn(unsubCtx, p.hub.httpClient, p.hub.helixBaseURL, p.hub.clientID, p.accessToken, p.helixSubIDs)
		cancel()
	}
}
