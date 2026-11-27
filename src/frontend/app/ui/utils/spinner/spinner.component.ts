import {ChangeDetectionStrategy, Component} from '@angular/core';

@Component({
  selector: 'app-spinner',
  template: `
    <div class="spinner-border" role="status">
      <span class="visually-hidden" i18n>Loading…</span>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      min-height: 50dvh;
      color: var(--bs-primary-text-emphasis);
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner-border { animation: none; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager
})
export class SpinnerComponent {}
