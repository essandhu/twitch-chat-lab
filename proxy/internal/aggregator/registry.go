package aggregator

import "sync"

// Registry is a concurrency-safe map of session id → *Session used by the
// HTTP handlers to look up (and tear down) the upstream connections owned
// by a downstream websocket client.
//
// Locking rule: the mutex is held ONLY while reading/writing the map. Any
// call into *Session (Stop, etc.) happens AFTER releasing the lock so a
// 2s Stop doesn't block every other request touching the registry.
type Registry struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

// NewRegistry returns an empty Registry ready for concurrent use.
func NewRegistry() *Registry {
	return &Registry{sessions: make(map[string]*Session)}
}

// Add registers a session under its ID. If the same ID is added twice the
// latest wins — callers should enforce uniqueness at the handler layer.
func (r *Registry) Add(s *Session) {
	if s == nil {
		return
	}
	r.mu.Lock()
	r.sessions[s.ID] = s
	r.mu.Unlock()
}

// Get returns the session for id plus an ok flag. Safe for concurrent use.
func (r *Registry) Get(id string) (*Session, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[id]
	return s, ok
}

// Remove deletes the session with id from the registry and calls Stop on
// it. Unknown ids are silently ignored. Stop is invoked OUTSIDE the lock.
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	s, ok := r.sessions[id]
	if ok {
		delete(r.sessions, id)
	}
	r.mu.Unlock()
	if ok && s != nil {
		s.Stop()
	}
}

// CloseAll stops every registered session and clears the map. Intended
// for graceful shutdown. Sessions are stopped concurrently so total
// teardown time stays bounded by the slowest individual Stop (≤ 2s per
// Conn close).
func (r *Registry) CloseAll() {
	r.mu.Lock()
	snapshot := make([]*Session, 0, len(r.sessions))
	for _, s := range r.sessions {
		snapshot = append(snapshot, s)
	}
	r.sessions = make(map[string]*Session)
	r.mu.Unlock()

	var wg sync.WaitGroup
	for _, s := range snapshot {
		if s == nil {
			continue
		}
		wg.Add(1)
		go func(sess *Session) {
			defer wg.Done()
			sess.Stop()
		}(s)
	}
	wg.Wait()
}
