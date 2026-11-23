import {type UserDTO, UserRoles} from '../../../../../common/entities/UserDTO';
import {type AuthenticationService} from '../../../model/network/authentication.service';
import {type NetworkService} from '../../../model/network/network.service';
import {type NotificationService} from '../../../model/notification.service';
import {UsersComponent} from './users.component';
import {UsersSettingsService} from './users.service';

describe('UsersComponent OIDC unlink', () => {
  it('unlinks eligible accounts and refreshes the list', async () => {
    const current = {id: 1, name: 'manager', role: UserRoles.Admin};
    const linked = {id: 2, name: 'linked', role: UserRoles.User, oidcIssuer: 'https://provider.example', oidcSubject: '123'};
    const remaining = {id: 2, name: 'linked', role: UserRoles.User};
    const network = {deleteJson: vi.fn().mockResolvedValue(undefined), getJson: vi.fn().mockResolvedValue([remaining])};
    const service = new UsersSettingsService(network as unknown as NetworkService);
    const auth = {user: {value: current}} as unknown as AuthenticationService;
    const component = new UsersComponent(auth, null, service, null, null);

    expect(component.canUnlinkOidc(linked)).toBe(true);
    for (const blocked of [remaining, {...linked, id: current.id, name: current.name}, {...linked, role: UserRoles.Developer}]) {
      expect(component.canUnlinkOidc(blocked)).toBe(false);
      await component.unlinkOidc(blocked);
    }
    expect(network.deleteJson).not.toHaveBeenCalled();

    await component.unlinkOidc(linked);
    expect(network.deleteJson).toHaveBeenCalledWith('/user/2/oidc');
    expect(component.users).toEqual([remaining]);
  });

  it('shows an error when unlinking fails', async () => {
    const user: UserDTO = {id: 2, name: 'linked', role: UserRoles.User, oidcSubject: '123'};
    const auth = {user: {value: {id: 1, name: 'manager', role: UserRoles.Admin}}} as unknown as AuthenticationService;
    const service = {unlinkOidc: vi.fn().mockRejectedValue(new Error('Failed'))} as unknown as UsersSettingsService;
    const notification = {error: vi.fn()};
    const component = new UsersComponent(auth, null, service, null, notification as unknown as NotificationService);
    await component.unlinkOidc(user);
    expect(notification.error).toHaveBeenCalledWith('Could not unlink OIDC identity');
  });
});
