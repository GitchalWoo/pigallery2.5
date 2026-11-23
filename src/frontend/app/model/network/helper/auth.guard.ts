import {Injectable} from '@angular/core';
import {ActivatedRouteSnapshot, type CanActivate, RouterStateSnapshot} from '@angular/router';
import {AuthenticationService} from '../authentication.service';
import {NavigationService} from '../../navigation.service';

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
