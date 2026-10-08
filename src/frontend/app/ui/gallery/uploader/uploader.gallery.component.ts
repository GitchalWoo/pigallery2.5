import {Component, Input, computed, ChangeDetectionStrategy} from '@angular/core';
import { NgStyle } from '@angular/common';
import {NgIconComponent} from '@ng-icons/core';
import {UploaderService} from './uploader.service';

@Component({
  selector: 'app-gallery-uploader',
  templateUrl: './uploader.gallery.component.html',
  styleUrls: ['./uploader.gallery.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    NgIconComponent,
    NgStyle
]
})
export class UploaderComponent {
  public readonly Date = Date;
  @Input() isUploadOver: boolean;
  public showDetails = false;

  public readonly overallProgress = computed(() => {
    const list = this.uploaderService.uploadProgressSignal();
    if (list.length === 0) {
      return 0;
    }
    const sum = list.reduce((a, b) => a + b.progress, 0);
    return Math.round(sum / list.length);
  });

  constructor(public uploaderService: UploaderService) {
  }

  public toggleDetails(): void {
    this.showDetails = !this.showDetails;
  }

  public getOverallProgress(): number {
    return this.overallProgress();
  }

}

