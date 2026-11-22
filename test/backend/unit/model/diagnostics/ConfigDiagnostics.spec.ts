import {expect} from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
});
