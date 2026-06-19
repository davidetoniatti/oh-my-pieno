package main

import (
	"context"
	"embed"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"ohmypieno/internal/app"
)

//go:embed static
var staticFiles embed.FS

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := app.LoadConfig()

	application, err := app.New(cfg, staticFiles)
	if err != nil {
		slog.Error("failed to create app", "error", err)
		os.Exit(1)
	}

	// Drain gracefully on SIGINT/SIGTERM (e.g. `docker stop`).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Listen in the background so we can also wait for a shutdown signal.
	errCh := make(chan error, 1)
	go func() { errCh <- application.Run(":" + cfg.Port) }()

	select {
	case err := <-errCh:
		// Stopped on its own (e.g. port in use); Close() hasn't run yet.
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server stopped with error", "error", err)
			application.Close()
			os.Exit(1)
		}
	case <-ctx.Done():
		slog.Info("shutdown signal received, draining")
		application.Close()
	}

	slog.Info("server stopped gracefully")
}
