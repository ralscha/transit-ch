## Swiss public transport stationboard

https://transit-ch.rasc.ch

Transit CH is an Angular 22 PWA for Swiss public transport stationboards. The frontend calls the public `transport.opendata.ch` API for station search and departure/arrival boards, supports English, German, French, and Italian via Transloco, and includes service-worker update prompts.

Platform numbers open a MapLibre map with the Swisstopo vector basemap. Only this feature uses the Go backend, which looks up published boarding-platform positions in a custom immutable snapshot. Station search and stationboards continue to use the public transport API directly.

The **Find departures to a destination** link opens a destination search. Choose a destination stop and use your current location, or select a starting station. The app shows up to five vehicle departures in one chronological list across nearby boarding stops, including journeys with transfers. All five can leave from the same station. Cards show walking time, arrival time, changes, platform links and the full sequence of journey legs.

The [Transport API connections endpoint](https://transport.opendata.ch/docs.html#connections) accepts GPS coordinates and plans the walks to boarding stops as well as transfers. It considers walking routes of up to 20 minutes. The app requests 16 journey options, deduplicates alternatives that share the first vehicle departure, and sorts by that vehicle's predicted departure time, falling back to the timetable. These are the journey planner's available options; its optimization can omit slower alternatives, so this is not an exhaustive scan of every departure at every nearby stop. Distances are straight-line estimates; walking times come from the planner. Walking-only journeys are excluded. Results refresh every minute while the page is visible, and identical searches are reused for 30 seconds. Location and results remain only in application memory, allowing a return from the platform map without losing the search.

## Frontend

Run from the `frontend` directory:

```bash
npm install
npm start
```

For platform maps, first import the data and start the backend as described below. The development server proxies `/traffic-point-v2/*` to `127.0.0.1:34341`.

Useful commands:

```bash
npm run lint
npm test
npm run build
npm run check
npm run format
```

The production build writes to `frontend/dist/transit-ch/browser` and the `postbuild` step precompresses assets with gzip, Brotli, and zstd for Caddy.

### Timetable line badges

The stationboard and journey details use official SBB badges for IC, IR, S, SN, RE and R lines 1-99, plus category-only badges when the API supplies no number. The SVGs are bundled in `frontend/public/icons/sbb-lines`, preserve the original artwork, and use the complete line label as alternative text. Unknown services, unmatched numbers (including train identifiers), and failed image loads keep a text label and transport-mode icon. The service worker caches badges on demand and updates previously cached badges with the app.

Asset provenance, the upstream license, and links to SBB's usage terms are recorded in [SOURCE.txt](frontend/public/icons/sbb-lines/SOURCE.txt). SBB's brand terms include Swiss public transport projects and restrict commercial use.

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

At startup the backend loads `platforms.bin` from its working directory, validates the snapshot, and closes the file. Set `PLATFORM_DB` to use another path. The backend and importer share the repository's root Go module and use only the standard library.

Available endpoints:

```text
GET /traffic-point-v2/{number}?platform={designation}
GET /traffic-point-v2/{number}/{designation}
```

For example, `/traffic-point-v2/8503000?platform=41` returns:

```json
{"points":[{"platform":"41","sloid":"ch:1:sloid:3000:502:41","lat":47.37882261044,"lng":8.53875973746}]}
```

The station number and platform designation must match exactly (ignoring case and surrounding whitespace). A platform is required; unknown or ambiguous locations return 404. Explicit alternatives such as `41/42` return both points only if both resolve. There is no fallback to the station centre or another platform. A matching literal compound designation takes precedence. Responses retain floating-point coordinate precision and are cacheable for five minutes.

The map uses the latest platform supplied by the stationboard prognosis, supports direct links and reloads, and is available from both the board and journey details, including route stops. MapLibre is loaded and cached on demand. Map tiles require a network connection. These are published point coordinates, not platform outlines, indoor levels, access routes, or a guarantee of the current physical boarding position.

### Data source

Use [traffic-point-v2 from Open Transport Data Switzerland](https://data.opentransportdata.swiss/dataset/traffic-point-v2), specifically `actual-date-world-traffic-point.csv`. It is the primary atlas export for public transport areas and boarding platforms, includes WGS84 coordinates, SLOIDs and validity periods, and is updated daily. The importer selects validated `BOARDING_PLATFORM` records that are valid on the import date in Europe/Zurich. Areas, missing/invalid coordinates, and conflicting positions for the same station/platform key are excluded; identical positions are deduplicated.

The [SBB Haltestelle-Haltekante dataset](https://data.sbb.ch/explore/dataset/haltestelle-haltekante/information/) says it combines data from opentransportdata.swiss. Its catalogue API exposes `geopos_haltestelle` (the stop position), without separate boarding-platform coordinate fields. The primary export is therefore the appropriate source for this feature. See the [official data model](https://opentransportdata.swiss/en/cookbook/masterdata-cookbook/servicepoints/) and [Swisstopo vector-tile documentation](https://docs.geo.admin.ch/visualize-data/vector-tiles.html). Data attribution is displayed on the map.

## Importer

From the repository root, download the current export and build the snapshot:

```bash
go run ./importer -out backend/platforms.bin
```

The importer discovers the current CSV URL from the stable catalogue page because resource UUIDs can change. Each invocation downloads a fresh export. To use an already downloaded CSV (semicolon and comma delimiters are supported):

```bash
go run ./importer -input /path/to/actual-date-world-traffic-point.csv -out backend/platforms.bin
```

The complete replacement is validated, written to a temporary file beside the target, flushed, and renamed over the target. Failed imports preserve the previous snapshot. Refresh daily after 01:00 Europe/Zurich, then restart the backend to load the new snapshot. No refresh schedule is installed automatically. Existing Pebble directories are unused and need not be migrated; rebuild from the export.

### Storage format and performance

`internal/platformstore` implements a versioned binary snapshot with a SHA-256 integrity check, a power-of-two open-addressed hash index at at most 50% load, and a contiguous record section. Keys combine the numeric station ID and normalized platform designation. Hash matches are verified against the full key. Records hold pre-encoded JSON point objects, so lookups perform no disk I/O, locking, JSON parsing or serialization, and allocate no memory. The API writes borrowed response slices directly.

The 64-byte little-endian header contains magic `CHPLAT01`, format version, slot and record counts, record-section length, the import day, reserved bytes, and a SHA-256 digest over the header's first 32 bytes and the remaining file after the header. Each 16-byte slot contains a 64-bit FNV-1a hash, record offset and length. Each record starts with a 32-bit station ID, 16-bit key length, two reserved bytes and 32-bit JSON length, followed by the normalized UTF-8 key and JSON. Startup checks dimensions, bounds, keys, payloads, index reachability, duplicates and the checksum. Returned slices are read-only by contract. No WAL, compaction, background workers, mmap or external Go dependencies are needed.

The 2026-10-11 export produced 54,723 keys in 7,806,773 bytes (about 7.45 MiB). On the development Windows machine, lookups measured approximately 67 ns for a repeated hit, 430 ns for mixed hits across the snapshot, and 34 ns for misses, all with 0 B/op and 0 allocations/op. These are storage microbenchmarks, not HTTP latency or a comparison with Pebble. Pre-encoding responses trades some file size for request speed. Reproduce with:

```bash
task benchmark-storage
```

## Repository Tasks

From the repository root, Taskfile commands are available:

```bash
task format
task lint
task test
task import-platforms
task benchmark-storage
task build-frontend
```

`task test` runs backend, importer and storage tests. These cover exact and compound platform lookups, unknown positions, validity filtering, ambiguity, malformed CSVs, snapshot corruption, deterministic output, replacement safety and concurrent readers. Frontend verification is covered by `npm run check` or `task build-frontend`. Run `go test ./internal/platformstore -fuzz FuzzDecode -fuzztime 10s` to fuzz snapshot validation. The Go race detector additionally requires a C compiler and CGO support.

## Deployment

For a complete clone, build and installation walkthrough, including systemd setup, Caddy, logs and later updates, see [Install on Debian or Ubuntu](deploy/README.md).

`Caddyfile` serves the Angular build from `/opt/transit-ch/dist/transit-ch/browser`, enables precompressed assets, applies security headers, routes SPA fallback requests to `index.html`, and reverse-proxies `/traffic-point-v2/*` to the Go backend on port `34341`.

The API and SPA use separate Caddy handlers so a platform lookup cannot be rewritten to `index.html`. Deploy the backend executable and generated snapshot together, set its working directory or `PLATFORM_DB`, and run it alongside Caddy. A missing backend leaves the stationboard usable and shows a retryable error when opening a platform map.

Caddy caches hashed Angular JS/CSS bundles for one year. HTML, translations, badges, and MapLibre worker files revalidate on each request; Angular service-worker scripts and `ngsw.json` use `no-store`. Cache headers are applied after the SPA rewrite, so a missing bundle cannot leave `index.html` cached under an immutable asset URL. Copy the contents of `frontend/dist/transit-ch/browser` to `/opt/transit-ch/dist/transit-ch/browser` on the server, keeping the precompressed sidecar files. The platform snapshot is `/opt/transit-ch/platforms.bin`, alongside the executables and outside the public web root.

### systemd

The units in [`deploy/systemd`](deploy/systemd) run the backend and refresh its data:

- `transit-ch.service` runs `/opt/transit-ch/transit-ch-backend` as the `transit-ch` system user, serves port `34341`, and reads `/opt/transit-ch/platforms.bin`. It restarts after failures and allows graceful shutdown.
- `transit-ch-import.service` runs the importer as the same user and writes `/opt/transit-ch/platforms.bin`. Its sandbox permits writes under `/opt/transit-ch`; the backend has a read-only filesystem. Install that directory as `root:transit-ch` with mode `1775`, allowing atomic snapshot replacement while the sticky bit protects the root-owned executables from replacement by the service account. Only a successful import triggers a privileged `systemctl try-restart transit-ch.service` command, so failed imports keep the current backend running and an intentionally stopped backend stays stopped.
- `transit-ch-import.timer` runs daily at 01:30 Europe/Zurich, including daylight-saving changes. It catches up once when activated after a missed run. The importer service is not enabled separately.

These are system units for Linux with systemd 240 or newer. Install CA certificates and timezone data on the server so HTTPS downloads and the Zurich calendar work. Build the executables on Linux from the repository root (or cross-compile them for the server's OS and architecture):

```bash
go build -o transit-ch-backend ./backend
go build -o transit-ch-importer ./importer
```

For the first installation, run the following on the Linux server from the directory containing the built executables and `deploy/systemd`. Create the account once; skip `useradd` if it already exists.

```bash
sudo useradd --system --user-group --no-create-home --home-dir /opt/transit-ch --shell /usr/sbin/nologin transit-ch
sudo install -d -o root -g transit-ch -m 1775 /opt/transit-ch
sudo install -o root -g root -m 0755 transit-ch-backend transit-ch-importer /opt/transit-ch/
sudo install -o root -g root -m 0644 deploy/systemd/transit-ch.service deploy/systemd/transit-ch-import.service deploy/systemd/transit-ch-import.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/transit-ch.service /etc/systemd/system/transit-ch-import.service /etc/systemd/system/transit-ch-import.timer
sudo systemctl daemon-reload
sudo systemctl start transit-ch-import.service
```

The initial import must succeed before starting the backend. It creates the snapshot and leaves the backend stopped. If you already installed the earlier `/var/lib/transit-ch` setup, follow the [migration notes](deploy/README.md#install-systemd-units) to update any existing backend override. Then enable startup at boot and the refresh timer:

```bash
sudo systemctl enable --now transit-ch.service transit-ch-import.timer
```

Check status and logs, or refresh immediately:

```bash
systemctl status transit-ch.service transit-ch-import.timer
systemctl list-timers transit-ch-import.timer
sudo journalctl -u transit-ch.service -u transit-ch-import.service -n 100 --no-pager
sudo systemctl start transit-ch-import.service
```

After replacing the backend executable, restart it with `sudo systemctl restart transit-ch.service`. After changing unit files, run `sudo systemctl daemon-reload`; also restart `transit-ch-import.timer` if its schedule changed. Caddy continues to use the existing port and frontend path.

The success-only restart hook and persistent calendar behavior follow the [systemd service documentation](https://github.com/systemd/systemd/blob/v256/man/systemd.service.xml) and [timer documentation](https://github.com/systemd/systemd/blob/v256/man/systemd.timer.xml).
