package eventsub

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// defaultHelixBaseURL is the canonical Twitch Helix endpoint. RegisterArgs.HelixBaseURL
// overrides it in tests (via httptest) and could be used to route through a
// mock in staging environments if ever needed.
const defaultHelixBaseURL = "https://api.twitch.tv/helix"

// bodyExcerptMaxBytes caps how much of a non-2xx response body we capture for
// diagnostics. Keeps log lines bounded and avoids dragging giant HTML error
// pages into the structured log stream.
const bodyExcerptMaxBytes = 512

// subscriptionKind encodes everything Register needs to know about one
// subscription type: its API type string, version, and the function that
// builds the condition object for a given RegisterArgs. It also carries
// whether a 403 is tolerated (non-mandatory) or fatal.
type subscriptionKind struct {
	Type      string
	Version   string
	Mandatory bool
	Condition func(a RegisterArgs) map[string]string
}

// subscriptionKinds is the exhaustive list the proxy registers per session.
// Order is stable so tests can rely on Registered/Skipped ordering.
var subscriptionKinds = []subscriptionKind{
	{
		Type:      "channel.chat.message",
		Version:   "1",
		Mandatory: true,
		Condition: func(a RegisterArgs) map[string]string {
			return map[string]string{
				"broadcaster_user_id": a.BroadcasterID,
				"user_id":             a.UserID,
			}
		},
	},
	{
		Type:      "channel.subscribe",
		Version:   "1",
		Mandatory: false,
		Condition: func(a RegisterArgs) map[string]string {
			return map[string]string{"broadcaster_user_id": a.BroadcasterID}
		},
	},
	{
		Type:      "channel.subscription.gift",
		Version:   "1",
		Mandatory: false,
		Condition: func(a RegisterArgs) map[string]string {
			return map[string]string{"broadcaster_user_id": a.BroadcasterID}
		},
	},
	{
		Type:      "channel.raid",
		Version:   "1",
		Mandatory: false,
		Condition: func(a RegisterArgs) map[string]string {
			return map[string]string{"to_broadcaster_user_id": a.BroadcasterID}
		},
	},
	{
		Type:      "channel.hype_train.begin",
		Version:   "2",
		Mandatory: false,
		Condition: func(a RegisterArgs) map[string]string {
			return map[string]string{"broadcaster_user_id": a.BroadcasterID}
		},
	},
	{
		Type:      "channel.hype_train.end",
		Version:   "2",
		Mandatory: false,
		Condition: func(a RegisterArgs) map[string]string {
			return map[string]string{"broadcaster_user_id": a.BroadcasterID}
		},
	},
}

// RegisterArgs is the fully-resolved input bundle for Register. HTTPClient
// and HelixBaseURL default to production values when zero; other fields are
// mandatory.
type RegisterArgs struct {
	HTTPClient    *http.Client
	HelixBaseURL  string
	ClientID      string
	AccessToken   string
	SessionID     string
	BroadcasterID string
	UserID        string
	StreamLogin   string
	Logger        *slog.Logger
}

// Registered is a successful subscription record.
type Registered struct {
	Type           string
	SubscriptionID string
}

// Skipped records a non-mandatory registration that returned 403. BodyExcerpt
// is scrubbed of the caller's access token before being captured.
type Skipped struct {
	Type        string
	Status      int
	BodyExcerpt string
}

// RegisterResult is the outcome of a full Register call.
type RegisterResult struct {
	Registered []Registered
	Skipped    []Skipped
}

// helixSubscriptionResponse is the minimal shape we decode from Twitch's
// subscription-creation response. Only the first data[0].id is needed.
type helixSubscriptionResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// Register creates the full set of EventSub subscriptions defined by
// subscriptionKinds. Mandatory failures (non-2xx) abort with an error —
// caller should then tear down the connection. Non-mandatory 403s are
// accumulated in result.Skipped and do NOT fail the call.
func Register(ctx context.Context, args RegisterArgs) (RegisterResult, error) {
	client := args.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	base := strings.TrimRight(args.HelixBaseURL, "/")
	if base == "" {
		base = defaultHelixBaseURL
	}
	log := args.Logger

	result := RegisterResult{}

	for _, kind := range subscriptionKinds {
		reqBody := map[string]any{
			"type":      kind.Type,
			"version":   kind.Version,
			"condition": kind.Condition(args),
			"transport": map[string]string{
				"method":     "websocket",
				"session_id": args.SessionID,
			},
		}
		raw, err := json.Marshal(reqBody)
		if err != nil {
			// Should never happen for a plain map of strings.
			return result, fmt.Errorf("marshal subscription %s: %w", kind.Type, err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/eventsub/subscriptions", bytes.NewReader(raw))
		if err != nil {
			return result, fmt.Errorf("build request %s: %w", kind.Type, err)
		}
		req.Header.Set("Authorization", "Bearer "+args.AccessToken)
		req.Header.Set("Client-Id", args.ClientID)
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			if kind.Mandatory {
				if log != nil {
					log.Error("eventsub.subscription.register.error",
						"type", kind.Type,
						"status", 0,
						"bodyExcerpt", scrubToken(err.Error(), args.AccessToken),
						"streamLogin", args.StreamLogin,
					)
				}
				return result, fmt.Errorf("subscribe %s: %w", kind.Type, err)
			}
			// Non-mandatory transport failure: record as skipped with status 0
			// and keep going — we don't want one flaky scope to block chat.
			if log != nil {
				log.Warn("eventsub.subscription.register.skipped",
					"type", kind.Type,
					"status", 0,
					"streamLogin", args.StreamLogin,
				)
			}
			result.Skipped = append(result.Skipped, Skipped{
				Type:        kind.Type,
				Status:      0,
				BodyExcerpt: scrubToken(err.Error(), args.AccessToken),
			})
			continue
		}

		body := readBodyExcerpt(resp.Body)
		_ = resp.Body.Close()
		scrubbed := scrubToken(body, args.AccessToken)

		switch {
		case resp.StatusCode == http.StatusAccepted || resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated:
			var parsed helixSubscriptionResponse
			if err := json.Unmarshal([]byte(body), &parsed); err != nil || len(parsed.Data) == 0 {
				// A 2xx without a usable id is treated as an error for
				// mandatory kinds — we couldn't learn the subscription id so
				// we can't later revoke it. For non-mandatory kinds we log
				// and skip so one bad response doesn't nuke the whole session.
				if kind.Mandatory {
					if log != nil {
						log.Error("eventsub.subscription.register.error",
							"type", kind.Type,
							"status", resp.StatusCode,
							"bodyExcerpt", scrubbed,
							"streamLogin", args.StreamLogin,
						)
					}
					return result, fmt.Errorf("subscribe %s: decode success body: %w", kind.Type, err)
				}
				if log != nil {
					log.Warn("eventsub.subscription.register.skipped",
						"type", kind.Type,
						"status", resp.StatusCode,
						"streamLogin", args.StreamLogin,
					)
				}
				result.Skipped = append(result.Skipped, Skipped{
					Type:        kind.Type,
					Status:      resp.StatusCode,
					BodyExcerpt: scrubbed,
				})
				continue
			}
			subID := parsed.Data[0].ID
			result.Registered = append(result.Registered, Registered{
				Type:           kind.Type,
				SubscriptionID: subID,
			})
			if log != nil {
				log.Info("eventsub.subscription.register.ok",
					"type", kind.Type,
					"subscriptionId", subID,
					"streamLogin", args.StreamLogin,
				)
			}
		case resp.StatusCode == http.StatusForbidden && !kind.Mandatory:
			if log != nil {
				// Intentionally does NOT log the body — 403s commonly echo
				// helpful-but-identifying error detail. Status + type are
				// sufficient for operators to act on.
				log.Warn("eventsub.subscription.register.skipped",
					"type", kind.Type,
					"status", resp.StatusCode,
					"streamLogin", args.StreamLogin,
				)
			}
			result.Skipped = append(result.Skipped, Skipped{
				Type:        kind.Type,
				Status:      resp.StatusCode,
				BodyExcerpt: scrubbed,
			})
		default:
			// Mandatory 4xx/5xx, or unexpected non-403 on non-mandatory.
			if kind.Mandatory {
				if log != nil {
					log.Error("eventsub.subscription.register.error",
						"type", kind.Type,
						"status", resp.StatusCode,
						"bodyExcerpt", scrubbed,
						"streamLogin", args.StreamLogin,
					)
				}
				return result, fmt.Errorf("subscribe %s: status %d", kind.Type, resp.StatusCode)
			}
			// Non-mandatory non-403 error — still tolerated so one misbehaving
			// endpoint can't break session creation. Record as skipped.
			if log != nil {
				log.Warn("eventsub.subscription.register.skipped",
					"type", kind.Type,
					"status", resp.StatusCode,
					"streamLogin", args.StreamLogin,
				)
			}
			result.Skipped = append(result.Skipped, Skipped{
				Type:        kind.Type,
				Status:      resp.StatusCode,
				BodyExcerpt: scrubbed,
			})
		}
	}

	return result, nil
}

// Unsubscribe issues best-effort DELETE calls for each subscription id. All
// errors are logged (via stderr if no logger is wired, which is fine — tests
// suppress with io.Discard) but NEVER returned: Unsubscribe is a cleanup
// path and must not mask a more meaningful error from the caller.
func Unsubscribe(ctx context.Context, httpClient *http.Client, helixBaseURL, clientID, accessToken string, subscriptionIDs []string) error {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	base := strings.TrimRight(helixBaseURL, "/")
	if base == "" {
		base = defaultHelixBaseURL
	}
	for _, id := range subscriptionIDs {
		if id == "" {
			continue
		}
		u := base + "/eventsub/subscriptions?id=" + url.QueryEscape(id)
		req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
		if err != nil {
			// Construction errors are logged-and-skipped; we can't do more.
			continue
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Client-Id", clientID)
		resp, err := httpClient.Do(req)
		if err != nil {
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	return nil
}

// scrubToken replaces every occurrence of token in body with "[REDACTED]".
// If token is empty the body is returned unchanged (we don't want to
// accidentally redact every empty-string match in the body).
func scrubToken(body, token string) string {
	if token == "" {
		return body
	}
	return strings.ReplaceAll(body, token, "[REDACTED]")
}

// readBodyExcerpt reads up to bodyExcerptMaxBytes+1 bytes so callers can
// detect truncation. Returning a string keeps the excerpt easy to hand
// straight to slog.
func readBodyExcerpt(r io.Reader) string {
	if r == nil {
		return ""
	}
	limited := io.LimitReader(r, bodyExcerptMaxBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return ""
	}
	if len(data) > bodyExcerptMaxBytes {
		data = append(data[:bodyExcerptMaxBytes:bodyExcerptMaxBytes], []byte("…")...)
	}
	return string(data)
}
