package main

import (
	"net/http"
	"strconv"
	"strings"
	"transit-ch/internal/platformstore"
)

func (handler apiHandler) handleTrafficPoint(writer http.ResponseWriter, request *http.Request) {
	number, err := strconv.ParseUint(request.PathValue("number"), 10, 32)
	if err != nil || number == 0 {
		writeJSONError(writer, http.StatusBadRequest, "station must be a positive integer")
		return
	}
	platform := request.PathValue("designation")
	if platform == "" {
		platform = request.URL.Query().Get("platform")
	}
	platform = platformstore.Normalize(platform)
	if platform == "" || len(platform) > 96 {
		writeJSONError(writer, http.StatusBadRequest, "platform is required (maximum 96 bytes)")
		return
	}
	var points [8][]byte
	count := 0
	if point := handler.trafficPointStore.Lookup(uint32(number), platform); point != nil {
		points[0] = point
		count = 1
	} else {
		// Exact compound labels take priority. Slash-separated alternatives must
		// all resolve; never substitute the station centre or an arbitrary edge.
		parts := strings.Split(platform, "/")
		if len(parts) < 2 || len(parts) > len(points) {
			writeJSONError(writer, http.StatusNotFound, "platform location unavailable")
			return
		}
		seen := make(map[string]bool, len(parts))
		for _, part := range parts {
			part = platformstore.Normalize(part)
			if seen[part] {
				continue
			}
			point := handler.trafficPointStore.Lookup(uint32(number), part)
			if point == nil {
				writeJSONError(writer, http.StatusNotFound, "platform location unavailable")
				return
			}
			seen[part] = true
			points[count] = point
			count++
		}
	}
	writer.Header().Set("Content-Type", contentTypeJSON)
	writer.Header().Set("Cache-Control", trafficPointCacheControlHeader)
	writer.Header().Set("X-Platform-Data-Date", handler.trafficPointStore.Date().Format("2006-01-02"))
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write([]byte(`{"points":[`))
	for i := 0; i < count; i++ {
		if i > 0 {
			_, _ = writer.Write([]byte(","))
		}
		_, _ = writer.Write(points[i])
	}
	_, _ = writer.Write([]byte("]}"))
}
