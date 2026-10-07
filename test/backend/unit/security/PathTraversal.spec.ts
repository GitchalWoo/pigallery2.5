import {expect} from 'chai';
import * as path from 'path';
import {SafePath} from '../../../../src/backend/model/fileaccess/SafePath';
import {AuthenticationMWs} from '../../../../src/backend/middlewares/user/AuthenticationMWs';
import {ErrorCodes} from '../../../../src/common/entities/Error';

describe('SafePath & Path Containment - S5', () => {
  const baseDir = '/tmp/pg_test_base';

  it('should allow valid relative subpaths within base directory', () => {
    const resolved = SafePath.resolve(baseDir, 'photos/sub/img.jpg');
    expect(resolved).to.equal(path.resolve(baseDir, 'photos/sub/img.jpg'));
  });

  it('should allow base directory itself when root slash or empty string is passed', () => {
    expect(SafePath.resolve(baseDir, '')).to.equal(path.resolve(baseDir));
    expect(SafePath.resolve(baseDir, '/')).to.equal(path.resolve(baseDir));
    expect(SafePath.resolve(baseDir, '\\')).to.equal(path.resolve(baseDir));
  });

  it('should reject parent directory traversal attempts (..)', () => {
    const maliciousPaths = [
      '../etc/passwd',
      '../../secret.key',
      'photos/../../escape',
      'sub/dir/../../../escaped',
      '..\\..\\windows\\system32',
    ];

    for (const p of maliciousPaths) {
      expect(() => SafePath.resolve(baseDir, p)).to.throw(/Path traversal detected/);
      expect(SafePath.isSafe(baseDir, p)).to.be.false;
    }
  });

  it('should strip null bytes and handle attempts', () => {
    const withNull = 'photo.jpg\0.png';
    const resolved = SafePath.resolve(baseDir, withNull);
    expect(resolved).to.equal(path.resolve(baseDir, 'photo.jpg.png'));
  });

  it('should reject invalid non-string input', () => {
    expect(() => SafePath.resolve(baseDir, null as any)).to.throw();
    expect(() => SafePath.resolve(baseDir, undefined as any)).to.throw();
  });

  describe('normalizePathParam middleware', () => {
    it('should reject null bytes with PATH_ERROR', (done) => {
      const middleware = AuthenticationMWs.normalizePathParam('directory');
      const req: any = {
        params: {
          directory: 'sub/photo\0evil.jpg'
        }
      };
      const res: any = {};
      middleware(req, res, (err?: any) => {
        expect(err).to.exist;
        expect(err.code).to.equal(ErrorCodes.PATH_ERROR);
        done();
      });
    });

    it('should reject traversal attempts with PATH_ERROR', (done) => {
      const middleware = AuthenticationMWs.normalizePathParam('directory');
      const req: any = {
        params: {
          directory: '../../etc/passwd'
        }
      };
      const res: any = {};
      middleware(req, res, (err?: any) => {
        expect(err).to.exist;
        expect(err.code).to.equal(ErrorCodes.PATH_ERROR);
        done();
      });
    });

    it('should accept and normalize valid paths', (done) => {
      const middleware = AuthenticationMWs.normalizePathParam('directory');
      const req: any = {
        params: {
          directory: '/summer/trip/day1/'
        }
      };
      const res: any = {};
      middleware(req, res, (err?: any) => {
        expect(err).to.be.undefined;
        expect(req.params.directory).to.be.a('string');
        done();
      });
    });
  });
});
