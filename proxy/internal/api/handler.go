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
)

// postSessionTimeout bounds the entire POST /session handler — including
// Helix calls + all upstream EventSub welcomes. 10s matches the architecture
// budget in §10 and Twitch's own keepalive default.
const postSessionTimeout = 10 * time.Second

// maxChannelsPerSession caps how many streams a single session may aggregate.
// Chosen to keep per-session goroutine fan-out bounded and match the Phase 4
// spec body validation rules.
const maxChannelsPerSession = 3

// SessionHandlerDeps bundles everything RegisterSessionRoutes needs to mount
// POST /session and DELETE /session/:id. The OpenConn seam lets tests inject
// fake upstream Conns; in production defaultOpenConn wraps eventsub.Open.
type SessionHandlerDeps struct {
	Registry     *aggregator.Registry
	Logger       *slog.Logger
	Config       *config.Config
	HTTPClient   *http.Client
	HelixBaseURL string
	ValidateURL  string
	EventSubURL  string
	OpenConn     func(ctx context.Context, params eventsub.OpenParams) (aggregator.Conn, error)
}

// sessionRequest is the JSON body accepted by POST /session.
type sessionRequest struct {
	Channels    []string `json:"channels"`
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
	if deps.OpenConn == nil {
		deps.OpenConn = defaultOpenConn
	}
	if deps.HTTPClient == nil {
		deps.HTTPClient = http.DefaultClient
	}

	r.POST("/session", func(c *gin.Context) {
		handlePostSession(c, deps)
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

	// Build session + open conns.
	sessionID := uuid.NewString()
	sess := aggregator.NewSession(context.Background(), sessionID, req.UserID, req.Channels, deps.Logger)

	type opened struct {
		conn      aggregator.Conn
		subIDs    []string
		streamLog string
	}
	var openedList []opened
	teardown := func() {
		// Revoke any subscriptions and close any conns we opened so far.
		for _, op := range openedList {
			if len(op.subIDs) > 0 {
				_ = eventsub.Unsubscribe(context.Background(), deps.HTTPClient, deps.HelixBaseURL, clientID, req.AccessToken, op.subIDs)
			}
			_ = op.conn.Close()
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

		openParams := eventsub.OpenParams{
			URL:         deps.EventSubURL,
			StreamLogin: login,
			OnFrame:     frameHook,
			Logger:      deps.Logger,
		}
		conn, err := deps.OpenConn(ctx, openParams)
		if err != nil {
			log.Error("session.open.error",
				"streamLogin", login,
				"error", err.Error(),
			)
			teardown()
			sess.Stop()
			c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
			return
		}

		regRes, err := eventsub.Register(ctx, eventsub.RegisterArgs{
			HTTPClient:    deps.HTTPClient,
			HelixBaseURL:  deps.HelixBaseURL,
			ClientID:      clientID,
			AccessToken:   req.AccessToken,
			SessionID:     conn.SessionID(),
			BroadcasterID: broadcasterIDs[login],
			UserID:        req.UserID,
			StreamLogin:   login,
			Logger:        deps.Logger,
		})
		if err != nil {
			log.Error("session.subscribe.error",
				"streamLogin", login,
				"error", err.Error(),
			)
			_ = conn.Close()
			teardown()
			sess.Stop()
			c.JSON(http.StatusBadGateway, gin.H{"error": "upstream_failed"})
			return
		}

		subIDs := make([]string, 0, len(regRes.Registered))
		for _, reg := range regRes.Registered {
			subIDs = append(subIDs, reg.SubscriptionID)
		}
		openedList = append(openedList, opened{conn: conn, subIDs: subIDs, streamLog: login})
		sess.AttachConn(login, conn)
	}

	sess.Start()
	deps.Registry.Add(sess)

	log.Info("session.create",
		"sessionId", sessionID,
		"userId", req.UserID,
		"streamLogins", req.Channels,
	)
	c.JSON(http.StatusCreated, gin.H{"session_id": sessionID})
}

// handleDeleteSession tears down a known session. Unknown ids return 404
// instead of 204 so clients can detect already-closed sessions.
func handleDeleteSession(c *gin.Context, deps SessionHandlerDeps) {
	id := c.Param("id")
	if _, ok := deps.Registry.Get(id); !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session_not_found"})
		return
	}
	deps.Registry.Remove(id)
	if deps.Logger != nil {
		deps.Logger.Info("session.delete", "sessionId", id)
	}
	c.Status(http.StatusNoContent)
}
