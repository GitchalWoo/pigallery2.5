import {
  ChangeDetectorRef,
  Component,
  HostListener,
  Inject,
  Injector,
  LOCALE_ID,
  type OnDestroy,
  type OnInit,
  ViewChild,
  ChangeDetectionStrategy,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import {formatDate} from '@angular/common';
import {toSignal} from '@angular/core/rxjs-interop';
import {ActivatedRoute, type Params} from '@angular/router';
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
import {ScrollRestorationService} from '../../model/scroll-restoration.service';
import {ShareService} from '../gallery/share.service';
import {type TimelineRun, TimelineStore} from './timeline.store';
import {
  DAY_MS,
  formatTimelineMonth,
  getTimelineMediaId,
  getTimelineMonth,
  parseTimelineMonth,
} from './timeline-grouping';
import {TimelineScrubberComponent} from './scrubber/timeline-scrubber.component';

/**
 * The whole timeline as one page, like a photo app: every day of the summary is laid out from the start
 * (grey tiles until loaded), so it scrolls up and down from anywhere and the scrubber scrolls instead of reloading.
 * The days near the screen are loaded when the scroll rests (see scheduleLoad()).
 */
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
  // the days this many screens above and below the screen are loaded too
  private static readonly LOAD_SCREENS_ABOVE = 1;
  private static readonly LOAD_SCREENS_BELOW = 1.5;
  // loads when the scroll rested this long, and at least this often while it scrolls on
  private static readonly LOAD_DELAY_MS = 120;
  private static readonly LOAD_MAX_WAIT_MS = 400;

  @ViewChild(GalleryGridComponent, {static: false}) grid: GalleryGridComponent;

  mediaGroups: MediaGroup[] = [];
  ready = false;
  readonly mediaIdFn = getTimelineMediaId;
  readonly headerMethod = GroupByTypes.Date;
  currentMonthKey: string = null;
  // a photo link has the month of the photo: a reload of it knows where to load it
  readonly photoQueryParams = (media: MediaDTO): Params => ({
    [TimelineComponent.AT_PARAM]: formatTimelineMonth(getTimelineMonth(media, Config.Gallery.ignoreTimestampOffset))
  });

  private readonly storeTick = signal(0);
  private readonly photoId = toSignal(inject(ActivatedRoute).queryParams, {initialValue: {} as Params});
  private subscription = new Subscription();
  private renderedRevision = -1;
  // the day of each group (a partly loaded day has two: its media and its grey tiles)
  private groupDays = new Map<MediaGroup, number>();
  private readonly dayNames = new Map<number, string>();
  private loadTimer: number = null;
  private loadDeadline: number = null;
  private scrollFrame: number = null;
  private scrubberDragged = false;
  // a month of the URL to scroll to, once its group is laid out
  private pendingMonth: string = null;
  // the month of a photo of the URL that is not loaded yet (from the `at` param)
  private photoMonth: string = null;

  private readonly run = computed((): TimelineRun | null => {
    this.storeTick();
    const params = this.photoId();
    const id = (params[QueryParams.gallery.photo] as string) || null;
    const day = id ? this.store.dayOfMedia(id) : this.firstVisibleDay();
    return day === null ? null : this.store.runAround(day);
  });

  // Adapter connecting TimelineStore + GalleryGridComponent to GalleryLightboxComponent.
  readonly lightboxGrid: LightboxGrid = {
    media: computed((): MediaDTO[] | null => {
      const run = this.run();
      if (run) {
        return run.media;
      }
      // the photo of the URL can still be loaded: the lightbox waits
      return this.isPhotoPending() ? null : [];
    }),
    revealMedia: (media: MediaDTO): Promise<LightboxGridTile | null> =>
      this.grid?.revealMedia(media) ?? Promise.resolve(null),
    getMediaId: getTimelineMediaId,
    getQueryParams: (media?: MediaDTO): Params => media ?
      {...this.photoQueryParams(media), [QueryParams.gallery.photo]: getTimelineMediaId(media)} : {},
    hasMore: computed((): boolean => !!this.run()?.hasAfter),
    hasPrevious: computed((): boolean => !!this.run()?.hasBefore),
    loadState: computed((): LightboxLoadState => {
      this.storeTick();
      if (this.store.loading) {
        return 'loading';
      }
      return this.store.error ? 'error' : 'idle';
    }),
    loadMore: (): Promise<void> => {
      const run = this.run();
      return run ? this.store.loadAfter(run) : Promise.resolve();
    },
    loadPrevious: (): Promise<void> => {
      const run = this.run();
      return run ? this.store.loadBefore(run) : Promise.resolve();
    },
  };

  constructor(
    public store: TimelineStore,
    private authService: AuthenticationService,
    private shareService: ShareService,
    private navigation: NavigationService,
    private piTitleService: PiTitleService,
    private scrollRestoration: ScrollRestorationService,
    private route: ActivatedRoute,
    private changeDetector: ChangeDetectorRef,
    private injector: Injector,
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
    this.readUrl(this.route.snapshot.queryParams);
    this.subscription.add(this.store.changes.subscribe((): void => this.onStoreChange()));
    this.subscription.add(this.route.queryParams.subscribe((params): void => {
      if (!params[QueryParams.gallery.photo]) {
        this.photoMonth = null;
      }
    }));
    this.onStoreChange();
    this.store.loadSummary().catch(console.error);
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    if (this.scrollFrame !== null) {
      cancelAnimationFrame(this.scrollFrame);
    }
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
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
      this.scheduleLoad();
    });
  }

  /** The scrubber picked a month: scrolls to its newest day. */
  jumpToMonth(key: string): void {
    const group = this.firstGroupOfMonth(key);
    if (!group || !this.grid) {
      return;
    }
    this.currentMonthKey = key;
    this.grid.scrollToGroup(group.key);
    this.scheduleLoad();
  }

  onScrubberDrag(dragged: boolean): void {
    this.scrubberDragged = dragged;
    if (!dragged) {
      this.scheduleLoad(true);
    }
  }

  get hasSummary(): boolean {
    return (this.store.summary?.years ?? []).some(
      (y): boolean => y.months.some((m): boolean => m.count > 0)
    );
  }

  retry(): void {
    this.store.retry();
    this.scheduleLoad(true);
  }

  private readUrl(params: Params): void {
    const month = parseTimelineMonth(params[TimelineComponent.AT_PARAM]);
    const key = month ? formatTimelineMonth(month) : null;
    // Back to the timeline restores its scroll position instead
    this.pendingMonth = key && this.scrollRestoration.restoreTarget() === null ? key : null;
    this.photoMonth = params[QueryParams.gallery.photo] ? key : null;
  }

  private static monthOfDay(day: number): string {
    const date = new Date(day * DAY_MS);
    return formatTimelineMonth({year: date.getUTCFullYear(), month: date.getUTCMonth() + 1});
  }

  private isPhotoPending(): boolean {
    if (this.store.error) {
      return false;
    }
    if (!this.store.days || this.store.loading) {
      return true;
    }
    return this.photoMonth !== null && this.monthDays(this.photoMonth).some(
      (day): boolean => this.store.days[this.store.indexOfDay(day)].state !== 'complete'
    );
  }

  private monthDays(key: string): number[] {
    return (this.store.days ?? [])
      .filter((d): boolean => TimelineComponent.monthOfDay(d.day) === key)
      .map((d): number => d.day);
  }

  private firstGroupOfMonth(key: string): MediaGroup | null {
    for (const group of this.mediaGroups) {
      if (TimelineComponent.monthOfDay(this.groupDays.get(group)) === key) {
        return group;
      }
    }
    return null;
  }

  private firstVisibleDay(): number | null {
    const group = this.grid?.firstVisibleGroup();
    return group ? this.groupDays.get(group) ?? null : null;
  }

  private updateCurrentMonth(): void {
    const day = this.firstVisibleDay();
    if (day === null) {
      return;
    }
    const key = TimelineComponent.monthOfDay(day);
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
    if (this.store.revision !== this.renderedRevision) {
      this.renderedRevision = this.store.revision;
      this.buildGroups();
      // the grid lays out the new groups, then the days near the screen are checked
      afterNextRender((): void => {
        this.scrollToPendingMonth();
        this.updateCurrentMonth();
        this.scheduleLoad(true);
      }, {injector: this.injector});
    } else if (!this.store.loading) {
      this.scheduleLoad(true);
    }
  }

  private buildGroups(): void {
    const groups: MediaGroup[] = [];
    const groupDays = new Map<MediaGroup, number>();
    for (const day of this.store.days ?? []) {
      const name = this.dayName(day.day);
      const add = (group: MediaGroup): void => {
        groups.push(group);
        groupDays.set(group, day.day);
      };
      if (day.items.length > 0) {
        add({name, key: String(day.day), media: [...day.items]});
      }
      if (day.state !== 'complete') {
        // the rest of a partly loaded day continues its group, without a header of its own
        add(day.items.length > 0 ?
          {name: '', key: day.day + ':rest', media: [], placeholderCount: Math.max(1, day.count - day.items.length)} :
          {name, key: String(day.day), media: [], placeholderCount: day.count});
      }
    }
    this.mediaGroups = groups;
    this.groupDays = groupDays;
  }

  private dayName(day: number): string {
    let name = this.dayNames.get(day);
    if (name === undefined) {
      name = formatDate(day * DAY_MS, 'longDate', this.locale, 'UTC');
      this.dayNames.set(day, name);
    }
    return name;
  }

  private scrollToPendingMonth(): void {
    if (this.pendingMonth === null || !this.grid) {
      return;
    }
    const group = this.firstGroupOfMonth(this.pendingMonth);
    if (group) {
      this.currentMonthKey = this.pendingMonth;
      this.pendingMonth = null;
      this.grid.scrollToGroup(group.key);
    } else if (this.store.days) {
      this.pendingMonth = null; // not in the timeline (anymore)
    }
  }

  /**
   * Loads the days near the screen once the scroll rests (a fast scroll or the scrubber passes many days),
   * but at least every LOAD_MAX_WAIT_MS while it scrolls on.
   */
  private scheduleLoad(now = false): void {
    if (now && this.loadTimer === null) {
      this.loadDeadline = null;
      this.loadVisibleDays();
      return;
    }
    const time = performance.now();
    this.loadDeadline ??= time + TimelineComponent.LOAD_MAX_WAIT_MS;
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer);
    }
    this.loadTimer = window.setTimeout((): void => {
      this.loadTimer = null;
      this.loadDeadline = null;
      this.loadVisibleDays();
    }, Math.max(0, Math.min(TimelineComponent.LOAD_DELAY_MS, this.loadDeadline - time)));
  }

  private loadVisibleDays(): void {
    if (!this.grid || !this.store.days || this.scrubberDragged) {
      return;
    }
    const days = this.grid
      .groupsNear(TimelineComponent.LOAD_SCREENS_ABOVE, TimelineComponent.LOAD_SCREENS_BELOW)
      .filter((g): boolean => !!g.placeholderCount)
      .map((g): number => this.groupDays.get(g))
      .filter((d): boolean => d !== undefined);
    // the photo of the URL is somewhere in its month
    if (days.length === 0 && this.photoMonth !== null && !this.run()) {
      days.push(...this.monthDays(this.photoMonth));
    }
    if (days.length > 0) {
      this.store.ensureLoaded(days).catch(console.error);
    }
  }
}
