import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ANIMATION_MODULE_TYPE} from '@angular/core';
import {By} from '@angular/platform-browser';
import {provideRouter} from '@angular/router';
import {BsDropdownDirective} from 'ngx-bootstrap/dropdown';
import {NgIconsModule} from '@ng-icons/core';
import {
  ionChevronBackOutline,
  ionChevronForwardOutline,
  ionCloseOutline,
  ionContractOutline,
  ionDownloadOutline,
  ionExpandOutline,
  ionInformationOutline,
  ionMenuOutline,
  ionPauseOutline,
  ionPlayOutline,
  ionTimerOutline,
} from '@ng-icons/ionicons';

import {ControlsLightboxComponent} from './controls.lightbox.gallery.component';
import {LightboxService} from '../lightbox.service';
import {FullScreenService} from '../../fullscreen.service';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {NotificationService} from '../../../../model/notification.service';
import {FileSizePipe} from '../../../../pipes/FileSizePipe';
import {DatePipe} from '@angular/common';
import {Event} from '../../../../../../common/event/Event';

class MockLightboxService {
  controllersDimmed = false;
  slideshowSpeed = 5;
  captionAlwaysOn = false;
  facesAlwaysOn = false;
  topLeftTitle: any[] = [];
  topLeftSubtitle: any[] = [];
  bottomLeftTitle: any[] = [];
  bottomLeftSubtitle: any[] = [];
}

class MockFullScreenService {
  OnFullScreenChange = new Event<boolean>();
  isFullScreenEnabled() {
    return false;
  }
  isElementFullScreen(_el: any) {
    return false;
  }
}

class MockAuthenticationService {
  preventDownload = false;
  canSearch() {
    return false;
  }
}

class MockNotificationService {
  warning = vi.fn<(text: string | null) => void>();
}

describe('ControlsLightboxComponent - cursor visibility', () => {
  let component: ControlsLightboxComponent;
  let fixture: ComponentFixture<ControlsLightboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ControlsLightboxComponent,
        NgIconsModule.withIcons({
          ionInformationOutline,
          ionContractOutline,
          ionDownloadOutline,
          ionExpandOutline,
          ionMenuOutline,
          ionCloseOutline,
          ionChevronBackOutline,
          ionChevronForwardOutline,
          ionPlayOutline,
          ionPauseOutline,
          ionTimerOutline,
        }),
      ],
      providers: [
        {provide: LightboxService, useClass: MockLightboxService},
        {provide: FullScreenService, useClass: MockFullScreenService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: NotificationService, useClass: MockNotificationService},
        {provide: FileSizePipe, useValue: {}},
        {provide: DatePipe, useValue: {}},
        {provide: ANIMATION_MODULE_TYPE, useValue: 'NoopAnimations'},
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlsLightboxComponent);
    component = fixture.componentInstance;
  });

  it('should hide the cursor while the controls are dimmed', () => {
    component.controllersDimmed = true;
    fixture.detectChanges();

    const swipeable: HTMLElement = fixture.nativeElement.querySelector('#swipeable-container');
    expect(swipeable).toBeTruthy();
    expect(swipeable.classList.contains('hide-cursor')).toBe(true);
  });

  it('does not request the original from the download action when it is restricted', async () => {
    const authentication = TestBed.inject(AuthenticationService) as unknown as MockAuthenticationService;
    authentication.preventDownload = true;
    const original = vi.fn();
    component.activePhoto = {gridMedia: {getOriginalMediaPath: original}} as any;
    await component.downloadOriginal();
    expect(original).not.toHaveBeenCalled();
  });

  it('should keep the cursor visible while the controls are shown', () => {
    component.controllersDimmed = false;
    fixture.detectChanges();

    const swipeable: HTMLElement = fixture.nativeElement.querySelector('#swipeable-container');
    expect(swipeable).toBeTruthy();
    expect(swipeable.classList.contains('hide-cursor')).toBe(false);
  });

  it('should emit nextPhoto and stop event propagation when rightArrow is clicked', () => {
    component.navigation = {hasNext: true, hasPrev: true} as any;
    fixture.detectChanges();

    const nextSpy = vi.spyOn(component.nextPhoto, 'emit');
    const rightArrow: HTMLElement = fixture.nativeElement.querySelector('#rightArrow');
    expect(rightArrow).toBeTruthy();

    const clickEvent = new MouseEvent('click', {bubbles: true, cancelable: true});
    const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');
    rightArrow.dispatchEvent(clickEvent);

    expect(nextSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('should emit previousPhoto and stop event propagation when leftArrow is clicked', () => {
    component.navigation = {hasNext: true, hasPrev: true} as any;
    fixture.detectChanges();

    const prevSpy = vi.spyOn(component.previousPhoto, 'emit');
    const leftArrow: HTMLElement = fixture.nativeElement.querySelector('#leftArrow');
    expect(leftArrow).toBeTruthy();

    const clickEvent = new MouseEvent('click', {bubbles: true, cancelable: true});
    const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');
    leftArrow.dispatchEvent(clickEvent);

    expect(prevSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  // #1311: a file deleted from the disk is still in the DB until the next reindexing
  describe('download', () => {
    let notification: MockNotificationService;
    let clicked: ReturnType<typeof vi.spyOn>;
    let fetchMock: ReturnType<typeof vi.fn>;

    const respond = (status: number): void => {
      fetchMock = vi.fn().mockResolvedValue(new Response(null, {status}));
      vi.stubGlobal('fetch', fetchMock);
    };

    beforeEach(() => {
      component.activePhoto = {
        gridMedia: {
          media: {name: 'autumn hike.jpg', metadata: {}},
          Photo: {name: 'autumn hike.jpg', metadata: {}},
          getOriginalMediaPath: () => '/pgapi/gallery/content/autumn%20hike.jpg',
          isVideo: () => false,
          isPhoto: () => true,
        },
      } as any;
      fixture.detectChanges();
      notification = TestBed.inject(NotificationService) as unknown as MockNotificationService;
      clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('should download the original file with its name on Shift+D', async () => {
      respond(200);
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'D', shiftKey: true}));
      await vi.waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));

      expect(fetchMock).toHaveBeenCalledWith('/pgapi/gallery/content/autumn%20hike.jpg', {method: 'HEAD'});
      const link = clicked.mock.contexts[0] as HTMLAnchorElement;
      expect(link.download).toBe('autumn hike.jpg');
      expect(notification.warning).not.toHaveBeenCalled();
    });

    it('should warn when a file deleted from disk returns 404', async () => {
      respond(404);
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'D', shiftKey: true}));
      await vi.waitFor(() => expect(notification.warning).toHaveBeenCalledWith('This file is not available anymore.'));

      expect(clicked).not.toHaveBeenCalled();
    });

    it('should check the file when clicking the download menu item', async () => {
      respond(404);
      fixture.debugElement.query(By.directive(BsDropdownDirective)).injector.get(BsDropdownDirective).show();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const click = new MouseEvent('click', {bubbles: true, cancelable: true});
      const link: HTMLElement = fixture.nativeElement.querySelector('a.dropdown-item[href]');
      expect(link).toBeTruthy();
      link.dispatchEvent(click);

      await vi.waitFor(() => expect(notification.warning).toHaveBeenCalledWith('This file is not available anymore.'));
      expect(click.defaultPrevented).toBe(true);
      expect(clicked).not.toHaveBeenCalled();
    });
  });
});
