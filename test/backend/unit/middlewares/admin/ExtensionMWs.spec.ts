import {expect} from 'chai';
import {ExtensionMWs} from '../../../../../src/backend/middlewares/admin/ExtensionMWs';
import {ErrorCodes, ErrorDTO} from '../../../../../src/common/entities/Error';
import {ObjectManagers} from '../../../../../src/backend/model/ObjectManagers';

describe('ExtensionMWs', () => {
  let managers: ObjectManagers;
  let originalExtensionManager: unknown;
  let calls: Array<{name: string; args: unknown[]}>
  let error: any;

  const invoke = async (method: (req: any, res: any, next: (err?: any) => void) => Promise<void>, req: any) => {
    error = undefined;
    await method(req, {}, (err?: any) => { error = err; });
  };

  beforeEach(() => {
    managers = ObjectManagers.getInstance();
    calls = [];
    originalExtensionManager = (managers as any).ExtensionManager;
    (managers as any).ExtensionManager = {
      getExtensionListWithInstallStatus: async () => ['sample'],
      installExtension: async (...args: unknown[]) => { calls.push({name: 'install', args}); },
      reloadExtension: async (...args: unknown[]) => { calls.push({name: 'reload', args}); },
      deleteExtension: async (...args: unknown[]) => { calls.push({name: 'delete', args}); },
    };
  });

  afterEach(() => { (managers as any).ExtensionManager = originalExtensionManager; });

  it('returns the installed extension list', async () => {
    const req: any = {};
    await invoke(ExtensionMWs.getExtensionList, req);
    expect(req.resultPipe).to.deep.equal(['sample']);
    expect(error).to.equal(undefined);
  });

  it('validates required install, reload, and delete fields', async () => {
    await invoke(ExtensionMWs.installExtension, {body: {}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.INPUT_ERROR);
    await invoke(ExtensionMWs.reloadExtension, {body: {}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.INPUT_ERROR);
    await invoke(ExtensionMWs.deleteExtension, {body: {}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.INPUT_ERROR);
    expect(calls).to.have.length(0);
  });

  it('delegates install, reload, and delete requests and reports success', async () => {
    const install: any = {body: {id: 'sample'}};
    await invoke(ExtensionMWs.installExtension, install);
    expect(install.resultPipe).to.deep.equal({success: true});
    const reload: any = {body: {path: 'sample'}};
    await invoke(ExtensionMWs.reloadExtension, reload);
    expect(reload.resultPipe).to.deep.equal({success: true});
    const remove: any = {body: {path: 'sample'}};
    await invoke(ExtensionMWs.deleteExtension, remove);
    expect(remove.resultPipe).to.deep.equal({success: true});
    expect(calls.map(c => c.name)).to.deep.equal(['install', 'reload', 'delete']);
    expect(calls.map(c => c.args[0])).to.deep.equal(['sample', 'sample', 'sample']);
    expect(error).to.equal(undefined);
  });

  it('wraps extension manager failures', async () => {
    (managers as any).ExtensionManager.reloadExtension = async () => { throw new Error('reload failed'); };
    await invoke(ExtensionMWs.reloadExtension, {body: {path: 'sample'}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.JOB_ERROR);
    expect(error.message).to.include('reload failed');
  });
});
