import {BehaviorSubject} from 'rxjs';
import {ErrorCodes} from '../../../../common/entities/Error';
import {ShareLoginComponent} from './share-login.component';

describe('ShareLoginComponent', () => {
  const setup = (valid: boolean) => {
    const sharing = {
      getSharingKey: () => 'new',
      reloadPublicSharing: vi.fn().mockResolvedValue(valid ? {sharingKey: 'new'} : null),
      sharingIsValid: new BehaviorSubject(valid),
    };
    const auth = {user: new BehaviorSubject({usedSharingKey: 'previous'}), isAuthenticated: () => true,
      shareLogin: vi.fn().mockRejectedValue({code: ErrorCodes.CREDENTIAL_NOT_FOUND})};
    const navigation = {toGallery: vi.fn(), toShareProblem: vi.fn().mockResolvedValue(true)};
    const component = new ShareLoginComponent(sharing as any, auth as any, navigation as any);
    return {component, navigation};
  };

  it('keeps the password prompt when a previous share session is still shown by the client', () => {
    const {component, navigation} = setup(true);
    component.ngOnInit();
    expect(navigation.toGallery).not.toHaveBeenCalled();
  });

  it('reports a wrong password on a valid link and redirects for an expired link', async () => {
    const valid = setup(true);
    await valid.component.onLogin();
    expect(valid.component.loginError).toBe(true);
    expect(valid.navigation.toShareProblem).not.toHaveBeenCalled();
    const expired = setup(false);
    await expired.component.onLogin();
    expect(expired.component.loginError).toBe(false);
    expect(expired.navigation.toShareProblem).toHaveBeenCalledWith(false);
  });
});
