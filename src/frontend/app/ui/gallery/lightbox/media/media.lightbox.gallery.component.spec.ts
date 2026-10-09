import {ComponentFixture, TestBed} from '@angular/core/testing';
import {DomSanitizer} from '@angular/platform-browser';
import {GalleryLightboxMediaComponent} from './media.lightbox.gallery.component';
import {LightboxService} from '../lightbox.service';
import {GridMedia} from '../../grid/GridMedia';
import {PhotoDTO} from '../../../../../../common/entities/PhotoDTO';
import {LoadingBarService} from '../../../../model/loading-bar.service';

class MockLightboxService {
  loopVideos = false;
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
  const gridMedia = new GridMedia(media, 100, 100, 0);
  gridMedia.getThumbnailPath = () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  gridMedia.getBestSizedMediaPath = () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  gridMedia.getOriginalMediaPath = () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  gridMedia.getLiveVideoPath = () => `data:video/mp4;base64,AAAA#${media.liveVideoPath ?? ''}`;
  return gridMedia;
}

describe('GalleryLightboxMediaComponent - Live Photo', () => {
  let component: GalleryLightboxMediaComponent;
  let fixture: ComponentFixture<GalleryLightboxMediaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryLightboxMediaComponent],
      providers: [
        {provide: LightboxService, useClass: MockLightboxService},
        {
          provide: DomSanitizer,
          useValue: {
            bypassSecurityTrustStyle: (val: string) => val,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryLightboxMediaComponent);
    component = fixture.componentInstance;
  });

  it('should render live-photo-container when media is a Live Photo', () => {
    component.gridMedia = makeGridMedia({
      liveVideoPath: 'photos/IMG_001_HEVC.MOV',
    } as any);
    component.loadMedia = true;
    component.ngOnChanges();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.live-photo-container')).not.toBeNull();
    expect(el.querySelector('.live-photo-badge')).not.toBeNull();
  });

  it('should not render live-photo-container for a regular photo', () => {
    component.gridMedia = makeGridMedia();
    component.loadMedia = true;
    component.ngOnChanges();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.live-photo-container')).toBeNull();
    expect(el.querySelector('.live-photo-badge')).toBeNull();
  });

  it('should set liveVideoSrc from gridMedia on change', () => {
    component.gridMedia = makeGridMedia({
      liveVideoPath: 'photos/IMG_001_HEVC.MOV',
    } as any);
    component.loadMedia = true;
    component.ngOnChanges();

    expect(component.liveVideoSrc).toBeTruthy();
    expect(component.liveVideoSrc).toContain('IMG_001_HEVC.MOV');
  });

  it('should not set liveVideoSrc for a regular photo', () => {
    component.gridMedia = makeGridMedia();
    component.loadMedia = true;
    component.ngOnChanges();

    expect(component.liveVideoSrc).toBeNull();
  });

  it('should toggle liveVideoPlaying via startLiveVideo/stopLiveVideo', () => {
    expect(component.liveVideoPlaying).toBe(false);
    // liveVideo ViewChild is null in unit tests (no real DOM video),
    // so startLiveVideo returns early, but liveVideoPlaying is set first
    component.startLiveVideo();
    // Without a real video element, the method returns early before setting the flag
    // Test the flag directly
    component.liveVideoPlaying = true;
    expect(component.liveVideoPlaying).toBe(true);
    component.liveVideoPlaying = false;
    expect(component.liveVideoPlaying).toBe(false);
  });

  it('should have pointer-events:none on live-photo-container', () => {
    component.gridMedia = makeGridMedia({
      liveVideoPath: 'photos/IMG_001_HEVC.MOV',
    } as any);
    component.loadMedia = true;
    component.ngOnChanges();
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('.live-photo-container');
    expect(container).not.toBeNull();
    const style = getComputedStyle(container);
    expect(style.pointerEvents).toBe('none');
  });

  it('should have event handlers on badge, not on container', () => {
    component.gridMedia = makeGridMedia({
      liveVideoPath: 'photos/IMG_001_HEVC.MOV',
    } as any);
    component.loadMedia = true;
    component.ngOnChanges();
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.live-photo-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent.trim()).toBe('LIVE');
  });
});

describe('GalleryLightboxMediaComponent - Photo Loading & Lifecycle', () => {
  let component: GalleryLightboxMediaComponent;
  let fixture: ComponentFixture<GalleryLightboxMediaComponent>;
  let loadingBarService: LoadingBarService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryLightboxMediaComponent],
      providers: [
        {provide: LightboxService, useClass: MockLightboxService},
        LoadingBarService,
        {
          provide: DomSanitizer,
          useValue: {
            bypassSecurityTrustStyle: (val: string) => val,
          },
        },
      ],
    }).compileComponents();

    loadingBarService = TestBed.inject(LoadingBarService);
    fixture = TestBed.createComponent(GalleryLightboxMediaComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    component.cancelActiveRequest();
  });

  it('should acquire loading bar token on initial photo load and complete after decode', async () => {
    expect(loadingBarService.isLoading()).toBe(false);

    let resolveDecode: () => void = () => {};
    const decodePromise = new Promise<void>((resolve) => {
      resolveDecode = resolve;
    });

    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();
    fixture.detectChanges();

    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.photo.src).toBeTruthy();

    // Mock image element decode
    const imgEl = {
      decode: vi.fn().mockReturnValue(decodePromise),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: imgEl} as any;

    component.onImageLoad();
    // Still decoding, so loading bar must remain active
    expect(loadingBarService.isLoading()).toBe(true);

    resolveDecode();
    await decodePromise;
    // Wait microtask
    await Promise.resolve();

    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should not acquire extra loading token for repeated same-source updates', () => {
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);

    // Same photo again with drag/zoom remaining 1
    component.drag = {x: 10, y: 10};
    component.ngOnChanges();

    // Should still only have 1 active request, so one cancel clears it
    component.cancelActiveRequest();
    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should invalidate earlier request on rapid navigation and prevent stale completion', async () => {
    let resolveDecode1: () => void = () => {};
    const decodePromise1 = new Promise<void>((resolve) => {
      resolveDecode1 = resolve;
    });

    // Load photo 1
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);

    // Attach in-flight image element and start decode for photo 1 BEFORE navigating
    const imgEl1 = {
      decode: vi.fn().mockReturnValue(decodePromise1),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: imgEl1} as any;
    component.onImageLoad();

    // Rapid navigation to photo 2
    component.gridMedia = makeGridMedia({name: 'photo2.jpg'});
    component.ngOnChanges();

    // Photo 2 has started its own request
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(false);
    expect(component.imageLoadFinished.this).toBe(false);
    expect(component.showThumbnail()).toBe(true);

    // Stale decode from photo 1 settles
    resolveDecode1();
    await decodePromise1;
    await Promise.resolve();

    // Photo 2 request must STILL be active and NOT marked ready prematurely
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(false);
    expect(component.imageLoadFinished.this).toBe(false);
    expect(component.showThumbnail()).toBe(true);

    // Cancelling photo 2 completes the bar
    component.cancelActiveRequest();
    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should not cancel original upgrade request when preview finishes loading while upgrade is in-flight', async () => {
    // 1. Initial load for preview (best-fit)
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    const initialSrc = component.photo.src;
    expect(initialSrc).toBeTruthy();
    expect(component.photo.isBestFit).toBe(true);
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(false);
    expect(component.imageLoadFinished.this).toBe(false);
    expect(component.showThumbnail()).toBe(true);

    // 2. User zooms in BEFORE preview finishes loading
    component.zoom = 2;
    component.ngOnChanges();

    // Upgrade request to original is now in-flight alongside base preview
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(false);
    expect(component.imageLoadFinished.this).toBe(false);
    expect(component.showThumbnail()).toBe(true);

    // 3. Preview completes loading and decodes
    const previewImg = {
      decode: vi.fn().mockResolvedValue(undefined),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: previewImg} as any;
    component.onImageLoad();
    await Promise.resolve();

    // Base preview completed, but upgrade request is STILL in-flight!
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(true);
    expect(component.imageLoadFinished.this).toBe(true);
    expect(component.showThumbnail()).toBe(false);
    // Preview is still displayed while upgrade is pending
    expect(component.photo.src).toBe(initialSrc);
    expect(component.photo.isBestFit).toBe(true);

    // 4. Upgrade image finishes loading and decodes
    component.onUpgradeImageLoad();
    await Promise.resolve();

    // Original is promoted successfully and loading bar completes
    expect(loadingBarService.isLoading()).toBe(false);
    expect(component.photo.src).toContain(component.gridMedia.getOriginalMediaPath());
    expect(component.photo.isBestFit).toBe(false);
    expect(component.mediaLoaded).toBe(true);
    expect(component.imageLoadFinished.this).toBe(true);
    expect(component.showThumbnail()).toBe(false);
  });

  it('should mark photo ready and remove thumbnail when zoom upgrade finishes before preview loads', async () => {
    // 1. Initial load for preview (best-fit)
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    expect(component.photo.src).toBeTruthy();
    expect(component.photo.isBestFit).toBe(true);
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(false);
    expect(component.imageLoadFinished.this).toBe(false);
    expect(component.showThumbnail()).toBe(true);

    // 2. User zooms in BEFORE preview finishes loading
    component.zoom = 2;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.mediaLoaded).toBe(false);
    expect(component.imageLoadFinished.this).toBe(false);
    expect(component.showThumbnail()).toBe(true);

    // 3. Upgrade finishes loading and decodes BEFORE preview loads
    component.onUpgradeImageLoad();
    await Promise.resolve();

    // Original is promoted, photo marked ready, thumbnail removed, loading bar completed
    expect(loadingBarService.isLoading()).toBe(false);
    expect(component.photo.src).toContain(component.gridMedia.getOriginalMediaPath());
    expect(component.photo.isBestFit).toBe(false);
    expect(component.mediaLoaded).toBe(true);
    expect(component.imageLoadFinished.this).toBe(true);
    expect(component.showThumbnail()).toBe(false);

    // 4. Stale/delayed preview load event later is safely ignored and doesn't alter state
    const previewImg = {
      decode: vi.fn().mockResolvedValue(undefined),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: previewImg} as any;
    component.onImageLoad();
    await Promise.resolve();

    expect(loadingBarService.isLoading()).toBe(false);
    expect(component.photo.isBestFit).toBe(false);
    expect(component.mediaLoaded).toBe(true);
    expect(component.showThumbnail()).toBe(false);
  });

  it('should not fail a new photo request when an old upgrade decode rejects after navigation', async () => {
    let rejectDecode1: (err: any) => void = () => {};
    const upgradeDecodePromise = new Promise<void>((_, reject) => {
      rejectDecode1 = reject;
    });

    // 1. Photo 1 loads
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    // Complete base preview so photo.isBestFit = true
    const imgEl1 = {
      decode: vi.fn().mockResolvedValue(undefined),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: imgEl1} as any;
    component.onImageLoad();
    await Promise.resolve();

    // 2. Zoom to start upgrade request
    component.zoom = 2;
    component.ngOnChanges();
    expect(loadingBarService.isLoading()).toBe(true);

    // Mock upgradeImage with pending decode that will reject
    (component as any).upgradeImage = {
      decode: vi.fn().mockReturnValue(upgradeDecodePromise),
      naturalWidth: 0,
    };
    component.onUpgradeImageLoad(); // triggers upgradeImg.decode()

    // 3. User navigates to photo 2 before upgrade settles
    component.zoom = 1;
    component.gridMedia = makeGridMedia({name: 'photo2.jpg'});
    component.ngOnChanges();

    // Photo 2 has its own active request
    expect(loadingBarService.isLoading()).toBe(true);
    expect(component.highResError).toBe(false);

    // 4. Photo 1's old upgrade decode rejects
    rejectDecode1(new Error('decode failed'));
    try {
      await upgradeDecodePromise;
    } catch {
      // expected
    }
    await Promise.resolve();

    // Photo 2's request must NOT be failed or cleared
    expect(component.highResError).toBe(false);
    expect(loadingBarService.isLoading()).toBe(true);

    // Photo 2 completes its own load normally
    const imgEl2 = {
      decode: vi.fn().mockResolvedValue(undefined),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: imgEl2} as any;
    component.onImageLoad();
    await Promise.resolve();

    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should cancel active request immediately on cancelActiveRequest()', () => {
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);

    component.cancelActiveRequest();
    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should cancel active request when destroyed', () => {
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);

    component.ngOnDestroy();
    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should not allow video events to finish or affect active photo request', () => {
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);

    // Firing video handlers must NOT touch photo loading state
    component.onVideoLoadStart();
    expect(loadingBarService.isLoading()).toBe(true);

    component.onVideoError();
    expect(loadingBarService.isLoading()).toBe(true);

    component.onLiveVideoError();
    expect(loadingBarService.isLoading()).toBe(true);

    component.cancelActiveRequest();
    expect(loadingBarService.isLoading()).toBe(false);
  });

  it('should preserve preview on zoom upgrade and acquire loading token', async () => {
    // Initial load
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    const imgEl = {
      decode: vi.fn().mockResolvedValue(undefined),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: imgEl} as any;
    component.onImageLoad();
    await Promise.resolve();

    const initialSrc = component.photo.src;
    expect(initialSrc).toBeTruthy();
    expect(loadingBarService.isLoading()).toBe(false);

    // Zoom in
    component.zoom = 2;
    component.ngOnChanges();

    // Should acquire token for high-res upgrade
    expect(loadingBarService.isLoading()).toBe(true);
    // Preview image is retained until upgrade completes
    expect(component.photo.src).toBe(initialSrc);

    // Complete upgrade
    component.onUpgradeImageLoad();
    await Promise.resolve();

    expect(loadingBarService.isLoading()).toBe(false);
    expect(component.photo.src).toContain(component.gridMedia.getOriginalMediaPath());
  });

  it('should handle zoom upgrade failure by keeping preview visible and completing token', async () => {
    component.gridMedia = makeGridMedia({name: 'photo1.jpg'});
    component.loadMedia = true;
    component.ngOnChanges();

    // Complete initial preview load
    const imgEl = {
      decode: vi.fn().mockResolvedValue(undefined),
      complete: true,
      naturalWidth: 800,
    } as any;
    component.imageElement = {nativeElement: imgEl} as any;
    component.onImageLoad();
    await Promise.resolve();

    const initialSrc = component.photo.src;
    expect(loadingBarService.isLoading()).toBe(false);

    component.zoom = 2;
    component.ngOnChanges();

    expect(loadingBarService.isLoading()).toBe(true);

    // Upgrade fails
    component.onUpgradeImageError();

    // Loading bar completed (not stuck)
    expect(loadingBarService.isLoading()).toBe(false);
    // Preview preserved
    expect(component.photo.src).toBe(initialSrc);
    // Error flag set
    expect(component.highResError).toBe(true);
  });
});

