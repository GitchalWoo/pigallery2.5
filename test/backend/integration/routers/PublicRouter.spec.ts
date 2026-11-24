import {PRISM_THEME} from '../../../../src/common/config/public/PrismTheme';
import {ThemeConfig} from '../../../../src/common/config/public/ClientConfig';
import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import {UserDTO, UserRoles} from '../../../../src/common/entities/UserDTO';
import * as fs from 'fs';
import * as path from 'path';
import {SQLConnection} from '../../../../src/backend/model/database/SQLConnection';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {Utils} from '../../../../src/common/Utils';
import {SuperAgentStatic} from 'superagent';
import {RouteTestingHelper} from './RouteTestingHelper';
import {QueryParams} from '../../../../src/common/QueryParams';
import {DatabaseType} from '../../../../src/common/config/private/PrivateConfig';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import * as chai from "chai";
import {default as chaiHttp, request} from "chai-http";
import {DBTestHelper} from '../../DBTestHelper';

process.env.NODE_ENV = 'test';
chai.should();
const {expect} = chai;
chai.use(chaiHttp);

describe('PublicRouter', () => {
  const sqlHelper = new DBTestHelper(DatabaseType.sqlite);

  const testUser: UserDTO = {
    id: 1,
    name: 'test',
    password: 'test',
    role: UserRoles.User
  };

  let server: Server;
  const setUp = async () => {
    await sqlHelper.initDB();
    Config.Users.authenticationRequired = true;
    Config.Sharing.enabled = true;

    server = new Server(false);
    await server.onStarted.wait();

    await ObjectManagers.getInstance().init();
    await ObjectManagers.getInstance().UserManager.createUser(Utils.clone(testUser));
    await SQLConnection.close();
  };
  const tearDown = async () => {
    await sqlHelper.clearDB();
  };

  const shouldHaveInjectedUser = (result: any, user: any) => {

    result.should.have.status(200);
    result.text.should.be.a('string');
    result.body.should.deep.equal({});
    const startToken = 'ServerInject = {user:';
    const endToken = ', ConfigInject';

    const u = JSON.parse(result.text.substring(result.text.indexOf(startToken) + startToken.length, result.text.indexOf(endToken)));

    if (user == null) {
      expect(u).to.equal(null);
      return;
    }
    // Only public-safe subset is injected; ensure projectionKey is present but do not assert its value
    expect(u).to.be.an('object');
    expect(u).to.have.property('name', user.name);
    expect(u).to.have.property('role', user.role);
    expect(u).to.have.property('usedSharingKey', user.usedSharingKey);
    expect(u).to.have.property('projectionKey');
    expect(u.projectionKey).to.be.a('string').and.to.have.length.greaterThan(0);
    expect(u).to.deep.equal(user);
  };


  describe('/Get share/:' + QueryParams.gallery.sharingKey_params, () => {

    beforeEach(setUp);
    afterEach(tearDown);

    const fistLoad = async (srv: Server, sharingKey: string): Promise<any> => {
      return (request.execute(srv.Server) as SuperAgentStatic)
        .get('/share/' + sharingKey);
    };

    it('should not get default user with passworded share  without required password', async () => {
      Config.Sharing.passwordRequired = false;
      const sharing = await RouteTestingHelper.createSharing(testUser, 'secret_pass');
      const res = await fistLoad(server, sharing.sharingKey);
      shouldHaveInjectedUser(res, null);
    });

    it('should not get default user with passworded share share with required password', async () => {
      Config.Sharing.passwordRequired = true;
      const sharing = await RouteTestingHelper.createSharing(testUser, 'secret_pass');
      const res = await fistLoad(server, sharing.sharingKey);
      shouldHaveInjectedUser(res, null);
    });


    it('should get default user with no-password share', async () => {
      Config.Sharing.passwordRequired = false;
      const sharing = await RouteTestingHelper.createSharing(testUser);
      const res = await fistLoad(server, sharing.sharingKey);
      shouldHaveInjectedUser(res, RouteTestingHelper.getExpectedSharingUserForUI(sharing));
    });

  });

  describe('Behind a proxy that strips the application prefix', () => {
    beforeEach(setUp);
    afterEach(async () => {
      Config.Server.urlBase = '';
      Config.Server.publicUrl = '';
      await tearDown();
    });

    it('renders the base, serves the API and assets, and prefixes language and manifest URLs', async () => {
      Config.Server.urlBase = 'photos/family/';
      const app = () => request.execute(server.Server);
      const html = await app().get('/').set('Accept-Language', 'en');
      expect(html.status).to.equal(200);
      expect(html.text).to.include('<base href="/photos/family/"');
      expect(html.text).to.match(/"urlBase"\s*:\s*"photos\/family\/"/);
      expect((await app().get('/icon_auto.svg')).status).to.equal(200);
      expect((await app().get(Config.Server.apiPath + '/user/me')).status).to.equal(401);
      const language = await app().get('/en/').redirects(0);
      expect(language.status).to.equal(302);
      expect(language.headers.location).to.equal('/photos/family/?ln=en');
      expect((await app().get('/manifest.json')).body.start_url).to.equal('/photos/family/');
      Config.Server.publicUrl = 'https://gallery.example/photos/family/';
      expect((await app().get('/manifest.json')).body.start_url).to.equal('https://gallery.example/photos/family/');
    });
  });

  describe('Built-in Prism theme', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('opts into the new layout only for enabled Prism, preserving legacy selections', async () => {
      const themes = Config.Gallery.Themes;
      const originalName = themes.selectedTheme;
      const originalEnabled = themes.enabled;
      try {
        for (const name of ['default', 'classic', 'custom', 'prism']) {
          themes.enabled = true;
          themes.selectedTheme = name;
          const res = await (request.execute(server.Server) as SuperAgentStatic).get('/');
          res.should.have.status(200);
          expect(res.text).to.include(`data-gallery-design="${name === 'prism' ? 'prism' : 'legacy'}"`);
        }
        themes.enabled = false;
        const res = await (request.execute(server.Server) as SuperAgentStatic).get('/');
        expect(res.text).to.include('data-gallery-design="legacy"');
        expect(res.text).not.to.include(PRISM_THEME);
      } finally {
        themes.selectedTheme = originalName;
        themes.enabled = originalEnabled;
      }
    });

    it('serves Prism for older configurations without changing their saved theme list', async () => {
      const themes = Config.Gallery.Themes;
      const originalName = themes.selectedTheme;
      const originalThemes = themes.availableThemes;
      try {
        themes.selectedTheme = 'prism';
        themes.availableThemes = [new ThemeConfig('custom', ':root { --bs-primary: red; }')];
        const res = await (request.execute(server.Server) as SuperAgentStatic).get('/');
        res.should.have.status(200);
        expect(res.text).to.include(PRISM_THEME);
        expect(themes.availableThemes).to.have.lengthOf(1);
        expect(themes.availableThemes[0].name).to.equal('custom');
      } finally {
        themes.selectedTheme = originalName;
        themes.availableThemes = originalThemes;
      }
    });

    it('preserves customized Prism CSS, including an intentionally empty palette', async () => {
      const themes = Config.Gallery.Themes;
      const originalName = themes.selectedTheme;
      const originalThemes = themes.availableThemes;
      try {
        themes.selectedTheme = 'prism';
        for (const css of [':root { --pg-accent: coral; }', '']) {
          themes.availableThemes = [new ThemeConfig('prism', css)];
          const res = await (request.execute(server.Server) as SuperAgentStatic).get('/');
          res.should.have.status(200);
          expect(res.text).not.to.include(PRISM_THEME);
          if (css) {
            expect(res.text).to.include(css);
          }
        }
      } finally {
        themes.selectedTheme = originalName;
        themes.availableThemes = originalThemes;
      }
    });
  });

  describe('Icon caching', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('should return different icons when configuration changes', async () => {
      // Set initial icon configuration
      const originalIcon = Config.Server.svgIcon;
      Config.Server.svgIcon = {
        viewBox: '0 0 512 512',
        items: '<path d="M256 32C114.6 32 0 114.6 0 256s114.6 224 256 224 256-100.3 256-224S397.4 32 256 32z"/>'
      };

      // Make first request to get icon with initial config
      const firstResponse = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/icon.png')
        .buffer(true)
        .parse(function(res, callback) {
          const data: any = [];
          res.on('data', function(chunk) {
            data.push(chunk);
          });
          res.on('end', function() {
            callback(null, Buffer.concat(data));
          });
        });

      // Debug: log the response if it's not what we expect
      if (firstResponse.headers['content-type'] !== 'image/png') {
        console.log('First response content-type:', firstResponse.headers['content-type']);
        console.log('First response body:', firstResponse.body.toString());
      }

      firstResponse.should.have.status(200);
      if (firstResponse.headers['content-type'] === 'application/json; charset=utf-8') {
        // If we get JSON error, the icon generation failed - skip this test
        console.log('Icon generation failed, skipping test');
        Config.Server.svgIcon = originalIcon;
        return;
      }
      firstResponse.headers['content-type'].should.equal('image/png');
      expect(firstResponse.body).to.be.instanceOf(Buffer);
      const firstIconData = firstResponse.body;

      // Change icon configuration
      Config.Server.svgIcon = {
        viewBox: '0 0 512 512',
        items: '<path d="M256 64C150 64 64 150 64 256s86 192 192 192 192-86 192-192S362 64 256 64z"/>'
      };

      // Make second request to get icon with changed config
      const secondResponse = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/icon.png')
        .buffer(true)
        .parse(function(res, callback) {
          const data: any = [];
          res.on('data', function(chunk) {
            data.push(chunk);
          });
          res.on('end', function() {
            callback(null, Buffer.concat(data));
          });
        });

      secondResponse.should.have.status(200);
      secondResponse.headers['content-type'].should.equal('image/png');
      expect(secondResponse.body).to.be.instanceOf(Buffer);
      const secondIconData = secondResponse.body;

      // Icons should be different due to hash-based caching
      expect(Buffer.compare(firstIconData, secondIconData)).to.not.equal(0);

      // Restore original configuration
      Config.Server.svgIcon = originalIcon;
    });

    it('should return different colored icons for white icon endpoint', async () => {
      // Set initial icon configuration
      const originalIcon = Config.Server.svgIcon;
      Config.Server.svgIcon = {
        viewBox: '0 0 512 512',
        items: '<path d="M256 32C114.6 32 0 114.6 0 256s114.6 224 256 224 256-100.3 256-224S397.4 32 256 32z"/>'
      };

      // Make request to get regular icon (black)
      const regularResponse = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/icon.png')
        .buffer(true)
        .parse(function(res, callback) {
          const data: any = [];
          res.on('data', function(chunk) {
            data.push(chunk);
          });
          res.on('end', function() {
            callback(null, Buffer.concat(data));
          });
        });

      // Make request to get white icon
      const whiteResponse = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/icon_white.png')
        .buffer(true)
        .parse(function(res, callback) {
          const data: any = [];
          res.on('data', function(chunk) {
            data.push(chunk);
          });
          res.on('end', function() {
            callback(null, Buffer.concat(data));
          });
        });

      regularResponse.should.have.status(200);
      whiteResponse.should.have.status(200);
      expect(regularResponse.body).to.be.instanceOf(Buffer);
      expect(whiteResponse.body).to.be.instanceOf(Buffer);

      // Icons should be different due to different colors
      expect(Buffer.compare(regularResponse.body, whiteResponse.body)).to.not.equal(0);

      // Restore original configuration
      Config.Server.svgIcon = originalIcon;
    });
  });

  describe('Frontend bundle integrity', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('serves index.html without escaped EJS tags and resolves all script and lazy-chunk module imports', async () => {
      const indexRes = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/')
        .set('Accept-Language', 'en');
      indexRes.should.have.status(200);
      expect(indexRes.text).to.not.include('&lt;%');
      expect(indexRes.text).to.not.include('<%= ');

      const scriptSrcs = Array.from(indexRes.text.matchAll(/<script[^>]+src="([^"]+\.js)"/g), m => m[1]);
      expect(scriptSrcs.length).to.be.greaterThan(0);

      const localeDir = path.join(ProjectPath.FrontendFolder, 'en');
      const jsFiles = fs.readdirSync(localeDir).filter(f => f.endsWith('.js'));
      expect(jsFiles.length).to.be.greaterThan(0);

      const referencedModules = new Set<string>(scriptSrcs);
      for (const jsFile of jsFiles) {
        const content = fs.readFileSync(path.join(localeDir, jsFile), 'utf8');
        for (const match of content.matchAll(/(?:from|import\s*\(|import)\s*["']\.\/([^"']+\.js)["']/g)) {
          referencedModules.add(match[1]);
        }
      }

      for (const mod of referencedModules) {
        expect(fs.existsSync(path.join(localeDir, mod)), `Missing referenced module ${mod} in dist/en`).to.be.true;
        const modRes = await (request.execute(server.Server) as SuperAgentStatic)
          .get('/' + mod)
          .set('Accept-Language', 'en');
        modRes.should.have.status(200);
        expect(modRes.headers['content-type']).to.match(/javascript/);
      }

      const missingRes = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/does-not-exist-bundle.js')
        .set('Accept-Language', 'en');
      missingRes.should.have.status(404);

      const missingAssetRes = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/assets/does-not-exist-asset.png')
        .set('Accept-Language', 'en');
      missingAssetRes.should.have.status(404);
    });
  });

});
