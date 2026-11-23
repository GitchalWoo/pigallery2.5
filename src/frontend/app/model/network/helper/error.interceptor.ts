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

  intercept(
    request: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    return next.handle(request).pipe(
      catchError((err) => {
        if (
          err.status === 401 &&
          this.authenticationService.isAuthenticated() &&
          !request.url.includes('/user/me') &&
          !request.url.includes('/login') &&
          !request.url.includes('/logout') &&
          !request.url.includes('/publicInfo')
        ) {
          const code = err.error?.error?.code;
          if (code === ErrorCodes.NOT_AUTHENTICATED_SHARING && this.shareService.isSharing()) {
            this.shareRecovery ??= this.recoverShare().catch(console.error).finally(() => {
              this.shareRecovery = null;
            });
          } else {
            this.authenticationService.logout(code).catch(console.error);
          }
        }
        if (err.status === 500 && err.error?.error?.code === ErrorCodes.INTERNAL) {
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
