import { Service, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  BoardType,
  StationSearchResult,
  StationboardEntry,
  TransportApiService,
} from './transport-api.service';

@Service()
export class StateService {
  readonly #transportApi = inject(TransportApiService);
  readonly #router = inject(Router);
  #loadRequestId = 0;

  selectedStation = signal<StationSearchResult | null>(null);
  boardMode = signal<BoardType>('departure');
  stationboard = signal<StationboardEntry[]>([]);
  isLoadingBoard = signal(false);
  isRefreshingBoard = signal(false);
  boardError = signal<string | null>(null);
  boardRefreshError = signal<string | null>(null);
  swissNow = signal(new Date());

  constructor() {
    this.#transportApi.swissClock(30000).subscribe((now) => this.swissNow.set(now));
  }

  selectStation(station: StationSearchResult) {
    this.selectedStation.set(station);
    this.#loadStationboard({ navigateHome: true });
  }

  toggleBoardMode() {
    this.setBoardMode(this.boardMode() === 'departure' ? 'arrival' : 'departure');
  }

  setBoardMode(mode: BoardType) {
    if (this.boardMode() === mode) {
      return;
    }

    this.boardMode.set(mode);
    this.#loadStationboard();
  }

  refreshStationboard() {
    return this.#loadStationboard({ preserveBoardOnError: true });
  }

  #loadStationboard(options?: { navigateHome?: boolean; preserveBoardOnError?: boolean }) {
    const station = this.selectedStation();
    const boardMode = this.boardMode();

    if (!station) {
      return;
    }

    const requestId = ++this.#loadRequestId;

    const preserveBoardOnError = options?.preserveBoardOnError ?? false;
    const hasCurrentEntries = this.stationboard().length > 0;
    const isRefresh = preserveBoardOnError && hasCurrentEntries;

    this.boardError.set(null);
    this.boardRefreshError.set(null);
    this.isLoadingBoard.set(!isRefresh);
    this.isRefreshingBoard.set(isRefresh);

    this.#transportApi.getStationboard(station, this.swissNow(), boardMode).subscribe({
      next: (entries) => {
        if (requestId !== this.#loadRequestId) {
          return;
        }

        this.stationboard.set(entries);
        this.isLoadingBoard.set(false);
        this.isRefreshingBoard.set(false);

        if (options?.navigateHome) {
          this.#router.navigate(['/']);
        }
      },
      error: () => {
        if (requestId !== this.#loadRequestId) {
          return;
        }

        if (isRefresh) {
          this.boardRefreshError.set('Failed to refresh stationboard.');
        } else {
          this.boardError.set('Failed to load stationboard.');
          this.stationboard.set([]);
        }

        this.isLoadingBoard.set(false);
        this.isRefreshingBoard.set(false);

        if (options?.navigateHome) {
          this.#router.navigate(['/']);
        }
      },
    });
  }
}
