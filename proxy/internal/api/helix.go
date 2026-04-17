package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// defaultValidateURL is Twitch's canonical OAuth token validation endpoint.
// Tests inject their own via the handler deps + Validate's explicit arg.
const defaultValidateURL = "https://id.twitch.tv/oauth2/validate"

// defaultHelixBaseURL matches the eventsub package constant; duplicated here
// to avoid an otherwise one-way dependency from api → eventsub.
const defaultHelixBaseURL = "https://api.twitch.tv/helix"

// validateCacheTTL caps how long a validate response may be reused. Twitch's
// own `expires_in` is typically hours; we pick a far shorter window so that
// token revocation propagates quickly enough to be operationally useful.
const validateCacheTTL = 60 * time.Second

// ErrInvalidToken is returned by Validate (and surfaced through the handler
// as HTTP 401) when Twitch rejects the provided access token.
var ErrInvalidToken = errors.New("invalid_token")

// ErrUserIDMismatch is returned when the token validation succeeds but the
// resolved user id doesn't match the value the client posted. Signals a
// spoofing attempt or a bug in the frontend.
var ErrUserIDMismatch = errors.New("user_id_mismatch")

// ErrChannelNotFound wraps a specific login. Callers use errors.As to
// extract the ChannelNotFoundError and surface the missing login name in
// the 404 response body.
var ErrChannelNotFound = errors.New("channel_not_found")

// ChannelNotFoundError carries the missing login so handlers can include it
// in the response. Implements Is for compatibility with errors.Is(err,
// ErrChannelNotFound).
type ChannelNotFoundError struct {
	Login string
}

func (e *ChannelNotFoundError) Error() string {
	return fmt.Sprintf("channel not found: %s", e.Login)
}

func (e *ChannelNotFoundError) Is(target error) bool {
	return target == ErrChannelNotFound
}

// ValidateResponse mirrors the fields of Twitch's OAuth validate response
// that we actually need downstream.
type ValidateResponse struct {
	UserID    string
	Login     string
	ExpiresIn int
}

// validateCacheEntry couples a ValidateResponse with its expiry so the cache
// can self-invalidate lazily on read without a background sweeper.
type validateCacheEntry struct {
	resp      *ValidateResponse
	expiresAt time.Time
}

// validateCache is a process-wide cache keyed by SHA-256(token). The token
// is NEVER stored in plaintext so the map is safe to dump in a core file or
// profile without leaking credentials.
var (
	validateCacheMu sync.Mutex
	validateCache   = make(map[string]validateCacheEntry)
)

// hashToken returns the hex SHA-256 of token. Used as the stable cache key.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// cacheValidate writes a successful response into the cache with TTL.
func cacheValidate(token string, resp *ValidateResponse) {
	key := hashToken(token)
	validateCacheMu.Lock()
	defer validateCacheMu.Unlock()
	validateCache[key] = validateCacheEntry{
		resp:      resp,
		expiresAt: time.Now().Add(validateCacheTTL),
	}
}

// lookupValidate returns the cached response if present and not expired.
// Expired entries are evicted as a side effect so stale memory doesn't
// accumulate across the process lifetime.
func lookupValidate(token string) (*ValidateResponse, bool) {
	key := hashToken(token)
	validateCacheMu.Lock()
	defer validateCacheMu.Unlock()
	entry, ok := validateCache[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(validateCache, key)
		return nil, false
	}
	return entry.resp, true
}

// invalidateValidateCache removes any cached validate result for token. Used
// when a follow-up Helix call returns 401, indicating our cached identity is
// stale.
func invalidateValidateCache(token string) {
	key := hashToken(token)
	validateCacheMu.Lock()
	defer validateCacheMu.Unlock()
	delete(validateCache, key)
}

// Validate hits Twitch's OAuth validate endpoint, caching successful results
// for validateCacheTTL. A non-200 response maps to ErrInvalidToken without
// populating the cache.
func Validate(ctx context.Context, httpClient *http.Client, validateURL, accessToken string) (*ValidateResponse, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	if validateURL == "" {
		validateURL = defaultValidateURL
	}
	if cached, ok := lookupValidate(accessToken); ok {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, validateURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build validate request: %w", err)
	}
	req.Header.Set("Authorization", "OAuth "+accessToken)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("validate: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, ErrInvalidToken
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return nil, fmt.Errorf("validate read body: %w", err)
	}
	var parsed struct {
		UserID    string `json:"user_id"`
		Login     string `json:"login"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("validate decode: %w", err)
	}
	out := &ValidateResponse{
		UserID:    parsed.UserID,
		Login:     parsed.Login,
		ExpiresIn: parsed.ExpiresIn,
	}
	cacheValidate(accessToken, out)
	return out, nil
}

// helixUsersResponse mirrors the narrow subset of GET /helix/users we need.
type helixUsersResponse struct {
	Data []struct {
		ID    string `json:"id"`
		Login string `json:"login"`
	} `json:"data"`
}

// GetBroadcasterIDs looks up user_id for each login in a single call to
// GET /users. Missing logins surface via ChannelNotFoundError so handlers
// can echo the specific channel back to the caller.
func GetBroadcasterIDs(ctx context.Context, httpClient *http.Client, helixBaseURL, clientID, accessToken string, logins []string) (map[string]string, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	base := strings.TrimRight(helixBaseURL, "/")
	if base == "" {
		base = defaultHelixBaseURL
	}
	if len(logins) == 0 {
		return map[string]string{}, nil
	}

	// Twitch accepts repeated `login` params; url.Values handles encoding.
	q := url.Values{}
	for _, l := range logins {
		q.Add("login", l)
	}
	u := base + "/users?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, fmt.Errorf("build users request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Client-Id", clientID)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("users: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		// Any cached validate for this token is stale; drop it so the next
		// request re-validates.
		invalidateValidateCache(accessToken)
		return nil, ErrInvalidToken
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("users: status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("users read body: %w", err)
	}
	var parsed helixUsersResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("users decode: %w", err)
	}

	found := make(map[string]string, len(parsed.Data))
	for _, u := range parsed.Data {
		found[strings.ToLower(u.Login)] = u.ID
	}

	out := make(map[string]string, len(logins))
	for _, login := range logins {
		id, ok := found[strings.ToLower(login)]
		if !ok {
			return nil, &ChannelNotFoundError{Login: login}
		}
		out[login] = id
	}
	return out, nil
}
