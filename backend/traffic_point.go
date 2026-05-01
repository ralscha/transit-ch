package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
)

func (entry storedTrafficPointEntry) toJSON() []byte {
	payload := make([]byte, 0, 32)
	payload = append(payload, '{', '"', 'l', 'a', 't', '"', ':')
	payload = append(payload, entry.Lat...)
	payload = append(payload, ',', '"', 'l', 'n', 'g', '"', ':')
	payload = append(payload, entry.Lng...)
	payload = append(payload, '}')
	return payload
}

type trafficPointRequest struct {
	number      int
	designation string
}

func (handler apiHandler) handleTrafficPoint(writer http.ResponseWriter, request *http.Request) {
	trafficPoint, statusCode, err := parseTrafficPointRequest(request)
	if err != nil {
		if statusCode == http.StatusNotFound {
			notFound(writer)
			return
		}

		writeJSONError(writer, statusCode, err.Error())
		return
	}

	response, found, err := handler.trafficPointStore.Lookup(trafficPoint)
	if err != nil {
		handler.logger.Error(
			"traffic point lookup failed",
			slog.Int("number", trafficPoint.number),
			slog.String("designation", trafficPoint.designation),
			slog.String("error", err.Error()),
		)
		writeJSONError(writer, http.StatusInternalServerError, "internal server error")
		return
	}

	if !found {
		notFound(writer)
		return
	}

	writeTrafficPointJSON(writer, http.StatusOK, response)
}

func writeTrafficPointJSON(writer http.ResponseWriter, statusCode int, value storedTrafficPointEntry) {
	writer.Header().Set("Content-Type", contentTypeJSON)
	writer.Header().Set("Cache-Control", trafficPointCacheControlHeader)
	writer.WriteHeader(statusCode)

	_, _ = writer.Write(value.toJSON())
}

func parseTrafficPointRequest(request *http.Request) (trafficPointRequest, int, error) {
	numberSegment := request.PathValue("number")
	if numberSegment == "" {
		return trafficPointRequest{}, http.StatusBadRequest, fmt.Errorf("number is required")
	}

	number, err := strconv.Atoi(numberSegment)
	if err != nil {
		return trafficPointRequest{}, http.StatusBadRequest, fmt.Errorf("number must be an integer")
	}

	if number < 0 {
		return trafficPointRequest{}, http.StatusBadRequest, fmt.Errorf("number must be non-negative")
	}

	parsedRequest := trafficPointRequest{number: number}
	if request.Pattern == "GET /traffic-point-v2/{number}/{designation}" {
		parsedRequest.designation = request.PathValue("designation")
		if parsedRequest.designation == "" {
			return trafficPointRequest{}, http.StatusBadRequest, fmt.Errorf("designation must not be empty when present")
		}
	}

	return parsedRequest, http.StatusOK, nil
}
