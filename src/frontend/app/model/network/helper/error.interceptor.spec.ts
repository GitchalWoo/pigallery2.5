import {HttpErrorResponse, HttpRequest} from '@angular/common/http';
import {firstValueFrom, throwError} from 'rxjs';
import {ErrorInterceptor} from './error.interceptor';
import {ErrorCodes} from '../../../../../common/entities/Error';

describe('ErrorInterceptor', () => {
  const setUp = (authenticated: boolean) => {
    const authenticationService = {isAuthenticated: () => authenticated, logout: vi.fn().mockResolvedValue(undefined)};
    const navigationService = {toError: vi.fn()};
    const interceptor = new ErrorInterceptor(authenticationService as any, navigationService as any);
    const fail = async (url: string, error: HttpErrorResponse) => {
      const next = {handle: () => throwError(() => error)};
      await firstValueFrom(interceptor.intercept(new HttpRequest('GET', url), next as any)).catch((): void => undefined);
    };
    return {authenticationService, fail};
  };
  const unauthorized = (code?: ErrorCodes) =>
    new HttpErrorResponse({status: 401, error: code === undefined ? null : {error: {code, message: 'Not authenticated'}}});

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
    for (const url of ['/api/user/me', '/api/user/login', '/api/user/logout']) {
      await fail(url, unauthorized(ErrorCodes.NOT_AUTHENTICATED));
    }
    expect(authenticationService.logout).not.toHaveBeenCalled();
    const notLoggedIn = setUp(false);
    await notLoggedIn.fail('/api/gallery/content/', unauthorized(ErrorCodes.NOT_AUTHENTICATED));
    expect(notLoggedIn.authenticationService.logout).not.toHaveBeenCalled();
  });
});
