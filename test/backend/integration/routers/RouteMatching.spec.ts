import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import * as path from 'path';
import * as chai from 'chai';
import {expect} from 'chai';
import {SuperAgentStatic} from 'superagent';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {DBTestHelper} from '../../DBTestHelper';
import {TestHelper} from '../../../TestHelper';
import {default as chaiHttp, request} from 'chai-http';
import {SearchQueryTypes} from '../../../../src/common/entities/SearchQueryDTO';
import {UserRoles} from '../../../../src/common/entities/UserDTO';

process.env.NODE_ENV = 'test';
chai.should();
chai.use(chaiHttp);

declare let describe: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;

const tmpDescribe = describe;
describe = DBTestHelper.describe({sqlite: true});

describe('RouteMatching', (sqlHelper: DBTestHelper) => {
  describe = tmpDescribe;

  let server: Server;

  const setUp = async () => {
    await sqlHelper.initDB();
    Config.Users.authenticationRequired = false;
    Config.Users.unAuthenticatedUserRole = UserRoles.Admin;
    Config.Media.Video.enabled = true;
    Config.Search.AutoComplete.enabled = true;
    Config.Search.listDirectories = true;
    Config.Media.folder = path.join(__dirname, '../../assets');
    Config.Media.tempFolder = TestHelper.TMP_DIR;
    ProjectPath.reset();
    server = new Server(false);
    await server.onStarted.wait();
  };

  const tearDown = async () => {
    await sqlHelper.clearDB();
  };

  describe('Gallery & Media Route Matching', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('should match directory root /api/gallery/content/', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/');
      (res.should as any).have.status(200);
      expect(res.body.error).to.equal(null);
      expect(res.body.result).to.not.equal(null);
    });

    it('should match alias root /api/gallery/', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/');
      (res.should as any).have.status(200);
      expect(res.body.error).to.equal(null);
    });

    it('should match double-slash root /api/gallery//', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery//');
      (res.should as any).have.status(200);
      expect(res.body.error).to.equal(null);
    });

    it('should match nested subfolder /api/gallery/content/orientation', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/orientation');
      (res.should as any).have.status(200);
      expect(res.body.error).to.equal(null);
      expect(res.body.result.directory.name).to.equal('orientation');
    });

    it('should match raw image: test_png.png', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/test_png.png');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/image\/png/);
    });

    it('should match photo icon: test_png.png/icon', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/test_png.png/icon');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/image\//);
    });

    it('should match resized photo: test_png.png/100', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/test_png.png/100');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/image\//);
    });

    it('should match special encoded filename with dots, spaces & unicode', async () => {
      const filename = 'test image öüóőúéáű-.,.jpg';
      const encoded = encodeURIComponent(filename);
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/' + encoded);
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/image\/jpeg/);
    });

    it('should match raw video: video.mp4', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/video\/mp4/);
    });

    it('should match video icon: video.mp4/icon', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/icon');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/image\//);
    });

    it('should match video thumbnail: video.mp4/240', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/240');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/image\//);
    });

    it('should match bestFit video: video.mp4/bestFit', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/bestFit');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/video\/mp4/);
    });

    it('should match meta file: index.md', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/index.md');
      (res.should as any).have.status(200);
      expect(res.header['content-type']).to.match(/text\/markdown/);
    });

    it('should fall through for unsupported extensions (not matched as media)', async () => {
      // script.sh does not match media routes, falls through to listDirectory which returns 404 (not a directory)
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/script.sh');
      (res.should as any).have.status(404);
    });
  });

  describe('Search, Autocomplete & Zip Route Matching', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('should match search with JSON query', async () => {
      const query = {
        type: SearchQueryTypes.any_text,
        value: 'png',
        matchType: 1 // like
      };
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/search/' + encodeURIComponent(JSON.stringify(query)));
      (res.should as any).have.status(200);
      expect(res.body.error).to.equal(null);
      expect(res.body.result).to.not.equal(null);
    });

    it('should match autocomplete with simple value', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/autocomplete/test');
      (res.should as any).have.status(200);
      expect(res.body.error).to.equal(null);
    });

    it('should match directory zip route and execute handler', async () => {
      const query = {
        type: SearchQueryTypes.directory,
        value: 'orientation',
        matchType: 0 // exact_match
      };
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/zip/' + encodeURIComponent(JSON.stringify(query)));
      // Route matches and executes zip handler (returns 200 zip or json error DTO if DB not indexed)
      expect([200, 400]).to.include(res.status);
    });
  });

  describe('Public & Frontend Route Matching', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('should serve index HTML at /', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/');
      (res.should as any).have.status(200);
      expect(res.text).to.include('<!DOCTYPE html>');
    });

    it('should serve index HTML at /login', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/login');
      (res.should as any).have.status(200);
      expect(res.text).to.include('<!DOCTYPE html>');
    });

    it('should serve index HTML at /gallery', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/gallery');
      (res.should as any).have.status(200);
      expect(res.text).to.include('<!DOCTYPE html>');
    });

    it('should serve index HTML at /gallery/subpath/item', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/gallery/subpath/item');
      (res.should as any).have.status(200);
      expect(res.text).to.include('<!DOCTYPE html>');
    });

    it('should serve index HTML at /search', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/search');
      (res.should as any).have.status(200);
      expect(res.text).to.include('<!DOCTYPE html>');
    });

    it('should serve index HTML at /search/query-string', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/search/query-string');
      (res.should as any).have.status(200);
      expect(res.text).to.include('<!DOCTYPE html>');
    });

    it('should redirect localized paths to base: /en/gallery', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/en/gallery')
        .redirects(0);
      (res.should as any).have.status(302);
      expect(res.header['location']).to.include('/?ln=en');
    });

    it('should return 404 for non-existent routes', async () => {
      const res = await (request.execute(server.Server) as SuperAgentStatic)
        .get('/nonexistent-path-for-test');
      (res.should as any).have.status(404);
    });
  });
});
