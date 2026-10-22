// Package platformstore implements immutable, hash-indexed platform snapshots.
// A snapshot is loaded once; Lookup only probes its byte buffer and returns a
// borrowed, pre-encoded JSON object. Concurrent readers need no locks or I/O.
package platformstore

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	headerSize       = 64
	slotSize         = 16
	recordHeaderSize = 12
	maxFileSize      = 256 << 20
	magic            = "CHPLAT01"
)

var endian = binary.LittleEndian

type Point struct {
	Platform string  `json:"platform"`
	Sloid    string  `json:"sloid"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
}

type Entry struct {
	Station uint32
	Point   Point
}

type Store struct {
	data      []byte
	slots     uint32
	count     uint32
	blobStart uint32
	date      time.Time
}

func Normalize(platform string) string { return strings.ToUpper(strings.TrimSpace(platform)) }

func validPoint(p Point) bool {
	return Normalize(p.Platform) != "" && len(p.Platform) <= 96 && p.Sloid != "" &&
		!math.IsNaN(p.Lat) && !math.IsNaN(p.Lng) && !math.IsInf(p.Lat, 0) && !math.IsInf(p.Lng, 0) &&
		p.Lat >= -90 && p.Lat <= 90 && p.Lng >= -180 && p.Lng <= 180 && (p.Lat != 0 || p.Lng != 0)
}

func hash(station uint32, platform string) uint64 {
	h := uint64(14695981039346656037)
	for shift := 0; shift < 32; shift += 8 {
		h = (h ^ uint64(byte(station>>shift))) * 1099511628211
	}
	for i := 0; i < len(platform); i++ {
		h = (h ^ uint64(platform[i])) * 1099511628211
	}
	return h
}

// Encode is deterministic for the same entries and date. Duplicate keys are
// rejected: selecting a random platform is never a valid fallback.
func Encode(entries []Entry, asOf time.Time) ([]byte, error) {
	entries = append([]Entry(nil), entries...)
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Station != entries[j].Station {
			return entries[i].Station < entries[j].Station
		}
		return Normalize(entries[i].Point.Platform) < Normalize(entries[j].Point.Platform)
	})
	if len(entries) == 0 || len(entries) > 1_000_000 {
		return nil, errors.New("snapshot needs 1-1000000 entries")
	}
	slots := uint32(2)
	for slots < uint32(len(entries))*2 {
		slots <<= 1
	}
	data := make([]byte, headerSize+int(slots)*slotSize)
	copy(data, magic)
	endian.PutUint32(data[8:], 1)
	endian.PutUint32(data[12:], slots)
	endian.PutUint32(data[16:], uint32(len(entries)))
	y, m, d := asOf.Date()
	day := time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Unix() / 86400
	if day < 0 || day > math.MaxUint32 {
		return nil, errors.New("invalid snapshot date")
	}
	endian.PutUint32(data[24:], uint32(day))
	blobStart := len(data)
	var previous Entry
	for i, entry := range entries {
		key := Normalize(entry.Point.Platform)
		if entry.Station == 0 || !validPoint(entry.Point) {
			return nil, fmt.Errorf("invalid platform entry %d", i)
		}
		if i > 0 && previous.Station == entry.Station && Normalize(previous.Point.Platform) == key {
			return nil, fmt.Errorf("duplicate key %d/%s", entry.Station, key)
		}
		previous = entry
		payload, err := json.Marshal(entry.Point)
		if err != nil {
			return nil, err
		}
		offset := len(data) - blobStart
		record := make([]byte, recordHeaderSize)
		endian.PutUint32(record, entry.Station)
		endian.PutUint16(record[4:], uint16(len(key)))
		endian.PutUint32(record[8:], uint32(len(payload)))
		data = append(data, record...)
		data = append(data, key...)
		data = append(data, payload...)
		if len(data) > maxFileSize {
			return nil, errors.New("snapshot exceeds size limit")
		}
		h := hash(entry.Station, key)
		index := uint32(h) & (slots - 1)
		for endian.Uint32(data[headerSize+int(index)*slotSize+12:]) != 0 {
			index = (index + 1) & (slots - 1)
		}
		slot := data[headerSize+int(index)*slotSize:]
		endian.PutUint64(slot, h)
		endian.PutUint32(slot[8:], uint32(offset))
		endian.PutUint32(slot[12:], uint32(recordHeaderSize+len(key)+len(payload)))
	}
	endian.PutUint32(data[20:], uint32(len(data)-blobStart))
	sum := checksum(data)
	copy(data[32:64], sum[:])
	return data, nil
}

func checksum(data []byte) [32]byte {
	h := sha256.New()
	h.Write(data[:32])
	h.Write(data[64:])
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum
}

// Open validates the format, checksum, offsets, keys, and payloads before any
// snapshot bytes can be served. The file is closed after loading.
func Open(filename string) (*Store, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() < headerSize || info.Size() > maxFileSize {
		return nil, errors.New("invalid snapshot file size")
	}
	data := make([]byte, int(info.Size()))
	if _, err := f.ReadAt(data, 0); err != nil {
		return nil, err
	}
	return Decode(data)
}

// Decode takes ownership of data; callers must not modify it afterwards.
func Decode(data []byte) (*Store, error) {
	if len(data) < headerSize || len(data) > maxFileSize || string(data[:8]) != magic || endian.Uint32(data[8:]) != 1 {
		return nil, errors.New("invalid platform snapshot header")
	}
	slots, count, blobSize := endian.Uint32(data[12:]), endian.Uint32(data[16:]), endian.Uint32(data[20:])
	blobStart := uint64(headerSize) + uint64(slots)*slotSize
	if slots < 2 || slots&(slots-1) != 0 || count == 0 || count > slots/2 || blobStart+uint64(blobSize) != uint64(len(data)) {
		return nil, errors.New("invalid platform snapshot dimensions")
	}
	sum := checksum(data)
	if !bytes.Equal(data[32:64], sum[:]) {
		return nil, errors.New("platform snapshot checksum mismatch")
	}
	s := &Store{data: data, slots: slots, count: count, blobStart: uint32(blobStart), date: time.Unix(int64(endian.Uint32(data[24:]))*86400, 0).UTC()}
	seen := make(map[uint32]bool, count)
	for i := range slots {
		slot := data[headerSize+int(i)*slotSize:]
		offset, length := endian.Uint32(slot[8:]), endian.Uint32(slot[12:])
		if length == 0 {
			continue
		}
		if length < recordHeaderSize || uint64(offset)+uint64(length) > uint64(blobSize) || seen[offset] {
			return nil, errors.New("invalid platform snapshot record offset")
		}
		seen[offset] = true
		record := data[int(blobStart)+int(offset) : int(blobStart)+int(offset)+int(length)]
		keyLength := int(endian.Uint16(record[4:]))
		if keyLength == 0 || keyLength > 96 || uint64(recordHeaderSize+keyLength)+uint64(endian.Uint32(record[8:])) != uint64(length) {
			return nil, errors.New("invalid platform snapshot record length")
		}
		station := endian.Uint32(record)
		key := string(record[recordHeaderSize : recordHeaderSize+keyLength])
		var p Point
		payload := record[recordHeaderSize+keyLength:]
		if station == 0 || hash(station, key) != endian.Uint64(slot) || json.Unmarshal(payload, &p) != nil || !validPoint(p) || Normalize(p.Platform) != key {
			return nil, errors.New("invalid platform snapshot record")
		}
		found := s.Lookup(station, key)
		if len(found) != len(payload) || len(found) == 0 || &found[0] != &payload[0] {
			return nil, errors.New("unreachable or duplicate platform snapshot key")
		}
	}
	if uint32(len(seen)) != count {
		return nil, errors.New("invalid platform snapshot entry count")
	}
	return s, nil
}

// Lookup expects a normalized designation and returns immutable JSON or nil.
// It performs no allocations, JSON parsing, locking, or disk access.
func (s *Store) Lookup(station uint32, platform string) []byte {
	h := hash(station, platform)
	index := uint32(h) & (s.slots - 1)
	for probe := uint32(0); probe < s.slots; probe++ {
		slot := s.data[headerSize+int(index)*slotSize:]
		length := endian.Uint32(slot[12:])
		if length == 0 {
			return nil
		}
		if length < recordHeaderSize {
			return nil
		}
		if endian.Uint64(slot) == h {
			offset := int(s.blobStart) + int(endian.Uint32(slot[8:]))
			// Decode validates bounds before exposing the store.
			if offset+recordHeaderSize > len(s.data) || uint64(offset)+uint64(length) > uint64(len(s.data)) {
				return nil
			}
			r := s.data[offset : offset+int(length)]
			keyLength := int(endian.Uint16(r[4:]))
			if recordHeaderSize+keyLength > len(r) {
				return nil
			}
			if endian.Uint32(r) == station && string(r[recordHeaderSize:recordHeaderSize+keyLength]) == platform {
				return r[recordHeaderSize+keyLength:]
			}
		}
		index = (index + 1) & (s.slots - 1)
	}
	return nil
}

func (s *Store) Count() int      { return int(s.count) }
func (s *Store) Size() int       { return len(s.data) }
func (s *Store) Date() time.Time { return s.date }

// WriteFile builds and validates a replacement before atomically renaming it.
// A failed import never removes the previously published snapshot.
func WriteFile(filename string, entries []Entry, asOf time.Time) error {
	data, err := Encode(entries, asOf)
	if err != nil {
		return err
	}
	if _, err = Decode(data); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(filename), ".platforms-*.tmp")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(f.Name()) }()
	if _, err = f.Write(data); err != nil {
		return errors.Join(err, f.Close())
	}
	if err = f.Sync(); err != nil {
		return errors.Join(err, f.Close())
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Chmod(f.Name(), 0644); err != nil {
		return err
	}
	return os.Rename(f.Name(), filename)
}
