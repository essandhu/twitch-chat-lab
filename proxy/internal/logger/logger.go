// Package logger provides the structured JSON logger used across the proxy
// service along with helpers to propagate correlation IDs through request
// contexts.
package logger

import (
	"context"
	"log/slog"
	"os"
)

// ctxKey is an unexported type used to avoid collisions when storing values
// on a context. Exported constant values use this type so callers outside the
// package must go through the helpers in this file.
type ctxKey string

// CtxKeyCorrelationID is the context key under which request correlation IDs
// are stored. Middleware populates this value; WithCorrelation reads it.
const CtxKeyCorrelationID ctxKey = "corr"

// New returns a JSON slog.Logger writing to stdout at the supplied level. The
// default attribute set includes service="proxy" so downstream systems can
// group proxy logs without extra plumbing.
func New(level slog.Level) *slog.Logger {
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	return slog.New(h).With("service", "proxy")
}

// WithCorrelation returns a child logger stamped with the correlation ID
// stored on ctx under CtxKeyCorrelationID. If the value is missing or not a
// non-empty string the provided logger is returned unchanged.
func WithCorrelation(ctx context.Context, log *slog.Logger) *slog.Logger {
	if ctx == nil || log == nil {
		return log
	}
	v := ctx.Value(CtxKeyCorrelationID)
	id, ok := v.(string)
	if !ok || id == "" {
		return log
	}
	return log.With("correlationId", id)
}
