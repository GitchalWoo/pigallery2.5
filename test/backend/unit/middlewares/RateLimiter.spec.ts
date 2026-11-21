import {expect} from 'chai';
import {RateLimiter} from '../../../../src/backend/middlewares/RateLimiter';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';
import {Config} from '../../../../src/common/config/private/Config';
import {Request, Response} from 'express';
import {RateLimitRequestHandler} from 'express-rate-limit';

interface InvokeResult {
  nextCalled: boolean;
  error: any;
  statusSet: number | null;
  headers: Record<string, any>;
}

const invokeLimiter = (
  limiter: RateLimitRequestHandler,
  reqOverrides: Record<string, any> = {}
): Promise<InvokeResult> => {
  return new Promise((resolve) => {
    const req: any = {
      ip: '192.168.1.100',
      headers: {},
      app: {get: () => false},
      ...reqOverrides,
    };
    let statusSet: number | null = null;
    const headers: Record<string, any> = {};
    const res: any = {
      status: (s: number) => {
        statusSet = s;
        return res;
      },
      setHeader: (h: string, v: any) => {
        headers[h] = v;
      },
      getHeader: (h: string) => headers[h],
    };

    limiter(req as Request, res as Response, (err?: any) => {
      resolve({
        nextCalled: !err,
        error: err ?? null,
        statusSet,
        headers,
      });
    });
  });
};

describe('RateLimiter - S2 throttling', () => {
  let prevDisableEnv: string | undefined;
  let prevAuthRequired: boolean;

  beforeEach(() => {
    prevDisableEnv = process.env.DISABLE_RATE_LIMITING;
    delete process.env.DISABLE_RATE_LIMITING;
    prevAuthRequired = Config.Users.authenticationRequired;
    Config.Users.authenticationRequired = true;
    RateLimiter.reset();
  });

  afterEach(() => {
    if (prevDisableEnv === undefined) {
      delete process.env.DISABLE_RATE_LIMITING;
    } else {
      process.env.DISABLE_RATE_LIMITING = prevDisableEnv;
    }
    Config.Users.authenticationRequired = prevAuthRequired;
    RateLimiter.reset();
  });

  it('should allow requests under the limit and throttle once exceeded', async () => {
    const limiter = RateLimiter.createLimiter({
      windowMs: 5000,
      maxAttempts: 3,
      errorMessage: 'Rate limit exceeded'
    });

    // Attempts 1, 2, 3 should succeed
    for (let i = 0; i < 3; i++) {
      const res = await invokeLimiter(limiter);
      expect(res.nextCalled).to.be.true;
      expect(res.error).to.be.null;
    }

    // Attempt 4 should be throttled
    const blocked = await invokeLimiter(limiter);
    expect(blocked.nextCalled).to.be.false;
    expect(blocked.statusSet).to.equal(429);
    expect(blocked.error).to.be.instanceOf(ErrorDTO);
    expect(blocked.error.code).to.equal(ErrorCodes.GENERAL_ERROR);
    expect(blocked.error.message).to.equal('Rate limit exceeded');
    expect(blocked.headers['Retry-After']).to.be.a('number').and.greaterThan(0);

    // Resetting clears the counter
    RateLimiter.reset();
    const afterReset = await invokeLimiter(limiter);
    expect(afterReset.nextCalled).to.be.true;
  });

  it('should use default error message when none is provided', async () => {
    const limiter = RateLimiter.createLimiter({
      windowMs: 5000,
      maxAttempts: 1
    });

    await invokeLimiter(limiter, {ip: '10.1.1.1'});
    const blocked = await invokeLimiter(limiter, {ip: '10.1.1.1'});
    expect(blocked.statusSet).to.equal(429);
    expect(blocked.error).to.be.instanceOf(ErrorDTO);
    expect(blocked.error.message).to.include('10.1.1.1');
  });

  it('should handle missing IP gracefully in default error message', async () => {
    const limiter = RateLimiter.createLimiter({
      windowMs: 5000,
      maxAttempts: 1
    });

    await invokeLimiter(limiter, {ip: undefined});
    const blocked = await invokeLimiter(limiter, {ip: undefined});
    expect(blocked.statusSet).to.equal(429);
    expect(blocked.error).to.be.instanceOf(ErrorDTO);
    expect(blocked.error.message).to.include('unknown-ip');
  });

  it('should isolate limits by IP', async () => {
    const limiter = RateLimiter.createLimiter({
      windowMs: 5000,
      maxAttempts: 1
    });

    const r1 = await invokeLimiter(limiter, {ip: '10.0.0.1'});
    const r2 = await invokeLimiter(limiter, {ip: '10.0.0.2'});

    expect(r1.nextCalled).to.be.true;
    expect(r2.nextCalled).to.be.true;
  });

  it('should bypass rate limiting when DISABLE_RATE_LIMITING is true', async () => {
    process.env.DISABLE_RATE_LIMITING = 'true';
    const limiter = RateLimiter.createLimiter({
      windowMs: 5000,
      maxAttempts: 1
    });

    const r1 = await invokeLimiter(limiter, {ip: '10.0.0.3'});
    const r2 = await invokeLimiter(limiter, {ip: '10.0.0.3'});

    expect(r1.nextCalled).to.be.true;
    expect(r2.nextCalled).to.be.true;
  });

  it('should skip authenticated sessions and auth-disabled mode when skipAuthenticated is enabled', async () => {
    const limiter = RateLimiter.createLimiter({
      windowMs: 5000,
      maxAttempts: 1,
      skipAuthenticated: true
    });

    // Authenticated session is never throttled (e.g. high-burst timeline scrolling)
    const authedReq = {
      ip: '10.0.0.4',
      session: {context: {user: {id: 1, name: 'alice'}}}
    };
    expect((await invokeLimiter(limiter, authedReq)).nextCalled).to.be.true;
    expect((await invokeLimiter(limiter, authedReq)).nextCalled).to.be.true;
    expect((await invokeLimiter(limiter, authedReq)).nextCalled).to.be.true;

    // Unauthenticated requests with authenticationRequired=true are still throttled
    expect((await invokeLimiter(limiter, {ip: '10.0.0.5'})).nextCalled).to.be.true;
    const blocked = await invokeLimiter(limiter, {ip: '10.0.0.5'});
    expect(blocked.statusSet).to.equal(429);

    // Auth-disabled instances bypass skipAuthenticated limiters
    Config.Users.authenticationRequired = false;
    expect((await invokeLimiter(limiter, {ip: '10.0.0.5'})).nextCalled).to.be.true;
    expect((await invokeLimiter(limiter, {ip: '10.0.0.5'})).nextCalled).to.be.true;
  });
});
