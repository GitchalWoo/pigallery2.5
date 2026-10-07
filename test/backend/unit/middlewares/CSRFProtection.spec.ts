import {expect} from 'chai';
import {CSRFProtection} from '../../../../src/backend/middlewares/CSRFProtection';
import {CookieNames} from '../../../../src/common/CookieNames';
import {CustomHeaders} from '../../../../src/common/CustomHeaders';
import {UserRoles} from '../../../../src/common/entities/UserDTO';
import {ErrorCodes} from '../../../../src/common/entities/Error';

describe('CSRFProtection - S1', () => {
  describe('issueToken', () => {
    it('should generate csrfSecret and set cookie if session exists', () => {
      const req: any = {
        session: {},
        secure: false,
        protocol: 'http'
      };
      let cookieName = '';
      let cookieVal = '';
      let cookieOpts: any = null;

      const res: any = {
        cookie: (name: string, val: string, opts: any) => {
          cookieName = name;
          cookieVal = val;
          cookieOpts = opts;
        }
      };

      let nextCalled = false;
      CSRFProtection.issueToken(req, res, () => {
        nextCalled = true;
      });

      expect(nextCalled).to.be.true;
      expect(req.session.csrfSecret).to.be.a('string');
      expect(req.session.csrfSecret.length).to.equal(64);
      expect(cookieName).to.equal(CookieNames.csrfToken);
      expect(cookieVal).to.equal(req.session.csrfSecret);
      expect(cookieOpts.httpOnly).to.be.false;
      expect(cookieOpts.sameSite).to.equal('lax');
    });

    it('should reuse existing csrfSecret on subsequent calls', () => {
      const existingSecret = 'a'.repeat(64);
      const req: any = {
        session: {csrfSecret: existingSecret},
        secure: true,
        protocol: 'https'
      };
      let cookieVal = '';
      let cookieOpts: any = null;

      const res: any = {
        cookie: (_name: string, val: string, opts: any) => {
          cookieVal = val;
          cookieOpts = opts;
        }
      };

      CSRFProtection.issueToken(req, res, () => {});

      expect(req.session.csrfSecret).to.equal(existingSecret);
      expect(cookieVal).to.equal(existingSecret);
      expect(cookieOpts.secure).to.be.true;
    });
  });

  describe('validateToken', () => {
    it('should pass through safe HTTP methods (GET, HEAD, OPTIONS)', () => {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const req: any = {method};
        const res: any = {};
        let errPassed: any = null;
        let nextCalled = false;

        CSRFProtection.validateToken(req, res, (err?: any) => {
          nextCalled = true;
          errPassed = err;
        });

        expect(nextCalled).to.be.true;
        expect(errPassed).to.be.undefined;
      }
    });

    it('should pass through mutating requests if there is no authenticated session', () => {
      const req: any = {
        method: 'POST',
        session: {}
      };
      const res: any = {};
      let nextCalled = false;
      let errPassed: any = null;

      CSRFProtection.validateToken(req, res, (err?: any) => {
        nextCalled = true;
        errPassed = err;
      });

      expect(nextCalled).to.be.true;
      expect(errPassed).to.be.undefined;
    });

    it('should reject mutating requests if session has user but missing csrf token', () => {
      const req: any = {
        method: 'POST',
        session: {
          context: {user: {id: 1, name: 'admin', role: UserRoles.Admin}},
          csrfSecret: 'secret12345'
        },
        headers: {},
        body: {}
      };
      const res: any = {};
      let errPassed: any = null;

      CSRFProtection.validateToken(req, res, (err?: any) => {
        errPassed = err;
      });

      expect(errPassed).to.exist;
      expect(errPassed.code).to.equal(ErrorCodes.NOT_AUTHORISED);
      expect(errPassed.message).to.include('missing CSRF token');
    });

    it('should reject mutating requests with mismatched csrf token', () => {
      const req: any = {
        method: 'POST',
        session: {
          context: {user: {id: 1, name: 'admin', role: UserRoles.Admin}},
          csrfSecret: 'secret12345'
        },
        headers: {
          [CustomHeaders.csrfToken.toLowerCase()]: 'wrongsecret999'
        },
        body: {}
      };
      const res: any = {};
      let errPassed: any = null;

      CSRFProtection.validateToken(req, res, (err?: any) => {
        errPassed = err;
      });

      expect(errPassed).to.exist;
      expect(errPassed.code).to.equal(ErrorCodes.NOT_AUTHORISED);
      expect(errPassed.message).to.include('invalid CSRF token');
    });

    it('should allow mutating requests with matching header csrf token', () => {
      const secret = 'valid_secret_hash_value_12345678';
      const req: any = {
        method: 'POST',
        session: {
          context: {user: {id: 1, name: 'admin', role: UserRoles.Admin}},
          csrfSecret: secret
        },
        headers: {
          [CustomHeaders.csrfToken.toLowerCase()]: secret
        },
        body: {}
      };
      const res: any = {};
      let nextCalled = false;
      let errPassed: any = null;

      CSRFProtection.validateToken(req, res, (err?: any) => {
        nextCalled = true;
        errPassed = err;
      });

      expect(nextCalled).to.be.true;
      expect(errPassed).to.be.undefined;
    });

    it('should allow mutating requests with matching x-csrf-token header or body', () => {
      const secret = 'valid_secret_hash_value_12345678';
      const req: any = {
        method: 'PUT',
        session: {
          context: {user: {id: 1, name: 'admin', role: UserRoles.Admin}},
          csrfSecret: secret
        },
        headers: {
          'x-csrf-token': secret
        },
        body: {}
      };
      const res: any = {};
      let nextCalled = false;
      let errPassed: any = null;

      CSRFProtection.validateToken(req, res, (err?: any) => {
        nextCalled = true;
        errPassed = err;
      });

      expect(nextCalled).to.be.true;
      expect(errPassed).to.be.undefined;
    });
  });
});
