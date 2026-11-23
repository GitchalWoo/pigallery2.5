import {Injectable} from '@angular/core';
import {ActivatedRouteSnapshot, type CanActivate, RouterStateSnapshot} from '@angular/router';
import {ToastrService} from 'ngx-toastr';
import {AuthenticationService} from '../authentication.service';
import {NavigationService} from '../../navigation.service';
import {UserRoles} from '../../../../../common/entities/UserDTO';

@Injectable({providedIn: 'root'})
export class AuthGuard implements CanActivate{
  constructor(
      private authenticationService: AuthenticationService,
      private navigationService: NavigationService
  ) {
  }

  canActivate(
      route: ActivatedRouteSnapshot,
      state: RouterStateSnapshot
  ): boolean {
    if (this.authenticationService.isAuthenticated() === true) {
      return true;
    }

    // the login takes the user to the page they opened (e.g. a deep link)
    this.navigationService.toLogin(state.url).catch(console.error);
    return false;
  }
}

/**
 * A visitor logs in first; a logged-in user who is not an admin gets their default page with a warning (#1315).
 */
@Injectable({providedIn: 'root'})
export class AdminGuard implements CanActivate {
  constructor(
      private authGuard: AuthGuard,
      private authenticationService: AuthenticationService,
      private navigationService: NavigationService,
      private toastr: ToastrService
  ) {
  }

  canActivate(
      route: ActivatedRouteSnapshot,
      state: RouterStateSnapshot
  ): boolean {
    if (!this.authGuard.canActivate(route, state)) {
      return false;
    }
    if (this.authenticationService.isAuthorized(UserRoles.Admin)) {
      return true;
    }
    this.toastr.warning($localize`Only admins can open the admin page.`, '', {positionClass: 'toast-top-center'});
    // the gallery for a user; a guest can't list folders, so their default page
    this.navigationService.toDefault().catch(console.error);
    return false;
  }
}
