import { Component, computed, input, signal } from '@angular/core';
import { TransportMode, TransportModeIconComponent } from './transport-api.service';

@Component({
  selector: 'app-line-badge',
  imports: [TransportModeIconComponent],
  template: `
    @if (imagePath(); as path) {
      <img
        [src]="path"
        [alt]="label()"
        width="59"
        height="20"
        (error)="failedBadgePath.set(path)"
      />
    } @else {
      <span class="fallback">
        <app-transport-mode-icon [mode]="mode()" />
        <span class="label">{{ label() }}</span>
      </span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      vertical-align: middle;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
    }

    .fallback {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      max-width: 100%;
    }

    .label {
      min-width: 0;
      padding: 2px 6px;
      background: #e3000f;
      color: #fff;
      font-size: 0.8rem;
      font-weight: bold;
      text-align: center;
      overflow-wrap: anywhere;
    }
  `,
})
export class LineBadgeComponent {
  readonly label = input.required<string>();
  readonly mode = input.required<TransportMode>();
  readonly badgePath = input.required<string | null>();
  protected readonly failedBadgePath = signal<string | null>(null);
  protected readonly imagePath = computed(() => {
    const path = this.badgePath();
    return path !== this.failedBadgePath() ? path : null;
  });
}
