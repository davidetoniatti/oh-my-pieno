package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRateLimiter_AllowsThenBlocks(t *testing.T) {
	rl := newRateLimiter(false)
	defer rl.stop()

	handler := rl.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	makeReq := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/search", nil)
		req.RemoteAddr = "192.0.2.1:12345"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}

	// Burst of apiRateBurst should all succeed immediately.
	for i := 0; i < apiRateBurst; i++ {
		if rr := makeReq(); rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, rr.Code)
		}
	}

	// Next request should be rate-limited.
	if rr := makeReq(); rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 after burst, got %d", rr.Code)
	}
}

func TestRateLimiter_NonAPIUnthrottled(t *testing.T) {
	rl := newRateLimiter(false)
	defer rl.stop()

	var hits int
	handler := rl.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))

	// Well past the burst — static assets must not be throttled.
	for i := 0; i < apiRateBurst*3; i++ {
		req := httptest.NewRequest("GET", "/index.html", nil)
		req.RemoteAddr = "192.0.2.1:12345"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, rr.Code)
		}
	}

	if hits != apiRateBurst*3 {
		t.Errorf("expected %d hits, got %d", apiRateBurst*3, hits)
	}
}

func TestRateLimiter_PerIPIsolation(t *testing.T) {
	rl := newRateLimiter(false)
	defer rl.stop()

	handler := rl.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust IP A's burst.
	for i := 0; i < apiRateBurst; i++ {
		req := httptest.NewRequest("GET", "/api/search", nil)
		req.RemoteAddr = "192.0.2.1:12345"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
	}

	// IP B should still be allowed.
	req := httptest.NewRequest("GET", "/api/search", nil)
	req.RemoteAddr = "192.0.2.2:12345"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected IP B to be allowed, got %d", rr.Code)
	}
}

func TestRateLimiter_TrustProxyHeaders(t *testing.T) {
	rl := newRateLimiter(true)
	defer rl.stop()

	handler := rl.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// The right-most X-Forwarded-For entry is what the trusted proxy appends;
	// it identifies the real client. Send it as a single trusted hop.
	send := func(xff string) int {
		req := httptest.NewRequest("GET", "/api/search", nil)
		req.RemoteAddr = "10.0.0.1:12345"
		req.Header.Set("X-Forwarded-For", xff)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	// Exhaust one real client's burst.
	for i := 0; i < apiRateBurst; i++ {
		send("198.51.100.5")
	}

	// A forged left-most entry must NOT mint a fresh identity: the real client
	// (right-most, appended by the proxy) stays blocked.
	if code := send("1.2.3.4, 198.51.100.5"); code != http.StatusTooManyRequests {
		t.Errorf("expected 429 despite forged X-Forwarded-For prefix, got %d", code)
	}

	// A genuinely different client (different right-most) is isolated.
	if code := send("203.0.113.8"); code != http.StatusOK {
		t.Errorf("expected 200 for a different client, got %d", code)
	}
}

func TestRateLimiter_MapBounded(t *testing.T) {
	rl := newRateLimiter(true)
	defer rl.stop()

	// All keys are fresh (lastSeen=now), so pruning can't reclaim any: once at
	// the cap, new keys must be refused rather than grow the table.
	for i := 0; i < maxLimiters+1000; i++ {
		rl.allow(fmt.Sprintf("198.51.%d.%d", i/256, i%256))
	}

	rl.mu.Lock()
	n := len(rl.limiters)
	rl.mu.Unlock()
	if n > maxLimiters {
		t.Errorf("limiter map grew to %d, exceeds cap %d", n, maxLimiters)
	}
}
