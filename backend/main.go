package main

import (
	"log/slog"
	"os"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	port, err := parsePort(os.Args[1:])
	if err != nil {
		logger.Error("invalid port", slog.String("error", err.Error()))
		os.Exit(2)
	}

	trafficPointStore, err := openTrafficPointStore()
	if err != nil {
		logger.Error("open traffic point database", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer func() {
		if closeErr := trafficPointStore.Close(); closeErr != nil {
			logger.Error("close traffic point database", slog.String("error", closeErr.Error()))
		}
	}()

	if err := runServer(logger, port, trafficPointStore); err != nil {
		logger.Error("server stopped with error", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
