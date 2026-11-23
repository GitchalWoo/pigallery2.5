import {Injectable} from '@angular/core';

import {type IsActiveMatchOptions, type NavigationBehaviorOptions, RedirectCommand, Router} from '@angular/router';
import {Location} from '@angular/common';
import {ShareService} from '../ui/gallery/share.service';
import {Config} from '../../../common/config/public/Config';
import {NavigationLinkTypes} from '../../../common/config/public/ClientConfig';
import {AuthenticationService} from './network/authentication.service';
import {UserRoles} from '../../../common/entities/UserDTO';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';

@Injectable()
export class NavigationService {
  public static readonly shareProblemPath = 'invalidSharing';
  constructor(
    private router: Router,
    private shareService: ShareService,
    private authenticationService: AuthenticationService,
    private location: Location
  ) {
  }

  public isLoginPage(): boolean {
    return (
      this.router.isActive('login',
        {paths: 'exact', queryParams: 'exact', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions) ||
      this.router.isActive('shareLogin',
        {paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions)
    );
  }


  public isErrorPage(): boolean {
    return (
      this.router.isActive(NavigationService.shareProblemPath,
        {paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions) ||
      this.router.isActive('error',
        {paths: 'exact', queryParams: 'exact', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions)
    );
  }

  public async toLogin(): Promise<boolean> {
    await this.shareService.wait();
    if (this.shareService.isSharing()) {
      const sharing = await this.shareService.getPublicSharing();
      if (!sharing) {
        return this.toShareProblem(this.shareService.sharingIsValid.value !== false);
      }
      if (sharing.passwordProtected) {
        const redirect = this.shareLoginRedirect(this.router.url);
        return this.router.navigateByUrl(redirect.redirectTo, redirect.navigationBehaviorOptions);
      }
      return this.toShareProblem(true);
    } else {
      return this.router.navigate(['login']);
    }
  }

  public async toDefault(): Promise<boolean> {
    await this.shareService.wait();
    if (this.shareService.isSharing()) {
      const queryParams = this.isLoginPage() ? {...this.router.parseUrl(this.router.url).queryParams} : {};
      delete queryParams.sk;
      return this.router.navigate(['/share', this.shareService.getSharingKey()], {queryParams, replaceUrl: this.isLoginPage()});
    } else {
      const user = this.authenticationService.user.value;
      const role = user?.role ?? (Config.Users.authenticationRequired
        ? UserRoles.LimitedGuest
        : Config.Users.unAuthenticatedUserRole);
      const links = Config.Gallery.NavBar.links || [];
      for (const link of links) {
        const available = (() => {
          switch (link.type) {
            case NavigationLinkTypes.gallery:
              return role >= UserRoles.User;
            case NavigationLinkTypes.albums:
              return Config.Album.enabled && role >= Config.Album.readAccessMinRole;
            case NavigationLinkTypes.faces:
              return Config.Faces.enabled && role >= Config.Faces.readAccessMinRole;
            case NavigationLinkTypes.search:
              return Config.Search.enabled && role >= UserRoles.Guest;
            case NavigationLinkTypes.timeline:
              return Config.Timeline.enabled &&
                !user?.usedSharingKey &&
                role >= Config.Timeline.readAccessMinRole;
            default:
              return false;
          }
        })();
        if (!available) {
          continue;
        }
        switch (link.type) {
          case NavigationLinkTypes.gallery:
            return this.router.navigate(['gallery', '']);
          case NavigationLinkTypes.albums:
            return this.router.navigate(['albums']);
          case NavigationLinkTypes.faces:
            return this.router.navigate(['faces']);
          case NavigationLinkTypes.search:
            // a search link without a query has nowhere to go, try the next link
            if (link.SearchQuery) {
              return this.router.navigate(['search', SearchQueryUtils.urlify(link.SearchQuery)]);
            }
            console.error('Navbar search link has no query, skipping it.');
            continue;
          case NavigationLinkTypes.timeline:
            return this.router.navigate(['timeline']);
          default:
            break;
        }
      }

      return this.router.navigate(['gallery', '']);
    }
  }

  public async toGallery(): Promise<boolean> {
    await this.shareService.wait();
    if (this.shareService.isSharing()) {
      return this.router.navigate(['share', this.shareService.getSharingKey()]);
    } else {
      return this.router.navigate(['gallery', '']);
    }
  }

  public async search(searchText: string): Promise<boolean> {
    return this.router.navigate(['search', searchText]);
  }

  public async toError(): Promise<boolean> {
    return this.router.navigate(['error']);
  }

  public shareLoginRedirect(from: string): RedirectCommand {
    const url = this.router.parseUrl(from);
    return new RedirectCommand(
      this.router.createUrlTree(['/shareLogin'], {queryParams: {...url.queryParams, sk: this.shareService.getSharingKey()}}),
      this.keepShareAddress(from)
    );
  }

  public shareProblemRedirect(retry: boolean, from: string): RedirectCommand {
    return new RedirectCommand(
      this.router.createUrlTree(['/' + NavigationService.shareProblemPath], {queryParams: retry ? {retry: '1'} : {}}),
      this.keepShareAddress(from)
    );
  }

  public toShareProblem(retry: boolean): Promise<boolean> {
    const redirect = this.shareProblemRedirect(retry, this.router.url);
    return this.router.navigateByUrl(redirect.redirectTo, redirect.navigationBehaviorOptions);
  }

  private shareAddress(from: string): string {
    const url = this.router.parseUrl(from);
    const key = this.shareService.getSharingKey();
    if (from.startsWith('/share/') ||
      (url.queryParams.sk === key && key && /^\/(?:gallery|search)(?:[/?]|$)/.test(from))) {
      return from;
    }
    const queryParams = {...url.queryParams};
    delete queryParams.sk;
    return this.router.serializeUrl(this.router.createUrlTree(['/share', key], {queryParams}));
  }

  private keepShareAddress(from: string): NavigationBehaviorOptions {
    const browserUrl = this.shareAddress(from);
    // An alias records the internal route in browser history. When the share URL is already
    // visible, skip writing history so reload starts from the share URL and validates it again.
    return this.location.path(true) === browserUrl ? {skipLocationChange: true} : {browserUrl, replaceUrl: true};
  }
}
