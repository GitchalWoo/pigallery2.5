import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as chai from 'chai';
import {expect} from 'chai';
import {default as chaiHttp, request} from 'chai-http';
import AdmZip from 'adm-zip';
import {DBTestHelper} from '../../DBTestHelper';
import {TestHelper} from '../../../TestHelper';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {UserDTO, UserRoles} from '../../../../src/common/entities/UserDTO';
import {
  DirectorySearch,
  ORSearchQuery,
  SearchQueryDTO,
  SearchQueryTypes,
  TextSearch,
  TextSearchQueryMatchTypes
} from '../../../../src/common/entities/SearchQueryDTO';
import {AlbumBaseDTO} from '../../../../src/common/entities/album/AlbumBaseDTO';
import {Utils} from '../../../../src/common/Utils';
import {QueryParams} from '../../../../src/common/QueryParams';
import {CustomHeaders} from '../../../../src/common/CustomHeaders';
import {ErrorCodes} from '../../../../src/common/entities/Error';
import {SQLConnection} from '../../../../src/backend/model/database/SQLConnection';
import {SharingEntity} from '../../../../src/backend/model/database/enitites/SharingEntity';
import {RateLimiter} from '../../../../src/backend/middlewares/RateLimiter';
import {RouteTestingHelper} from './RouteTestingHelper';
import {VideoProcessing} from '../../../../src/backend/model/fileaccess/fileprocessing/VideoProcessing';

process.env['NODE_ENV'] = 'test';
chai.should();
chai.use(chaiHttp);

// to help WebStorm to handle the test cases
declare let describe: any;
declare const it: any;

/**
 * Hidden media never leaks (#1316): the same restricted user against every endpoint that returns media or data about it.
 *
 * The gallery has one visible photo and three kinds of hidden content:
 *  - secret.jpg: hidden by the user's media block list (its keyword); the only photo of the person 'Bambi'
 *  - 'private folder/': hidden by the user's directory block list, with a photo of 'Joe', a video and a gpx track
 * Every check first asks as an admin (no lists) and expects to see the hidden content, so a check can't pass by not
 * finding anything at all. Then it asks as the restricted user and expects to see none of it.
 * The same checks run for the guest of a sharing of 'shared folder/' (created by the admin): for the guest,
 * everything outside the shared folder is hidden, also visible.jpg.
 * The admin asks first, so the checks also cover the projected caches (one cache entry per projection).
 */
const tmpDescribe = describe;
describe = DBTestHelper.describe();

describe('Projection leak', (sqlHelper: DBTestHelper) => {
  describe = tmpDescribe;

  const assets = path.join(__dirname, '../../assets');
  const HIDDEN_DIR = 'private folder';
  const HIDDEN_KEYWORD = 'USA Road trip';
  const HIDDEN_ALBUM = 'album of Bambi';
  // what should never reach the restricted user
  const HIDDEN_FILES = ['secret.jpg', 'Portrait.jpg', 'video.mp4', 'track.gpx'];
  const HIDDEN = [...HIDDEN_FILES, HIDDEN_DIR, HIDDEN_KEYWORD, 'Bambi', 'Joe'];

  type TestUser = Omit<UserDTO, 'id'>;
  const admin: TestUser = {name: 'test-admin', password: 'test-admin', role: UserRoles.Admin};
  const restricted: TestUser = {
    name: 'restricted',
    password: 'restricted',
    role: UserRoles.User,
    overrideAllowBlockList: true,
    blockQuery: {type: SearchQueryTypes.keyword, value: HIDDEN_KEYWORD, matchType: TextSearchQueryMatchTypes.exact_match} as TextSearch,
    blockDirectoryList: [{type: SearchQueryTypes.directory, value: HIDDEN_DIR, matchType: TextSearchQueryMatchTypes.exact_match} as DirectorySearch]
  };
  // the allow list covers the hidden folder too, but the block list wins
  const allowAndBlock: TestUser = {
    name: 'allow-and-block',
    password: 'allow-and-block',
    role: UserRoles.User,
    overrideAllowBlockList: true,
    blockQuery: restricted.blockQuery,
    allowDirectoryList: [{type: SearchQueryTypes.directory, value: '*', matchType: TextSearchQueryMatchTypes.globMatch} as DirectorySearch],
    blockDirectoryList: restricted.blockDirectoryList
  };
  const SHARED_DIR = 'shared folder';
  // inside the shared folder, but the sharing does not include the subfolders
  const SHARED_SUB_DIR = 'shared sub';
  // the guest of a sharing of SHARED_DIR, without its subfolders; logs in with the password of the sharing (name: only the key of its agent)
  const sharingGuest: TestUser = {name: 'sharing guest', password: 'sharing-password', role: UserRoles.LimitedGuest};
  const restrictedGuest: TestUser = {...sharingGuest, name: 'preview-only guest'};

  // a query that matches every hidden media
  const hiddenQuery: ORSearchQuery = {
    type: SearchQueryTypes.OR,
    list: [
      {type: SearchQueryTypes.person, value: 'Bambi'} as TextSearch,
      {type: SearchQueryTypes.person, value: 'Joe'} as TextSearch,
      {type: SearchQueryTypes.directory, value: HIDDEN_DIR} as TextSearch,
    ]
  };
  const q = (query: SearchQueryDTO): string => encodeURIComponent(JSON.stringify(query));
  const hiddenDir = encodeURIComponent(HIDDEN_DIR);

  const createGallery = (folder: string): void => {
    fs.mkdirSync(path.join(folder, HIDDEN_DIR), {recursive: true});
    fs.mkdirSync(path.join(folder, SHARED_DIR), {recursive: true});
    fs.copyFileSync(path.join(assets, 'exiftool.jpg'), path.join(folder, 'visible.jpg'));
    fs.copyFileSync(path.join(assets, 'exiftool.jpg'), path.join(folder, SHARED_DIR, 'shared.jpg'));
    fs.copyFileSync(path.join(assets, 'video.mp4'), path.join(folder, SHARED_DIR, 'clip.mp4'));
    fs.writeFileSync(path.join(folder, SHARED_DIR, 'shared.gpx'), '<gpx version="1.1" creator="test"><trk><trkseg>' +
      '<trkpt lat="37.7" lon="-122.4"/><trkpt lat="34.0" lon="-118.2"/></trkseg></trk></gpx>');
    fs.mkdirSync(path.join(folder, SHARED_DIR, SHARED_SUB_DIR), {recursive: true});
    fs.copyFileSync(path.join(assets, 'exiftool.jpg'), path.join(folder, SHARED_DIR, SHARED_SUB_DIR, 'subfolder.jpg'));
    fs.copyFileSync(path.join(assets, 'edge_case_exif_data/before_epoch.jpg'), path.join(folder, 'secret.jpg'));
    fs.copyFileSync(path.join(assets, 'orientation/Portrait_1.jpg'), path.join(folder, HIDDEN_DIR, 'Portrait.jpg'));
    fs.copyFileSync(path.join(assets, 'video.mp4'), path.join(folder, HIDDEN_DIR, 'video.mp4'));
    fs.writeFileSync(path.join(folder, HIDDEN_DIR, 'track.gpx'),
      '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test"><trk><trkseg>' +
      '<trkpt lat="37.7" lon="-122.4"></trkpt><trkpt lat="34.0" lon="-118.2"></trkpt></trkseg></trk></gpx>');
  };

  let server: Server;
  const agents: Record<string, ReturnType<typeof request.agent>> = {};
  const csrfTokens: Record<string, string> = {};
  let sharingKey: string;
  const origConfig = {
    authenticationRequired: Config.Users.authenticationRequired,
    sharingEnabled: Config.Sharing.enabled,
    passwordRequired: Config.Sharing.passwordRequired,
    videoEnabled: Config.Media.Video.enabled,
    folder: Config.Media.folder,
    tempFolder: Config.Media.tempFolder
  };

  before(async () => {
    // every user logs in: stay below the login rate limit
    RateLimiter.reset();
    await sqlHelper.initDB();
    // initDB removes the tmp folder, so the gallery is created after it
    const folder = path.join(TestHelper.TMP_DIR, 'projection-gallery');
    createGallery(folder);
    Config.Users.authenticationRequired = true;
    Config.Sharing.enabled = true;
    Config.Media.Video.enabled = true;
    Config.Media.folder = folder;
    Config.Media.tempFolder = path.join(TestHelper.TMP_DIR, 'projection-temp');
    ProjectPath.reset();
    server = new Server(false);
    await server.onStarted.wait();

    const om = ObjectManagers.getInstance();
    await om.IndexingManager.indexDirectory('.', true);
    await om.IndexingManager.indexDirectory(HIDDEN_DIR, true);
    await om.IndexingManager.indexDirectory(SHARED_DIR, true);
    await om.IndexingManager.indexDirectory(path.join(SHARED_DIR, SHARED_SUB_DIR), true);
    await om.AlbumManager.addSavedSearch(HIDDEN_ALBUM, {type: SearchQueryTypes.person, value: 'Bambi'} as TextSearch);
    for (const user of [admin, restricted, allowAndBlock]) {
      await om.UserManager.createUser(Utils.clone(user) as UserDTO);
      const agent = request.agent(server.Server);
      const res = await agent.post(Config.Server.apiPath + '/user/login')
        .send({loginCredential: {username: user.name, password: user.password, rememberMe: false}});
      res.should.have.status(200);
      agents[user.name] = agent;
      csrfTokens[user.name] = RouteTestingHelper.getCsrfToken(res);
    }

    // the admin shares SHARED_DIR, the guest logs in to the sharing
    const sharing = await agents[admin.name].post(Config.Server.apiPath + '/share/')
      .set(CustomHeaders.csrfToken, csrfTokens[admin.name]).send({
      createSharing: {
        valid: 60 * 60 * 1000,
        password: sharingGuest.password,
        directoryQuery: {type: SearchQueryTypes.directory, value: SHARED_DIR, matchType: TextSearchQueryMatchTypes.exact_match}
      }
    });
    expect(sharing.body.error, 'creating the sharing').to.equal(null);
    sharingKey = sharing.body.result.sharingKey;
    const guestAgent = request.agent(server.Server);
    const guestLogin = await guestAgent.post(Config.Server.apiPath + '/share/login?' + QueryParams.gallery.sharingKey_query + '=' +
      sharing.body.result.sharingKey).send({password: sharingGuest.password});
    expect(guestLogin.body.error, 'guest login').to.equal(null);
    agents[sharingGuest.name] = guestAgent;
  });

  after(async () => {
    Object.values(agents).forEach(a => a.close());
    Config.Users.authenticationRequired = origConfig.authenticationRequired;
    Config.Sharing.enabled = origConfig.sharingEnabled;
    Config.Sharing.passwordRequired = origConfig.passwordRequired;
    Config.Media.Video.enabled = origConfig.videoEnabled;
    Config.Media.folder = origConfig.folder;
    Config.Media.tempFolder = origConfig.tempFolder;
    ProjectPath.reset();
    await sqlHelper.clearDB();
  });

  interface Response {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }

  const get = (user: TestUser, url: string): Promise<Response> =>
    agents[user.name].get(Config.Server.apiPath + url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }) as unknown as Promise<Response>;

  const json = (res: Response): { error: unknown, result: any } => {
    expect(res.headers['content-type'], 'JSON response').to.contain('application/json');
    return JSON.parse(res.body.toString('utf8'));
  };

  it('enforces the download policy on direct requests while allowing generated previews', async () => {
    const route = '/gallery/content/' + encodeURIComponent(SHARED_DIR);
    const photo = route + '/shared.jpg';
    const video = route + '/clip.mp4';
    const track = route + '/shared.gpx';
    const zip = '/gallery/zip/' + q({type: SearchQueryTypes.directory, value: SHARED_DIR} as TextSearch);
    const random = '/gallery/random/' + q({type: SearchQueryTypes.file_name, value: 'shared.jpg'} as TextSearch);
    const actor = agents[admin.name];
    const payload = {
      valid: 60 * 60 * 1000,
      password: restrictedGuest.password,
      directoryQuery: {type: SearchQueryTypes.directory, value: SHARED_DIR, matchType: TextSearchQueryMatchTypes.exact_match},
    };
    const create = await actor.post(Config.Server.apiPath + '/share/')
      .set(CustomHeaders.csrfToken, csrfTokens[admin.name]).send({createSharing: payload});
    expect(create.body.error).to.equal(null);
    const {id, sharingKey: key, preventDownload} = create.body.result;
    expect(preventDownload).to.equal(false);
    const agent = agents[restrictedGuest.name] = request.agent(server.Server);
    const login = () => agent.post(Config.Server.apiPath + '/share/login?sk=' + key).send({password: restrictedGuest.password});
    const update = (change: {preventDownload?: boolean}) => actor.put(Config.Server.apiPath + '/share/')
      .set(CustomHeaders.csrfToken, csrfTokens[admin.name]).send({updateSharing: {...payload, id, ...change}});

    expect((await login()).body.result.preventDownload).to.equal(false);
    const original = await get(restrictedGuest, photo);
    expect(original.status).to.equal(200);
    expect(original.headers['cache-control']).to.equal('private, no-store');
    expect((await get(restrictedGuest, zip)).headers['content-type']).to.include('application/zip');

    expect((await update({preventDownload: true})).body.result.preventDownload).to.equal(true);
    expect((await get(restrictedGuest, photo)).status).to.equal(401);
    expect((await login()).body.result.preventDownload).to.equal(true);
    for (const url of [photo, video, track, zip]) {
      const res = await get(restrictedGuest, url);
      expect(res.status, url).to.equal(403);
      expect(res.headers['cache-control']).to.equal('private, no-store');
      expect(json(res).error).to.have.property('code', ErrorCodes.PERMISSION_DENIED);
    }
    expect((await agent.head(Config.Server.apiPath + photo)).status).to.equal(403);
    expect((await agent.get(Config.Server.apiPath + video).set('Range', 'bytes=0-15')).status).to.equal(403);
    expect((await get(restrictedGuest, video + '/bestFit')).status).to.equal(403);
    const gpx = Config.MetaFile.GPXCompressing;
    const {enabled, onTheFly} = gpx;
    try {
      const originalTrack = await get(admin, track);
      expect(originalTrack.status).to.equal(200);
      gpx.enabled = false;
      expect((await get(restrictedGuest, track + '/bestFit')).status).to.equal(403);
      const fallback = await get(admin, track + '/bestFit?view=map');
      expect(fallback.status).to.equal(200);
      expect(fallback.headers).not.to.have.property('location');
      expect(fallback.headers['cache-control']).to.equal('private, no-store');
      expect(fallback.body.equals(originalTrack.body)).to.equal(true);

      gpx.enabled = true;
      gpx.onTheFly = false;
      expect((await get(restrictedGuest, track + '/bestFit')).status).to.equal(403);
      expect((await get(admin, track + '/bestFit')).body.equals(originalTrack.body)).to.equal(true);
      gpx.onTheFly = true;
      const compressed = await get(restrictedGuest, track + '/bestFit');
      expect(compressed.status).to.equal(200);
      expect(compressed.body.equals(originalTrack.body)).to.equal(false);
    } finally {
      gpx.enabled = enabled;
      gpx.onTheFly = onTheFly;
    }

    for (const url of [photo + '/icon', photo + '/' + Config.Media.Photo.thumbnailSizes[0], random]) {
      const preview = await get(restrictedGuest, url);
      expect(preview.status, url).to.equal(200);
      expect(preview.headers['content-type']).to.match(/^image\//);
      expect(preview.body.equals(original.body)).to.equal(false);
    }
    const converted = VideoProcessing.generateConvertedFilePath(path.join(ProjectPath.ImageFolder, SHARED_DIR, 'clip.mp4'));
    fs.mkdirSync(path.dirname(converted), {recursive: true});
    fs.writeFileSync(converted, 'converted video fixture');
    const partial = await agent.get(Config.Server.apiPath + video + '/bestFit').set('Range', 'bytes=0-8').buffer(true);
    expect(partial.status).to.equal(206);
    expect(partial.headers['content-range']).to.equal('bytes 0-8/23');

    expect((await get(admin, photo)).body.equals(original.body)).to.equal(true);
    expect((await update({})).body.result.preventDownload).to.equal(true);
    expect((await update({preventDownload: false})).body.result.preventDownload).to.equal(false);
    expect((await get(restrictedGuest, photo)).status).to.equal(401);
    expect((await login()).body.result.preventDownload).to.equal(false);
    expect((await get(restrictedGuest, photo)).status).to.equal(200);
  });

  it('uses the explicit share key when a guest already has a session for another share', async () => {
    const actor = agents[admin.name];
    const create = await actor.post(Config.Server.apiPath + '/share/')
      .set(CustomHeaders.csrfToken, csrfTokens[admin.name]).send({
        createSharing: {
          valid: 60_000,
          preventDownload: true,
          directoryQuery: {type: SearchQueryTypes.directory, value: SHARED_DIR, matchType: TextSearchQueryMatchTypes.exact_match}
        }
      });
    expect(create.body.error).to.equal(null);
    const key = create.body.result.sharingKey;
    const guest = request.agent(server.Server);
    agents['guest switching shares'] = guest;
    const login = await guest.post(Config.Server.apiPath + '/share/login?sk=' + sharingKey)
      .send({password: sharingGuest.password});
    expect(login.body.result.usedSharingKey).to.equal(sharingKey);
    const original = Config.Server.apiPath + '/gallery/content/' + encodeURIComponent(SHARED_DIR) + '/shared.jpg';
    expect((await guest.get(original)).status).to.equal(200);
    expect((await guest.get(original + '?sk=' + key)).status).to.equal(403);
    expect((await guest.get(Config.Server.apiPath + '/user/me')).body.result.usedSharingKey).to.equal(key);
    const protectedMedia = await guest.get(original + '?sk=' + sharingKey);
    expect(protectedMedia.status).to.equal(401);
    expect(protectedMedia.body.error.code).to.equal(ErrorCodes.NOT_AUTHENTICATED_SHARING);
    expect((await actor.get(original + '?sk=' + key)).status).to.equal(200);
  });

  /**
   * Returns the hidden names that the JSON result contains.
   * The echoed search query (e.g.: result.searchResult.searchQuery) is left out: it naturally contains what was searched for.
   */
  const hiddenInResult = (res: Response, hidden = HIDDEN): string[] => {
    const text = JSON.stringify(json(res).result ?? null, (key, value) => key === 'searchQuery' ? undefined : value);
    return hidden.filter(h => text.includes(h));
  };

  /**
   * A served file is a leak (the media itself); any error is fine, as long as it is not the file.
   */
  const servedFile = (res: Response): string[] =>
    res.status === 200 && !(res.headers['content-type'] || '').includes('application/json') ? ['the file'] : [];

  /**
   * Every check returns the hidden content it found in the response (empty: nothing leaked).
   */
  const checks: { name: string, leaks: (user: TestUser) => Promise<string[]> }[] = [
    {
      name: 'folder listing (root)',
      leaks: async (u) => hiddenInResult(await get(u, '/gallery/content/'))
    },
    {
      name: 'folder listing (blocked folder)',
      leaks: async (u) => hiddenInResult(await get(u, '/gallery/content/' + hiddenDir), ['Portrait.jpg', 'video.mp4', 'track.gpx', 'Joe'])
    },
    {
      name: 'search',
      leaks: async (u) => hiddenInResult(await get(u, '/search/' + q(hiddenQuery)))
    },
    ...['Bam', 'Jo', 'secr', 'Portr', 'USA R', 'priv'].map(text => ({
      name: 'autocomplete of "' + text + '"',
      leaks: async (u: TestUser) => hiddenInResult(await get(u, '/autocomplete/' + encodeURIComponent(text)))
    })),
    {
      name: 'faces',
      leaks: async (u) => hiddenInResult(await get(u, '/person'), ['Bambi', 'Joe'])
    },
    ...['Bambi', 'Joe'].map(name => ({
      name: 'face thumbnail of ' + name,
      leaks: async (u: TestUser) => servedFile(await get(u, '/person/' + name + '/thumbnail'))
    })),
    {
      name: 'albums (count and cover)',
      leaks: async (u) => {
        const albums = json(await get(u, '/albums')).result as AlbumBaseDTO[] | null;
        // refused (e.g.: a sharing guest has no albums)
        if (!albums) {
          return [];
        }
        const album = albums.find(a => a.name === HIDDEN_ALBUM);
        expect(album, 'the album itself is listed').to.not.be.undefined;
        return [
          ...(album!.cache?.itemCount ? ['item count: ' + album!.cache.itemCount] : []),
          ...(album!.cache?.cover ? ['cover: ' + album!.cache.cover.name] : []),
        ];
      }
    },
    {
      name: 'zip',
      leaks: async (u) => {
        const res = await get(u, '/gallery/zip/' + q(hiddenQuery));
        if (!(res.headers['content-type'] || '').includes('application/zip')) {
          return [];
        }
        return new AdmZip(res.body).getEntries().map(e => e.entryName);
      }
    },
    {
      name: 'random photo',
      leaks: async (u) => servedFile(await get(u, '/gallery/random/' + q(hiddenQuery)))
    },
    ...[
      'secret.jpg', 'secret.jpg/320', 'secret.jpg/icon',
      `${hiddenDir}/Portrait.jpg`, `${hiddenDir}/Portrait.jpg/320`, `${hiddenDir}/Portrait.jpg/icon`,
      `${hiddenDir}/video.mp4`, `${hiddenDir}/video.mp4/bestFit`, `${hiddenDir}/video.mp4/320`, `${hiddenDir}/video.mp4/icon`,
      `${hiddenDir}/track.gpx`, `${hiddenDir}/track.gpx/bestFit`,
    ].map(file => ({
      name: 'file ' + decodeURIComponent(file),
      leaks: async (u: TestUser) => servedFile(await get(u, '/gallery/content/' + file))
    })),
  ];

  for (const check of checks) {
    it(check.name + ': should hide the hidden media from the restricted user', async () => {
      expect(await check.leaks(admin), 'the admin sees the hidden media (the check works)').to.not.be.empty;
      expect(await check.leaks(restricted), 'what the restricted user sees').to.be.empty;
    });

    it(check.name + ': should hide the blocked media even if the allow list covers it', async () => {
      expect(await check.leaks(admin), 'the admin sees the hidden media (the check works)').to.not.be.empty;
      expect(await check.leaks(allowAndBlock), 'what the user with both lists sees').to.be.empty;
    });

    it(check.name + ': should hide the media outside the sharing from its guest', async () => {
      expect(await check.leaks(admin), 'the admin sees the hidden media (the check works)').to.not.be.empty;
      expect(await check.leaks(sharingGuest), 'what the sharing guest sees').to.be.empty;
    });
  }

  describe('sharing guest', () => {
    // so the checks above can't pass because the guest's session does not work
    it('should get the shared folder and its photo', async () => {
      const listing = await get(sharingGuest, '/gallery/content/' + encodeURIComponent(SHARED_DIR));
      expect(json(listing).error).to.equal(null);
      expect(hiddenInResult(listing, ['shared.jpg']), 'the photo of the shared folder').to.deep.equal(['shared.jpg']);
      const photo = await get(sharingGuest, '/gallery/content/' + encodeURIComponent(SHARED_DIR) + '/shared.jpg');
      expect(photo.status).to.equal(200);
      expect(photo.headers['content-type']).to.equal('image/jpeg');
    });

    // visible.jpg is visible to everybody else: the checks above don't cover it
    it('should not get the photo of the root folder, which is outside the sharing', async () => {
      for (const file of ['visible.jpg', 'visible.jpg/320', 'visible.jpg/icon']) {
        expect(servedFile(await get(sharingGuest, '/gallery/content/' + file)), file).to.be.empty;
      }
      const visibleQuery = {type: SearchQueryTypes.file_name, value: 'visible.jpg', matchType: TextSearchQueryMatchTypes.exact_match} as TextSearch;
      expect(hiddenInResult(await get(admin, '/search/' + q(visibleQuery)), ['visible.jpg']), 'the admin finds it').to.not.be.empty;
      expect(hiddenInResult(await get(sharingGuest, '/search/' + q(visibleQuery)), ['visible.jpg']), 'search').to.be.empty;
      expect(servedFile(await get(sharingGuest, '/gallery/random/' + q(visibleQuery))), 'random photo').to.be.empty;
      const zip = await get(sharingGuest, '/gallery/zip/' + q(visibleQuery));
      expect((zip.headers['content-type'] || '').includes('application/zip') ? new AdmZip(zip.body).getEntries().map(e => e.entryName) : [],
        'zip').to.be.empty;
    });

    it('should not get the subfolder of the shared folder (the sharing has no subfolders)', async () => {
      const sub = encodeURIComponent(SHARED_DIR) + '/' + encodeURIComponent(SHARED_SUB_DIR);
      expect(hiddenInResult(await get(admin, '/gallery/content/' + sub), ['subfolder.jpg']), 'the admin sees it').to.not.be.empty;
      const listing = json(await get(sharingGuest, '/gallery/content/' + sub));
      expect((listing.error as { code: number })?.code).to.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
      expect(hiddenInResult(await get(sharingGuest, '/gallery/content/' + encodeURIComponent(SHARED_DIR)), [SHARED_SUB_DIR]),
        'the subfolder in the listing of the shared folder').to.be.empty;
      expect(servedFile(await get(sharingGuest, '/gallery/content/' + sub + '/subfolder.jpg'))).to.be.empty;
    });

    it('should get the same answer for a hidden and a not existing folder', async () => {
      const hidden = await get(sharingGuest, '/gallery/content/' + hiddenDir);
      const missing = await get(sharingGuest, '/gallery/content/' + encodeURIComponent('not existing folder'));
      expect(hidden.status).to.equal(404);
      expect(missing.status).to.equal(hidden.status);
      expect(json(missing)).to.deep.equal(json(hidden));
      expect((json(hidden).error as { code: number }).code).to.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
    });

    it('should need the password of the sharing', async () => {
      const agent = request.agent(server.Server);
      // closing an agent stops the server: it is closed with the others in after()
      agents['wrong password'] = agent;
      const login = await agent.post(Config.Server.apiPath + '/share/login?' + QueryParams.gallery.sharingKey_query + '=' + sharingKey)
        .send({password: 'wrong password'});
      expect(login.body.error, 'login with a wrong password').to.not.equal(null);
      const listing = await agent.get(Config.Server.apiPath + '/gallery/content/' + encodeURIComponent(SHARED_DIR) +
        '?' + QueryParams.gallery.sharingKey_query + '=' + sharingKey);
      expect(listing.status).to.equal(401);
      expect(listing.body.error.code).to.equal(ErrorCodes.NOT_AUTHENTICATED_SHARING);
    });

    it('keeps a share key valid when its folder is renamed, without exposing the new location', async () => {
      const originalPath = path.join(ProjectPath.ImageFolder, SHARED_DIR);
      const movedPath = originalPath + ' renamed';
      fs.renameSync(originalPath, movedPath);
      try {
        const publicInfo = await get(sharingGuest, '/share/' + sharingKey + '/publicInfo');
        expect(publicInfo.status).to.equal(200);
        expect(json(publicInfo).result.sharingKey).to.equal(sharingKey);
        for (const directory of [SHARED_DIR, SHARED_DIR + ' renamed']) {
          const listing = await get(sharingGuest, '/gallery/content/' + encodeURIComponent(directory));
          expect(listing.status).to.equal(404);
          expect(json(listing).error).to.have.property('code', ErrorCodes.DIRECTORY_NOT_FOUND);
        }
      } finally {
        fs.renameSync(movedPath, originalPath);
      }
    });

    it('keeps a share key valid when its folder is removed, with a new login too', async () => {
      const originalPath = path.join(ProjectPath.ImageFolder, SHARED_DIR);
      const backup = path.join(TestHelper.TMP_DIR, 'removed shared folder');
      fs.cpSync(originalPath, backup, {recursive: true});
      fs.rmSync(originalPath, {recursive: true});
      const newGuest = request.agent(server.Server);
      // closing an agent stops the server: it is closed with the others in after()
      agents['after removal'] = newGuest;
      try {
        const publicInfo = await get(sharingGuest, '/share/' + sharingKey + '/publicInfo');
        expect(publicInfo.status).to.equal(200);
        expect(json(publicInfo).result.sharingKey).to.equal(sharingKey);
        const login = await newGuest.post(Config.Server.apiPath + '/share/login?' + QueryParams.gallery.sharingKey_query + '=' + sharingKey)
          .send({password: sharingGuest.password});
        expect(login.status).to.equal(200);
        for (const agent of [agents[sharingGuest.name], newGuest]) {
          expect((await agent.get(Config.Server.apiPath + '/user/me')).status).to.equal(200);
          const listing = await agent.get(Config.Server.apiPath + '/gallery/content/' + encodeURIComponent(SHARED_DIR));
          expect(listing.status).to.equal(404);
          expect(listing.body.error).to.have.property('code', ErrorCodes.DIRECTORY_NOT_FOUND);
        }
      } finally {
        fs.cpSync(backup, originalPath, {recursive: true});
        fs.rmSync(backup, {recursive: true, force: true});
      }
    });

    // keep it last: it ends the sharing
    it('should see nothing after the sharing expired', async () => {
      const conn = await SQLConnection.getConnection();
      await conn.getRepository(SharingEntity).update({sharingKey}, {expires: Date.now() - 1000});
      ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
      const invalid = await get(sharingGuest, '/share/unused-key/publicInfo');
      const expired = await get(sharingGuest, '/share/' + sharingKey + '/publicInfo');
      expect(expired.status).to.equal(404);
      expect(invalid.status).to.equal(expired.status);
      expect(json(expired)).to.deep.equal(json(invalid));
      expect(json(expired).error).to.have.property('code', ErrorCodes.SHARING_NOT_FOUND);
      const listing = await get(sharingGuest, '/gallery/content/' + encodeURIComponent(SHARED_DIR));
      expect(listing.status).to.equal(401);
      expect(hiddenInResult(listing, ['shared.jpg'])).to.be.empty;
      expect(servedFile(await get(sharingGuest, '/gallery/content/' + encodeURIComponent(SHARED_DIR) + '/shared.jpg'))).to.be.empty;
    });
  });
});
