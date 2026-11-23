import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {APP_BASE_HREF, Location, LocationStrategy, PathLocationStrategy} from '@angular/common';
import {provideRouter, Router} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {NavigationService} from './navigation.service';
import {ShareService} from '../ui/gallery/share.service';
import {AuthenticationService} from './network/authentication.service';

@Component({template: ''})
class PageComponent {
}

// #1306: the login takes the user back to the deep link they opened, only inside the app
describe('NavigationService return url', () => {
  let router: Router;
  let service: NavigationService;
  let sharing: boolean;

  beforeEach(() => {
    sharing = false;
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        // a nested Server.urlBase (behind a proxy prefix)
        {provide: APP_BASE_HREF, useValue: '/a/b/'},
        {provide: LocationStrategy, useClass: PathLocationStrategy},
        provideRouter([
          {path: 'login', component: PageComponent},
          {path: '**', component: PageComponent},
        ]),
        NavigationService,
        {provide: ShareService, useValue: {wait: () => Promise.resolve(), isSharing: () => sharing, getSharingKey: () => 'key'}},
        {provide: AuthenticationService, useValue: {user: new BehaviorSubject(null)}},
      ]
    });
    router = TestBed.inject(Router);
    service = TestBed.inject(NavigationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  // the address in the browser: the url of the app under Server.urlBase
  const browserPath = (): string => {
    const location = TestBed.inject(Location);
    return location.prepareExternalUrl(location.path());
  };

  const loginWith = (returnUrl: string): Promise<boolean> =>
    router.navigateByUrl(router.createUrlTree(['/login'], {queryParams: {returnUrl}}));

  it('accepts only paths of the app', () => {
    for (const url of ['/gallery/a/b', '/gallery/%C3%A9t%C3%A9?x=1#f', '/search/sunset', '/admin', '/albums', '/timeline?at=2024-05']) {
      expect(NavigationService.isReturnUrl(url), url).toBe(true);
    }
    for (const url of [undefined, null, 42, '', 'gallery', 'https://evil.example/', '//evil.example', '///evil.example',
      '/\\evil.example', '\\\\evil.example', '/%2fevil.example', '/%2F%2Fevil.example', '/%5cevil.example',
      'javascript:alert(1)', '/gallery/\u0000x', '/gallery\n//evil', '/', '/login', '/login?returnUrl=/admin',
      '/shareLogin?sk=key', '/LOGIN', '/error', '/invalidSharing?retry=1', '/' + 'a'.repeat(2048)]) {
      expect(NavigationService.isReturnUrl(url), String(url)).toBe(false);
    }
  });

  it('puts the deep link on the login page under the url base', async () => {
    await service.toLogin('/gallery/deep/folder?p=1');
    expect(router.url).toBe('/login?returnUrl=%2Fgallery%2Fdeep%2Ffolder%3Fp%3D1');
    expect(browserPath()).toBe('/a/b/login?returnUrl=%2Fgallery%2Fdeep%2Ffolder%3Fp%3D1');
  });

  it('opens the plain login page for a url that is not a page of the app', async () => {
    await service.toLogin('//evil.example/x');
    expect(router.url).toBe('/login');
  });

  it('goes back to the deep link after the login, under the url base', async () => {
    await loginWith('/gallery/deep/folder?p=1');
    await service.toAfterLogin();
    expect(router.url).toBe('/gallery/deep/folder?p=1');
    expect(browserPath()).toBe('/a/b/gallery/deep/folder?p=1');
  });

  it('opens the default page instead of another site', async () => {
    const toDefault = vi.spyOn(service, 'toDefault').mockResolvedValue(true);
    for (const url of ['//evil.example', '/\\evil.example', 'https://evil.example', '/login']) {
      await loginWith(url);
      await service.toAfterLogin();
      expect(toDefault).toHaveBeenCalled();
      expect(router.url.startsWith('/login')).toBe(true);
      toDefault.mockClear();
    }
  });

  it('leaves a sharing to its own pages', async () => {
    sharing = true;
    const toDefault = vi.spyOn(service, 'toDefault').mockResolvedValue(true);
    await loginWith('/gallery/x');
    await service.toAfterLogin();
    expect(toDefault).toHaveBeenCalled();
  });

  describe('OIDC login', () => {
    it('keeps the deep link while the browser visits the provider', async () => {
      await loginWith('/albums');
      service.rememberReturnUrl();
      // the provider sends the browser back to the app root, without the query param
      await router.navigateByUrl('/login');
      await service.toAfterLogin();
      expect(router.url).toBe('/albums');
      expect(sessionStorage.length).toBe(0);
    });

    // the login page and the app component both call it after the OIDC callback
    it('opens the stored deep link when it is asked for twice at once', async () => {
      await loginWith('/albums');
      service.rememberReturnUrl();
      await router.navigateByUrl('/login');
      const toDefault = vi.spyOn(service, 'toDefault');
      await Promise.all([service.toAfterLogin(), service.toAfterLogin()]);
      expect(toDefault).not.toHaveBeenCalled();
      expect(router.url).toBe('/albums');
    });

    it('prefers the returnUrl of the login page and uses a stored url once', async () => {
      await loginWith('/albums');
      service.rememberReturnUrl();
      await loginWith('/faces');
      await service.toAfterLogin();
      expect(router.url).toBe('/faces');
      // taken by the login above
      const toDefault = vi.spyOn(service, 'toDefault').mockResolvedValue(true);
      await router.navigateByUrl('/login');
      await service.toAfterLogin();
      expect(toDefault).toHaveBeenCalled();
    });

    it('forgets the url of an abandoned OIDC login', async () => {
      const now = Date.now();
      const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
      await loginWith('/albums');
      service.rememberReturnUrl();
      dateNow.mockReturnValue(now + 10 * 60 * 1000);
      const toDefault = vi.spyOn(service, 'toDefault').mockResolvedValue(true);
      await router.navigateByUrl('/login');
      await service.toAfterLogin();
      expect(toDefault).toHaveBeenCalled();
    });

    it('ignores a stored url that is not a page of the app', async () => {
      sessionStorage.setItem('pigallery2-returnUrl', JSON.stringify({url: '//evil.example', at: Date.now()}));
      const toDefault = vi.spyOn(service, 'toDefault').mockResolvedValue(true);
      await router.navigateByUrl('/login');
      await service.toAfterLogin();
      expect(toDefault).toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
    });

    it('stores nothing without a returnUrl', async () => {
      sessionStorage.setItem('pigallery2-returnUrl', JSON.stringify({url: '/albums', at: Date.now()}));
      await router.navigateByUrl('/login');
      service.rememberReturnUrl();
      expect(sessionStorage.length).toBe(0);
    });
  });
});
