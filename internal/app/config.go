package app

import (
	"os"
	"time"
)

type Config struct {
	BaseURL      string
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration

	// Validation
	LatMin    float64
	LatMax    float64
	LngMin    float64
	LngMax    float64
	MaxRadius int

	// TrustProxyHeaders controls whether X-Forwarded-For is honored for
	// client IP detection (used by the rate limiter). Enable only when
	// deployed behind a trusted reverse proxy.
	TrustProxyHeaders bool
}

func LoadConfig() *Config {
	baseURL := os.Getenv("OHMYPIENO_API_URL")
	if baseURL == "" {
		baseURL = "https://carburanti.mise.gov.it/ospzApi"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		BaseURL:     baseURL,
		Port:        port,
		ReadTimeout: 5 * time.Second,
		// Must exceed the longest upstream client timeout (stations: 15s) or a
		// slow MIMIT reply gets truncated by the write deadline.
		WriteTimeout: 20 * time.Second,
		IdleTimeout:  120 * time.Second,

		LatMin:    35.0,
		LatMax:    48.0,
		LngMin:    6.0,
		LngMax:    19.0,
		MaxRadius: 50,

		TrustProxyHeaders: os.Getenv("TRUST_PROXY_HEADERS") == "true",
	}
}
