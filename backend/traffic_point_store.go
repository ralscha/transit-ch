package main

import (
	"os"
	"transit-ch/internal/platformstore"
)

type trafficPointStore = platformstore.Store

func openTrafficPointStore() (*trafficPointStore, error) {
	filename := os.Getenv("PLATFORM_DB")
	if filename == "" {
		filename = "platforms.bin"
	}
	return platformstore.Open(filename)
}
