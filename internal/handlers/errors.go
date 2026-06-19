package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type AppError struct {
	Status   int    `json:"-"`
	Message  string `json:"error"`
	Internal error  `json:"-"`
}

func (e *AppError) Error() string {
	if e.Internal != nil {
		return e.Internal.Error()
	}
	return e.Message
}

func NewAppError(status int, message string, internal error) *AppError {
	return &AppError{
		Status:   status,
		Message:  message,
		Internal: internal,
	}
}

func (s *Server) handleError(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}

	appErr, ok := err.(*AppError)
	if !ok {
		appErr = NewAppError(http.StatusInternalServerError, "internal server error", err)
	}

	if appErr.Status >= 500 {
		slog.Error("server error", "status", appErr.Status, "message", appErr.Message, "error", appErr.Internal)
	} else {
		slog.Warn("client error", "status", appErr.Status, "message", appErr.Message, "error", appErr.Internal)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(appErr.Status)
	if err := json.NewEncoder(w).Encode(appErr); err != nil {
		slog.Error("error response encode failed", "error", err)
	}
}
