import {BehaviorSubject} from 'rxjs';
import {NavigationService} from './navigation.service';
import {Config} from '../../../common/config/public/Config';
import {type NavigationLinkConfig, NavigationLinkTypes} from '../../../common/config/public/ClientConfig';
import {SearchQueryTypes, type TextSearch} from '../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';
import {UserRoles} from '../../../common/entities/UserDTO';

describe('NavigationService.toDefault', () => {
  let originalLinks: NavigationLinkConfig[];
  let originalSearchEnabled: boolean;

  beforeEach(() => {
    originalLinks = Config.Gallery.NavBar.links;
    originalSearchEnabled = Config.Search.enabled;
    Config.Search.enabled = true;
  });

  afterEach(() => {
    Config.Gallery.NavBar.links = originalLinks;
    Config.Search.enabled = originalSearchEnabled;
  });

  const setUp = () => {
    const router = {navigate: vi.fn().mockResolvedValue(true)};
    const shareService = {wait: () => Promise.resolve(), isSharing: () => false};
    const authenticationService = {user: new BehaviorSubject({name: 'u', role: UserRoles.User})};
    const service = new NavigationService(router as any, shareService as any, authenticationService as any, null);
    return {router, service};
  };

  it('opens a search link with the shortened query', async () => {
    const query = {type: SearchQueryTypes.any_text, value: 'sunset'} as TextSearch;
    Config.Gallery.NavBar.links = [{type: NavigationLinkTypes.search, SearchQuery: query} as NavigationLinkConfig];
    const {router, service} = setUp();
    await service.toDefault();
    expect(router.navigate).toHaveBeenCalledWith(['search', SearchQueryUtils.urlify(query)]);
  });

  // #1176: a search link without a query navigated to ['search', undefined] and broke routing
  it('skips a search link without a query', async () => {
    Config.Gallery.NavBar.links = [
      {type: NavigationLinkTypes.search} as NavigationLinkConfig,
      {type: NavigationLinkTypes.albums} as NavigationLinkConfig
    ];
    const originalAlbum = Config.Album.enabled;
    Config.Album.enabled = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const {router, service} = setUp();
      await service.toDefault();
      expect(router.navigate).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith(['albums']);
    } finally {
      Config.Album.enabled = originalAlbum;
    }
  });

  it('falls back to the gallery when only a search link without a query is left', async () => {
    Config.Gallery.NavBar.links = [{type: NavigationLinkTypes.search} as NavigationLinkConfig];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {router, service} = setUp();
    await service.toDefault();
    expect(router.navigate).toHaveBeenCalledWith(['gallery', '']);
  });
});
