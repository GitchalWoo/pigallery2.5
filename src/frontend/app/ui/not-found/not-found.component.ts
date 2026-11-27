import {ChangeDetectionStrategy, Component} from '@angular/core';
import {RouterLink} from '@angular/router';
import {PiTitleService} from '../../model/pi-title.service';
import {EmptyStateComponent} from '../utils/empty-state/empty-state.component';

@Component({
  selector: 'app-not-found',
  template: `
    <main class="not-found">
      <app-empty-state icon="ionSearchOutline">
        <h1 i18n>Page not found</h1>
        <a action class="btn btn-primary" routerLink="/gallery" i18n>Open gallery</a>
      </app-empty-state>
    </main>
  `,
  styles: `
    .not-found {
      display: grid;
      align-items: center;
      min-height: 100dvh;
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [EmptyStateComponent, RouterLink]
})
export class NotFoundComponent {
  constructor(title: PiTitleService) {
    title.setTitle($localize`Page not found`);
  }
}
