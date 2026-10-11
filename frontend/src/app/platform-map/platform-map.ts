import {
  OnInit,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Subject, catchError, combineLatest, map, of, startWith, switchMap, timeout } from 'rxjs';
import type { Map, Marker } from 'maplibre-gl';

interface PlatformPoint {
  platform: string;
  sloid: string;
  lat: number;
  lng: number;
}

@Component({
  selector: 'app-platform-map',
  imports: [TranslocoPipe],
  templateUrl: './platform-map.html',
  styleUrl: './platform-map.css',
})
export class PlatformMapComponent implements OnInit {
  @ViewChild('mapContainer', { static: true }) private container!: ElementRef<HTMLDivElement>;
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);
  private readonly reload = new Subject<void>();
  private map?: Map;
  private markers: Marker[] = [];
  private requestId = 0;
  private mapTimeout?: ReturnType<typeof setTimeout>;
  protected readonly station = signal('');
  protected readonly platform = signal('');
  protected readonly points = signal<PlatformPoint[]>([]);
  protected readonly status = signal<'loading' | 'ready' | 'unavailable' | 'error' | 'mapError'>(
    'loading',
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.removeMap());
  }

  ngOnInit() {
    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.reload.pipe(startWith(undefined)),
    ])
      .pipe(
        switchMap(([params, query]) => {
          const id = ++this.requestId;
          this.removeMap();
          this.points.set([]);
          this.status.set('loading');
          const stationId = params.get('stationId') ?? '';
          const platform = query.get('platform')?.trim() ?? '';
          this.station.set(query.get('station') || stationId);
          this.platform.set(platform);
          if (!/^\d+$/.test(stationId) || !platform || platform.length > 96) {
            return of({ id, response: null, status: 'unavailable' as const });
          }
          return this.http
            .get<{ points: PlatformPoint[] }>(`/traffic-point-v2/${stationId}`, {
              params: new HttpParams().set('platform', platform),
            })
            .pipe(
              timeout(15000),
              map((response) => ({ id, response, status: 'ready' as const })),
              catchError((error: unknown) =>
                of({
                  id,
                  response: null,
                  status:
                    error instanceof HttpErrorResponse &&
                    (error.status === 404 || error.status === 400)
                      ? ('unavailable' as const)
                      : ('error' as const),
                }),
              ),
            );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (!result.response) {
          this.status.set(result.status);
          return;
        }
        const points = result.response.points;
        if (
          !Array.isArray(points) ||
          !points.length ||
          points.some(
            (point) =>
              !Number.isFinite(point.lat) ||
              !Number.isFinite(point.lng) ||
              Math.abs(point.lat) > 90 ||
              Math.abs(point.lng) > 180 ||
              !point.platform,
          )
        ) {
          this.status.set('error');
          return;
        }
        this.points.set(points);
        void this.showMap(points, result.id);
      });
  }

  protected retry() {
    this.reload.next();
  }

  protected goBack() {
    const state = this.location.getState() as { navigationId?: number };
    if ((state.navigationId ?? 0) > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/']);
    }
  }

  protected focusPoint(point: PlatformPoint) {
    this.map?.jumpTo({ center: [point.lng, point.lat], zoom: 18 });
  }

  private async showMap(points: PlatformPoint[], requestId: number) {
    try {
      const maplibre = await import('maplibre-gl');
      if (this.destroyRef.destroyed || requestId !== this.requestId) return;
      maplibre.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibre.getVersion()}`);
      const map = new maplibre.Map({
        container: this.container.nativeElement,
        style: 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.basemap.vt/style.json',
        center: [points[0].lng, points[0].lat],
        zoom: 18,
        maxZoom: 20,
        attributionControl: false,
      });
      this.map = map;
      this.mapTimeout = setTimeout(() => {
        if (this.map === map && this.status() === 'loading') this.status.set('mapError');
      }, 15000);
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibre.ScaleControl({ unit: 'metric', maxWidth: 100 }));
      map.addControl(
        new maplibre.AttributionControl({
          compact: true,
          customAttribution: '<a href="https://www.swisstopo.admin.ch/">© swisstopo</a>',
        }),
      );
      map.on('load', () => {
        clearTimeout(this.mapTimeout);
        if (this.map === map) this.status.set('ready');
      });
      map.on('error', () => {
        if (this.map === map) this.status.set('mapError');
      });
      const bounds = new maplibre.LngLatBounds();
      for (const point of points) {
        const marker = document.createElement('div');
        marker.className = 'platform-map-marker';
        marker.textContent = point.platform;
        marker.setAttribute('role', 'img');
        marker.setAttribute(
          'aria-label',
          this.transloco.translate('platformMap.marker', { platform: point.platform }),
        );
        this.markers.push(
          new maplibre.Marker({ element: marker, anchor: 'bottom', offset: [0, -8] })
            .setLngLat([point.lng, point.lat])
            .addTo(map),
        );
        bounds.extend([point.lng, point.lat]);
      }
      if (points.length > 1) map.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 0 });
    } catch {
      if (!this.destroyRef.destroyed && requestId === this.requestId) this.status.set('mapError');
    }
  }

  private removeMap() {
    clearTimeout(this.mapTimeout);
    for (const marker of this.markers) marker.remove();
    this.markers = [];
    this.map?.remove();
    this.map = undefined;
  }
}
