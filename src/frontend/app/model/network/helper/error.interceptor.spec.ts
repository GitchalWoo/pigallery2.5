import {HttpErrorResponse, HttpRequest} from '@angular/common/http';
import {BehaviorSubject, firstValueFrom, throwError} from 'rxjs';
import {ErrorInterceptor} from './error.interceptor';
import {ErrorCodes} from '../../../../../common/entities/Error';

describe('ErrorInterceptor', () => {
  const setUp = (authenticated: boolean) => {
    const authenticationService = {isAuthenticated: () => authenticated, logout: vi.fn().mockResolvedValue(undefined)};
    const navigationService = {toError: vi.fn(), toShareProblem: vi.fn().mockResolvedValue(true)};
    const shareService = {
      isSharing: vi.fn().mockReturnValue(false),
      getSharingKey: vi.fn().mockReturnValue('key'),
      reloadPublicSharing: vi.fn().mockResolvedValue(null),
      sharingIsValid: new BehaviorSubject(false)
    };
    const interceptor = new ErrorInterceptor(authenticationService as any, navigationService as any, shareService as any);
    const fail = async (url: string, error: HttpErrorResponse) => {
      const next = {handle: () => throwError(() => error)};
      await firstValueFrom(interceptor.intercept(new HttpRequest('GET', url), next as any)).catch((): void => undefined);
    };
    return {authenticationService, navigationService, shareService, fail};
  };
  const unauthorized = (code?: ErrorCodes) =>
    new HttpErrorResponse({status: 401, error: code === undefined ? null : {error: {code, message: 'Not authenticated'}}});
  const forbidden = (code: ErrorCodes) =>
    new HttpErrorResponse({status: 403, error: {error: {code, message: 'Forbidden'}}});

  it('passes the error code of a 401 to the logout', async () => {
    const {authenticationService, fail} = setUp(true);
    await fail('/api/gallery/content/', unauthorized(ErrorCodes.NOT_AUTHENTICATED_SHARING));
    expect(authenticationService.logout).toHaveBeenCalledWith(ErrorCodes.NOT_AUTHENTICATED_SHARING);
  });

  it('logs out on a 401 without a body', async () => {
    const {authenticationService, fail} = setUp(true);
    await fail('/api/gallery/content/', unauthorized());
    expect(authenticationService.logout).toHaveBeenCalledWith(undefined);
  });

  it('keeps the logout loop guard', async () => {
    const {authenticationService, fail} = setUp(true);
    for (const url of ['/api/user/me', '/api/user/login', '/api/user/logout', '/api/share/key/publicInfo']) {
      await fail(url, unauthorized(ErrorCodes.NOT_AUTHENTICATED));
    }
    expect(authenticationService.logout).not.toHaveBeenCalled();
    const notLoggedIn = setUp(false);
    await notLoggedIn.fail('/api/gallery/content/', unauthorized(ErrorCodes.NOT_AUTHENTICATED));
    expect(notLoggedIn.authenticationService.logout).not.toHaveBeenCalled();
  });

  it('checks an active share once when concurrent requests fail and shows the ended-link page', async () => {
    const {authenticationService, navigationService, shareService, fail} = setUp(true);
    shareService.isSharing.mockReturnValue(true);
    await Promise.all([fail('/api/gallery/content/?sk=key', unauthorized(ErrorCodes.NOT_AUTHENTICATED_SHARING)),
      fail('/api/search/query?sk=key', unauthorized(ErrorCodes.NOT_AUTHENTICATED_SHARING))]);
    expect(shareService.reloadPublicSharing).toHaveBeenCalledOnce();
    expect(navigationService.toShareProblem).toHaveBeenCalledWith(false);
    expect(authenticationService.logout).toHaveBeenCalledWith(ErrorCodes.NOT_AUTHENTICATED_SHARING);
  });

  it('keeps the valid share login flow and distinguishes a transient public-info failure', async () => {
    const valid = setUp(true);
    valid.shareService.isSharing.mockReturnValue(true);
    valid.shareService.reloadPublicSharing.mockResolvedValue({sharingKey: 'key'});
    await valid.fail('/api/gallery/content/?sk=key', unauthorized(ErrorCodes.NOT_AUTHENTICATED_SHARING));
    expect(valid.authenticationService.logout).toHaveBeenCalledOnce();
    expect(valid.navigationService.toShareProblem).not.toHaveBeenCalled();

    const retry = setUp(true);
    retry.shareService.isSharing.mockReturnValue(true);
    retry.shareService.sharingIsValid.next(null);
    await retry.fail('/api/gallery/content/?sk=key', unauthorized(ErrorCodes.NOT_AUTHENTICATED_SHARING));
    expect(retry.navigationService.toShareProblem).toHaveBeenCalledWith(true);
    expect(retry.authenticationService.logout).not.toHaveBeenCalled();
  });
  // #1305: NOT_AUTHORISED answers 403, so the 401 logout no longer covers it
  it('logs out on NOT_AUTHORISED (an illegal move or a failed CSRF check)', async () => {
    const {authenticationService, fail} = setUp(true);
    await fail('/api/admin/settings', forbidden(ErrorCodes.NOT_AUTHORISED));
    expect(authenticationService.logout).toHaveBeenCalledWith(ErrorCodes.NOT_AUTHORISED);
  });

  it('does not log out on other 403 errors', async () => {
    const {authenticationService, fail} = setUp(true);
    await fail('/api/upload/x', forbidden(ErrorCodes.PERMISSION_DENIED));
    expect(authenticationService.logout).not.toHaveBeenCalled();
  });

  it('keeps the logout loop guard on NOT_AUTHORISED too', async () => {
    const {authenticationService, fail} = setUp(true);
    for (const url of ['/api/user/me', '/api/user/login', '/api/share/key/login', '/api/user/logout', '/api/share/key/publicInfo']) {
      await fail(url, forbidden(ErrorCodes.NOT_AUTHORISED));
    }
    expect(authenticationService.logout).not.toHaveBeenCalled();
    const notLoggedIn = setUp(false);
    await notLoggedIn.fail('/api/admin/settings', forbidden(ErrorCodes.NOT_AUTHORISED));
    expect(notLoggedIn.authenticationService.logout).not.toHaveBeenCalled();
  });

  // a wrong password: the guest of a password protected sharing has to stay on its login page
  it('does not log out on a wrong password', async () => {
    const {authenticationService, fail} = setUp(true);
    await fail('/api/gallery/content/', unauthorized(ErrorCodes.CREDENTIAL_NOT_FOUND));
    expect(authenticationService.logout).not.toHaveBeenCalled();
  });

});
