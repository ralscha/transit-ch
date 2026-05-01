package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/cockroachdb/pebble/v2"
)

const trafficPointsDirName = "traffic-points"

type trafficPointStore struct {
	db *pebble.DB
}

type storedTrafficPointEntry struct {
	Designation string `json:"designation"`
	Lat         string `json:"lat"`
	Lng         string `json:"lng"`
}

type storedTrafficPointValue struct {
	Entries []storedTrafficPointEntry `json:"entries"`
}

func openTrafficPointStore() (*trafficPointStore, error) {
	workingDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("get working directory: %w", err)
	}

	dbPath := filepath.Join(workingDir, trafficPointsDirName)
	db, err := pebble.Open(dbPath, &pebble.Options{
		ErrorIfNotExists: true,
		ReadOnly:         true,
	})
	if err != nil {
		return nil, fmt.Errorf("open pebble db %s: %w", dbPath, err)
	}

	return &trafficPointStore{db: db}, nil
}

func (store *trafficPointStore) Close() error {
	if store == nil || store.db == nil {
		return nil
	}

	return store.db.Close()
}

func (store *trafficPointStore) Lookup(request trafficPointRequest) (entry storedTrafficPointEntry, found bool, err error) {
	value, closer, err := store.db.Get([]byte(strconv.Itoa(request.number)))
	if errors.Is(err, pebble.ErrNotFound) {
		return storedTrafficPointEntry{}, false, nil
	}
	if err != nil {
		return storedTrafficPointEntry{}, false, fmt.Errorf("get traffic point %d: %w", request.number, err)
	}
	defer func() {
		if closeErr := closer.Close(); closeErr != nil {
			closeErr = fmt.Errorf("close traffic point %d value: %w", request.number, closeErr)
			if err != nil {
				err = errors.Join(err, closeErr)
				return
			}
			err = closeErr
		}
	}()

	var storedValue storedTrafficPointValue
	if err := json.Unmarshal(value, &storedValue); err != nil {
		return storedTrafficPointEntry{}, false, fmt.Errorf("decode traffic point %d: %w", request.number, err)
	}

	entry, found = selectTrafficPointEntry(storedValue.Entries, request.designation)
	if !found {
		return storedTrafficPointEntry{}, false, nil
	}

	if _, err := strconv.ParseFloat(entry.Lat, 64); err != nil {
		return storedTrafficPointEntry{}, false, fmt.Errorf("invalid lat %q: %w", entry.Lat, err)
	}
	if _, err := strconv.ParseFloat(entry.Lng, 64); err != nil {
		return storedTrafficPointEntry{}, false, fmt.Errorf("invalid lng %q: %w", entry.Lng, err)
	}

	return entry, true, nil
}

func selectTrafficPointEntry(entries []storedTrafficPointEntry, designation string) (storedTrafficPointEntry, bool) {
	if len(entries) == 0 {
		return storedTrafficPointEntry{}, false
	}

	if designation != "" {
		for _, entry := range entries {
			if entry.Designation == designation {
				return entry, true
			}
		}
	}

	return entries[0], true
}
