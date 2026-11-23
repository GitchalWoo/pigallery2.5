import {ActivatedRouteSnapshot, RouterStateSnapshot} from '@angular/router';
import {AdminGuard, AuthGuard} from './auth.guard';
import {UserRoles} from '../../../../../common/entities/UserDTO';

describe('AuthGuard', () => {
  const setUp = (authenticated: boolean) => {
    const navigation = {toLogin: vi.fn().mockResolvedValue(true)};
    const guard = new AuthGuard({isAuthenticated: () => authenticated} as any, navigation as any);
    return {guard, navigation};
  };

  it('opens the page for a logged-in user', () => {
    const {guard, navigation} = setUp(true);
    expect(guard.canActivate({} as ActivatedRouteSnapshot, {url: '/albums'} as RouterStateSnapshot)).toBe(true);
    expect(navigation.toLogin).not.toHaveBeenCalled();
  });

  // #1306
  it('sends a visitor to the login with the url they opened', () => {
    const {guard, navigation} = setUp(false);
    expect(guard.canActivate({} as ActivatedRouteSnapshot, {url: '/albums?x=1'} as RouterStateSnapshot)).toBe(false);
    expect(navigation.toLogin).toHaveBeenCalledWith('/albums?x=1');
  });
});

// #1315
describe('AdminGuard', () => {
  const setUp = (role: UserRoles | null) => {
    const authenticationService = {
      isAuthenticated: () => role !== null,
      isAuthorized: (r: UserRoles) => role !== null && role >= r
    };
    const navigation = {toLogin: vi.fn().mockResolvedValue(true), toDefault: vi.fn().mockResolvedValue(true)};
    const toastr = {warning: vi.fn()};
    const guard = new AdminGuard(new AuthGuard(authenticationService as any, navigation as any),
      authenticationService as any, navigation as any, toastr as any);
    const run = () => guard.canActivate({} as ActivatedRouteSnapshot, {url: '/admin'} as RouterStateSnapshot);
    return {run, navigation, toastr};
  };

  it('opens the admin page for an admin', () => {
    const {run, navigation, toastr} = setUp(UserRoles.Admin);
    expect(run()).toBe(true);
    expect(toastr.warning).not.toHaveBeenCalled();
    expect(navigation.toDefault).not.toHaveBeenCalled();
  });

  it('sends a visitor to the login, back to the admin page after it', () => {
    const {run, navigation, toastr} = setUp(null);
    expect(run()).toBe(false);
    expect(navigation.toLogin).toHaveBeenCalledWith('/admin');
    expect(toastr.warning).not.toHaveBeenCalled();
  });

  it('sends a logged-in user who is not an admin to their page with a warning, not to the login', () => {
    for (const role of [UserRoles.LimitedGuest, UserRoles.Guest, UserRoles.User]) {
      const {run, navigation, toastr} = setUp(role);
      expect(run()).toBe(false);
      expect(navigation.toLogin).not.toHaveBeenCalled();
      expect(navigation.toDefault).toHaveBeenCalled();
      expect(toastr.warning).toHaveBeenCalledWith('Only admins can open the admin page.', '', expect.anything());
    }
  });
});
