package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/sync/singleflight"

	"ohmypieno/internal/cache"
	"ohmypieno/internal/models"
	"ohmypieno/internal/obs"
)

// Caps on buffered upstream responses, so a misbehaving upstream can't OOM us.
const (
	maxUpstreamBytes = 10 << 20 // 10 MiB
	maxErrorBytes    = 4 << 10  // 4 KiB
)

type StationProvider interface {
	SearchZone(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error)
	GetServiceArea(ctx context.Context, id int) (*models.GasStation, error)
	GetFuels(ctx context.Context) ([]models.FuelType, error)
}

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
	Stations   *cache.Cache[*models.SearchResponse]
	Details    *cache.Cache[*models.GasStation]
	sfGroup    singleflight.Group
}

var _ StationProvider = (*Client)(nil)

func NewClient(baseURL string, stations *cache.Cache[*models.SearchResponse], details *cache.Cache[*models.GasStation]) *Client {
	return &Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		Stations: stations,
		Details:  details,
	}
}

func (c *Client) doRequest(ctx context.Context, method, url string, body []byte) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; OhMyPienoApp/1.0)")
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	start := time.Now()
	resp, err := c.HTTPClient.Do(req)
	obs.Record(ctx, time.Since(start))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBytes))
		return nil, fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(b))
	}

	return io.ReadAll(io.LimitReader(resp.Body, maxUpstreamBytes))
}

func (c *Client) SearchZone(ctx context.Context, lat, lng float64, radius int) (*models.SearchResponse, error) {
	// Quantize coordinates to improve cache hits
	qLat := math.Round(lat*10000) / 10000
	qLng := math.Round(lng*10000) / 10000

	cacheKey := fmt.Sprintf("%f:%f:%d", qLat, qLng, radius)

	// Check cache
	if val, found := c.Stations.Get(cacheKey); found {
		return val, nil
	}

	// Coalesce identical requests
	ch := c.sfGroup.DoChan(cacheKey, func() (any, error) {
		payload := models.SearchRequest{
			Points: []models.Location{{Lat: lat, Lng: lng}},
			Radius: radius,
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}

		// WithoutCancel preserves context values (e.g. the obs.Timing
		// tracker) while decoupling the shared upstream call from the
		// leader's cancellation. HTTPClient.Timeout bounds the call.
		respBody, err := c.doRequest(context.WithoutCancel(ctx), "POST", c.BaseURL+"/search/zone", body)
		if err != nil {
			return nil, err
		}

		var searchRes models.SearchResponse
		if err := json.Unmarshal(respBody, &searchRes); err != nil {
			return nil, err
		}

		c.Stations.Set(cacheKey, &searchRes, 5*time.Minute)
		return &searchRes, nil
	})

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, res.Err
		}
		return res.Val.(*models.SearchResponse), nil
	}
}

func (c *Client) GetServiceArea(ctx context.Context, id int) (*models.GasStation, error) {
	cacheKey := strconv.Itoa(id)
	if val, found := c.Details.Get(cacheKey); found {
		return val, nil
	}

	// Coalesce station detail requests too
	ch := c.sfGroup.DoChan(cacheKey, func() (any, error) {
		url := fmt.Sprintf("%s/registry/servicearea/%d", c.BaseURL, id)
		// See SearchZone for why this is WithoutCancel rather than ctx.
		respBody, err := c.doRequest(context.WithoutCancel(ctx), "GET", url, nil)
		if err != nil {
			return nil, err
		}

		var station models.GasStation
		if err := json.Unmarshal(respBody, &station); err != nil {
			return nil, err
		}

		c.Details.Set(cacheKey, &station, 10*time.Minute)
		return &station, nil
	})

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, res.Err
		}
		return res.Val.(*models.GasStation), nil
	}
}

func (c *Client) GetFuels(ctx context.Context) ([]models.FuelType, error) {
	return []models.FuelType{
		{ID: 1, Name: "Benzina"},
		{ID: 2, Name: "Gasolio"},
		{ID: 3, Name: "HVO"},
		{ID: 4, Name: "GPL"},
		{ID: 5, Name: "Metano"},
	}, nil
}
