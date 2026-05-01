package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

const (
	contentTypeJSON                = "application/json; charset=utf-8"
	contentTypeText                = "text/plain; charset=utf-8"
	errorResponseCacheControl      = "no-store"
	trafficPointCacheControlHeader = "private, max-age=86400"
)

type apiHandler struct {
	logger            *slog.Logger
	trafficPointStore *trafficPointStore
}

func newHandler(logger *slog.Logger, trafficPointStore *trafficPointStore) http.Handler {
	handler := apiHandler{logger: logger, trafficPointStore: trafficPointStore}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /traffic-point-v2/{number}", handler.handleTrafficPoint)
	mux.HandleFunc("GET /traffic-point-v2/{number}/{designation}", handler.handleTrafficPoint)
	return mux
}

func withRecovery(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error(
					"panic while serving request",
					slog.Any("panic", recovered),
					slog.String("method", request.Method),
					slog.String("path", request.URL.Path),
				)
				writeJSONError(writer, http.StatusInternalServerError, "internal server error")
			}
		}()

		next.ServeHTTP(writer, request)
	})
}

func writeJSON(writer http.ResponseWriter, statusCode int, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		writer.Header().Set("Content-Type", contentTypeText)
		http.Error(writer, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	writer.Header().Set("Content-Type", contentTypeJSON)
	writer.Header().Set("Cache-Control", errorResponseCacheControl)
	writer.WriteHeader(statusCode)

	_, _ = writer.Write(payload)
}

func writeJSONError(writer http.ResponseWriter, statusCode int, message string) {
	writeJSON(writer, statusCode, map[string]string{"error": message})
}

func notFound(writer http.ResponseWriter) {
	writer.Header().Set("Content-Type", contentTypeText)
	http.Error(writer, http.StatusText(http.StatusNotFound), http.StatusNotFound)
}
