import {Location} from '@angular/common';
import {Component} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter, Router} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {BehaviorSubject} from 'rxjs';
import {NavigationService} from '../../navigation.service';
import {ShareService} from '../../../ui/gallery/share.service';
import {AuthenticationService} from '../authentication.service';
import {AuthGuard} from './auth.guard';
import {ShareGuard} from './share.guard';

@Component({template: ''})
class Placeholder {}

describe('ShareGuard', () => {
  let sharing: {wait: () => Promise<void>; sharingIsValid: BehaviorSubject<boolean>; getPublicSharing: ReturnType<typeof vi.fn>};
  let authentication: {
    user: BehaviorSubject<{usedSharingKey: string}>;
    isAuthenticated: ReturnType<typeof vi.fn>;
    getSessionUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sharing = {
      wait: () => Promise.resolve(),
      getPublicSharing: vi.fn().mockResolvedValue(null),
      sharingIsValid: new BehaviorSubject(false),
      ...{getSharingKey: () => 'key'},
    };
    authentication = {
      user: new BehaviorSubject(null),
      isAuthenticated: vi.fn().mockReturnValue(false),
      getSessionUser: vi.fn().mockResolvedValue(null),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {path: 'share/:sharingKey', component: Placeholder, canActivate: [ShareGuard]},
          {path: 'shareLogin', component: Placeholder, canActivate: [ShareGuard]},
          {path: NavigationService.shareProblemPath, component: Placeholder},
        ]),
        NavigationService,
        {provide: ShareService, useValue: sharing},
        {provide: AuthenticationService, useValue: authentication},
        {provide: AuthGuard, useValue: {canActivate: () => true}},
      ],
    });
  });

  it('shows the invalid-link page without rewriting the visible share URL', async () => {
    await RouterTestingHarness.create('/share/key?play=true');
    expect(TestBed.inject(Router).url).toBe('/invalidSharing');
    expect(TestBed.inject(Location).path()).toBe('/share/key?play=true');
  });

  it('offers a retry after a transient failure', async () => {
    sharing.sharingIsValid.next(null);
    await RouterTestingHarness.create('/share/key');
    expect(TestBed.inject(Router).url).toBe('/invalidSharing?retry=1');
    expect(TestBed.inject(Location).path()).toBe('/share/key');
  });

  it('keeps the shared entry URL through the password prompt', async () => {
    sharing.getPublicSharing.mockResolvedValue({passwordProtected: true});
    await RouterTestingHarness.create('/share/key?play=true');
    expect(TestBed.inject(Router).url).toBe('/shareLogin?play=true&sk=key');
    expect(TestBed.inject(Location).path()).toBe('/share/key?play=true');
  });

  it('restores a passwordless guest session and opens the link at the same URL', async () => {
    sharing.getPublicSharing.mockResolvedValue({passwordProtected: false});
    authentication.getSessionUser.mockResolvedValue({usedSharingKey: 'key'});
    await RouterTestingHarness.create('/share/key');
    expect(TestBed.inject(Router).url).toBe('/share/key');
  });

  it('checks the new share when the guest still has an earlier share session', async () => {
    sharing.getPublicSharing.mockResolvedValue({passwordProtected: true});
    authentication.isAuthenticated.mockReturnValue(true);
    authentication.user.next({usedSharingKey: 'different'});
    await RouterTestingHarness.create('/share/key');
    expect(authentication.getSessionUser).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).url).toBe('/shareLogin?sk=key');
  });
});
