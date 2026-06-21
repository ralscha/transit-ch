import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { filter, fromEvent, interval, merge } from 'rxjs';
import { StateService } from '../state.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TransportModeIconComponent } from '../transport-api.service';

@Component({
  selector: 'app-stationboard',
  imports: [RouterLink, TranslocoPipe, TransportModeIconComponent],
  templateUrl: './stationboard.html',
  styleUrls: ['./stationboard.css'],
})
export class StationboardComponent {
  readonly #refreshThreshold = 72;
  readonly #maxPullDistance = 120;

  state = inject(StateService);
  translocoService = inject(TranslocoService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #document = inject(DOCUMENT);
  pullDistance = signal(0);

  #touchStartY: number | null = null;
  #pullActive = false;

  constructor() {
    merge(
      interval(60000).pipe(filter(() => this.#document.visibilityState === 'visible')),
      fromEvent(this.#document, 'visibilitychange').pipe(
        filter(() => this.#document.visibilityState === 'visible'),
      ),
    )
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe(() => this.#refreshIfIdle());
  }

  isPulling = computed(() => this.pullDistance() > 0);
  refreshReady = computed(() => this.pullDistance() >= this.#refreshThreshold);
  refreshLabel = computed(() => {
    const refreshingKey =
      this.state.boardMode() === 'arrival'
        ? 'stationboard.refreshingArrivals'
        : 'stationboard.refreshingDepartures';

    if (this.state.isRefreshingBoard()) {
      return this.translocoService.translate(refreshingKey);
    }

    if (this.refreshReady()) {
      return this.translocoService.translate('stationboard.releaseToRefresh');
    }

    return this.translocoService.translate('stationboard.pullToRefresh');
  });

  swissTime() {
    return new Intl.DateTimeFormat('en-CH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Zurich',
    }).format(this.state.swissNow());
  }

  onTouchStart(event: TouchEvent) {
    if (!this.#canStartPull(event)) {
      this.#resetPull();
      return;
    }

    this.#touchStartY = event.touches[0]?.clientY ?? null;
    this.#pullActive = this.#touchStartY !== null;
  }

  onTouchMove(event: TouchEvent) {
    if (!this.#pullActive || this.#touchStartY === null || this.state.isRefreshingBoard()) {
      return;
    }

    const currentY = event.touches[0]?.clientY;

    if (currentY === undefined) {
      return;
    }

    const delta = currentY - this.#touchStartY;

    if (delta <= 0) {
      this.pullDistance.set(0);
      return;
    }

    event.preventDefault();
    this.pullDistance.set(Math.min(this.#maxPullDistance, delta * 0.45));
  }

  onTouchEnd() {
    if (this.refreshReady() && !this.state.isRefreshingBoard()) {
      this.state.refreshStationboard();
    }

    this.#resetPull();
  }

  onTouchCancel() {
    this.#resetPull();
  }

  toggleBoardMode() {
    this.state.toggleBoardMode();
  }

  #canStartPull(event: TouchEvent): boolean {
    const currentTarget = event.currentTarget;

    if (!(currentTarget instanceof HTMLElement)) {
      return false;
    }

    return (
      currentTarget.scrollTop <= 0 && !!this.state.selectedStation() && !this.state.isLoadingBoard()
    );
  }

  #refreshIfIdle() {
    if (
      this.state.selectedStation() &&
      !this.state.isLoadingBoard() &&
      !this.state.isRefreshingBoard()
    ) {
      this.state.refreshStationboard();
    }
  }

  #resetPull() {
    this.#pullActive = false;
    this.#touchStartY = null;
    this.pullDistance.set(0);
  }
}
