import {inject, TestBed} from '@angular/core/testing';
import {UserService} from './user.service';
import {UserDTO} from '../../../../common/entities/UserDTO';
import {LoginCredential} from '../../../../common/entities/LoginCredential';
import {AuthenticationService} from './authentication.service';
import {NetworkService} from './network.service';
import {ErrorCodes, ErrorDTO} from '../../../../common/entities/Error';
import {VersionService} from '../version.service';
import {ShareService} from '../../ui/gallery/share.service';
import {NavigationService} from '../navigation.service';

class MockUserService {
  public login(credential: LoginCredential): Promise<UserDTO> {
    return Promise.resolve({name: 'testUserName'} as UserDTO);
  }

  public async getSessionUser(): Promise<UserDTO> {
    return null;
  }
}

class MockNetworkService {
  handlers: ((error: ErrorDTO) => boolean)[] = [];

  addGlobalErrorHandler(fn: (error: ErrorDTO) => boolean): void {
    this.handlers.push(fn);
  }
}

class MockShareService {
  onNewUser(user: any): void {
    // mock fn
  }

  wait(): Promise<void> {
    return Promise.resolve();
  }
}

class MockNavigationService {
  toError(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('AuthenticationService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        VersionService,
        {provide: NetworkService, useClass: MockNetworkService},
        {provide: UserService, useClass: MockUserService},
        {provide: ShareService, useClass: MockShareService},
        {provide: NavigationService, useClass: MockNavigationService},
        AuthenticationService,
      ],
    });
  });

  it('should call UserDTO service login', inject(
      [AuthenticationService, UserService],
      async (authService: AuthenticationService, userService: UserService) => {
        vi.spyOn(userService, 'login');

        expect(userService.login).not.toHaveBeenCalled();
        await authService.login(null);
        expect(userService.login).toHaveBeenCalled();
      }
  ));

  it('should have NO Authenticated use', inject(
      [AuthenticationService],
      (authService: AuthenticationService) => {
        expect(authService.user.value).toBe(null);
        expect(authService.isAuthenticated()).toBe(false);
      }
  ));

  it('should have Authenticated use', async () => {
    const authService = TestBed.inject(AuthenticationService);
    vi.spyOn(authService.user, 'next');
    await new Promise<void>((resolve) => {
      authService.user.subscribe((user) => {
        if (user == null) {
          return;
        }
        expect(authService.user.next).toHaveBeenCalled();
        expect(authService.user.value).not.toBe(null);
        expect(authService.isAuthenticated()).toBe(true);
        resolve();
      });
      authService.login({} as any);
    });
  });
  // #1305: NOT_AUTHORISED answers 403 and the error interceptor logs out (keeping its loop guard), not this handler
  it('should leave the logout on NOT_AUTHORISED to the error interceptor', () => {
    const authService = TestBed.inject(AuthenticationService);
    const network = TestBed.inject(NetworkService) as unknown as MockNetworkService;
    const logout = vi.spyOn(authService, 'logout');
    expect(network.handlers.some(h => h({code: ErrorCodes.NOT_AUTHORISED} as ErrorDTO))).toBe(true);
    expect(logout).not.toHaveBeenCalled();
  });
});
