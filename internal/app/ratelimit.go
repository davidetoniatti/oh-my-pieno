package app

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	apiRatePerSec   = 20
	apiRateBurst    = 40
	limiterIdleTTL  = 10 * time.Minute
	cleanupInterval = 2 * time.Minute
	// Hard ceiling on tracked clients, mirroring the LRU cache's bound. Past
	// it we prune stale entries and, if still full, fail closed rather than
	// let the table grow without limit.
	maxLimiters = 50_000
)

type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type rateLimiter struct {
	mu         sync.Mutex
	limiters   map[string]*ipLimiter
	trustProxy bool
	stopCh     chan struct{}
	once       sync.Once
}

func newRateLimiter(trustProxy bool) *rateLimiter {
	rl := &rateLimiter{
		limiters:   make(map[string]*ipLimiter),
		trustProxy: trustProxy,
		stopCh:     make(chan struct{}),
	}
	go rl.cleanup()
	return rl
}

func (rl *rateLimiter) stop() {
	rl.once.Do(func() { close(rl.stopCh) })
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	entry, ok := rl.limiters[key]
	if !ok {
		if len(rl.limiters) >= maxLimiters {
			rl.pruneStaleLocked(time.Now().Add(-limiterIdleTTL))
			if len(rl.limiters) >= maxLimiters {
				return false
			}
		}
		entry = &ipLimiter{limiter: rate.NewLimiter(apiRatePerSec, apiRateBurst)}
		rl.limiters[key] = entry
	}
	entry.lastSeen = time.Now()
	return entry.limiter.Allow()
}

// pruneStaleLocked drops entries not seen since cutoff. Caller holds rl.mu.
func (rl *rateLimiter) pruneStaleLocked(cutoff time.Time) {
	for k, v := range rl.limiters {
		if v.lastSeen.Before(cutoff) {
			delete(rl.limiters, k)
		}
	}
}

func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			rl.pruneStaleLocked(time.Now().Add(-limiterIdleTTL))
			rl.mu.Unlock()
		case <-rl.stopCh:
			return
		}
	}
}

func (rl *rateLimiter) clientKey(r *http.Request) string {
	if rl.trustProxy {
		// Behind exactly one trusted proxy, the right-most X-Forwarded-For
		// entry is the address our proxy observed and appended; everything to
		// its left is client-supplied and forgeable. Trusting the left-most
		// entry (as before) let a client set a fresh identity per request and
		// bypass the limiter, so we take the right-most and require a valid IP.
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			cand := strings.TrimSpace(parts[len(parts)-1])
			if ip := net.ParseIP(cand); ip != nil {
				return ip.String()
			}
		}
		if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
			if ip := net.ParseIP(xr); ip != nil {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (rl *rateLimiter) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}

		if !rl.allow(rl.clientKey(r)) {
			h := w.Header()
			h.Set("Content-Type", "application/json")
			h.Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate limit exceeded"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
