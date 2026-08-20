package handlers

import (
	"context"
	"math"
	"net/http"
	"strconv"
)

type contextKey string

const (
	LatKey    contextKey = "lat"
	LngKey    contextKey = "lng"
	RadiusKey contextKey = "radius"
)

func (s *Server) ValidateSearchMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			s.handleError(w, NewAppError(http.StatusMethodNotAllowed, "method not allowed", nil))
			return
		}

		q := r.URL.Query()
		latStr := q.Get("lat")
		lngStr := q.Get("lng")
		radiusStr := q.Get("radius")

		if latStr == "" || lngStr == "" {
			s.handleError(w, NewAppError(http.StatusBadRequest, "lat and lng are required", nil))
			return
		}

		// NaN/Inf parse without error and slip past every range comparison
		// (all comparisons with NaN are false), so reject them explicitly.
		lat, err := strconv.ParseFloat(latStr, 64)
		if err != nil || math.IsNaN(lat) || math.IsInf(lat, 0) || lat < s.Config.LatMin || lat > s.Config.LatMax {
			s.handleError(w, NewAppError(http.StatusBadRequest, "invalid or out of range lat", err))
			return
		}

		lng, err := strconv.ParseFloat(lngStr, 64)
		if err != nil || math.IsNaN(lng) || math.IsInf(lng, 0) || lng < s.Config.LngMin || lng > s.Config.LngMax {
			s.handleError(w, NewAppError(http.StatusBadRequest, "invalid or out of range lng", err))
			return
		}

		radius, _ := strconv.Atoi(radiusStr)
		if radius <= 0 {
			radius = 5
		}
		if radius > s.Config.MaxRadius {
			s.handleError(w, NewAppError(http.StatusBadRequest, "radius too large", nil))
			return
		}

		ctx := context.WithValue(r.Context(), LatKey, lat)
		ctx = context.WithValue(ctx, LngKey, lng)
		ctx = context.WithValue(ctx, RadiusKey, radius)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
