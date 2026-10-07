import {Express} from 'express';
import {PublicRouter} from './PublicRouter';
import {UserRouter} from './UserRouter';
import {GalleryRouter} from './GalleryRouter';
import {PersonRouter} from './PersonRouter';
import {SharingRouter} from './SharingRouter';
import {AdminRouter} from './admin/AdminRouter';
import {SettingsRouter} from './admin/SettingsRouter';
import {NotificationRouter} from './NotificationRouter';
import {ErrorRouter} from './ErrorRouter';
import {AlbumRouter} from './AlbumRouter';
import {ExtensionRouter} from './admin/ExtensionRouter';
import {VersionMWs} from '../middlewares/VersionMWs';
import {OIDCRouter} from './OIDCRouter';
import {UploadRouter} from './UploadRouter';
import {TimelineRouter} from './TimelineRouter';
import {CSRFProtection} from '../middlewares/CSRFProtection';

export class Router {
  public static route(app: Express): void {
    app.use(VersionMWs.injectAppVersion);
    PublicRouter.route(app);

    // Enforce CSRF token on state-changing API requests
    app.use(CSRFProtection.validateToken);

    AdminRouter.route(app);
    ExtensionRouter.route(app);
    OIDCRouter.route(app);
    AlbumRouter.route(app);
    GalleryRouter.route(app);
    NotificationRouter.route(app);
    PersonRouter.route(app);
    SettingsRouter.route(app);
    SharingRouter.route(app);
    UserRouter.route(app);
    UploadRouter.route(app);
    TimelineRouter.route(app);

    ErrorRouter.route(app);
  }
}
