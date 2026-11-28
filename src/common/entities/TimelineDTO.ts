import {MediaDTO} from './MediaDTO';

export interface TimelinePageDTO {
  media: MediaDTO[];
  next: {from: number; after: number} | null;
}

export interface TimelineSummaryMonthDTO {
  month: number;
  count: number;
}

export interface TimelineSummaryYearDTO {
  year: number;
  months: TimelineSummaryMonthDTO[];
}

export interface TimelineSummaryDTO {
  years: TimelineSummaryYearDTO[];
  /**
   * [day, count] pairs, newest day first; day = floor(effective time / 1 day), as the grid groups.
   * The client lays out the whole timeline from these before it loads the media.
   */
  days: [number, number][];
}