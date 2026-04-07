import { Component, inject, signal, DestroyRef } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { StateService } from '../state.service';
import { StationSearchResult, TransportApiService } from '../transport-api.service';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, switchMap, finalize, of } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [ReactiveFormsModule, TranslocoPipe],
  templateUrl: './search.html',

  styleUrls: ['./search.css'],
})
export class SearchComponent {
  searchCtrl = new FormControl('', { nonNullable: true });
  state = inject(StateService);
  api = inject(TransportApiService);
  router = inject(Router);
  destroyRef = inject(DestroyRef);

  results = signal<StationSearchResult[]>([]);
  isLoading = signal(false);
  error = signal<string | null>(null);
  geolocationLoading = signal(false);

  constructor() {
    this.searchCtrl.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((query) => {
          if (query.trim().length < 2) return of([]);
          this.isLoading.set(true);
          return this.api.searchStations(query).pipe(finalize(() => this.isLoading.set(false)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (res) => this.results.set(res),
        error: () => this.error.set('Failed to load.'),
      });

    this.loadNearbyStations();
  }

  loadNearbyStations() {
    if ('geolocation' in navigator) {
      this.geolocationLoading.set(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.api
            .getStationsNearMe(position.coords.latitude, position.coords.longitude)
            .pipe(finalize(() => this.geolocationLoading.set(false)))
            .subscribe({
              next: (res) => {
                if (!this.searchCtrl.value) {
                  this.results.set(res);
                }
              },
            });
        },
        () => {
          this.geolocationLoading.set(false);
        },
      );
    }
  }

  goBack() {
    this.router.navigate(['/']);
  }

  selectStation(station: { id: string | null; name: string; distanceLabel: string | null }) {
    this.state.selectStation(station);
  }
}
