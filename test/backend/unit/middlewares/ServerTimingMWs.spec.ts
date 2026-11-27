import {expect} from 'chai';
import {NextFunction, Request, Response} from 'express';
import {Config} from '../../../../src/common/config/private/Config';
import {ServerTime} from '../../../../src/backend/middlewares/ServerTimingMWs';

describe('ServerTime', () => {
  let logServerTiming: boolean;

  beforeEach(() => {
    logServerTiming = Config.Server.Log.logServerTiming;
    Config.Server.Log.logServerTiming = true;
  });

  afterEach(() => {
    Config.Server.Log.logServerTiming = logServerTiming;
  });

  const timed = () => {
    class Middlewares {
      @ServerTime('1.test', 'Test')
      static async failing(_req: Request, _res: Response, _next: NextFunction): Promise<void> {
        throw new Error('async failure');
      }

      @ServerTime('2.test', 'Test')
      static passing(_req: Request, _res: Response, next: NextFunction): void {
        next();
      }
    }

    return Middlewares;
  };

  it('returns the promise of an async middleware, so Express can catch its rejection', async () => {
    const req = {} as Request;
    const result = (timed().failing as (req: Request, res: Response, next: NextFunction) => unknown)(req, {} as Response, () => undefined);
    expect(result).to.be.instanceOf(Promise);
    const err = await (result as Promise<void>).then((): unknown => null, (e: unknown) => e);
    expect((err as Error).message).to.equal('async failure');
  });

  it('times the middleware and keeps its name', () => {
    const req = {} as Request;
    let called = false;
    const m = timed().passing;
    m(req, {} as Response, () => {
      called = true;
    });
    expect(called).to.equal(true);
    expect(req.timing['2.test'].endTime).to.be.a('number');
    expect(m.name).to.equal('passing');
  });
});
