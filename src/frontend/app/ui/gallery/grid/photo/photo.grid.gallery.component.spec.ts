import {ComponentFixture, TestBed} from '@angular/core/testing';

import {GalleryPhotoComponent} from './photo.grid.gallery.component';
import {GridMedia} from '../GridMedia';
import {PhotoDTO} from '../../../../../../common/entities/PhotoDTO';
import {ThumbnailManagerService} from '../../thumbnailManager.service';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {ExtensionService} from '../../../../model/extension.service';
import {MediaButtonModalService} from './media-button-modal/media-button-modal.service';
import {PageHelper} from '../../../../model/page.helper';

class MockThumbnailManagerService {
  mockThumbnail: any = {
    Available: true,
    Src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    Error: false,
    loading: false,
    Visible: false,
    destroy() {},
  };

  getThumbnail() {
    return this.mockThumbnail;
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

describe('GalleryPhotoComponent - Loading feedback and error handling', () => {
  let component: GalleryPhotoComponent;
  let fixture: ComponentFixture<GalleryPhotoComponent>;
  let mockThumbnailService: MockThumbnailManagerService;

  beforeEach(async () => {
    mockThumbnailService = new MockThumbnailManagerService();
    await TestBed.configureTestingModule({
      imports: [GalleryPhotoComponent],
      providers: [
        {provide: ThumbnailManagerService, useValue: mockThumbnailService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: ExtensionService, useClass: MockExtensionService},
        {provide: MediaButtonModalService, useClass: MockMediaButtonModalService},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryPhotoComponent);
    component = fixture.componentInstance;
  });

  it('should request animated feedback while queued, actively generating, or awaiting decode', () => {
    component.gridMedia = makeGridMedia();
    mockThumbnailService.mockThumbnail.Available = true;
    mockThumbnailService.mockThumbnail.loading = false;
    mockThumbnailService.mockThumbnail.Error = false;
    fixture.detectChanges();

    expect(component.loaded).toBe(false);
    expect(component.hasError).toBe(false);

    const loadingComp = fixture.nativeElement.querySelector('app-gallery-grid-photo-loading');
    expect(loadingComp).not.toBeNull();
    expect(loadingComp.querySelector('.sk-cube-grid.animate')).not.toBeNull();
  });

  it('should show static warning on thumbnail service error', () => {
    component.gridMedia = makeGridMedia();
    mockThumbnailService.mockThumbnail.Available = false;
    mockThumbnailService.mockThumbnail.loading = false;
    mockThumbnailService.mockThumbnail.Error = true;
    fixture.detectChanges();

    expect(component.hasError).toBe(true);
    const loadingComp = fixture.nativeElement.querySelector('app-gallery-grid-photo-loading');
    expect(loadingComp).not.toBeNull();
    expect(loadingComp.querySelector('.static')).not.toBeNull();
    expect(loadingComp.querySelector('.sk-cube-grid')).toBeNull();
  });

  it('should show static warning on img element error', () => {
    component.gridMedia = makeGridMedia();
    mockThumbnailService.mockThumbnail.Available = true;
    mockThumbnailService.mockThumbnail.Error = false;
    fixture.detectChanges();

    component.onImageError();
    fixture.detectChanges();

    expect(component.imageError).toBe(true);
    expect(component.hasError).toBe(true);
    expect(component.loaded).toBe(false);

    const loadingComp = fixture.nativeElement.querySelector('app-gallery-grid-photo-loading');
    expect(loadingComp).not.toBeNull();
    expect(loadingComp.querySelector('.static')).not.toBeNull();
  });

  it('should clear local image error when thumbnail receives a new source via OnLoad', () => {
    component.gridMedia = makeGridMedia();
    mockThumbnailService.mockThumbnail.Available = true;
    mockThumbnailService.mockThumbnail.Src = 'http://example.com/thumb1.jpg';
    fixture.detectChanges();

    component.onImageError();
    expect(component.imageError).toBe(true);

    mockThumbnailService.mockThumbnail.Src = 'http://example.com/thumb2.jpg';
    mockThumbnailService.mockThumbnail.OnLoad();
    expect(component.imageError).toBe(false);
  });

  it('should keep placeholder mounted while decode is pending and remove upon resolution', async () => {
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();

    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });

    const imgEl = component.imageRef.nativeElement;
    imgEl.decode = () => decodePromise;

    component.onImageLoad();
    expect(component.loaded).toBe(false);

    resolveDecode();
    await decodePromise;
    expect(component.loaded).toBe(true);
  });

  it('should fall back to loaded=true when decode rejects on a valid image', async () => {
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();

    const imgEl = component.imageRef.nativeElement;
    imgEl.decode = () => Promise.reject(new Error('decode failed'));

    component.onImageLoad();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(component.loaded).toBe(true);
  });

  it('should not mark loaded=true if component was destroyed during decode', async () => {
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();

    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });

    const imgEl = component.imageRef.nativeElement;
    imgEl.decode = () => decodePromise;

    component.onImageLoad();
    component.ngOnDestroy();

    resolveDecode();
    await decodePromise;
    expect(component.loaded).toBe(false);
  });

  it('should not mark loaded=true if image source changed during decode', async () => {
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();

    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });

    const imgEl = component.imageRef.nativeElement;
    imgEl.decode = () => decodePromise;

    component.onImageLoad();

    // Source changes while decode is in flight
    imgEl.src = 'http://example.com/new-source.jpg';

    resolveDecode();
    await decodePromise;
    expect(component.loaded).toBe(false);
  });

  it('should not mark loaded=true if image errored while decode was pending', async () => {
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();

    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });

    const imgEl = component.imageRef.nativeElement;
    imgEl.decode = () => decodePromise;

    component.onImageLoad();
    component.onImageError();

    resolveDecode();
    await decodePromise;
    expect(component.loaded).toBe(false);
    expect(component.hasError).toBe(true);
  });

  it('should mark loaded=true in ngAfterViewInit when image is already cached', () => {
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();

    const imgEl = component.imageRef.nativeElement;
    Object.defineProperty(imgEl, 'complete', {value: true, configurable: true});
    Object.defineProperty(imgEl, 'naturalWidth', {value: 200, configurable: true});

    component.loaded = false;
    component.ngAfterViewInit();
    expect(component.loaded).toBe(true);
  });

  it('should preserve usable preview when replacement thumbnail was loaded even if full thumbnail fails', () => {
    component.gridMedia = makeGridMedia();
    component.loaded = true; // replacement preview already loaded
    mockThumbnailService.mockThumbnail.Error = true;
    fixture.detectChanges();

    expect(component.hasError).toBe(false);
    expect(component.loaded).toBe(true);

    const loadingComp = fixture.nativeElement.querySelector('app-gallery-grid-photo-loading');
    expect(loadingComp).toBeNull();
    const img = fixture.nativeElement.querySelector('img');
    expect(img.classList.contains('loaded')).toBe(true);
  });
});

describe('GalleryPhotoComponent - Geometry and Visibility', () => {
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
    component.gridMedia = makeGridMedia();
    fixture.detectChanges();
  });

  it('isInView() should return true when container overlaps viewport', () => {
    vi.spyOn(component.container.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 100,
      bottom: 300,
      right: 300,
      width: 200,
      height: 200,
    } as DOMRect);

    expect(component.isInView()).toBe(true);
  });

  it('isInView() should return false when container is fully outside viewport', () => {
    const el = component.container.nativeElement;

    // Above viewport
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: -300,
      left: 100,
      bottom: -100,
      right: 300,
      width: 200,
      height: 200,
    } as DOMRect);
    expect(component.isInView()).toBe(false);

    // Below viewport
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight + 50,
      left: 100,
      bottom: window.innerHeight + 250,
      right: 300,
      width: 200,
      height: 200,
    } as DOMRect);
    expect(component.isInView()).toBe(false);

    // To the left of viewport
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: -300,
      bottom: 300,
      right: -100,
      width: 200,
      height: 200,
    } as DOMRect);
    expect(component.isInView()).toBe(false);

    // To the right of viewport
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: window.innerWidth + 50,
      bottom: 300,
      right: window.innerWidth + 250,
      width: 200,
      height: 200,
    } as DOMRect);
    expect(component.isInView()).toBe(false);
  });

  it('isInView() should return false for edge-only contact and zero-size elements', () => {
    const el = component.container.nativeElement;

    // Edge contact on top (bottom == 0)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: -200,
      left: 100,
      bottom: 0,
      right: 300,
      width: 200,
      height: 200,
    } as DOMRect);
    expect(component.isInView()).toBe(false);

    // Edge contact on bottom (top == window.innerHeight)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight,
      left: 100,
      bottom: window.innerHeight + 200,
      right: 300,
      width: 200,
      height: 200,
    } as DOMRect);
    expect(component.isInView()).toBe(false);

    // Zero-size element
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 100,
      bottom: 100,
      right: 100,
      width: 0,
      height: 0,
    } as DOMRect);
    expect(component.isInView()).toBe(false);
  });

  it('onScroll() should update thumbnail.Visible on transition without redundant writes', () => {
    (component.thumbnail as any).Available = false;
    (component.thumbnail as any).Error = false;
    component.thumbnail.Visible = false;

    vi.spyOn(component, 'isInView').mockReturnValue(true);
    component.onScroll();
    expect(component.thumbnail.Visible).toBe(true);

    const visibleSpy = vi.spyOn(component.thumbnail, 'Visible', 'set');
    component.onScroll();
    expect(visibleSpy).not.toHaveBeenCalled();
  });

  it('getDimension() should return document-space coordinates combining bounding rect with PageHelper.ScrollX and ScrollY', () => {
    vi.spyOn(PageHelper, 'ScrollY', 'get').mockReturnValue(900);
    vi.spyOn(PageHelper, 'ScrollX', 'get').mockReturnValue(30);

    vi.spyOn(component.imageRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 120,
      left: 80,
      width: 196,
      height: 147,
    } as DOMRect);

    const dim = component.getDimension();
    expect(dim).toEqual({
      top: 1020,
      left: 110,
      width: 196,
      height: 147,
    });
  });

  it('getDimension() should fall back to container rectangle when img has zero dimensions', () => {
    vi.spyOn(PageHelper, 'ScrollY', 'get').mockReturnValue(100);
    vi.spyOn(PageHelper, 'ScrollX', 'get').mockReturnValue(20);

    vi.spyOn(component.imageRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    } as DOMRect);

    vi.spyOn(component.container.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 50,
      left: 40,
      width: 200,
      height: 150,
    } as DOMRect);

    const dim = component.getDimension();
    expect(dim).toEqual({
      top: 150,
      left: 60,
      width: 200,
      height: 150,
    });
  });

  it('getDimension() should fall back to zero dimensions when neither element has usable geometry', () => {
    vi.spyOn(component.imageRef.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    } as DOMRect);

    vi.spyOn(component.container.nativeElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    } as DOMRect);

    const dim = component.getDimension();
    expect(dim).toEqual({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    });
  });
});
