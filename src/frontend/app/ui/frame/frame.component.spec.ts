import {CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {NgIconComponent} from '@ng-icons/core';
import {BehaviorSubject} from 'rxjs';
import {UserRoles} from '../../../../common/entities/UserDTO';
import {AuthenticationService} from '../../model/network/authentication.service';
import {NotificationService} from '../../model/notification.service';
import {QueryService} from '../../model/query.service';
import {ThemeService} from '../../model/theme.service';
import {GalleryService} from '../gallery/gallery.service';
import {GallerySearchComponent} from '../gallery/search/search.gallery.component';
import {GalleryShareComponent} from '../gallery/share/share.gallery.component';
import {UploaderService} from '../gallery/uploader/uploader.service';
import {LanguageComponent} from '../language/language.component';
import {FrameComponent} from './frame.component';

describe('FrameComponent navbar', () => {
  function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {provide: AuthenticationService, useValue: {user: new BehaviorSubject({role: UserRoles.Admin})}},
        {provide: NotificationService, useValue: {numberOfNotifications: new BehaviorSubject(0)}},
        {provide: QueryService, useValue: {getParams: () => ({})}},
        {provide: ThemeService, useValue: {toggleMode: vi.fn()}},
        {provide: GalleryService, useValue: {autoPollInterval: 0}},
        {provide: UploaderService, useValue: {canUpload: () => false}},
      ],
    }).overrideComponent(FrameComponent, {
      remove: {imports: [GallerySearchComponent, GalleryShareComponent, LanguageComponent, NgIconComponent]},
      add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]},
    });
    const fixture = TestBed.createComponent(FrameComponent);
    fixture.componentRef.setInput('showSearch', true);
    fixture.detectChanges();
    return fixture;
  }

  it('leaves navbar search visible to assistive technology', () => {
    const navbar = (render().nativeElement as HTMLElement).querySelector<HTMLElement>('#navbarCollapse');
    expect(navbar.getAttribute('aria-hidden')).toBeNull();
    expect(navbar.style.display).not.toBe('none');
    expect(navbar.querySelector('app-gallery-search')).toBeTruthy();
  });

  it('keeps menu controls open and dismisses on outside click or Escape', async () => {
    const fixture = render();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('#button-frame-menu');
    const open = async () => {
      toggle.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
      await fixture.whenStable();
      return document.querySelector<HTMLElement>('#dropdown-frame-menu');
    };
    const menu = await open();
    expect(menu).toBeTruthy();
    const tools = menu.querySelector<HTMLButtonElement>('button[aria-controls="dropdown-frame-tools"]');
    tools.click();
    fixture.detectChanges();
    const toolsMenu = menu.querySelector<HTMLElement>('#dropdown-frame-tools');
    expect(toolsMenu.classList.contains('show')).toBe(true);
    toolsMenu.click();
    expect(fixture.componentInstance.dropdown.isOpen).toBe(true);

    document.body.click();
    expect(fixture.componentInstance.dropdown.isOpen).toBe(false);

    const reopened = await open();
    expect(reopened.querySelector('#dropdown-frame-tools').classList.contains('show')).toBe(false);
    reopened.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(fixture.componentInstance.dropdown.isOpen).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });
});
