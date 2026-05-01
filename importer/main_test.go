package main

import (
	"strings"
	"testing"
	"time"
)

func TestLoadTrafficPointsFromReaderFiltersByValidityAndFallsBackToOperationalDesignation(t *testing.T) {
	today := time.Date(2026, time.April, 9, 15, 0, 0, 0, time.UTC)
	csvData := strings.Join([]string{
		"number,validFrom,validTo,designation,designationOperational,wgs84East,wgs84North",
		"8503000,2026-01-01,2026-12-31,,Gleis 7,8.5400,47.3700",
		"8503000,2025-01-01,2026-03-31,Old,Old,8.5401,47.3701",
		"8503001,2026-05-01,2026-12-31,Future,Future,8.5500,47.3800",
	}, "\n")

	pointsByNumber, err := loadTrafficPointsFromReader(strings.NewReader(csvData), today)
	if err != nil {
		t.Fatalf("loadTrafficPointsFromReader returned error: %v", err)
	}

	entries := pointsByNumber["8503000"]
	if len(entries) != 1 {
		t.Fatalf("expected 1 valid entry for 8503000, got %d", len(entries))
	}

	if entries[0].Designation != "Gleis 7" {
		t.Fatalf("expected designation fallback to designationOperational, got %q", entries[0].Designation)
	}

	if _, exists := pointsByNumber["8503001"]; exists {
		t.Fatalf("expected future-only entry to be skipped")
	}
}

func TestIsEntryValidOnUsesInclusiveDateRange(t *testing.T) {
	today := time.Date(2026, time.April, 9, 23, 59, 59, 0, time.UTC)

	valid, err := isEntryValidOn("2026-04-09", "2026-04-09", today)
	if err != nil {
		t.Fatalf("isEntryValidOn returned error: %v", err)
	}

	if !valid {
		t.Fatalf("expected same-day validity range to be included")
	}
}

func TestIsEntryValidOnRejectsInvalidDate(t *testing.T) {
	_, err := isEntryValidOn("invalid", "2026-04-09", time.Date(2026, time.April, 9, 0, 0, 0, 0, time.UTC))
	if err == nil {
		t.Fatalf("expected invalid date to return an error")
	}
}
