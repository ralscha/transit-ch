package main

import (
	"bufio"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"transit-ch/internal/platformstore"
)

const catalogueURL = "https://data.opentransportdata.swiss/dataset/traffic-point-v2"

type importStats struct{ Rows, Invalid, Missing, Ambiguous, Imported int }

func main() {
	input := flag.String("input", "", "read a local atlas CSV instead of downloading today's export")
	out := flag.String("out", "platforms.bin", "snapshot output path")
	flag.Parse()
	zone, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		log.Fatal(err)
	}
	asOf := time.Now().In(zone)
	var source io.ReadCloser
	if *input != "" {
		source, err = os.Open(*input)
	} else {
		source, err = downloadCSV(&http.Client{Timeout: 5 * time.Minute})
	}
	if err != nil {
		log.Fatal(err)
	}
	entries, stats, err := loadPlatforms(source, asOf)
	closeErr := source.Close()
	if err != nil {
		log.Fatal(err)
	}
	if closeErr != nil {
		log.Fatal(closeErr)
	}
	if err = platformstore.WriteFile(*out, entries, asOf); err != nil {
		log.Fatal(err)
	}
	info, err := os.Stat(*out)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("snapshot=%s date=%s rows=%d platforms=%d invalid=%d missing=%d ambiguous=%d bytes=%d", *out, asOf.Format("2006-01-02"), stats.Rows, stats.Imported, stats.Invalid, stats.Missing, stats.Ambiguous, info.Size())
}

// Resource UUIDs change. Discover today's CSV from the stable catalogue page
// on each run instead of pinning an eventually obsolete download URL.
func downloadCSV(client *http.Client) (io.ReadCloser, error) {
	response, err := client.Get(catalogueURL)
	if err != nil {
		return nil, err
	}
	defer func(body io.ReadCloser) { _ = body.Close() }(response.Body)
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("catalogue: %s", response.Status)
	}
	page, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	download, err := findDownloadURL(string(page))
	if err != nil {
		return nil, err
	}
	response, err = client.Get(download)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		return nil, fmt.Errorf("CSV download: %s", response.Status)
	}
	return response.Body, nil
}

func findDownloadURL(page string) (string, error) {
	pattern := regexp.MustCompile(`href="([^"]*/download/actual-date-world-traffic-point\.csv)"`)
	for _, match := range pattern.FindAllStringSubmatch(page, -1) {
		u, err := url.Parse(match[1])
		if err == nil && u.Scheme == "https" && u.Host == "data.opentransportdata.swiss" {
			return u.String(), nil
		}
	}
	return "", errors.New("current platform export not found on catalogue page")
}

func loadPlatforms(source io.Reader, asOf time.Time) ([]platformstore.Entry, importStats, error) {
	var stats importStats
	buffer := bufio.NewReader(source)
	headerLine, err := buffer.Peek(4096)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, bufio.ErrBufferFull) {
		return nil, stats, err
	}
	firstLine, _, _ := strings.Cut(string(headerLine), "\n")
	reader := csv.NewReader(buffer)
	if strings.Count(firstLine, ";") > strings.Count(firstLine, ",") {
		reader.Comma = ';'
	}
	reader.ReuseRecord = true
	header, err := reader.Read()
	if err != nil {
		return nil, stats, err
	}
	columns := make(map[string]int, len(header))
	for i, name := range header {
		columns[strings.TrimPrefix(strings.TrimSpace(name), "\ufeff")] = i
	}
	for _, name := range []string{"sloid", "number", "validFrom", "validTo", "designation", "designationOperational", "trafficPointElementType", "wgs84North", "wgs84East", "status"} {
		if _, ok := columns[name]; !ok {
			return nil, stats, fmt.Errorf("CSV missing required column %q", name)
		}
	}
	type key struct {
		station  uint32
		platform string
	}
	entries := make(map[key]platformstore.Entry)
	ambiguous := make(map[key]bool)
	today := asOf.Format("2006-01-02")
	for {
		row, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, stats, fmt.Errorf("row %d: %w", stats.Rows+2, err)
		}
		stats.Rows++
		get := func(name string) string { return strings.TrimSpace(row[columns[name]]) }
		if get("trafficPointElementType") != "BOARDING_PLATFORM" || get("status") != "VALIDATED" {
			continue
		}
		from, to := get("validFrom"), get("validTo")
		if _, err := time.Parse("2006-01-02", from); err != nil {
			return nil, stats, fmt.Errorf("row %d: invalid validFrom", stats.Rows+1)
		}
		if _, err := time.Parse("2006-01-02", to); err != nil {
			return nil, stats, fmt.Errorf("row %d: invalid validTo", stats.Rows+1)
		}
		if from > to {
			return nil, stats, fmt.Errorf("row %d: inverted validity", stats.Rows+1)
		}
		if from > today || to < today {
			continue
		}
		number, err := strconv.ParseUint(get("number"), 10, 32)
		designation := get("designation")
		if designation == "" {
			designation = get("designationOperational")
		}
		if err != nil || number == 0 || designation == "" || len(designation) > 96 || get("sloid") == "" {
			stats.Invalid++
			continue
		}
		k := key{uint32(number), platformstore.Normalize(designation)}
		lat, latErr := strconv.ParseFloat(get("wgs84North"), 64)
		lng, lngErr := strconv.ParseFloat(get("wgs84East"), 64)
		if latErr != nil || lngErr != nil || math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat == 0 && lng == 0) {
			stats.Missing++
			ambiguous[k] = true
			delete(entries, k)
			continue
		}
		entry := platformstore.Entry{Station: uint32(number), Point: platformstore.Point{Platform: designation, Sloid: get("sloid"), Lat: lat, Lng: lng}}
		if ambiguous[k] {
			continue
		}
		if old, ok := entries[k]; ok {
			if old.Point.Lat != lat || old.Point.Lng != lng {
				stats.Ambiguous++
				ambiguous[k] = true
				delete(entries, k)
				continue
			}
			if old.Point.Sloid <= entry.Point.Sloid {
				continue
			}
		}
		entries[k] = entry
	}
	result := make([]platformstore.Entry, 0, len(entries))
	for _, entry := range entries {
		result = append(result, entry)
	}
	stats.Imported = len(result)
	if len(result) == 0 {
		return nil, stats, errors.New("CSV contains no usable current platforms; previous snapshot retained")
	}
	return result, stats, nil
}
