import {expect} from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {ConfigDiagnostics} from '../../../../../src/backend/model/diagnostics/ConfigDiagnostics';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {ServerLogConfig} from '../../../../../src/common/config/private/PrivateConfig';
import {
  NavBarConfig,
  NavigationLinkConfig,
  NavigationLinkTypes
} from '../../../../../src/common/config/public/ClientConfig';
import {SearchQueryDTO, SearchQueryTypes, TextSearch} from '../../../../../src/common/entities/SearchQueryDTO';
import {TestHelper} from '../../../../TestHelper';
import {NotificationManager} from '../../../../../src/backend/model/NotifocationManager';
import {NotificationDTO} from '../../../../../src/common/entities/NotificationDTO';
import {PrivateConfigClass} from '../../../../../src/common/config/private/PrivateConfigClass';
import {Config} from '../../../../../src/common/config/private/Config';
import {SupportedFormats} from '../../../../../src/common/SupportedFormats';
import {MediaRendererInput, PhotoWorker} from '../../../../../src/backend/model/fileaccess/PhotoWorker';

declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;

describe('ConfigDiagnostics', () => {

  const validQuery = {type: SearchQueryTypes.any_text, value: 'cat'} as TextSearch;

  const navBar = (links: NavigationLinkConfig[]): NavBarConfig => {
    const nb = new NavBarConfig();
    nb.links = links;
    return nb;
  };

  describe('testNavigationLink', () => {

    it('should accept the built-in link types', () => {
      for (const t of [NavigationLinkTypes.gallery, NavigationLinkTypes.albums, NavigationLinkTypes.faces]) {
        expect(() => ConfigDiagnostics.testNavigationLink(new NavigationLinkConfig(t))).to.not.throw();
      }
    });

    it('should accept a search link with a query', () => {
      const link = new NavigationLinkConfig(NavigationLinkTypes.search, 'Cats', validQuery);
      expect(() => ConfigDiagnostics.testNavigationLink(link)).to.not.throw();
    });

    it('should reject a search link without a query (#1176)', () => {
      const link = new NavigationLinkConfig(NavigationLinkTypes.search, 'Cats');
      expect(() => ConfigDiagnostics.testNavigationLink(link)).to.throw(/without a search query/);
    });

    it('should reject a search link with an invalid query', () => {
      const link = new NavigationLinkConfig(NavigationLinkTypes.search, 'Cats', {} as SearchQueryDTO);
      expect(() => ConfigDiagnostics.testNavigationLink(link)).to.throw();
    });

    it('should reject an url link without an url', () => {
      expect(() => ConfigDiagnostics.testNavigationLink(new NavigationLinkConfig(NavigationLinkTypes.url, 'Home')))
        .to.throw(/without an url/);
      expect(() => ConfigDiagnostics.testNavigationLink(new NavigationLinkConfig(NavigationLinkTypes.url, 'Home', undefined, '  ')))
        .to.throw(/without an url/);
      expect(() => ConfigDiagnostics.testNavigationLink(new NavigationLinkConfig(NavigationLinkTypes.url, 'Home', undefined, 'github.com')))
        .to.not.throw();
    });

    it('should reject an unknown link type', () => {
      expect(() => ConfigDiagnostics.testNavigationLink({type: 99} as unknown as NavigationLinkConfig))
        .to.throw(/unknown type/);
      expect(() => ConfigDiagnostics.testNavigationLink(null)).to.throw(/unknown type/);
    });
  });

  describe('testNavBarConfig', () => {

    it('should accept the default navbar', async () => {
      await ConfigDiagnostics.testNavBarConfig(new NavBarConfig());
    });

    it('should name the invalid link', async () => {
      const nb = navBar([
        new NavigationLinkConfig(NavigationLinkTypes.gallery),
        new NavigationLinkConfig(NavigationLinkTypes.search),
      ]);
      let error: Error = null;
      try {
        await ConfigDiagnostics.testNavBarConfig(nb);
      } catch (e) {
        error = e;
      }
      expect(error).to.not.equal(null);
      expect(error.message).to.contain('NavBar link #2');
    });
  });

  describe('removeInvalidNavigationLinks', () => {

    it('should only drop the invalid links', () => {
      const nb = navBar([
        new NavigationLinkConfig(NavigationLinkTypes.search),
        new NavigationLinkConfig(NavigationLinkTypes.albums),
        new NavigationLinkConfig(NavigationLinkTypes.search, 'Cats', validQuery),
      ]);
      ConfigDiagnostics.removeInvalidNavigationLinks(nb);
      expect(nb.links.map(l => l.type)).to.deep.equal([NavigationLinkTypes.albums, NavigationLinkTypes.search]);
    });

    it('should restore the default links if none is valid (#1176)', () => {
      const nb = navBar([new NavigationLinkConfig(NavigationLinkTypes.search)]);
      ConfigDiagnostics.removeInvalidNavigationLinks(nb);
      expect(nb.links.map(l => l.type)).to.deep.equal(new NavBarConfig().links.map(l => l.type));
    });
  });

  describe('testLogConfig', () => {
    const dir = path.join(TestHelper.TMP_DIR, 'diag-log');
    const origDBFolder = ProjectPath.DBFolder;

    beforeEach(() => {
      fs.rmSync(dir, {recursive: true, force: true});
      fs.mkdirSync(dir, {recursive: true});
      ProjectPath.DBFolder = dir;
    });

    afterEach(() => {
      ProjectPath.DBFolder = origDBFolder;
      fs.rmSync(dir, {recursive: true, force: true});
    });

    it('should accept empty log file setting', async () => {
      const cfg = new ServerLogConfig();
      await ConfigDiagnostics.testLogConfig(cfg);
    });

    it('should accept a relative path inside the data folder', async () => {
      const cfg = new ServerLogConfig();
      cfg.file = path.join('logs', 'pigallery2.log');
      await ConfigDiagnostics.testLogConfig(cfg);
    });

    it('should reject a path escaping the data folder', async () => {
      const cfg = new ServerLogConfig();
      cfg.file = '../outside.log';
      let error: Error = null;
      try {
        await ConfigDiagnostics.testLogConfig(cfg);
      } catch (e) {
        error = e;
      }
      expect(error).to.not.equal(null);
      expect(error.message).to.match(/escape|inside/i);
    });

    it('should reject a path pointing to an existing directory', async () => {
      const subDir = path.join(dir, 'existing-dir');
      fs.mkdirSync(subDir, {recursive: true});
      const cfg = new ServerLogConfig();
      cfg.file = 'existing-dir';
      let error: Error = null;
      try {
        await ConfigDiagnostics.testLogConfig(cfg);
      } catch (e) {
        error = e;
      }
      expect(error).to.not.equal(null);
      expect(error.message).to.contain('directory');
    });
  });

  describe('warnDirectorySearchInMediaLists', () => {
    const configWith = (allowQuery: SearchQueryDTO, blockQuery: SearchQueryDTO): PrivateConfigClass =>
      ({Users: {allowQuery, blockQuery}} as unknown as PrivateConfigClass);
    const emptyQuery = {type: SearchQueryTypes.any_text, value: ''} as TextSearch;
    let saved: NotificationDTO[];

    beforeEach(() => {
      saved = NotificationManager.notifications;
      NotificationManager.notifications = [];
    });

    afterEach(() => {
      NotificationManager.notifications = saved;
    });

    it('warns when a media list hides folders with a directory search', () => {
      ConfigDiagnostics.warnDirectorySearchInMediaLists(configWith(emptyQuery, {
        type: SearchQueryTypes.OR,
        list: [validQuery, {type: SearchQueryTypes.directory, value: '/private'} as TextSearch]
      } as SearchQueryDTO));
      expect(NotificationManager.notifications.map(n => n.message)).to.have.length(1);
      expect(NotificationManager.notifications[0].message).to.contain('Users.blockQuery');
      expect(NotificationManager.notifications[0].message).to.contain('Users.blockDirectoryList');
    });

    it('does not warn for the default and non-directory media lists', () => {
      ConfigDiagnostics.warnDirectorySearchInMediaLists(configWith(emptyQuery, emptyQuery));
      ConfigDiagnostics.warnDirectorySearchInMediaLists(configWith(validQuery, {type: SearchQueryTypes.directory, value: ' '} as TextSearch));
      expect(NotificationManager.notifications).to.deep.equal([]);
    });
  });

  describe('removeUnsupportedPhotoExtensions', () => {
    let photoFormats: string[];
    let videoFormats: string[];
    let transcoded: string[];
    let render: typeof PhotoWorker.renderFromImage;

    beforeEach(() => {
      photoFormats = Config.Media.Photo.supportedFormats;
      videoFormats = Config.Media.Video.supportedFormats;
      transcoded = Config.Media.Video.supportedFormatsWithTranscoding;
      render = PhotoWorker.renderFromImage;
    });

    afterEach(() => {
      PhotoWorker.renderFromImage = render;
      Config.Media.Photo.supportedFormats = photoFormats;
      Config.Media.Video.supportedFormats = videoFormats;
      Config.Media.Video.supportedFormatsWithTranscoding = transcoded;
      SupportedFormats.init();
    });

    it('stops indexing a photo format that sharp cannot decode', async () => {
      Config.Media.Photo.supportedFormats = ['jpg', 'png', 'heic'];
      SupportedFormats.init();
      PhotoWorker.renderFromImage = (input: MediaRendererInput) =>
        input.mediaPath.endsWith('.heic') ? Promise.reject(new Error('no decoder')) : Promise.resolve();

      await ConfigDiagnostics.removeUnsupportedPhotoExtensions(Config.Media.Photo);

      expect(Config.Media.Photo.supportedFormats).to.deep.equal(['jpg', 'png']);
      expect(SupportedFormats.Photos).to.not.include('heic');
      expect(SupportedFormats.WithDots.Photos).to.not.include('.heic');
    });

    it('does not list the transcoded video formats twice after a re-init', () => {
      SupportedFormats.init();
      SupportedFormats.init();
      const expected = Config.Media.Video.supportedFormats.concat(Config.Media.Video.supportedFormatsWithTranscoding);
      expect(SupportedFormats.Videos).to.deep.equal(expected);
      expect(new Set(SupportedFormats.WithDots.Videos).size).to.equal(SupportedFormats.WithDots.Videos.length);
    });
  });

  describe('testImageFolder', () => {
    // in the OS temp folder: chmod has no effect on some file systems the repo may be on
    const dir = path.join(os.tmpdir(), 'pg-diag-images-' + process.pid);

    beforeEach(() => {
      fs.rmSync(dir, {recursive: true, force: true});
      fs.mkdirSync(dir, {recursive: true});
    });

    afterEach(() => {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, {recursive: true, force: true});
    });

    it('accepts a readable folder', async () => {
      await ConfigDiagnostics.testImageFolder(dir);
    });

    it('rejects a missing folder with an error', async () => {
      const err = await ConfigDiagnostics.testImageFolder(path.join(dir, 'missing')).then((): unknown => null, (e: unknown) => e);
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.contain('Images folder not exists');
    });

    it('waits for the read access check', async function() {
      if (process.getuid?.() === 0) {
        this.skip(); // root can read anything
      }
      fs.chmodSync(dir, 0o000);
      const err = await ConfigDiagnostics.testImageFolder(dir).then((): unknown => null, (e: unknown) => e);
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.contain('read access');
    });
  });
});
