package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 10 * time.Second
	writeTimeout      = 15 * time.Second
	idleTimeout       = 60 * time.Second
	shutdownTimeout   = 15 * time.Second
	maxHeaderBytes    = 1 << 20
)

func runServer(logger *slog.Logger, port int, trafficPointStore *trafficPointStore) error {
	server := newHTTPServer(logger, port, trafficPointStore)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)

	go func() {
		logger.Info("server starting", slog.Int("port", port))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case err := <-serverErr:
		if err != nil {
			return err
		}
	case <-ctx.Done():
		logger.Info("shutdown signal received")

		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("graceful shutdown failed", slog.String("error", err.Error()))
			if closeErr := server.Close(); closeErr != nil {
				logger.Error("forced close failed", slog.String("error", closeErr.Error()))
			}
			return err
		}

		if err := <-serverErr; err != nil {
			return err
		}
	}

	logger.Info("server stopped")
	return nil
}

func newHTTPServer(logger *slog.Logger, port int, trafficPointStore *trafficPointStore) *http.Server {
	return &http.Server{
		Addr:              net.JoinHostPort("", strconv.Itoa(port)),
		Handler:           withRecovery(logger, newHandler(logger, trafficPointStore)),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    maxHeaderBytes,
	}
}
