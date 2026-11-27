import {BehaviorSubject} from 'rxjs';
import {AppComponent} from './app.component';
import {UserDTO} from '../../common/entities/UserDTO';

// #1306: the login page knows where to go back to
describe('AppComponent', () => {
  const setUp = async (options: { navigated?: boolean, loginPage?: boolean } = {}) => {
    const user = new BehaviorSubject<UserDTO>({name: 'u'} as UserDTO);
    const authenticationService = {
      user,
      isAuthenticated: () => !!user.value,
      loggedOutByUser: false
    };
    const navigation = {
      isErrorPage: () => false,
      isLoginPage: vi.fn(() => options.loginPage ?? false),
      hasNavigated: () => options.navigated ?? true,
      url: () => '/gallery/deep/folder?p=1',
      toLogin: vi.fn().mockResolvedValue(true),
      toAfterLogin: vi.fn().mockResolvedValue(true),
    };
    const shareService = {wait: () => Promise.resolve(), isSharing: () => false};
    const themeService = {init: vi.fn()};
    const component = new AppComponent(authenticationService as any, shareService as any, navigation as any,
      {setTitle: vi.fn()} as any, themeService as any);
    await component.ngOnInit();
    return {component, user, authenticationService, navigation, themeService};
  };

  it('leaves the theme setup to the theme service, so its mode listener is not added twice', async () => {
    const {themeService} = await setUp();
    expect(themeService.init).not.toHaveBeenCalled();
  });

  it('opens the page the login was opened for once logged in', async () => {
    const {navigation} = await setUp({loginPage: true});
    expect(navigation.toAfterLogin).toHaveBeenCalled();
  });

  it('takes the user back to the page where the session ended', async () => {
    const {user, navigation, component} = await setUp();
    user.next(null);
    expect(navigation.toLogin).toHaveBeenCalledWith('/gallery/deep/folder?p=1');
    component.ngOnDestroy();
  });

  it('does not take the user back after they logged out', async () => {
    const {user, navigation, authenticationService, component} = await setUp();
    authenticationService.loggedOutByUser = true;
    user.next(null);
    expect(navigation.toLogin).toHaveBeenCalledWith(undefined);
    component.ngOnDestroy();
  });

  it('leaves the first page to the guards (they keep the url that was opened)', async () => {
    const {user, navigation, component} = await setUp({navigated: false});
    user.next(null);
    expect(navigation.toLogin).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
});
