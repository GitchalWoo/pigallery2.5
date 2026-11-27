import {ComponentFixture, TestBed} from '@angular/core/testing';
import {CUSTOM_ELEMENTS_SCHEMA, Type} from '@angular/core';
import {LoginComponent} from './login.component';
import {PrismLoginComponent} from '../../themes/prism/login/prism-login.component';
import {AuthenticationService} from '../../model/network/authentication.service';
import {NavigationService} from '../../model/navigation.service';
import {ErrorCodes} from '../../../../common/entities/Error';
import {LanguageComponent} from '../language/language.component';
import {ActivatedRoute, convertToParamMap} from '@angular/router';

describe('LoginComponent', () => {
  let auth: { isAuthenticated: () => boolean, login: ReturnType<typeof vi.fn> };
  let navigation: { toDefault: ReturnType<typeof vi.fn>, toAfterLogin: ReturnType<typeof vi.fn>, rememberReturnUrl: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {isAuthenticated: () => false, login: vi.fn().mockRejectedValue({code: ErrorCodes.CREDENTIAL_NOT_FOUND})};
    navigation = {toDefault: vi.fn().mockResolvedValue(true), toAfterLogin: vi.fn().mockResolvedValue(true), rememberReturnUrl: vi.fn()};
  });

  const render = <T extends LoginComponent>(component: Type<T>, queryParams: Record<string, string> = {}): T => {
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        {provide: ActivatedRoute, useValue: {snapshot: {queryParamMap: convertToParamMap(queryParams)}}},
        {provide: AuthenticationService, useValue: auth},
        {provide: NavigationService, useValue: navigation},
      ]
    });
    // the language picker is not part of these tests
    TestBed.overrideComponent(component, {remove: {imports: [LanguageComponent]}, add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]}});
    const created = TestBed.createComponent(component);
    fixture = created;
    created.detectChanges();
    return created.componentInstance;
  };
  let fixture: ComponentFixture<LoginComponent>;
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent;

  // #1306, on the legacy and on the Prism login page
  for (const [name, component] of [['legacy', LoginComponent], ['Prism', PrismLoginComponent]] as const) {
    it('identifies the credentials for autofill (' + name + ')', () => {
      render(component as Type<LoginComponent>);
      const form = fixture.nativeElement as HTMLElement;
      expect(form.querySelector('#username').getAttribute('autocomplete')).toBe('username');
      expect(form.querySelector('#password').getAttribute('autocomplete')).toBe('current-password');
    });

    it('should clear and focus the password after a wrong password (' + name + ')', async () => {
      const login = render(component as Type<LoginComponent>);
      login.loginCredential.username = 'user';
      login.loginCredential.password = 'wrong';

      await login.onLogin();

      expect(login.loginError).toBe(true);
      expect(login.loginCredential.password).toBe('');
      expect(login.loginCredential.username).toBe('user');
      expect(document.activeElement).toBe(login.passwordInput.nativeElement);
    });
  }

  it('should keep the password on other errors', async () => {
    auth.login.mockRejectedValue({code: ErrorCodes.GENERAL_ERROR});
    const login = render(LoginComponent);
    login.loginCredential.password = 'secret';

    await login.onLogin();

    expect(login.loginError).toBe(false);
    expect(login.loginCredential.password).toBe('secret');
  });

  // #1306: the provider sends the browser back to the app root, so the url to return to waits in the session storage
  it('should keep the url to return to before the OIDC login', () => {
    const login = render(LoginComponent);
    login.oidcEnabled = true;
    const open = vi.spyOn(login, 'openProvider').mockImplementation(() => undefined);

    login.onLoginWithOIDC();

    expect(navigation.rememberReturnUrl).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(login.oidcLoginUrl);
    expect(navigation.rememberReturnUrl.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
  });

  it('should open the page the login was opened for when already logged in', () => {
    auth.isAuthenticated = () => true;
    render(LoginComponent);
    expect(navigation.toAfterLogin).toHaveBeenCalled();
    expect(navigation.toDefault).not.toHaveBeenCalled();
  });

  // #1422, on the legacy and on the Prism login page
  for (const [name, component] of [['legacy', LoginComponent], ['Prism', PrismLoginComponent]] as const) {
    it('should tell when the OIDC provider denied the access (' + name + ')', () => {
      expect(render(component as Type<LoginComponent>, {oidcError: 'denied'}).oidcError).toBe('denied');
      expect(text()).toContain('Access denied. Ask the administrator to give you access.');
    });

    it('should tell when the OIDC login failed (' + name + ')', () => {
      expect(render(component as Type<LoginComponent>, {oidcError: 'failed'}).oidcError).toBe('failed');
      expect(text()).toContain('Login with the provider failed. Please try again later.');
    });
  }

  it('should ignore unknown OIDC errors', () => {
    expect(render(LoginComponent, {oidcError: '<b>x</b>'}).oidcError).toBe(null);
    expect(text()).not.toContain('<b>x</b>');
    expect(text()).not.toContain('Access denied');
  });

  it('should show no OIDC error by default and hide it on the next login try', async () => {
    expect(render(LoginComponent).oidcError).toBe(null);
    TestBed.resetTestingModule();
    const login = render(LoginComponent, {oidcError: 'denied'});
    await login.onLogin();
    expect(login.oidcError).toBe(null);
  });
});
