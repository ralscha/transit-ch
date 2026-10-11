import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  Observable,
  Subject,
  Subscription,
  catchError,
  filter,
  fromEvent,
  interval,
  map,
  merge,
  of,
  switchMap,
  timer,
  timeout,
} from 'rxjs';
import { LineBadgeComponent } from '../line-badge.component';
import { StationSearchResult, TransportApiService } from '../transport-api.service';
import { DestinationService, JourneyOrigin } from './destination.service';

type SearchField = 'destination' | 'origin';

@Component({
  selector: 'app-destination',
  imports: [RouterLink, TranslocoPipe, LineBadgeComponent],
  templateUrl: './destination.html',
  styleUrl: './destination.css',
})
export class DestinationComponent implements OnInit {
  protected readonly data = inject(DestinationService);
  private readonly api = inject(TransportApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);
  private readonly queries = new Subject<{ field: SearchField; query: string }>();
  private request?: Subscription;
  protected readonly destination = signal<StationSearchResult | null>(
    this.data.session()?.destination ?? null,
  );
  protected readonly destinationQuery = signal(this.destination()?.name ?? '');
  protected readonly origin = signal<StationSearchResult | null>(null);
  protected readonly originQuery = signal('');
  protected readonly manualOrigin = signal(false);
  protected readonly suggestions = signal<StationSearchResult[]>([]);
  protected readonly activeField = signal<SearchField>('destination');
  protected readonly suggesting = signal(false);
  protected readonly suggestionError = signal(false);
  protected readonly status = signal<'idle' | 'locating' | 'loading'>('idle');
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    const savedOrigin = this.data.session()?.origin;
    if (savedOrigin?.kind === 'station') {
      this.manualOrigin.set(true);
      this.origin.set(savedOrigin.station);
      this.originQuery.set(savedOrigin.station.name);
    }
    this.queries
      .pipe(
        // Cancel the old request immediately; debounce only the new query.
        switchMap(({ field, query }) => {
          if (query.trim().length < 2) return of({ field, stations: [], failed: false });
          return timer(250).pipe(
            switchMap(() =>
              this.api.searchStations(query).pipe(
                timeout(15000),
                map((stations) => ({ field, stations, failed: false })),
                catchError(() => of({ field, stations: [], failed: true })),
              ),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ field, stations, failed }) => {
        if (field !== this.activeField()) return;
        this.suggestions.set(stations.filter((station) => !!station.id));
        this.suggestionError.set(failed);
        this.suggesting.set(false);
      });
    merge(interval(60000), fromEvent(this.document, 'visibilitychange'))
      .pipe(
        filter(() => this.document.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        const session = this.data.session();
        if (session && Date.now() - session.updatedAt >= 60000 && this.status() === 'idle')
          this.search();
      });
    this.destroyRef.onDestroy(() => this.request?.unsubscribe());
    const saved = this.data.session();
    if (saved && Date.now() - saved.updatedAt >= 60000) this.search();
  }

  protected queryChanged(event: Event, field: SearchField) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.cancel();
    this.activeField.set(field);
    this.suggestions.set([]);
    this.suggestionError.set(false);
    if (field === 'destination') {
      this.destinationQuery.set(input.value);
      this.destination.set(null);
    } else {
      this.originQuery.set(input.value);
      this.origin.set(null);
    }
    this.suggesting.set(input.value.trim().length >= 2);
    this.queries.next({ field, query: input.value });
  }

  protected select(station: StationSearchResult) {
    this.queries.next({ field: this.activeField(), query: '' });
    if (this.activeField() === 'destination') {
      this.destination.set(station);
      this.destinationQuery.set(station.name);
    } else {
      this.origin.set(station);
      this.originQuery.set(station.name);
    }
    this.suggestions.set([]);
    this.suggesting.set(false);
  }

  protected toggleOrigin() {
    this.cancel();
    this.manualOrigin.update((value) => !value);
    this.activeField.set(this.manualOrigin() ? 'origin' : 'destination');
    this.queries.next({ field: this.activeField(), query: '' });
    this.suggestions.set([]);
    this.suggesting.set(false);
    this.suggestionError.set(false);
  }

  protected search() {
    if (!this.destination() || (this.manualOrigin() && !this.origin())) return;
    this.cancel(false);
    if (this.manualOrigin()) {
      this.load({ kind: 'station', station: this.origin()! });
      return;
    }
    if (!navigator.geolocation) {
      this.error.set('locationUnavailable');
      return;
    }
    this.status.set('locating');
    this.request = new Observable<JourneyOrigin>((subscriber) => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          subscriber.next({
            kind: 'position',
            position: { latitude: coords.latitude, longitude: coords.longitude },
          });
          subscriber.complete();
        },
        (error: GeolocationPositionError) => subscriber.error(error),
        { timeout: 10000, maximumAge: 30000, enableHighAccuracy: false },
      );
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (origin) => this.load(origin),
        error: (error: GeolocationPositionError) => {
          this.status.set('idle');
          this.error.set(error.code === 1 ? 'locationDenied' : 'locationUnavailable');
        },
      });
  }

  protected formatTime(value: number) {
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Europe/Zurich',
    }).format(value);
  }

  protected formatDate(value: number) {
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Zurich',
    }).format(value);
  }

  protected formatDistance(value: number) {
    return value < 1000
      ? `${value} m`
      : `${new Intl.NumberFormat(this.transloco.getActiveLang(), { maximumFractionDigits: 1 }).format(value / 1000)} km`;
  }

  protected delay(departure: number, scheduled: number) {
    return Math.round((departure - scheduled) / 60000);
  }

  private cancel(clearResults = true) {
    this.request?.unsubscribe();
    this.status.set('idle');
    this.error.set(null);
    if (clearResults) this.data.session.set(null);
  }

  private load(origin: JourneyOrigin) {
    const destination = this.destination();
    if (!destination) return;
    this.request?.unsubscribe();
    this.status.set('loading');
    this.error.set(null);
    this.request = this.data
      .search(origin, destination)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => {
          this.data.session.set(session);
          this.status.set('idle');
        },
        error: () => {
          this.status.set('idle');
          this.error.set('failed');
        },
      });
  }
}
