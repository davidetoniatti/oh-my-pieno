package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"ohmypieno/internal/api"
	"ohmypieno/internal/models"
)

type Server struct {
	Client   api.StationProvider
	Geocoder api.Geocoder
	Config   struct {
		LatMin    float64
		LatMax    float64
		LngMin    float64
		LngMax    float64
		MaxRadius int
	}
}

func NewServer(client api.StationProvider, geocoder api.Geocoder) *Server {
	return &Server{
		Client:   client,
		Geocoder: geocoder,
	}
}

func (s *Server) SearchHandler(w http.ResponseWriter, r *http.Request) {
	lat, _ := r.Context().Value(LatKey).(float64)
	lng, _ := r.Context().Value(LngKey).(float64)
	radius, _ := r.Context().Value(RadiusKey).(int)

	fuelIDStr := r.URL.Query().Get("fuel")
	fuelID, _ := strconv.Atoi(fuelIDStr)

	result, err := s.Client.SearchZone(r.Context(), lat, lng, radius)
	if err != nil {
		s.handleError(w, NewAppError(http.StatusBadGateway, "upstream service error", err))
		return
	}

	// Without fuel filter we don't enrich: stream the upstream results as-is.
	results := result.Results
	if fuelID > 0 {
		results = make([]models.GasStation, len(result.Results))
		for i := range result.Results {
			results[i] = result.Results[i]
			// Deep copy Fuels so enrichment can't mutate the shared cached data.
			if result.Results[i].Fuels != nil {
				results[i].Fuels = make([]models.Fuel, len(result.Results[i].Fuels))
				copy(results[i].Fuels, result.Results[i].Fuels)
			}
			price, name := s.calculateSelectedPrice(&results[i], fuelID)
			results[i].SelectedPrice = price
			results[i].SelectedFuelName = name
		}
	}

	response := models.SearchResponse{
		Success: result.Success,
		Center:  result.Center,
		Results: results,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		slog.Error("json encode error", "error", err)
	}
}

func (s *Server) writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("json encode error", "error", err)
	}
}

func (s *Server) calculateSelectedPrice(station *models.GasStation, fuelID int) (float64, string) {
	var bestPrice float64
	var fuelName string

	for _, f := range station.Fuels {
		if !s.isFuelMatch(f, fuelID) {
			continue
		}

		if bestPrice == 0 || f.Price < bestPrice {
			bestPrice = f.Price
			fuelName = f.Name
		}
	}
	return bestPrice, fuelName
}

func (s *Server) isFuelMatch(f models.Fuel, fuelID int) bool {
	// We use the FuelID provided by the upstream API to match exactly.
	return f.FuelID == fuelID
}

func (s *Server) StationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		s.handleError(w, NewAppError(http.StatusMethodNotAllowed, "method not allowed", nil))
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		s.handleError(w, NewAppError(http.StatusBadRequest, "id required", nil))
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 || id > 1000000 {
		s.handleError(w, NewAppError(http.StatusBadRequest, "invalid station id", err))
		return
	}
	station, err := s.Client.GetServiceArea(r.Context(), id)
	if err != nil {
		s.handleError(w, NewAppError(http.StatusBadGateway, "upstream service error", err))
		return
	}
	s.writeJSON(w, station)
}

func (s *Server) FuelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		s.handleError(w, NewAppError(http.StatusMethodNotAllowed, "method not allowed", nil))
		return
	}
	fuels, err := s.Client.GetFuels(r.Context())
	if err != nil {
		s.handleError(w, NewAppError(http.StatusBadGateway, "upstream service error", err))
		return
	}
	s.writeJSON(w, fuels)
}

func (s *Server) GeocodeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		s.handleError(w, NewAppError(http.StatusMethodNotAllowed, "method not allowed", nil))
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		s.handleError(w, NewAppError(http.StatusBadRequest, "query required", nil))
		return
	}
	if len(q) > 200 {
		s.handleError(w, NewAppError(http.StatusBadRequest, "query too long", nil))
		return
	}

	results, err := s.Geocoder.Geocode(r.Context(), q, r.Header.Get("Accept-Language"))
	if err != nil {
		s.handleError(w, NewAppError(http.StatusBadGateway, "geocoding service error", err))
		return
	}
	s.writeJSON(w, results)
}
