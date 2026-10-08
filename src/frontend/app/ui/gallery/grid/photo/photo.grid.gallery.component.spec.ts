import {ComponentFixture, TestBed} from '@angular/core/testing';

import {GalleryPhotoComponent} from './photo.grid.gallery.component';
import {GridMedia} from '../GridMedia';
import {PhotoDTO} from '../../../../../../common/entities/PhotoDTO';
import {ThumbnailManagerService} from '../../thumbnailManager.service';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {ExtensionService} from '../../../../model/extension.service';
import {MediaButtonModalService} from './media-button-modal/media-button-modal.service';

class MockThumbnailManagerService {
  getThumbnail() {
    return {
      Available: true,
      Src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      Error: false,
      loading: false,
      destroy() {
      },
    };
  }
}

class MockAuthenticationService {
  canSearch() {
    return false;
  }
}

class MockExtensionService {
  UIExtensionConfig: unknown[] = [];
}

class MockMediaButtonModalService {
  showModal() {
  }

  executeButtonAction() {
  }
}

function makeGridMedia(overrides: Partial<PhotoDTO> = {}): GridMedia {
  const media = {
    name: 'IMG_001.HEIC',
    directory: {name: 'photos', path: '/'},
    metadata: {
      size: {width: 4032, height: 3024},
      creationDate: Date.now(),
      fileSize: 2048000,
    },
    ...overrides,
  } as any;
  return new GridMedia(media, 100, 100, 0);
}

describe('GalleryPhotoComponent - Live Photo badge', () => {
  let component: GalleryPhotoComponent;
  let fixture: ComponentFixture<GalleryPhotoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryPhotoComponent],
      providers: [
        {provide: ThumbnailManagerService, useClass: MockThumbnailManagerService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: ExtensionService, useClass: MockExtensionService},
        {provide: MediaButtonModalService, useClass: MockMediaButtonModalService},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryPhotoComponent);
    component = fixture.componentInstance;
  });

  it('should render the LIVE badge for paired Live Photos', () => {
    component.gridMedia = makeGridMedia({
      liveVideoPath: 'photos/IMG_001_HEVC.MOV',
    } as any);

    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.live-photo-indicator');
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toBe('LIVE');
  });

  it('should not render the LIVE badge for regular photos', () => {
    component.gridMedia = makeGridMedia();

    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.live-photo-indicator')
    ).toBeNull();
  });

  it('should display loading component while loaded is false', () => {
    component.gridMedia = makeGridMedia();
    component.loaded = false;
    fixture.detectChanges();

    const loadingComp = fixture.nativeElement.querySelector('app-gallery-grid-photo-loading');
    expect(loadingComp).not.toBeNull();

    const img = fixture.nativeElement.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.classList.contains('loaded')).toBe(false);
  });

  it('should remove loading component and add loaded class when loaded is true', () => {
    component.gridMedia = makeGridMedia();
    component.loaded = true;
    fixture.detectChanges();

    const loadingComp = fixture.nativeElement.querySelector('app-gallery-grid-photo-loading');
    expect(loadingComp).toBeNull();

    const img = fixture.nativeElement.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.classList.contains('loaded')).toBe(true);
  });

  it('should mark loaded as true on onImageLoad()', () => {
    component.gridMedia = makeGridMedia();
    component.loaded = false;
    fixture.detectChanges();

    component.onImageLoad();
    expect(component.loaded).toBe(true);
  });
});
