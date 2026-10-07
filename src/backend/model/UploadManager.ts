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
      const hasUploadConf = Object.keys(PG2ConfMap.upload).some(filename => {
        const pg2confPath = path.join(fullDirPath, filename);
        return fs.existsSync(pg2confPath);
      });
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

    const fullFilePath = SafePath.resolve(fullDirPath, basename);

    if (!fs.existsSync(fullDirPath)) {
      await fs.promises.mkdir(fullDirPath, {recursive: true});
    }

    // Atomic exclusive creation with 'wx' flag to prevent overwrite races
    try {
      await fs.promises.writeFile(fullFilePath, file.buffer, {flag: 'wx'});
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new FileAlreadyExists('File already exists: ' + fullFilePath, basename);
      }
      // If error occurs, attempt partial file cleanup
      try {
        await fs.promises.unlink(fullFilePath);
      } catch {
        // ignore if not created
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
