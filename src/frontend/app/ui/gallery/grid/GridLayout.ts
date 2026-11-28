import {MediaDTO, MediaDTOUtils} from '../../../../../common/entities/MediaDTO';
import {MediaGroup} from '../navigator/sorting.service';
import {GridRowBuilder} from './GridRowBuilder';
import {GridMedia} from './GridMedia';

export interface GridLayoutParams {
  // the width the rows fill
  width: number;
  screenHeight: number;
  targetColCount: number;
  minRowCount: number;
  maxRowCount: number;
  imageMargin: number;
  // the estimated height of a group header, until the line of the group is measured
  headerHeight: number;
  // the days (UTC midnight, see MediaGroup.date) that have an inline blog: their group gets a line of its own
  blogDates?: ReadonlySet<number>;
  // the width / height of the grey tiles of the media that are not loaded yet (see MediaGroup.placeholderCount)
  placeholderAspect?: number;
}

/** The grey tiles of a row of media that are not loaded yet. */
export interface GridPlaceholder {
  count: number;
  // of one tile, like GridMedia.renderWidth / renderHeight
  width: number;
  height: number;
}

/** The part of a group that is on a line: its header (on its first line) and one row of its media. */
export interface GridSegment {
  key: string;
  group: MediaGroup;
  header: boolean;
  // the inline blog is above the row: the segment is alone on its line and as wide as the grid
  blog: boolean;
  media: GridMedia[];
  // a row of a group that is not loaded yet: it has no media
  placeholder?: GridPlaceholder;
}

/** A line of the grid: one row of a large group, or the single rows of small groups that fit next to each other. */
export interface GridLine {
  key: string;
  segments: GridSegment[];
}

/**
 * The layout of all media of the grid, also of the ones that are not rendered: where each line is and how high.
 * The grid renders only the lines on and near the screen, but the page gets the height of all of them.
 * The heights are estimated (a header or an inline blog is not known before it is rendered),
 * the grid measures the rendered lines and corrects them with setHeight().
 */
export class GridLayout {
  readonly lines: GridLine[] = [];
  private readonly rowHeights: number[] = []; // the height of the row of the line, without the headers
  private readonly hasHeader: boolean[] = [];
  private readonly measured: boolean[] = [];
  private readonly heights: number[] = [];
  private readonly tops: number[] = [];
  private readonly lineByMedia = new Map<MediaDTO, number>();
  private readonly cacheKeys: string[] = [];
  private readonly groups: MediaGroup[] = [];
  private readonly groupLines = new Map<MediaGroup, { first: number, last: number }>();
  private readonly groupsByKey = new Map<string, MediaGroup>();
  private headerHeight: number;
  totalHeight = 0;

  /**
   * @param heightCache the measured heights of earlier layouts (e.g. of the folder before a browser back), by the line and the layout params.
   *   With it a page has its real height again, so a saved scroll position shows the same photos.
   */
  constructor(groups: MediaGroup[], private readonly params: GridLayoutParams, private readonly heightCache?: Map<string, number>) {
    this.headerHeight = params.headerHeight;
    if (params.width <= 0) {
      return;
    }
    // the last line, if small groups can still join it
    let open: { line: GridLine, width: number } | null = null;
    groups.forEach((group, groupIndex) => {
      const placeholders = group.media?.length ? 0 : (group.placeholderCount ?? 0);
      if (!group.media?.length && placeholders <= 0) {
        return;
      }
      this.groups.push(group);
      if (group.key !== undefined) {
        this.groupsByKey.set(group.key, group);
      }
      const rows = placeholders > 0 ? this.buildPlaceholderRows(placeholders) : this.buildRows(group.media);
      const header = !!group.name;
      const blog = header && !!group.date && !!params.blogDates?.has(group.date.getTime());
      const segment = (row: GridRow, rowIndex: number): GridSegment => ({
        key: (group.key ?? groupIndex) + '-' + rowIndex,
        group,
        header: header && rowIndex === 0,
        blog: blog && rowIndex === 0,
        media: row.media,
        ...(row.placeholder ? {placeholder: row.placeholder} : {})
      });
      if (rows.length === 1) {
        const row = rows[0];
        if (open && !blog && !group.startsNewLine && open.width + row.width <= params.width) {
          open.line.segments.push(segment(row, 0));
          open.width += row.width;
          const i = this.lines.length - 1;
          this.rowHeights[i] = Math.max(this.rowHeights[i], row.height);
          this.hasHeader[i] = this.hasHeader[i] || header;
          this.markGroup(group, i);
        } else {
          // nothing joins the line of a blog
          const line = this.addLine(segment(row, 0), row.height, header);
          open = blog ? null : {line, width: row.width};
          this.markGroup(group, this.lines.length - 1);
        }
        this.indexMedia(row.media);
        return;
      }
      // a group with more rows is as wide as the grid: nothing shares its lines
      open = null;
      rows.forEach((row, rowIndex) => {
        this.addLine(segment(row, rowIndex), row.height, header && rowIndex === 0);
        this.markGroup(group, this.lines.length - 1);
        this.indexMedia(row.media);
      });
    });
    const layoutKey = [params.width, params.screenHeight, params.targetColCount, params.imageMargin].join('|');
    this.lines.forEach((line, i) => {
      // grey tiles are as high as estimated: nothing to remember
      if (line.segments.some(s => s.placeholder)) {
        this.cacheKeys[i] = '';
        this.measured[i] = false;
        this.heights[i] = this.estimate(i);
        return;
      }
      const media = line.segments.flatMap(s => s.media);
      this.cacheKeys[i] = layoutKey + '|' + (line.segments[0].blog ? 'blog|' : '') + line.segments.length + '|' + GridLayout.mediaKey(media[0].media) + '|' + GridLayout.mediaKey(media[media.length - 1].media);
      const cached = heightCache?.get(this.cacheKeys[i]);
      this.measured[i] = cached !== undefined;
      this.heights[i] = cached ?? this.estimate(i);
    });
    this.updateTops();
  }

  get length(): number {
    return this.lines.length;
  }

  top(index: number): number {
    return this.tops[index];
  }

  height(index: number): number {
    return this.heights[index];
  }

  /** The line of the media; -1 if it is not in the grid. */
  lineOf(media: MediaDTO): number {
    return this.lineByMedia.get(media) ?? -1;
  }

  /** The first line that ends below y (in the grid, 0 is its top); the last line if all end above it. */
  lineAt(y: number): number {
    let low = 0;
    let high = this.lines.length - 1;
    let found = high;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.tops[mid] + this.heights[mid] > y) {
        found = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return found;
  }

  /** The first media of the line at y (see lineAt()), also if it is not rendered; null if the grid is empty or the line has only grey tiles. */
  firstMediaAt(y: number): MediaDTO | null {
    return this.lines[this.lineAt(y)]?.segments.find(s => s.media.length > 0)?.media[0].media ?? null;
  }

  /** The first group of the line at y (see lineAt()); null if the grid is empty. */
  groupAt(y: number): MediaGroup | null {
    return this.lines[this.lineAt(y)]?.segments[0].group ?? null;
  }

  /** The groups that have a line between y1 and y2, in grid order. */
  groupsBetween(y1: number, y2: number): MediaGroup[] {
    if (this.lines.length === 0) {
      return [];
    }
    const groups = new Set<MediaGroup>();
    const last = this.lineAt(y2);
    for (let i = this.lineAt(y1); i <= last; ++i) {
      this.lines[i].segments.forEach(s => groups.add(s.group));
    }
    return [...groups];
  }

  /** The group with this key (see MediaGroup.key); null if it is not in the grid. */
  groupByKey(key: string): MediaGroup | null {
    return this.groupsByKey.get(key) ?? null;
  }

  /** The group after this one in the grid; null for the last one or a group that is not in the grid. */
  groupAfter(group: MediaGroup): MediaGroup | null {
    const index = this.groups.indexOf(group);
    return index === -1 ? null : this.groups[index + 1] ?? null;
  }

  /** The top of the first line of the group (in the grid); null if it is not in the grid. */
  groupTop(group: MediaGroup): number | null {
    const lines = this.groupLines.get(group);
    return lines ? this.tops[lines.first] : null;
  }

  /** The bottom of the last line of the group (in the grid); null if it is not in the grid. */
  groupBottom(group: MediaGroup): number | null {
    const lines = this.groupLines.get(group);
    return lines ? this.tops[lines.last] + this.heights[lines.last] : null;
  }

  /**
   * The lines of both layouts are laid out to the same width and grid size: only their content differs
   * (the grey tiles are content: they can get another aspect ratio).
   */
  sameGeometry(other: GridLayout): boolean {
    const a = this.params;
    const b = other.params;
    return a.width === b.width && a.screenHeight === b.screenHeight && a.targetColCount === b.targetColCount &&
      a.minRowCount === b.minRowCount && a.maxRowCount === b.maxRowCount && a.imageMargin === b.imageMargin;
  }

  /** The rendered height of a line. Returns true if it changed; call updateTops() after the changes. */
  setHeight(index: number, height: number): boolean {
    this.measured[index] = true;
    if (this.heightCache && this.cacheKeys[index]) {
      if (this.heightCache.size >= MAX_CACHED_HEIGHTS) {
        this.heightCache.clear();
      }
      this.heightCache.set(this.cacheKeys[index], height);
    }
    if (Math.abs(this.heights[index] - height) < 0.1) {
      return false;
    }
    this.heights[index] = height;
    return true;
  }

  /** The rendered height of a group header: the estimate of the lines that were not rendered yet. Call updateTops() if it changed. */
  setHeaderHeight(height: number): boolean {
    if (Math.abs(this.headerHeight - height) < 0.1) {
      return false;
    }
    this.headerHeight = height;
    this.lines.forEach((_, i) => {
      if (!this.measured[i]) {
        this.heights[i] = this.estimate(i);
      }
    });
    return true;
  }

  updateTops(): void {
    let top = 0;
    for (let i = 0; i < this.lines.length; ++i) {
      this.tops[i] = top;
      top += this.heights[i];
    }
    this.totalHeight = top;
  }

  private static mediaKey(m: MediaDTO): string {
    return m.directory?.path + '/' + m.directory?.name + '/' + m.name;
  }

  private estimate(index: number): number {
    return this.rowHeights[index] + (this.hasHeader[index] ? this.headerHeight : 0);
  }

  private addLine(segment: GridSegment, rowHeight: number, header: boolean): GridLine {
    const line = {key: segment.key, segments: [segment]};
    this.lines.push(line);
    this.rowHeights.push(rowHeight);
    this.hasHeader.push(header);
    return line;
  }

  private markGroup(group: MediaGroup, line: number): void {
    const lines = this.groupLines.get(group);
    if (lines) {
      lines.last = line;
    } else {
      this.groupLines.set(group, {first: line, last: line});
    }
  }

  private indexMedia(media: GridMedia[]): void {
    const line = this.lines.length - 1;
    media.forEach(m => this.lineByMedia.set(m.media, line));
  }

  /** The rows of a group, like the grid always laid them out: as many photos in a row as fit between the min and max row height. */
  private buildRows(media: MediaDTO[]): GridRow[] {
    const p = this.params;
    const baseMaxRowHeight = p.screenHeight / p.minRowCount;
    const minRowHeight = p.screenHeight / p.maxRowCount;
    const rows: GridRow[] = [];
    let start = 0;
    while (start < media.length) {
      let maxRowHeight = baseMaxRowHeight;
      const builder = new GridRowBuilder(media, start, p.imageMargin, p.width);
      builder.addPhotos(p.targetColCount);
      builder.adjustRowHeightBetween(minRowHeight, maxRowHeight);
      // little trick: We don't want too big single images. But if a little extra height helps fit the row, its ok
      if (builder.getPhotoRow().length > 1) {
        maxRowHeight *= 1.2;
      }
      const noFullRow = builder.calcRowHeight() > maxRowHeight;
      // if the row is not full, make it average sized.
      // Use the base max height, so not full rows of different groups that share a line have the same height
      const rowHeight = noFullRow ? (minRowHeight + baseMaxRowHeight) / 2 :
        Math.min(builder.calcRowHeight(), maxRowHeight);
      const imageHeight = rowHeight - p.imageMargin * 2;
      const rowIndex = rows.length;
      let width = 0;
      const row = builder.getPhotoRow().map((m): GridMedia => {
        const imageWidth = imageHeight * MediaDTOUtils.calcAspectRatio(m);
        width += imageWidth + p.imageMargin * 2;
        return new GridMedia(m, imageWidth, imageHeight, rowIndex);
      });
      rows.push({media: row, height: rowHeight, width});
      start += row.length;
    }
    return rows;
  }

  /**
   * The rows of count grey tiles, laid out like buildRows() lays out media of the placeholder aspect ratio:
   * a group gets about as high as it will be once its media are loaded.
   */
  private buildPlaceholderRows(count: number): GridRow[] {
    const p = this.params;
    const aspect = p.placeholderAspect || DEFAULT_PLACEHOLDER_ASPECT;
    const baseMaxRowHeight = p.screenHeight / p.minRowCount;
    const minRowHeight = p.screenHeight / p.maxRowCount;
    // GridRowBuilder.calcRowHeight() of n tiles of the same aspect ratio
    const heightOf = (n: number): number => (p.width - n * (p.imageMargin * 2) - 1) / (n * aspect) + p.imageMargin * 2;
    const rows: GridRow[] = [];
    let start = 0;
    while (start < count) {
      const remaining = count - start;
      // like GridRowBuilder.adjustRowHeightBetween()
      let n = Math.min(p.targetColCount, remaining);
      while (heightOf(n) > baseMaxRowHeight && n < remaining) {
        n++;
      }
      while (heightOf(n) < minRowHeight && n > 1) {
        n--;
      }
      const maxRowHeight = n > 1 ? baseMaxRowHeight * 1.2 : baseMaxRowHeight;
      const rowHeight = heightOf(n) > maxRowHeight ? (minRowHeight + baseMaxRowHeight) / 2 : Math.min(heightOf(n), maxRowHeight);
      const height = rowHeight - p.imageMargin * 2;
      const width = height * aspect;
      rows.push({media: [], height: rowHeight, width: n * (width + p.imageMargin * 2), placeholder: {count: n, width, height}});
      start += n;
    }
    return rows;
  }
}

// a few large folders
const MAX_CACHED_HEIGHTS = 100000;
// most photos are 4:3
const DEFAULT_PLACEHOLDER_ASPECT = 4 / 3;

interface GridRow {
  media: GridMedia[];
  height: number;
  width: number;
  placeholder?: GridPlaceholder;
}
