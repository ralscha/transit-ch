package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteTrafficPointJSONSetsBrowserCacheHeader(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeTrafficPointJSON(recorder, http.StatusOK, storedTrafficPointEntry{
		Lat: "47.3763000",
		Lng: "8.5476000",
	})

	if got := recorder.Header().Get("Cache-Control"); got != trafficPointCacheControlHeader {
		t.Fatalf("cache-control header mismatch: got %q want %q", got, trafficPointCacheControlHeader)
	}
}

func TestWriteJSONErrorDisablesCaching(t *testing.T) {
	recorder := httptest.NewRecorder()

	writeJSONError(recorder, http.StatusBadRequest, "bad request")

	if got := recorder.Header().Get("Cache-Control"); got != errorResponseCacheControl {
		t.Fatalf("cache-control header mismatch: got %q want %q", got, errorResponseCacheControl)
	}
}
