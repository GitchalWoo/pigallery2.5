import {expect} from 'chai';
import {Request, Response} from 'express';
import {SharingMWs} from '../../../../src/backend/middlewares/SharingMWs';
import {Config} from '../../../../src/common/config/private/Config';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {UserRoles} from '../../../../src/common/entities/UserDTO';
import {SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../src/common/entities/SearchQueryDTO';

describe('SharingMWs management', () => {
  let managers: ObjectManagers;
  const originalEnabled = Config.Sharing.enabled;
  const originalPasswordRequired = Config.Sharing.passwordRequired;
  let originalSharingManager: unknown;
  let calls: Array<{name: string; args: unknown[]}>;
  let error: any;
  let statusCode: number | undefined;

  const invoke = async (method: (req: Request, res: Response, next: (err?: any) => void) => Promise<void>, req: any) => {
    error = undefined;
    statusCode = undefined;
    await method(req as Request, {status: (code: number) => { statusCode = code; }} as unknown as Response, (err?: any) => { error = err; });
  };

  beforeEach(() => {
    managers = ObjectManagers.getInstance();
    Config.Sharing.enabled = true;
    Config.Sharing.passwordRequired = false;
    calls = [];
    originalSharingManager = (managers as any).SharingManager;
    (managers as any).SharingManager = {
      findOne: async (...args: unknown[]) => { calls.push({name: 'findOne', args}); return args[0] === 'key' ? {creator: {id: 2}} : null; },
      createSharing: async (...args: unknown[]) => { calls.push({name: 'createSharing', args}); return args[0]; },
      updateSharing: async (...args: unknown[]) => { calls.push({name: 'updateSharing', args}); return args[0]; },
      deleteSharing: async (...args: unknown[]) => { calls.push({name: 'deleteSharing', args}); return true; },
      listAll: async (...args: unknown[]): Promise<unknown[]> => { calls.push({name: 'listAll', args}); return []; },
      listAllForQuery: async (...args: unknown[]): Promise<unknown[]> => { calls.push({name: 'listAllForQuery', args}); return []; },
    };
  });

  afterEach(() => {
    (managers as any).SharingManager = originalSharingManager;
    Config.Sharing.enabled = originalEnabled;
    Config.Sharing.passwordRequired = originalPasswordRequired;
  });

  it('rejects missing creation data and enforces required passwords', async () => {
    await invoke(SharingMWs.createSharing, {body: {}, params: {}, session: {context: {user: {id: 1}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.INPUT_ERROR);
    expect(calls).to.have.length(0);

    Config.Sharing.passwordRequired = true;
    await invoke(SharingMWs.createSharing, {body: {createSharing: {valid: 1000}}, params: {}, session: {context: {user: {id: 1}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.message).to.equal('Password is required.');
    expect(calls).to.have.length(0);
  });

  it('uses an exact directory query when creating without an explicit search query', async () => {
    const req: any = {body: {createSharing: {valid: -1}}, params: {directory: '/photos'}, session: {context: {user: {id: 1}}}};
    await invoke(SharingMWs.createSharing, req);
    expect(error).to.equal(undefined);
    const created = calls.find(c => c.name === 'createSharing')!.args[0] as any;
    expect(created.searchQuery).to.include({type: SearchQueryTypes.directory, value: '/photos', matchType: TextSearchQueryMatchTypes.exact_match, negate: false});
    expect(created.expires).to.be.greaterThan(Date.now());
  });

  it('updates with role based force flag and treats an empty password as clearing it', async () => {
    for (const [role, force] of [[UserRoles.User, false], [UserRoles.Admin, true]] as const) {
      calls = [];
      const req: any = {body: {updateSharing: {id: 7, valid: 1000, password: ''}}, params: {directory: '/album'}, session: {context: {user: {id: 3, role}}}};
      await invoke(SharingMWs.updateSharing, req);
      expect(error).to.equal(undefined);
      const update = calls.find(c => c.name === 'updateSharing')!;
      expect(update.args[1]).to.equal(force);
      expect((update.args[0] as any).password).to.equal(null);
      expect((update.args[0] as any).searchQuery.value).to.equal('/album');
    }
  });

  it('rejects a missing update payload', async () => {
    await invoke(SharingMWs.updateSharing, {body: {}, params: {}, session: {context: {user: {role: UserRoles.Admin}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.INPUT_ERROR);
    expect(calls).to.have.length(0);
  });

  it('allows owners and admins to delete, but rejects another user', async () => {
    for (const [role, userId, expectedError] of [[UserRoles.User, 2, false], [UserRoles.User, 1, true], [UserRoles.Admin, 1, false]] as const) {
      calls = [];
      const req: any = {params: {sharingKey: 'key'}, session: {context: {user: {id: userId, role}}}};
      await invoke(SharingMWs.deleteSharing, req);
      expect(!!error).to.equal(expectedError);
      if (expectedError) {
        expect(error.code).to.equal(ErrorCodes.NOT_AUTHORISED);
        expect(statusCode).to.equal(401);
        expect(calls.some(c => c.name === 'deleteSharing')).to.equal(false);
      } else {
        expect(req.resultPipe).to.equal('ok');
        expect(calls.some(c => c.name === 'deleteSharing')).to.equal(true);
      }
    }
  });

  it('scopes query listings for regular users and lists all for admins', async () => {
    const query = {type: 'directory'};
    for (const [role, expectedArgs] of [[UserRoles.User, 2], [UserRoles.Admin, 1]] as const) {
      calls = [];
      const req: any = {resultPipe: query, session: {context: {user: {id: 8, role}}}};
      await invoke(SharingMWs.listSharingForQuery, req);
      const call = calls.find(c => c.name === 'listAllForQuery')!;
      expect(call.args).to.have.length(expectedArgs);
      expect(call.args[0]).to.equal(query);
      if (expectedArgs === 2) expect((call.args[1] as any).id).to.equal(8);
    }
  });

  it('does not access the manager when sharing is disabled', async () => {
    Config.Sharing.enabled = false;
    await invoke(SharingMWs.listSharing, {session: {context: {user: {id: 1}}}});
    expect(error).to.equal(undefined);
    expect(calls).to.have.length(0);
  });

  it('converts manager errors from update, delete, and listing paths to middleware errors', async () => {
    (managers as any).SharingManager.listAll = async () => { throw new Error('database unavailable'); };
    await invoke(SharingMWs.listSharing, {session: {context: {user: {id: 1}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.GENERAL_ERROR);

    (managers as any).SharingManager.updateSharing = async () => { throw new Error('update failed'); };
    await invoke(SharingMWs.updateSharing, {body: {updateSharing: {id: 1, valid: -1}}, params: {}, session: {context: {user: {id: 1, role: UserRoles.Admin}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.GENERAL_ERROR);

    (managers as any).SharingManager.deleteSharing = async () => { throw new Error('delete failed'); };
    await invoke(SharingMWs.deleteSharing, {params: {sharingKey: 'key'}, session: {context: {user: {id: 1, role: UserRoles.Admin}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.GENERAL_ERROR);

    (managers as any).SharingManager.listAllForQuery = async () => { throw new Error('query failed'); };
    await invoke(SharingMWs.listSharingForQuery, {resultPipe: {}, session: {context: {user: {id: 1, role: UserRoles.Admin}}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.GENERAL_ERROR);
  });
});
