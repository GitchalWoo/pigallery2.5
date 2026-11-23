import {TestBed} from '@angular/core/testing';
import {CUSTOM_ELEMENTS_SCHEMA, Type} from '@angular/core';
import {LoginComponent} from './login.component';
import {PrismLoginComponent} from '../../themes/prism/login/prism-login.component';
import {AuthenticationService} from '../../model/network/authentication.service';
import {NavigationService} from '../../model/navigation.service';
import {ErrorCodes} from '../../../../common/entities/Error';
import {LanguageComponent} from '../language/language.component';

describe('LoginComponent', () => {
  let auth: { isAuthenticated: () => boolean, login: ReturnType<typeof vi.fn> };
  let navigation: { toDefault: ReturnType<typeof vi.fn>, toAfterLogin: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = {isAuthenticated: () => false, login: vi.fn().mockRejectedValue({code: ErrorCodes.CREDENTIAL_NOT_FOUND})};
    navigation = {toDefault: vi.fn().mockResolvedValue(true), toAfterLogin: vi.fn().mockResolvedValue(true)};
  });

  const render = <T extends LoginComponent>(component: Type<T>): T => {
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        {provide: AuthenticationService, useValue: auth},
        {provide: NavigationService, useValue: navigation},
      ]
    });
    // the language picker is not part of these tests
    TestBed.overrideComponent(component, {remove: {imports: [LanguageComponent]}, add: {schemas: [CUSTOM_ELEMENTS_SCHEMA]}});
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  // #1306, on the legacy and on the Prism login page
  for (const [name, component] of [['legacy', LoginComponent], ['Prism', PrismLoginComponent]] as const) {
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

  it('should open the page the login was opened for when already logged in', () => {
    auth.isAuthenticated = () => true;
    render(LoginComponent);
    expect(navigation.toAfterLogin).toHaveBeenCalled();
    expect(navigation.toDefault).not.toHaveBeenCalled();
  });
});
