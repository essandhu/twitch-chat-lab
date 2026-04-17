package config_test

import (
	"reflect"
	"testing"

	"github.com/erick/twitch-chat-lab/proxy/internal/config"
)

func TestLoad_ErrorsOnMissingClientID(t *testing.T) {
	t.Setenv("TWITCH_CLIENT_ID", "")
	t.Setenv("PORT", "9090")
	t.Setenv("ALLOWED_ORIGINS", "")

	cfg, err := config.Load()
	if err == nil {
		t.Fatalf("expected error for missing TWITCH_CLIENT_ID, got cfg=%+v", cfg)
	}
	if cfg != nil {
		t.Fatalf("expected nil config on error, got %+v", cfg)
	}
}

func TestLoad_DefaultsPort(t *testing.T) {
	t.Setenv("TWITCH_CLIENT_ID", "abc123")
	t.Setenv("PORT", "")
	t.Setenv("ALLOWED_ORIGINS", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "8080" {
		t.Fatalf("expected Port=8080, got %q", cfg.Port)
	}
	if cfg.ClientID != "abc123" {
		t.Fatalf("expected ClientID=abc123, got %q", cfg.ClientID)
	}
}

func TestLoad_SplitsAndTrimsAllowedOrigins(t *testing.T) {
	t.Setenv("TWITCH_CLIENT_ID", "xyz")
	t.Setenv("PORT", "3000")
	t.Setenv("ALLOWED_ORIGINS", " http://localhost:5173 , https://example.com,http://other.test ")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"http://localhost:5173", "https://example.com", "http://other.test"}
	if !reflect.DeepEqual(cfg.AllowedOrigins, want) {
		t.Fatalf("AllowedOrigins mismatch\nwant=%v\n got=%v", want, cfg.AllowedOrigins)
	}
	if cfg.Port != "3000" {
		t.Fatalf("expected Port=3000, got %q", cfg.Port)
	}
}

func TestLoad_EmptyAllowedOriginsProducesEmptySlice(t *testing.T) {
	t.Setenv("TWITCH_CLIENT_ID", "xyz")
	t.Setenv("PORT", "")
	t.Setenv("ALLOWED_ORIGINS", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.AllowedOrigins) != 0 {
		t.Fatalf("expected empty AllowedOrigins, got %v", cfg.AllowedOrigins)
	}
}

func TestLoad_AllowedOriginsDropsEmptyEntries(t *testing.T) {
	t.Setenv("TWITCH_CLIENT_ID", "xyz")
	t.Setenv("PORT", "")
	t.Setenv("ALLOWED_ORIGINS", ",,http://a.test, ,http://b.test,")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"http://a.test", "http://b.test"}
	if !reflect.DeepEqual(cfg.AllowedOrigins, want) {
		t.Fatalf("AllowedOrigins mismatch\nwant=%v\n got=%v", want, cfg.AllowedOrigins)
	}
}
