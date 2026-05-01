package main

import (
	"testing"
)

func TestStoredTrafficPointEntryToJSONPreservesCoordinateFormatting(t *testing.T) {
	entry := storedTrafficPointEntry{
		Lat: "47.3763000",
		Lng: "8.5476000",
	}

	const want = `{"lat":47.3763000,"lng":8.5476000}`
	if got := string(entry.toJSON()); got != want {
		t.Fatalf("json payload mismatch: got %s want %s", got, want)
	}
}
