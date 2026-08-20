package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"ohmypieno/internal/models"
)

type mockStationProvider struct {
	searchFunc  func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error)
	fuelsFunc   func(ctx context.Context) ([]models.FuelType, error)
	detailFunc  func(ctx context.Context, id int) (*models.GasStation, error)
	geocodeFunc func(ctx context.Context, query, lang string) (any, error)
}

func (m *mockStationProvider) SearchZone(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
	return m.searchFunc(ctx, lat, lng, radius)
}
func (m *mockStationProvider) GetFuels(ctx context.Context) ([]models.FuelType, error) {
	return m.fuelsFunc(ctx)
}
func (m *mockStationProvider) GetServiceArea(ctx context.Context, id int) (*models.GasStation, error) {
	return m.detailFunc(ctx, id)
}
func (m *mockStationProvider) Geocode(ctx context.Context, query, lang string) (any, error) {
	if m.geocodeFunc == nil {
		return []any{}, nil
	}
	return m.geocodeFunc(ctx, query, lang)
}

func TestSearchHandler_RejectsNaNAndInf(t *testing.T) {
	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			t.Fatalf("upstream must not be reached for lat=%v lng=%v", lat, lng)
			return nil, nil
		},
	}
	srv := NewServer(mock, mock)
	srv.Config.LatMin, srv.Config.LatMax = 35.0, 48.0
	srv.Config.LngMin, srv.Config.LngMax = 6.0, 19.0
	srv.Config.MaxRadius = 50

	handler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))
	for _, q := range []string{
		"lat=NaN&lng=12.0", "lat=41.0&lng=NaN",
		"lat=Inf&lng=12.0", "lat=41.0&lng=+Inf", "lat=-Inf&lng=12.0",
	} {
		req := httptest.NewRequest("GET", "/api/search?"+q, nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("query %q: expected 400, got %d", q, rr.Code)
		}
	}
}

func TestSearchHandler_DeepValidation(t *testing.T) {
	mock := &mockStationProvider{}
	srv := NewServer(mock, mock)
	srv.Config.LatMin = 35.0
	srv.Config.LatMax = 48.0
	srv.Config.LngMin = 6.0
	srv.Config.LngMax = 19.0
	srv.Config.MaxRadius = 50

	t.Run("Valid Search with Rules", func(t *testing.T) {
		mock.searchFunc = func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return &models.SearchResponse{
				Success: true,
				Results: []models.GasStation{
					{
						ID: 1, Name: "Test Station",
						Fuels: []models.Fuel{
							{FuelID: 1, Price: 1.5, Name: "Benzina", IsSelf: true},
							{FuelID: 1, Price: 1.8, Name: "Benzina", IsSelf: false},
						},
					},
				},
			}, nil
		}
		searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))
		req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=1", nil)
		rr := httptest.NewRecorder()
		searchHandler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}

		var res models.SearchResponse
		json.NewDecoder(rr.Body).Decode(&res)

		if len(res.Results) != 1 {
			t.Fatal("expected 1 result")
		}
		// Lowest price should be selected (1.5)
		if res.Results[0].SelectedPrice != 1.5 {
			t.Errorf("expected price 1.5, got %f", res.Results[0].SelectedPrice)
		}
	})

	t.Run("Station 31459 GPL/Metano", func(t *testing.T) {
		mock.searchFunc = func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return &models.SearchResponse{
				Success: true,
				Results: []models.GasStation{
					{
						ID: 31459, Name: "31459 Station",
						Fuels: []models.Fuel{
							{FuelID: 5, Price: 1.699, Name: "Metano", IsSelf: false},
							{FuelID: 4, Price: 0.779, Name: "GPL", IsSelf: false},
						},
					},
				},
			}, nil
		}

		searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))
		// GPL (ID 4)
		{
			req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=4", nil)
			rr := httptest.NewRecorder()
			searchHandler.ServeHTTP(rr, req)
			var res models.SearchResponse
			json.NewDecoder(rr.Body).Decode(&res)
			if res.Results[0].SelectedPrice != 0.779 {
				t.Errorf("expected GPL price 0.779, got %f", res.Results[0].SelectedPrice)
			}
		}

		// Metano (ID 5)
		{
			req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=5", nil)
			rr := httptest.NewRecorder()
			searchHandler.ServeHTTP(rr, req)
			var res models.SearchResponse
			json.NewDecoder(rr.Body).Decode(&res)
			if res.Results[0].SelectedPrice != 1.699 {
				t.Errorf("expected Metano price 1.699, got %f", res.Results[0].SelectedPrice)
			}
		}
	})

	t.Run("Invalid Method", func(t *testing.T) {
		searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))
		req := httptest.NewRequest("POST", "/api/search", nil)
		rr := httptest.NewRecorder()
		searchHandler.ServeHTTP(rr, req)
		if rr.Code != http.StatusMethodNotAllowed {
			t.Errorf("expected 405, got %d", rr.Code)
		}
		if allow := rr.Header().Get("Allow"); allow != "GET" {
			t.Errorf("expected Allow: GET on 405, got %q", allow)
		}
	})

	t.Run("Upstream Failure", func(t *testing.T) {
		searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))
		mock.searchFunc = func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return nil, errors.New("boom")
		}
		req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0", nil)
		rr := httptest.NewRecorder()
		searchHandler.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadGateway {
			t.Errorf("expected 502, got %d", rr.Code)
		}
	})
}

func TestSearchHandler_CacheMutationReproduction(t *testing.T) {
	sharedResponse := &models.SearchResponse{
		Results: []models.GasStation{
			{
				ID: 1, Name: "Test Station",
				Fuels: []models.Fuel{
					{FuelID: 1, Price: 1.5, Name: "Benzina", IsSelf: true},
					{FuelID: 2, Price: 1.8, Name: "Gasolio", IsSelf: true},
				},
			},
		},
	}
	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return sharedResponse, nil
		},
	}
	srv := NewServer(mock, mock)
	srv.Config.LatMin = 35.0
	srv.Config.LatMax = 48.0
	srv.Config.LngMin = 6.0
	srv.Config.LngMax = 19.0
	srv.Config.MaxRadius = 50

	searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))

	req1 := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=1", nil)
	rr1 := httptest.NewRecorder()
	searchHandler.ServeHTTP(rr1, req1)
	var res1 models.SearchResponse
	json.NewDecoder(rr1.Body).Decode(&res1)
	if res1.Results[0].SelectedFuelName != "Benzina" {
		t.Errorf("Expected Benzina, got %s", res1.Results[0].SelectedFuelName)
	}

	req2 := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=2", nil)
	rr2 := httptest.NewRecorder()
	searchHandler.ServeHTTP(rr2, req2)
	var res2 models.SearchResponse
	json.NewDecoder(rr2.Body).Decode(&res2)
	if res2.Results[0].SelectedFuelName != "Gasolio" {
		t.Errorf("Expected Gasolio, got %s", res2.Results[0].SelectedFuelName)
	}

	if sharedResponse.Results[0].SelectedFuelName == "Gasolio" {
		t.Errorf("BUG REPRODUCED: Shared response was mutated!")
	}
}

func TestSearchHandler_NoFuelFilter(t *testing.T) {
	// When fuelID is absent the handler now skips the deep-copy and streams
	// the upstream result directly. Verify the response is still correctly
	// shaped and carries no SelectedPrice/SelectedFuelName fields.
	sharedResponse := &models.SearchResponse{
		Success: true,
		Results: []models.GasStation{
			{
				ID: 1, Name: "Test Station",
				Fuels: []models.Fuel{
					{FuelID: 1, Price: 1.5, Name: "Benzina", IsSelf: true},
					{FuelID: 2, Price: 1.8, Name: "Gasolio", IsSelf: true},
				},
			},
		},
	}
	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return sharedResponse, nil
		},
	}
	srv := NewServer(mock, mock)
	srv.Config.LatMin = 35.0
	srv.Config.LatMax = 48.0
	srv.Config.LngMin = 6.0
	srv.Config.LngMax = 19.0
	srv.Config.MaxRadius = 50

	searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))
	req := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0", nil)
	rr := httptest.NewRecorder()
	searchHandler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var res models.SearchResponse
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(res.Results) != 1 || res.Results[0].ID != 1 {
		t.Fatalf("unexpected results: %+v", res.Results)
	}
	if res.Results[0].SelectedPrice != 0 {
		t.Errorf("SelectedPrice should be zero, got %f", res.Results[0].SelectedPrice)
	}
	if res.Results[0].SelectedFuelName != "" {
		t.Errorf("SelectedFuelName should be empty, got %q", res.Results[0].SelectedFuelName)
	}
	if len(res.Results[0].Fuels) != 2 {
		t.Errorf("expected 2 fuels, got %d", len(res.Results[0].Fuels))
	}

	// Subsequent filtered call on the same upstream must still work and
	// must not be contaminated by the unfiltered path.
	req2 := httptest.NewRequest("GET", "/api/search?lat=41.0&lng=12.0&fuel=2", nil)
	rr2 := httptest.NewRecorder()
	searchHandler.ServeHTTP(rr2, req2)
	var res2 models.SearchResponse
	json.NewDecoder(rr2.Body).Decode(&res2)
	if res2.Results[0].SelectedFuelName != "Gasolio" {
		t.Errorf("follow-up filter: expected Gasolio, got %q", res2.Results[0].SelectedFuelName)
	}
	if sharedResponse.Results[0].SelectedPrice != 0 || sharedResponse.Results[0].SelectedFuelName != "" {
		t.Errorf("upstream was mutated: %+v", sharedResponse.Results[0])
	}
}

func TestSearchHandler_Concurrency(t *testing.T) {
	sharedResponse := &models.SearchResponse{
		Results: []models.GasStation{
			{
				ID: 1, Name: "Station 1",
				Fuels: []models.Fuel{
					{FuelID: 1, Price: 1.0, Name: "Benzina", IsSelf: true},
					{FuelID: 2, Price: 2.0, Name: "Gasolio", IsSelf: true},
				},
			},
		},
	}
	mock := &mockStationProvider{
		searchFunc: func(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
			return sharedResponse, nil
		},
	}
	srv := NewServer(mock, mock)
	srv.Config.LatMin = 35.0
	srv.Config.LatMax = 48.0
	srv.Config.LngMin = 6.0
	srv.Config.LngMax = 19.0
	srv.Config.MaxRadius = 50

	searchHandler := srv.ValidateSearchMiddleware(http.HandlerFunc(srv.SearchHandler))

	const workers = 20
	errChan := make(chan error, workers)
	for i := 0; i < workers; i++ {
		fuelID := (i % 2) + 1
		expectedName := "Benzina"
		if fuelID == 2 {
			expectedName = "Gasolio"
		}
		go func(fid int, name string) {
			path := fmt.Sprintf("/api/search?lat=41.0&lng=12.0&fuel=%d", fid)
			req := httptest.NewRequest("GET", path, nil)
			rr := httptest.NewRecorder()
			searchHandler.ServeHTTP(rr, req)
			var res models.SearchResponse
			json.NewDecoder(rr.Body).Decode(&res)
			if res.Results[0].SelectedFuelName != name {
				errChan <- fmt.Errorf("expected %s, got %s", name, res.Results[0].SelectedFuelName)
				return
			}
			errChan <- nil
		}(fuelID, expectedName)
	}
	for i := 0; i < workers; i++ {
		if err := <-errChan; err != nil {
			t.Error(err)
		}
	}
}

func TestGeocodeHandler(t *testing.T) {
	mock := &mockStationProvider{
		geocodeFunc: func(ctx context.Context, query, lang string) (any, error) {
			if query == "error" {
				return nil, errors.New("boom")
			}
			return []map[string]string{{"name": "Roma"}}, nil
		},
	}
	srv := NewServer(mock, mock)
	srv.Config.LatMin = 35.0
	srv.Config.LatMax = 48.0
	srv.Config.LngMin = 6.0
	srv.Config.LngMax = 19.0
	srv.Config.MaxRadius = 50
	t.Run("Success", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/geocode?q=roma", nil)
		rr := httptest.NewRecorder()
		srv.GeocodeHandler(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("WhitespaceOnlyRejected", func(t *testing.T) {
		called := false
		mock.geocodeFunc = func(ctx context.Context, query, lang string) (any, error) {
			called = true
			return nil, nil
		}
		req := httptest.NewRequest("GET", "/api/geocode?q=%20%20", nil)
		rr := httptest.NewRecorder()
		srv.GeocodeHandler(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for whitespace-only query, got %d", rr.Code)
		}
		if called {
			t.Errorf("upstream geocoder should not be invoked for whitespace-only query")
		}
	})
}

func TestStationHandler_DeepValidation(t *testing.T) {
	mock := &mockStationProvider{
		detailFunc: func(ctx context.Context, id int) (*models.GasStation, error) {
			return &models.GasStation{ID: id, Name: "Details"}, nil
		},
	}
	srv := NewServer(mock, mock)
	srv.Config.LatMin = 35.0
	srv.Config.LatMax = 48.0
	srv.Config.LngMin = 6.0
	srv.Config.LngMax = 19.0
	srv.Config.MaxRadius = 50
	t.Run("Valid ID", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/station?id=123", nil)
		rr := httptest.NewRecorder()
		srv.StationHandler(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("Invalid IDs rejected", func(t *testing.T) {
		for _, id := range []string{"", "0", "-5", "abc", "100000001"} {
			req := httptest.NewRequest("GET", "/api/station?id="+id, nil)
			rr := httptest.NewRecorder()
			srv.StationHandler(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf("id=%q: expected 400, got %d", id, rr.Code)
			}
		}
	})

	t.Run("Large valid ID accepted", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/station?id=99999999", nil)
		rr := httptest.NewRecorder()
		srv.StationHandler(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 for large-but-valid id, got %d", rr.Code)
		}
	})
}
