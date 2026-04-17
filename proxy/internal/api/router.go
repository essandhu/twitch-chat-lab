// Package api assembles the HTTP router, middlewares, and route handlers for
// the proxy service. Construction is split from cmd/server/main.go so the
// router is testable in isolation.
package api

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/logger"
)

// BuildRouter constructs the gin engine with the correlation/logging
// middleware, CORS enforcement, the /healthz endpoint and a JSON 404 handler.
// It intentionally leaves room for future session routes (see P4-07) — no
// global state is captured here.
func BuildRouter(cfg *config.Config, log *slog.Logger) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(correlationMiddleware(log))
	r.Use(corsMiddleware(cfg.AllowedOrigins))

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	})

	return r
}

// correlationMiddleware stamps a fresh UUIDv4 onto the request context under
// logger.CtxKeyCorrelationID and logs request start/finish with the request
// method, path, status and latency.
func correlationMiddleware(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		corrID := uuid.NewString()
		ctx := context.WithValue(c.Request.Context(), logger.CtxKeyCorrelationID, corrID)
		c.Request = c.Request.WithContext(ctx)
		c.Set(string(logger.CtxKeyCorrelationID), corrID)

		reqLog := logger.WithCorrelation(ctx, log)
		reqLog.Info("request.start",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
		)

		start := time.Now()
		c.Next()
		latency := time.Since(start)

		reqLog.Info("request.finish",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"latencyMs", latency.Milliseconds(),
		)
	}
}

// corsMiddleware enforces origin allow-listing. Requests without an Origin
// header are passed through (non-browser callers). Requests whose Origin is
// present but not in the allow list are rejected with 403. Preflight
// (OPTIONS) requests from allowed origins short-circuit with 204.
func corsMiddleware(allowed []string) gin.HandlerFunc {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allowedSet[o] = struct{}{}
	}

	allowMethods := strings.Join([]string{http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodOptions}, ", ")
	allowHeaders := strings.Join([]string{"Content-Type", "Authorization", "Upgrade", "Connection", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Protocol", "Sec-WebSocket-Extensions"}, ", ")

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			// No CORS context (same-origin, curl, server-to-server). Let it
			// through without setting any ACAO headers.
			c.Next()
			return
		}

		if _, ok := allowedSet[origin]; !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "origin_not_allowed"})
			return
		}

		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Vary", "Origin")
		c.Header("Access-Control-Allow-Methods", allowMethods)
		c.Header("Access-Control-Allow-Headers", allowHeaders)
		c.Header("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
