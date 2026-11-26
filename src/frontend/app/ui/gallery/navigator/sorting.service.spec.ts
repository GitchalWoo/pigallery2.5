import {DatePipe} from '@angular/common';
import {BehaviorSubject, firstValueFrom, of} from 'rxjs';
import {GallerySortingService, type GroupedDirectoryContent} from './sorting.service';
import {type DirectoryContent} from '../contentLoader.service';
import {GroupByTypes, type GroupingMethod, SortByTypes, type SortingMethod} from '../../../../../common/entities/SortingMethods';
import {type MediaDTO} from '../../../../../common/entities/MediaDTO';

describe('GallerySortingService', () => {
  let service: GallerySortingService;
  const noGrouping: GroupingMethod = {method: GroupByTypes.NoGrouping, ascending: true};

  beforeEach(() => {
    service = new GallerySortingService(
      {getSorting: (): null => null, getGrouping: (): null => null} as never,
      {content: new BehaviorSubject(null)} as never,
      {setSeed: (): void => undefined, get: (): number => 0} as never,
      new DatePipe('en-US')
    );
  });

  const apply = (content: DirectoryContent, sorting: SortingMethod, grouping: GroupingMethod): Promise<GroupedDirectoryContent> => {
    service.sorting.next(sorting);
    service.grouping.next(grouping);
    return firstValueFrom(service.applySorting(of(content)));
  };
  const names = async (content: DirectoryContent, sorting: SortingMethod, grouping = noGrouping): Promise<string[][]> =>
    (await apply(content, sorting, grouping)).mediaGroups.map(g => g.media.map(m => m.name));

  describe('by directory', () => {
    // as the backend stores them: the root is ./ and ., its subdirectories are in ./
    const dir = (path: string, name: string) => ({path, name});
    const inDir = (name: string, directory: { path: string; name: string }): MediaDTO =>
      ({name, directory, metadata: {size: {width: 10, height: 10}}} as unknown as MediaDTO);
    const searchResult = (): DirectoryContent => ({
      directories: [],
      metaFile: [],
      media: [
        inDir('1.jpg', dir('2020/', 'Summer')),
        inDir('2.jpg', dir('2021/', 'Summer')),
        inDir('r.jpg', dir('./', '.')),
        inDir('y.jpg', dir('./', '2021')),
        inDir('t.jpg', dir('./', '2020 trip')),
        inDir('3.jpg', dir('2020/', 'Summer')),
        inDir('x.jpg', dir('./', '2020')),
        inDir('4.jpg', dir('2021/', 'Summer')),
        inDir('w.jpg', dir('2021\\', 'Winter')), // a Windows server
      ]
    } as DirectoryContent);
    // the tree: a directory is right before its subdirectories, same-named directories are not mixed
    const tree = [['r.jpg'], ['x.jpg'], ['1.jpg', '3.jpg'], ['t.jpg'], ['y.jpg'], ['2.jpg', '4.jpg'], ['w.jpg']];

    it('should sort in tree order', async () => {
      expect(await names(searchResult(), {method: SortByTypes.Directory, ascending: true})).toEqual([tree.flat()]);
    });

    it('should reverse the tree order when descending', async () => {
      expect(await names(searchResult(), {method: SortByTypes.Directory, ascending: false})).toEqual([tree.flat().reverse()]);
    });

    it('should group by the whole path, with / also on Windows and Home for the root', async () => {
      const groups = (await apply(searchResult(), {method: SortByTypes.Name, ascending: true},
        {method: GroupByTypes.Directory, ascending: true})).mediaGroups;
      expect(groups.map(g => [g.name, g.directoryPath])).toEqual([
        ['Home', '.'], ['2020', '2020'], ['2020/Summer', '2020/Summer'], ['2020 trip', '2020 trip'],
        ['2021', '2021'], ['2021/Summer', '2021/Summer'], ['2021/Winter', '2021/Winter']
      ]);
      expect(groups.map(g => g.media.map(m => m.name))).toEqual(tree);
    });

    it('should sort within the directory groups', async () => {
      const groups = await names(searchResult(), {method: SortByTypes.Name, ascending: false},
        {method: GroupByTypes.Directory, ascending: true});
      expect(groups[2]).toEqual(['3.jpg', '1.jpg']);
    });

    it('should label the scroll indicator with the path', () => {
      const fn = service.getScrollLabelFn({method: SortByTypes.Directory, ascending: true}, noGrouping);
      expect(fn?.order).toBe(SortByTypes.Directory);
      expect(searchResult().media.map(m => fn?.label(m))).toEqual(['2020/Summer', '2021/Summer', 'Home', '2021', '2020 trip',
        '2020/Summer', '2020', '2021/Summer', '2021/Winter']);
    });

    it('should sort the subdirectories by name', async () => {
      const content = {
        ...searchResult(),
        directories: [{name: 'b'}, {name: 'a10'}, {name: 'a9'}]
      } as unknown as DirectoryContent;
      const res = await apply(content, {method: SortByTypes.Directory, ascending: true}, noGrouping);
      expect(res.directories.map(d => d.name)).toEqual(['a9', 'a10', 'b']);
    });
  });

  // #1308: a letter with an accent does not split the A group: Árvíztűrő is in the same group as Avocado,
  // like it sorts with A
  it('should group by name accent aware: Árvíztűrő is in the A group', async () => {
    const m = (name: string): MediaDTO => ({name, directory: {path: './', name: '.'}, metadata: {size: {width: 1, height: 1}}} as unknown as MediaDTO);
    const groups = (await apply({directories: [], metaFile: [], media: [m('Zebra.jpg'), m('éclair.jpg'), m('Avocado.jpg'), m('Árvíztűrő.jpg')]} as DirectoryContent,
      {method: SortByTypes.Name, ascending: true}, {method: GroupByTypes.Name, ascending: true})).mediaGroups;
    expect(groups.map(g => g.name)).toEqual(['A', 'E', 'Z']);
    expect(groups.map(g => g.media.map(x => x.name))).toEqual([['Árvíztűrő.jpg', 'Avocado.jpg'], ['éclair.jpg'], ['Zebra.jpg']]);
  });

  it('should still group by day', async () => {
    const at = (name: string, iso: string): MediaDTO =>
      ({name, directory: {path: './', name: '.'}, metadata: {creationDate: Date.parse(iso), size: {width: 1, height: 1}}} as unknown as MediaDTO);
    const groups = (await apply({
      directories: [], metaFile: [],
      media: [at('b.jpg', '2024-05-02T10:00:00Z'), at('a.jpg', '2024-05-01T10:00:00Z'), at('c.jpg', '2024-05-02T08:00:00Z')]
    } as DirectoryContent, {method: SortByTypes.Name, ascending: true}, {method: GroupByTypes.Date, ascending: true})).mediaGroups;
    expect(groups.map(g => g.media.map(m => m.name))).toEqual([['a.jpg'], ['b.jpg', 'c.jpg']]);
    expect(groups.every(g => g.directoryPath === undefined && !!g.date)).toBe(true);
  });
});
