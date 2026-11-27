import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import {type Server} from 'node:http';
import {type AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {ExtensionManager} from '../../../../../src/backend/model/extension/ExtensionManager';
import {DiskManager} from '../../../../../src/backend/model/fileaccess/DiskManager';
import {Config} from '../../../../../src/common/config/private/Config';
import {ServerExtensionsEntryConfig} from '../../../../../src/common/config/private/subconfigs/ServerExtensionsConfig';

describe('ExtensionManager reload', () => {
  const folders = ['p13-reload', 'p13-neighbor'];
  let root: string;
  let originalFolder: string;
  let originalEnabled: boolean;
  let manager: ExtensionManager;
  let server: Server;
  let url: string;

  const writeExtension = async (folder: string, version: string, route: string, fail = false): Promise<void> => {
    const extension = path.join(root, folder);
    await fs.mkdir(extension, {recursive: true});
    await fs.writeFile(path.join(extension, 'version.js'), `module.exports = ${JSON.stringify(version)};`);
    await fs.writeFile(path.join(extension, 'server.js'), `
      const fs = require('node:fs');
      const version = require('./version');
      const log = action => fs.appendFileSync(__dirname + '/events.log', action + ' ' + version + '\\n');
      exports.init = ext => {
        log('init');
        ext.RESTApi.get.rawMiddleware([${JSON.stringify(route)}], 0, (_req, res) => res.send(version));
        ext.events.gallery.DiskManager.excludeDir.before(async input => {
          log('before');
          return input;
        });
        ext.events.gallery.DiskManager.excludeDir.after(async ({output}) => {
          log('after');
          return output;
        });
        if (${fail}) throw new Error('init failed');
      };
      exports.cleanUp = () => log('cleanup');
    `);
  };
  const readLog = async (folder: string): Promise<string[]> =>
    (await fs.readFile(path.join(root, folder, 'events.log'), 'utf8')).trim().split('\n');
  const get = async (folder: string, route: string): Promise<[number, string]> => {
    const response = await fetch(`${url}/${folder}/${route}`);
    return [response.status, await response.text()];
  };
  const triggerEvent = () => DiskManager.excludeDir({name: 'photos', parentDirAbsoluteName: root, parentDirRelativeName: '.'});

  beforeEach(async () => {
    originalFolder = ProjectPath.ExtensionFolder;
    originalEnabled = Config.Extensions.enabled;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-extension-reload-'));
    ProjectPath.ExtensionFolder = root;
    Config.Extensions.enabled = true;
    manager = new ExtensionManager();
    for (const folder of folders) {
      Config.Extensions.extensions.addProperty(folder, {type: ServerExtensionsEntryConfig}, new ServerExtensionsEntryConfig(folder));
    }

    const app = express();
    app.use(ExtensionManager.EXTENSION_API_PATH, manager.handleRequest.bind(manager));
    app.use((_req, res) => res.status(404).send('missing'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + ExtensionManager.EXTENSION_API_PATH;
  });

  afterEach(async () => {
    await manager.cleanUp();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    for (const folder of folders) {
      Config.Extensions.extensions.removeProperty(folder);
      delete require.cache[path.join(root, folder, 'server.js')];
      delete require.cache[path.join(root, folder, 'version.js')];
    }
    Config.Extensions.enabled = originalEnabled;
    ProjectPath.ExtensionFolder = originalFolder;
    await fs.rm(root, {recursive: true, force: true});
  });

  it('runs new code, drops old routes and handlers, and leaves another extension active', async () => {
    const [target, neighbor] = folders;
    await writeExtension(target, 'v1', 'old');
    await writeExtension(neighbor, 'neighbor', 'other');
    await manager.reloadExtension(target);
    await manager.reloadExtension(neighbor);
    assert.deepEqual(await get(target, 'old'), [200, 'v1']);

    await writeExtension(target, 'v2', 'new');
    await Promise.all([manager.reloadExtension(target), manager.reloadExtension(target)]);
    assert.deepEqual(await get(target, 'old'), [404, 'missing']);
    assert.deepEqual(await get(target, 'new'), [200, 'v2']);
    assert.deepEqual(await get(neighbor, 'other'), [200, 'neighbor']);
    await triggerEvent();
    assert.deepEqual(await readLog(target), ['init v1', 'cleanup v1', 'init v2', 'before v2', 'after v2']);
    assert.deepEqual(await readLog(neighbor), ['init neighbor', 'before neighbor', 'after neighbor']);

    await manager.cleanUp();
    assert.deepEqual(await get(target, 'new'), [404, 'missing']);
    assert.deepEqual(await get(neighbor, 'other'), [404, 'missing']);
  });

  it('clears partial registrations after a failed init and can reload again', async () => {
    const [target] = folders;
    await writeExtension(target, 'bad', 'failed', true);
    await assert.rejects(manager.reloadExtension(target), /init failed/);
    assert.deepEqual(await get(target, 'failed'), [404, 'missing']);
    await triggerEvent();
    assert.deepEqual(await readLog(target), ['init bad', 'cleanup bad']);

    await writeExtension(target, 'good', 'working');
    await manager.reloadExtension(target);
    assert.deepEqual(await get(target, 'working'), [200, 'good']);
  });
});
