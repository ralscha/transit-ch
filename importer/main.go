package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/cockroachdb/pebble/v2"
)

const (
	csvURL          = "https://data.opentransportdata.swiss/dataset/b06d90be-91c6-440e-ab97-09f579d2fad0/resource/71ea6819-e128-4fda-8ea7-332283309351/download/full-world-traffic-point.csv"
	csvFileName     = "71ea6819-e128-4fda-8ea7-332283309351.csv"
	dbDirName       = "traffic-points"
	batchSize       = 1000
	downloadTimeout = 10 * time.Minute
)

var logger = log.New(os.Stdout, "", log.LstdFlags)

type trafficPointEntry struct {
	Designation string `json:"designation"`
	Lat         string `json:"lat"`
	Lng         string `json:"lng"`
}

type trafficPointValue struct {
	Entries []trafficPointEntry `json:"entries"`
}

func main() {
	workingDir, err := os.Getwd()
	if err != nil {
		logger.Fatal(err)
	}

	csvPath := filepath.Join(workingDir, csvFileName)
	if err := ensureCSV(csvPath); err != nil {
		logger.Fatal(err)
	}

	pointsByNumber, err := loadTrafficPoints(csvPath)
	if err != nil {
		logger.Fatal(err)
	}

	dbPath := filepath.Join(workingDir, dbDirName)
	if err := rebuildDatabase(dbPath, pointsByNumber); err != nil {
		logger.Fatal(err)
	}

	logger.Printf("imported %d traffic point keys into %s", len(pointsByNumber), dbPath)
}

func ensureCSV(csvPath string) error {
	if _, err := os.Stat(csvPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat csv: %w", err)
	}

	client := http.Client{Timeout: downloadTimeout}
	response, err := client.Get(csvURL)
	if err != nil {
		return fmt.Errorf("download csv: %w", err)
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil {
			logger.Printf("close response body: %v", closeErr)
		}
	}()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download csv: unexpected status %s", response.Status)
	}

	file, err := os.Create(csvPath)
	if err != nil {
		return fmt.Errorf("create csv: %w", err)
	}

	if _, err := io.Copy(file, response.Body); err != nil {
		if closeErr := file.Close(); closeErr != nil {
			logger.Printf("close csv after write failure: %v", closeErr)
		}
		return fmt.Errorf("write csv: %w", err)
	}

	if err := file.Close(); err != nil {
		return fmt.Errorf("close csv: %w", err)
	}

	return nil
}

func loadTrafficPoints(csvPath string) (map[string][]trafficPointEntry, error) {
	file, err := os.Open(csvPath)
	if err != nil {
		return nil, fmt.Errorf("open csv: %w", err)
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			logger.Printf("close csv reader: %v", closeErr)
		}
	}()

	return loadTrafficPointsFromReader(file, time.Now())
}

func loadTrafficPointsFromReader(source io.Reader, today time.Time) (map[string][]trafficPointEntry, error) {
	currentDate := dateOnly(today)

	reader := csv.NewReader(source)
	reader.FieldsPerRecord = -1
	reader.ReuseRecord = true

	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("read csv header: %w", err)
	}

	columnIndex, err := requiredColumns(header)
	if err != nil {
		return nil, err
	}

	pointsByNumber := make(map[string][]trafficPointEntry)
	seenEntries := make(map[string]map[trafficPointEntry]struct{})

	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read csv row: %w", err)
		}

		number := record[columnIndex["number"]]
		if number == "" {
			continue
		}

		isValid, err := isEntryValidOn(record[columnIndex["validFrom"]], record[columnIndex["validTo"]], currentDate)
		if err != nil {
			return nil, fmt.Errorf("invalid validity for number %s: %w", number, err)
		}
		if !isValid {
			continue
		}

		designation := record[columnIndex["designation"]]
		if designation == "" {
			designation = record[columnIndex["designationOperational"]]
		}

		entry := trafficPointEntry{
			Designation: designation,
			Lat:         record[columnIndex["wgs84North"]],
			Lng:         record[columnIndex["wgs84East"]],
		}

		if _, exists := seenEntries[number]; !exists {
			seenEntries[number] = make(map[trafficPointEntry]struct{})
		}
		if _, duplicate := seenEntries[number][entry]; duplicate {
			continue
		}

		seenEntries[number][entry] = struct{}{}
		pointsByNumber[number] = append(pointsByNumber[number], entry)
	}

	for _, entries := range pointsByNumber {
		sort.Slice(entries, func(i, j int) bool {
			if entries[i].Designation != entries[j].Designation {
				return entries[i].Designation < entries[j].Designation
			}
			if entries[i].Lat != entries[j].Lat {
				return entries[i].Lat < entries[j].Lat
			}
			return entries[i].Lng < entries[j].Lng
		})
	}

	return pointsByNumber, nil
}

func requiredColumns(header []string) (map[string]int, error) {
	indices := make(map[string]int, len(header))
	for index, name := range header {
		indices[name] = index
	}

	for _, name := range []string{"number", "validFrom", "validTo", "designation", "designationOperational", "wgs84East", "wgs84North"} {
		if _, exists := indices[name]; !exists {
			return nil, fmt.Errorf("csv missing required column %q", name)
		}
	}

	return indices, nil
}

func isEntryValidOn(validFrom string, validTo string, today time.Time) (bool, error) {
	today = dateOnly(today)

	fromDate, err := parseCSVDate(validFrom)
	if err != nil {
		return false, fmt.Errorf("parse validFrom %q: %w", validFrom, err)
	}

	toDate, err := parseCSVDate(validTo)
	if err != nil {
		return false, fmt.Errorf("parse validTo %q: %w", validTo, err)
	}

	return !today.Before(fromDate) && !today.After(toDate), nil
}

func parseCSVDate(value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, err
	}

	return dateOnly(parsed), nil
}

func dateOnly(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func rebuildDatabase(dbPath string, pointsByNumber map[string][]trafficPointEntry) error {
	if err := os.RemoveAll(dbPath); err != nil {
		return fmt.Errorf("remove existing db: %w", err)
	}

	db, err := pebble.Open(dbPath, &pebble.Options{})
	if err != nil {
		return fmt.Errorf("open pebble db: %w", err)
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			logger.Printf("close pebble db: %v", closeErr)
		}
	}()

	keys := make([]string, 0, len(pointsByNumber))
	for key := range pointsByNumber {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	batch := db.NewBatch()
	defer func() {
		if closeErr := batch.Close(); closeErr != nil {
			logger.Printf("close pebble batch: %v", closeErr)
		}
	}()

	writesInBatch := 0
	for _, key := range keys {
		payload, err := json.Marshal(trafficPointValue{Entries: pointsByNumber[key]})
		if err != nil {
			return fmt.Errorf("marshal value for %s: %w", key, err)
		}

		if err := batch.Set([]byte(key), payload, nil); err != nil {
			return fmt.Errorf("set key %s: %w", key, err)
		}

		writesInBatch++
		if writesInBatch == batchSize {
			if err := batch.Commit(pebble.Sync); err != nil {
				return fmt.Errorf("commit batch: %w", err)
			}
			if err := batch.Close(); err != nil {
				return fmt.Errorf("close batch: %w", err)
			}
			batch = db.NewBatch()
			writesInBatch = 0
		}
	}

	if writesInBatch > 0 {
		if err := batch.Commit(pebble.Sync); err != nil {
			return fmt.Errorf("commit final batch: %w", err)
		}
	}

	if len(keys) > 0 {
		compactEnd := append([]byte(keys[len(keys)-1]), 0)
		if err := db.Compact(context.Background(), []byte(keys[0]), compactEnd, false); err != nil {
			return fmt.Errorf("compact database: %w", err)
		}
	}

	return nil
}
