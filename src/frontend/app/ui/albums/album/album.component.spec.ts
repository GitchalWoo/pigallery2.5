import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {BsModalRef, BsModalService} from 'ngx-bootstrap/modal';
import {NgIconsModule} from '@ng-icons/core';
import {ionLockClosedOutline, ionTrashOutline} from '@ng-icons/ionicons';

import {AlbumComponent} from './album.component';
import {ThumbnailManagerService} from '../../gallery/thumbnailManager.service';
import {AlbumsService} from '../albums.service';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {UserRoles} from '../../../../../common/entities/UserDTO';
import {SearchQueryTypes} from '../../../../../common/entities/SearchQueryDTO';
import {type SavedSearchDTO} from '../../../../../common/entities/album/SavedSearchDTO';

class MockThumbnailManagerService {
  getThumbnail(): null {
    return null;
  }
}

class MockAlbumsService {
  deleteAlbum = vi.fn().mockResolvedValue(undefined);
}

class MockAuthenticationService {
  user = new BehaviorSubject({role: UserRoles.Admin});
}

class MockBsModalService {
  hideSpy = vi.fn();
  show = vi.fn().mockImplementation(() => ({hide: this.hideSpy} as unknown as BsModalRef));
}

describe('AlbumComponent', () => {
  let component: AlbumComponent;
  let fixture: ComponentFixture<AlbumComponent>;
  let albumsService: MockAlbumsService;
  let modalService: MockBsModalService;

  const sampleAlbum: SavedSearchDTO = {
    id: 42,
    name: 'Summer 2026',
    locked: false,
    searchQuery: {type: SearchQueryTypes.any_text, value: 'beach'} as any,
    cache: {id: 1, itemCount: 12, valid: true, cover: null},
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        AlbumComponent,
        NgIconsModule.withIcons({ionTrashOutline, ionLockClosedOutline}),
      ],
      providers: [
        {provide: ThumbnailManagerService, useClass: MockThumbnailManagerService},
        {provide: AlbumsService, useClass: MockAlbumsService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: BsModalService, useClass: MockBsModalService},
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AlbumComponent);
    component = fixture.componentInstance;
    component.album = sampleAlbum;
    component.size = 200;
    albumsService = TestBed.inject(AlbumsService) as unknown as MockAlbumsService;
    modalService = TestBed.inject(BsModalService) as unknown as MockBsModalService;
    fixture.detectChanges();
  });

  it('should open a confirmation modal instead of deleting immediately', () => {
    const deleteIcon: HTMLElement = fixture.nativeElement.querySelector('ng-icon.delete');
    expect(deleteIcon).toBeTruthy();

    const click = new MouseEvent('click', {bubbles: true, cancelable: true});
    const stopSpy = vi.spyOn(click, 'stopPropagation');
    deleteIcon.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    expect(modalService.show).toHaveBeenCalledTimes(1);
    expect(albumsService.deleteAlbum).not.toHaveBeenCalled();
  });

  it('should close the modal without deleting on cancel', () => {
    const deleteIcon: HTMLElement = fixture.nativeElement.querySelector('ng-icon.delete');
    deleteIcon.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));

    component.hideModal();

    expect(modalService.hideSpy).toHaveBeenCalledTimes(1);
    expect(albumsService.deleteAlbum).not.toHaveBeenCalled();
  });

  it('should close the modal and delete the album when confirmed', async () => {
    const deleteIcon: HTMLElement = fixture.nativeElement.querySelector('ng-icon.delete');
    deleteIcon.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));

    await component.deleteAlbum();

    expect(modalService.hideSpy).toHaveBeenCalledTimes(1);
    expect(albumsService.deleteAlbum).toHaveBeenCalledWith(sampleAlbum);
  });
});
