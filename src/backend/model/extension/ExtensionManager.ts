import {ProjectPath} from '../../ProjectPath';
import {Config} from '../../../common/config/private/Config';
import * as fs from 'fs';
import * as path from 'path';
import {pipeline} from 'stream/promises';
import {Readable} from 'stream';
import {IObjectManager} from '../database/IObjectManager';
import {Logger} from '../../Logger';
import {IExtensionEvents, IExtensionObject} from './IExtension';
import {Server} from '../../server';
import {ExtensionEvent} from './ExtensionEvent';
import * as express from 'express';
import {SQLConnection} from '../database/SQLConnection';
import {ExtensionObject} from './ExtensionObject';
import {ExtensionDecoratorObject} from './ExtensionDecorator';
import * as util from 'util';
import AdmZip from 'adm-zip';
import {ServerExtensionsEntryConfig} from '../../../common/config/private/subconfigs/ServerExtensionsConfig';
import {ExtensionRepository} from './ExtensionRepository';
import {ExtensionListItem} from '../../../common/entities/extension/ExtensionListItem';
import {ExtensionConfigTemplateLoader} from './ExtensionConfigTemplateLoader';
import {Utils} from '../../../common/Utils';
import {UIExtensionDTO} from '../../../common/entities/extension/IClientUIConfig';
import {ExtensionConfigWrapper} from './ExtensionConfigWrapper';
import {ExtensionPath} from './ExtensionPath';
import {SafePath} from '../fileaccess/SafePath';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const exec = util.promisify(require('child_process').exec);
const LOG_TAG = '[ExtensionManager]';

export class ExtensionManager implements IObjectManager {

  public static EXTENSION_API_PATH = Config.Server.apiPath + '/extension';
  public repository: ExtensionRepository = new ExtensionRepository();

  events: IExtensionEvents;
  extObjects: { [key: string]: ExtensionObject<unknown> } = {};
  router: express.Router;

  constructor() {
    this.initEvents();
  }


  public async init() {
    this.extObjects = {};
    this.initEvents();
    if (!Config.Extensions.enabled) {
      return;
    }
    this.router = express.Router();
    Server.instance?.app.use(ExtensionManager.EXTENSION_API_PATH, this.router);
    await this.initExtensions();
  }

  public async getExtensionListWithInstallStatus(): Promise<ExtensionListItem[]> {
    const extensionList = await this.repository.getExtensionList();

    // Add installed status to each extension
    return extensionList.map(extension => {
      // Check if the extension is installed by looking for its name in the installed extensions
      const isInstalled = Array.from(Config.Extensions.extensions.keys()).some(
        key => key.toLowerCase() === extension.id.toLowerCase()
      );

      return {
        ...extension,
        installed: isInstalled
      };
    });
  }

  public async cleanUp() {
    if (!Config.Extensions.enabled) {
      return;
    }
    this.initEvents(); // reset events
    await this.cleanUpExtensions();
    Server.instance?.app.use(ExtensionManager.EXTENSION_API_PATH, this.router);
    this.extObjects = {};
  }

  /**
   * Install an extension from the repository
   * @param extensionId - The repository extension ID (not to be confused with the unique internal extensionId used in extObjects)
   */
  public async installExtension(extensionId: string): Promise<void> {
    if (!Config.Extensions.enabled) {
      throw new Error('Extensions are disabled');
    }

    ExtensionPath.validateName(extensionId);
    await fs.promises.mkdir(ProjectPath.ExtensionFolder, {recursive: true});
    const extensionDir = ExtensionPath.folder(extensionId);

    Logger.debug(LOG_TAG, `Installing extension with ID: ${extensionId}`);

    // Get the extension list
    const extensionList = await this.repository.getExtensionList();

    // Find the extension with the given ID
    const extension = extensionList.find(ext => ext.id.toLowerCase() === extensionId.toLowerCase());

    if (!extension) {
      throw new Error(`Extension with ID ${extensionId} not found`);
    }

    if (!extension.zipUrl) {
      throw new Error(`Extension ${extensionId} does not have a zip URL`);
    }

    // Download the zip file
    const downloadDir = await fs.promises.mkdtemp(path.join(ProjectPath.ExtensionFolder, '.download-'));
    let createdDir = false;
    const hadConfig = Config.Extensions.extensions.keys().includes(extensionId);
    const initialObjectIds = new Set(Object.keys(this.extObjects));
    try {
      const zipFilePath = path.join(downloadDir, 'extension.zip');
      Logger.silly(LOG_TAG, `Downloading extension from ${extension.zipUrl} to ${zipFilePath}`);

      await this.downloadFile(extension.zipUrl, zipFilePath);

      // Create the extension directory
      try {
        // Only this successful mkdir gives us ownership for failure cleanup.
        await fs.promises.mkdir(extensionDir);
        createdDir = true;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        ExtensionPath.folder(extensionId);
      }

      // Unzip the file
      Logger.silly(LOG_TAG, `Unzipping extension to ${extensionDir}`);
      await this.unzipFile(zipFilePath, extensionDir);

      // Update the configuration
      Logger.silly(LOG_TAG, `Updating configuration for extension ${extensionId}`);

      ExtensionConfigTemplateLoader.Instance.loadSingleExtension(extensionId, Config);

      // Initialize the extension
      Logger.silly(LOG_TAG, `Initializing extension ${extensionId}`);
      await this.initSingleExtension(extensionId);
    } catch (err) {
      if (createdDir) {
        // Initialization may register an object before throwing. Release only
        // registrations belonging to this failed installation.
        for (const id of Object.keys(this.extObjects)) {
          if (!initialObjectIds.has(id) && this.extObjects[id].folder === extensionId) {
            try {
              await this.cleanUpSingleExtension(id);
            } catch (cleanupError) {
              Logger.warn(LOG_TAG, 'Failed extension initialization cleanup', cleanupError.message);
            } finally {
              delete this.extObjects[id];
            }
          }
        }
        // Never remove a directory that existed before this install attempt.
        const ownedDir = ExtensionPath.folder(extensionId);
        await fs.promises.rm(ownedDir, {recursive: true, force: true});
        if (!hadConfig) Config.Extensions.extensions.removeProperty(extensionId);
      }
      throw err;
    } finally {
      await fs.promises.rm(downloadDir, {recursive: true, force: true});
    }

    Logger.debug(LOG_TAG, `Extension ${extensionId} installed successfully`);
  }

  /**
   * Reload an extension by cleaning up and re-initializing it
   * @param configKey - The key used in Config.Extensions.extensions map (typically the folder name)
   */
  public async reloadExtension(configKey: string): Promise<void> {
    if (!Config.Extensions.enabled) {
      throw new Error('Extensions are disabled');
    }

    ExtensionPath.folder(configKey);
    Logger.debug(LOG_TAG, `Reloading extension with config key: ${configKey}`);

    // Find the unique extension ID by matching the folder name
    let uniqueExtensionId: string = null;
    for (const id of Object.keys(this.extObjects)) {
      if (this.extObjects[id].folder === configKey) {
        uniqueExtensionId = id;
        break;
      }
    }

    if (!uniqueExtensionId) {
      throw new Error(`Extension with config key ${configKey} not found in configuration`);
    }

    // Clean up the extension
    await this.cleanUpSingleExtension(uniqueExtensionId);

    // Re-initialize the extension
    await this.initSingleExtension(configKey);

    Logger.debug(LOG_TAG, `Extension ${uniqueExtensionId} reloaded successfully`);
  }

  /**
   * Delete an extension by cleaning up, removing its folder, and removing it from configuration
   * @param configKey - The key used in Config.Extensions.extensions map (typically the folder name)
   */
  public async deleteExtension(configKey: string): Promise<void> {
    if (!Config.Extensions.enabled) {
      throw new Error('Extensions are disabled');
    }

    const extPath = ExtensionPath.folder(configKey);
    Logger.debug(LOG_TAG, `Deleting extension with config key: ${configKey}`);

    // Find the unique extension ID by matching the folder name
    let uniqueExtensionId: string = null;
    for (const id of Object.keys(this.extObjects)) {
      if (this.extObjects[id].folder === configKey) {
        uniqueExtensionId = id;
        break;
      }
    }

    if (!uniqueExtensionId) {
      // The extension does not have an extension object, probably it had no init function
      Logger.silly(LOG_TAG, `Extension with config key ${configKey} not found in configuration`);
    }else{
      // Clean up the extension
      await this.cleanUpSingleExtension(uniqueExtensionId);
    }

    // Remove the extension folder
    if (fs.existsSync(extPath)) {
      Logger.silly(LOG_TAG, `Removing extension folder: ${extPath}`);
      fs.rmSync(extPath, { recursive: true, force: true });
    }

    // Remove from configuration
    const original = await ExtensionConfigWrapper.original();
    original.Extensions.extensions.removeProperty(configKey);
    await original.save();
    Config.Extensions.extensions.removeProperty(configKey);

    Logger.debug(LOG_TAG, `Extension ${configKey} deleted successfully`);
  }

  getUIExtensionConfigs(): UIExtensionDTO[] {
    return Object.values(this.extObjects)
      .filter(obj => !!obj.ui?.buttonConfigs?.length)
      .map(obj => ({
        mediaButtons: obj.ui.buttonConfigs,
        extensionBasePath: Utils.concatUrls('/extension', obj.extensionId)
      }));
  }

  private initEvents() {
    this.events = {
      gallery: {
        MetadataLoader: {
          loadPhotoMetadata: new ExtensionEvent(),
          loadVideoMetadata: new ExtensionEvent()
        },
        CoverManager: {
          getCoverForDirectory: new ExtensionEvent(),
          getCoverForAlbum: new ExtensionEvent(),
        },
        ProjectedCacheManager: {
          invalidateDirectoryCache: new ExtensionEvent(),
          getCacheForDirectory: new ExtensionEvent()
        },
        DiskManager: {
          excludeDir: new ExtensionEvent(),
          scanDirectory: new ExtensionEvent()
        },
        ImageRenderer: {
          render: new ExtensionEvent()
        },
        VideoConverter: {
          convert: new ExtensionEvent()
        }
      }
    };
    ExtensionDecoratorObject.init(this.events);
  }

  private createUniqueExtensionObject(extensionName: string, folderName: string): IExtensionObject<unknown> {
    let uniqueExtensionId = extensionName;
    if (this.extObjects[uniqueExtensionId]) {
      let i = 0;
      while (this.extObjects[`${extensionName}_${++i}`]) { /* empty */
      }
      uniqueExtensionId = `${extensionName}_${++i}`;
    }
    if (!this.extObjects[uniqueExtensionId]) {
      this.extObjects[uniqueExtensionId] = new ExtensionObject(uniqueExtensionId, extensionName, folderName, this.router, this.events);
    }
    return this.extObjects[uniqueExtensionId];
  }

  /**
   * Initialize a single extension
   * @param configKey The key used in Config.Extensions.extensions map (typically the folder name)
   * @returns Promise that resolves when the extension is initialized
   */
  private async initSingleExtension(configKey: string): Promise<void> {
    const extConf: ServerExtensionsEntryConfig = Config.Extensions.extensions[configKey] as ServerExtensionsEntryConfig;
    if (!extConf) {
      Logger.silly(LOG_TAG, `Skipping ${configKey} initiation. Extension config is missing.`);
      return;
    }
    const folderName = extConf.path;
    let extName = folderName;

    if (extConf.enabled === false) {
      Logger.silly(LOG_TAG, `Skipping ${folderName} initiation. Extension is disabled.`);
      return;
    }

    const extPath = ExtensionPath.folder(folderName);
    const serverExtPath = ExtensionPath.optionalEntry(extPath, 'server.js');
    const packageJsonPath = ExtensionPath.optionalEntry(extPath, 'package.json');

    if (!serverExtPath) {
      Logger.silly(LOG_TAG, `Skipping ${folderName} server initiation. server.js does not exists`);
      return;
    }

    if (packageJsonPath) {
      if (ExtensionPath.optionalEntry(extPath, 'node_modules', true)) {
        Logger.debug(LOG_TAG, `node_modules folder exists. Skipping "npm install".`);
      } else {
        Logger.silly(LOG_TAG, `Running: "npm install --prefer-offline --no-audit --progress=false --omit=dev" in ${extPath}`);
        await exec('npm install  --no-audit --progress=false --omit=dev', {
          cwd: extPath
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require(packageJsonPath);
      if (pkg.name) {
        extName = pkg.name;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ext = require(serverExtPath);
    if (typeof ext?.init === 'function') {
      Logger.debug(LOG_TAG, 'Running init on extension: ' + folderName);
      await ext?.init(this.createUniqueExtensionObject(extName, folderName));
    }
  }

  /**
   * Initialize all extensions
   */
  private async initExtensions() {
    for (const prop of Config.Extensions.extensions.keys()) {
      await this.initSingleExtension(prop);
    }

    if (Config.Extensions.cleanUpUnusedTables) {
      // Clean up tables after all Extension was initialized.
      await SQLConnection.removeUnusedTables();
    }
  }

  private async cleanUpSingleExtension(uniqueExtensionId: string): Promise<void> {
    const extObj = this.extObjects[uniqueExtensionId];
    if (!extObj) {
      Logger.silly(LOG_TAG, `Extension ${uniqueExtensionId} not found in extObjects, skipping cleanup`);
      return;
    }

    const serverExt = ExtensionPath.optionalEntry(ExtensionPath.folder(extObj.folder), 'server.js');
    if (serverExt) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ext = require(serverExt);
      if (typeof ext?.cleanUp === 'function') {
        Logger.debug(LOG_TAG, 'Running cleanUp on extension: ' + extObj.extensionName);
        await ext?.cleanUp(extObj);
      }
    }
    extObj.messengers.cleanUp();

    // Remove from extObjects
    delete this.extObjects[uniqueExtensionId];
  }

  private async cleanUpExtensions() {
    for (const uniqueExtensionId of Object.keys(this.extObjects)) {
      await this.cleanUpSingleExtension(uniqueExtensionId);
    }
  }

  private async downloadFile(url: string, outputPath: string): Promise<void> {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(`Unexpected response ${response.statusText}`);
    }

    const nodeReadable = Readable.fromWeb(response.body as any);

    // Pipe the response body to a file
    outputPath = await SafePath.resolveForWrite(ProjectPath.ExtensionFolder, path.relative(ProjectPath.ExtensionFolder, outputPath));
    await pipeline(nodeReadable, fs.createWriteStream(outputPath, {flags: 'wx'}));
  }

  private async unzipFile(zipFilePath: string, outputPath: string): Promise<void> {
    zipFilePath = await SafePath.resolveExisting(ProjectPath.ExtensionFolder, path.relative(ProjectPath.ExtensionFolder, zipFilePath));
    outputPath = await SafePath.resolveExisting(ProjectPath.ExtensionFolder, path.relative(ProjectPath.ExtensionFolder, outputPath));
    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();
    // Validate the entire archive before writing anything. Reject links and paths
    // rather than relying on the ZIP library to rewrite dangerous entry names.
    for (const entry of entries) {
      const name = entry.entryName;
      const mode = (entry.attr >>> 16) & 0xf000;
      if (!name || name.includes('\\') || name.includes('\0') ||
          name.startsWith('/') || /^[a-zA-Z]:/.test(name) ||
          name.split('/').some(part => part === '..' || part === '.') ||
          (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)) {
        throw new Error('Unsafe extension archive entry');
      }
      SafePath.resolve(outputPath, name);
    }

    const staging = await fs.promises.mkdtemp(path.join(outputPath, '.extract-'));
    try {
      // Use the existing ZIP library in a fresh private directory. Its extractor
      // handles directory creation and rejects pre-existing symlink traversal.
      zip.extractAllTo(staging, false);
      const names = await fs.promises.readdir(staging);
      let source = staging;
      if (names.length === 1 && (await fs.promises.lstat(path.join(staging, names[0]))).isDirectory()) {
        source = await SafePath.resolveExisting(staging, names[0]);
      }
      const files = await fs.promises.readdir(source);
      // Check all destinations before moving; do not overwrite installed files.
      for (const file of files) {
        const target = await SafePath.resolveForWrite(outputPath, file);
        try {
          await fs.promises.lstat(target);
        } catch (err) {
          if (err.code === 'ENOENT') continue;
          throw err;
        }
        throw new Error('Extension destination already exists');
      }
      for (const file of files) {
        const src = await SafePath.resolveExisting(source, file);
        const dest = await SafePath.resolveForWrite(outputPath, file);
        await fs.promises.rename(src, dest);
      }
    } finally {
      await fs.promises.rm(staging, {recursive: true, force: true});
    }
  }
}
