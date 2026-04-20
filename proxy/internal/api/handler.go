package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/eventsub"
	"github.com/erick/twitch-chat-lab/proxy/internal/logger"
	"github.com/erick/twitch-chat-lab/proxy/internal/upstream"
)

// postSessionTimeout bounds the entire POST /session handler — including
// Helix calls + all upstream EventSub welcomes. 10s matches the architecture
// budget in §10 and Twitch's own keepalive default.
const postSessionTimeout = 10 * time.Second

// maxChannelsPerSession caps how many streams a single session may aggregate.
// Chosen to keep per-session goroutine fan-out bounded and match the Phase 4
// spec body validation rules.
const maxChannelsPerSession = 3

// orphanSessionTimeout is how long a newly-created session may sit in the
// registry without a /ws connection before the reaper removes it. This
// protects against clients that POST /session but never follow up with
// /ws/:id (tab closed, nav-away, network blip) — each such orphan would
// otherwise hold its upstream EventSub WS transport slot indefinitely.
// 30s is generous for a post-201 round-trip while short enough that a
// single orphan does not visibly delay the next demo visitor.
const orphanSessionTimeout = 30 * time.Second

// SessionHandlerDeps bundles everything RegisterSessionRoutes needs to mount
// POST /session and DELETE /session/:id. The Subscribe seam lets tests
// inject a fake upstream hub; in production Hub is wired by main.
//
// OpenConn remains as a narrower seam so handler_test can still exercise
// the path without plumbing a full Hub — it takes precedence over Subscribe
// when set, and is the legacy hook from Phase 4. Subscribe is preferred
// for new code because it reflects the real shared-pool semantics.
type SessionHandlerDeps struct {
	Registry     *aggregator.Registry
	Logger       *slog.Logger
	Config       *config.Config
	HTTPClient   *http.Client
	HelixBaseURL string
	ValidateURL  string
	EventSubURL  string
	Hub          *upstream.Hub

	// OpenConn and Subscribe are mutually exclusive test seams. Exactly
	// one is consulted: Subscribe (preferred) if set, else OpenConn, else
	// the default wire-up using Hub. Subscribe returns aggregator.Conn so
	// unit tests can stub with a fake conn without constructing a full
	// upstream.Hub + pool.
	OpenConn  func(ctx context.Context, params eventsub.OpenParams) (aggregator.Conn, error)
	Subscribe func(ctx context.Context, params upstream.SubscribeParams) (aggregator.Conn, error)

	// ReleaseIdlePool is called by DELETE /session and PATCH /session after
	// each removed channel so the pool's Twitch WS transport slot is
	// released immediately instead of after the drain grace. Defaults to
	// Hub.ReleaseIdlePool when Hub is set and this seam is nil. Nil is
	// tolerated in tests that don't care.
	ReleaseIdlePool func(streamLogin, userID string)

	// OrphanTimeout overrides orphanSessionTimeout. Zero falls back to the
	// package default.
	OrphanTimeout time.Duration
}

// sessionRequest is the JSON body accepted by POST /session.
type sessionRequest struct {
	Channels    []string `json:"channels"`
	UserID      string   `json:"user_id"`
	AccessToken string   `json:"access_token"`
}

// patchSessionRequest is the JSON body accepted by PATCH /session/:id. Add
// and Remove are disjoint sets — overlap is rejected at validation. The
// client is expected to compute the diff against its last-known channel
// list before sending.
type patchSessionRequest struct {
	Add         []string `json:"add"`
	Remove      []string `json:"remove"`
	UserID      string   `json:"user_id"`
	AccessToken string   `json:"access_token"`
}

// defaultOpenConn wraps eventsub.Open so SessionHandlerDeps.OpenConn has a
// sensible production default. Returns the *Connection as an aggregator.Conn
// — Connection already satisfies the interface so no adapter is needed.
func defaultOpenConn(ctx context.Context, params eventsub.OpenParams) (aggregator.Conn, error) {
	conn, err := eventsub.Open(ctx, params)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

// RegisterSessionRoutes mounts POST /session and DELETE /session/:id onto
// the provided router. All mutable state is captured via deps so this
// function can be called multiple times during tests without aliasing bugs.
func RegisterSessionRoutes(r gin.IRouter, deps SessionHandlerDeps) {
	if deps.HTTPClient == nil {
		deps.HTTPClient = http.DefaultClient
	}
	if deps.Subscribe == nil && deps.OpenConn == nil && deps.Hub != nil {
		hub := deps.Hub
		deps.Subscribe = func(ctx context.Context, params upstream.SubscribeParams) (aggregator.Conn, error) {
			sub, err := hub.Subscribe(ctx, params)
			if err != nil {
				return nil, err
			}
			return sub, nil
		}
	}
	if deps.Subscribe == nil && deps.OpenConn == nil {
		// Last-ditch fallback: open a fresh dedicated connection per channel.
		// Present so handler_test cases that set neither seam still work, but
		// this path does NOT benefit from the shared-pool quota fix.
		deps.OpenConn = defaultOpenConn
	}
	if deps.ReleaseIdlePool == nil && deps.Hub != nil {
		hub := deps.Hub
		deps.ReleaseIdlePool = func(streamLogin, userID string) {
			hub.ReleaseIdlePool(streamLogin, userID)
		}
	}
	if deps.OrphanTimeout <= 0 {
		deps.OrphanTimeout = orphanSessionTimeout
	}

	r.POST("/session", func(c *gin.Context) {
		handlePostSession(c, deps)
	})
	r.PATCH("/session/:id", func(c *gin.Context) {
		handlePatchSession(c, deps)
	})
	r.DELETE("/session/:id", func(c *gin.Context) {
		handleDeleteSession(c, deps)
	})
}

// handlePostSession validates the request, authenticates the token, resolves
// broadcaster ids, opens one EventSub connection per channel, registers the
// subscriptions, wires the session into the registry, and returns the new
// session id. Any failure past body validation tears down everything opened
// so far so we never leak goroutines or subscriptions.
func handlePostSession(c *gin.Context, deps SessionHandlerDeps) {
	log := logger.WithCorrelation(c.Request.Context(), deps.Logger)

	var req sessionRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "invalid JSON"})
		return
	}
	if n := len(req.Channels); n < 1 || n > maxChannelsPerSession {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "bad_request",
			"message": "channels must contain between 1 and 3 entries",
		})
		return
	}
	for _, ch := range req.Channels {
		if ch == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "bad_request",
				"message": "channels must not contain empty strings",
			})
			return
		}
	}
	if req.UserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "user_id is required"})
		return
	}
	if req.AccessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "access_token is required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), postSessionTimeout)
	defer cancel()

	// Validate token.
	validateResp, err := Validate(ctx, deps.HTTPClient, deps.ValidateURL, req.AccessToken)
	if err != nil {
		if errors.Is(err, ErrInvalidToken) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
			return
		}
		log.Error("session.validate.error", "error", err.Error())
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
		return
	}
	if validateResp.UserID != req.UserID {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id_mismatch"})
		return
	}

	// Resolve logins → broadcaster ids.
	clientID := ""
	if deps.Config != nil {
		clientID = deps.Config.ClientID
	}
	broadcasterIDs, err := GetBroadcasterIDs(ctx, deps.HTTPClient, deps.HelixBaseURL, clientID, req.AccessToken, req.Channels)
	if err != nil {
		var cnf *ChannelNotFoundError
		if errors.As(err, &cnf) {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found", "channel": cnf.Login})
			return
		}
		if errors.Is(err, ErrInvalidToken) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
			return
		}
		log.Error("session.resolve.error", "error", err.Error())
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
		return
	}

	// Build session + wire upstream subscriptions.
	sessionID := uuid.NewString()
	sess := aggregator.NewSession(context.Background(), sessionID, req.UserID, req.Channels, deps.Logger)

	// attached tracks everything we've wired up so far, so a mid-loop
	// failure can tear down cleanly without leaking upstream resources.
	type attached struct {
		conn        aggregator.Conn
		streamLogin string
	}
	var attachedList []attached
	teardown := func() {
		for _, a := range attachedList {
			_ = a.conn.Close()
		}
	}

	for _, login := range req.Channels {
		frameHook := aggregator.Wrap(login, func(env []byte) {
			// Non-blocking send — mirrors runConn's backpressure posture.
			select {
			case sess.FrameOut <- env:
			default:
				if deps.Logger != nil {
					deps.Logger.Warn("frame.drop.backpressure",
						"sessionId", sessionID,
						"streamLogin", login,
					)
				}
			}
		}, deps.Logger)

		var (
			attachedConn aggregator.Conn
			err          error
		)
		switch {
		case deps.Subscribe != nil:
			conn, subErr := deps.Subscribe(ctx, upstream.SubscribeParams{
				StreamLogin:   login,
				UserID:        req.UserID,
				BroadcasterID: broadcasterIDs[login],
				AccessToken:   req.AccessToken,
				OnFrame:       frameHook,
			})
			if subErr != nil {
				err = subErr
			} else {
				attachedConn = conn
			}
		default:
			openParams := eventsub.OpenParams{
				URL:         deps.EventSubURL,
				StreamLogin: login,
				OnFrame:     frameHook,
				Logger:      deps.Logger,
			}
			conn, openErr := deps.OpenConn(ctx, openParams)
			if openErr != nil {
				err = openErr
				break
			}
			if regErr := registerLegacy(ctx, deps, req, login, broadcasterIDs[login], conn, clientID); regErr != nil {
				_ = conn.Close()
				err = regErr
				break
			}
			attachedConn = conn
		}
		if err != nil {
			log.Error("session.subscribe.error",
				"streamLogin", login,
				"error", err.Error(),
			)
			teardown()
			sess.Stop()
			c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
			return
		}
		attachedList = append(attachedList, attached{conn: attachedConn, streamLogin: login})
		sess.AttachConn(login, attachedConn)
	}

	sess.Start()
	deps.Registry.Add(sess)

	// Orphan reaper: if the client never establishes /ws/:id, tear the
	// session down so its upstream subscriptions are released and the
	// Twitch per-user WS transport slot is returned. TryAcquireWS inside
	// the /ws handler cancels this timer atomically.
	registry := deps.Registry
	logger := deps.Logger
	sess.StartOrphanTimer(deps.OrphanTimeout, func() {
		registry.Remove(sessionID)
		if logger != nil {
			logger.Warn("session.orphaned",
				"sessionId", sessionID,
				"timeoutSec", int(deps.OrphanTimeout.Seconds()),
			)
		}
	})

	log.Info("session.create",
		"sessionId", sessionID,
		"userId", req.UserID,
		"streamLogins", req.Channels,
	)
	c.JSON(http.StatusCreated, gin.H{"session_id": sessionID})
}

// handlePatchSession mutates an existing session's channel set in place,
// avoiding a full recreate. The client sends disjoint add/remove lists
// (diff of old vs new selection) and we:
//
//  1. validate the body + token and enforce the final channel count ≤ max
//  2. process removes FIRST (DetachConn + ReleaseIdlePool) so Twitch WS
//     transport slots are freed before we claim new ones — otherwise a
//     swap (remove 1, add 1) from a 3-channel session would transiently
//     need 4 transports and 429
//  3. resolve broadcaster ids for the adds and subscribe each
//  4. on any subscribe failure, roll back the adds we succeeded at and
//     return 502 — the removes are left applied (they already succeeded
//     and re-subscribing them from here could race the still-draining
//     upstream in ways that multiply failure modes). The client is
//     expected to fall back to a full recreate on 502.
func handlePatchSession(c *gin.Context, deps SessionHandlerDeps) {
	log := logger.WithCorrelation(c.Request.Context(), deps.Logger)

	id := c.Param("id")
	sess, ok := deps.Registry.Get(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session_not_found"})
		return
	}

	var req patchSessionRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "invalid JSON"})
		return
	}
	if req.UserID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "user_id is required"})
		return
	}
	if req.AccessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "access_token is required"})
		return
	}
	if req.UserID != sess.UserID {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id_mismatch"})
		return
	}
	// Reject empty + overlap + empty-string entries up front.
	if len(req.Add) == 0 && len(req.Remove) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "add and remove are both empty"})
		return
	}
	addSet := make(map[string]struct{}, len(req.Add))
	for _, l := range req.Add {
		if l == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "add must not contain empty strings"})
			return
		}
		if _, dup := addSet[l]; dup {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "add contains duplicates"})
			return
		}
		addSet[l] = struct{}{}
	}
	removeSet := make(map[string]struct{}, len(req.Remove))
	for _, l := range req.Remove {
		if l == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "remove must not contain empty strings"})
			return
		}
		if _, dup := removeSet[l]; dup {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "remove contains duplicates"})
			return
		}
		if _, overlap := addSet[l]; overlap {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "add and remove overlap"})
			return
		}
		removeSet[l] = struct{}{}
	}

	// Compute the projected final channel set and enforce bounds. We read
	// StreamLogins via a snapshot copy to avoid racing with a concurrent
	// Stop/Detach.
	currentLogins := append([]string(nil), sess.StreamLogins...)
	currentSet := make(map[string]struct{}, len(currentLogins))
	for _, l := range currentLogins {
		currentSet[l] = struct{}{}
	}
	for l := range removeSet {
		if _, ok := currentSet[l]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "remove references channel not in session: " + l})
			return
		}
	}
	for l := range addSet {
		if _, ok := currentSet[l]; ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "add references channel already in session: " + l})
			return
		}
	}
	finalCount := len(currentLogins) - len(removeSet) + len(addSet)
	if finalCount < 1 || finalCount > maxChannelsPerSession {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "bad_request",
			"message": "resulting channel count must be between 1 and 3",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), postSessionTimeout)
	defer cancel()

	// Validate token. Mirrors POST so a stale token can't mutate sessions.
	validateResp, err := Validate(ctx, deps.HTTPClient, deps.ValidateURL, req.AccessToken)
	if err != nil {
		if errors.Is(err, ErrInvalidToken) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
			return
		}
		log.Error("session.patch.validate.error", "error", err.Error())
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
		return
	}
	if validateResp.UserID != req.UserID {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id_mismatch"})
		return
	}

	clientID := ""
	if deps.Config != nil {
		clientID = deps.Config.ClientID
	}

	// Resolve broadcaster ids for adds UP FRONT so we can fail cleanly
	// before mutating anything.
	var broadcasterIDs map[string]string
	if len(req.Add) > 0 {
		broadcasterIDs, err = GetBroadcasterIDs(ctx, deps.HTTPClient, deps.HelixBaseURL, clientID, req.AccessToken, req.Add)
		if err != nil {
			var cnf *ChannelNotFoundError
			if errors.As(err, &cnf) {
				c.JSON(http.StatusNotFound, gin.H{"error": "channel_not_found", "channel": cnf.Login})
				return
			}
			if errors.Is(err, ErrInvalidToken) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
				return
			}
			log.Error("session.patch.resolve.error", "error", err.Error())
			c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
			return
		}
	}

	// --- Phase 1: process removes so transport slots are freed.
	removedLogins := make([]string, 0, len(req.Remove))
	for _, login := range req.Remove {
		if !sess.DetachConn(login) {
			// Either the session stopped mid-PATCH or the channel was
			// already gone. Either way we cannot safely continue.
			log.Warn("session.patch.detach.miss", "streamLogin", login, "sessionId", id)
			c.JSON(http.StatusConflict, gin.H{"error": "session_mutated"})
			return
		}
		removedLogins = append(removedLogins, login)
	}
	if deps.ReleaseIdlePool != nil {
		for _, login := range removedLogins {
			deps.ReleaseIdlePool(login, sess.UserID)
		}
	}

	// --- Phase 2: subscribe adds. Roll back added conns on any failure.
	type addedEntry struct {
		login string
		conn  aggregator.Conn
	}
	var added []addedEntry
	rollback := func() {
		for _, a := range added {
			// Detach also closes the conn. If Detach fails (session
			// stopped), fall back to raw Close so we don't leak.
			if !sess.DetachConn(a.login) {
				_ = a.conn.Close()
			}
		}
		if deps.ReleaseIdlePool != nil {
			for _, a := range added {
				deps.ReleaseIdlePool(a.login, sess.UserID)
			}
		}
	}
	for _, login := range req.Add {
		frameHook := aggregator.Wrap(login, func(env []byte) {
			select {
			case sess.FrameOut <- env:
			default:
				if deps.Logger != nil {
					deps.Logger.Warn("frame.drop.backpressure",
						"sessionId", id,
						"streamLogin", login,
					)
				}
			}
		}, deps.Logger)

		var attachedConn aggregator.Conn
		switch {
		case deps.Subscribe != nil:
			conn, subErr := deps.Subscribe(ctx, upstream.SubscribeParams{
				StreamLogin:   login,
				UserID:        req.UserID,
				BroadcasterID: broadcasterIDs[login],
				AccessToken:   req.AccessToken,
				OnFrame:       frameHook,
			})
			if subErr != nil {
				log.Error("session.patch.subscribe.error", "streamLogin", login, "error", subErr.Error())
				rollback()
				c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
				return
			}
			attachedConn = conn
		default:
			openParams := eventsub.OpenParams{
				URL:         deps.EventSubURL,
				StreamLogin: login,
				OnFrame:     frameHook,
				Logger:      deps.Logger,
			}
			conn, openErr := deps.OpenConn(ctx, openParams)
			if openErr != nil {
				log.Error("session.patch.open.error", "streamLogin", login, "error", openErr.Error())
				rollback()
				c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
				return
			}
			if regErr := registerLegacy(ctx, deps, sessionRequest{
				UserID:      req.UserID,
				AccessToken: req.AccessToken,
			}, login, broadcasterIDs[login], conn, clientID); regErr != nil {
				_ = conn.Close()
				log.Error("session.patch.register.error", "streamLogin", login, "error", regErr.Error())
				rollback()
				c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
				return
			}
			attachedConn = conn
		}

		if !sess.AttachConnLive(login, attachedConn) {
			// Session stopped between the removes above and this add.
			// Close the freshly-opened conn so we don't leak it.
			_ = attachedConn.Close()
			if deps.ReleaseIdlePool != nil {
				deps.ReleaseIdlePool(login, req.UserID)
			}
			rollback()
			c.JSON(http.StatusConflict, gin.H{"error": "session_mutated"})
			return
		}
		added = append(added, addedEntry{login: login, conn: attachedConn})
	}

	log.Info("session.patch",
		"sessionId", id,
		"added", req.Add,
		"removed", req.Remove,
	)
	c.JSON(http.StatusOK, gin.H{
		"session_id": id,
		"channels":   sess.StreamLogins,
	})
}

// registerLegacy performs the original (non-Hub) Register flow so the
// OpenConn test seam still works. Hub.Subscribe handles Register internally.
func registerLegacy(ctx context.Context, deps SessionHandlerDeps, req sessionRequest, login, broadcasterID string, conn aggregator.Conn, clientID string) error {
	_, err := eventsub.Register(ctx, eventsub.RegisterArgs{
		HTTPClient:    deps.HTTPClient,
		HelixBaseURL:  deps.HelixBaseURL,
		ClientID:      clientID,
		AccessToken:   req.AccessToken,
		SessionID:     conn.SessionID(),
		BroadcasterID: broadcasterID,
		UserID:        req.UserID,
		StreamLogin:   login,
		Logger:        deps.Logger,
	})
	return err
}

// handleDeleteSession tears down a known session. Unknown ids return 404
// instead of 204 so clients can detect already-closed sessions.
//
// After the registry removes+Stops the session (which closes each upstream
// Subscription), we short-circuit the drain grace on each of the session's
// pools: explicit DELETE means "I am done with these channels NOW", so
// holding the Twitch WS transport slot for another 30 seconds would force
// a rapid multi-stream channel switch to hit Twitch's per-user transport
// cap on the next POST /session.
func handleDeleteSession(c *gin.Context, deps SessionHandlerDeps) {
	id := c.Param("id")
	sess, ok := deps.Registry.Get(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session_not_found"})
		return
	}
	// Snapshot before Remove so the session pointer can be torn down.
	logins := append([]string(nil), sess.StreamLogins...)
	userID := sess.UserID

	deps.Registry.Remove(id)

	if deps.ReleaseIdlePool != nil {
		for _, login := range logins {
			deps.ReleaseIdlePool(login, userID)
		}
	}

	if deps.Logger != nil {
		deps.Logger.Info("session.delete", "sessionId", id)
	}
	c.Status(http.StatusNoContent)
}
