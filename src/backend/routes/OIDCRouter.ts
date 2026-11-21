import {Express} from 'express';
import {Config} from '../../common/config/private/Config';
import {RateLimiter} from '../middlewares/RateLimiter';
import {AuthenticationMWs} from '../middlewares/user/AuthenticationMWs';
import {OIDCMWs} from '../middlewares/user/OIDCMWs';

export class OIDCRouter {
  private static get BASE(): string {
    return Config.Server.apiPath + '/auth/oidc';
  }

  public static route(app: Express): void {
    this.addLogin(app);
    this.addCallback(app);
  }

  private static addLogin(app: Express): void {
    app.get(
      OIDCRouter.BASE + '/login',
      RateLimiter.oidcLoginLimiter,
      OIDCMWs.isEnabled,
      OIDCMWs.redirectToProvider
    );
  }

  private static addCallback(app: Express): void {
    app.get(
      OIDCRouter.BASE + '/callback',
      RateLimiter.oidcCallbackLimiter,
      OIDCMWs.isEnabled,
      AuthenticationMWs.oidcLogin,
      OIDCMWs.redirectToApp
    );
  }
}
