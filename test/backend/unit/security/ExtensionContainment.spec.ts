import assert from 'assert/strict';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import {Config} from '../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {ExtensionManager} from '../../../../src/backend/model/extension/ExtensionManager';
import {ExtensionPath} from '../../../../src/backend/model/extension/ExtensionPath';
import {ExtensionConfigTemplateLoader} from '../../../../src/backend/model/extension/ExtensionConfigTemplateLoader';
import {ServerExtensionsEntryConfig} from '../../../../src/common/config/private/subconfigs/ServerExtensionsConfig';

describe('Extension filesystem containment', () => {
  let root: string;
  let originalFolder: string;
  let originalEnabled: boolean;
  let manager: ExtensionManager;
  beforeEach(() => {
    originalFolder = ProjectPath.ExtensionFolder;
    originalEnabled = Config.Extensions.enabled;
    Config.Extensions.enabled = true;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-extension-containment-'));
    ProjectPath.ExtensionFolder = path.join(root, 'extensions');
    fs.mkdirSync(ProjectPath.ExtensionFolder);
    fs.mkdirSync(path.join(root, 'outside'));
    fs.writeFileSync(path.join(root, 'outside/keep'), 'keep');
    manager = new ExtensionManager();
  });
  afterEach(() => {
    ProjectPath.ExtensionFolder = originalFolder;
    Config.Extensions.enabled = originalEnabled;
    fs.rmSync(root, {recursive: true, force: true});
  });

  for (const name of ['', '.', '..', '../outside', '/outside', 'a/b', 'a\\b', 'C:drive', 'a\0b']) {
    it(`rejects invalid extension names before install, reload, or delete: ${JSON.stringify(name)}`, async () => {
      await assert.rejects(manager.installExtension(name), /Invalid extension/);
      await assert.rejects(manager.reloadExtension(name), /Invalid extension/);
      await assert.rejects(manager.deleteExtension(name), /Invalid extension/);
      assert.equal(fs.readFileSync(path.join(root, 'outside/keep'), 'utf8'), 'keep');
    });
  }

  it('rejects external, internal, and dangling extension folder aliases', async () => {
    fs.mkdirSync(path.join(ProjectPath.ExtensionFolder, 'real'));
    for (const [name, target] of [['external', path.join(root, 'outside')], ['internal', 'real'], ['dangling', 'missing']]) {
      fs.symlinkSync(target, path.join(ProjectPath.ExtensionFolder, name));
      assert.throws(() => ExtensionPath.folder(name), /symbolic link/);
      await assert.rejects(manager.deleteExtension(name), /symbolic link/);
    }
    assert.ok(fs.existsSync(path.join(ProjectPath.ExtensionFolder, 'real')));
  });

  it('rejects linked extension code, config, and package files before loading', async () => {
    const ext = path.join(ProjectPath.ExtensionFolder, 'sample');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(root, 'outside/code.js'), 'throw new Error("OUTSIDE CODE EXECUTED")');
    for (const file of ['server.js', 'config.js', 'package.json']) {
      fs.symlinkSync(path.join(root, 'outside/code.js'), path.join(ext, file));
      assert.throws(() => ExtensionPath.optionalEntry(ext, file), /symlink escapes/);
    }
    assert.throws(() => new ExtensionConfigTemplateLoader().loadSingleExtension('sample', Config), /symlink escapes/);
    Config.Extensions.extensions.addProperty('sample', {type: ServerExtensionsEntryConfig}, new ServerExtensionsEntryConfig('sample'));
    try {
      await assert.rejects((manager as any).initSingleExtension('sample'), /symlink escapes/);
    } finally {
      Config.Extensions.extensions.removeProperty('sample');
    }
  });

  it('does not execute external code during cleanup', async () => {
    const ext = path.join(ProjectPath.ExtensionFolder, 'sample');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(root, 'outside/code.js'), 'throw new Error("OUTSIDE CODE EXECUTED")');
    fs.symlinkSync(path.join(root, 'outside/code.js'), path.join(ext, 'server.js'));
    manager.extObjects.sample = {folder: 'sample'} as any;
    await assert.rejects((manager as any).cleanUpSingleExtension('sample'), /symlink escapes/);
  });

  it('rejects directory modules and dangling code links', () => {
    const ext = path.join(ProjectPath.ExtensionFolder, 'sample');
    fs.mkdirSync(ext);
    fs.mkdirSync(path.join(ext, 'server.js'));
    assert.throws(() => ExtensionPath.optionalEntry(ext, 'server.js'), /entry type/);
    fs.symlinkSync('missing.js', path.join(ext, 'config.js'));
    assert.throws(() => ExtensionPath.optionalEntry(ext, 'config.js'), /ENOENT/);
  });

  it('loads contained code and resolves cleanup under the extension root', async () => {
    const ext = path.join(ProjectPath.ExtensionFolder, 'sample');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'server.js'), 'exports.cleanUp = obj => { obj.cleaned = true; };');
    const obj: any = {folder: 'sample', messengers: {cleanUp() {}}};
    manager.extObjects.sample = obj;
    await (manager as any).cleanUpSingleExtension('sample');
    assert.equal(obj.cleaned, true);
    assert.equal(manager.extObjects.sample, undefined);
    delete require.cache[path.join(ext, 'server.js')];
  });

  it('ignores private download staging during extension discovery', () => {
    fs.mkdirSync(path.join(ProjectPath.ExtensionFolder, '.download-test'));
    fs.writeFileSync(path.join(ProjectPath.ExtensionFolder, 'archive.zip'), 'archive');
    fs.mkdirSync(path.join(ProjectPath.ExtensionFolder, 'sample'));
    assert.deepEqual((new ExtensionConfigTemplateLoader() as any).getExtensionFolders(), ['sample']);
  });

  async function extract(zip: AdmZip): Promise<void> {
    const archive = path.join(ProjectPath.ExtensionFolder, 'archive.zip');
    zip.writeZip(archive);
    const target = path.join(ProjectPath.ExtensionFolder, 'sample');
    fs.mkdirSync(target, {recursive: true});
    await (manager as any).unzipFile(archive, target);
  }

  for (const name of ['../escape', '/absolute', 'C:/escape', 'dir/../../escape', 'dir\\escape', 'a/./b']) {
    it(`rejects unsafe archive names before extracting: ${name}`, async () => {
      const zip = new AdmZip();
      const entry = zip.addFile('placeholder', Buffer.from('bad'));
      entry.entryName = name;
      await assert.rejects(extract(zip), /Unsafe extension archive/);
      assert.deepEqual(fs.readdirSync(path.join(ProjectPath.ExtensionFolder, 'sample')), []);
      assert.equal(fs.readFileSync(path.join(root, 'outside/keep'), 'utf8'), 'keep');
    });
  }

  it('rejects archive symlinks', async () => {
    const zip = new AdmZip();
    const entry = zip.addFile('link', Buffer.from('../../outside'));
    entry.attr = (0o120777 << 16) >>> 0;
    await assert.rejects(extract(zip), /Unsafe extension archive/);
  });

  for (const wrapped of [false, true]) {
    it(`extracts normal ${wrapped ? 'wrapped' : 'flat'} archives and nested files`, async () => {
      const zip = new AdmZip();
      const prefix = wrapped ? 'repository-main/' : '';
      zip.addFile(prefix + 'server.js', Buffer.from('module.exports = {};'));
      zip.addFile(prefix + 'assets/icon.txt', Buffer.from('icon'));
      await extract(zip);
      const ext = path.join(ProjectPath.ExtensionFolder, 'sample');
      assert.equal(fs.readFileSync(path.join(ext, 'assets/icon.txt'), 'utf8'), 'icon');
      assert.deepEqual(fs.readdirSync(ext).sort(), ['assets', 'server.js']);
    });
  }

  it('does not overwrite existing files or follow destination symlinks', async () => {
    const ext = path.join(ProjectPath.ExtensionFolder, 'sample');
    fs.mkdirSync(ext);
    fs.symlinkSync(path.join(root, 'outside/keep'), path.join(ext, 'server.js'));
    const zip = new AdmZip();
    zip.addFile('server.js', Buffer.from('overwrite'));
    await assert.rejects(extract(zip), /symlink escapes/);
    assert.equal(fs.readFileSync(path.join(root, 'outside/keep'), 'utf8'), 'keep');
    assert.deepEqual(fs.readdirSync(ext), ['server.js']);
  });

  it('cleans download staging when installation fails', async () => {
    manager.repository.getExtensionList = async () => [{id: 'sample', zipUrl: 'https://example.invalid/extension.zip'} as any];
    (manager as any).downloadFile = async () => { throw new Error('download failed'); };
    await assert.rejects(manager.installExtension('sample'), /download failed/);
    assert.deepEqual(fs.readdirSync(ProjectPath.ExtensionFolder), []);
  });
});
