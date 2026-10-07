import {NextFunction, Request, Response} from 'express';
import * as crypto from 'crypto';
import {CookieNames} from '../../common/CookieNames';
import {CustomHeaders} from '../../common/CustomHeaders';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';

export class CSRFProtection {
  private static readonly TOKEN_BYTE_LENGTH = 32;

  /**
   * Generates or reuses a CSRF secret stored in the session, and sets a non-HttpOnly
   * cookie containing the CSRF token for the frontend to read and send via header.
   */
  public static issueToken(req: Request, res: Response, next: NextFunction): void {
    if (req.session) {
      if (!req.session.csrfSecret) {
        req.session.csrfSecret = crypto.randomBytes(CSRFProtection.TOKEN_BYTE_LENGTH).toString('hex');
      }

      // Check if secure cookie should be used
      const isSecure = req.secure || req.protocol === 'https';
      res.cookie(CookieNames.csrfToken, req.session.csrfSecret, {
        path: '/',
        httpOnly: false, // Must be readable by client JavaScript
        sameSite: 'lax',
        secure: isSecure
      });
    }
    return next();
  }

  /**
   * Validates CSRF token on mutating requests (POST, PUT, DELETE, PATCH).
   * Token can be provided via header (PI-GALLERY2-CSRF-TOKEN or X-CSRF-TOKEN) or body (_csrf).
   */
  public static validateToken(req: Request, res: Response, next: NextFunction): void {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    // If there is no session or no active user context/session, CSRF does not apply (e.g. unauthenticated API endpoints)
    if (!req.session || !req.session.context?.user) {
      return next();
    }

    const expectedSecret = req.session.csrfSecret;
    if (!expectedSecret) {
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'CSRF validation failed: missing session CSRF secret'));
    }

    // Look for submitted token in custom headers or body
    const submittedToken =
      (req.headers[CustomHeaders.csrfToken.toLowerCase()] as string) ||
      (req.headers['x-csrf-token'] as string) ||
      (req.body && req.body._csrf);

    if (!submittedToken || typeof submittedToken !== 'string') {
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'CSRF validation failed: missing CSRF token'));
    }

    const expectedBuffer = Buffer.from(expectedSecret);
    const submittedBuffer = Buffer.from(submittedToken);

    if (
      expectedBuffer.length !== submittedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, submittedBuffer)
    ) {
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'CSRF validation failed: invalid CSRF token'));
    }

    return next();
  }
}
