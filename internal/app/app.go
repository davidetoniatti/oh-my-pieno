package app

import (
	"compress/gzip"
	"context"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"ohmypieno/internal/api"
	"ohmypieno/internal/cache"
	"ohmypieno/internal/handlers"
	"ohmypieno/internal/models"
	"ohmypieno/internal/obs"
)

type App struct {
	server        *http.Server
	stationsCache *cache.Cache[*models.SearchResponse]
	detailsCache  *cache.Cache[*models.GasStation]
	geocodeCache  *cache.Cache[[]any]
	rateLimiter   *rateLimiter
}

func New(cfg *Config, staticFiles fs.FS) (*App, error) {
	stationsCache := cache.New[*models.SearchResponse]()
	detailsCache := cache.New[*models.GasStation]()
	geocodeCache := cache.New[[]any]()
	apiClient := api.NewClient(cfg.BaseURL, stationsCache, detailsCache)
	geocodeClient := api.NewNominatimClient(geocodeCache)
	h := handlers.NewServer(apiClient, geocodeClient)
	h.Config.LatMin = cfg.LatMin
	h.Config.LatMax = cfg.LatMax
	h.Config.LngMin = cfg.LngMin
	h.Config.LngMax = cfg.LngMax
	h.Config.MaxRadius = cfg.MaxRadius

	mux := http.NewServeMux()
	mux.Handle("/api/search", h.ValidateSearchMiddleware(http.HandlerFunc(h.SearchHandler)))
	mux.HandleFunc("/api/station", h.StationHandler)
	mux.HandleFunc("/api/fuels", h.FuelsHandler)
	mux.HandleFunc("/api/geocode", h.GeocodeHandler)

	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return nil, err
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))

	rl := newRateLimiter(cfg.TrustProxyHeaders)

	// Chain middlewares: Logging -> SecurityHeaders -> Gzip -> RateLimit -> Cache-Control
	handler := loggingMiddleware(securityHeadersMiddleware(gzipMiddleware(rl.middleware(cacheControlMiddleware(mux)))))

	srv := &http.Server{
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	return &App{
		server:        srv,
		stationsCache: stationsCache,
		detailsCache:  detailsCache,
		geocodeCache:  geocodeCache,
		rateLimiter:   rl,
	}, nil
}

func (a *App) Run(addr string) error {
	a.server.Addr = addr
	slog.Info("server starting", "addr", addr)
	return a.server.ListenAndServe()
}

func (a *App) Handler() http.Handler {
	return a.server.Handler
}

func (a *App) Close() {
	a.stationsCache.Stop()
	a.detailsCache.Stop()
	a.geocodeCache.Stop()
	a.rateLimiter.stop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx, timing := obs.WithTiming(r.Context())
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r.WithContext(ctx))
		upstream, calls := timing.Snapshot()
		slog.Info("request handled",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start),
			"upstream", upstream,
			"upstream_calls", calls)
	})
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// default-src 'none' provides a secure baseline.
		// style-src 'unsafe-inline' is required for Leaflet dynamic marker coloring.
		// img-src data: is required for Leaflet marker shadow/assets.
		h.Set("Content-Security-Policy", "default-src 'none'; script-src 'self' unpkg.com; style-src 'self' unpkg.com fonts.googleapis.com 'unsafe-inline'; font-src fonts.gstatic.com; img-src 'self' *.tile.openstreetmap.org unpkg.com data:; connect-src 'self' unpkg.com; manifest-src 'self'; base-uri 'self'; form-action 'self';")
		next.ServeHTTP(w, r)
	})
}

func cacheControlMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/fuels":
			// Hardcoded constant, safe to cache for a day.
			w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
		case strings.HasPrefix(r.URL.Path, "/api/"):
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
		case r.URL.Path == "/" || strings.HasSuffix(r.URL.Path, ".html"):
			w.Header().Set("Cache-Control", "no-cache")
		case strings.Contains(r.URL.Path, "/js/") || strings.Contains(r.URL.Path, "/css/"):
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		next.ServeHTTP(w, r)
	})
}

var gzipWriterPool = sync.Pool{
	New: func() any { return gzip.NewWriter(io.Discard) },
}

// Compressible content types. Prefix-matched against Content-Type (charset
// suffix stripped). Already-compressed formats (images, video, woff2, zip)
// fall through to passthrough.
var compressibleTypes = []string{
	"text/",
	"application/json",
	"application/javascript",
	"application/xml",
	"application/xhtml+xml",
	"application/rss+xml",
	"application/atom+xml",
	"application/ld+json",
	"application/manifest+json",
	"image/svg+xml",
	"font/ttf",
	"font/otf",
}

func isCompressibleType(ct string) bool {
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	for _, p := range compressibleTypes {
		if strings.HasPrefix(ct, p) {
			return true
		}
	}
	return false
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	decided     bool
	passthrough bool
}

func (w *gzipResponseWriter) decide() {
	if w.decided {
		return
	}
	w.decided = true

	// Handler already encoded (e.g. pre-gzipped asset): don't double-wrap.
	if w.Header().Get("Content-Encoding") != "" {
		w.passthrough = true
		return
	}

	ct := w.Header().Get("Content-Type")
	if !isCompressibleType(ct) {
		w.passthrough = true
		return
	}

	h := w.Header()
	h.Del("Content-Length")
	h.Add("Vary", "Accept-Encoding")
	h.Set("Content-Encoding", "gzip")

	w.gz = gzipWriterPool.Get().(*gzip.Writer)
	w.gz.Reset(w.ResponseWriter)
}

func (w *gzipResponseWriter) WriteHeader(code int) {
	w.decide()
	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if !w.decided {
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", http.DetectContentType(b))
		}
		w.decide()
	}
	if w.passthrough {
		return w.ResponseWriter.Write(b)
	}
	return w.gz.Write(b)
}

func (w *gzipResponseWriter) Flush() {
	if w.gz != nil {
		w.gz.Flush()
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *gzipResponseWriter) close() {
	if w.gz == nil {
		return
	}
	w.gz.Close()
	w.gz.Reset(io.Discard)
	gzipWriterPool.Put(w.gz)
	w.gz = nil
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") ||
			r.Header.Get("Sec-WebSocket-Key") != "" {
			next.ServeHTTP(w, r)
			return
		}

		gzw := &gzipResponseWriter{ResponseWriter: w}
		defer gzw.close()
		next.ServeHTTP(gzw, r)
	})
}
