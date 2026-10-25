import {expect} from 'chai';
import {UserMWs} from '../../../../../src/backend/middlewares/user/UserMWs';
import {AuthenticationMWs} from '../../../../../src/backend/middlewares/user/AuthenticationMWs';
import {ObjectManagers} from '../../../../../src/backend/model/ObjectManagers';
import {Config} from '../../../../../src/common/config/private/Config';
import {ErrorCodes, ErrorDTO} from '../../../../../src/common/entities/Error';
import {UserRoles} from '../../../../../src/common/entities/UserDTO';

describe('UserMWs session updates', () => {
  let managers: ObjectManagers;
  const originals: Record<string, unknown> = {};
  const originalAuthenticationRequired = Config.Users.authenticationRequired;
  let errors: any[];

  const invoke = async (method: (req: any, res: any, next: (err?: any) => void) => Promise<void>, req: any) => {
    errors = [];
    await method(req, {}, (err?: any) => { errors.push(err); });
  };

  beforeEach(() => {
    managers = ObjectManagers.getInstance();
    Config.Users.authenticationRequired = true;
    errors = [];
    for (const key of ['UserManager', 'SessionManager', 'ProjectedCacheManager']) {
      originals[key] = (managers as any)[key];
    }
    (managers as any).UserManager = {
      deleteUser: async (id: number) => ({id}),
      changeRole: async (id: number, role: number) => ({id, role, password: 'stored-hash'}),
      updateSettings: async (id: number, settings: unknown) => ({id, settings}),
      findOne: async ({id}: {id: number}) => ({id, name: 'updated', role: UserRoles.Admin, password: 'stored-hash'}),
    };
    (managers as any).SessionManager = {
      buildContext: async (user: any): Promise<any> => ({user}),
      getSessionStamp: async (): Promise<string> => 'fresh-stamp',
    };
    (managers as any).ProjectedCacheManager = {cleanupNonExistingProjections: async (): Promise<void> => undefined};
  });

  afterEach(() => {
    for (const key of Object.keys(originals)) (managers as any)[key] = originals[key];
    Config.Users.authenticationRequired = originalAuthenticationRequired;
  });

  it('delegates user deletion to UserManager without mutating req.session directly', async () => {
    const deletedIds: number[] = [];
    (managers as any).UserManager.deleteUser = async (id: number) => {
      deletedIds.push(id);
      return {id};
    };
    const req: any = {params: {id: '4'}, session: {context: {user: {id: 4}}}};
    await invoke(UserMWs.deleteUser, req);
    expect(errors[0]).to.equal(undefined);
    expect(deletedIds).to.deep.equal([4]);
  });

  it('refreshes the current user session via AuthenticationMWs.refreshSession after a role change without password', async () => {
    const req: any = {
      params: {id: '4'},
      body: {newRole: UserRoles.Admin},
      session: {context: {user: {id: 4}}, rememberMe: true},
      sessionOptions: {},
    };
    await invoke(UserMWs.changeRole, req);
    expect(errors[0]).to.equal(undefined);
    await invoke(AuthenticationMWs.refreshSession, req);
    expect(errors[0]).to.equal(undefined);
    expect(req.session.context.user).to.include({id: 4, role: UserRoles.Admin});
    expect(req.session.context.user.password).to.equal(undefined);
    expect(req.session.stamp).to.equal('fresh-stamp');
  });

  it('cleans obsolete projections on own settings update and refreshes session via AuthenticationMWs.refreshSession', async () => {
    let cleanupCalls = 0;
    (managers as any).ProjectedCacheManager.cleanupNonExistingProjections = async () => { cleanupCalls++; };
    const req: any = {
      params: {id: '1'},
      body: {settings: {public: true}},
      session: {context: {user: {id: 1}}},
      sessionOptions: {},
    };
    await invoke(UserMWs.updateSettings, req);
    expect(errors[0]).to.equal(undefined);
    expect(cleanupCalls).to.equal(1);
    await invoke(AuthenticationMWs.refreshSession, req);
    expect(errors[0]).to.equal(undefined);
    expect(req.session.context.user).to.include({id: 1, name: 'updated'});
    expect(req.session.context.user.password).to.equal(undefined);
    expect(req.session.stamp).to.equal('fresh-stamp');
  });

  it('rejects management when authentication is disabled', async () => {
    Config.Users.authenticationRequired = false;
    await invoke(UserMWs.deleteUser, {params: {id: '1'}, session: {}});
    expect(errors[0]).to.be.instanceOf(ErrorDTO);
    expect(errors[0].code).to.equal(ErrorCodes.USER_MANAGEMENT_DISABLED);
  });

  it('converts manager failures without replacing the session context', async () => {
    (managers as any).UserManager.changeRole = async () => { throw new Error('write failed'); };
    const originalContext = {user: {id: 1, role: UserRoles.User}};
    const req: any = {params: {id: '1'}, body: {newRole: UserRoles.Admin}, session: {context: originalContext}};
    await invoke(UserMWs.changeRole, req);
    expect(errors[0]).to.be.instanceOf(ErrorDTO);
    expect(errors[0].code).to.equal(ErrorCodes.GENERAL_ERROR);
    expect(req.session.context).to.equal(originalContext);
  });
});
