import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {LoadingBarService} from '../../model/loading-bar.service';

@Component({
  selector: 'app-top-loading-bar',
  templateUrl: './top-loading-bar.component.html',
  styleUrls: ['./top-loading-bar.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: []
})
export class TopLoadingBarComponent {
  @Input() active?: boolean;
  @Input() suppressed = false;
  @Input() zIndex?: number;

  constructor(public loadingBarService: LoadingBarService) {}

  get isBarActive(): boolean {
    if (this.suppressed) {
      return false;
    }
    if (this.active !== undefined) {
      return this.active;
    }
    return this.loadingBarService.isLoading();
  }
}
