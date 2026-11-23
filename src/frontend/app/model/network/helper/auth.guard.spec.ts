import {ActivatedRouteSnapshot, RouterStateSnapshot} from '@angular/router';
import {AuthGuard} from './auth.guard';

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
