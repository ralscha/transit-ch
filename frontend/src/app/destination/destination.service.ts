import { Service, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, of, tap, timeout } from 'rxjs';
import type { StationSearchResult } from '../transport-api.service';
import {
  ConnectionDto,
  Coordinates,
  DestinationDeparture,
  nextDepartures,
} from './journey-results';

export type JourneyOrigin =
  { kind: 'position'; position: Coordinates } | { kind: 'station'; station: StationSearchResult };

export interface DestinationSession {
  destination: StationSearchResult;
  origin: JourneyOrigin;
  departures: DestinationDeparture[];
  updatedAt: number;
}

@Service()
export class DestinationService {
  private readonly http = inject(HttpClient);
  readonly session = signal<DestinationSession | null>(null);
  private cache?: { key: string; at: number; connections: ConnectionDto[] };

  search(origin: JourneyOrigin, destination: StationSearchResult): Observable<DestinationSession> {
    const from =
      origin.kind === 'position'
        ? `${origin.position.latitude},${origin.position.longitude}`
        : (origin.station.id ?? origin.station.name);
    const to = destination.id ?? destination.name;
    const key = `${from}|${to}`;
    const now = Date.now();
    if (this.cache?.key === key && now - this.cache.at < 30000) {
      return of(this.result(this.cache.connections, origin, destination, this.cache.at));
    }
    // Ask for more than five routes because transfer alternatives can share a
    // vehicle, and the planner may order routes by arrival or initial walking time.
    const params = new HttpParams().set('from', from).set('to', to).set('limit', '16');
    return this.http
      .get<{ connections: ConnectionDto[]; errors?: unknown[] }>(
        'https://transport.opendata.ch/v1/connections',
        { params },
      )
      .pipe(
        timeout(20000),
        map((response) => {
          if (!Array.isArray(response.connections) || response.errors?.length)
            throw new Error('Invalid journey response');
          return response.connections;
        }),
        tap((connections) => {
          this.cache = { key, at: Date.now(), connections };
        }),
        map((connections) => this.result(connections, origin, destination, Date.now())),
      );
  }

  private result(
    connections: ConnectionDto[],
    origin: JourneyOrigin,
    destination: StationSearchResult,
    updatedAt: number,
  ): DestinationSession {
    return {
      origin,
      destination,
      updatedAt,
      departures: nextDepartures(
        connections,
        Date.now(),
        origin.kind === 'position' ? origin.position : undefined,
      ),
    };
  }
}
