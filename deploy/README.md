# Install on Debian or Ubuntu

Clone and build as your normal SSH user, then install the output under `/opt/transit-ch`. Caddy serves the compiled frontend; systemd runs the Go backend and the daily data importer. Node.js is only needed for building, so the frontend does not need a separate service.

## Requirements

Use a Linux server with systemd 240 or newer, `sudo`, Git, curl, rsync, CA certificates and timezone data. Install [Go](https://go.dev/doc/install) 1.27.1 or newer, as required by the root `go.mod`, and [Node.js](https://nodejs.org/en/download) 24 LTS, at least 24.15.0, with npm. The repository's Angular CLI also accepts Node 22.22.3+ in the 22.x series or Node 26+.

On Debian or Ubuntu, install the basic tools with:

```bash
sudo apt update
sudo apt install git curl rsync ca-certificates tzdata
```

Install Caddy using its [official distribution packages](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) if it is not already installed. These provide `caddy.service` and `/etc/caddy/Caddyfile`. Check your build tools before continuing:

```bash
go version
node --version
npm --version
caddy version
```

## Clone and build

Run these commands as your SSH user. Use the HTTPS clone URL below, or the repository's SSH URL if you have configured a GitHub SSH key.

```bash
mkdir -p ~/src
cd ~/src
git clone https://github.com/ralscha/transit-ch.git
cd transit-ch

go test ./...
mkdir -p frontend/tmp/server-build
go build -trimpath -o frontend/tmp/server-build/transit-ch-backend ./backend
go build -trimpath -o frontend/tmp/server-build/transit-ch-importer ./importer

cd frontend
npm install --include=dev
npm run check
cd ..
```

`npm run check` runs the frontend tests, lint and production build. Its postbuild step creates `.gz`, `.br` and `.zst` files and can take several minutes. Wait for it to finish successfully before installing anything. The commands below assume you are still in `~/src/transit-ch`.

## Install the built files

Create the service account once, skipping this command if it already exists:

```bash
sudo useradd --system --user-group --no-create-home \
  --home-dir /opt/transit-ch --shell /usr/sbin/nologin transit-ch
```

Install the executables and frontend:

```bash
sudo install -d -o root -g transit-ch -m 1775 /opt/transit-ch
sudo install -o root -g root -m 0755 \
  frontend/tmp/server-build/transit-ch-backend \
  frontend/tmp/server-build/transit-ch-importer /opt/transit-ch/
sudo install -d -o root -g root -m 0755 /opt/transit-ch/dist/transit-ch/browser
sudo rsync -a --chown=root:root --chmod=D755,F644 \
  frontend/dist/transit-ch/browser/ /opt/transit-ch/dist/transit-ch/browser/
```

The trailing slash on the frontend source copies its contents, including the compressed files, to the web root used by the repository's Caddyfile. The source checkout can stay in your home directory; the services use only the installed output.

The `1775` directory mode lets the importer create and atomically replace `platforms.bin` beside the executables. The directory and installed executables remain root-owned; the sticky bit prevents the service account from removing or replacing the executables. Keep the frontend directories root-owned as shown above. If a snapshot already exists from a manual import run as root, give the service account ownership of that file before refreshing it:

```bash
if [ -f /opt/transit-ch/platforms.bin ]; then
  sudo chown transit-ch:transit-ch /opt/transit-ch/platforms.bin
fi
```

## Install systemd units

The backend and importer both use `/opt/transit-ch/platforms.bin`. The importer is allowed to write to `/opt/transit-ch` within its systemd sandbox; the backend has read-only filesystem access. A fresh installation needs no path override.

```bash
sudo install -o root -g root -m 0644 \
  deploy/systemd/transit-ch.service \
  deploy/systemd/transit-ch-import.service \
  deploy/systemd/transit-ch-import.timer /etc/systemd/system/

sudo systemd-analyze verify \
  /etc/systemd/system/transit-ch.service \
  /etc/systemd/system/transit-ch-import.service \
  /etc/systemd/system/transit-ch-import.timer
sudo systemctl daemon-reload
```

If you already followed the earlier version of this guide and created `data.conf`, change that override to the new path before importing:

```bash
if [ -f /etc/systemd/system/transit-ch.service.d/data.conf ]; then
  sudo tee /etc/systemd/system/transit-ch.service.d/data.conf >/dev/null <<'EOF'
[Service]
Environment=PLATFORM_DB=/opt/transit-ch/platforms.bin
EOF
  sudo systemctl daemon-reload
fi
```

Import the data **before** starting the backend:

```bash
sudo systemctl start transit-ch-import.service
sudo journalctl -u transit-ch-import.service -n 30 --no-pager
sudo test -s /opt/transit-ch/platforms.bin
```

Continue only when the import succeeds. The importer creates `/opt/transit-ch/platforms.bin` as the service account. No manual CSV download or separate database installation is needed. If you previously used `/var/lib/transit-ch`, the fresh import creates the new snapshot without modifying the old one. After changing paths on an already-running installation, restart the backend with `sudo systemctl restart transit-ch.service` so it loads the new setting.

Enable the backend and timer at boot and start them now:

```bash
sudo systemctl enable --now transit-ch.service transit-ch-import.timer
curl --fail --show-error 'http://127.0.0.1:34341/traffic-point-v2/8503000?platform=41'
```

The lookup should return JSON containing platform coordinates. `transit-ch.service` stays running. `transit-ch-import.timer` triggers an import every day at 01:30 Europe/Zurich and catches up after a missed run. `transit-ch-import.service` runs once and exits; `inactive (dead)` after a successful import is normal. Do not enable the import service itself. A successful refresh restarts an already-running backend so it loads the new data; a failed refresh leaves the current backend and snapshot in place.

## Configure Caddy

The repository's Caddyfile already uses the paths and port above. Its hostname is `transit-ch.rasc.ch`; change that first if you use a different domain. The domain's DNS records must point to the server and ports 80 and 443 must be reachable for the public site and automatic HTTPS. Port 34341 is for Caddy's connection to the backend; the current backend listens on all interfaces, so keep that port closed in the server firewall.

For a server dedicated to this site, install the configuration:

```bash
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-transit-ch
sudo install -o root -g root -m 0644 Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

If Caddy already serves other sites, add this repository's site block to the existing configuration instead of replacing the file, then validate and reload it. The [Caddy service documentation](https://caddyserver.com/docs/running#using-the-service) explains how to reload configuration without stopping the server.

Check both the site and the proxied API:

```bash
curl --fail --show-error --head https://transit-ch.rasc.ch/
curl --fail --show-error 'https://transit-ch.rasc.ch/traffic-point-v2/8503000?platform=41'
```

## Status, logs and manual refresh

```bash
systemctl status transit-ch.service transit-ch-import.timer caddy --no-pager
systemctl list-timers transit-ch-import.timer
sudo journalctl -u transit-ch.service -u transit-ch-import.service -n 100 --no-pager
sudo journalctl -u caddy -n 50 --no-pager

# Run the data refresh now, independently of the timer.
sudo systemctl start transit-ch-import.service
```

If the backend cannot open its snapshot, check both the configured path and the initial import logs:

```bash
systemctl cat transit-ch.service
systemctl show transit-ch.service --property=Environment
sudo -u transit-ch test -r /opt/transit-ch/platforms.bin
sudo journalctl -u transit-ch-import.service -n 100 --no-pager
```

## Update after a git pull

Build before touching the running installation:

```bash
cd ~/src/transit-ch
git pull --ff-only
go test ./...
go build -trimpath -o frontend/tmp/server-build/transit-ch-backend ./backend
go build -trimpath -o frontend/tmp/server-build/transit-ch-importer ./importer
cd frontend
npm install --include=dev
npm run check
cd ..
```

After all checks pass, stop the timer and wait for any running import to finish before replacing its executable. `systemctl is-active transit-ch-import.service` should report `inactive`; if it reports `activating` or `active`, wait until the import finishes.

```bash
sudo systemctl stop transit-ch-import.timer
systemctl is-active transit-ch-import.service
```

Then install the update. Stopping the backend briefly allows its executable to be replaced. When switching from the earlier `/var/lib/transit-ch` setup, complete the path-override and initial-import steps above after `daemon-reload` and before the final `systemctl start` command. Also import first if an update changes the snapshot format.

```bash
sudo systemctl stop transit-ch.service
sudo install -d -o root -g transit-ch -m 1775 /opt/transit-ch
sudo install -o root -g root -m 0755 \
  frontend/tmp/server-build/transit-ch-backend \
  frontend/tmp/server-build/transit-ch-importer /opt/transit-ch/
sudo rsync -a --chown=root:root --chmod=D755,F644 \
  frontend/dist/transit-ch/browser/ /opt/transit-ch/dist/transit-ch/browser/
sudo install -o root -g root -m 0644 \
  deploy/systemd/transit-ch.service \
  deploy/systemd/transit-ch-import.service \
  deploy/systemd/transit-ch-import.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start transit-ch.service transit-ch-import.timer
```

The platform data survives these updates. Frontend files do not require a Caddy reload. If the Caddyfile itself changed, merge those changes into `/etc/caddy/Caddyfile`, validate it, and reload Caddy as above.

The frontend copy intentionally retains older hashed bundles so already-open pages can still load them after an update.
