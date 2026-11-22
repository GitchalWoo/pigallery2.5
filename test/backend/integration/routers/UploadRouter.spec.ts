import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import {LoginCredential} from '../../../../src/common/entities/LoginCredential';
import {UserDTO, UserRoles} from '../../../../src/common/entities/UserDTO';
import * as path from 'path';
import * as fs from 'fs';
import {SQLConnection} from '../../../../src/backend/model/database/SQLConnection';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {Utils} from '../../../../src/common/Utils';
import {SuperAgentStatic} from 'superagent';
import {RouteTestingHelper} from './RouteTestingHelper';
import {DatabaseType} from '../../../../src/common/config/private/PrivateConfig';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import * as chai from "chai";
import {default as chaiHttp, request} from "chai-http";
import {CustomHeaders} from '../../../../src/common/CustomHeaders';
import {CookieNames} from '../../../../src/common/CookieNames';
import {DBTestHelper} from '../../DBTestHelper';
import {RateLimiter} from '../../../../src/backend/middlewares/RateLimiter';
import {ErrorCodes} from '../../../../src/common/entities/Error';
import {DirectorySearch, SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../src/common/entities/SearchQueryDTO';
import * as http from 'http';
import {AddressInfo} from 'net';

declare const describe: any;
declare const it: any;
declare const before: any;
declare const after: any;
declare const beforeEach: any;
declare const afterEach: any;

process.env.NODE_ENV = 'test';
const should = chai.should();
chai.use(chaiHttp);

describe('UploadRouter', () => {
  const sqlHelper = new DBTestHelper(DatabaseType.sqlite);
  const testDir = path.join(__dirname, 'tmp_upload');
  const tempDir = path.join(__dirname, 'tmp_upload_temp');
  const uploadTemp = () => path.join(tempDir, 'upload');
  // the upload temp folder may not exist yet, it is made by the first upload
  const tempFiles = (): string[] => fs.existsSync(uploadTemp()) ? fs.readdirSync(uploadTemp()) : [];
  let originalTempFolder: string;

  const adminUser: UserDTO = {
    id: 1,
    name: 'admin',
    password: 'admin',
    role: UserRoles.Admin
  };

  let server: Server;

  before(async () => {
    Config.Upload.enabled = true;
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, {recursive: true});
    }
  });

  after(async () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, {recursive: true, force: true});
    }
    fs.rmSync(tempDir, {recursive: true, force: true});
  });

  const setUp = async () => {
    // every test logs in: stay below the login rate limit
    RateLimiter.reset();
    Config.Upload.enabled = true;
    await sqlHelper.initDB();
    Config.Media.folder = testDir;
    originalTempFolder = Config.Media.tempFolder;
    Config.Media.tempFolder = tempDir;
    ProjectPath.reset();
    server = new Server(false);
    await server.onStarted.wait();
    await ObjectManagers.getInstance().init();
    Config.Upload.enabled = true; // Set it again after init
    await ObjectManagers.getInstance().UserManager.createUser(Utils.clone(adminUser));
    await SQLConnection.close();
  };

  const tearDown = async () => {
    Config.Upload.maxFileSizeMB = 50;
    Config.Upload.enforcedDirectoryConfig = false;
    Config.Media.tempFolder = originalTempFolder;
    ProjectPath.reset();
    await sqlHelper.clearDB();
  };

  const extractCsrfToken = (loginRes: any): string => {
    const cookies = loginRes.res.headers['set-cookie'] || [];
    for (const c of cookies) {
      const match = c.match(new RegExp(`${CookieNames.csrfToken}=([^;]+)`));
      if (match) {
        return match[1];
      }
    }
    return '';
  };

  const login = async (srv: Server): Promise<any> => {
    return await (request.execute(srv.Server) as SuperAgentStatic)
      .post(Config.Server.apiPath + '/user/login')
      .send({
        loginCredential: {
          password: adminUser.password,
          username: adminUser.name,
          rememberMe: false
        } as LoginCredential
      });
  };

  describe('/POST upload', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('should upload a file', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test image'), 'test.jpg');

      if (res.body.error) {
        console.error(res.body.error);
      }
      res.should.have.status(200);
      should.equal(res.body.error, null);
      res.body.should.have.property('result');
      res.body.result.should.be.an('array').with.lengthOf(0); // No errors

      const savedPath = path.join(testDir, 'test.jpg');
      fs.existsSync(savedPath).should.be.true;
    });

    it('should reject a file above the size limit with the limit in the message and save the others', async () => {
      fs.mkdirSync(path.join(testDir, 'size_limit'), {recursive: true});
      Config.Upload.maxFileSizeMB = 1;
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/size_limit')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.alloc(1024 * 1024 + 1), 'too_large.jpg')
        .attach('files', Buffer.from('small'), 'small.jpg');

      res.should.have.status(200);
      res.body.result.should.be.an('array').with.lengthOf(1);
      res.body.result[0].filename.should.equal('too_large.jpg');
      res.body.result[0].error.should.contain('1 MB');
      fs.existsSync(path.join(testDir, 'size_limit', 'too_large.jpg')).should.be.false;
      fs.readFileSync(path.join(testDir, 'size_limit', 'small.jpg')).toString().should.equal('small');
      // the files are written to the temp folder first (not held in RAM): nothing is left there
      tempFiles().should.deep.equal([]);
    });

    it('should reject a file above the default 50 MiB limit', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.alloc(50 * 1024 * 1024 + 1), 'large.jpg');

      res.should.have.status(200);
      res.body.result.should.be.an('array').with.lengthOf(1);
      res.body.result[0].error.should.contain('50 MB');
      fs.existsSync(path.join(testDir, 'large.jpg')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should reject more than 10 files in one request', async () => {
      fs.mkdirSync(path.join(testDir, 'too_many'), {recursive: true});
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      let req = request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/too_many')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf);
      for (let i = 0; i < 11; i++) {
        req = req.attach('files', Buffer.from('image ' + i), 'many_' + i + '.jpg');
      }
      const res = await req;

      res.should.have.status(413);
      fs.readdirSync(path.join(testDir, 'too_many')).should.deep.equal([]);
      tempFiles().should.deep.equal([]);
    });

    it('should refuse a folder where uploading is not enabled', async () => {
      fs.mkdirSync(path.join(testDir, 'no_upload_conf'), {recursive: true});
      Config.Upload.enforcedDirectoryConfig = true;
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/no_upload_conf')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test image'), 'refused.jpg');

      res.should.have.status(403);
      res.body.error.code.should.equal(ErrorCodes.PERMISSION_DENIED);
      fs.existsSync(path.join(testDir, 'no_upload_conf', 'refused.jpg')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should never replace an existing file', async () => {
      fs.mkdirSync(path.join(testDir, 'existing'), {recursive: true});
      fs.writeFileSync(path.join(testDir, 'existing', 'photo.jpg'), 'original');
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/existing')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('replacement'), 'photo.jpg');

      res.should.have.status(200);
      res.body.result.should.be.an('array').with.lengthOf(1);
      res.body.result[0].error.should.contain('already exists');
      fs.readFileSync(path.join(testDir, 'existing', 'photo.jpg'), 'utf8').should.equal('original');
      tempFiles().should.deep.equal([]);
    });

    it('should save exactly one of two concurrent uploads of the same name', async () => {
      fs.mkdirSync(path.join(testDir, 'concurrent'), {recursive: true});
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const send = (content: string) => request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/concurrent')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from(content), 'same.jpg');
      const responses = await Promise.all([send('first'), send('second')]);

      responses.forEach((r) => r.should.have.status(200));
      const failed = responses.filter((r) => r.body.result.length === 1);
      failed.should.have.lengthOf(1);
      failed[0].body.result[0].error.should.contain('already exists');
      ['first', 'second'].should.include(fs.readFileSync(path.join(testDir, 'concurrent', 'same.jpg'), 'utf8'));
      tempFiles().should.deep.equal([]);
    });

    it('should keep traversal names inside the folder', async () => {
      fs.mkdirSync(path.join(testDir, 'traversal'), {recursive: true});
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/traversal')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('escape'), '../escape.jpg')
        .attach('files', Buffer.from('escape'), '..\\escape2.jpg');

      res.should.have.status(200);
      // multer only keeps the base name of a file name with /, a \ makes it an invalid name
      fs.existsSync(path.join(testDir, 'escape.jpg')).should.be.false;
      fs.existsSync(path.join(testDir, 'escape2.jpg')).should.be.false;
      fs.existsSync(path.join(__dirname, 'escape.jpg')).should.be.false;
      fs.readdirSync(path.join(testDir, 'traversal')).forEach((f) => f.should.not.contain('..'));
      tempFiles().should.deep.equal([]);
    });

    it('should reject a folder outside of the image folder', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/..%2F..%2Foutside_upload')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('escape'), 'outside.jpg');

      should.not.equal(res.body.error, null);
      fs.existsSync(path.join(testDir, '..', '..', 'outside_upload')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should not write a blocked file to the temp folder', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('<svg/>'), 'image.svg');

      res.should.have.status(200);
      res.body.result[0].error.should.contain('Unsupported file format');
      fs.existsSync(path.join(testDir, 'image.svg')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should leave no temp file when the client aborts the upload', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const cookies = (loginRes.res.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ');
      await new Promise<void>((resolve) => server.Server.listen(0, '127.0.0.1', resolve));
      try {
        const port = (server.Server.address() as AddressInfo).port;
        const boundary = '----pigallery2abort';
        const head = '--' + boundary + '\r\n' +
          'Content-Disposition: form-data; name="files"; filename="aborted.jpg"\r\n' +
          'Content-Type: image/jpeg\r\n\r\n';
        const req = http.request({
          host: '127.0.0.1', port, method: 'POST', path: Config.Server.apiPath + '/upload/',
          headers: {
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
            'Content-Length': String(10 * 1024 * 1024),
            [CustomHeaders.csrfToken]: csrf,
            Cookie: cookies
          }
        });
        req.on('error', (): void => undefined);
        req.write(head);
        req.write(Buffer.alloc(256 * 1024));
        // the server saves the file to the temp folder while it arrives
        for (let i = 0; i < 100 && tempFiles().length === 0; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
        tempFiles().should.have.lengthOf(1);
        req.destroy();
        for (let i = 0; i < 100 && tempFiles().length > 0; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
        tempFiles().should.deep.equal([]);
        fs.existsSync(path.join(testDir, 'aborted.jpg')).should.be.false;

        // the upload slot is free again
        const res = await request.execute(server.Server)
          .post(Config.Server.apiPath + '/upload/')
          .set('Cookie', loginRes.res.headers['set-cookie'])
          .set(CustomHeaders.csrfToken, csrf)
          .attach('files', Buffer.from('after abort'), 'after_abort.jpg');
        res.should.have.status(200);
        res.body.result.should.be.an('array').with.lengthOf(0);
      } finally {
        await new Promise((resolve) => server.Server.close(resolve));
      }
    });


    it('should upload a file to a sub-directory', async () => {
      fs.mkdirSync(path.join(testDir, 'sub_dir'), {recursive: true});
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/sub_dir')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test image 2'), 'test2.jpg');

      res.should.have.status(200);
      should.equal(res.body.error, null);
      const savedPath = path.join(testDir, 'sub_dir', 'test2.jpg');
      fs.existsSync(savedPath).should.be.true;
    });

    it('should not create a missing folder', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/missing_dir')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test image 3'), 'test3.jpg');

      should.not.equal(res.body.error, null);
      res.body.error.message.should.contain('Directory not found');
      res.body.error.code.should.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
      res.should.have.status(404);
      fs.existsSync(path.join(testDir, 'missing_dir')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should keep the accented letters of the file name', async () => {
      fs.mkdirSync(path.join(testDir, 'Nyaralás'), {recursive: true});
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/Nyaralás')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test image 3'), 'Árvíztűrő tükörfúrógép_ő.jpg')
        .attach('files', Buffer.from('test image 4'), 'plain-ascii_name.jpg');

      res.should.have.status(200);
      should.equal(res.body.error, null);
      res.body.result.should.be.an('array').with.lengthOf(0);
      fs.readdirSync(path.join(testDir, 'Nyaralás')).sort()
        .should.deep.equal(['plain-ascii_name.jpg', 'Árvíztűrő tükörfúrógép_ő.jpg'].sort());
    });

    it('should report a file error with the accented file name', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test exe'), 'Hévíz_tó.exe');

      res.should.have.status(200);
      res.body.result.should.be.an('array').with.lengthOf(1);
      // the client matches the errors to its files by this name
      res.body.result[0].filename.should.equal('Hévíz_tó.exe');
    });

    it('should return error for unsupported file', async () => {
      const loginRes = await login(server);
      const csrf = extractCsrfToken(loginRes);
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/')
        .set('Cookie', loginRes.res.headers['set-cookie'])
        .set(CustomHeaders.csrfToken, csrf)
        .attach('files', Buffer.from('test exe'), 'test.exe');

      res.should.have.status(200); // Middleware returns success, but result contains errors
      should.equal(res.body.error, null);
      res.body.result.should.be.an('array').with.lengthOf(1);
      res.body.result[0].should.have.property('error').which.contains('Unsupported file format');
    });

    it('should return 401 if not authenticated', async () => {
      const res = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/')
        .attach('files', Buffer.from('test'), 'test.jpg');

      res.should.have.status(401);
    });
  });

  describe('/POST upload with directory access', () => {
    const dq = (value: string, matchType = TextSearchQueryMatchTypes.exact_match): DirectorySearch =>
      ({type: SearchQueryTypes.directory, value, matchType});
    // can only open the family folder (not its private subfolder), so the root is only a parent (navigable, content hidden)
    const familyUser = {
      name: 'family', password: 'family', role: UserRoles.User,
      overrideAllowBlockList: true,
      allowDirectoryList: [dq('family/*', TextSearchQueryMatchTypes.globMatch)],
      blockDirectoryList: [dq('family/private')]
    } as UserDTO;
    const origMinimumRole = Config.Upload.minimumRole;

    beforeEach(async () => {
      Config.Upload.minimumRole = UserRoles.User; // read when the routes are set up
      await setUp();
      await ObjectManagers.getInstance().UserManager.createUser(Utils.clone(familyUser));
      for (const dir of ['family', path.join('family', 'private'), 'other']) {
        fs.mkdirSync(path.join(testDir, dir), {recursive: true});
      }
    });
    afterEach(async () => {
      Config.Upload.minimumRole = origMinimumRole;
      await tearDown();
    });

    const uploadAsFamily = async (dir: string, filename: string): Promise<any> => {
      const loginRes = await (request.execute(server.Server) as SuperAgentStatic)
        .post(Config.Server.apiPath + '/user/login')
        .send({loginCredential: {username: familyUser.name, password: familyUser.password, rememberMe: false} as LoginCredential});
      return request.execute(server.Server)
        .post(Config.Server.apiPath + '/upload/' + dir)
        .set('Cookie', loginRes.headers['set-cookie'] as unknown as string[])
        .set(CustomHeaders.csrfToken, RouteTestingHelper.getCsrfToken(loginRes))
        .attach('files', Buffer.from('test image'), filename);
    };

    it('should upload to an available folder', async () => {
      const res = await uploadAsFamily('family', 'allowed.jpg');

      res.should.have.status(200);
      should.equal(res.body.error, null);
      fs.existsSync(path.join(testDir, 'family', 'allowed.jpg')).should.be.true;
      tempFiles().should.deep.equal([]);
    });

    it('should answer a hidden folder like a not existing one, before saving the file', async () => {
      const hidden = await uploadAsFamily('other', 'hidden.jpg');
      const missing = await uploadAsFamily('family/missing', 'missing.jpg');

      hidden.should.have.status(404);
      hidden.body.error.code.should.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
      // nothing tells them apart
      hidden.body.should.deep.equal(missing.body);
      missing.should.have.status(hidden.status);
      fs.existsSync(path.join(testDir, 'other', 'hidden.jpg')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should not upload to a blocked folder inside an allowed one (block list wins)', async () => {
      const res = await uploadAsFamily('family/private', 'blocked.jpg');

      res.should.have.status(404);
      res.body.error.code.should.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
      fs.existsSync(path.join(testDir, 'family', 'private', 'blocked.jpg')).should.be.false;
      tempFiles().should.deep.equal([]);
    });

    it('should not upload to a folder that can only be navigated', async () => {
      const res = await uploadAsFamily('', 'parent.jpg');

      res.should.have.status(404);
      res.body.error.code.should.equal(ErrorCodes.DIRECTORY_NOT_FOUND);
      fs.existsSync(path.join(testDir, 'parent.jpg')).should.be.false;
      tempFiles().should.deep.equal([]);
    });
  });

  describe('startup', () => {
    beforeEach(async () => {
      fs.mkdirSync(uploadTemp(), {recursive: true});
      fs.writeFileSync(path.join(uploadTemp(), 'stale'), 'left behind');
      await setUp();
    });
    afterEach(tearDown);

    it('should remove the stale upload temp files', async () => {
      tempFiles().should.deep.equal([]);
    });
  });
});
