package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/time/rate"

	"ohmypieno/internal/cache"
	"ohmypieno/internal/models"
)

// newTestClient builds a Client with its own fresh typed caches.
func newTestClient(baseURL string) *Client {
	return NewClient(
		baseURL,
		cache.New[*models.SearchResponse](),
		cache.New[*models.GasStation](),
	)
}

func TestClient_GetFuels(t *testing.T) {
	client := newTestClient("")

	fuels, err := client.GetFuels(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(fuels) != 5 {
		t.Errorf("expected 5 fuels, got %d", len(fuels))
	}

	if fuels[0].ID != 1 || fuels[0].Name != "Benzina" {
		t.Errorf("unexpected fuel data: %+v", fuels[0])
	}
}

func TestClient_SearchZone(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		var req models.SearchRequest
		json.NewDecoder(r.Body).Decode(&req)
		if len(req.Points) == 0 || req.Points[0].Lat != 41.0 {
			t.Errorf("unexpected request body: %+v", req)
		}

		resp := models.SearchResponse{
			Success: true,
			Results: []models.GasStation{
				{ID: 123, Name: "Test Station"},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := newTestClient(server.URL)

	res, err := client.SearchZone(context.Background(), 41.0, 12.0, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(res.Results) != 1 || res.Results[0].ID != 123 {
		t.Errorf("unexpected search results: %+v", res.Results)
	}
}

func TestClient_GetServiceArea(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/registry/servicearea/123" {
			t.Errorf("expected path /registry/servicearea/123, got %s", r.URL.Path)
		}
		resp := models.GasStation{
			ID:   123,
			Name: "Detailed Station",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := newTestClient(server.URL)

	station, err := client.GetServiceArea(context.Background(), 123)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if station.ID != 123 || station.Name != "Detailed Station" {
		t.Errorf("unexpected station data: %+v", station)
	}
}

func TestClient_ErrorHandling(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer server.Close()

	client := newTestClient(server.URL)

	_, err := client.SearchZone(context.Background(), 0, 0, 100)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

// The Nominatim budget must gate only outbound calls: a cached query is
// served without consuming a token, while an uncached query over budget is
// rejected before any network access.
func TestNominatimClient_RateLimitGatesOutboundOnly(t *testing.T) {
	c := cache.New[[]any]()
	client := NewNominatimClient(c)
	// Exhaust the budget so any outbound call would be rejected. In-package
	// test, so we can swap the limiter directly.
	client.limiter = rate.NewLimiter(0, 0)

	// Cached lookup must bypass the limiter (key format: "query\x00lang").
	c.Set("roma\x00", []any{map[string]any{"name": "Roma"}}, time.Hour)
	got, err := client.Geocode(context.Background(), "roma", "")
	if err != nil {
		t.Fatalf("cached lookup should bypass the limiter, got: %v", err)
	}
	if res, ok := got.([]any); !ok || len(res) != 1 {
		t.Fatalf("unexpected cached result: %#v", got)
	}

	// Uncached lookup over budget must fail fast with ErrRateLimited and never
	// reach the (hardcoded, real) Nominatim URL.
	if _, err := client.Geocode(context.Background(), "milano", ""); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("expected ErrRateLimited for uncached over-budget query, got: %v", err)
	}
}

func TestCache_Expiration(t *testing.T) {
	c := cache.New[any]()
	c.Set("key", "value", 100*time.Millisecond)

	val, found := c.Get("key")
	if !found || val != "value" {
		t.Fatal("expected to find value")
	}

	time.Sleep(150 * time.Millisecond)
	_, found = c.Get("key")
	if found {
		t.Fatal("expected value to be expired")
	}
}

func TestClient_SingleflightCoalescing(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		time.Sleep(100 * time.Millisecond) // Slow response to allow coalescing
		resp := models.SearchResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := newTestClient(server.URL)

	// Fire many concurrent requests
	const workers = 50
	var wg sync.WaitGroup
	errChan := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := client.SearchZone(context.Background(), 41.0, 12.0, 5)
			errChan <- err
		}()
	}

	wg.Wait()
	close(errChan)

	for err := range errChan {
		if err != nil {
			t.Errorf("request failed: %v", err)
		}
	}

	if calls.Load() != 1 {
		t.Errorf("expected only 1 upstream call, got %d", calls.Load())
	}
}

// The leader's cancellation must not fail waiters on the same key. The
// upstream call runs on a background context, so only the cancelled caller
// sees an error; other waiters still receive the shared result.
func TestClient_SingleflightCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started) // Signal that the first request reached the server
		time.Sleep(100 * time.Millisecond)
		resp := models.SearchResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := newTestClient(server.URL)

	ctx1, cancel1 := context.WithCancel(context.Background())
	ctx2 := context.Background()

	ctx1Err := make(chan error, 1)
	ctx2Err := make(chan error, 1)
	go func() {
		_, err := client.SearchZone(ctx1, 41.0, 12.0, 5)
		ctx1Err <- err
	}()

	// Wait for first request to reach server
	select {
	case <-started:
	case <-time.After(1 * time.Second):
		t.Fatal("timed out waiting for request 1 to start")
	}

	go func() {
		_, err := client.SearchZone(ctx2, 41.0, 12.0, 5)
		ctx2Err <- err
	}()

	// Small sleep to ensure the second goroutine joined the flight before
	// cancelling the leader. Replacing this with a channel barrier is on
	// the roadmap.
	time.Sleep(20 * time.Millisecond)
	cancel1()

	if err := <-ctx1Err; err == nil {
		t.Errorf("expected ctx1 to fail with cancellation, got nil")
	}
	if err := <-ctx2Err; err != nil {
		t.Errorf("expected ctx2 to succeed despite ctx1 cancellation, got %v", err)
	}
}
