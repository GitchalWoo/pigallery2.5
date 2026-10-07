import {NextFunction, Request, Response} from 'express';
import {ObjectManagers} from '../model/ObjectManagers';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
    parts: 10,
  },
}).array('files');

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
      try {
        if (err) {
          if (err.code?.startsWith('LIMIT_')) {
            res.sendStatus(413);
            return;
          }
          return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, err.message));
        }

        const files = req.files as Express.Multer.File[];
        if (!files || files.length === 0) {
          return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, 'No files uploaded'));
        }

        try {
          const directory = (req.params['directory'] as string) || '';
          req.resultPipe = await ObjectManagers.getInstance().UploadManager.saveFiles(directory, files);
          return next();
        } catch (e) {
          return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, e.message || e));
        }
      } finally {
        release();
      }
    });
  }

}
