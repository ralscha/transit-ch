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
	logger.Info("platform snapshot loaded", slog.Int("platforms", trafficPointStore.Count()), slog.Int("bytes", trafficPointStore.Size()), slog.String("date", trafficPointStore.Date().Format("2006-01-02")))

	if err := runServer(logger, port, trafficPointStore); err != nil {
		logger.Error("server stopped with error", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
