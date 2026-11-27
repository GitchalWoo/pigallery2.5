import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {Message} from '../../common/entities/Message';
import {PrivateConfigClass} from '../../common/config/private/PrivateConfigClass';
import {UserDTO, UserRoles} from '../../common/entities/UserDTO';
import {NotificationManager} from '../model/NotifocationManager';
import {Logger} from '../Logger';
import {ResponseSharingDTO} from '../../common/entities/SharingDTO';
import {Utils} from '../../common/Utils';
import {LoggerRouter} from '../routes/LoggerRouter';
import {TAGS} from '../../common/config/public/ClientConfig';
import {ExtensionConfigWrapper} from '../model/extension/ExtensionConfigWrapper';
import {SharingEntity} from '../model/database/enitites/SharingEntity';
import {Config} from '../../common/config/private/Config';

const forcedDebug = process.env['NODE_ENV'] === 'debug';

export class RenderingMWs {
  public static renderResult(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (typeof req.resultPipe === 'undefined') {
      return next();
    }

    return RenderingMWs.renderMessage(res, req.resultPipe);
  }

  public static renderSessionUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.session.context?.user) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'User not exists'));
    }

    const user = {
      id: req.session.context.user.id,
      name: req.session.context.user.name,
      role: req.session.context.user.role,
      usedSharingKey: req.session.context.user.usedSharingKey,
      ...(req.session.context.user.usedSharingKey ? {preventDownload: req.session.context.user.preventDownload === true} : {}),
      projectionKey: req.session.context.user.projectionKey,
    } as UserDTO;


    RenderingMWs.renderMessage(res, user);
  }

  public static renderSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.resultPipe) {
      return next();
    }

    const {password, creator, ...sharing} = req.resultPipe as SharingEntity;
    (sharing as ResponseSharingDTO).passwordProtected = Config.Sharing.passwordRequired || (typeof password === 'string' && password !== '');
    RenderingMWs.renderMessage(res, sharing);
  }

  public static renderSharingList(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.resultPipe) {
      return next();
    }

    const shares = Utils.clone(req.resultPipe as SharingEntity[]);
    const rs = shares.map((s): ResponseSharingDTO => {
      const ret = s as unknown as ResponseSharingDTO;
      ret.passwordProtected = Config.Sharing.passwordRequired || (typeof s.password === 'string' && s.password !== '');
      delete s.password;
      delete s.creator.password;
      return ret;
    });
    return RenderingMWs.renderMessage(res, rs);
  }

  public static renderFile(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.resultPipe) {
      return next();
    }
    // Protected media should be cached privately
    if (!res.hasHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'private, max-age=31536000');
    }
    return res.sendFile(req.resultPipe as string, {
      cacheControl: false,
      dotfiles: 'allow',
    });
  }

  public static renderOK(
    req: Request,
    res: Response
  ): void {
    const message = new Message<string>(null, 'ok');
    res.json(message);
  }

  public static async renderConfig(
    req: Request,
    res: Response
  ): Promise<void> {
    // Sensitive configuration responses must never be stored in intermediate caches
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const originalConf = await ExtensionConfigWrapper.original();
    // These are sensitive information, do not send to the client side
    originalConf.Server.sessionSecret = null;
    const originalConfJSON = JSON.parse(JSON.stringify(originalConf.toJSON({
      attachState: true,
      attachVolatile: true,
      skipTags: {secret: true} as TAGS
    }) as PrivateConfigClass));

    const message = new Message<PrivateConfigClass>(
      null,
      originalConfJSON
    );
    res.json(message);
  }

  /**
   * Every API route is added before this, so the path is unknown.
   */
  public static notFound(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // a handler that already answered (e.g. a streamed zip) and called next() anyway
    if (res.headersSent) {
      return;
    }
    return next(new ErrorDTO(ErrorCodes.PATH_ERROR, 'Unknown API path: ' + req.method + ' ' + req.baseUrl + req.path));
  }

  public static renderError(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // A second response can't be sent. Do not raise an "unknown server error" for the failed attempt.
    if (res.headersSent) {
      Logger.warn('[RenderingMWs]', 'Error after the response was sent:', req.method,
        LoggerRouter.sanitizeUrl(req.originalUrl), (err as Error)?.message ?? String(err));
      // the client must not take a cut-off response for a complete one
      if (!res.writableEnded) {
        res.destroy();
      }
      return;
    }
    if (err instanceof ErrorDTO) {
      if (err.details) {
        const logFn = Logger.logLevelForError(err.code)
        LoggerRouter.log(logFn, req, res);
        // use separate rendering for detailsStr
        const d = err.detailsStr;
        delete err.detailsStr;
        logFn(err);
        err.detailsStr = d;
        delete err.details; // do not send back error object to the client side

        // hide error details for non developers
        if (
          !(
            forcedDebug ||
            (req.session &&
              req.session.context?.user &&
              req.session.context?.user.role >= UserRoles.Developer)
          )
        ) {
          delete err.detailsStr;
        }
      }
      // A status set on purpose (e.g. 429 of the rate limiter, 503) is kept; otherwise the code tells it.
      if (res.statusCode < 400) {
        res.status(RenderingMWs.httpStatus(err.code));
      }
      const message = new Message<null>(err, null);
      res.json(message);
      return;
    }
    if (RenderingMWs.isClientHttpError(err)) {
      // e.g. a range past the end of a video (send: 416) or a body that is not JSON (body-parser: 400)
      Logger.debug('[RenderingMWs]', 'Client error', req.method, LoggerRouter.sanitizeUrl(req.originalUrl), err.status, err.message);
      res.status(err.status);
      if (err.headers) {
        res.set(err.headers);
      }
      res.json(new Message<null>(new ErrorDTO(ErrorCodes.INPUT_ERROR, err.message), null));
      return;
    }
    NotificationManager.error('Unknown server error', err, req);
    return next(err);
  }

  /**
   * An http-errors error of the client (status 4xx), raised by express or its middlewares.
   */
  public static isClientHttpError(err: unknown): err is Error & { status: number, headers?: Record<string, string> } {
    const status = (err as { status?: unknown })?.status;
    return err instanceof Error && typeof status === 'number' && status >= 400 && status < 500;
  }

  public static httpStatus(code: ErrorCodes): number {
    switch (code) {
      case ErrorCodes.NOT_AUTHENTICATED:
      case ErrorCodes.NOT_AUTHENTICATED_SHARING:
      case ErrorCodes.CREDENTIAL_NOT_FOUND:
        return 401;
      case ErrorCodes.NOT_AUTHORISED:
      case ErrorCodes.PERMISSION_DENIED:
      case ErrorCodes.USER_MANAGEMENT_DISABLED:
        return 403;
      case ErrorCodes.DIRECTORY_NOT_FOUND:
      case ErrorCodes.PATH_ERROR:
      case ErrorCodes.SHARING_NOT_FOUND:
      case ErrorCodes.LocationLookUp_ERROR:
        return 404;
      case ErrorCodes.ALREADY_AUTHENTICATED:
      case ErrorCodes.USER_CREATION_ERROR:
      case ErrorCodes.INPUT_ERROR:
      case ErrorCodes.SETTINGS_ERROR:
      case ErrorCodes.ALBUM_ERROR:
      case ErrorCodes.UPLOAD_ERROR:
        return 400;
      default:
        return 500;
    }
  }

  protected static renderMessage<T>(res: Response, content: T): void {
    const message = new Message<T>(null, content);
    res.json(message);
  }
}
