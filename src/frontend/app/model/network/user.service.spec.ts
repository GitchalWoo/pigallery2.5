import {inject, TestBed} from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {NetworkService} from './network.service';
import {UserService} from './user.service';
import {LoginCredential} from '../../../../common/entities/LoginCredential';
import {LoadingBarService} from '../loading-bar.service';
import {ShareService} from '../../ui/gallery/share.service';
import {VersionService} from '../version.service';
import { provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';

class MockShareService {
  wait(): Promise<boolean> {
    return Promise.resolve(true);
  }

  isSharing(): boolean {
    return false;
  }
}

describe('UserService', (): void => {
  beforeEach((): void => {
    TestBed.configureTestingModule({
    imports: [],
    providers: [
        VersionService,
        UserService,
        LoadingBarService,
        NetworkService,
        { provide: ShareService, useClass: MockShareService },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
    ]
});
  });

  it('should call postJson at login', inject(
      [UserService, NetworkService],
      async (
          userService: UserService,
          networkService: NetworkService
      ): Promise<void> => {
        vi.spyOn(networkService, 'postJson').mockResolvedValue(null as any);
        const credential = new LoginCredential('name', 'pass');
        await userService.login(credential);
        expect(networkService.postJson).toHaveBeenCalledWith(
          '/user/login',
          {loginCredential: credential}
        );
      }
  ));

  it('should call getJson at getSessionUser', inject(
      [UserService, NetworkService],
      async (
          userService: UserService,
          networkService: NetworkService
      ): Promise<void> => {
        vi.spyOn(networkService, 'getJson').mockResolvedValue(null as any);
        await userService.getSessionUser();
        expect(networkService.getJson).toHaveBeenCalledWith('/user/me');
      }
  ));
});

