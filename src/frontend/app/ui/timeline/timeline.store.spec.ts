import {BehaviorSubject} from 'rxjs';
import {TimelineStore} from './timeline.store';
import {MediaDTO} from '../../../../common/entities/MediaDTO';
import {TimelinePageDTO, TimelineSummaryDTO} from '../../../../common/entities/TimelineDTO';
import {UserDTO, UserRoles} from '../../../../common/entities/UserDTO';
import {
  DAY_MS,
  formatTimelineMonth,
  getTimelineMonth,
  getTimelineMediaId,
  getTimelineMonthEnd,
  parseTimelineMonth,
} from './timeline-grouping';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  const d = {} as Deferred<T>;
  d.promise = new Promise<T>((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });
  return d;
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

function media(id: number, creationDate: number): MediaDTO {
  return {
    id,
    name: id + '.jpg',
    directory: {name: 'dir', path: '/'},
    metadata: {creationDate, size: {width: 4, height: 3}},
  } as MediaDTO;
}

// a media of this day (hour: its time in the day)
const at = (id: number, day: number, hour = 12): MediaDTO => media(id, day * DAY_MS + hour * 3600000);

function page(items: MediaDTO[], next: TimelinePageDTO['next']): TimelinePageDTO {
  return {media: items, next};
}

const summaryOf = (days: [number, number][]): TimelineSummaryDTO => ({years: [], days});

describe('TimelineStore', () => {
  let requests: { url: string; query: Record<string, number>; response: Deferred<TimelinePageDTO> }[];
  let summaryRequests: Deferred<TimelineSummaryDTO>[];
  let user: BehaviorSubject<UserDTO>;
  let version: BehaviorSubject<string>;
  let store: TimelineStore;

  const state = (): Record<number, string> =>
    Object.fromEntries(store.days.map(d => [d.day, d.state + ':' + d.items.map(m => m.id).join(',')]));

  beforeEach(() => {
    requests = [];
    summaryRequests = [];
    user = new BehaviorSubject<UserDTO>({id: 1, name: 'u', role: UserRoles.User} as UserDTO);
    version = new BehaviorSubject<string>('v1');
    const network = {
      getJson: (url: string, query: Record<string, number>) => {
        if (url === '/timeline/summary') {
          const summary = deferred<TimelineSummaryDTO>();
          summaryRequests.push(summary);
          return summary.promise;
        }
        const response = deferred<TimelinePageDTO>();
        requests.push({url, query, response});
        return response.promise;
      }
    };
    store = new TimelineStore(network as never, {version} as never, {user} as never);
  });

  const loadSummary = async (days: [number, number][]): Promise<void> => {
    store.loadSummary();
    summaryRequests[summaryRequests.length - 1].resolve(summaryOf(days));
    await flushMicrotasks();
  };

  it('lays out the days of the summary and loads a gap from its top, page by page', async () => {
    await loadSummary([[10, 1], [9, 2], [8, 3], [5, 2]]);
    expect(state()).toEqual({10: 'empty:', 9: 'empty:', 8: 'empty:', 5: 'empty:'});

    const first = store.ensureLoaded([8, 9]);
    expect(store.ensureLoaded([5]), 'one page at a time').toBe(first);
    expect(requests[0].query).toEqual({limit: TimelineStore.PAGE_SIZE, before: 10 * DAY_MS});
    // a full page that ends in day 8
    requests[0].response.resolve(page([at(92, 9, 20), at(91, 9), at(83, 8, 20)], {from: 1, after: 83}));
    await flushMicrotasks();
    expect(state()).toEqual({10: 'empty:', 9: 'complete:92,91', 8: 'partial:83', 5: 'empty:'});
    expect(store.placeholderAspect).toBeCloseTo(4 / 3);

    store.ensureLoaded([8]);
    expect(requests[1].query, 'continues the partial day').toEqual({limit: TimelineStore.PAGE_SIZE, from: 1, after: 83});
    requests[1].response.resolve(page([at(82, 8), at(81, 8, 1), at(51, 5)], null));
    await flushMicrotasks();
    expect(state()).toEqual({10: 'empty:', 9: 'complete:92,91', 8: 'complete:83,82,81', 5: 'complete:51'});
    expect(store.days[3].count, 'the loaded number').toBe(1);

    store.ensureLoaded([10, 9]);
    expect(requests[2].query, 'stops above the loaded day below').toEqual({
      limit: TimelineStore.PAGE_SIZE, before: 11 * DAY_MS, since: 10 * DAY_MS
    });
    requests[2].response.resolve(page([at(101, 10)], null));
    await flushMicrotasks();
    expect(state()[10]).toBe('complete:101');
    expect(store.dayOfMedia(getTimelineMediaId(media(101, 0)))).toBe(10);

    store.ensureLoaded([10, 9, 8, 5]);
    expect(requests.length, 'all complete').toBe(3);
  });

  it('gives the lightbox the run of loaded days around a day and loads at its ends', async () => {
    await loadSummary([[10, 1], [9, 2], [8, 3], [5, 2]]);
    store.ensureLoaded([9]);
    requests[0].response.resolve(page([at(92, 9, 20), at(91, 9), at(83, 8)], {from: 1, after: 83}));
    await flushMicrotasks();

    const run = store.runAround(8)!;
    expect(run.media.map(m => m.id)).toEqual([92, 91, 83]);
    expect(run.hasBefore).toBe(true);
    expect(run.hasAfter).toBe(true);
    expect(store.runAround(10), 'nothing loaded').toBeNull();

    store.loadAfter(run);
    expect(requests[1].query).toEqual({limit: TimelineStore.PAGE_SIZE, from: 1, after: 83});
    requests[1].response.resolve(page([at(82, 8), at(81, 8, 1)], {from: 2, after: 81}));
    await flushMicrotasks();

    store.loadBefore(store.runAround(9)!);
    expect(requests[2].query).toEqual({limit: TimelineStore.PAGE_SIZE, before: 11 * DAY_MS, since: 10 * DAY_MS});
  });

  it('puts media of a day the summary does not know (indexed since) into a day of its own', async () => {
    await loadSummary([[10, 1], [8, 1]]);
    store.ensureLoaded([10]);
    requests[0].response.resolve(page([at(101, 10), at(91, 9), at(81, 8)], null));
    await flushMicrotasks();
    expect(store.days.map(d => d.day)).toEqual([10, 9, 8]);
    expect(state()).toEqual({10: 'complete:101', 9: 'complete:91', 8: 'complete:81'});
    expect(store.dayOfMedia(getTimelineMediaId(media(81, 0)))).toBe(8);
  });

  it('keeps an error until retry, and drops responses after a user change', async () => {
    await loadSummary([[10, 1], [9, 1]]);
    store.ensureLoaded([10]);
    requests[0].response.reject('Server down');
    await flushMicrotasks();
    expect(store.error).toBe('Server down');
    store.ensureLoaded([10]);
    expect(requests.length).toBe(1);

    store.retry();
    store.ensureLoaded([10]);
    expect(requests.length).toBe(2);
    user.next({id: 1, name: 'u', role: UserRoles.User, projectionKey: 'other'} as UserDTO);
    requests[1].response.resolve(page([at(101, 10)], null));
    await flushMicrotasks();
    expect(store.days).toBeNull();
    expect(store.summary).toBeNull();
  });

  it('refreshes a summary made stale by a version change and keeps the unchanged complete days', async () => {
    await loadSummary([[10, 1], [9, 2]]);
    store.ensureLoaded([10]);
    requests[0].response.resolve(page([at(101, 10), at(92, 9), at(91, 9, 1)], null));
    await flushMicrotasks();
    const ten = store.days[0];

    version.next('v2');
    expect(store.shouldRefreshSummary).toBe(true);
    store.loadSummary();
    summaryRequests[1].resolve(summaryOf([[11, 4], [10, 1], [9, 3]]));
    await flushMicrotasks();

    expect(store.summaryStale).toBe(false);
    expect(store.days[1], 'same count: kept').toBe(ten);
    expect(state()).toEqual({11: 'empty:', 10: 'complete:101', 9: 'empty:'});
    expect(store.dayOfMedia(getTimelineMediaId(media(92, 0)))).toBeNull();
  });

  it('keeps a failed summary refresh stale without retrying automatically', async () => {
    await loadSummary([[10, 1]]);
    version.next('v2');
    store.loadSummary();
    summaryRequests[1].reject('down');
    await flushMicrotasks();
    expect(store.days.length, 'keeps the days').toBe(1);
    expect(store.error, 'the timeline is still shown').toBeNull();
    expect(store.summaryStale).toBe(true);
    expect(store.shouldRefreshSummary).toBe(false);

    store.loadSummary();
    expect(summaryRequests.length).toBe(3);
  });
});

describe('Timeline months', () => {
  it('accepts only YYYY-MM with a real month', () => {
    expect(parseTimelineMonth('2015-06')).toEqual({year: 2015, month: 6});
    expect(parseTimelineMonth('1969-12')).toEqual({year: 1969, month: 12});
    for (const bad of ['2015-6', '2015-13', '2015-00', '15-06', '2015-06-01', '', undefined, ['2015-06']]) {
      expect(parseTimelineMonth(bad), String(bad)).toBeNull();
    }
    expect(formatTimelineMonth({year: 812, month: 3})).toBe('0812-03');
  });

  it('jumps to the exclusive first instant of the following month', () => {
    expect(getTimelineMonthEnd({year: 2015, month: 6})).toBe(Date.UTC(2015, 6, 1));
    expect(getTimelineMonthEnd({year: 2015, month: 12})).toBe(Date.UTC(2016, 0, 1));
    expect(getTimelineMonthEnd({year: 1969, month: 12})).toBe(0);
    expect(getTimelineMonthEnd({year: 50, month: 1})).toBe(new Date('0050-02-01T00:00:00Z').getTime());
  });

  it('puts media in the month of its effective time', () => {
    const item = media(1, Date.UTC(2017, 1, 28, 23, 30));
    item.metadata.creationDateOffset = '+01:00';
    expect(getTimelineMonth(item, true)).toEqual({year: 2017, month: 3});
    expect(getTimelineMonth(item, false)).toEqual({year: 2017, month: 2});
  });
});
