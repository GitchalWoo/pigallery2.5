import {expect} from 'chai';
import {RateLimiter} from '../../../../src/backend/middlewares/RateLimiter';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';
import {Request, Response} from 'express';

describe('RateLimiter - S2 throttling', () => {
  beforeEach(() => {
    RateLimiter.reset();
  });

  it('should allow requests under the limit and throttle once exceeded', () => {
    const limiter = RateLimiter.createLimiter('testCategory', {
      windowMs: 5000,
      maxAttempts: 3,
      errorMessage: 'Rate limit exceeded'
    });

    const req: any = {ip: '192.168.1.100'};
    let statusSet: number = null;
    let headerSet: any = null;
    const res: any = {
      status: (s: number) => {
        statusSet = s;
        return res;
      },
      setHeader: (h: string, v: any) => {
        headerSet = {[h]: v};
      }
    };

    let nextCount = 0;
    let lastError: any = null;
    const next = (err?: any) => {
      if (err) {
        lastError = err;
      } else {
        nextCount++;
      }
    };

    // Attempts 1, 2, 3 should succeed
    limiter(req as Request, res as Response, next);
    expect(nextCount).to.equal(1);
    expect(lastError).to.be.null;

    limiter(req as Request, res as Response, next);
    expect(nextCount).to.equal(2);
    expect(lastError).to.be.null;

    limiter(req as Request, res as Response, next);
    expect(nextCount).to.equal(3);
    expect(lastError).to.be.null;

    // Attempt 4 should be throttled
    limiter(req as Request, res as Response, next);
    expect(nextCount).to.equal(3); // Not incremented
    expect(statusSet).to.equal(429);
    expect(lastError).to.be.instanceOf(ErrorDTO);
    expect(lastError.code).to.equal(ErrorCodes.GENERAL_ERROR);
    expect(lastError.message).to.equal('Rate limit exceeded');
    expect(headerSet['Retry-After']).to.be.a('number');
  });

  it('should isolate limits by IP', () => {
    const limiter = RateLimiter.createLimiter('testCategory', {
      windowMs: 5000,
      maxAttempts: 1
    });

    const req1: any = {ip: '10.0.0.1'};
    const req2: any = {ip: '10.0.0.2'};
    const res: any = {status: () => res, setHeader: () => {}};

    let next1 = false;
    let next2 = false;
    limiter(req1 as Request, res as Response, () => { next1 = true; });
    limiter(req2 as Request, res as Response, () => { next2 = true; });

    expect(next1).to.be.true;
    expect(next2).to.be.true;
  });
});
