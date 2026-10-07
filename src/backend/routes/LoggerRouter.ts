import {Express, NextFunction, Request, Response} from 'express';
import {LoggerFunction, Logger} from '../Logger';
import {Config} from '../../common/config/private/Config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      _startTime?: number;
      logged?: boolean;
    }
  }
}

/**
 * Adds logging to express
 */
export class LoggerRouter {
  public static sanitizeUrl(urlStr: string): string {
    if (!urlStr) {
      return urlStr;
    }
    try {
      const parsed = new URL(urlStr, 'http://localhost');
      const sensitiveParams = [
        'code',
        'state',
        'session_state',
        'token',
        'access_token',
        'id_token',
        'refresh_token',
        'password',
        'secret',
        'client_secret',
        'sk',
        'sharingKey',
      ];
      for (const p of sensitiveParams) {
        if (parsed.searchParams.has(p)) {
          parsed.searchParams.set(p, '***REDACTED***');
        }
      }
      let pathname = parsed.pathname;
      const sharePathRegex = /(\/share\/)([^/?#]+)(\/key)?/i;
      pathname = pathname.replace(sharePathRegex, '$1***REDACTED***$3');

      return pathname + parsed.search + parsed.hash;
    } catch {
      return urlStr.replace(/([?&](?:code|state|session_state|token|password|secret|sk|sharingKey)=)[^&#]*/gi, '$1***REDACTED***');
    }
  }

  public static log(loggerFn: LoggerFunction, req: Request, res: Response): void {
    if (req.logged === true) {
      return;
    }
    req.logged = true;
    const end = res.end;
    res.end = (a?: any, b?: any, c?: any) => {
      res.end = end;
      res.end(a, b, c);
      loggerFn(
          req.method,
          LoggerRouter.sanitizeUrl(req.url),
          res.statusCode,
          Date.now() - req._startTime + 'ms'
      );
      return res;
    };
  }

  public static route(app: Express): void {
    /* Save start time for all requests */
    app.use((req: Request, res: Response, next: NextFunction): any => {
      req._startTime = Date.now();
      return next();
    });

    app.get(new RegExp('^' + Config.Server.apiPath), (req: Request, res: Response, next: NextFunction): any => {
      LoggerRouter.log(Logger.verbose, req, res);
      return next();
    });

    app.get(
        new RegExp('^/node_modules'),
        (req: Request, res: Response, next: NextFunction): any => {
          LoggerRouter.log(Logger.silly, req, res);
          return next();
        }
    );

    app.use((req: Request, res: Response, next: NextFunction): any => {
      LoggerRouter.log(Logger.debug, req, res);
      return next();
    });
  }
}
