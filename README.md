## Swiss public transport stationboard

https://transit-ch.rasc.ch

## Backend

The Go backend listens on port `34341` by default.

Run it from the `backend` directory:

```bash
go run .
```

Set a custom port either with a flag or a positional argument:

```bash
go run . -port 8080
go run . 8080
```

At startup the backend opens `./traffic-points` as a read-only Pebble database, so the `traffic-points` directory must exist in the current working directory.

Available endpoint:

```text
GET /traffic-point-v2/{number}
GET /traffic-point-v2/{number}/{designation}
```

## Importer

Run the importer from the `importer` directory:

```bash
go run .
```

It reuses `71ea6819-e128-4fda-8ea7-332283309351.csv` when already present, otherwise it downloads the CSV from Open Transport Data Switzerland. The import creates `importer/traffic-points`, a Pebble database keyed by `number`. Each value is JSON with an `entries` array containing `designation`, `lat` (from `wgs84North`), and `lng` (from `wgs84East`) as strings.
