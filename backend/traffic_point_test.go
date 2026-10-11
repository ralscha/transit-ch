package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"
	"transit-ch/internal/platformstore"
)

func TestPlatformAPIExactCompoundAndUnavailable(t *testing.T) {
	entries := []platformstore.Entry{{Station: 8503000, Point: platformstore.Point{Platform: "41", Sloid: "id41", Lat: 47.37882261044, Lng: 8.53875973746}}, {Station: 8503000, Point: platformstore.Point{Platform: "42", Sloid: "id42", Lat: 47.3789, Lng: 8.5388}}}
	data, err := platformstore.Encode(entries, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	store, err := platformstore.Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	handler := newHandler(slog.New(slog.NewTextHandler(io.Discard, nil)), store)
	for _, test := range []struct {
		url           string
		status, count int
	}{
		{"/traffic-point-v2/8503000?platform=41", 200, 1},
		{"/traffic-point-v2/8503000/42", 200, 1},
		{"/traffic-point-v2/8503000?platform=41%2F42", 200, 2},
		{"/traffic-point-v2/8503000?platform=41%2F41", 200, 1},
		{"/traffic-point-v2/8503000?platform=41%2F99", 404, 0},
		{"/traffic-point-v2/8503000?platform=41A", 404, 0},
		{"/traffic-point-v2/8503000?platform=99", 404, 0},
		{"/traffic-point-v2/8503001?platform=41", 404, 0},
		{"/traffic-point-v2/8503000", 400, 0},
		{"/traffic-point-v2/-1?platform=41", 400, 0},
	} {
		t.Run(test.url, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest("GET", test.url, nil))
			if recorder.Code != test.status {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			if test.status == 200 {
				var response struct {
					Points []platformstore.Point `json:"points"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if len(response.Points) != test.count {
					t.Fatal(response)
				}
				if recorder.Header().Get("Cache-Control") != trafficPointCacheControlHeader {
					t.Fatal("missing cache header")
				}
				if response.Points[0].Platform == "41" && response.Points[0].Lat != entries[0].Point.Lat {
					t.Fatal("coordinate precision lost")
				}
			} else if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("errors must not be cached")
			}
		})
	}
}
