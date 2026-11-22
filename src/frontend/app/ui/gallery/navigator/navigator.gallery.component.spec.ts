import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {GalleryNavigatorComponent} from './navigator.gallery.component';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {QueryService} from '../../../model/query.service';
import {ContentLoaderService} from '../contentLoader.service';
import {FilterService} from '../filter/filter.service';
import {GallerySortingService} from './sorting.service';
import {GalleryNavigatorService} from './navigator.service';
import {type ContentWrapperWithError} from '../../../../../common/entities/ContentWrapper';

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
});
