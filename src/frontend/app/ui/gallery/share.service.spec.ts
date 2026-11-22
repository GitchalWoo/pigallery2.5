import {BehaviorSubject, Subject} from 'rxjs';
import {ShareService} from './share.service';
import {NavigationService} from '../../model/navigation.service';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ErrorCodes} from '../../../../common/entities/Error';
import {SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../../common/SearchQueryUtils';
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
  it('does not restore public metadata when a response arrives after dropping the share', async () => {
    const {networkService, service} = setUp({sharingKey: 'key1', passwordProtected: true});
    const loading = service.getPublicSharing();
    service.dropSharing();
    await expect(loading).resolves.toBeNull();
    expect(networkService.getJson).toHaveBeenCalledTimes(1);
    expect(service.sharingIsValid.value).toBeNull();
    expect(service.sharingSubject.value).toBeNull();
  });

  it('uses an explicit default, then search, then the folder represented by a directory query', () => {
    const {service} = setUp(null);
    const searchQuery = {type: SearchQueryTypes.any_text, value: 'picnic'} as const;
    const directoryQuery = {
      type: SearchQueryTypes.directory, value: 'family/*', matchType: TextSearchQueryMatchTypes.globMatch
    } as const;
    const share = {sharingKey: 'key1', directoryQuery} as Parameters<ShareService['getDefaultRoute']>[0];
    expect(service.getDefaultRoute(share)).toEqual(['/gallery', 'family']);
    expect(service.getDefaultRoute({...share, searchQuery})).toEqual(['/search', SearchQueryUtils.urlify(searchQuery)]);
    expect(service.getDefaultRoute({...share, defaultSearchView: searchQuery})).toEqual(['/search', SearchQueryUtils.urlify(searchQuery)]);
    expect(service.getDefaultRoute({...share, searchQuery, defaultDirectoryView: '/'})).toEqual(['/gallery', '']);
    const exact = {...directoryQuery, value: 'family/literal*', matchType: TextSearchQueryMatchTypes.exact_match};
    expect(service.getDefaultRoute({...share, directoryQuery: exact})).toEqual(['/gallery', 'family/literal*']);
  });

});

describe('NavigationService.toLogin of a sharing', () => {
  const setUp = (passwordProtected: boolean) => {
    const router = {navigate: vi.fn().mockResolvedValue(true)};
    const shareService = {
      wait: () => Promise.resolve(),
      isSharing: () => true,
      getSharingKey: () => 'key1',
      getPublicSharing: vi.fn().mockResolvedValue({sharingKey: 'key1', passwordProtected})
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
  const setUp = (passwordProtected = true) => {
    const userService = {logout: vi.fn().mockResolvedValue(''), getSessionUser: vi.fn().mockResolvedValue({name: 'Guest', role: UserRoles.LimitedGuest})};
    const networkService = {addGlobalErrorHandler: vi.fn()};
    let sharing = true;
    const shareService = {
      wait: () => Promise.resolve(), isSharing: () => sharing, onNewUser: vi.fn(),
      getPublicSharing: vi.fn().mockResolvedValue({passwordProtected}),
      dropSharing: vi.fn(() => { sharing = false; }),
    };
    const cookieService = {get: (): string => null};
    const service = new AuthenticationService(userService as any, networkService as any, shareService as any, cookieService as any);
    userService.getSessionUser.mockClear();
    return {service, userService, shareService};
  };

  it('logs in again as the sharing guest after a logout', async () => {
    const {service, userService} = setUp();
    await service.logout();
    expect(userService.logout).toHaveBeenCalled();
    expect(userService.getSessionUser).toHaveBeenCalled();
    expect(service.user.value).toEqual({name: 'Guest', role: UserRoles.LimitedGuest});
  });

  it('leaves a passwordless sharing before publishing the logged-out state', async () => {
    const {service, userService, shareService} = setUp(false);
    await service.logout();
    expect(shareService.dropSharing).toHaveBeenCalledOnce();
    expect(userService.getSessionUser).not.toHaveBeenCalled();
    expect(service.user.value).toBeNull();
  });

  it('does not log in again when the sharing needs its password (no logout loop)', async () => {
    const {service, userService} = setUp();
    await service.logout(ErrorCodes.NOT_AUTHENTICATED_SHARING);
    expect(userService.logout).toHaveBeenCalled();
    expect(userService.getSessionUser).not.toHaveBeenCalled();
    expect(service.user.value).toBeNull();
  });
});

describe('ShareService default-view requests', () => {
  const setup = () => {
    const network = {postJson: vi.fn(), putJson: vi.fn()};
    const service = new ShareService(network as any, {events: new Subject()} as any);
    return {service, network};
  };
  const search = {type: SearchQueryTypes.any_text, value: 'picnic'} as const;

  it('forwards the selected default view on legacy and search-based create and update', () => {
    const {service, network} = setup();
    service.createSharing('photos', '', 1000, 'photos');
    service.createSharingByQuery(search, '', 1000, undefined, search);
    service.updateSharing('photos', 1, '', 1000, undefined, search);
    service.updateSharingByQuery(1, search, '', 1000, '/');

    expect(network.postJson).toHaveBeenNthCalledWith(1, '/share/photos', {
      createSharing: {valid: 1000, defaultDirectoryView: 'photos'}
    });
    expect(network.postJson).toHaveBeenNthCalledWith(2, '/share/', {
      createSharing: {valid: 1000, searchQuery: search, defaultSearchView: search}
    });
    expect(network.putJson).toHaveBeenNthCalledWith(1, '/share/photos', {
      updateSharing: {id: 1, valid: 1000, password: '', defaultSearchView: search}
    });
    expect(network.putJson).toHaveBeenNthCalledWith(2, '/share/', {
      updateSharing: {id: 1, valid: 1000, password: '', searchQuery: search, defaultDirectoryView: '/'}
    });
  });

  it('rejects conflicting defaults before sending the request', () => {
    const {service, network} = setup();
    expect(() => service.createSharingByQuery(search, '', 1000, 'photos', search)).toThrow('cannot be set at the same time');
    expect(() => service.updateSharing('photos', 1, '', 1000, 'photos', search)).toThrow('cannot be set at the same time');
    expect(network.postJson).not.toHaveBeenCalled();
    expect(network.putJson).not.toHaveBeenCalled();
  });
});
