import {Injectable} from '@angular/core';
import {ActivatedRouteSnapshot, type CanActivate, RedirectCommand, RouterStateSnapshot} from '@angular/router';
import {QueryParams} from '../../../../../common/QueryParams';
import {NavigationService} from '../../navigation.service';
import {ShareService} from '../../../ui/gallery/share.service';
import {AuthenticationService} from '../authentication.service';
import {AuthGuard} from './auth.guard';

@Injectable({providedIn: 'root'})
export class ShareGuard implements CanActivate {
  constructor(
    private authGuard: AuthGuard,
    private authentication: AuthenticationService,
    private sharing: ShareService,
    private navigation: NavigationService
  ) {}

  async canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Promise<boolean | RedirectCommand> {
    const login = route.routeConfig?.path === 'shareLogin';
    const key = route.paramMap.get(QueryParams.gallery.sharingKey_params) ||
      route.queryParamMap.get(QueryParams.gallery.sharingKey_query);
    if (!key) {
      return login ? this.navigation.shareProblemRedirect(false, state.url) : this.authGuard.canActivate(route, state);
    }
    await this.sharing.wait();
    const info = await this.sharing.getPublicSharing();
    if (!info) {
      return this.navigation.shareProblemRedirect(this.sharing.sharingIsValid.value !== false, state.url);
    }
    if (login) {
      return true;
    }
    const previousKey = this.authentication.user.value?.usedSharingKey;
    const differentShare = previousKey && previousKey !== key;
    if (this.authentication.isAuthenticated() && !differentShare) {
      return true;
    }
    if (differentShare || !info.passwordProtected) {
      const user = await this.authentication.getSessionUser();
      if (user?.usedSharingKey === key) {
        return true;
      }
      if (!info.passwordProtected) {
        return this.navigation.shareProblemRedirect(true, state.url);
      }
    }
    return this.navigation.shareLoginRedirect(state.url);
  }
}
