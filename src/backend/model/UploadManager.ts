import {ProjectPath} from '../ProjectPath';
import * as path from 'path';
import * as fs from 'fs';
import {SafePath} from './fileaccess/SafePath';
import {SupportedFormats} from '../../common/SupportedFormats';
import {FileAlreadyExists} from '../exceptions/FileAlreadyExists';
import {ObjectManagers} from './ObjectManagers';
import {DiskManager} from './fileaccess/DiskManager';
import {Config} from '../../common/config/private/Config';
import {PG2ConfMap} from '../../common/PG2ConfMap';

export interface UploadError {
  filename: string;
  error: string;
}

export class UploadManager {

  public async saveFiles(directory: string, files: Express.Multer.File[]): Promise<UploadError[]> {
    if (Config.Upload.enabled === false) {
      throw new Error('Upload is disabled');
    }
    const relativeDir = directory || '';
    const fullDirPath = SafePath.resolve(ProjectPath.ImageFolder, relativeDir);

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
        throw new Error('Upload is not enabled in this directory');
      }
    }

    const errors: UploadError[] = [];
    for (const file of files) {
      try {
        await this.saveFile(directory, file);
      } catch (e) {
        errors.push({filename: file.originalname, error: e.message});
      }
    }
    const dto = DiskManager.getDTOFromPath(directory || '');
    await ObjectManagers.getInstance().onDataChange(dto);

    return errors;
  }

  public async saveFile(directory: string, file: Express.Multer.File): Promise<void> {
    const relativeDir = directory || '';
    const fullDirPath = SafePath.resolve(ProjectPath.ImageFolder, relativeDir);

    const basename = path.basename(file.originalname);
    const extension = path.extname(basename).toLowerCase().substring(1);
    if (!this.isSupportedExtension(extension)) {
      throw new Error('Unsupported file format: ' + extension);
    }

    const relativeFile = path.relative(ProjectPath.ImageFolder, SafePath.resolve(fullDirPath, basename));
    const fullFilePath = await SafePath.resolveForWrite(ProjectPath.ImageFolder, relativeFile);
    await fs.promises.mkdir(fullDirPath, {recursive: true});

    // Exclusive creation rejects existing files and final-component symlinks.
    // An open failure must never trigger cleanup of a file we did not create.
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(fullFilePath, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new FileAlreadyExists('File already exists: ' + fullFilePath, basename);
      }
      throw err;
    }
    try {
      try {
        await handle.writeFile(file.buffer);
      } finally {
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

  private isSupportedExtension(ext: string): boolean {
    return SupportedFormats.Photos.includes(ext) ||
      SupportedFormats.Videos.includes(ext) ||
      SupportedFormats.MetaFiles.includes(ext);
  }
}
