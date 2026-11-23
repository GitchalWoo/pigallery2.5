import {type ActivatedRoute, type Router} from '@angular/router';
import {type CookieService} from 'ngx-cookie-service';
import {NEVER} from 'rxjs';
import {Config} from '../../../common/config/public/Config';
import {type MediaDTO} from '../../../common/entities/MediaDTO';
import {type PersonDTO} from '../../../common/entities/PersonDTO';
import {type ResponseSharingDTO} from '../../../common/entities/SharingDTO';
import {QueryParams} from '../../../common/QueryParams';
import {NetworkService} from '../model/network/network.service';
import {Person} from './faces/Person';
import {GridMedia} from './gallery/grid/GridMedia';
import {PhotoFrameBuilderGalleryComponent} from './gallery/photo-frame-builder/photo-frame-builder.gallery.component';
import {RandomQueryBuilderGalleryComponent} from './gallery/random-query-builder/random-query-builder.gallery.component';
import {ShareService} from './gallery/share.service';
import {LanguageComponent} from './language/language.component';
import {LoginComponent} from './login/login.component';

describe('Application URLs under a reverse proxy', () => {
  const server = Config.Server;
  let original: Pick<typeof server, 'apiPath' | 'urlBase' | 'publicUrl' | 'languages'>;

  beforeEach(() => {
    const {apiPath, urlBase, publicUrl, languages} = server;
    original = {apiPath, urlBase, publicUrl, languages};
    Object.assign(server, {
      apiPath: '/api', urlBase: ' /photos/family/ ',
      publicUrl: 'https://gallery.example/', languages: ['en']
    });
  });

  afterEach(() => Object.assign(server, original));

  it('prefixes the OIDC entry link, API requests, and language navigation', () => {
    expect(new LoginComponent(null, null).oidcLoginUrl).toBe('/photos/family/api/auth/oidc/login');
    expect(new NetworkService(null, null, null, null).apiBaseUrl).toBe('/photos/family/api');
    const language = new LanguageComponent({get: (): null => null} as unknown as CookieService);
    expect(language.getLanguageUrl('en')).toBe('/photos/family/en');

    server.urlBase = '/';
    expect(new LoginComponent(null, null).oidcLoginUrl).toBe('/api/auth/oidc/login');
    expect(language.getLanguageUrl('en')).toBe('/en');
  });

  it('generates a public share URL with one copy of the prefix', () => {
    const sharing = new ShareService(null, {events: NEVER} as unknown as Router);
    for (const url of ['https://gallery.example/', 'https://gallery.example/photos/family/']) {
      server.publicUrl = url;
      expect(sharing.getUrl({sharingKey: 'test-key'} as ResponseSharingDTO))
        .toBe('https://gallery.example/photos/family/share/test-key');
    }
  });

  it('prefixes a random link and encodes the search query once', () => {
    const random = new RandomQueryBuilderGalleryComponent(null, null, null, null);
    random.onQueryChange();
    expect(random.url).toBe('https://gallery.example/photos/family/api/gallery/random/' +
      encodeURIComponent(random.HTMLSearchQuery));
  });

  it('prefixes a photo frame link and keeps the existing router query and fragment', () => {
    const frame = new PhotoFrameBuilderGalleryComponent(null, null,
      {queryParams: NEVER} as unknown as ActivatedRoute, {url: '/gallery/trips?sk=my-key#photo'} as Router, null, null);
    frame.onOptionsChange();
    const url = new URL(frame.url);
    expect(url.origin + url.pathname).toBe('https://gallery.example/photos/family/gallery/trips');
    expect(url.searchParams.get('sk')).toBe('my-key');
    expect(url.searchParams.get(QueryParams.gallery.lightbox.playback)).toBe('true');
    expect(url.hash).toBe('#photo');
    frame.ngOnDestroy();
  });

  it('prefixes media and person URLs while keeping escaped names and preview sizes', () => {
    const media = new GridMedia({
      name: 'img #1.jpg', directory: {path: '/', name: 'test'}, metadata: {size: {width: 4000, height: 3000}},
      liveVideoPath: 'test/clip #1.mov'
    } as MediaDTO, 540, 360, 0);
    const prefix = '/photos/family/api/gallery/content/test/';
    expect(media.getOriginalMediaPath()).toBe(prefix + 'img%20%231.jpg');
    expect(media.getIconPath()).toBe(prefix + 'img%20%231.jpg/icon');
    expect(media.getBestSizedMediaPath(540, 360)).toBe(prefix + 'img%20%231.jpg/540');
    vi.spyOn(media, 'getReplacementThumbnailSize').mockReturnValue(320);
    expect(media.getReplacementThumbnailPath()).toBe(prefix + 'img%20%231.jpg/320');
    expect(media.getLiveVideoPath()).toBe(prefix + 'clip%20%231.mov/bestFit');
    expect(Person.getThumbnailUrl({name: 'A/B'} as PersonDTO)).toBe('/photos/family/api/person/A%2FB/thumbnail');
  });
});
