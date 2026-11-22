import {ProjectPath} from '../ProjectPath';
import * as path from 'path';
import * as fs from 'fs';
import {SafePath} from './fileaccess/SafePath';
import {UploadUtils} from '../../common/UploadUtils';
import {FileAlreadyExists} from '../exceptions/FileAlreadyExists';
import {DirectoryNotFound} from '../exceptions/DirectoryNotFound';
import {FolderNotWritable} from '../exceptions/FolderNotWritable';
import {ObjectManagers} from './ObjectManagers';
import {DiskManager} from './fileaccess/DiskManager';
import {Config} from '../../common/config/private/Config';
import {PG2ConfMap} from '../../common/PG2ConfMap';

export interface UploadError {
  filename: string;
  error: string;
}

// saved by multer to the temp folder; tooLarge: above Upload.maxFileSizeMB, nothing is saved then
export type UploadedFile = Express.Multer.File & { tooLarge?: boolean };

// the disk refuses to write to the folder: every file would fail the same way
const NOT_WRITABLE = ['EACCES', 'EPERM', 'EROFS'];
// link() cannot make a hard link here (another disk or a file system without hard links): copy instead
const NO_HARD_LINK = ['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'];

export class UploadManager {
  // inside ProjectPath.TempFolder
  public static readonly TEMP_SUBFOLDER = 'upload';

  /**
   * The folder where multer saves the uploaded files before they are moved to the gallery.
   * It must be a real folder inside TempFolder: a symlink that leads elsewhere is refused.
   */
  public static async getTempFolder(): Promise<string> {
    const tempFolder = SafePath.resolve(ProjectPath.TempFolder, UploadManager.TEMP_SUBFOLDER);
    await fs.promises.mkdir(tempFolder, {recursive: true});
    await SafePath.resolveExisting(ProjectPath.TempFolder, UploadManager.TEMP_SUBFOLDER);
    if (!(await fs.promises.lstat(tempFolder)).isDirectory()) {
      throw new Error('The upload temp folder is not a folder');
    }
    return tempFolder;
  }

  /**
   * Removes the upload temp files that a previous run left behind (e.g. it was killed during an upload).
   * Call it on startup, before any upload can start. rm() removes a symlink itself, not its target.
   */
  public static async removeStaleTempFiles(): Promise<void> {
    const tempFolder = SafePath.resolve(ProjectPath.TempFolder, UploadManager.TEMP_SUBFOLDER);
    await fs.promises.rm(tempFolder, {recursive: true, force: true});
  }

  public async saveFiles(directory: string, files: UploadedFile[]): Promise<UploadError[]> {
    if (Config.Upload.enabled === false) {
      throw new FolderNotWritable('Upload is disabled');
    }
    const relativeDir = directory || '';
    const fullDirPath = SafePath.resolve(ProjectPath.ImageFolder, relativeDir);
    await UploadManager.assertDirectoryExists(relativeDir);

    if (Config.Upload.enforcedDirectoryConfig === true) {
      let hasUploadConf = false;
      for (const filename of Object.keys(PG2ConfMap.upload)) {
        try {
          await SafePath.resolveExisting(ProjectPath.ImageFolder,
            path.relative(ProjectPath.ImageFolder, path.join(fullDirPath, filename)));
          hasUploadConf = true;
          break;
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
      if (!hasUploadConf) {
        throw new FolderNotWritable('Upload is not enabled in this directory');
      }
    }

    const errors: UploadError[] = [];
    let notWritable: FolderNotWritable = null;
    for (const file of files) {
      try {
        await this.saveFile(directory, file);
      } catch (e) {
        if (NOT_WRITABLE.includes(e.code)) {
          // only the code: the path on the disk is not the client's business
          notWritable = new FolderNotWritable('Cannot write to this folder (' + e.code + ')');
          break;
        }
        errors.push({filename: file.originalname, error: e.message});
      }
    }
    const dto = DiskManager.getDTOFromPath(directory || '');
    await ObjectManagers.getInstance().onDataChange(dto);

    if (notWritable) {
      throw notWritable;
    }
    return errors;
  }

  public async saveFile(directory: string, file: UploadedFile): Promise<void> {
    const relativeDir = directory || '';
    const fullDirPath = SafePath.resolve(ProjectPath.ImageFolder, relativeDir);

    const basename = file.originalname;
    // the filename must be a plain name, no path components
    if (!basename || basename === '.' || basename === '..' ||
      /[/\\\0]/.test(basename) || path.basename(basename) !== basename) {
      throw new Error('Invalid filename: ' + basename);
    }

    const extension = UploadUtils.getExtension(basename);
    if (!UploadUtils.isUploadableExtension(extension, Config.Upload.blockedExtensions)) {
      throw new Error('Unsupported file format: ' + extension);
    }

    if (file.tooLarge) {
      throw new Error('File is larger than the upload limit of ' + Config.Upload.maxFileSizeMB + ' MB: ' + basename);
    }
    if (!file.path) {
      throw new Error('Upload failed: ' + basename);
    }

    const relativeFile = path.relative(ProjectPath.ImageFolder, SafePath.resolve(fullDirPath, basename));
    // upload never creates folders, only saves to existing ones
    await UploadManager.assertDirectoryExists(relativeDir);
    const fullFilePath = await SafePath.resolveForWrite(ProjectPath.ImageFolder, relativeFile);

    await UploadManager.moveWithoutOverwrite(file.path, fullFilePath, relativeFile, basename);
    await fs.promises.rm(file.path, {force: true});
  }

  /**
   * Never replaces an existing file (unlike rename()): link() and the exclusive 'wx' open both fail with EEXIST
   * on an existing target, also on a symlink in its place.
   */
  private static async moveWithoutOverwrite(tempPath: string, fullFilePath: string,
                                            relativeFile: string, basename: string): Promise<void> {
    try {
      await fs.promises.link(tempPath, fullFilePath);
      return;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // only the name: the path on the disk is not the client's business
        throw new FileAlreadyExists('File already exists: ' + basename, basename);
      }
      if (!NO_HARD_LINK.includes(err.code)) {
        throw err;
      }
    }

    // Exclusive creation rejects existing files and final-component symlinks.
    // An open failure must never trigger cleanup of a file we did not create.
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(fullFilePath, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new FileAlreadyExists('File already exists: ' + basename, basename);
      }
      throw err;
    }
    // streamed: the file is never held in RAM
    const source = fs.createReadStream(tempPath);
    try {
      try {
        await handle.writeFile(source);
      } finally {
        // a failed write may leave the source open
        source.destroy();
        await handle.close();
      }
    } catch (err) {
      try {
        await SafePath.resolveExisting(ProjectPath.ImageFolder, relativeFile);
        await fs.promises.unlink(fullFilePath);
      } catch {
        // Preserve the write error if cleanup fails or the parent is no longer safe.
      }
      throw err;
    }
  }

  /**
   * The folder must exist inside ImageFolder. A missing folder (or a file in its place) is DirectoryNotFound;
   * other errors (e.g. a symlink that escapes ImageFolder) fail as they are.
   */
  private static async assertDirectoryExists(relativeDir: string): Promise<void> {
    let fullDirPath: string;
    try {
      fullDirPath = await SafePath.resolveExisting(ProjectPath.ImageFolder, relativeDir);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        throw new DirectoryNotFound('Directory not found');
      }
      throw err;
    }
    if (!(await fs.promises.stat(fullDirPath)).isDirectory()) {
      throw new DirectoryNotFound('Directory not found');
    }
  }
}
