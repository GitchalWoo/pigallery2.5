import {NextFunction, Request, Response} from 'express';
import {MemoryStore, rateLimit, RateLimitRequestHandler} from 'express-rate-limit';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {Config} from '../../common/config/private/Config';

export interface RateLimitOptions {
  windowMs: number;
  maxAttempts: number;
  errorMessage?: string;
  skipAuthenticated?: boolean;
}

export class RateLimiter {
  private static stores: MemoryStore[] = [];

  public static reset(): void {
    for (const store of this.stores) {
      void store.resetAll();
    }
  }

  public static createLimiter(options: RateLimitOptions): RateLimitRequestHandler {
    const store = new MemoryStore();
    this.stores.push(store);

    return rateLimit({
      windowMs: options.windowMs,
      limit: options.maxAttempts,
      store,
      standardHeaders: false,
      legacyHeaders: false,
      validate: {
        trustProxy: false,
        xForwardedForHeader: false,
        forwardedHeader: false,
        ip: false,
      },
      skip: (req: Request): boolean => {
        if (process.env.DISABLE_RATE_LIMITING === 'true') {
          return true;
        }
        if (options.skipAuthenticated) {
          if (!Config.Users.authenticationRequired) {
            return true;
          }
          if (req.session?.context?.user) {
            return true;
          }
        }
        return false;
      },
      handler: (req: Request, res: Response, next: NextFunction): void => {
        const rateLimitInfo = (req as Request & {rateLimit?: {resetTime?: Date}}).rateLimit;
        const resetTimeMs = rateLimitInfo?.resetTime?.getTime();
        const retryAfterSeconds = resetTimeMs
          ? Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000))
          : Math.ceil(options.windowMs / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        res.status(429);
        next(
          new ErrorDTO(
            ErrorCodes.GENERAL_ERROR,
            options.errorMessage || `Too many requests from IP ${req.ip || 'unknown-ip'}. Please try again later.`
          )
        );
      }
    });
  }

  // General ceiling for unauthenticated traffic; authenticated sessions and auth-disabled instances
  // bypass it so high-burst gallery/timeline browsing is never throttled.
  public static generalLimiter = RateLimiter.createLimiter({
    windowMs: 60 * 1000,
    maxAttempts: 600,
    skipAuthenticated: true,
    errorMessage: 'Too many requests. Please wait a minute before trying again.'
  });

  public static loginLimiter = RateLimiter.createLimiter({
    windowMs: 60 * 1000,
    maxAttempts: 10,
    errorMessage: 'Too many login attempts. Please wait a minute before trying again.'
  });

  public static shareLoginLimiter = RateLimiter.createLimiter({
    windowMs: 60 * 1000,
    maxAttempts: 15,
    errorMessage: 'Too many share login attempts. Please wait a minute before trying again.'
  });

  public static oidcLoginLimiter = RateLimiter.createLimiter({
    windowMs: 60 * 1000,
    maxAttempts: 20,
    errorMessage: 'Too many OIDC login requests. Please wait a minute before trying again.'
  });

  public static oidcCallbackLimiter = RateLimiter.createLimiter({
    windowMs: 60 * 1000,
    maxAttempts: 20,
    errorMessage: 'Too many OIDC callback requests. Please wait a minute before trying again.'
  });

  public static zipLimiter = RateLimiter.createLimiter({
    windowMs: 60 * 1000,
    maxAttempts: 20,
    errorMessage: 'Too many archive download requests. Please wait a minute before trying again.'
  });
}
