import * as http from 'node:http';
import {AddressInfo} from 'node:net';
import express, {NextFunction, Request, Response} from 'express';
import {expect} from 'chai';
import {RenderingMWs} from '../../../../src/backend/middlewares/RenderingMWs';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';

describe('RenderingMWs', () => {

  describe('renderError', () => {
    // The HTTP status of every error code (#1305). An ErrorDTO must never go out as a 2xx.
    const expectedStatus = (code: ErrorCodes): number => {
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
        case ErrorCodes.PATH_ERROR: // e.g. a file that is not on the disk anymore
        case ErrorCodes.SHARING_NOT_FOUND:
        case ErrorCodes.LocationLookUp_ERROR:
          return 404;
        // the errors of what the user sent
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
    };

    let server: http.Server;
    let port: number;

    before(async () => {
      const app = express();
      app.get('/error/:code', (req: Request, res: Response, next: NextFunction) => {
        next(new ErrorDTO(parseInt(req.params['code'] as string, 10) as ErrorCodes, 'test error'));
      });
      // a status set on purpose before the error (e.g. by the rate limiter)
      app.get('/preset/:status/:code', (req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Retry-After', '60');
        res.status(parseInt(req.params['status'] as string, 10));
        next(new ErrorDTO(parseInt(req.params['code'] as string, 10) as ErrorCodes, 'test error'));
      });
      // an http-errors error of express or one of its middlewares
      app.get('/client-error', (req: Request, res: Response, next: NextFunction) => {
        const err = Object.assign(new Error('Range Not Satisfiable'), {
          status: 416,
          headers: {'Content-Range': 'bytes */100'}
        });
        next(err);
      });
      app.use('/api', RenderingMWs.notFound);
      app.use(RenderingMWs.renderError);
      // not an ErrorDTO and not a client error: passed on
      app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
        res.status(599).json({passedOn: err.message});
      });
      await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    after((done: () => void) => {
      server.close(() => done());
    });

    const get = (url: string): Promise<{ status: number, headers: http.IncomingHttpHeaders, body: any }> =>
      new Promise((resolve, reject) => {
        http.get({host: '127.0.0.1', port, path: url}, (res) => {
          let text = '';
          res.on('data', (c: Buffer) => text += c.toString('utf8'));
          res.on('end', () => resolve({status: res.statusCode!, headers: res.headers, body: JSON.parse(text)}));
        }).on('error', reject);
      });

    const codes = Object.values(ErrorCodes)
      .filter((c): c is ErrorCodes => typeof c === 'number');

    for (const code of codes) {
      it('should render ' + ErrorCodes[code] + ' with HTTP ' + expectedStatus(code), async () => {
        const res = await get('/error/' + code);
        expect(res.body.error.code).to.equal(code);
        expect(res.status).to.equal(expectedStatus(code));
      });
    }

    it('should keep the status that was set on purpose (rate limiter 429)', async () => {
      const res = await get('/preset/429/' + ErrorCodes.GENERAL_ERROR);
      expect(res.status).to.equal(429);
      expect(res.headers['retry-after']).to.equal('60');
      expect(res.body.error.code).to.equal(ErrorCodes.GENERAL_ERROR);
    });

    it('should keep the status that was set on purpose (503)', async () => {
      const res = await get('/preset/503/' + ErrorCodes.GENERAL_ERROR);
      expect(res.status).to.equal(503);
    });

    it('should answer a client error of express with its own status and headers', async () => {
      const res = await get('/client-error');
      expect(res.status).to.equal(416);
      expect(res.headers['content-range']).to.equal('bytes */100');
      expect(res.body.error.code).to.equal(ErrorCodes.INPUT_ERROR);
    });

    it('should answer an unknown API path with a JSON PATH_ERROR', async () => {
      const res = await get('/api/not/a/route');
      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal(ErrorCodes.PATH_ERROR);
      expect(res.body.error.message).to.equal('Unknown API path: GET /api/not/a/route');
    });
  });

  describe('isClientHttpError', () => {
    it('should only accept errors with a 4xx status', () => {
      expect(RenderingMWs.isClientHttpError(Object.assign(new Error('x'), {status: 400}))).to.be.true;
      expect(RenderingMWs.isClientHttpError(Object.assign(new Error('x'), {status: 500}))).to.be.false;
      expect(RenderingMWs.isClientHttpError(new Error('x'))).to.be.false;
      expect(RenderingMWs.isClientHttpError({status: 404})).to.be.false;
      expect(RenderingMWs.isClientHttpError(null)).to.be.false;
    });
  });
});
