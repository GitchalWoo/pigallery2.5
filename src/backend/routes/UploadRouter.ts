import {AuthenticationMWs} from '../middlewares/user/AuthenticationMWs';
import {RenderingMWs} from '../middlewares/RenderingMWs';
import * as express from 'express';
import {ServerTimingMWs} from '../middlewares/ServerTimingMWs';
import {Config} from '../../common/config/private/Config';
import {UploadMWs} from '../middlewares/UploadMWs';
import {VersionMWs} from '../middlewares/VersionMWs';

export class UploadRouter {
  public static route(app: express.Express): void {
    this.addUpload(app);
  }

  private static addUpload(app: express.Express): void {
    app.post(
      new RegExp(`^${Config.Server.apiPath}/upload(?:/(?<directory>.*))?$`),
      AuthenticationMWs.authenticate,
      AuthenticationMWs.authorise(Config.Upload.minimumRole),
      AuthenticationMWs.normalizePathParam('directory'),
      // the user needs to see the content of the folder (before the body is read)
      AuthenticationMWs.authoriseDirectory('directory'),
      VersionMWs.injectGalleryVersion,

      UploadMWs.upload,

      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderResult
    );
  }

}
