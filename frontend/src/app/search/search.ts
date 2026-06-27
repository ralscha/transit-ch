import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { form, FormField, FormRoot } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, type Subscription } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { StateService } from '../state.service';
import { StationSearchResult, TransportApiService } from '../transport-api.service';

interface SearchFormModel {
  query: string;
}

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [FormField, FormRoot, TranslocoPipe],
  templateUrl: './search.html',
  styleUrls: ['./search.css'],
})
export class SearchComponent {
  readonly searchModel = signal<SearchFormModel>({ query: '' });
  readonly searchForm = form(this.searchModel);
  readonly state = inject(StateService);
  readonly api = inject(TransportApiService);
  readonly router = inject(Router);
  readonly destroyRef = inject(DestroyRef);

  readonly results = signal<StationSearchResult[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly geolocationLoading = signal(false);

  constructor() {
    effect((onCleanup) => {
      const query = this.searchModel().query.trim();
      let searchSubscription: Subscription | null = null;

      this.error.set(null);

      if (query.length < 2) {
        this.isLoading.set(false);
        return;
      }

      this.isLoading.set(true);
      const searchTimer = window.setTimeout(() => {
        searchSubscription = this.api
          .searchStations(query)
          .pipe(finalize(() => this.isLoading.set(false)))
          .subscribe({
            next: (res) => this.results.set(res),
            error: () => this.error.set('Failed to load.'),
          });
      }, 250);

      onCleanup(() => {
        window.clearTimeout(searchTimer);
        searchSubscription?.unsubscribe();
      });
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
            .pipe(
              finalize(() => this.geolocationLoading.set(false)),
              takeUntilDestroyed(this.destroyRef),
            )
            .subscribe({
              next: (res) => {
                if (!this.searchModel().query) {
                  this.results.set(res);
                }
              },
              error: () => this.error.set('Failed to load.'),
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

  selectStation(station: StationSearchResult) {
    this.state.selectStation(station);
  }
}
