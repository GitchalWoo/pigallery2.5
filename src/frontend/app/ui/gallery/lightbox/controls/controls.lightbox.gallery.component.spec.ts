import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ANIMATION_MODULE_TYPE} from '@angular/core';
import {provideRouter} from '@angular/router';
import {NgIconsModule} from '@ng-icons/core';
import {
  ionChevronBackOutline,
  ionChevronForwardOutline,
  ionCloseOutline,
  ionContractOutline,
  ionExpandOutline,
  ionInformationOutline,
  ionMenuOutline,
  ionPauseOutline,
  ionPlayOutline,
} from '@ng-icons/ionicons';

import {ControlsLightboxComponent} from './controls.lightbox.gallery.component';
import {LightboxService} from '../lightbox.service';
import {FullScreenService} from '../../fullscreen.service';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {FileSizePipe} from '../../../../pipes/FileSizePipe';
import {DatePipe} from '@angular/common';
import {Event} from '../../../../../../common/event/Event';

class MockLightboxService {
  controllersDimmed = false;
  slideshowSpeed = 5;
  captionAlwaysOn = false;
  facesAlwaysOn = false;
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
  canSearch() {
    return false;
  }
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
          ionExpandOutline,
          ionMenuOutline,
          ionCloseOutline,
          ionChevronBackOutline,
          ionChevronForwardOutline,
          ionPlayOutline,
          ionPauseOutline,
        }),
      ],
      providers: [
        {provide: LightboxService, useClass: MockLightboxService},
        {provide: FullScreenService, useClass: MockFullScreenService},
        {provide: AuthenticationService, useClass: MockAuthenticationService},
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
});
