import {BehaviorSubject} from 'rxjs';
import {ToastrService} from 'ngx-toastr';
import {NotificationService} from './notification.service';
import {NetworkService} from './network/network.service';
import {AuthenticationService} from './network/authentication.service';
import {type UserDTO, UserRoles} from '../../../common/entities/UserDTO';
import {NotificationType} from '../../../common/entities/NotificationDTO';

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

  it('publishes the total once server notifications arrive, including grouped repeats', async () => {
    let complete: (notifications: unknown) => void;
    const pending = new Promise(resolve => { complete = resolve; });
    const {service, user, info} = setUp(vi.fn().mockReturnValue(pending));
    const counts: number[] = [];
    const subscription = service.numberOfNotifications.subscribe(count => counts.push(count));
    user.next({id: 1, name: 'admin', role: UserRoles.Admin});
    expect(counts).toEqual([0]);

    const notification = {type: NotificationType.info, message: 'Index ready'};
    complete([notification, notification]);
    await pending;
    expect(counts).toEqual([0, 2]);
    expect(service.countedNotifications).toEqual([{...notification, count: 2}]);
    expect(info).toHaveBeenCalledOnce();
    subscription.unsubscribe();
  });

  it('titles a server notification with its message and shows its details one sentence per line', async () => {
    const getJson = vi.fn().mockResolvedValue([
      {type: NotificationType.warning, message: 'Images folder error', details: 'Error: Folder missing. Check the settings.'},
    ]);
    const user = new BehaviorSubject<UserDTO>(null);
    const warning = vi.fn();
    const service = new NotificationService(
      {warning} as unknown as ToastrService,
      {getJson} as unknown as NetworkService,
      {user, isAuthenticated: () => user.value !== null} as unknown as AuthenticationService
    );
    await service.getServerNotifications();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Folder missing.\nCheck the settings.', '(1) Images folder error',
      expect.anything());
  });

  it('keeps a notification without details in the scrollable toast body', async () => {
    const getJson = vi.fn().mockResolvedValue([{type: NotificationType.info, message: 'Index ready'}]);
    const user = new BehaviorSubject<UserDTO>(null);
    const info = vi.fn();
    const service = new NotificationService(
      {info} as unknown as ToastrService,
      {getJson} as unknown as NetworkService,
      {user, isAuthenticated: () => user.value !== null} as unknown as AuthenticationService
    );
    await service.getServerNotifications();
    expect(info).toHaveBeenCalledExactlyOnceWith('(1) Index ready', null, expect.anything());
  });

  it('formats object details as indented JSON', () => {
    expect(NotificationService.formatDetails({code: 1})).toBe('{\n  "code": 1\n}');
  });
});
