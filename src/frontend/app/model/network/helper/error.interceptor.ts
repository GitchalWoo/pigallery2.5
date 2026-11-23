import {Injectable} from '@angular/core';
import {type HttpEvent, HttpHandler, type HttpInterceptor, HttpRequest} from '@angular/common/http';
import {Observable, throwError} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {AuthenticationService} from '../authentication.service';
import {NavigationService} from '../../navigation.service';
import {ErrorCodes} from '../../../../../common/entities/Error';
import {ShareService} from '../../../ui/gallery/share.service';


@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  private shareRecovery: Promise<void> = null;

  constructor(private authenticationService: AuthenticationService,
              private navigationService: NavigationService,
              private shareService: ShareService) {
  }

  /**
   * Only a logged-in user is logged out, and never by the requests of the login itself:
   * logout() asks /user/me for the sharing session, so logging out on their error would loop.
   */
  private canLogOut(request: HttpRequest<unknown>): boolean {
    return this.authenticationService.isAuthenticated() &&
      !request.url.includes('/user/me') &&
      !request.url.includes('/login') &&
      !request.url.includes('/logout') &&
      !request.url.includes('/publicInfo');
  }

  intercept(
    request: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    return next.handle(request).pipe(
      catchError((err) => {
        // err.error is not an object when the response body is not JSON (e.g. a proxy error page)
        const code = err.error?.error?.code;
        // Not on a wrong password: the guest of a password protected sharing has to stay on its login page.
        if (err.status === 401 && code !== ErrorCodes.CREDENTIAL_NOT_FOUND && this.canLogOut(request)) {
          if (code === ErrorCodes.NOT_AUTHENTICATED_SHARING && this.shareService.isSharing()) {
            this.shareRecovery ??= this.recoverShare().catch(console.error).finally(() => {
              this.shareRecovery = null;
            });
          } else {
            // the session ended (e.g. it expired or the user was deleted)
            this.authenticationService.logout(code).catch(console.error);
          }
        }
        // an illegal move (e.g. a normal user calls the admin API or fails the CSRF check): log out
        if (err.status === 403 && code === ErrorCodes.NOT_AUTHORISED && this.canLogOut(request)) {
          this.authenticationService.logout(code).catch(console.error);
        }
        if (err.status === 500 && code === ErrorCodes.INTERNAL) {
          // Unknown server error
          this.navigationService.toError();
        }

        const error = err.error?.error || err.error?.message || err.statusText;
        return throwError(error);
      })
    );
  }

  private async recoverShare(): Promise<void> {
    const key = this.shareService.getSharingKey();
    const info = await this.shareService.reloadPublicSharing();
    if (this.shareService.getSharingKey() !== key) {
      return;
    }
    if (info) {
      await this.authenticationService.logout(ErrorCodes.NOT_AUTHENTICATED_SHARING);
    } else {
      const retry = this.shareService.sharingIsValid.value !== false;
      await this.navigationService.toShareProblem(retry);
      if (!retry) {
        await this.authenticationService.logout(ErrorCodes.NOT_AUTHENTICATED_SHARING);
      }
    }
  }
}
