import {NextFunction, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {randomUUID} from 'crypto';
import {Transform} from 'stream';
import {pipeline} from 'stream/promises';
import {ObjectManagers} from '../model/ObjectManagers';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {Config} from '../../common/config/private/Config';
import {UploadUtils} from '../../common/UploadUtils';
import {UploadedFile, UploadManager} from '../model/UploadManager';
import {FolderNotWritable} from '../exceptions/FolderNotWritable';
import multer = require('multer');

/**
 * Saves each file to TempFolder/upload, so a large file is never held in RAM (a Pi has little of it).
 * A file above Upload.maxFileSizeMB is not saved, only marked as tooLarge: the other files of the request are still uploaded.
 * The engine reports the path only after the file is written; on error it removes its own partial file,
 * a stored file of an aborted request is removed by multer through _removeFile.
 */
class TempFolderStorage implements multer.StorageEngine {
  _handleFile(req: Request, file: Express.Multer.File, cb: (error?: unknown, info?: Partial<UploadedFile>) => void): void {
    // UploadManager rejects it: no need to save it
    if (!UploadUtils.isUploadableExtension(UploadUtils.getExtension(file.originalname || ''), Config.Upload.blockedExtensions)) {
      file.stream.resume();
      return cb(null, {});
    }
    const maxBytes = Config.Upload.maxFileSizeMB * 1024 * 1024;
    let tempPath: string = null;
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, encoding, done): void {
        size += chunk.length;
        // above the limit the rest is read, but not written anymore
        done(null, size > maxBytes ? undefined : chunk);
      }
    });
    UploadManager.getTempFolder()
      .then((tempFolder) => {
        // the name comes from the server, never from the client
        tempPath = path.join(tempFolder, randomUUID());
        return pipeline(file.stream, limit, fs.createWriteStream(tempPath, {flags: 'wx'}));
      })
      .then(async (): Promise<Partial<UploadedFile>> => {
        if (size > maxBytes) {
          await fs.promises.rm(tempPath, {force: true});
          return {size, tooLarge: true};
        }
        return {path: tempPath, size};
      })
      .then(
        (info) => cb(null, info),
        (err) => {
          file.stream.resume();
          const removed = tempPath ? fs.promises.rm(tempPath, {force: true}) : Promise.resolve();
          removed.catch((): void => undefined).finally(() => cb(err));
        });
  }

  _removeFile(req: Request, file: Express.Multer.File, cb: (error: Error | null) => void): void {
    if (!file.path) {
      return cb(null);
    }
    fs.promises.rm(file.path, {force: true}).then(() => cb(null), cb);
  }
}

// browsers send the file name as UTF-8, while multer decodes it as latin1 by default (#1263).
// @types/multer does not know defParamCharset yet, the installed multer does.
// No fileSize limit: TempFolderStorage rejects a large file on its own, so the other files of the request are still saved.
const options: multer.Options & { defParamCharset: string } = {
  storage: new TempFolderStorage(),
  defParamCharset: 'utf8',
  limits: {
    files: 10,
    parts: 10,
  },
};
const upload = multer(options).array('files');

const MAX_CONCURRENT_UPLOADS = 5;
let activeUploads = 0;

export class UploadMWs {
  public static async upload(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
      res.status(429);
      return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, 'Too many concurrent uploads in progress. Please retry shortly.'));
    }

    activeUploads++;
    const release = () => {
      activeUploads = Math.max(0, activeUploads - 1);
    };

    upload(req, res, async (err: any) => {
      let error: ErrorDTO;
      let tooLarge = false;
      try {
        if (err) {
          if (err.code?.startsWith('LIMIT_')) {
            tooLarge = true;
          } else {
            error = new ErrorDTO(ErrorCodes.UPLOAD_ERROR, err.message);
          }
        } else {
          const files = req.files as UploadedFile[];
          if (!files || files.length === 0) {
            error = new ErrorDTO(ErrorCodes.UPLOAD_ERROR, 'No files uploaded');
          } else {
            try {
              const directory = (req.params['directory'] as string) || '';
              req.resultPipe = await ObjectManagers.getInstance().UploadManager.saveFiles(directory, files);
            } catch (e) {
              if (e instanceof FolderNotWritable) {
                res.status(403);
                error = new ErrorDTO(ErrorCodes.PERMISSION_DENIED, e.message);
              } else {
                error = new ErrorDTO(ErrorCodes.UPLOAD_ERROR, e.message || e);
              }
            }
          }
        }
      } finally {
        // before answering: the files that were not moved to the gallery (e.g. one that already exists)
        await UploadMWs.removeTempFiles(req.files as UploadedFile[]);
        release();
      }
      if (tooLarge) {
        res.sendStatus(413);
        return;
      }
      return next(error);
    });
  }

  private static async removeTempFiles(files: UploadedFile[]): Promise<void> {
    if (!Array.isArray(files)) {
      return;
    }
    await Promise.allSettled(files.filter((f) => f.path).map((f) => fs.promises.rm(f.path, {force: true})));
  }

}
