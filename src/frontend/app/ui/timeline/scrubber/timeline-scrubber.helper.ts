import {type TimelineSummaryDTO} from '../../../../../common/entities/TimelineDTO';
import {formatTimelineMonth} from '../timeline-grouping';

export interface ScrubberBucket {
  key: string;
  year: number;
  month: number; // 1-12
  count: number;
  startFraction: number;
  endFraction: number;
  midFraction: number;
}

export interface ScrubberTick {
  key: string;
  fraction: number;
  kind: 'year' | 'dot';
  year?: number;
}

export interface ScrubberModel {
  buckets: ScrubberBucket[];
  ticks: ScrubberTick[];
}

// Minimum vertical spacing between visible year labels (~32px on a 720px track).
const MIN_YEAR_LABEL_GAP = 0.045;
// Minimum vertical spacing between any dot and adjacent labels/dots (~16px on a 720px track).
const MIN_DOT_GAP = 0.022;

/**
 * Builds a newest-first proportional scrubber model from a TimelineSummaryDTO.
 * Uses sqrt(count) weighting so large months get proportionally more track space
 * while small months remain easy to target.
 * Years get labeled ticks (with collision avoidance), and months in tall spans
 * get evenly spaced subtle dots.
 */
export function buildScrubberModel(summary: TimelineSummaryDTO | null): ScrubberModel {
  if (!summary?.years?.length) {
    return {buckets: [], ticks: []};
  }

  const raw: {year: number; month: number; count: number; weight: number}[] = [];
  // Iterate newest year -> oldest year, newest month -> oldest month.
  const yearsDesc = [...summary.years].sort((a, b) => b.year - a.year);
  for (const yearEntry of yearsDesc) {
    const monthsDesc = [...yearEntry.months]
      .filter(m => m.count > 0)
      .sort((a, b) => b.month - a.month);
    for (const m of monthsDesc) {
      raw.push({
        year: yearEntry.year,
        month: m.month,
        count: m.count,
        weight: Math.sqrt(m.count),
      });
    }
  }

  if (raw.length === 0) {
    return {buckets: [], ticks: []};
  }

  const totalWeight = raw.reduce((sum, item) => sum + item.weight, 0);
  const buckets: ScrubberBucket[] = [];
  const yearFirstIndex = new Map<number, number>();

  let cursor = 0;
  for (const item of raw) {
    const startFraction = cursor / totalWeight;
    cursor += item.weight;
    const endFraction = cursor / totalWeight;
    const key = formatTimelineMonth({year: item.year, month: item.month});
    if (!yearFirstIndex.has(item.year)) {
      yearFirstIndex.set(item.year, buckets.length);
    }
    buckets.push({
      key,
      year: item.year,
      month: item.month,
      count: item.count,
      startFraction,
      endFraction,
      midFraction: (startFraction + endFraction) / 2,
    });
  }

  // Pass 1: choose non-overlapping year label ticks.
  const yearTicks: ScrubberTick[] = [];
  const labeledYearKeys = new Set<string>();
  let lastYearFraction = -Infinity;
  for (const [year, index] of yearFirstIndex) {
    const bucket = buckets[index];
    if (bucket.startFraction - lastYearFraction >= MIN_YEAR_LABEL_GAP) {
      lastYearFraction = bucket.startFraction;
      labeledYearKeys.add(bucket.key);
      yearTicks.push({
        key: bucket.key,
        fraction: bucket.startFraction,
        kind: 'year',
        year,
      });
    }
  }

  // Pass 2: place subtle dots for months/suppressed years that have room between ticks.
  const ticks: ScrubberTick[] = [...yearTicks];
  let lastEmittedFraction = -Infinity;
  let nextYearIdx = 0;
  for (const bucket of buckets) {
    if (labeledYearKeys.has(bucket.key)) {
      lastEmittedFraction = bucket.startFraction;
      while (nextYearIdx < yearTicks.length && yearTicks[nextYearIdx].fraction <= bucket.startFraction) {
        nextYearIdx++;
      }
      continue;
    }
    const f = bucket.midFraction;
    const nextYearFraction = nextYearIdx < yearTicks.length ? yearTicks[nextYearIdx].fraction : Infinity;
    if (f - lastEmittedFraction >= MIN_DOT_GAP && nextYearFraction - f >= MIN_DOT_GAP) {
      ticks.push({
        key: bucket.key,
        fraction: f,
        kind: 'dot',
      });
      lastEmittedFraction = f;
    }
  }

  ticks.sort((a, b) => a.fraction - b.fraction);
  return {buckets, ticks};
}

/**
 * Returns the bucket at a normalized vertical position in [0, 1].
 */
export function bucketAtFraction(buckets: ScrubberBucket[], fraction: number): ScrubberBucket | null {
  if (buckets.length === 0) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  let low = 0;
  let high = buckets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const bucket = buckets[mid];
    if (clamped < bucket.startFraction) {
      high = mid - 1;
    } else if (clamped >= bucket.endFraction && mid < buckets.length - 1) {
      low = mid + 1;
    } else {
      return bucket;
    }
  }
  return buckets[buckets.length - 1];
}

/**
 * Returns the track fraction for a given YYYY-MM key, or null if not in the model.
 */
export function fractionForMonth(buckets: ScrubberBucket[], monthKey: string | null): number | null {
  if (!monthKey) {
    return null;
  }
  const bucket = buckets.find(b => b.key === monthKey);
  return bucket ? bucket.midFraction : null;
}
