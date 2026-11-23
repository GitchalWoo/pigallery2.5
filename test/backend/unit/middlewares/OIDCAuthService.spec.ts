/* eslint-disable no-unused-expressions,@typescript-eslint/no-unused-expressions */
import {expect} from 'chai';
import {Config} from '../../../../src/common/config/private/Config';
import {OIDCAuthService} from '../../../../src/backend/middlewares/user/OIDCAuthService';
import {OIDCMWs} from '../../../../src/backend/middlewares/user/OIDCMWs';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {UserDTO, UserRoles} from '../../../../src/common/entities/UserDTO';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';
import {SQLConnection} from '../../../../src/backend/model/database/SQLConnection';
import {DBTestHelper} from '../../DBTestHelper';
import {MockOIDCServer} from './MockOIDCServer';

declare const describe: Mocha.SuiteFunction;
declare const before: any;
declare const after: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const it: any;

interface MockResponseResult {
  redirectUrl: string | null;
}

function createMockReq(overrides: Record<string, any> = {}): any {
  return {
    session: {},
    sessionOptions: {},
    query: {},
    ...overrides
  };
}

function createMockRes(): { res: any; getRedirectUrl: () => string | null } {
  const result: MockResponseResult = {
    redirectUrl: null
  };
  const res: any = {
    redirect: (url: string) => {
      result.redirectUrl = url;
    }
  };
  return {
    res,
    getRedirectUrl: () => result.redirectUrl
  };
}

DBTestHelper.describe()('OIDCAuthService', (sqlHelper) => {
  const mockOidc = new MockOIDCServer();
  let issuerUrl: string;

  before(async () => {
    issuerUrl = await mockOidc.start();
    await sqlHelper.initDB();
    await ObjectManagers.getInstance().init();
  });

  after(async () => {
    await mockOidc.stop();
    await ObjectManagers.reset();
    await SQLConnection.close();
    await sqlHelper.clearDB();
  });

  beforeEach(async () => {
    OIDCAuthService.reset();
    Config.loadSync();
    Config.Users.oidc.enabled = true;
    Config.Users.oidc.issuerUrl = issuerUrl;
    Config.Users.oidc.clientId = 'test-client-id';
    Config.Users.oidc.clientSecret = 'test-client-secret';
    Config.Users.oidc.redirectUri = 'http://localhost:8081/pgapi/auth/oidc/callback';
    Config.Users.oidc.scopes = ['openid', 'profile', 'email'];
    Config.Users.oidc.usernameClaim = 'preferred_username';
    Config.Users.oidc.emailClaim = 'email';
    Config.Users.oidc.allowedDomains = [];
    Config.Users.oidc.autoCreateUser = false;
    Config.Users.oidc.strictSecurity = false;
    Config.Users.oidc.strictLinkMaxRole = UserRoles.User;
    Config.Server.urlBase = '';

    mockOidc.signingAlgorithm = 'RS256';
    mockOidc.userInfo = null;
    mockOidc.setClaims({
      sub: 'mock-sub-1',
      preferred_username: 'oidc_test_user',
      email: 'oidc_test_user@example.com'
    });
  });

  afterEach(async () => {
    Config.loadSync();
    Config.Server.urlBase = '';
    OIDCAuthService.reset();
  });

  describe('Configuration validation', () => {
    it('should throw when OIDC is disabled', async () => {
      Config.Users.oidc.enabled = false;
      const req = createMockReq();
      try {
        await OIDCAuthService.getAuthenticationRequestUrl(req);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.equal('OIDC is not enabled');
      }
    });

    it('should throw when issuerUrl is empty', async () => {
      Config.Users.oidc.issuerUrl = '';
      const req = createMockReq();
      try {
        await OIDCAuthService.getAuthenticationRequestUrl(req);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.equal('OIDC issuerUrl is not configured');
      }
    });
  });

  describe('getAuthenticationRequestUrl', () => {
    it('should generate PKCE challenge, state, store in session, and return authorization URL', async () => {
      const req = createMockReq();

      const redirectUrl = await OIDCAuthService.getAuthenticationRequestUrl(req);

      expect(req.session.oidc).to.be.an('object');
      expect(req.session.oidc.state).to.be.a('string').and.not.empty;
      expect(req.session.oidc.verifier).to.be.a('string').and.not.empty;

      expect(redirectUrl).to.be.a('string');

      const parsedUrl = new URL(redirectUrl);
      expect(parsedUrl.pathname).to.equal('/auth');
      expect(parsedUrl.searchParams.get('client_id')).to.equal('test-client-id');
      expect(parsedUrl.searchParams.get('response_type')).to.equal('code');
      expect(parsedUrl.searchParams.get('state')).to.equal(req.session.oidc.state);
      expect(parsedUrl.searchParams.get('scope')).to.equal('openid profile email');
      expect(parsedUrl.searchParams.get('code_challenge_method')).to.equal('S256');
      expect(parsedUrl.searchParams.get('code_challenge')).to.be.a('string').and.not.empty;
    });
  });

  describe('getUserFromAuthenticationResponse - validation and error cases', () => {
    it('should throw GENERAL_ERROR when session has no oidc state', async () => {
      const req = createMockReq({query: {code: 'mock-code', state: 'some-state'}});

      try {
        await OIDCAuthService.getUserFromAuthenticationResponse(req);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(ErrorDTO);
        expect(err.code).to.equal(ErrorCodes.GENERAL_ERROR);
        expect(err.message).to.equal('Invalid OIDC state');
      }
    });

    it('should throw GENERAL_ERROR when query state does not match session state', async () => {
      const req = createMockReq({
        session: {oidc: {state: 'state-aaa', verifier: 'ver-aaa'}},
        query: {code: 'mock-code', state: 'state-bbb'}
      });

      try {
        await OIDCAuthService.getUserFromAuthenticationResponse(req);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(ErrorDTO);
        expect(err.code).to.equal(ErrorCodes.GENERAL_ERROR);
        expect(err.message).to.equal('Invalid OIDC state');
      }
    });

    it('should throw CREDENTIAL_NOT_FOUND when claims lack username and email', async () => {
      mockOidc.setClaims({sub: 'user-sub-only'});

      // Initiate login to set session oidc state & verifier
      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code', state: loginReq.session.oidc.state}
      });

      try {
        await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(ErrorDTO);
        expect(err.code).to.equal(ErrorCodes.CREDENTIAL_NOT_FOUND);
        expect(err.message).to.equal('OIDC: missing username/email');
      }
    });

    it('should reject when email domain is not in allowedDomains', async () => {
      Config.Users.oidc.allowedDomains = ['trusted-company.com'];
      mockOidc.setClaims({
        sub: 'ext-user',
        preferred_username: 'ext_user',
        email: 'ext_user@untrusted.com'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code', state: loginReq.session.oidc.state}
      });

      try {
        await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(ErrorDTO);
        expect(err.code).to.equal(ErrorCodes.CREDENTIAL_NOT_FOUND);
        expect(err.message).to.contain('Email domain not allowed: untrusted.com');
      }
    });

    it('should reject when user does not exist in DB and autoCreateUser is false', async () => {
      Config.Users.oidc.autoCreateUser = false;
      mockOidc.setClaims({
        sub: 'sub-nonexistent',
        preferred_username: 'nonexistent_user',
        email: 'nonexistent_user@example.com'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code', state: loginReq.session.oidc.state}
      });

      try {
        await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.be.instanceOf(ErrorDTO);
        expect(err.code).to.equal(ErrorCodes.CREDENTIAL_NOT_FOUND);
        expect(err.message).to.equal('User not found');
      }
    });

    it('should throw when callback query contains error from IdP', async () => {
      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {
          error: 'access_denied',
          error_description: 'User denied authorization',
          state: loginReq.session.oidc.state
        }
      });

      try {
        await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.exist;
        expect(err.error || err.message).to.contain('access_denied');
      }
    });
  });

  describe('getUserFromAuthenticationResponse - successful authentication flows', () => {
    it('should authenticate existing user matching preferred_username claim', async () => {
      const existingUser: UserDTO = {
        name: 'alice_existing',
        password: 'password123',
        role: UserRoles.User
      } as any;
      await ObjectManagers.getInstance().UserManager.createUser(existingUser);

      mockOidc.setClaims({
        sub: 'alice-sub',
        preferred_username: 'alice_existing',
        email: 'alice@example.com'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code-alice', state: loginReq.session.oidc.state}
      });

      const user = await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);

      expect(cbReq.session.oidc).to.be.undefined;
      expect(mockOidc.lastTokenRequestBody).to.be.an('object');
      expect(mockOidc.lastTokenRequestBody?.grant_type).to.equal('authorization_code');
      expect(mockOidc.lastTokenRequestBody?.code).to.equal('mock-code-alice');
      expect(mockOidc.lastTokenRequestBody?.redirect_uri).to.equal(Config.Users.oidc.redirectUri);
      expect(mockOidc.lastTokenRequestBody?.client_id).to.equal('test-client-id');
      expect(mockOidc.lastTokenRequestBody?.client_secret).to.equal('test-client-secret');
      expect(mockOidc.lastTokenRequestBody?.code_verifier).to.be.a('string').and.not.empty;
      expect(user.name).to.equal('alice_existing');
      expect(user.role).to.equal(UserRoles.User);
    });

    it('should fallback to email prefix when preferred_username claim is empty', async () => {
      const existingUser: UserDTO = {
        name: 'charlie',
        password: 'password123',
        role: UserRoles.User
      } as any;
      await ObjectManagers.getInstance().UserManager.createUser(existingUser);

      mockOidc.setClaims({
        sub: 'charlie-sub',
        preferred_username: '',
        email: 'charlie@company.org'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code-charlie', state: loginReq.session.oidc.state}
      });

      const user = await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);

      expect(user.name).to.equal('charlie');
    });

    it('should auto-create new user with Guest role when autoCreateUser is enabled', async () => {
      Config.Users.oidc.autoCreateUser = true;

      mockOidc.setClaims({
        sub: 'newbie-sub',
        preferred_username: 'new_guest_user',
        email: 'new_guest@example.com'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code-newbie', state: loginReq.session.oidc.state}
      });

      const user = await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);

      expect(user.name).to.equal('new_guest_user');
      expect(user.role).to.equal(UserRoles.Guest);

      // Verify user was persisted in database
      const dbUser = await ObjectManagers.getInstance().UserManager.findOne({name: 'new_guest_user'});
      expect(dbUser).to.be.an('object');
      expect(dbUser.role).to.equal(UserRoles.Guest);
    });

    it('should allow login when email matches allowedDomains case-insensitively', async () => {
      Config.Users.oidc.allowedDomains = ['Enterprise.Com'];
      Config.Users.oidc.autoCreateUser = true;

      mockOidc.setClaims({
        sub: 'corp-sub',
        preferred_username: 'corp_user',
        email: 'corp_user@enterprise.com'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code-corp', state: loginReq.session.oidc.state}
      });

      const user = await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);

      expect(user.name).to.equal('corp_user');
    });

    it('should redirect to subpath when Config.Server.urlBase is set', () => {
      Config.Server.urlBase = 'gallery';
      const {res, getRedirectUrl} = createMockRes();

      OIDCMWs.redirectToApp(createMockReq(), res);

      expect(getRedirectUrl()).to.equal('/gallery/');
    });

    it('should respect custom usernameClaim and emailClaim configuration', async () => {
      Config.Users.oidc.usernameClaim = 'nickname';
      Config.Users.oidc.emailClaim = 'work_email';
      Config.Users.oidc.allowedDomains = ['custom.org'];
      Config.Users.oidc.autoCreateUser = true;

      mockOidc.setClaims({
        sub: 'custom-sub',
        nickname: 'nicky',
        work_email: 'nicky@custom.org'
      });

      const loginReq = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(loginReq);

      const cbReq = createMockReq({
        session: loginReq.session,
        query: {code: 'mock-code-custom', state: loginReq.session.oidc.state}
      });

      const user = await OIDCAuthService.getUserFromAuthenticationResponse(cbReq);

      expect(user.name).to.equal('nicky');
    });
  });

  describe('provider compatibility and strict identity linking', () => {
    async function login(): Promise<UserDTO> {
      const req = createMockReq();
      await OIDCAuthService.getAuthenticationRequestUrl(req);
      req.query = {code: 'test-code', state: req.session.oidc.state};
      return OIDCAuthService.getUserFromAuthenticationResponse(req);
    }

    async function expectDenied(code: ErrorCodes): Promise<void> {
      const result = await login().catch((error: unknown) => error);
      expect(result).to.be.instanceOf(ErrorDTO);
      expect((result as ErrorDTO).code).to.equal(code);
    }

    it('accepts an advertised PS256 token and reads profile claims from UserInfo', async () => {
      mockOidc.signingAlgorithm = 'PS256';
      mockOidc.setClaims({sub: 'ps256-userinfo'});
      mockOidc.userInfo = {sub: 'ps256-userinfo', preferred_username: 'ps256_name', email: 'name@company.org', email_verified: true};
      Config.Users.oidc.autoCreateUser = true;
      Config.Users.oidc.allowedDomains = ['company.org'];

      expect(await login()).to.include({name: 'ps256_name', oidcIssuer: issuerUrl, oidcSubject: 'ps256-userinfo'});
    });

    it('ignores profile claims from UserInfo for a different subject', async () => {
      mockOidc.setClaims({sub: 'expected-sub'});
      mockOidc.userInfo = {sub: 'other-sub', preferred_username: 'mismatched_user'};
      Config.Users.oidc.autoCreateUser = true;
      await expectDenied(ErrorCodes.CREDENTIAL_NOT_FOUND);
    });

    it('links via a verified full email and subsequently finds the account by issuer and subject', async () => {
      Config.Users.oidc.strictSecurity = true;
      const manager = ObjectManagers.getInstance().UserManager;
      const account = await manager.createUser({name: 'strict@company.org', role: UserRoles.User, password: 'test'} as UserDTO);
      mockOidc.setClaims({sub: 'strict-email', email: account.name, email_verified: false});
      await expectDenied(ErrorCodes.CREDENTIAL_NOT_FOUND);
      mockOidc.setClaims({sub: 'strict-email', email: account.name, email_verified: true});
      expect(await login()).to.include({id: account.id, oidcIssuer: issuerUrl, oidcSubject: 'strict-email'});
      mockOidc.setClaims({sub: 'strict-email'});
      expect(await login()).to.include({id: account.id});
    });

    it('keeps email verification tied to the source of the email', async () => {
      Config.Users.oidc.strictSecurity = true;
      Config.Users.oidc.autoCreateUser = true;
      mockOidc.setClaims({sub: 'strict-source', email_verified: true});
      mockOidc.userInfo = {sub: 'strict-source', email: 'unverified@company.org'};
      await expectDenied(ErrorCodes.CREDENTIAL_NOT_FOUND);
    });

    it('applies the strict role ceiling and keeps the Admin and Developer linking ban in both modes', async () => {
      const manager = ObjectManagers.getInstance().UserManager;
      const roles = [UserRoles.User, UserRoles.Admin, UserRoles.Developer];
      Config.Users.oidc.strictSecurity = true;
      Config.Users.oidc.strictLinkMaxRole = UserRoles.Guest;
      for (const role of roles) {
        const name = 'strict_role_' + role;
        const account = await manager.createUser({name, role, password: 'test'} as UserDTO);
        mockOidc.setClaims({sub: name, preferred_username: name});
        await expectDenied(ErrorCodes.NOT_AUTHORISED);
        if (role !== UserRoles.User) {
          Config.Users.oidc.strictSecurity = false;
          await expectDenied(ErrorCodes.NOT_AUTHORISED);
          Config.Users.oidc.strictSecurity = true;
        }
        expect((await manager.findOne({id: account.id})).oidcSubject).to.equal(null);
      }
    });

    it('keeps an existing link when another issuer presents the same subject and name', async () => {
      const manager = ObjectManagers.getInstance().UserManager;
      const account = await manager.createUser({
        name: 'issuer_bound_user', role: UserRoles.User, password: 'test',
        oidcIssuer: 'https://issuer.example', oidcSubject: 'common-sub'
      } as UserDTO);
      mockOidc.setClaims({sub: 'common-sub', preferred_username: account.name});
      await expectDenied(ErrorCodes.GENERAL_ERROR);
      expect((await manager.findOne({id: account.id})).oidcIssuer).to.equal('https://issuer.example');
    });
  });
});
