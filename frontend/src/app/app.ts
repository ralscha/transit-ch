import { Component, inject, signal } from '@angular/core';
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
})
export class App {
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly translocoService = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly state = inject(StateService);
  protected readonly activeSection = signal<BoardType | 'destination'>('departure');

  constructor() {
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
}
