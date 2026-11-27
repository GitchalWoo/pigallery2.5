import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import * as path from 'path';
import * as chai from 'chai';
import {expect} from 'chai';
import {SuperAgentStatic} from 'superagent';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {DBTestHelper} from '../../DBTestHelper';
import {ReIndexingSensitivity} from '../../../../src/common/config/private/PrivateConfig';
import {TestHelper} from '../../../TestHelper';
import {default as chaiHttp, request} from 'chai-http';
import {ErrorCodes} from '../../../../src/common/entities/Error';
import {UserRoles} from '../../../../src/common/entities/UserDTO';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {SearchQueryUtils} from '../../../../src/common/SearchQueryUtils';
import {SearchQueryDTO, SearchQueryTypes, TextSearch, TextSearchQueryMatchTypes} from '../../../../src/common/entities/SearchQueryDTO';
import * as fs from 'fs';

process.env.NODE_ENV = 'test';
chai.should();
chai.use(chaiHttp);

// to help WebStorm to handle the test cases
declare let describe: any;
declare const after: any;
declare const it: any;
declare global {
  export interface Object {
    should: Chai.Assertion;
  }
}

const tmpDescribe = describe;
describe = DBTestHelper.describe({sqlite: true});

describe('GalleryRouter', (sqlHelper: DBTestHelper) => {
  describe = tmpDescribe;

  let server: Server;
  const setUp = async () => {
    await sqlHelper.initDB();
    Config.Users.authenticationRequired = false;
    Config.Media.Video.enabled = true;
    Config.Media.folder = path.join(__dirname, '../../assets');
    Config.Media.tempFolder = TestHelper.TMP_DIR;
    ProjectPath.reset();
    server = new Server(false);
    await server.onStarted.wait();
  };
  const tearDown = async () => {
    await sqlHelper.clearDB();
  };


  describe('/GET /api/gallery/content/', async () => {

    beforeEach(setUp);
    afterEach(tearDown);

    it('should load gallery', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/');

      (result.should as any).have.status(200);
      expect(result.body.error).to.be.equal(null);
      expect(result.body.result).to.not.be.equal(null);
      expect(result.body.result.directory).to.not.be.equal(null);
    });

    it('should load gallery twice (to force loading form db)', async () => {
      Config.Indexing.reIndexingSensitivity = ReIndexingSensitivity.low;
      const _ = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/orientation');

      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/orientation');

      (result.should as any).have.status(200);
      expect(result.body.error).to.be.equal(null);
      expect(result.body.result).to.not.be.equal(null);
      expect(result.body.result.directory).to.not.be.equal(null);
    });


  });

  describe('express uri parsing', async () => {


    beforeEach(setUp);
    afterEach(tearDown);

    it('express should parse path orientation/JPEG', async () => {
      Config.Indexing.reIndexingSensitivity = ReIndexingSensitivity.low;
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/orientation/JPEG');


      (result.should as any).have.status(404);
    });


    it('express should parse path orientation encoded', async () => {
      Config.Indexing.reIndexingSensitivity = ReIndexingSensitivity.low;
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/' + encodeURIComponent('orientation'));


      (result.should as any).have.status(200);
      expect(result.body.error).to.be.equal(null);
      expect(result.body.result).to.not.be.equal(null);
      expect(result.body.result.directory).to.not.be.equal(null);
    });

    it('express should parse path orientation/JPEG encoded', async () => {
      Config.Indexing.reIndexingSensitivity = ReIndexingSensitivity.low;
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/' + encodeURIComponent('orientation/JPEG'));


      (result.should as any).have.status(404);
    });


  });

  describe('/GET /api/gallery/content/video.mp4/bestFit', async () => {

    beforeEach(setUp);
    afterEach(tearDown);

    it('should get video without transcoding', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/bestFit');

      (result.should as any).have.status(200);
      expect(result.body).to.be.instanceof(Buffer);
    });


  });

  describe('/GET /api/gallery//', async () => {

    beforeEach(setUp);
    afterEach(tearDown);

    it('should list root directory even with double slash', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery//');

      (result.should as any).have.status(200);
      expect(result.body.error).to.be.equal(null);
      expect(result.body.result).to.not.be.equal(null);
      expect(result.body.result.directory).to.not.be.equal(null);
    });
  });

  describe('/GET raw video, icon and thumbnail', async () => {

    beforeEach(setUp);
    afterEach(tearDown);

    it('should get raw video', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4');

      (result.should as any).have.status(200);
      expect(result.body).to.be.instanceof(Buffer);
    });

    // browsers (Safari always, others for seeking) ask for a video in ranges
    it('should serve a range of the raw video with 206 and Content-Range', async () => {
      const size = fs.statSync(path.join(__dirname, '../../assets/video.mp4')).size;
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4')
        .set('Range', 'bytes=0-99');

      (result.should as any).have.status(206);
      expect(result.header['accept-ranges']).to.equal('bytes');
      expect(result.header['content-range']).to.equal('bytes 0-99/' + size);
      expect(Number(result.header['content-length'])).to.equal(100);
    });

    it('should serve a range from the middle of the bestFit video (seeking)', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/bestFit')
        .set('Range', 'bytes=100-');

      expect(result.status).to.equal(206);
      expect(result.header['content-range']).to.match(/^bytes 100-\d+\/\d+$/);
    });

    it('should answer 416 to a range past the end of the video', async () => {
      const size = fs.statSync(path.join(__dirname, '../../assets/video.mp4')).size;
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4')
        .set('Range', 'bytes=' + (size + 10) + '-');

      (result.should as any).have.status(416);
      expect(result.header['content-range']).to.equal('bytes */' + size);
    });

    it('should answer unknown api paths with a JSON error, not the HTML page', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/doesnotexist');

      (result.should as any).have.status(404);
      expect(result.header['content-type']).to.contain('application/json');
      expect(result.body.error.code).to.equal(ErrorCodes.PATH_ERROR);
      expect(result.body.result).to.equal(null);
    });

    it('should get video icon', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/icon');

      (result.should as any).have.status(200);
      expect(result.body).to.be.instanceof(Buffer);
    });

    it('should get video thumbnail (size 240)', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/video.mp4/240');

      (result.should as any).have.status(200);
      expect(result.body).to.be.instanceof(Buffer);
    });
  });

  describe('negative paths for non-existent media/meta', async () => {

    beforeEach(setUp);
    afterEach(tearDown);

    it('should return PATH_ERROR for non-existent video (raw)', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/nonexistent.mp4');

      (result.should as any).have.status(404);
      expect(result.body.error).to.not.be.equal(null);
      expect(result.body.result).to.be.equal(null);
      expect(result.body.error.code).to.be.equal(ErrorCodes.PATH_ERROR);
    });

    it('should return PATH_ERROR for non-existent video icon', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/nonexistent.mp4/icon');

      (result.should as any).have.status(404);
      expect(result.body.error).to.not.be.equal(null);
      expect(result.body.result).to.be.equal(null);
      expect(result.body.error.code).to.be.equal(ErrorCodes.PATH_ERROR);
    });

    it('should return PATH_ERROR for non-existent meta file (gpx)', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/nonexistent.gpx');

      (result.should as any).have.status(404);
      expect(result.body.error).to.not.be.equal(null);
      expect(result.body.result).to.be.equal(null);
      expect(result.body.error.code).to.be.equal(ErrorCodes.PATH_ERROR);
    });

    it('should return PATH_ERROR for non-existent meta file bestFit (gpx)', async () => {
      const result = await (request.execute(server.Server) as SuperAgentStatic)
        .get(Config.Server.apiPath + '/gallery/content/nonexistent.gpx/bestFit');

      (result.should as any).have.status(404);
      expect(result.body.error).to.not.be.equal(null);
      expect(result.body.result).to.be.equal(null);
      expect(result.body.error.code).to.be.equal(ErrorCodes.PATH_ERROR);
    });
  });

  describe('random photo link of the gallery', async () => {
    // the "Random link" dialog builds the link from the shortened query of the search page urls (#1313)
    before(async () => {
      await sqlHelper.initDB();
      const folder = path.join(TestHelper.TMP_DIR, 'random-link-gallery');
      fs.mkdirSync(folder, {recursive: true});
      fs.copyFileSync(path.join(__dirname, '../../assets/exiftool.jpg'), path.join(folder, 'abbey.jpg'));
      Config.Users.authenticationRequired = false;
      Config.Media.folder = folder;
      Config.Media.tempFolder = path.join(TestHelper.TMP_DIR, 'random-link-temp');
      ProjectPath.reset();
      server = new Server(false);
      await server.onStarted.wait();
      await ObjectManagers.getInstance().IndexingManager.indexDirectory('.', true);
    });
    after(async () => {
      Config.Users.authenticationRequired = true;
      await tearDown();
    });

    const get = (url: string) => (request.execute(server.Server) as SuperAgentStatic)
      .get(Config.Server.apiPath + url);

    it('should answer a photo of the shortened query', async () => {
      const res = await get('/gallery/random/' +
        encodeURIComponent(SearchQueryUtils.urlify({type: SearchQueryTypes.file_name, value: 'abbey'} as TextSearch)));
      (res.should as any).have.status(200);
      expect(res.headers['content-type']).to.equal('image/jpeg');
    });

    it('should still answer a photo of the full JSON query', async () => {
      const res = await get('/gallery/random/' +
        encodeURIComponent(JSON.stringify({type: SearchQueryTypes.file_name, value: 'abbey'} as TextSearch)));
      (res.should as any).have.status(200);
      expect(res.headers['content-type']).to.equal('image/jpeg');
    });

    it('should reject a query that is not JSON', async () => {
      const res = await get('/gallery/random/not-json');
      expect(res.body.error.code).to.equal(ErrorCodes.INPUT_ERROR);
    });

    it('returns a plain-text 404 if no photo matches the random link', async () => {
      const query = SearchQueryUtils.urlify({type: SearchQueryTypes.file_name, value: 'missing photo'} as TextSearch);
      const res = await get('/gallery/random/' + encodeURIComponent(query));
      expect(res.status).to.equal(404);
      expect(res.headers['content-type']).to.include('text/plain');
      expect(res.text).to.equal('No photos match this random link.');
    });
  });

  describe('role based access', async () => {

    beforeEach(setUp);
    afterEach(async () => {
      Config.Users.unAuthenticatedUserRole = UserRoles.Admin;
      await tearDown();
    });

    const get = (url: string) => (request.execute(server.Server) as SuperAgentStatic)
      .get(Config.Server.apiPath + url);

    it('LimitedGuest should not use autocomplete', async () => {
      Config.Users.unAuthenticatedUserRole = UserRoles.LimitedGuest;
      const result = await get('/autocomplete/a');
      (result.should as any).have.status(403);
    });

    it('Guest should use autocomplete', async () => {
      Config.Users.unAuthenticatedUserRole = UserRoles.Guest;
      const result = await get('/autocomplete/a');
      (result.should as any).have.status(200);
    });

    it('Guest should not see notifications', async () => {
      Config.Users.unAuthenticatedUserRole = UserRoles.Guest;
      const result = await get('/notifications');
      (result.should as any).have.status(403);
    });

    it('User should see notifications', async () => {
      Config.Users.unAuthenticatedUserRole = UserRoles.User;
      const result = await get('/notifications');
      (result.should as any).have.status(200);
    });
  });

  describe('/GET /api/gallery/zip/', () => {
    const origDownloadZip = Config.Gallery.NavBar.enableDownloadZip;
    const origSearchEnabled = Config.Search.enabled;

    beforeEach(async () => {
      await setUp();
      Config.Gallery.NavBar.enableDownloadZip = true;
      Config.Search.enabled = true;
    });

    afterEach(async () => {
      Config.Gallery.NavBar.enableDownloadZip = origDownloadZip;
      Config.Search.enabled = origSearchEnabled;
      Config.Users.authenticationRequired = true;
      await tearDown();
    });

    const getZip = (query: SearchQueryDTO) => (request.execute(server.Server) as SuperAgentStatic)
      .get(Config.Server.apiPath + '/gallery/zip/' + encodeURIComponent(JSON.stringify(query)));

    const fileName = (res: any): string => {
      const encoded = /filename\*=UTF-8''([^;]+)/.exec(res.headers['content-disposition']);
      return encoded ? decodeURIComponent(encoded[1]) : /filename="?([^";]+)"?/.exec(res.headers['content-disposition'])[1];
    };

    it('should name the zip of the root folder after the gallery', async () => {
      await ObjectManagers.getInstance().IndexingManager.indexDirectory('.', true);
      const res = await getZip({
        type: SearchQueryTypes.directory,
        matchType: TextSearchQueryMatchTypes.exact_match,
        value: '.'
      } as TextSearch);

      (res.should as any).have.status(200);
      expect(res.headers['content-disposition']).to.equal('attachment; filename="' + Config.Server.applicationTitle + '.zip"');
    });

    it('should name the zip of a folder after the folder', async () => {
      await ObjectManagers.getInstance().IndexingManager.indexDirectory('.', true);
      await ObjectManagers.getInstance().IndexingManager.indexDirectory('orientation', true);
      const res = await getZip({
        type: SearchQueryTypes.directory,
        matchType: TextSearchQueryMatchTypes.exact_match,
        value: './orientation'
      } as TextSearch);

      (res.should as any).have.status(200);
      expect(fileName(res)).to.equal('orientation.zip');
    });

    it('should keep SearchResults.zip for non-folder searches', async () => {
      await ObjectManagers.getInstance().IndexingManager.indexDirectory('.', true);
      const res = await getZip({
        type: SearchQueryTypes.file_name,
        value: 'old_photo'
      } as TextSearch);

      (res.should as any).have.status(200);
      expect(fileName(res)).to.equal('SearchResults.zip');
    });

    it('should preserve non-ASCII folder names via RFC 5987 filename*', async () => {
      const tmpMedia = path.join(TestHelper.TMP_DIR, 'zip-accent-media');
      const accentedDir = 'Été 2026';
      fs.rmSync(tmpMedia, {recursive: true, force: true});
      fs.mkdirSync(path.join(tmpMedia, accentedDir), {recursive: true});
      fs.copyFileSync(
        path.join(__dirname, '../../assets/old_photo.jpg'),
        path.join(tmpMedia, accentedDir, 'old_photo.jpg')
      );
      try {
        Config.Media.folder = tmpMedia;
        ProjectPath.reset();
        await ObjectManagers.getInstance().IndexingManager.indexDirectory('.', true);
        await ObjectManagers.getInstance().IndexingManager.indexDirectory(accentedDir, true);

        const res = await getZip({
          type: SearchQueryTypes.directory,
          matchType: TextSearchQueryMatchTypes.exact_match,
          value: accentedDir
        } as TextSearch);

        (res.should as any).have.status(200);
        expect(res.headers['content-disposition']).to.match(/^attachment;/);
        expect(fileName(res)).to.equal(accentedDir + '.zip');
      } finally {
        fs.rmSync(tmpMedia, {recursive: true, force: true});
      }
    });
  });

});
