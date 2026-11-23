import {NextFunction, Request, Response} from 'express';
import {Config} from '../../common/config/private/Config';
import {GPXProcessing} from '../model/fileaccess/fileprocessing/GPXProcessing';
import {Logger} from '../Logger';
import {GalleryMWs} from './GalleryMWs';

const LOG_TAG = 'MetaFileMWs';

export class MetaFileMWs {
  public static async compressGPX(
      req: Request,
      res: Response,
      next: NextFunction
  ): Promise<void> {
    if (!req.resultPipe) {
      return next();
    }
    if (Config.MetaFile.GPXCompressing.enabled) {
      const fullPath = req.resultPipe as string;
      try {
        if (await GPXProcessing.compressedGPXExist(fullPath)) {
          req.resultPipe = GPXProcessing.generateConvertedPath(fullPath);
          return next();
        }

        if (Config.MetaFile.GPXCompressing.onTheFly) {
          req.resultPipe = await GPXProcessing.compressGPX(fullPath);
          return next();
        }
      } catch {
        Logger.warn(LOG_TAG, 'Error during compressingGPX: ' + fullPath);
      }
    }
    // The route has loaded the original file already. Check download permission before serving it.
    return GalleryMWs.authoriseDownload(req, res, next);
  }
}

