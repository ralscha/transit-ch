import { HttpClient, HttpParams } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, inject, input } from '@angular/core';
import { interval, map, Observable, of, startWith } from 'rxjs';

interface LocationsResponse {
  stations: LocationDto[];
}

interface StationboardResponse {
  stationboard: StationboardDto[];
}

interface LocationDto {
  id?: string | null;
  name: string;
  distance?: number | null;
}

interface StationboardDto {
  name: string;
  category?: string | null;
  number?: string | null;
  operator?: string | null;
  to: string;
  passList?: StopDto[] | null;
  stop?: {
    arrival?: string | null;
    arrivalTimestamp?: number | null;
    departure?: string | null;
    departureTimestamp?: number | null;
    platform?: string | null;
    prognosis?: {
      arrival?: string | null;
      departure?: string | null;
      platform?: string | null;
    } | null;
  } | null;
}

interface StopDto {
  station?: {
    name?: string | null;
  } | null;
  arrival?: string | null;
  departure?: string | null;
  platform?: string | null;
  prognosis?: {
    arrival?: string | null;
    departure?: string | null;
    platform?: string | null;
  } | null;
}

export interface StationSearchResult {
  id: string | null;
  name: string;
  distanceLabel: string | null;
}

export type BoardType = 'departure' | 'arrival';

export type TransportMode = 'rail' | 'tram' | 'bus' | 'boat' | 'cableway' | 'unknown';

export interface StationboardEntry {
  id: string;
  name: string;
  to: string;
  operator: string | null;
  departureTimestamp: number;
  departureLabel: string;
  prognosisLabel: string | null;
  platformLabel: string;
  delayMinutes: number;
  transportMode: TransportMode;
  lineLabel: string;
  routeStops: RouteStop[];
}

export interface RouteStop {
  stationName: string;
  plannedTimeLabel: string;
  realtimeTimeLabel: string | null;
  platformLabel: string | null;
}

@Component({
  selector: 'app-transport-mode-icon',
  template: `
    <span class="mode-icon" aria-hidden="true">
      @switch (mode()) {
        @case ('tram') {
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M9 4 12 2l3 2" />
            <path d="M8 6h8" />
            <rect x="6" y="6" width="12" height="10" rx="2" />
            <path d="M9 10h.01M15 10h.01" />
            <path d="M8 16l-2 4M16 16l2 4M9 20h6" />
          </svg>
        }
        @case ('bus') {
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="5" y="4" width="14" height="12" rx="2" />
            <path d="M8 8h8M8 12h3" />
            <circle cx="8.5" cy="18" r="1.5" />
            <circle cx="15.5" cy="18" r="1.5" />
          </svg>
        }
        @case ('boat') {
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 4v8" />
            <path d="M12 4c2.7 0 4.5 1.8 5 5H7c.5-3.2 2.3-5 5-5Z" />
            <path d="M4 13h16l-2.5 4H6.5L4 13Z" />
            <path d="M4 19c1 .9 2 .9 3 0s2-.9 3 0 2 .9 3 0 2-.9 3 0 2 .9 3 0" />
          </svg>
        }
        @case ('cableway') {
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3 6h18" />
            <path d="M10 6l2 3 2-3" />
            <rect x="8" y="9" width="8" height="8" rx="2" />
            <path d="M10 13h4" />
          </svg>
        }
        @case ('unknown') {
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        }
        @default {
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="6" y="3" width="12" height="15" rx="2" />
            <path d="M9 7h6M9 11h6M9 18l-2 3M15 18l2 3" />
            <circle cx="9" cy="14.5" r="1" />
            <circle cx="15" cy="14.5" r="1" />
          </svg>
        }
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: 0 0 auto;
    }

    .mode-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      color: #4b4b4b;
    }

    svg {
      width: 100%;
      height: 100%;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransportModeIconComponent {
  readonly mode = input.required<TransportMode>();
}

@Injectable({ providedIn: 'root' })
export class TransportApiService {
  readonly #http = inject(HttpClient);
  readonly #baseUrl = 'https://transport.opendata.ch/v1';

  searchStations(query: string): Observable<StationSearchResult[]> {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      return of([]);
    }

    const params = new HttpParams().set('query', trimmedQuery).set('type', 'station');

    return this.#http.get<LocationsResponse>(`${this.#baseUrl}/locations`, { params }).pipe(
      map((response) =>
        (response.stations ?? [])
          .filter((station) => Boolean(station.name))
          .slice(0, 8)
          .map((station) => ({
            id: station.id ?? null,
            name: station.name,
            distanceLabel:
              typeof station.distance === 'number' ? `${Math.round(station.distance)} m` : null,
          })),
      ),
    );
  }

  getStationsNearMe(lat: number, lon: number): Observable<StationSearchResult[]> {
    const params = new HttpParams()
      .set('x', lat.toString())
      .set('y', lon.toString())
      .set('type', 'station');

    return this.#http.get<LocationsResponse>(`${this.#baseUrl}/locations`, { params }).pipe(
      map((response) =>
        (response.stations ?? [])
          .filter((station) => Boolean(station.name))
          .slice(0, 10)
          .map((station) => ({
            id: station.id ?? null,
            name: station.name,
            distanceLabel:
              typeof station.distance === 'number' ? `${Math.round(station.distance)} m` : null,
          })),
      ),
    );
  }

  getStationboard(
    station: StationSearchResult,
    when: Date,
    boardType: BoardType,
  ): Observable<StationboardEntry[]> {
    let params = new HttpParams()
      .set('limit', '12')
      .set('datetime', this.#toSwissApiDateTime(when))
      .set('type', boardType);

    params = station.id ? params.set('id', station.id) : params.set('station', station.name);

    return this.#http.get<StationboardResponse>(`${this.#baseUrl}/stationboard`, { params }).pipe(
      map((response) =>
        (response.stationboard ?? []).map((entry, index) => {
          const scheduledBoardTime = this.#getBoardStopTime(entry.stop, boardType);
          const prognosisBoardTime = this.#getBoardPrognosisTime(entry.stop, boardType);
          const scheduledDate = scheduledBoardTime ? new Date(scheduledBoardTime) : when;
          const realtimeDate = prognosisBoardTime ? new Date(prognosisBoardTime) : null;
          const scheduledTimestamp =
            this.#getBoardStopTimestamp(entry.stop, boardType) ??
            Math.floor(scheduledDate.getTime() / 1000);
          const delayMinutes = realtimeDate
            ? Math.max(0, Math.round((realtimeDate.getTime() - scheduledDate.getTime()) / 60000))
            : 0;
          const platform = entry.stop?.prognosis?.platform ?? entry.stop?.platform ?? null;
          const routeStops = (entry.passList ?? [])
            .map((stop) => this.#mapRouteStop(stop))
            .filter((stop): stop is RouteStop => stop !== null)
            .slice(0, 10);

          return {
            id: this.#buildStationboardEntryId(
              entry,
              boardType,
              scheduledTimestamp,
              platform,
              index,
            ),
            name: entry.name,
            to: entry.to,
            operator: entry.operator ?? null,
            departureTimestamp: scheduledTimestamp,
            departureLabel: this.#formatSwissTime(scheduledDate),
            prognosisLabel: realtimeDate ? this.#formatSwissTime(realtimeDate) : null,
            platformLabel: platform?.trim() ? platform : 'TBD',
            delayMinutes,
            transportMode: this.#resolveTransportMode(entry.category),
            lineLabel: this.#buildLineLabel(entry),
            routeStops,
          };
        }),
      ),
    );
  }

  swissClock(refreshMs: number): Observable<Date> {
    return interval(refreshMs).pipe(
      startWith(0),
      map(() => new Date()),
    );
  }

  #buildLineLabel(entry: StationboardDto): string {
    const category = entry.category?.trim();
    const number = entry.number?.trim();

    if (category && number) {
      return `${category} ${number}`;
    }

    if (category) {
      return category;
    }

    return entry.name;
  }

  #resolveTransportMode(categoryValue: string | null | undefined): TransportMode {
    const category = categoryValue?.trim().toUpperCase();

    if (!category) {
      return 'unknown';
    }

    if (category.startsWith('BAT') || category.startsWith('SHIP')) {
      return 'boat';
    }

    if (category === 'T' || category.startsWith('TRAM')) {
      return 'tram';
    }

    if (category === 'B' || category.startsWith('BUS')) {
      return 'bus';
    }

    if (['FUN', 'PB', 'GB', 'CC', 'CAB'].some((prefix) => category.startsWith(prefix))) {
      return 'cableway';
    }

    return 'rail';
  }

  #buildStationboardEntryId(
    entry: StationboardDto,
    boardType: BoardType,
    departureTimestamp: number,
    platform: string | null,
    index: number,
  ): string {
    return [
      boardType,
      departureTimestamp,
      entry.name,
      entry.to,
      entry.category ?? '',
      entry.number ?? '',
      platform ?? '',
      index,
    ].join('|');
  }

  #getBoardStopTime(stop: StationboardDto['stop'], boardType: BoardType): string | null {
    return boardType === 'arrival' ? (stop?.arrival ?? null) : (stop?.departure ?? null);
  }

  #getBoardPrognosisTime(stop: StationboardDto['stop'], boardType: BoardType): string | null {
    return boardType === 'arrival'
      ? (stop?.prognosis?.arrival ?? null)
      : (stop?.prognosis?.departure ?? null);
  }

  #getBoardStopTimestamp(stop: StationboardDto['stop'], boardType: BoardType): number | null {
    return boardType === 'arrival'
      ? (stop?.arrivalTimestamp ?? null)
      : (stop?.departureTimestamp ?? null);
  }

  #formatSwissTime(value: Date): string {
    return new Intl.DateTimeFormat('en-CH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Zurich',
    }).format(value);
  }

  #toSwissApiDateTime(value: Date): string {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Zurich',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(value);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';

    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }

  #mapRouteStop(stop: StopDto): RouteStop | null {
    const stationName = stop.station?.name?.trim();
    const plannedIso = stop.departure ?? stop.arrival ?? null;
    const realtimeIso = stop.prognosis?.departure ?? stop.prognosis?.arrival ?? null;
    const platform = stop.prognosis?.platform ?? stop.platform ?? null;

    if (!stationName || !plannedIso) {
      return null;
    }

    return {
      stationName,
      plannedTimeLabel: this.#formatSwissTime(new Date(plannedIso)),
      realtimeTimeLabel: realtimeIso ? this.#formatSwissTime(new Date(realtimeIso)) : null,
      platformLabel: platform?.trim() ? platform : null,
    };
  }
}
