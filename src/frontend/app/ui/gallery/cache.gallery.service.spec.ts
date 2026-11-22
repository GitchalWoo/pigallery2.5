import {BehaviorSubject} from 'rxjs';
import {type UserDTO, UserRoles} from '../../../../common/entities/UserDTO';
import {type PackedContentWrapperWithError} from '../../../../common/entities/ContentWrapper';
import {ThemeModes} from '../../../../common/config/public/ClientConfig';
import {GalleryCacheService} from './cache.gallery.service';

describe('GalleryCacheService media ownership', () => {
  const admin = {id: 1, name: 'admin', role: UserRoles.Admin, projectionKey: 'projection'};
  const directory = {directory: {name: 'photos', path: ''}} as PackedContentWrapperWithError;
  const setup = () => {
    const user = new BehaviorSubject<UserDTO | null>(null);
    const getSharingKey = vi.fn().mockReturnValue(null);
    const cache = new GalleryCacheService(
      {version: new BehaviorSubject(null)} as any, {user} as any, {getSharingKey} as any
    );
    return {cache, user, getSharingKey};
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('preserves media for the same account and projection across login and reload', () => {
    const first = setup();
    first.user.next(admin);
    first.cache.setDirectory(directory);
    first.user.next(null);
    expect(first.cache.getDirectory('photos')).toBeNull();

    const second = setup();
    second.user.next({...admin});
    expect(second.cache.getDirectory('photos')).toEqual(directory);
  });

  it('clears directory entries when entering a share or changing projection and keeps preferences', () => {
    const {cache, user, getSharingKey} = setup();
    user.next(admin);
    cache.setDirectory(directory);
    cache.setThemeMode(ThemeModes.dark);
    getSharingKey.mockReturnValue('share');
    expect(cache.getDirectory('photos')).toBeNull();

    user.next({id: 0, name: 'Guest', role: UserRoles.LimitedGuest, usedSharingKey: 'share'});
    expect(cache.getDirectory('photos').directory).toBeUndefined();
    cache.setDirectory(directory);
    user.next({...user.value, projectionKey: 'changed'});
    expect(cache.getDirectory('photos').directory).toBeUndefined();
    expect(localStorage.getItem('THEME_MODE')).toBe(ThemeModes[ThemeModes.dark]);
  });

  it('ignores a late write from another tab using a former owner’s cache key', () => {
    const {cache, user} = setup();
    user.next(admin);
    cache.setDirectory(directory);
    const oldKey = Object.keys(localStorage).find(key => key.startsWith('CONTENT:'));
    const oldValue = localStorage.getItem(oldKey);
    user.next({id: 2, name: 'reader', role: UserRoles.User});
    localStorage.setItem(oldKey, oldValue);
    expect(cache.getDirectory('photos').directory).toBeUndefined();
  });
});
