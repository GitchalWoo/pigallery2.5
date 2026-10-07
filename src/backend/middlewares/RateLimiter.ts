import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';

export interface RateLimitOptions {
  windowMs: number;
  maxAttempts: number;
  errorMessage?: string;
}

interface AttemptRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private static stores: Map<string, Map<string, AttemptRecord>> = new Map();

  public static reset(): void {
    this.stores.clear();
  }

  public static createLimiter(category: string, options: RateLimitOptions) {
    if (!this.stores.has(category)) {
      this.stores.set(category, new Map());
    }

    return (req: Request, res: Response, next: NextFunction): void => {
      const store = this.stores.get(category)!;
      const ip = (req.ip || req.socket.remoteAddress || 'unknown-ip').toString();
      const now = Date.now();

      // Clean up or retrieve
      let record = store.get(ip);
      if (!record || record.resetTime <= now) {
        record = {
          count: 1,
          resetTime: now + options.windowMs
        };
        store.set(ip, record);
        return next();
      }

      record.count++;
      if (record.count > options.maxAttempts) {
        const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        res.status(429);
        return next(
          new ErrorDTO(
            ErrorCodes.GENERAL_ERROR,
            options.errorMessage || `Too many requests from IP ${ip}. Please try again later.`
          )
        );
      }

      return next();
    };
  }

  public static loginLimiter = RateLimiter.createLimiter('login', {
    windowMs: 60 * 1000,
    maxAttempts: 10,
    errorMessage: 'Too many login attempts. Please wait a minute before trying again.'
  });

  public static shareLoginLimiter = RateLimiter.createLimiter('shareLogin', {
    windowMs: 60 * 1000,
    maxAttempts: 15,
    errorMessage: 'Too many share login attempts. Please wait a minute before trying again.'
  });

  public static oidcCallbackLimiter = RateLimiter.createLimiter('oidcCallback', {
    windowMs: 60 * 1000,
    maxAttempts: 20,
    errorMessage: 'Too many OIDC callback requests. Please wait a minute before trying again.'
  });
}
