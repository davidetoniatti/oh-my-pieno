package app

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func runGzipMiddleware(handler http.HandlerFunc, acceptEncoding string) *httptest.ResponseRecorder {
	mw := gzipMiddleware(handler)
	req := httptest.NewRequest("GET", "/", nil)
	if acceptEncoding != "" {
		req.Header.Set("Accept-Encoding", acceptEncoding)
	}
	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, req)
	return rr
}

func TestGzip_CompressesJSON(t *testing.T) {
	body := strings.Repeat("hello world ", 200)
	rr := runGzipMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, body)
	}, "gzip")

	if rr.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected Content-Encoding: gzip, got %q", rr.Header().Get("Content-Encoding"))
	}
	if rr.Header().Get("Vary") != "Accept-Encoding" {
		t.Errorf("expected Vary: Accept-Encoding, got %q", rr.Header().Get("Vary"))
	}

	gz, err := gzip.NewReader(rr.Body)
	if err != nil {
		t.Fatalf("invalid gzip stream: %v", err)
	}
	defer gz.Close()
	decoded, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("gunzip read: %v", err)
	}
	if string(decoded) != body {
		t.Errorf("decoded body mismatch")
	}
}

func TestGzip_SkipsCompressedContentTypes(t *testing.T) {
	cases := []string{
		"image/png",
		"image/jpeg",
		"video/mp4",
		"font/woff2",
		"application/zip",
	}
	payload := []byte("binary blob")
	for _, ct := range cases {
		t.Run(ct, func(t *testing.T) {
			rr := runGzipMiddleware(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", ct)
				w.Write(payload)
			}, "gzip")

			if rr.Header().Get("Content-Encoding") == "gzip" {
				t.Errorf("%s should not be gzipped", ct)
			}
			if !bytes.Equal(rr.Body.Bytes(), payload) {
				t.Errorf("body mutated for %s", ct)
			}
		})
	}
}

func TestGzip_SkipsWithoutAcceptEncoding(t *testing.T) {
	rr := runGzipMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, "hello")
	}, "")
	if rr.Header().Get("Content-Encoding") != "" {
		t.Errorf("unexpected Content-Encoding: %q", rr.Header().Get("Content-Encoding"))
	}
	if rr.Body.String() != "hello" {
		t.Errorf("body mismatch: %q", rr.Body.String())
	}
}

// Regression: the middleware must not clobber a Vary value set by an
// upstream handler (e.g. one that also varies on Origin for CORS).
func TestGzip_PreservesExistingVary(t *testing.T) {
	rr := runGzipMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, strings.Repeat("x", 200))
	}, "gzip")

	values := rr.Header().Values("Vary")
	seen := map[string]bool{}
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			seen[strings.TrimSpace(part)] = true
		}
	}
	if !seen["Origin"] {
		t.Errorf("Vary should still include Origin, got %v", values)
	}
	if !seen["Accept-Encoding"] {
		t.Errorf("Vary should include Accept-Encoding, got %v", values)
	}
}

// Regression: Flush must reach the real writer even when it sits behind a
// wrapper (statusRecorder) that doesn't itself implement http.Flusher.
func TestGzip_FlushReachesUnderlyingWriter(t *testing.T) {
	rec := httptest.NewRecorder()
	sr := &statusRecorder{ResponseWriter: rec, status: http.StatusOK}
	gzw := &gzipResponseWriter{ResponseWriter: sr, acceptsGzip: true}

	gzw.Header().Set("Content-Type", "application/json")
	io.WriteString(gzw, `{"k":"v"}`)
	gzw.Flush()

	if !rec.Flushed {
		t.Error("Flush did not propagate through statusRecorder to the underlying writer")
	}
}

func TestGzip_DropsContentLength(t *testing.T) {
	body := strings.Repeat("x", 1024)
	rr := runGzipMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Length", "1024")
		io.WriteString(w, body)
	}, "gzip")

	if rr.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip, got %q", rr.Header().Get("Content-Encoding"))
	}
	if rr.Header().Get("Content-Length") != "" {
		t.Errorf("Content-Length should be dropped, got %q", rr.Header().Get("Content-Length"))
	}
}
