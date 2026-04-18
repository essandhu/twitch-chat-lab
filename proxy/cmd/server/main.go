// Command server boots the proxy HTTP service: config load, structured
// logger, gin router, and graceful shutdown on SIGINT/SIGTERM.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/erick/twitch-chat-lab/proxy/internal/aggregator"
	"github.com/erick/twitch-chat-lab/proxy/internal/api"
	"github.com/erick/twitch-chat-lab/proxy/internal/config"
	"github.com/erick/twitch-chat-lab/proxy/internal/logger"
	"github.com/erick/twitch-chat-lab/proxy/internal/upstream"
)

const (
	shutdownTimeout = 5 * time.Second
	readTimeout     = 10 * time.Second
	writeTimeout    = 30 * time.Second
	idleTimeout     = 120 * time.Second
)

func main() {
	log := logger.New(slog.LevelInfo)

	cfg, err := config.Load()
	if err != nil {
		log.Error("config.load.failed", "error", err.Error())
		os.Exit(1)
	}

	router := api.BuildRouter(cfg, log)

	// Shared registry holds every live downstream session. Handlers Add,
	// WebSocket pump and shutdown Remove/CloseAll.
	registry := aggregator.NewRegistry()

	// Process-wide upstream hub: pools EventSub WS connections by
	// (stream_login, user_id) so we stay under Twitch's 3-transport-per-
	// user cap even with many concurrent viewers on the demo.
	hub := upstream.NewHub(upstream.HubConfig{
		ClientID:   cfg.ClientID,
		HTTPClient: http.DefaultClient,
		Logger:     log,
	})

	api.RegisterSessionRoutes(router, api.SessionHandlerDeps{
		Registry:   registry,
		Logger:     log,
		Config:     cfg,
		HTTPClient: http.DefaultClient,
		Hub:        hub,
	})
	api.RegisterWebSocketRoute(router, api.WebSocketHandlerDeps{
		Registry: registry,
		Logger:   log,
		Config:   cfg,
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router.Handler(),
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  idleTimeout,
	}

	// Root context cancels on SIGINT/SIGTERM. Future session registries will
	// observe this context to tear down upstream EventSub connections.
	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		log.Info("server.listen", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		close(serverErr)
	}()

	select {
	case <-rootCtx.Done():
		log.Info("server.shutdown.signal")
	case err, ok := <-serverErr:
		if ok && err != nil {
			log.Error("server.listen.failed", "error", err.Error())
			os.Exit(1)
		}
		return
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("server.shutdown.failed", "error", err.Error())
		// Continue to CloseAll to still tear down upstream connections — we
		// don't want EventSub sockets leaking past the process exit path.
	}
	registry.CloseAll()
	hub.Shutdown()
	log.Info("server.shutdown.complete")
}
