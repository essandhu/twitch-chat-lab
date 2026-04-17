// Package config loads runtime configuration for the proxy service from the
// environment. Errors surface as fatal config problems at startup.
package config

import (
	"errors"
	"os"
	"strings"
)

// Config holds the runtime settings read from env vars.
type Config struct {
	ClientID       string
	Port           string
	AllowedOrigins []string
}

// ErrMissingClientID is returned by Load when TWITCH_CLIENT_ID is unset or
// empty. Callers should surface this as a startup-time configuration error.
var ErrMissingClientID = errors.New("config: TWITCH_CLIENT_ID is required")

// Load reads environment variables and returns the assembled Config.
//
// Rules:
//   - TWITCH_CLIENT_ID must be non-empty (else ErrMissingClientID).
//   - PORT defaults to "8080" when unset.
//   - ALLOWED_ORIGINS is split on "," with whitespace trimmed. Empty entries
//     are dropped. An unset value yields an empty slice.
func Load() (*Config, error) {
	clientID := strings.TrimSpace(os.Getenv("TWITCH_CLIENT_ID"))
	if clientID == "" {
		return nil, ErrMissingClientID
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}

	origins := splitOrigins(os.Getenv("ALLOWED_ORIGINS"))

	return &Config{
		ClientID:       clientID,
		Port:           port,
		AllowedOrigins: origins,
	}, nil
}

// splitOrigins splits a comma-delimited origins string, trims whitespace and
// drops empty entries. Always returns a non-nil slice (possibly length 0).
func splitOrigins(raw string) []string {
	out := make([]string, 0)
	for _, part := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}
