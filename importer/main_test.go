package main

import (
	"strings"
	"testing"
	"time"
)

const csvHeader = "sloid;number;validFrom;validTo;designation;designationOperational;trafficPointElementType;wgs84North;wgs84East;status\n"

func TestImportFiltersAndRejectsAmbiguousLocations(t *testing.T) {
	data := csvHeader + strings.Join([]string{
		"id1;8503000;2026-01-01;9999-12-31;41;;BOARDING_PLATFORM;47.37882261044;8.53875973746;VALIDATED",
		"id1;8503000;2026-01-01;9999-12-31;41;;BOARDING_PLATFORM;47.37882261044;8.53875973746;VALIDATED",
		"id2;8503000;2026-10-11;2026-10-11;;42;BOARDING_PLATFORM;47.37;8.53;VALIDATED",
		"id3;8503000;2020-01-01;2025-01-01;43;;BOARDING_PLATFORM;47.37;8.53;VALIDATED",
		"id4;8503000;2027-01-01;9999-12-31;44;;BOARDING_PLATFORM;47.37;8.53;VALIDATED",
		"id5;8503000;2020-01-01;9999-12-31;45;;BOARDING_AREA;47.37;8.53;VALIDATED",
		"id6;8503000;2020-01-01;9999-12-31;46;;BOARDING_PLATFORM;47.37;8.53;DRAFT",
		"id7;8503000;2020-01-01;9999-12-31;47;;BOARDING_PLATFORM;NaN;8.53;VALIDATED",
		"id8;8503000;2020-01-01;9999-12-31;48;;BOARDING_PLATFORM;47.37;8.53;VALIDATED",
		"id9;8503000;2020-01-01;9999-12-31;48;;BOARDING_PLATFORM;47.38;8.53;VALIDATED",
		"id10;8503000;2020-01-01;9999-12-31;49;;BOARDING_PLATFORM;47.37;8.53;VALIDATED",
		"id11;8503000;2020-01-01;9999-12-31;49;;BOARDING_PLATFORM;;;VALIDATED",
	}, "\n")
	for _, input := range []string{data, strings.ReplaceAll(data, ";", ",")} {
		entries, stats, err := loadPlatforms(strings.NewReader(input), time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
		if len(entries) != 2 || stats.Ambiguous != 1 || stats.Missing != 2 {
			t.Fatalf("entries=%v stats=%+v", entries, stats)
		}
		for _, entry := range entries {
			if entry.Point.Platform != "41" && entry.Point.Platform != "42" {
				t.Fatal("unsafe entry", entry)
			}
		}
	}
}

func TestImportRejectsMalformedOrEmptyInput(t *testing.T) {
	for _, input := range []string{"", csvHeader, "number,designation\n8503000,41", csvHeader + "id;8503000", csvHeader + "id;8503000;bad;9999-12-31;41;;BOARDING_PLATFORM;47;8;VALIDATED"} {
		if _, _, err := loadPlatforms(strings.NewReader(input), time.Now()); err == nil {
			t.Fatalf("accepted invalid input %q", input)
		}
	}
}

func TestDiscoverCurrentExport(t *testing.T) {
	const url = "https://data.opentransportdata.swiss/dataset/id/resource/new-id/download/actual-date-world-traffic-point.csv"
	got, err := findDownloadURL(`<a href="https://evil.test/download/actual-date-world-traffic-point.csv">wrong</a><a href="` + url + `">Download</a>`)
	if err != nil || got != url {
		t.Fatal(got, err)
	}
	if _, err := findDownloadURL("no download here"); err == nil {
		t.Fatal("missing export accepted")
	}
}
