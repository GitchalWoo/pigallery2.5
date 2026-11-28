import {Injectable} from '@angular/core';
import {Subject} from 'rxjs';
import {type MediaDTO} from '../../../../common/entities/MediaDTO';
import {type TimelinePageDTO, type TimelineSummaryDTO} from '../../../../common/entities/TimelineDTO';
import {type UserDTO} from '../../../../common/entities/UserDTO';
import {Config} from '../../../../common/config/public/Config';
import {NetworkService} from '../../model/network/network.service';
import {AuthenticationService} from '../../model/network/authentication.service';
import {VersionService} from '../../model/version.service';
import {DAY_MS, getTimelineDay, getTimelineMediaId} from './timeline-grouping';

/**
 * A day of the timeline. The summary tells how many media it has; they are loaded when it gets near the screen.
 * - empty: none loaded yet, the grid shows `count` grey tiles
 * - partial: the newest ones are loaded, `next` continues it
 * - complete: all loaded (`count` is then the loaded number)
 */
export interface TimelineDay {
  day: number; // floor(effective time / DAY_MS), see getTimelineDay()
  count: number;
  items: MediaDTO[];
  state: 'empty' | 'partial' | 'complete';
  next: TimelinePageDTO['next'];
}

/** A run of consecutive complete days: what the lightbox can step through without a gap. */
export interface TimelineRun {
  media: MediaDTO[];
  // a day above (newer) / below (older) the run is not loaded yet
  hasBefore: boolean;
  hasAfter: boolean;
  // the first and last day index of the run in TimelineStore.days
  first: number;
  last: number;
}

/**
 * Timeline state that outlives TimelineComponent, so Back restores the loaded days.
 * The summary lays out every day; media are loaded by day ranges near the screen (ensureLoaded()).
 * Kept in memory only; cleared on logout and on user or projection change.
 */
@Injectable({providedIn: 'root'})
export class TimelineStore {
  static readonly PAGE_SIZE = 200;
  // the grey tiles keep this aspect ratio until the first media are loaded
  static readonly DEFAULT_ASPECT = 4 / 3;

  readonly changes = new Subject<void>();
  // newest first; null until the summary is loaded
  days: TimelineDay[] = null;
  // changes with the days or their media (not with the loading state)
  revision = 0;
  loading = false;
  error: string = null;
  summary: TimelineSummaryDTO = null;
  // set when the gallery version moved past the one the summary was loaded under
  summaryStale = false;
  summaryFailed = false;
  // the average aspect ratio of the first loaded media: the grey tiles are about as wide as the media will be
  placeholderAspect: number = null;

  private dayIndex = new Map<number, number>();
  // media string id -> day
  private dayById = new Map<string, number>();
  private epoch = 0;
  private pending: Promise<void> = null;
  private summaryEpoch = 0;
  private summaryPending: Promise<void> = null;
  private summaryVersion: string = null;
  private userKey: string = undefined;

  constructor(
    private networkService: NetworkService,
    private versionService: VersionService,
    authService: AuthenticationService
  ) {
    authService.user.subscribe((user): void => {
      const key = TimelineStore.getUserKey(user);
      if (key !== this.userKey) {
        this.userKey = key;
        this.reset();
      }
    });
    versionService.version.subscribe((version): void => {
      if (version && this.summary && this.summaryVersion && version !== this.summaryVersion) {
        this.summaryStale = true;
        this.summaryFailed = false;
        this.changes.next();
      }
    });
  }

  private static getUserKey(user: UserDTO): string {
    if (!user) {
      return null;
    }
    return JSON.stringify([user.id, user.name, user.role, user.projectionKey ?? null, user.usedSharingKey ?? null]);
  }

  get shouldRefreshSummary(): boolean {
    return this.summaryStale && !this.summaryFailed && !this.summaryPending;
  }

  /** The index of the day in days; -1 if it has no media. */
  indexOfDay(day: number): number {
    return this.dayIndex.get(day) ?? -1;
  }

  /** The day of a loaded media (by its string id, see getTimelineMediaId()); null if it is not loaded. */
  dayOfMedia(id: string): number | null {
    return this.dayById.get(id) ?? null;
  }

  /**
   * Loads the summary; refetches only when stale. A refreshed summary keeps the complete days whose count did not
   * change, the others are loaded again when they get near the screen. Failures keep what is there.
   */
  loadSummary(): Promise<void> {
    if (this.summary && !this.summaryStale) {
      return Promise.resolve();
    }
    if (this.summaryPending) {
      return this.summaryPending;
    }
    const epoch = this.summaryEpoch;
    this.error = null;
    const request = this.networkService
      .getJson<TimelineSummaryDTO>('/timeline/summary')
      .then((summary): void => {
        if (epoch !== this.summaryEpoch) {
          return;
        }
        if (!summary) {
          throw new Error('Empty timeline summary');
        }
        this.summary = summary;
        this.summaryVersion = this.versionService.version.value;
        this.summaryStale = false;
        this.summaryFailed = false;
        this.applySummary(summary.days ?? []);
      })
      .catch((err): void => {
        if (epoch !== this.summaryEpoch) {
          return;
        }
        // keeps staleness; only explicit loadSummary() calls retry until the next version change
        this.summaryFailed = true;
        if (!this.days) {
          this.error = TimelineStore.errorMessage(err);
        }
        console.error(err);
      })
      .finally((): void => {
        if (epoch !== this.summaryEpoch) {
          return;
        }
        this.summaryPending = null;
        this.changes.next();
      });
    this.summaryPending = request;
    return request;
  }

  /**
   * Loads the first of these days that is not complete, and the days below it up to the next loaded one
   * (one page). Calls while a page loads share it; the caller asks again on the next change.
   * Does nothing after an error until retry().
   */
  ensureLoaded(days: number[]): Promise<void> {
    if (this.pending) {
      return this.pending;
    }
    if (!this.days || this.error) {
      return Promise.resolve();
    }
    let start = -1;
    for (const day of days) {
      const index = this.indexOfDay(day);
      if (index !== -1 && this.days[index].state !== 'complete' && (start === -1 || index < start)) {
        start = index;
      }
    }
    return start === -1 ? Promise.resolve() : this.loadFrom(start);
  }

  /** Loads the days below the run (see runAround()). */
  loadAfter(run: TimelineRun): Promise<void> {
    // a partial last day continues
    const next = this.days?.findIndex((d, i): boolean => i >= run.last && d.state !== 'complete') ?? -1;
    return next === -1 ? Promise.resolve() : this.ensureLoaded([this.days[next].day]);
  }

  /** Loads the day above the run (see runAround()); a long day takes more calls. */
  loadBefore(run: TimelineRun): Promise<void> {
    if (!this.days) {
      return Promise.resolve();
    }
    for (let i = run.first - 1; i >= 0; --i) {
      if (this.days[i].state !== 'complete') {
        return this.ensureLoaded([this.days[i].day]);
      }
    }
    return Promise.resolve();
  }

  /**
   * The consecutive complete days around this day (with the newest part of a partial day at its end):
   * the lightbox steps through these, and loads more at their ends.
   */
  runAround(day: number): TimelineRun | null {
    const index = this.indexOfDay(day);
    if (index === -1 || this.days[index].state === 'empty') {
      return null;
    }
    // a partial day has its newest media: the complete days above it join the run
    let first = index;
    while (first > 0 && this.days[first - 1].state === 'complete') {
      first--;
    }
    let last = index;
    while (last < this.days.length - 1 && this.days[last].state === 'complete' && this.days[last + 1].state !== 'empty') {
      last++;
    }
    const media: MediaDTO[] = [];
    for (let i = first; i <= last; ++i) {
      media.push(...this.days[i].items);
    }
    return {
      media,
      first,
      last,
      // the day above / below the run is not (all) loaded
      hasBefore: first > 0,
      hasAfter: last < this.days.length - 1 || this.days[last].state !== 'complete',
    };
  }

  retry(): void {
    this.error = null;
    if (!this.days) {
      this.loadSummary().catch(console.error);
    }
    this.changes.next();
  }

  reset(): void {
    this.epoch++;
    this.summaryEpoch++;
    this.pending = null;
    this.summaryPending = null;
    this.days = null;
    this.dayIndex.clear();
    this.dayById.clear();
    this.loading = false;
    this.error = null;
    this.summary = null;
    this.summaryStale = false;
    this.summaryFailed = false;
    this.summaryVersion = null;
    this.placeholderAspect = null;
    this.revision++;
    this.changes.next();
  }

  private static errorMessage(err: unknown): string {
    return typeof err === 'string' ? err : ((err as Error)?.message || $localize`Unknown server error`);
  }

  private applySummary(counts: [number, number][]): void {
    const previous = new Map((this.days ?? []).map((d): [number, TimelineDay] => [d.day, d]));
    const previousCounts = new Map((this.days ?? []).map((d): [number, number] => [d.day, d.count]));
    this.epoch++;
    this.pending = null;
    this.loading = false;
    this.dayById.clear();
    this.days = counts.map(([day, count]): TimelineDay => {
      const old = previous.get(day);
      // a complete day keeps its media while its count stays
      if (old?.state === 'complete' && previousCounts.get(day) === count) {
        return old;
      }
      return {day, count, items: [], state: 'empty', next: null};
    });
    this.reindex();
    this.revision++;
  }

  private reindex(): void {
    this.dayIndex.clear();
    this.dayById.clear();
    this.days.forEach((d, i): void => {
      this.dayIndex.set(d.day, i);
      d.items.forEach((m): void => {
        this.dayById.set(getTimelineMediaId(m), d.day);
      });
    });
  }

  /** Loads one page from the day at this index down to the next day that has media loaded. */
  private loadFrom(start: number): Promise<void> {
    const epoch = this.epoch;
    const startDay = this.days[start];
    let end = start + 1; // the first day below the gap that is (partly) loaded
    while (end < this.days.length && this.days[end].state === 'empty') {
      end++;
    }
    const query: Record<string, number> = {limit: TimelineStore.PAGE_SIZE};
    if (startDay.state === 'partial' && startDay.next) {
      query['from'] = startDay.next.from;
      query['after'] = startDay.next.after;
    } else {
      query['before'] = (startDay.day + 1) * DAY_MS;
    }
    if (end < this.days.length) {
      query['since'] = (this.days[end].day + 1) * DAY_MS;
    }

    this.loading = true;
    this.error = null;
    this.changes.next();
    const request = this.networkService
      .getJson<TimelinePageDTO>('/timeline/media', query)
      .then((page): void => {
        if (epoch !== this.epoch) {
          return;
        }
        if (!page) {
          throw new Error('Empty timeline response');
        }
        this.applyPage(startDay.day, end < this.days.length ? this.days[end].day : null, page);
      })
      .catch((err): void => {
        if (epoch !== this.epoch) {
          return;
        }
        this.error = TimelineStore.errorMessage(err);
      })
      .finally((): void => {
        if (epoch !== this.epoch) {
          return;
        }
        this.loading = false;
        this.pending = null;
        this.changes.next();
      });
    this.pending = request;
    return request;
  }

  /**
   * Adds a page that started at startDay and stopped above stopDay (null: the end of the timeline).
   * The days it went past are complete; the day of its last media is partial if the page continues.
   */
  private applyPage(startDay: number, stopDay: number | null, page: TimelinePageDTO): void {
    const ignoreOffset = Config.Gallery.ignoreTimestampOffset;
    this.revision++;
    for (const media of page.media) {
      const id = getTimelineMediaId(media);
      if (this.dayById.has(id)) {
        continue;
      }
      const day = getTimelineDay(media, ignoreOffset);
      let index = this.indexOfDay(day);
      if (index === -1) {
        // indexed after the summary: a day of its own until the summary is refreshed
        index = this.insertDay(day);
      }
      this.days[index].items.push(media);
      this.dayById.set(id, day);
    }
    if (this.placeholderAspect === null && page.media.length > 0) {
      const ratios = page.media.map((m): number => (m.metadata?.size?.width / m.metadata?.size?.height) || 1);
      this.placeholderAspect = Math.min(3, Math.max(0.5, ratios.reduce((a, b): number => a + b, 0) / ratios.length));
    }
    const last = page.media[page.media.length - 1];
    // the page continues: it got to the day of its last media, but not past it
    const reached = page.next && last ? getTimelineDay(last, ignoreOffset) : null;
    for (const day of this.days) {
      if (day.day > startDay || day.state === 'complete') {
        continue;
      }
      if (stopDay !== null && day.day <= stopDay) {
        break;
      }
      if (reached !== null && day.day < reached) {
        break;
      }
      if (day.day === reached) {
        day.state = 'partial';
        day.next = page.next;
        day.count = Math.max(day.count, day.items.length + 1);
        break;
      }
      day.state = 'complete';
      day.next = null;
      day.count = day.items.length;
    }
  }

  private insertDay(day: number): number {
    let index = this.days.findIndex((d): boolean => d.day < day);
    if (index === -1) {
      index = this.days.length;
    }
    this.days.splice(index, 0, {day, count: 0, items: [], state: 'empty', next: null});
    this.reindex();
    return index;
  }
}
