import {Component, ElementRef, LOCALE_ID, computed, inject, input, output, signal, viewChild} from '@angular/core';
import {formatDate} from '@angular/common';
import {type TimelineSummaryDTO} from '../../../../../common/entities/TimelineDTO';
import {getTimelineMonthEnd} from '../timeline-grouping';
import {
  bucketAtFraction,
  buildScrubberModel,
  fractionForMonth,
  type ScrubberBucket,
} from './timeline-scrubber.helper';

@Component({
  selector: 'app-timeline-scrubber',
  templateUrl: './timeline-scrubber.component.html',
  styleUrl: './timeline-scrubber.component.css',
})
export class TimelineScrubberComponent {
  private locale = inject(LOCALE_ID);

  readonly summary = input<TimelineSummaryDTO | null>(null);
  readonly currentMonthKey = input<string | null>(null);
  // a picked month; also while dragging, as the thumb passes months
  readonly jumpToMonth = output<string>();
  readonly dragChange = output<boolean>();

  readonly track = viewChild<ElementRef<HTMLElement>>('track');

  readonly model = computed(() => buildScrubberModel(this.summary()));
  readonly hasBuckets = computed((): boolean => this.model().buckets.length > 0);

  // Active interaction state (hover or drag).
  readonly dragging = signal(false);
  readonly hoverFraction = signal<number | null>(null);
  private dragPointerId: number | null = null;
  // the month the drag scrolled to last
  private draggedKey: string | null = null;

  readonly activeFraction = computed((): number | null => {
    const hover = this.hoverFraction();
    if (hover !== null) {
      return hover;
    }
    return fractionForMonth(this.model().buckets, this.currentMonthKey());
  });

  readonly previewBucket = computed((): ScrubberBucket | null => {
    const hover = this.hoverFraction();
    if (hover === null) {
      return null;
    }
    return bucketAtFraction(this.model().buckets, hover);
  });

  readonly previewLabel = computed((): string | null => {
    const bucket = this.previewBucket();
    if (!bucket) {
      return null;
    }
    return this.formatMonth(bucket.year, bucket.month);
  });

  readonly activeIndex = computed((): number => {
    const preview = this.previewBucket();
    const buckets = this.model().buckets;
    if (preview) {
      return buckets.indexOf(preview);
    }
    const key = this.currentMonthKey();
    const index = key ? buckets.findIndex(b => b.key === key) : 0;
    return index === -1 ? 0 : index;
  });

  readonly activeLabel = computed((): string => {
    const preview = this.previewLabel();
    if (preview) {
      return preview;
    }
    const key = this.currentMonthKey();
    const bucket = key ? this.model().buckets.find(b => b.key === key) : this.model().buckets[0];
    return bucket ? this.formatMonth(bucket.year, bucket.month) : '';
  });

  onPointerDown(event: PointerEvent): void {
    if (!this.hasBuckets() || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    const el = this.track()?.nativeElement;
    el?.setPointerCapture?.(event.pointerId);
    this.dragPointerId = event.pointerId;
    this.dragging.set(true);
    this.draggedKey = null;
    this.dragChange.emit(true);
    this.dragTo(this.fractionFromEvent(event));
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.hasBuckets()) {
      return;
    }
    if (this.dragging()) {
      if (event.pointerId !== this.dragPointerId) {
        return;
      }
      event.preventDefault();
      this.dragTo(this.fractionFromEvent(event));
    } else if (event.pointerType === 'mouse') {
      this.hoverFraction.set(this.fractionFromEvent(event));
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragging() || event.pointerId !== this.dragPointerId) {
      return;
    }
    event.preventDefault();
    const fraction = this.fractionFromEvent(event);
    const bucket = bucketAtFraction(this.model().buckets, fraction);
    this.dragPointerId = null;
    this.dragging.set(false);
    if (event.pointerType !== 'mouse') {
      this.hoverFraction.set(null);
    } else {
      this.hoverFraction.set(fraction);
    }
    if (bucket && bucket.key !== this.draggedKey) {
      this.jumpToMonth.emit(bucket.key);
    }
    this.draggedKey = null;
    this.dragChange.emit(false);
  }

  onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }
    this.dragPointerId = null;
    this.dragging.set(false);
    this.hoverFraction.set(null);
    this.draggedKey = null;
    this.dragChange.emit(false);
  }

  onPointerLeave(event: PointerEvent): void {
    if (!this.dragging() && event.pointerType === 'mouse') {
      this.hoverFraction.set(null);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    const buckets = this.model().buckets;
    if (buckets.length === 0) {
      return;
    }
    const index = this.activeIndex();
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'PageDown':
        nextIndex = Math.min(buckets.length - 1, index + (event.key === 'PageDown' ? 6 : 1));
        break;
      case 'ArrowUp':
      case 'PageUp':
        nextIndex = Math.max(0, index - (event.key === 'PageUp' ? 6 : 1));
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = buckets.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.jumpToMonth.emit(buckets[nextIndex].key);
  }

  /** The page follows the thumb: it scrolls to each month the drag gets to. */
  private dragTo(fraction: number): void {
    this.hoverFraction.set(fraction);
    const bucket = bucketAtFraction(this.model().buckets, fraction);
    if (bucket && bucket.key !== this.draggedKey) {
      this.draggedKey = bucket.key;
      this.jumpToMonth.emit(bucket.key);
    }
  }

  private fractionFromEvent(event: PointerEvent): number {
    const el = this.track()?.nativeElement;
    if (!el) {
      return 0;
    }
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  }

  private formatMonth(year: number, month: number): string {
    return formatDate(getTimelineMonthEnd({year, month: month - 1}), 'MMMM y', this.locale, 'UTC');
  }
}
