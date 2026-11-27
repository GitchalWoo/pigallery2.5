import {BehaviorSubject} from 'rxjs';
import {ErrorCodes} from '../../../../common/entities/Error';
import {ShareLoginComponent} from './share-login.component';
import {TestBed} from '@angular/core/testing';
import {CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {AuthenticationService} from '../../model/network/authentication.service';
import {NavigationService} from '../../model/navigation.service';
import {ShareService} from '../gallery/share.service';
import {LanguageComponent} from '../language/language.component';
import {NgIconComponent} from '@ng-icons/core';

describe('ShareLoginComponent', () => {
  it('identifies the share password for autofill', () => {
    TestBed.configureTestingModule({
      providers: [
        {provide: AuthenticationService, useValue: {user: new BehaviorSubject(null), isAuthenticated: () => false}},
        {provide: NavigationService, useValue: {}},
        {provide: ShareService, useValue: {sharingIsValid: new BehaviorSubject(true)}},
      ],
    }).overrideComponent(ShareLoginComponent, {
      remove: {imports: [LanguageComponent, NgIconComponent]},
      add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]},
    });
    const fixture = TestBed.createComponent(ShareLoginComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#password').getAttribute('autocomplete')).toBe('current-password');
  });

  const setup = (valid: boolean) => {
    const sharing = {
      getSharingKey: () => 'new',
      reloadPublicSharing: vi.fn().mockResolvedValue(valid ? {sharingKey: 'new'} : null),
      sharingIsValid: new BehaviorSubject(valid),
    };
    const auth = {user: new BehaviorSubject({usedSharingKey: 'previous'}), isAuthenticated: () => true,
      shareLogin: vi.fn().mockRejectedValue({code: ErrorCodes.CREDENTIAL_NOT_FOUND})};
    const navigation = {toGallery: vi.fn(), toShareProblem: vi.fn().mockResolvedValue(true)};
    const component = new ShareLoginComponent(sharing as any, auth as any, navigation as any);
    return {component, navigation};
  };

  it('keeps the password prompt when a previous share session is still shown by the client', () => {
    const {component, navigation} = setup(true);
    component.ngOnInit();
    expect(navigation.toGallery).not.toHaveBeenCalled();
  });

  it('reports a wrong password on a valid link and redirects for an expired link', async () => {
    const valid = setup(true);
    await valid.component.onLogin();
    expect(valid.component.loginError).toBe(true);
    expect(valid.navigation.toShareProblem).not.toHaveBeenCalled();
    const expired = setup(false);
    await expired.component.onLogin();
    expect(expired.component.loginError).toBe(false);
    expect(expired.navigation.toShareProblem).toHaveBeenCalledWith(false);
  });
  // #1306
  it('clears and focuses the password after a wrong password', async () => {
    const {component} = setup(true);
    const focus = vi.fn();
    component.password = 'wrong';
    component.passwordInput = {nativeElement: {focus}} as any;
    await component.onLogin();
    expect(component.password).toBe('');
    expect(focus).toHaveBeenCalled();
  });
});
