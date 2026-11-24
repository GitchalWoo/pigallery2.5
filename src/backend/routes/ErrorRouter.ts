import {RenderingMWs} from '../middlewares/RenderingMWs';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {Logger} from '../Logger';
import {Express, NextFunction, Request, Response} from 'express';
import {Config} from '../../common/config/private/Config';

export class ErrorRouter {
  public static route(app: Express): void {
    this.addApiNotFound(app);
    this.addApiErrorHandler(app);
    this.addGenericHandler(app);
  }

  // every API route (also the extension router) is added before this, so the path is unknown
  private static addApiNotFound(app: Express): void {
    app.use(Config.Server.apiPath, RenderingMWs.notFound);
  }

  private static addApiErrorHandler(app: Express): void {
    app.use(Config.Server.apiPath, RenderingMWs.renderError);
  }

  private static addGenericHandler(app: Express): void {
    app.use(
        (err: any, req: Request, res: Response, next: NextFunction): any => {
          if (err.name === 'UnauthorizedError') {
            // jwt authentication error
            res.status(401);
            return next(
                new ErrorDTO(ErrorCodes.NOT_AUTHENTICATED, 'Invalid token')
            );
          }
          if (RenderingMWs.isClientHttpError(err)) {
            // not a server fault: renderError answers with its status
            return next(err);
          }

          console.log(err);

          // Flush out the stack to the console
          Logger.error('Unexpected error:');
          console.error(err);
          res.status(500);
          return next(
              new ErrorDTO(
                  ErrorCodes.INTERNAL,
                  'Unknown server side error',
                  err,
                  req
              )
          );
        },
        RenderingMWs.renderError
    );
  }
}
