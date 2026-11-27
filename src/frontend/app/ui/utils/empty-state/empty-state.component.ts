import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {NgIconComponent} from '@ng-icons/core';

@Component({
  selector: 'app-empty-state',
  template: `
    <ng-icon [name]="icon" aria-hidden="true"></ng-icon>
    <div class="state-heading"><ng-content></ng-content></div>
    <div class="state-hint"><ng-content select="[hint]"></ng-content></div>
    <div class="state-action"><ng-content select="[action]"></ng-content></div>
  `,
  styles: `
    :host {
      display: block;
      padding: 2rem var(--gallery-page-gutter);
      text-align: center;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    ng-icon {
      color: var(--bs-secondary-color);
      font-size: 2.5rem;
      margin-bottom: .5rem;
    }
    .state-heading {
      font-size: 1.25rem;
      font-weight: 600;
    }
    .state-hint {
      color: var(--bs-secondary-color);
      max-width: 42rem;
      margin-inline: auto;
    }
    .state-action:not(:empty) {
      margin-top: 1rem;
    }
  `,
  imports: [NgIconComponent],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class EmptyStateComponent {
  @Input({required: true}) icon: string;
}
