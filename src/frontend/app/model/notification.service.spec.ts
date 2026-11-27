import {BehaviorSubject} from 'rxjs';
import {ToastrService} from 'ngx-toastr';
import {NotificationService} from './notification.service';
import {NetworkService} from './network/network.service';
import {AuthenticationService} from './network/authentication.service';
import {type UserDTO, UserRoles} from '../../../common/entities/UserDTO';

describe('NotificationService', () => {
  const setUp = (getJson = vi.fn()) => {
    const user = new BehaviorSubject<UserDTO>(null);
    const info = vi.fn();
    const service = new NotificationService(
      {info} as unknown as ToastrService,
      {getJson} as unknown as NetworkService,
      {user, isAuthenticated: () => user.value !== null} as unknown as AuthenticationService
    );
    return {info, service, user};
  };

  it('can be closed using a button while the user scrolls or selects message text', () => {
    const {info, service} = setUp();
    service.info('Long message', 'Server info');
    expect(info).toHaveBeenCalledExactlyOnceWith('Long message', 'Server info', expect.objectContaining({
      closeButton: true,
      tapToDismiss: false,
    }));
  });
});
