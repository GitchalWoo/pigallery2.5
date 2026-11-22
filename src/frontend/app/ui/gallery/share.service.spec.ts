import {BehaviorSubject, Subject} from 'rxjs';
import {ShareService} from './share.service';
import {NavigationService} from '../../model/navigation.service';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ErrorCodes} from '../../../../common/entities/Error';
import {UserRoles} from '../../../../common/entities/UserDTO';

describe('ShareService public sharing info', () => {
  const setUp = (answer: unknown) => {
    const networkService = {getJson: vi.fn().mockResolvedValue(answer)};
    const router = {events: new Subject()};
    const service = new ShareService(networkService as any, router as any);
    service.sharingKey = 'key1';
    return {networkService, service};
  };

  it('asks the public info of the sharing and keeps it', async () => {
    const {networkService, service} = setUp({sharingKey: 'key1', passwordProtected: true});
    await (service as any).checkSharing();
    expect(networkService.getJson).toHaveBeenCalledWith('/share/key1/publicInfo');
    expect(service.sharingIsValid.value).toBe(true);
    expect(service.publicSharingSubject.value).toEqual({sharingKey: 'key1', passwordProtected: true});
  });

  it('drops the public info of an invalid sharing', async () => {
    const {service} = setUp({sharingKey: 'other', passwordProtected: false});
    service.publicSharingSubject.next({sharingKey: 'key1', passwordProtected: true});
    await (service as any).checkSharing();
    expect(service.sharingIsValid.value).toBe(false);
    expect(service.publicSharingSubject.value).toBeNull();
  });
});

describe('NavigationService.toLogin of a sharing', () => {
  const setUp = (passwordProtected: boolean) => {
    const router = {navigate: vi.fn().mockResolvedValue(true)};
    const shareService = {
      wait: () => Promise.resolve(),
      isSharing: () => true,
      getSharingKey: () => 'key1',
      publicSharingSubject: new BehaviorSubject({sharingKey: 'key1', passwordProtected})
    };
    const authenticationService = {user: new BehaviorSubject(null)};
    const service = new NavigationService(router as any, shareService as any, authenticationService as any);
    return {router, service};
  };

  it('opens the share login of a password protected sharing', async () => {
    const {router, service} = setUp(true);
    await service.toLogin();
    expect(router.navigate).toHaveBeenCalledWith(['shareLogin'], {queryParams: {sk: 'key1'}});
  });

  it('does not open the share login of a sharing without password', async () => {
    const {router, service} = setUp(false);
    await service.toLogin();
    expect(router.navigate).not.toHaveBeenCalledWith(['shareLogin'], expect.anything());
  });
});

describe('AuthenticationService.logout of a sharing', () => {
  const setUp = () => {
    const userService = {logout: vi.fn().mockResolvedValue(''), getSessionUser: vi.fn().mockResolvedValue({name: 'Guest', role: UserRoles.LimitedGuest})};
    const networkService = {addGlobalErrorHandler: vi.fn()};
    const shareService = {wait: () => Promise.resolve(), isSharing: () => true, onNewUser: vi.fn()};
    const cookieService = {get: (): string => null};
    const service = new AuthenticationService(userService as any, networkService as any, shareService as any, cookieService as any);
    userService.getSessionUser.mockClear();
    return {service, userService};
  };

  it('logs in again as the sharing guest after a logout', async () => {
    const {service, userService} = setUp();
    await service.logout();
    expect(userService.logout).toHaveBeenCalled();
    expect(userService.getSessionUser).toHaveBeenCalled();
    expect(service.user.value).toEqual({name: 'Guest', role: UserRoles.LimitedGuest});
  });

  it('does not log in again when the sharing needs its password (no logout loop)', async () => {
    const {service, userService} = setUp();
    await service.logout(ErrorCodes.NOT_AUTHENTICATED_SHARING);
    expect(userService.logout).toHaveBeenCalled();
    expect(userService.getSessionUser).not.toHaveBeenCalled();
    expect(service.user.value).toBeNull();
  });
});
