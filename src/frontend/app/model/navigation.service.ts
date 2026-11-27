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
  // the query param of the login page with the url to open after the login (#1306)
  public static readonly RETURN_URL = 'returnUrl';
  constructor(
    private router: Router,
    private shareService: ShareService,
    private authenticationService: AuthenticationService,
    private location: Location
  ) {
  }

  public isLoginPage(): boolean {
    return (
      // with or without the url to return to
      this.router.isActive('login',
        {paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions) ||
      this.router.isActive('shareLogin',
        {paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions)
    );
  }


  public isErrorPage(): boolean {
    return (
      this.router.routerState.snapshot.root.firstChild?.data['notFound'] === true ||
      this.router.isActive(NavigationService.shareProblemPath,
        {paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions) ||
      this.router.isActive('error',
        {paths: 'exact', queryParams: 'exact', fragment: 'ignored', matrixParams: 'ignored'} as IsActiveMatchOptions)
    );
  }

  /**
   * Whether the app has shown a page yet. The first navigation can still be on its way (e.g. waiting for a guard).
   */
  public hasNavigated(): boolean {
    return this.router.lastSuccessfulNavigation() !== null;
  }

  /**
   * The url of the page that is shown, relative to the app (without Server.urlBase).
   */
  public url(): string {
    return this.router.url;
  }

  /**
   * Only a page of this app: a path, never another site, and not a login or error page.
   * The router keeps it inside the app anyway; this also keeps odd urls out of the login page's address.
   */
  public static isReturnUrl(url: unknown): url is string {
    return typeof url === 'string' &&
      url.length <= 2048 &&
      // no control characters and no backslash: browsers read '/\host' as another site
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      !/[\u0000-\u001f\u007f\\]/.test(url) &&
      // a path of this app, not '//host'; not an encoded slash or backslash either
      /^\/(?![/]|%2f|%5c)/i.test(url) &&
      // not a login or error page ('/' redirects to the login page too)
      !new RegExp('^/(login|shareLogin|error|' + NavigationService.shareProblemPath + ')?([?#/;]|$)', 'i').test(url);
  }

  /**
   * @param returnUrl the url of this app to open after the login (e.g. the deep link that was opened, or where the session ended)
   */
  public async toLogin(returnUrl?: string): Promise<boolean> {
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
      if (NavigationService.isReturnUrl(returnUrl)) {
        return this.router.navigate(['login'], {queryParams: {[NavigationService.RETURN_URL]: returnUrl}});
      }
      return this.router.navigate(['login']);
    }
  }

  /**
   * Opens the url that the login page was opened for (#1306), or the default page.
   * An OIDC login leaves the app for the provider, so the url waits in the session storage (see rememberReturnUrl).
   */
  public toAfterLogin(): Promise<boolean> {
    // the login page and the app both ask for it after a login: one navigation, the stored url is taken only once
    this.afterLogin ??= this.navigateAfterLogin().finally(() => {
      this.afterLogin = null;
    });
    return this.afterLogin;
  }

  private afterLogin: Promise<boolean> = null;

  private async navigateAfterLogin(): Promise<boolean> {
    const stored = NavigationService.takeRememberedReturnUrl();
    await this.shareService.wait();
    if (!this.shareService.isSharing()) {
      const returnUrl: unknown = this.router.parseUrl(this.router.url).queryParams[NavigationService.RETURN_URL];
      for (const url of [returnUrl, stored]) {
        if (NavigationService.isReturnUrl(url)) {
          return this.router.navigateByUrl(url, {replaceUrl: true});
        }
      }
    }
    return this.toDefault();
  }

  private static readonly RETURN_URL_STORAGE_KEY = 'pigallery2-returnUrl';
  // an abandoned OIDC login does not send a later login to its page
  private static readonly RETURN_URL_STORAGE_TTL_MS = 10 * 60 * 1000;

  /**
   * Keeps the returnUrl of the login page while the browser visits the OIDC provider.
   */
  public rememberReturnUrl(): void {
    const returnUrl: unknown = this.router.parseUrl(this.router.url).queryParams[NavigationService.RETURN_URL];
    try {
      if (NavigationService.isReturnUrl(returnUrl)) {
        sessionStorage.setItem(NavigationService.RETURN_URL_STORAGE_KEY, JSON.stringify({url: returnUrl, at: Date.now()}));
      } else {
        sessionStorage.removeItem(NavigationService.RETURN_URL_STORAGE_KEY);
      }
    } catch {
      // no session storage (e.g. blocked): the login opens the default page
    }
  }

  private static takeRememberedReturnUrl(): string | null {
    try {
      const raw = sessionStorage.getItem(NavigationService.RETURN_URL_STORAGE_KEY);
      sessionStorage.removeItem(NavigationService.RETURN_URL_STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      if (stored && typeof stored.at === 'number' &&
        Date.now() - stored.at >= 0 && Date.now() - stored.at < NavigationService.RETURN_URL_STORAGE_TTL_MS &&
        NavigationService.isReturnUrl(stored.url)) {
        return stored.url;
      }
    } catch {
      // not readable: the default page
    }
    return null;
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
