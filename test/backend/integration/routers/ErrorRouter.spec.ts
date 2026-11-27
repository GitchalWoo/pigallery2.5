import {expect} from 'chai';
import express from 'express';
import {request} from 'chai-http';
import {SuperAgentStatic} from 'superagent';
import {ErrorRouter} from '../../../../src/backend/routes/ErrorRouter';
import {PublicRouter} from '../../../../src/backend/routes/PublicRouter';
import {ExtensionManager} from '../../../../src/backend/model/extension/ExtensionManager';
import {Config} from '../../../../src/common/config/private/Config';
import {ErrorCodes} from '../../../../src/common/entities/Error';

// #1305: unknown API paths answer a JSON 404
describe('ErrorRouter', () => {
  it('keeps the extension API reachable when an extension adds its routes later (reload, install)', async () => {
    const app = express();
    // ExtensionManager.init mounts its router at startup, before the routes and the ErrorRouter
    const extensionRouter = express.Router();
    app.use(ExtensionManager.EXTENSION_API_PATH, extensionRouter);
    app.use((req, _res, next) => {
      req.session = {expires: 0};
      next();
    });
    PublicRouter.route(app);
    ErrorRouter.route(app);
    // a reloaded or newly installed extension adds its routes to the same router
    extensionRouter.get('/sample/hello', (req, res) => {
      res.json({result: 'hello', error: null});
    });

    const hello = await (request.execute(app) as SuperAgentStatic).get(ExtensionManager.EXTENSION_API_PATH + '/sample/hello');
    expect(hello.status).to.equal(200);
    expect(hello.body.result).to.equal('hello');

    const unknown = await (request.execute(app) as SuperAgentStatic).get(ExtensionManager.EXTENSION_API_PATH + '/sample/missing');
    expect(unknown.status).to.equal(404);
    expect(unknown.body.error.code).to.equal(ErrorCodes.PATH_ERROR);
  });

  it('does not answer paths outside of the API', async () => {
    const app = express();
    ErrorRouter.route(app);
    app.get('/gallery', (req, res) => {
      res.send('page');
    });
    const page = await (request.execute(app) as SuperAgentStatic).get('/gallery');
    expect(page.status).to.equal(200);
    const api = await (request.execute(app) as SuperAgentStatic).get(Config.Server.apiPath + 'x/not-the-api');
    expect(api.status).to.equal(404);
    expect(api.body?.error).to.equal(undefined);
  });
});
