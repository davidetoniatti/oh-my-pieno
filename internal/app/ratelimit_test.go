package app

import (
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

	// Exhaust one forwarded client.
	for i := 0; i < apiRateBurst; i++ {
		req := httptest.NewRequest("GET", "/api/search", nil)
		req.RemoteAddr = "10.0.0.1:12345"
		req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
	}

	// Same forwarded IP should now be blocked.
	req := httptest.NewRequest("GET", "/api/search", nil)
	req.RemoteAddr = "10.0.0.1:12345"
	req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 for exhausted forwarded IP, got %d", rr.Code)
	}

	// A different forwarded IP (same RemoteAddr) should still be allowed.
	req2 := httptest.NewRequest("GET", "/api/search", nil)
	req2.RemoteAddr = "10.0.0.1:12345"
	req2.Header.Set("X-Forwarded-For", "203.0.113.8")
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Errorf("expected 200 for different forwarded IP, got %d", rr2.Code)
	}
}
