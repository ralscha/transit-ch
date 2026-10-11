package platformstore

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func sampleEntries() []Entry {
	return []Entry{{8503000, Point{"41", "ch:1:sloid:3000:41", 47.37882261044, 8.53875973746}}, {8503000, Point{"42", "ch:1:sloid:3000:42", 47.3789, 8.5388}}, {8507000, Point{"A", "ch:1:sloid:7000:A", 46.948, 7.439}}}
}

func TestSnapshotRoundTripAndExactKeys(t *testing.T) {
	entries := sampleEntries()
	date := time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)
	data, err := Encode(entries, date)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if s.Count() != 3 || !s.Date().Equal(date) {
		t.Fatal("incorrect metadata")
	}
	if got := string(s.Lookup(8503000, "41")); got != `{"platform":"41","sloid":"ch:1:sloid:3000:41","lat":47.37882261044,"lng":8.53875973746}` {
		t.Fatal(got)
	}
	for _, key := range []struct {
		station  uint32
		platform string
	}{{8503000, "43"}, {8503000, ""}, {8503001, "41"}, {8503000, "41A"}} {
		if s.Lookup(key.station, key.platform) != nil {
			t.Fatal("unexpected fallback", key)
		}
	}
	entries[0], entries[2] = entries[2], entries[0]
	other, err := Encode(entries, date)
	if err != nil || !bytes.Equal(data, other) {
		t.Fatal("non-deterministic snapshot", err)
	}
	if allocations := testing.AllocsPerRun(1000, func() { s.Lookup(8503000, "41") }); allocations != 0 {
		t.Fatalf("lookup allocated %v", allocations)
	}
}

func TestSnapshotRejectsCorruptionAndDuplicates(t *testing.T) {
	data, err := Encode(sampleEntries(), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{0, 8, 12, 16, 20, 32, 64, len(data) - 1} {
		broken := bytes.Clone(data)
		broken[offset] ^= 0xff
		if _, err := Decode(broken); err == nil {
			t.Fatalf("accepted corruption at %d", offset)
		}
	}
	for n := 0; n < len(data); n++ {
		if _, err := Decode(data[:n]); err == nil {
			t.Fatalf("accepted truncation at %d", n)
		}
	}
	entries := append(sampleEntries(), sampleEntries()[0])
	if _, err := Encode(entries, time.Now()); err == nil {
		t.Fatal("accepted duplicate key")
	}
	// Malformed slots with a valid checksum must still be rejected safely.
	for _, length := range []uint32{1, 11, 0xffffffff} {
		broken := bytes.Clone(data)
		endian.PutUint32(broken[headerSize+12:], length)
		sum := checksum(broken)
		copy(broken[32:64], sum[:])
		if _, err := Decode(broken); err == nil {
			t.Fatal("accepted malformed slot")
		}
	}
}

func TestAtomicReplacementAndConcurrentReaders(t *testing.T) {
	file := filepath.Join(t.TempDir(), "platforms.bin")
	if err := WriteFile(file, sampleEntries(), time.Now()); err != nil {
		t.Fatal(err)
	}
	old, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteFile(file, nil, time.Now()); err == nil {
		t.Fatal("empty import should fail")
	}
	if _, err := Open(file); err != nil {
		t.Fatal("failed import damaged snapshot", err)
	}
	replacement := sampleEntries()
	replacement[0].Point.Lat = 47.4
	if err := WriteFile(file, replacement, time.Now()); err != nil {
		t.Fatal(err)
	}
	fresh, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(old.Lookup(8503000, "41"), fresh.Lookup(8503000, "41")) {
		t.Fatal("replacement not visible on reopen")
	}
	for i := 0; i < 8; i++ {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			t.Parallel()
			for j := 0; j < 1000; j++ {
				if old.Lookup(8503000, "41") == nil {
					t.Fatal("lost entry")
				}
			}
		})
	}
}

func FuzzDecode(f *testing.F) {
	data, _ := Encode(sampleEntries(), time.Now())
	f.Add(data)
	f.Add([]byte("CHPLAT01"))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) >= headerSize && len(data) < 1<<20 {
			data = bytes.Clone(data)
			sum := checksum(data)
			copy(data[32:64], sum[:])
		}
		if s, err := Decode(data); err == nil {
			s.Lookup(8503000, "41")
			s.Lookup(1, "missing")
		}
	})
}

func BenchmarkLookup(b *testing.B) {
	var s *Store
	var err error
	if filename := os.Getenv("PLATFORM_BENCH_DB"); filename != "" {
		s, err = Open(filename)
	} else {
		entries := make([]Entry, 55000)
		for i := range entries {
			entries[i] = Entry{uint32(8500000 + i/10), Point{fmt.Sprint(40 + i%10), fmt.Sprintf("ch:1:sloid:%d", i), 47.3, 8.5}}
		}
		var data []byte
		data, err = Encode(entries, time.Now())
		if err == nil {
			s, err = Decode(data)
		}
	}
	if err != nil {
		b.Fatal(err)
	}
	if s.Lookup(8503000, "41") == nil {
		b.Fatal("benchmark hit key is missing")
	}
	type lookupKey struct {
		station  uint32
		platform string
	}
	keys := make([]lookupKey, 0, s.Count())
	for i := uint32(0); i < s.slots; i++ {
		slot := s.data[headerSize+int(i)*slotSize:]
		if endian.Uint32(slot[12:]) == 0 {
			continue
		}
		record := s.data[int(s.blobStart)+int(endian.Uint32(slot[8:])):]
		keys = append(keys, lookupKey{endian.Uint32(record), string(record[recordHeaderSize : recordHeaderSize+int(endian.Uint16(record[4:]))])})
	}
	b.Run("hot-hit", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			s.Lookup(8503000, "41")
		}
	})
	b.Run("mixed-hit", func(b *testing.B) {
		b.ReportAllocs()
		i := 0
		for b.Loop() {
			key := keys[i]
			s.Lookup(key.station, key.platform)
			i = (i + 7919) % len(keys)
		}
	})
	b.Run("missing", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			s.Lookup(0, "missing")
		}
	})
	b.ReportMetric(float64(s.Size()), "snapshot-bytes")
}
