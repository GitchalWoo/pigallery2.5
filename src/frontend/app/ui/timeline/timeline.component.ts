import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Inject,
  LOCALE_ID,
  type OnDestroy,
  type OnInit,
  ViewChild,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import {formatDate} from '@angular/common';
import {ActivatedRoute, type Params, Router} from '@angular/router';
import {Subscription} from 'rxjs';
import {FrameComponent} from '../frame/frame.component';
import {GalleryGridComponent} from '../gallery/grid/grid.gallery.component';
import {
  GalleryLightboxComponent,
  type LightboxGrid,
  type LightboxGridTile,
  type LightboxLoadState,
} from '../gallery/lightbox/lightbox.gallery.component';
import {MediaButtonModalComponent} from '../gallery/grid/photo/media-button-modal/media-button-modal.component';
import {type MediaGroup} from '../gallery/navigator/sorting.service';
import {type MediaDTO} from '../../../../common/entities/MediaDTO';
import {GroupByTypes} from '../../../../common/entities/SortingMethods';
import {QueryParams} from '../../../../common/QueryParams';
import {Config} from '../../../../common/config/public/Config';
import {AuthenticationService} from '../../model/network/authentication.service';
import {NavigationService} from '../../model/navigation.service';
import {PiTitleService} from '../../model/pi-title.service';
import {PageHelper} from '../../model/page.helper';
import {ShareService} from '../gallery/share.service';
import {TimelineStore} from './timeline.store';
import {
  formatTimelineMonth,
  getTimelineMediaId,
  getTimelineMonth,
  getTimelineMonthEnd,
  groupTimelineByDay,
  parseTimelineMonth,
  type TimelineMonth,
} from './timeline-grouping';
import {TimelineScrubberComponent} from './scrubber/timeline-scrubber.component';

@Component({
  selector: 'app-timeline',
  templateUrl: './timeline.component.html',
  styleUrls: ['./timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    FrameComponent,
    GalleryGridComponent,
    GalleryLightboxComponent,
    MediaButtonModalComponent,
    TimelineScrubberComponent,
  ]
})
export class TimelineComponent implements OnInit, OnDestroy {
  static readonly AT_PARAM = 'at';
  private static readonly PRELOAD_MARGIN_PX = 800;

  @ViewChild(GalleryGridComponent, {static: false}) grid: GalleryGridComponent;
  @ViewChild('sentinel', {static: true}) sentinel: ElementRef<HTMLElement>;

  mediaGroups: MediaGroup[] = [];
  ready = false;
  readonly mediaIdFn = getTimelineMediaId;
  readonly headerMethod = GroupByTypes.Date;
  atMonth: TimelineMonth = null;
  extraQueryParams: Params = {};
  currentMonthKey: string = null;

  private readonly storeTick = signal(0);
  private observer: IntersectionObserver;
  private subscription = new Subscription();
  private renderedItems: MediaDTO[] = null;
  private recheckTimer: number = null;
  private scrollFrame: number = null;

  // Adapter connecting TimelineStore + GalleryGridComponent to GalleryLightboxComponent.
  readonly lightboxGrid: LightboxGrid = {
    media: computed((): MediaDTO[] | null => {
      this.storeTick();
      const items = this.store.items;
      return items.length === 0 && this.store.loading ? null : [...items];
    }),
    revealMedia: (media: MediaDTO): Promise<LightboxGridTile | null> =>
      this.grid?.revealMedia(media) ?? Promise.resolve(null),
    getMediaId: getTimelineMediaId,
    getQueryParams: (media?: MediaDTO): Params => {
      const params = this.extraQueryParams;
      return media ? {...params, [QueryParams.gallery.photo]: getTimelineMediaId(media)} : params;
    },
    hasMore: computed((): boolean => {
      this.storeTick();
      return this.store.hasMore;
    }),
    loadState: computed((): LightboxLoadState => {
      this.storeTick();
      if (this.store.loading) {
        return 'loading';
      }
      return this.store.error ? 'error' : 'idle';
    }),
    loadMore: (): Promise<void> => this.store.loadNextPage(),
  };

  constructor(
    public store: TimelineStore,
    private authService: AuthenticationService,
    private shareService: ShareService,
    private navigation: NavigationService,
    private piTitleService: PiTitleService,
    private router: Router,
    private route: ActivatedRoute,
    private changeDetector: ChangeDetectorRef,
    @Inject(LOCALE_ID) private locale: string
  ) {
    PageHelper.showScrollY('timeline');
  }

  async ngOnInit(): Promise<void> {
    await this.shareService.wait();
    if (!this.authService.isAuthenticated()) {
      await this.navigation.toLogin();
      return;
    }
    if (!this.isAvailable()) {
      await this.navigation.toDefault();
      return;
    }
    this.piTitleService.setTitle($localize`Timeline`);
    this.ready = true;
    this.subscription.add(this.store.changes.subscribe((): void => this.onStoreChange()));
    this.onStoreChange();
    this.changeDetector.detectChanges();
    this.observeSentinel();
    let initial = true;
    this.subscription.add(this.route.queryParams.subscribe((params): void => {
      this.onQueryParams(params, initial);
      initial = false;
    }));
    this.store.loadSummary().catch(console.error);
  }

  ngOnDestroy(): void {
    this.store.cancel();
    this.subscription.unsubscribe();
    this.observer?.disconnect();
    if (this.scrollFrame !== null) {
      cancelAnimationFrame(this.scrollFrame);
    }
    if (this.recheckTimer !== null) {
      clearTimeout(this.recheckTimer);
    }
  }

  @HostListener('window:scroll')
  onScroll(): void {
    if (this.scrollFrame !== null || !this.ready) {
      return;
    }
    this.scrollFrame = requestAnimationFrame((): void => {
      this.scrollFrame = null;
      this.updateCurrentMonth();
    });
  }

  jumpToMonth(key: string): void {
    const month = parseTimelineMonth(key);
    if (!month) {
      return;
    }
    // the URL already holds this month, so the router would ignore the navigation
    if (this.atMonth && formatTimelineMonth(this.atMonth) === formatTimelineMonth(month)) {
      this.startAt(month);
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {[TimelineComponent.AT_PARAM]: formatTimelineMonth(month), [QueryParams.gallery.photo]: null},
      queryParamsHandling: 'merge',
    }).catch(console.error);
  }

  get hasSummary(): boolean {
    return (this.store.summary?.years ?? []).some(
      (y): boolean => y.months.some((m): boolean => m.count > 0)
    );
  }

  retry(): void {
    this.loadMore(true);
  }

  backToNewest(): void {
    if (this.atMonth) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {[TimelineComponent.AT_PARAM]: null, [QueryParams.gallery.photo]: null},
        queryParamsHandling: 'merge',
      }).catch(console.error);
    } else {
      this.startAt(null);
    }
  }

  private onQueryParams(params: Params, initial: boolean): void {
    const raw = params[TimelineComponent.AT_PARAM];
    const month = parseTimelineMonth(raw);
    if (raw !== undefined && !month) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {[TimelineComponent.AT_PARAM]: null},
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }).catch(console.error);
      return;
    }
    this.atMonth = month;
    this.extraQueryParams = month ? {[TimelineComponent.AT_PARAM]: formatTimelineMonth(month)} : {};
    const before = month ? getTimelineMonthEnd(month) : null;
    if (before !== this.store.startBefore) {
      this.startAt(month);
    } else if (initial && this.store.items.length === 0) {
      this.loadMore();
    }
  }

  private startAt(month: TimelineMonth): void {
    this.store.reset(month ? getTimelineMonthEnd(month) : null);
    this.currentMonthKey = month ? formatTimelineMonth(month) : null;
    PageHelper.ScrollY = 0;
    this.loadMore();
  }

  private updateCurrentMonth(): void {
    const media = this.grid?.firstVisibleMedia();
    if (!media) {
      return;
    }
    const key = formatTimelineMonth(
      getTimelineMonth(media, Config.Gallery.ignoreTimestampOffset)
    );
    if (key !== this.currentMonthKey) {
      this.currentMonthKey = key;
      this.changeDetector.markForCheck();
    }
  }

  private isAvailable(): boolean {
    const user = this.authService.user.value;
    return Config.Timeline.enabled &&
      !!user &&
      !user.usedSharingKey &&
      user.role >= Config.Timeline.readAccessMinRole;
  }

  private onStoreChange(): void {
    this.storeTick.update(v => v + 1);
    if (this.store.shouldRefreshSummary) {
      this.store.loadSummary().catch(console.error);
    }
    if (this.renderedItems !== this.store.items || this.store.items.length !== this.groupedCount()) {
      this.renderedItems = this.store.items;
      this.mediaGroups = groupTimelineByDay(
        this.store.items,
        Config.Gallery.ignoreTimestampOffset,
        (dayStart): string => formatDate(dayStart, 'longDate', this.locale, 'UTC')
      );
    }
    if (!this.store.loading) {
      this.scheduleSentinelCheck();
    }
  }

  private groupedCount(): number {
    return this.mediaGroups.reduce((count, group): number => count + group.media.length, 0);
  }

  private loadMore(retry = false): void {
    if (this.store.loading || !this.store.hasMore || (this.store.error && !retry)) {
      return;
    }
    this.store.loadNextPage().catch(console.error);
  }

  private observeSentinel(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }
    this.observer = new IntersectionObserver((entries): void => {
      if (entries.some((e): boolean => e.isIntersecting)) {
        this.loadMore();
      }
    }, {rootMargin: `0px 0px ${TimelineComponent.PRELOAD_MARGIN_PX}px 0px`});
    this.observer.observe(this.sentinel.nativeElement);
  }

  // The observer only fires on transitions, so re-check once the grid rendered a new page.
  private scheduleSentinelCheck(): void {
    if (this.recheckTimer !== null) {
      clearTimeout(this.recheckTimer);
    }
    this.recheckTimer = window.setTimeout((): void => {
      this.recheckTimer = null;
      this.updateCurrentMonth();
      const top = this.sentinel.nativeElement.getBoundingClientRect().top;
      if (top < window.innerHeight + TimelineComponent.PRELOAD_MARGIN_PX) {
        this.loadMore();
      }
    }, 100);
  }
}
