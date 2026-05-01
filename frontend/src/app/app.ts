import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppUpdateService } from './app-update.service';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TranslocoPipe],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly translocoService = inject(TranslocoService);

  constructor() {
    const browserLang = navigator.language.split('-')[0];
    if (['en', 'fr', 'it', 'de'].includes(browserLang)) {
      this.translocoService.setActiveLang(browserLang);
    }
  }
}
