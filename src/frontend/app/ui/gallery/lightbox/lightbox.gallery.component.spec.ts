import {ComponentFixture, TestBed} from '@angular/core/testing';
import {signal} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {BehaviorSubject} from 'rxjs';

import {GalleryLightboxComponent, LightboxGrid, LightboxGridTile, LightboxStates} from './lightbox.gallery.component';
import {FullScreenService} from '../fullscreen.service';
import {OverlayService} from '../overlay.service';
import {WakeLockService} from '../wakelock.service';
import {QueryService} from '../../../model/query.service';
import {PiTitleService} from '../../../model/pi-title.service';
import {NotificationService} from '../../../model/notification.service';
import {PhotoDTO} from '../../../../../common/entities/PhotoDTO';
import {GridMedia} from '../grid/GridMedia';
import {QueryParams} from '../../../../../common/QueryParams';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {MediaDTO} from '../../../../../common/entities/MediaDTO';
import {NgIcon, provideIcons} from '@ng-icons/core';
import {By} from '@angular/platform-browser';
import {
  ionAddOutline, ionChevronBackOutline, ionChevronForwardOutline, ionCloseOutline, ionContractOutline,
  ionDownloadOutline, ionEllipsisVerticalOutline, ionExpandOutline, ionInformationCircleOutline,
  ionPauseOutline, ionPlayOutline, ionReloadOutline, ionRemoveOutline, ionWarningOutline
} from '@ng-icons/ionicons';
import {DatePipe, Location} from '@angular/common';
import {FileSizePipe} from '../../../pipes/FileSizePipe';

const appIcons = {
  ionAddOutline, ionChevronBackOutline, ionChevronForwardOutline, ionCloseOutline, ionContractOutline,
  ionDownloadOutline, ionEllipsisVerticalOutline, ionExpandOutline, ionInformationCircleOutline,
  ionPauseOutline, ionPlayOutline, ionReloadOutline, ionRemoveOutline, ionWarningOutline
};

// Mock classes
class MockFullScreenService {
  readonly fullScreenEnabled = signal(false);

  isFullScreenEnabled() {
    return false;
  }

  exitFullScreen = vi.fn();

  showFullScreen = vi.fn();
}

class MockOverlayService {
  showOverlay = vi.fn();

  hideOverlay = vi.fn();
}

class MockWakeLockService {
  requestWakeLock() {
    return Promise.resolve();
  }

  releaseWakeLock() {
    return Promise.resolve();
  }
}

class MockQueryService {
  lightboxClosesWithBack = vi.fn(() => false);

  lightboxRevealsInGrid = vi.fn(() => true);

  keepLightboxState() {
    return {lightboxClosesWithBack: this.lightboxClosesWithBack(), lightboxRevealsInGrid: this.lightboxRevealsInGrid()};
  }

  getMediaStringId(media: MediaDTO) {
    return media.name;
  }

  getParams(lightbox?: { media?: MediaDTO }): Record<string, string> {
    const query: Record<string, string> = {};
    if (lightbox?.media) {
      query[QueryParams.gallery.photo] = this.getMediaStringId(lightbox?.media);
    }
    return query;
  }
}

class MockAuthenticationService {
  canSearch() {
    return true;
  }
}

class MockPiTitleService {
  setMediaTitle = vi.fn();

  setLastNonMedia = vi.fn();
}

class MockNotificationService {
  info = vi.fn();
}

// Finishes on the next timer tick, so fake-timer tests don't wait for the 200 ms animation
function mockAnimate(): Animation {
  const animation = new EventTarget() as Animation;
  animation.cancel = vi.fn();
  setTimeout(() => animation.dispatchEvent(new Event('finish')), 0);
  return animation;
}

class MockActivatedRoute {
  queryParams = new BehaviorSubject<Record<string, string>>({});
}

class MockRouter {
  constructor(private ac: MockActivatedRoute) {
  }

  navigate(commands: unknown, extras: { queryParams: Record<string, string | null>, queryParamsHandling?: string }) {
    let newQP: Record<string, string> = {};
    if (extras.queryParamsHandling == 'merge') {
      newQP = {...this.ac.queryParams.value};
    }
    for (const [k, v] of Object.entries(extras.queryParams)) {
      if (v === null || v === undefined) {
        delete newQP[k];
      } else {
        newQP[k] = String(v);
      }
    }
    this.ac.queryParams.next(newQP);
    return Promise.resolve(true);
  }
}

// The grid with all its media "rendered" on request
class FakeGrid implements LightboxGrid {
  readonly media = signal<MediaDTO[] | null>(null);
  readonly revealMedia = vi.fn((media: MediaDTO): Promise<LightboxGridTile | null> => {
    const found = this.media()?.find(m => m.name === media.name);
    return Promise.resolve(found ? {
      rect: {top: 10, left: 10, width: 100, height: 100},
      gridMedia: new GridMedia(found, 100, 100, 0)
    } : null);
  });
}

function createMockPhoto(name: string, index: number): PhotoDTO {
  return {
    name: name,
    directory: {name: 'testdir', path: '/test'},
    metadata: {
      size: {width: 800, height: 600},
      caption: `Test photo ${index}`,
      creationDate: Date.now(),
      fileSize: 1024
    }
  } as PhotoDTO;
}

describe('GalleryLightboxComponent', () => {
  let component: GalleryLightboxComponent;
  let fixture: ComponentFixture<GalleryLightboxComponent>;
  let mockActivatedRoute: MockActivatedRoute;
  let mockRouter: MockRouter;
  let grid: FakeGrid;
  let photos: PhotoDTO[];
  let notifications: MockNotificationService;

  // runs the effects, the grid's reveal and the (mocked) animations
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; ++i) {
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  const openPhoto = async (name: string, extra: Record<string, string> = {}): Promise<void> => {
    mockActivatedRoute.queryParams.next({[QueryParams.gallery.photo]: name, ...extra});
    await settle();
  };
  const photoParam = (): string => mockActivatedRoute.queryParams.value[QueryParams.gallery.photo];

  beforeEach(async () => {
    vi.useFakeTimers();
    mockActivatedRoute = new MockActivatedRoute();
    mockRouter = new MockRouter(mockActivatedRoute);
    // jsdom has no Web Animations API
    HTMLElement.prototype.animate = mockAnimate;

    await TestBed.configureTestingModule({
      imports: [GalleryLightboxComponent],
      providers: [
        provideIcons(appIcons),
        {provide: FullScreenService, useClass: MockFullScreenService},
        {provide: OverlayService, useClass: MockOverlayService},
        {provide: WakeLockService, useClass: MockWakeLockService},
        {provide: Router, useValue: mockRouter},
        {provide: QueryService, useClass: MockQueryService},
        {provide: ActivatedRoute, useValue: mockActivatedRoute},
        {provide: PiTitleService, useClass: MockPiTitleService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: NotificationService, useClass: MockNotificationService},
        FileSizePipe,
        DatePipe,
      ]
    }).compileComponents();

    notifications = TestBed.inject(NotificationService) as unknown as MockNotificationService;
    fixture = TestBed.createComponent(GalleryLightboxComponent);
    component = fixture.componentInstance;

    photos = [
      createMockPhoto('photo1.jpg', 0),
      createMockPhoto('photo2.jpg', 1),
      createMockPhoto('photo3.jpg', 2)
    ];
    grid = new FakeGrid();
    grid.media.set(photos);
    fixture.componentRef.setInput('grid', grid);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
    expect(component.status()).toBe(LightboxStates.Closed);
  });

  it('should open the photo of the URL from its tile', async () => {
    await openPhoto('photo2.jpg');

    expect(grid.revealMedia).toHaveBeenCalledWith(photos[1]);
    expect(component.status()).toBe(LightboxStates.Open);
    expect(component.activePhoto()!.media).toBe(photos[1]);
    expect(component.activeIndex()).toBe(1);
  });

  it('should start slideshow when playback button is clicked', async () => {
    await openPhoto('photo1.jpg');

    mockRouter.navigate([], {queryParams: {[QueryParams.gallery.lightbox.playback]: 'true'}, queryParamsHandling: 'merge'});
    await settle();

    expect(component.status()).toBe(LightboxStates.Open);
    expect(component.slideShowRunning()).toBe(true);
  });

  it('should cycle through images during slideshow', async () => {
    await openPhoto('photo1.jpg', {[QueryParams.gallery.lightbox.playback]: 'true'});

    component.nextImage();
    await settle();

    expect(photoParam()).toBe('photo2.jpg');
    expect(component.activePhoto()!.media).toBe(photos[1]);
    expect(component.slideShowRunning()).toBe(true);
  });

  it('should stop slideshow at last image when loopSlideshow is disabled', async () => {
    await openPhoto('photo3.jpg', {
      [QueryParams.gallery.lightbox.playback]: 'true',
      [QueryParams.gallery.lightbox.loopSlideshow]: 'false'
    });

    component.nextImage();
    await settle();

    expect(component.nextMedia()).toBeNull();
    expect(component.hasNext()).toBe(false);
    expect(photoParam()).toBe('photo3.jpg');
  });

  it.each([{}, {[QueryParams.gallery.lightbox.loopSlideshow]: 'true'}])(
    'should continue the slideshow from the first image with loop options %j', async options => {
    await openPhoto('photo3.jpg', {[QueryParams.gallery.lightbox.playback]: 'true', ...options});
    expect(component.nextMedia()).toBe(photos[0]);
    expect(component.nextGridMedia()!.media).toBe(photos[0]);

    component.nextImage();
    await settle();

    expect(photoParam()).toBe('photo1.jpg');
    expect(component.nextMedia()).toBe(photos[1]);
    expect(component.slideShowRunning()).toBe(true);
  });

  it('should stop slideshow when pause button is clicked', async () => {
    await openPhoto('photo1.jpg', {[QueryParams.gallery.lightbox.playback]: 'true'});
    expect(component.slideShowRunning()).toBe(true);

    mockRouter.navigate([], {queryParams: {[QueryParams.gallery.lightbox.playback]: null}, queryParamsHandling: 'merge'});
    await settle();

    expect(component.slideShowRunning()).toBe(false);
  });

  it('should pause the slideshow when going back', async () => {
    await openPhoto('photo2.jpg', {[QueryParams.gallery.lightbox.playback]: 'true'});

    component.prevImage();
    await settle();

    expect(photoParam()).toBe('photo1.jpg');
    expect(component.slideShowRunning()).toBe(false);
  });

  it('should handle slideshow with route params', async () => {
    mockActivatedRoute.queryParams.next({[QueryParams.gallery.lightbox.playback]: 'true'});
    await settle();
    // a slideshow URL without a photo starts at the first one
    expect(component.slideShowRunning()).toBe(true);
    expect(photoParam()).toBe('photo1.jpg');

    mockActivatedRoute.queryParams.next({[QueryParams.gallery.photo]: 'photo1.jpg'});
    await settle();

    expect(component.slideShowRunning()).toBe(false);
  });

  it('should navigate to specific photo and start slideshow', async () => {
    await openPhoto('photo2.jpg', {[QueryParams.gallery.lightbox.playback]: 'true'});

    expect(component.activePhoto()!.media).toBe(photos[1]);
    expect(component.slideShowRunning()).toBe(true);
  });

  it('should not advance to next photo when no more photos and loopSlideshow disabled', async () => {
    await openPhoto('photo3.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'false'});

    expect(component.navigation().hasNext).toBe(false);
    expect(component.nextGridMedia()).toBeNull();
    component.nextImage();
    expect(photoParam()).toBe('photo3.jpg');
  });

  it('should tell whether there is a previous and a next photo', async () => {
    await openPhoto('photo1.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'false'});
    expect(component.navigation()).toEqual({hasPrev: false, hasNext: true, nextLoops: false});

    await openPhoto('photo2.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'false'});
    expect(component.navigation()).toEqual({hasPrev: true, hasNext: true, nextLoops: false});

    await openPhoto('photo3.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'false'});
    expect(component.navigation()).toEqual({hasPrev: true, hasNext: false, nextLoops: false});

    await openPhoto('photo3.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'true'});
    expect(component.navigation()).toEqual({hasPrev: true, hasNext: true, nextLoops: true});
  });

  it('should have no next photo to loop to when there is only one photo', async () => {
    grid.media.set([photos[0]]);
    await openPhoto('photo1.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'true'});

    expect(component.nextMedia()).toBeNull();
    expect(component.navigation()).toEqual({hasPrev: false, hasNext: false, nextLoops: false});
  });

  it('should navigate by the content order, also beyond the rendered photos', async () => {
    const many: PhotoDTO[] = [];
    for (let i = 0; i < 50; ++i) {
      many.push(createMockPhoto('p' + i + '.jpg', i));
    }
    grid.media.set(many);
    await openPhoto('p30.jpg');

    component.nextImage();
    await settle();

    expect(photoParam()).toBe('p31.jpg');
    expect(grid.revealMedia).toHaveBeenLastCalledWith(many[31]);
    expect(component.activePhoto()!.media).toBe(many[31]);

    component.prevImage();
    await settle();
    component.prevImage();
    await settle();
    expect(component.activePhoto()!.media).toBe(many[29]);
  });

  it('should show the first photo with a toast when the open photo is gone, and keep the slideshow playing', async () => {
    await openPhoto('photo2.jpg', {[QueryParams.gallery.lightbox.playback]: 'true'});

    // the fresh listing replaces the cached one
    grid.media.set([photos[0], photos[2]]);
    await settle();

    expect(notifications.info).toHaveBeenCalledTimes(1);
    expect(photoParam()).toBe('photo1.jpg');
    expect(component.activePhoto()!.media).toBe(photos[0]);
    expect(component.status()).toBe(LightboxStates.Open);
    expect(component.slideShowRunning()).toBe(true);
  });

  it('should show the first photo with a toast for a link to a photo that is not there', async () => {
    await openPhoto('missing.jpg');

    expect(notifications.info).toHaveBeenCalledTimes(1);
    expect(photoParam()).toBe('photo1.jpg');
    expect(component.status()).toBe(LightboxStates.Open);
  });

  it('should close when the content is empty', async () => {
    await openPhoto('photo2.jpg');

    grid.media.set([]);
    await settle();

    expect(photoParam()).toBeUndefined();
    expect(component.status()).toBe(LightboxStates.Closed);
  });

  it('should wait for the content on a cold link', async () => {
    grid.media.set(null);
    await openPhoto('photo3.jpg');
    expect(grid.revealMedia).not.toHaveBeenCalled();
    expect(component.status()).toBe(LightboxStates.Closed);

    grid.media.set(photos);
    await settle();

    expect(grid.revealMedia).toHaveBeenCalledWith(photos[2]);
    expect(component.status()).toBe(LightboxStates.Open);
    expect(component.activePhoto()!.media).toBe(photos[2]);
    expect(notifications.info).not.toHaveBeenCalled();
  });

  describe('paging with the keys (#1310)', () => {
    const key = async (k: string): Promise<void> => {
      window.dispatchEvent(new KeyboardEvent('keydown', {key: k}));
      await settle();
    };
    const noLoop = {[QueryParams.gallery.lightbox.loopSlideshow]: 'false'};

    it('should page with the arrow keys and stop at the first and the last photo', async () => {
      await openPhoto('photo1.jpg', noLoop);
      await key('ArrowLeft');
      expect(photoParam()).toBe('photo1.jpg');

      await key('ArrowRight');
      expect(photoParam()).toBe('photo2.jpg');
      await key('ArrowRight');
      expect(photoParam()).toBe('photo3.jpg');
      expect(component.activePhoto()!.media).toBe(photos[2]);
      await key('ArrowRight');
      expect(photoParam()).toBe('photo3.jpg');

      await key('ArrowLeft');
      expect(photoParam()).toBe('photo2.jpg');
      expect(component.activePhoto()!.media).toBe(photos[1]);
    });

    it('should wrap from the last photo to the first with loop on', async () => {
      await openPhoto('photo3.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'true'});
      await key('ArrowRight');
      expect(photoParam()).toBe('photo1.jpg');
      expect(component.activePhoto()!.media).toBe(photos[0]);
    });
  });

  describe('next button icon (#1310)', () => {
    // the icon of the right arrow button, and its tooltip
    const nextButton = (): { icon: string | undefined, title: string | null } => {
      const arrow = fixture.debugElement.query(By.css('#rightArrow'));
      const icon = arrow.query(By.directive(NgIcon)).componentInstance as NgIcon;
      return {icon: icon.name() as string | undefined, title: arrow.nativeElement.getAttribute('title')};
    };

    it('should show the normal next icon when there is a next photo', async () => {
      await openPhoto('photo2.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'true'});
      expect(nextButton()).toEqual({icon: 'ionChevronForwardOutline', title: 'key: right arrow'});
    });

    // on the last photo the next button starts over from the first photo, so it does not look like the normal next button
    it('should show the restart icon on the last photo with loop on', async () => {
      await openPhoto('photo3.jpg', {[QueryParams.gallery.lightbox.loopSlideshow]: 'true'});
      const button = nextButton();
      expect(button.icon).toBe('ionReloadOutline');
      // a tooltip of its own, e.g.: "start over from the first photo"
      expect(button.title).toBeTruthy();
      expect(button.title).not.toBe('key: right arrow');
    });
  });

  it('should reset the zoom when moving to another photo (#1310)', async () => {
    await openPhoto('photo1.jpg');
    component.zoom.set(3);
    component.drag.set({x: 100, y: -50});

    component.nextImage();
    await settle();

    expect(photoParam()).toBe('photo2.jpg');
    expect(component.zoom()).toBe(1);
    expect(component.drag()).toEqual({x: 0, y: 0});
  });

  it('should reveal the open photo in the grid on close', async () => {
    await openPhoto('photo1.jpg');
    component.nextImage();
    await settle();
    grid.revealMedia.mockClear();

    component.hide();
    await settle();

    expect(grid.revealMedia).toHaveBeenCalledTimes(1);
    expect(grid.revealMedia).toHaveBeenCalledWith(photos[1]);
    expect(component.status()).toBe(LightboxStates.Closed);
    expect(component.activePhoto()).toBeNull();
  });

  // #470: back after closing must not open the photo again
  it('should go back on close when the photo was opened from the page under it', async () => {
    await openPhoto('photo1.jpg');
    const location = TestBed.inject(Location);
    (TestBed.inject(QueryService) as unknown as MockQueryService).lightboxClosesWithBack.mockReturnValue(true);
    const back = vi.spyOn(location, 'back').mockImplementation(() => undefined);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');

    component.hide();

    expect(back).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('should replace the photo with its folder on close when the photo was opened from a link', async () => {
    await openPhoto('photo1.jpg');
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');

    component.hide();

    expect(back).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({replaceUrl: true}));
  });

  // e.g. opened from the map: the grid under it does not scroll to the photo
  it('should not reveal the photo in the grid when its link says so, also on close', async () => {
    (TestBed.inject(QueryService) as unknown as MockQueryService).lightboxRevealsInGrid.mockReturnValue(false);
    await openPhoto('photo1.jpg');
    component.nextImage();
    await settle();
    component.hide();
    await settle();

    expect(grid.revealMedia).not.toHaveBeenCalled();
    expect(component.status()).toBe(LightboxStates.Closed);
  });

  it('should release the scroll lock and full screen when destroyed while open', () => {
    const overlayService = TestBed.inject(OverlayService);
    const fullScreenService = TestBed.inject(FullScreenService);
    vi.spyOn(overlayService, 'hideOverlay').mockImplementation(() => undefined);
    vi.spyOn(fullScreenService, 'exitFullScreen').mockImplementation(() => undefined);
    component.status.set(LightboxStates.Open);

    fixture.destroy();

    expect(overlayService.hideOverlay).toHaveBeenCalledWith('lightbox');
    expect(fullScreenService.exitFullScreen).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('should not touch the scroll lock when destroyed while closed', () => {
    const overlayService = TestBed.inject(OverlayService);
    vi.spyOn(overlayService, 'hideOverlay').mockImplementation(() => undefined);
    component.status.set(LightboxStates.Closed);

    fixture.destroy();

    expect(overlayService.hideOverlay).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  describe('fork hardening & paged LightboxGrid', () => {
    it('loads the next page at the end of loaded media and opens the next item', async () => {
      const page2Photo = createMockPhoto('photo4.jpg', 3);
      const hasMore = signal(true);
      const loadState = signal<'idle' | 'loading' | 'error'>('idle');
      const pagedGrid: LightboxGrid = {
        media: grid.media,
        revealMedia: grid.revealMedia,
        hasMore,
        loadState,
        loadMore: vi.fn(async () => {
          grid.media.set([...photos, page2Photo]);
          hasMore.set(false);
        }),
      };
      fixture.componentRef.setInput('grid', pagedGrid);
      await openPhoto('photo3.jpg');

      component.nextImage();
      await settle();

      expect(pagedGrid.loadMore).toHaveBeenCalledTimes(1);
      expect(photoParam()).toBe('photo4.jpg');
    });

    it('loads media before the first one and steps back to it', async () => {
      const newer = createMockPhoto('photo0.jpg', 9);
      const hasPrevious = signal(true);
      const pagedGrid: LightboxGrid = {
        media: grid.media,
        revealMedia: grid.revealMedia,
        hasMore: signal(false),
        hasPrevious,
        loadState: signal('idle'),
        loadPrevious: vi.fn(async () => {
          grid.media.set([newer, ...photos]);
          hasPrevious.set(false);
        }),
      };
      fixture.componentRef.setInput('grid', pagedGrid);
      await openPhoto('photo1.jpg');
      expect(component.hasPrev(), 'the first loaded photo, more above it').toBe(true);

      component.prevImage();
      await settle();

      expect(pagedGrid.loadPrevious).toHaveBeenCalledTimes(1);
      expect(photoParam()).toBe('photo0.jpg');
      expect(component.hasPrev()).toBe(false);
    });

    it('does not navigate when the viewer closes while a page is loading', async () => {
      let resolvePage!: () => void;
      const hasMore = signal(true);
      const pagedGrid: LightboxGrid = {
        media: grid.media,
        revealMedia: grid.revealMedia,
        hasMore,
        loadState: signal('idle'),
        loadMore: vi.fn(() => new Promise<void>(resolve => {
          resolvePage = (): void => {
            grid.media.set([...photos, createMockPhoto('photo4.jpg', 3)]);
            hasMore.set(false);
            resolve();
          };
        })),
      };
      fixture.componentRef.setInput('grid', pagedGrid);
      await openPhoto('photo3.jpg');

      component.nextImage();
      component.hide();
      await settle();
      resolvePage();
      await settle();

      expect(component.status()).toBe(LightboxStates.Closed);
      expect(photoParam()).toBeUndefined();
    });

    it('stops loading and does not navigate after the viewer is destroyed mid-load', async () => {
      let resolvePage!: () => void;
      const pagedGrid: LightboxGrid = {
        media: grid.media,
        revealMedia: grid.revealMedia,
        hasMore: signal(true),
        loadState: signal('idle'),
        loadMore: vi.fn(() => new Promise<void>(resolve => {
          resolvePage = resolve;
        })),
      };
      fixture.componentRef.setInput('grid', pagedGrid);
      await openPhoto('photo3.jpg');

      component.nextImage();
      fixture.destroy();
      resolvePage();
      await vi.advanceTimersByTimeAsync(0);

      expect(pagedGrid.loadMore).toHaveBeenCalledTimes(1);
    });

    it('keeps loading through pages that add nothing until a new item appears', async () => {
      let calls = 0;
      const hasMore = signal(true);
      const pagedGrid: LightboxGrid = {
        media: grid.media,
        revealMedia: grid.revealMedia,
        hasMore,
        loadState: signal('idle'),
        loadMore: vi.fn(async () => {
          calls++;
          if (calls === 3) {
            grid.media.set([...photos, createMockPhoto('photo4.jpg', 3)]);
            hasMore.set(false);
          }
        }),
      };
      fixture.componentRef.setInput('grid', pagedGrid);
      await openPhoto('photo3.jpg');

      component.nextImage();
      await settle();

      expect(pagedGrid.loadMore).toHaveBeenCalledTimes(3);
      expect(photoParam()).toBe('photo4.jpg');
    });

    it('cancels active media request when closing or destroying lightbox', async () => {
      await openPhoto('photo1.jpg');
      const cancelSpy = vi.spyOn(component.mediaElement(), 'cancelActiveRequest');

      component.hide();
      await settle();
      expect(cancelSpy).toHaveBeenCalled();

      await openPhoto('photo2.jpg');
      cancelSpy.mockClear();
      fixture.destroy();
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('promotes Opening to Open via safety fallback timer if animation does not settle', async () => {
      // Animation that never fires 'finish' (e.g. hidden tab)
      HTMLElement.prototype.animate = (): Animation => {
        const a = new EventTarget() as Animation;
        a.cancel = vi.fn();
        return a;
      };
      mockActivatedRoute.queryParams.next({[QueryParams.gallery.photo]: 'photo1.jpg'});
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(component.status()).toBe(LightboxStates.Opening);

      await vi.advanceTimersByTimeAsync(500);
      fixture.detectChanges();
      expect(component.status()).toBe(LightboxStates.Open);
    });

    it('safely computes lightBoxPhotoDimension with missing or 0x0 metadata size without NaN', async () => {
      const zeroPhoto = createMockPhoto('zero.jpg', 0);
      zeroPhoto.metadata.size = {width: 0, height: 0};
      grid.media.set([zeroPhoto]);
      await openPhoto('zero.jpg');

      const dim = (component as unknown as {calcLightBoxPhotoDimension(p: MediaDTO): {width: number; height: number; top: number; left: number}}).calcLightBoxPhotoDimension(zeroPhoto);
      expect(Number.isNaN(dim.width)).toBe(false);
      expect(Number.isNaN(dim.height)).toBe(false);
      expect(Number.isNaN(dim.top)).toBe(false);
      expect(Number.isNaN(dim.left)).toBe(false);
    });

    it('keeps app-top-loading-bar inside #root above lightbox layers', () => {
      const rootEl: HTMLElement = component.root().nativeElement;
      const loadingBar = rootEl.querySelector('app-top-loading-bar');
      expect(loadingBar).toBeTruthy();
    });
  });
});
