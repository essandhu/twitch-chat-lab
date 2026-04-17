package api

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/logger"
)

// Tunables for the downstream WebSocket pump. Times are short enough to
// detect half-open TCP within ~45s but long enough that clients on flaky
// networks (mobile, coffee shop wifi) don't churn needlessly.
const (
	wsReadBufferSize  = 1024
	wsWriteBufferSize = 4096
	wsWriteDeadline   = 10 * time.Second
	wsPingInterval    = 30 * time.Second
	wsPongWait        = 10 * time.Second
	wsHandshakeBudget = 10 * time.Second
)

// WebSocketHandlerDeps bundles the dependencies RegisterWebSocketRoute needs.
// Upgrader is optional — a zero value is replaced with a sane default keyed
// off the provided Config.AllowedOrigins.
type WebSocketHandlerDeps struct {
	Registry *aggregator.Registry
	Logger   *slog.Logger
	Config   *config.Config
	Upgrader websocket.Upgrader
}

// RegisterWebSocketRoute mounts GET /ws/:session_id onto r. The route
// performs pre-upgrade authorization (origin + session-exists + single-
// writer) so rejections are surfaced as plain HTTP responses instead of
// unfriendly WebSocket close frames.
func RegisterWebSocketRoute(r gin.IRouter, deps WebSocketHandlerDeps) {
	upgrader := deps.Upgrader
	// A zero-value Upgrader has nil CheckOrigin which would default to
	// "reject all cross-origin". Wiring one explicitly from config also
	// gives us consistent behaviour with the CORS middleware.
	allowed := make(map[string]struct{})
	if deps.Config != nil {
		for _, o := range deps.Config.AllowedOrigins {
			allowed[o] = struct{}{}
		}
	}
	upgrader.ReadBufferSize = wsReadBufferSize
	upgrader.WriteBufferSize = wsWriteBufferSize
	upgrader.HandshakeTimeout = wsHandshakeBudget
	upgrader.CheckOrigin = func(req *http.Request) bool {
		origin := req.Header.Get("Origin")
		if origin == "" {
			return false
		}
		_, ok := allowed[origin]
		return ok
	}

	r.GET("/ws/:session_id", func(c *gin.Context) {
		handleWebSocket(c, deps, &upgrader, allowed)
	})
}

// handleWebSocket is the per-request entry point. Pre-upgrade rejections
// write a plain JSON body; upgrades hand off to pumpWebSocket which owns the
// connection for its lifetime.
func handleWebSocket(c *gin.Context, deps WebSocketHandlerDeps, upgrader *websocket.Upgrader, allowedOrigins map[string]struct{}) {
	log := logger.WithCorrelation(c.Request.Context(), deps.Logger)
	sessionID := c.Param("session_id")

	// Origin check before upgrade — avoids sending a 101 to a disallowed
	// origin where the close frame would be the only signal.
	origin := c.Request.Header.Get("Origin")
	if origin == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "origin_not_allowed"})
		return
	}
	if _, ok := allowedOrigins[origin]; !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "origin_not_allowed"})
		return
	}

	sess, ok := deps.Registry.Get(sessionID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "session_not_found"})
		return
	}

	if !sess.TryAcquireWS() {
		c.JSON(http.StatusConflict, gin.H{"error": "session_already_active"})
		return
	}

	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		// Upgrade already wrote a response body/status; release the slot so
		// a retry from the client can succeed.
		sess.ReleaseWS()
		if log != nil {
			log.Warn("ws.upgrade.failed", "sessionId", sessionID, "error", err.Error())
		}
		return
	}

	if log != nil {
		log.Info("ws.connect", "sessionId", sessionID)
	}

	pumpWebSocket(ws, sess, deps, log, sessionID)
}

// pumpWebSocket drives the reader + writer goroutines until one of them
// exits, at which point it tears the connection down, releases the ws slot,
// and removes the session from the registry.
func pumpWebSocket(ws *websocket.Conn, sess *aggregator.Session, deps WebSocketHandlerDeps, log *slog.Logger, sessionID string) {
	defer func() {
		_ = ws.Close()
		sess.ReleaseWS()
	}()

	// Pong handler extends the read deadline — as long as pings keep
	// flowing the reader never trips the wsPongWait timeout.
	_ = ws.SetReadDeadline(time.Now().Add(wsPingInterval + wsPongWait))
	ws.SetPongHandler(func(string) error {
		return ws.SetReadDeadline(time.Now().Add(wsPingInterval + wsPongWait))
	})

	done := make(chan struct{})
	var once sync.Once
	closeDone := func() { once.Do(func() { close(done) }) }

	// Reader: discards client→proxy text (proxy is read-only) but surfaces
	// close frames and read errors so the writer loop can exit promptly.
	go func() {
		defer closeDone()
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				if log != nil {
					if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						log.Info("ws.close", "sessionId", sessionID)
					} else {
						log.Info("ws.read.error", "sessionId", sessionID, "error", err.Error())
					}
				}
				return
			}
			// Spec explicitly mentions logging+ignoring client → proxy
			// payloads since the proxy is strictly one-way downstream.
			if log != nil {
				log.Debug("ws.client.message.ignored", "sessionId", sessionID)
			}
		}
	}()

	// Writer: interleaves envelope sends with periodic pings. We use a
	// single goroutine for both so gorilla/websocket's write path stays
	// single-threaded (required: only one writer allowed at a time).
	pingTicker := time.NewTicker(wsPingInterval)
	defer pingTicker.Stop()

	writeFailed := false
	for !writeFailed {
		select {
		case <-done:
			// Reader exited (client close or read error). Cancel the session
			// so the remaining resources tear down.
			deps.Registry.Remove(sessionID)
			return
		case env, ok := <-sess.FrameOut:
			if !ok {
				// Session has been stopped and channel drained.
				_ = ws.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "session_closed"),
					time.Now().Add(wsWriteDeadline))
				return
			}
			_ = ws.SetWriteDeadline(time.Now().Add(wsWriteDeadline))
			if err := ws.WriteMessage(websocket.TextMessage, env); err != nil {
				if log != nil {
					log.Warn("ws.write.error", "sessionId", sessionID, "error", err.Error())
				}
				_ = ws.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "write_failed"),
					time.Now().Add(time.Second))
				deps.Registry.Remove(sessionID)
				writeFailed = true
			}
		case <-pingTicker.C:
			_ = ws.SetWriteDeadline(time.Now().Add(wsWriteDeadline))
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				if log != nil {
					log.Warn("ws.ping.error", "sessionId", sessionID, "error", err.Error())
				}
				deps.Registry.Remove(sessionID)
				writeFailed = true
			}
		}
	}
}
