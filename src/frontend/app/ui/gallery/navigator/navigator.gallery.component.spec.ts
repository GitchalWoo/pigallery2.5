import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {BehaviorSubject, firstValueFrom} from 'rxjs';
import {GalleryNavigatorComponent} from './navigator.gallery.component';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {QueryService} from '../../../model/query.service';
import {ContentLoaderService} from '../contentLoader.service';
import {FilterService} from '../filter/filter.service';
import {GallerySortingService} from './sorting.service';
import {GalleryNavigatorService} from './navigator.service';
import {UserRoles} from '../../../../../common/entities/UserDTO';
import {Config} from '../../../../../common/config/public/Config';
import {type ContentWrapperWithError} from '../../../../../common/entities/ContentWrapper';
import {GroupByTypes, SortByTypes} from '../../../../../common/entities/SortingMethods';
import {SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../../common/entities/SearchQueryDTO';

class MockAuthenticationService {
  canSearch() {
    return true;
  }
  isAuthenticated() {
    return true;
  }
}

class MockQueryService {
  params: Record<string, string> = {};
  getParams() {
    return this.params;
  }
}

class MockContentLoaderService {
  content = new BehaviorSubject<ContentWrapperWithError>({
    directory: {
      name: 'Lake',
      path: 'Vacation/',
      media: [],
      directories: [],
      metaFile: [],
      lastModified: 0,
      lastScanned: 0,
    },
  } as unknown as ContentWrapperWithError);
}

class MockFilterService {
  activeFilters = new BehaviorSubject({areFiltersActive: false, filtersVisible: false});
}

class MockSortingService {
  sorting = new BehaviorSubject({method: 1, ascending: true});
  grouping = new BehaviorSubject({method: 1, ascending: true});
  isDefaultSortingAndGrouping() {
    return true;
  }
}

class MockNavigatorService {
  gpxFilesCount = new BehaviorSubject(0);
}

describe('GalleryNavigatorComponent - zip download link', () => {
  let component: GalleryNavigatorComponent;
  let fixture: ComponentFixture<GalleryNavigatorComponent>;
  let queryService: MockQueryService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryNavigatorComponent],
      providers: [
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: QueryService, useClass: MockQueryService},
        {provide: ContentLoaderService, useClass: MockContentLoaderService},
        {provide: FilterService, useClass: MockFilterService},
        {provide: GallerySortingService, useClass: MockSortingService},
        {provide: GalleryNavigatorService, useClass: MockNavigatorService},
        provideRouter([]),
      ],
    })
      .overrideComponent(GalleryNavigatorComponent, {set: {template: ''}})
      .compileComponents();

    fixture = TestBed.createComponent(GalleryNavigatorComponent);
    component = fixture.componentInstance;
    queryService = TestBed.inject(QueryService) as unknown as MockQueryService;
  });

  const zipUrl = (): URL => new URL(component.getDownloadZipLink(), 'http://localhost');

  it('should omit the query string when there are no query params', () => {
    queryService.params = {};
    const link = component.getDownloadZipLink();
    expect(link).not.toContain('?');
  });

  it('does not build a ZIP link for a restricted share', () => {
    Object.defineProperty(TestBed.inject(AuthenticationService), 'preventDownload', {value: true});
    expect(component.getDownloadZipLink()).toBeNull();
  });

  it('should include a single query param', () => {
    queryService.params = {sk: 'abc'};
    expect(zipUrl().searchParams.get('sk')).toBe('abc');
  });

  it('should join multiple query params with & (#1311)', () => {
    queryService.params = {sk: 'abc', foo: 'bar'};
    const url = zipUrl();
    expect(url.searchParams.get('sk')).toBe('abc');
    expect(url.searchParams.get('foo')).toBe('bar');
  });

  it('keeps the share key on a ZIP URL under the application prefix', () => {
    const original = Config.Server.urlBase;
    try {
      Config.Server.urlBase = 'photos/family/';
      queryService.params = {sk: 'guest/key'};
      const url = zipUrl();
      expect(url.pathname).toMatch(/^\/photos\/family\/pgapi\/gallery\/zip\//);
      expect(url.searchParams.get('sk')).toBe('guest/key');
    } finally {
      Config.Server.urlBase = original;
    }
  });
});

describe('GalleryNavigatorComponent directory parents', () => {
  it('links available parents and clears the shortcut when the immediate parent is unavailable', async () => {
    const content = new BehaviorSubject<ContentWrapperWithError>({
      directory: {path: 'one/two', name: 'three', availableParents: [false, true, true]},
      searchResult: null
    } as ContentWrapperWithError);
    const router = {navigate: vi.fn().mockResolvedValue(true)};
    const component = new GalleryNavigatorComponent(
      {user: {value: {role: UserRoles.LimitedGuest}}} as any, {getParams: () => ({sk: 'share'})} as any,
      {content} as any, null, null, null, router as any, null
    );

    expect((await firstValueFrom(component.routes)).map(crumb => crumb.route))
      .toEqual([null, 'one', 'one/two', null]);
    component.navigateToParentDirectory();
    expect(router.navigate).toHaveBeenCalledWith(['/gallery', 'one/two'], {queryParams: {sk: 'share'}});

    content.next({...content.value, directory: {...content.value.directory, availableParents: [true, true, false]}});
    expect((await firstValueFrom(component.routes)).map(crumb => crumb.route)).toEqual(['/', 'one', null, null]);
    component.navigateToParentDirectory();
    expect(router.navigate).toHaveBeenCalledOnce();
  });
});

// all media of a folder are in the same folder: sorting or grouping it by directory is meaningless
describe('GalleryNavigatorComponent sorting by directory', () => {
  const content = new BehaviorSubject<ContentWrapperWithError>(null);
  const component = new GalleryNavigatorComponent(
    null, {getParams: () => ({})} as never, {content} as never, null, null, null, null, null
  );
  const offered = (): boolean[] => [
    component.visibleSortingByTypes.some((t) => t.key === SortByTypes.Directory),
    component.visibleGroupingByTypes.some((t) => t.key === GroupByTypes.Directory)
  ];

  it('should not be offered for a folder', () => {
    content.next({directory: {path: 'Vacation/', name: 'Árvíztűrő tükörfúrógép'}} as unknown as ContentWrapperWithError);
    expect(offered()).toEqual([false, false]);
    // the other methods stay
    expect(component.visibleSortingByTypes.map(t => t.key)).toContain(SortByTypes.Name);
  });

  it('should not be offered for an exact directory search', () => {
    content.next({
      searchResult: {
        searchQuery: {type: SearchQueryTypes.directory, matchType: TextSearchQueryMatchTypes.exact_match, value: './Vacation/Lake'}
      }
    } as unknown as ContentWrapperWithError);
    expect(offered()).toEqual([false, false]);
  });

  it('should be offered for a search and a flattened folder', () => {
    content.next({searchResult: {searchQuery: {type: SearchQueryTypes.any_text, value: 'Lake'}}} as unknown as ContentWrapperWithError);
    expect(offered()).toEqual([true, true]);
    content.next({
      searchResult: {
        searchQuery: {type: SearchQueryTypes.directory, matchType: TextSearchQueryMatchTypes.globMatch, value: 'Vacation/Lake/*'}
      }
    } as unknown as ContentWrapperWithError);
    expect(offered()).toEqual([true, true]);
  });
});
