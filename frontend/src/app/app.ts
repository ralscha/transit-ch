import { Component, DestroyRef, DOCUMENT, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { AppUpdateService } from './app-update.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { StateService } from './state.service';
import { BoardType } from './transport-api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, TranslocoPipe],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
  host: { '[style.height.px]': 'viewportHeight()' },
})
export class App {
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly translocoService = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly state = inject(StateService);
  protected readonly activeSection = signal<BoardType | 'destination'>('departure');
  protected readonly viewportHeight = signal<number | null>(null);

  constructor() {
    this.trackViewportHeight();

    const browserLang = navigator.language.split('-')[0];
    if (['en', 'fr', 'it', 'de'].includes(browserLang)) {
      this.translocoService.setActiveLang(browserLang);
    }

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        const url = this.router.parseUrl(event.urlAfterRedirects);
        const path = url.root.children['primary']?.segments[0]?.path ?? '';
        const board = url.queryParams['board'];
        if (path === '' || board === 'arrival' || board === 'departure') {
          this.state.setBoardMode(board === 'arrival' ? 'arrival' : 'departure');
        }
        this.activeSection.set(
          path === 'destination' || url.queryParams['section'] === 'destination'
            ? 'destination'
            : this.state.boardMode(),
        );
      });
  }

  private trackViewportHeight(): void {
    const document = inject(DOCUMENT);
    const window = document.defaultView;
    if (!window) return;

    const viewport = window.visualViewport;
    const syncHeight = () => {
      // Keep pinch zoom from resizing the layout underneath the user.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;

      // Mobile startup/browser controls can leave 100dvh taller than the visible area.
      const height = viewport?.height || window.innerHeight;
      if (height > 0) this.viewportHeight.set(height);
    };

    syncHeight();
    const frame = window.requestAnimationFrame(syncHeight);
    viewport?.addEventListener('resize', syncHeight);
    window.addEventListener('resize', syncHeight);
    window.addEventListener('pageshow', syncHeight);
    document.addEventListener('visibilitychange', syncHeight);

    inject(DestroyRef).onDestroy(() => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', syncHeight);
      window.removeEventListener('resize', syncHeight);
      window.removeEventListener('pageshow', syncHeight);
      document.removeEventListener('visibilitychange', syncHeight);
    });
  }
}
