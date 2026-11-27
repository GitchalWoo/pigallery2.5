import {CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideIcons} from '@ng-icons/core';
import {ionAddOutline, ionAlbumsOutline, ionPeopleOutline, ionWarningOutline} from '@ng-icons/ionicons';
import {BehaviorSubject} from 'rxjs';
import {BsModalService} from 'ngx-bootstrap/modal';
import {UserRoles} from '../../../common/entities/UserDTO';
import {AuthenticationService} from '../model/network/authentication.service';
import {NetworkService} from '../model/network/network.service';
import {NavigationService} from '../model/navigation.service';
import {PiTitleService} from '../model/pi-title.service';
import {QueryService} from '../model/query.service';
import {AlbumsComponent} from './albums/albums.component';
import {AlbumsService} from './albums/albums.service';
import {FacesComponent} from './faces/faces.component';
import {DuplicateComponent} from './duplicates/duplicates.component';
import {FacesNavigatorComponent} from './faces/navigator/navigator.faces.component';
import {FrameComponent} from './frame/frame.component';
import {SearchQueryParserService} from './gallery/search/search-query-parser.service';
import {ShareService} from './gallery/share.service';

describe('Collection page states', () => {
  const getJson = vi.fn();

  beforeEach(() => {
    getJson.mockReset();
    TestBed.configureTestingModule({
      providers: [
        AlbumsService,
        SearchQueryParserService,
        provideIcons({ionAddOutline, ionAlbumsOutline, ionPeopleOutline, ionWarningOutline}),
        {provide: NetworkService, useValue: {getJson}},
        {provide: BsModalService, useValue: {}},
        {provide: AuthenticationService, useValue: {
          user: new BehaviorSubject({role: UserRoles.Admin}),
          isAuthenticated: () => true,
        }},
        {provide: ShareService, useValue: {wait: () => Promise.resolve()}},
        {provide: NavigationService, useValue: {}},
        {provide: QueryService, useValue: {}},
        {provide: PiTitleService, useValue: {setTitle: vi.fn()}},
      ],
    });
    TestBed.overrideComponent(AlbumsComponent, {
      remove: {imports: [FrameComponent]},
      add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]},
    });
    TestBed.overrideComponent(FacesComponent, {
      remove: {imports: [FrameComponent, FacesNavigatorComponent]},
      add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]},
    });
    TestBed.overrideComponent(DuplicateComponent, {
      remove: {imports: [FrameComponent]},
      add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]},
    });
  });

  it('waits for Albums to load before showing the empty state and Add saved search tile', async () => {
    let finish: (result: unknown) => void;
    getJson.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const fixture = TestBed.createComponent(AlbumsComponent);
    const view = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    expect(view.querySelector('app-spinner')).not.toBeNull();
    expect(view.querySelector('app-empty-state')).toBeNull();
    expect(view.querySelector('.add-saved-search')).toBeNull();

    finish([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.querySelector('app-spinner')).toBeNull();
    expect(view.querySelector('app-empty-state').textContent).toContain('No albums to show.');
    expect(view.querySelector('.album-tiles button.add-saved-search')).not.toBeNull();
    fixture.componentInstance.size = 0;
    fixture.detectChanges();
    expect(view.querySelector('.add-saved-search')).toBeNull();
  });

  it('shows loading and failure separately on Faces and retries an unsuccessful fetch', async () => {
    getJson.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const fixture = TestBed.createComponent(FacesComponent);
    const view = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    expect(view.querySelector('app-spinner')).not.toBeNull();
    expect(view.textContent).not.toContain('No faces to show.');

    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.querySelector('[role="alert"]').textContent).toContain('Could not load faces.');
    view.querySelector('button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.querySelector('app-empty-state').textContent).toContain('No faces to show.');
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('waits for Duplicates to load before showing the empty result', async () => {
    let finish: (result: unknown) => void;
    getJson.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const fixture = TestBed.createComponent(DuplicateComponent);
    const view = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    expect(view.querySelector('app-spinner')).not.toBeNull();
    expect(view.textContent).not.toContain('No duplicates found');
    finish([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.querySelector('app-spinner')).toBeNull();
    expect(view.textContent).toContain('No duplicates found');
  });
});
