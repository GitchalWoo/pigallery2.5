import {Config} from '../../../../src/common/config/private/Config';
import {Server} from '../../../../src/backend/server';
import {LoginCredential} from '../../../../src/common/entities/LoginCredential';
import {UserDTO, UserRoles} from '../../../../src/common/entities/UserDTO';
import * as path from 'path';
import * as fs from 'fs';
import {SQLConnection} from '../../../../src/backend/model/database/SQLConnection';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {QueryParams} from '../../../../src/common/QueryParams';
import {Utils} from '../../../../src/common/Utils';
import {SuperAgentStatic} from 'superagent';
import {RouteTestingHelper} from './RouteTestingHelper';
import {RateLimiter} from '../../../../src/backend/middlewares/RateLimiter';
import {CookieNames} from '../../../../src/common/CookieNames';
import {CustomHeaders} from '../../../../src/common/CustomHeaders';
import {ErrorCodes} from '../../../../src/common/entities/Error';
import {DatabaseType} from '../../../../src/common/config/private/PrivateConfig';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import * as chai from "chai";
import {default as chaiHttp, request} from "chai-http";
import {DBTestHelper} from '../../DBTestHelper';

process.env.NODE_ENV = 'test';
const should = chai.should();
chai.use(chaiHttp);

describe('UserRouter', () => {
  const sqlHelper = new DBTestHelper(DatabaseType.sqlite);

  const testUser: UserDTO = {
    id: 1,
    name: 'test',
    password: 'test',
    projectionKey: DBTestHelper.defaultSession.user.projectionKey,
    role: UserRoles.User
  };
  const {password, ...expectedUser} = testUser;
  let server: Server;
  const setUp = async (albumRole: UserRoles = undefined) => {
    RateLimiter.reset();
    await sqlHelper.initDB();
    if (albumRole !== undefined) {
      Config.Users.authenticationRequired = true;
      Config.Album.readAccessMinRole = albumRole;
    }

    server = new Server(false);
    await server.onStarted.wait();
    await ObjectManagers.getInstance().init();
    await ObjectManagers.getInstance().UserManager.createUser(Utils.clone(testUser));
    await SQLConnection.close();
  };
  const tearDown = async () => {
    await sqlHelper.clearDB()
  };



  const login = async (srv: Server): Promise<any> => {
    const result = await (request.execute(srv.Server) as SuperAgentStatic)
      .post(Config.Server.apiPath + '/user/login')
      .send({
        loginCredential: {
          password: testUser.password,
          username: testUser.name,
          rememberMe: false
        } as LoginCredential
      });

    RouteTestingHelper.shouldBeValidUIUser(result, expectedUser);
    return result;
  };


  describe('/POST user/login', () => {
    beforeEach(setUp);
    afterEach(tearDown);
    it('it should login', async () => {
      Config.Users.authenticationRequired = true;
      await login(server);

    });
    it('it skip login', async () => {
      Config.Users.authenticationRequired = false;
      const result = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/user/login');

      result.should.have.status(404);
    });

    it('rejects a wrong password with the credential error', async () => {
      Config.Users.authenticationRequired = true;
      const result = await request.execute(server.Server)
        .post(Config.Server.apiPath + '/user/login')
        .send({loginCredential: {username: testUser.name, password: 'wrong'}});
      result.should.have.status(401);
      should.equal(result.body.error?.code, ErrorCodes.CREDENTIAL_NOT_FOUND);
      should.equal(result.body.result, null);
    });

  });


  describe('management role limits', () => {
    let previousAlbumRole: UserRoles;
    let previousAuth: boolean;

    beforeEach(async () => {
      previousAlbumRole = Config.Album.readAccessMinRole;
      previousAuth = Config.Users.authenticationRequired;
      await setUp(UserRoles.Admin);
    });

    afterEach(async () => {
      Config.Album.readAccessMinRole = previousAlbumRole;
      Config.Users.authenticationRequired = previousAuth;
      await tearDown();
    });

    const headersFor = async (username: string, password: string) => {
      const loginResult = await request.execute(server.Server).post(Config.Server.apiPath + '/user/login')
        .send({loginCredential: {username, password}});
      loginResult.should.have.status(200);
      const cookies = (loginResult.headers['set-cookie'] as unknown as string[]).map(cookie => cookie.split(';')[0]);
      const token = cookies.find(cookie => cookie.startsWith(CookieNames.csrfToken + '=')).split('=')[1];
      return {Cookie: cookies.join('; '), 'X-CSRF-TOKEN': token};
    };

    it('guards changes and deletion of higher-role accounts while allowing administration of lower roles', async () => {
      const manager = ObjectManagers.getInstance().UserManager;
      await manager.createUser({name: 'manager', role: UserRoles.Admin, password: 'pass'} as UserDTO);
      const developer = await manager.createUser({name: 'developer', role: UserRoles.Developer, password: 'pass'} as UserDTO);
      const headers = await headersFor('manager', 'pass');
      const api = () => request.execute(server.Server);
      const userUrl = Config.Server.apiPath + '/user/';
      for (const operation of [
        () => api().post(userUrl + developer.id + '/role').send({newRole: UserRoles.Admin}),
        () => api().post(userUrl + developer.id + '/settings').send({settings: {newPassword: 'changed'}}),
        () => api().delete(userUrl + developer.id)
      ]) {
        const result = await operation().set(headers);
        should.equal(result.body.error?.code, ErrorCodes.NOT_AUTHORISED);
        result.should.have.status(403);
      }
      const allowed = await api().post(userUrl + testUser.id + '/role').send({newRole: UserRoles.Admin}).set(headers);
      should.equal(allowed.body.error, null);
      should.equal((await manager.findOne({id: testUser.id})).role, UserRoles.Admin);
      should.equal((await manager.findOne({id: developer.id})).role, UserRoles.Developer);
    });

    it('requires the configured role to list albums and Admin to write albums', async () => {
      const headers = await headersFor(testUser.name, testUser.password);
      const api = () => request.execute(server.Server);
      const albums = Config.Server.apiPath + '/albums';
      for (const operation of [() => api().get(albums), () => api().put(albums + '/saved-searches'), () => api().delete(albums + '/1')]) {
        const result = await operation().set(headers);
        result.should.have.status(403);
        should.equal(result.body.error?.code, ErrorCodes.NOT_AUTHORISED);
      }
      await ObjectManagers.getInstance().UserManager.createUser({name: 'manager', role: UserRoles.Admin, password: 'pass'} as UserDTO);
      const adminHeaders = await headersFor('manager', 'pass');
      const allowed = await api().get(albums).set(adminHeaders);
      should.equal(allowed.body.error, null);
      allowed.should.have.status(200);
    });

    it('unlinks the pair only with CSRF and sufficient role, then ends the target session', async () => {
      const manager = ObjectManagers.getInstance().UserManager;
      const identity = {oidcIssuer: 'https://idp.example', oidcSubject: 'test-sub'};
      const admin = await manager.createUser({name: 'manager', role: UserRoles.Admin, password: 'pass', ...identity} as UserDTO);
      const target = await manager.createUser({name: 'linked_user', role: UserRoles.User, password: 'pass', ...identity} as UserDTO);
      const developer = await manager.createUser({name: 'developer', role: UserRoles.Developer, password: 'pass', ...identity} as UserDTO);
      const adminHeaders = await headersFor(admin.name, 'pass');
      const targetHeaders = await headersFor(target.name, 'pass');
      const api = () => request.execute(server.Server);
      const unlink = (id: number) => api().delete(Config.Server.apiPath + '/user/' + id + '/oidc');
      const missingCsrf = await unlink(target.id).set('Cookie', adminHeaders.Cookie);
      should.equal(missingCsrf.body.error?.code, ErrorCodes.NOT_AUTHORISED);
      missingCsrf.body.error.message.should.contain('CSRF');
      // the code is kept, the status tells that it is forbidden
      missingCsrf.should.have.status(403);
      (await unlink(target.id).set(targetHeaders)).should.have.status(403);
      (await unlink(developer.id).set(adminHeaders)).should.have.status(403);
      (await unlink(admin.id).set(adminHeaders)).should.have.status(403);
      should.equal((await manager.findOne({id: target.id})).oidcSubject, identity.oidcSubject);

      const response = await unlink(target.id).set(adminHeaders);
      response.should.have.status(200);
      should.equal(response.body.error, null);
      const updated = await manager.findOne({id: target.id});
      should.equal(updated.oidcIssuer, null);
      should.equal(updated.oidcSubject, null);
      (await api().get(Config.Server.apiPath + '/user/me').set(targetHeaders)).should.have.status(401);
    });

    it('uses the configured visitor role and disables account management without password protection', async () => {
      Config.Users.authenticationRequired = false;
      const api = () => request.execute(server.Server);
      Config.Users.unAuthenticatedUserRole = UserRoles.Guest;
      const visitor = await api().get(Config.Server.apiPath + '/user/me');
      visitor.should.have.status(200);
      should.equal(visitor.body.result.role, UserRoles.Guest);
      (await api().get(Config.Server.apiPath + '/user/list')).should.have.status(403);

      Config.Users.unAuthenticatedUserRole = UserRoles.Admin;
      const userList = await api().get(Config.Server.apiPath + '/user/list');
      should.equal(userList.body.error?.code, ErrorCodes.USER_MANAGEMENT_DISABLED);
      Config.Users.unAuthenticatedUserRole = UserRoles.Guest;
    });
  });

  describe('/GET user/me', () => {
    beforeEach(setUp);
    afterEach(tearDown);
    it('it should GET the authenticated user', async () => {
      Config.Users.authenticationRequired = true;

      const loginRes = await login(server);

      const result = await request.execute(server.Server)
        .get(Config.Server.apiPath + '/user/me')
        .set('Cookie', loginRes.res.headers['set-cookie']);

      RouteTestingHelper.shouldBeValidUIUser(result, expectedUser);
    });

    it('it should not authenticate', async () => {
      Config.Users.authenticationRequired = true;

      const result = await request.execute(server.Server)
        .get(Config.Server.apiPath + '/user/me');

      result.should.have.status(401);
    });

    it('it should authenticate as user with sharing key', async () => {
      Config.Users.authenticationRequired = true;
      Config.Sharing.enabled = true;
      Config.Sharing.passwordRequired = true;

      const sharingKey = (await RouteTestingHelper.createSharing(testUser, 'pass')).sharingKey;


      const loginRes = await login(server);
      const q: Record<string, string> = {};
      q[QueryParams.gallery.sharingKey_query] = sharingKey;
      const result = await request.execute(server.Server)
        .get(Config.Server.apiPath + '/user/me?' + QueryParams.gallery.sharingKey_query + '=' + sharingKey)
        .set('Cookie', loginRes.res.headers['set-cookie']);

      // should return with logged in user, not limited sharing one
      RouteTestingHelper.shouldBeValidUIUser(result, expectedUser);
    });


    it('it should authenticate with sharing key', async () => {
      Config.Users.authenticationRequired = true;
      Config.Sharing.enabled = true;
      Config.Sharing.passwordRequired = false;
      const sharing = (await RouteTestingHelper.createSharing(testUser));


      const q: Record<string, string> = {};
      q[QueryParams.gallery.sharingKey_query] = sharing.sharingKey;
      const result = await request.execute(server.Server)
        .get(Config.Server.apiPath + '/user/me?' + QueryParams.gallery.sharingKey_query + '=' + sharing.sharingKey);

      RouteTestingHelper.shouldBeValidUIUser(result, RouteTestingHelper.getExpectedSharingUserForUI(sharing));
    });

    it('it should not authenticate with sharing key without password', async () => {
      Config.Users.authenticationRequired = true;
      Config.Sharing.enabled = true;
      Config.Sharing.passwordRequired = true;
      const sharing = (await RouteTestingHelper.createSharing(testUser, 'pass_secret'));


      const q: Record<string, string> = {};
      q[QueryParams.gallery.sharingKey_query] = sharing.sharingKey;
      const result = await request.execute(server.Server)
        .get(Config.Server.apiPath + '/user/me?' + QueryParams.gallery.sharingKey_query + '=' + sharing.sharingKey);

      result.should.have.status(401);
      result.body.should.be.a('object');
      result.body.error.should.be.a('object');
      should.equal(result.body.error.code, ErrorCodes.NOT_AUTHENTICATED_SHARING);
    });

    it('it should authenticate as guest', async () => {
      Config.Users.authenticationRequired = false;

      const result = await request.execute(server.Server)
        .get(Config.Server.apiPath + '/user/me');

      const expectedGuestUser = {
        name: UserRoles[Config.Users.unAuthenticatedUserRole],
        projectionKey: DBTestHelper.defaultSession.user.projectionKey,
        role: Config.Users.unAuthenticatedUserRole
      } as UserDTO;


      RouteTestingHelper.shouldBeValidUIUser(result, expectedGuestUser);
    });
  });

  describe('/POST user/logout', () => {
    beforeEach(setUp);
    afterEach(tearDown);

    it('it should log out the user', async () => {
      Config.Users.authenticationRequired = true;
      const agent = request.agent(server.Server);
      const loginRes = await agent.post(Config.Server.apiPath + '/user/login')
        .send({loginCredential: {password: testUser.password, username: testUser.name, rememberMe: false} as LoginCredential});
      RouteTestingHelper.shouldBeValidUIUser(loginRes, expectedUser);

      const res = await agent.post(Config.Server.apiPath + '/user/logout')
        .set(CustomHeaders.csrfToken, RouteTestingHelper.getCsrfToken(loginRes));
      res.should.have.status(200);

      const me = await agent.get(Config.Server.apiPath + '/user/me');
      me.should.have.status(401);
      agent.close();
    });

    it('it should log out the sharing user', async () => {
      Config.Users.authenticationRequired = true;
      Config.Sharing.enabled = true;
      Config.Sharing.passwordRequired = false;
      const sharing = (await RouteTestingHelper.createSharing(testUser, 'pass_secret'));
      const agent = request.agent(server.Server);

      const loginRes = await agent.post(Config.Server.apiPath + '/share/login?' + QueryParams.gallery.sharingKey_query + '=' + sharing.sharingKey)
        .send({password: 'pass_secret'});
      RouteTestingHelper.shouldBeValidUIUser(loginRes, RouteTestingHelper.getExpectedSharingUserForUI(sharing));

      const res = await agent.post(Config.Server.apiPath + '/user/logout')
        .set(CustomHeaders.csrfToken, RouteTestingHelper.getCsrfToken(loginRes));
      res.should.have.status(200);

      // password protected sharing needs a new login
      const me = await agent.get(Config.Server.apiPath + '/user/me?' + QueryParams.gallery.sharingKey_query + '=' + sharing.sharingKey);
      me.should.have.status(401);
      should.equal(me.body.error.code, ErrorCodes.NOT_AUTHENTICATED_SHARING);
      agent.close();
    });
  });
});
