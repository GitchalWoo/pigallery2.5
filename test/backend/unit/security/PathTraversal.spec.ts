import {expect} from 'chai';
import * as path from 'path';
import fs from 'fs';
import * as os from 'os';
import assert from 'assert/strict';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {GalleryMWs} from '../../../../src/backend/middlewares/GalleryMWs';
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

  describe('Filesystem Symlink Containment', () => {
    let tmpDir: string;
    let galleryDir: string;
    let outsideDir: string;
    let insideSubDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-symlink-spec-'));
      galleryDir = path.join(tmpDir, 'gallery');
      outsideDir = path.join(tmpDir, 'outside');
      insideSubDir = path.join(galleryDir, 'sub');

      fs.mkdirSync(galleryDir, {recursive: true});
      fs.mkdirSync(outsideDir, {recursive: true});
      fs.mkdirSync(insideSubDir, {recursive: true});

      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
      fs.writeFileSync(path.join(insideSubDir, 'photo.jpg'), 'photo');

      // Create symlinks inside gallery
      fs.symlinkSync(outsideDir, path.join(galleryDir, 'link_outside'));
      fs.symlinkSync(insideSubDir, path.join(galleryDir, 'link_inside'));
      fs.symlinkSync(path.join(outsideDir, 'secret.txt'), path.join(galleryDir, 'link_file_outside'));
      fs.symlinkSync(path.join(insideSubDir, 'photo.jpg'), path.join(galleryDir, 'link_file_inside'));
      fs.symlinkSync(path.join(outsideDir, 'missing'), path.join(galleryDir, 'dangling_outside'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('rejects existing directory and file symlinks outside the root', async () => {
      for (const name of ['link_outside', 'link_file_outside', 'link_outside/secret.txt']) {
        await assert.rejects(SafePath.resolveExisting(galleryDir, name), /symlink escapes/);
        await assert.rejects(SafePath.resolveForWrite(galleryDir, name), /symlink escapes/);
      }
    });

    it('rejects new files or directories under an external symlink', async () => {
      await assert.rejects(SafePath.resolveForWrite(galleryDir, 'link_outside/new/deep/photo.jpg'), /symlink escapes/);
    });

    it('rejects unresolved links, including chains, dot segments and loops', async () => {
      fs.symlinkSync(path.join(galleryDir, 'link_outside/missing'), path.join(galleryDir, 'chain'));
      fs.symlinkSync(galleryDir + '/../outside/missing', path.join(galleryDir, 'dotdot'));
      fs.symlinkSync('loop', path.join(galleryDir, 'loop'));
      for (const name of ['dangling_outside', 'dangling_outside/child', 'chain', 'dotdot', 'loop']) {
        await assert.rejects(SafePath.resolveExisting(galleryDir, name));
        await assert.rejects(SafePath.resolveForWrite(galleryDir, name));
      }
    });

    it('permits internal symlinks and new nested destinations without creating them', async () => {
      for (const name of ['link_inside/photo.jpg', 'link_file_inside']) {
        expect(await SafePath.resolveExisting(galleryDir, name)).to.equal(path.join(galleryDir, name));
      }
      for (const name of ['sub/new/deep/photo.jpg', 'link_inside/new/photo.jpg']) {
        expect(await SafePath.resolveForWrite(galleryDir, name)).to.equal(path.join(galleryDir, name));
        expect(fs.existsSync(path.join(galleryDir, name))).to.be.false;
      }
      await assert.rejects(SafePath.resolveExisting(galleryDir, 'missing'), {code: 'ENOENT'});
    });

    it('supports a configured root that is itself a symlink', async () => {
      const alias = path.join(tmpDir, 'alias');
      fs.symlinkSync(galleryDir, alias);
      expect(await SafePath.resolveExisting(alias, 'sub/photo.jpg')).to.equal(path.join(alias, 'sub/photo.jpg'));
      expect(await SafePath.resolveForWrite(alias, 'new/photo.jpg')).to.equal(path.join(alias, 'new/photo.jpg'));
      await assert.rejects(SafePath.resolveForWrite(alias, 'link_outside/new.jpg'), /symlink escapes/);
    });

    it('fails closed when the trusted root is missing', async () => {
      await assert.rejects(SafePath.resolveForWrite(path.join(tmpDir, 'missing'), 'photo.jpg'), {code: 'ENOENT'});
    });

    it('propagates filesystem errors instead of approving an unverified path', async () => {
      for (const method of ['realpath', 'lstat'] as const) {
        const original = fs.promises[method];
        for (const code of ['EACCES', 'EIO']) {
          const failure = Object.assign(new Error(code), {code});
          Object.assign(fs.promises, {[method]: async () => { throw failure; }});
          try {
            await assert.rejects(SafePath.resolveForWrite(galleryDir, 'new/photo.jpg'), err => err === failure);
            if (method === 'realpath') {
              await assert.rejects(SafePath.resolveExisting(galleryDir, 'sub/photo.jpg'), err => err === failure);
            }
          } finally {
            Object.assign(fs.promises, {[method]: original});
          }
        }
      }
    });

    it('keeps generic parameter normalization independent of gallery contents', () => {
      const original = ProjectPath.ImageFolder;
      ProjectPath.ImageFolder = galleryDir;
      try {
        const req: any = {params: {file: 'link_outside/asset.svg'}};
        AuthenticationMWs.normalizePathParam('file')(req, {} as any, err => {
          expect(err).to.be.undefined;
        });
        expect(req.params.file).to.equal(path.normalize('link_outside/asset.svg'));
      } finally {
        ProjectPath.ImageFolder = original;
      }
    });

    it('rejects external media symlinks at the actual read boundary', async () => {
      const original = ProjectPath.ImageFolder;
      ProjectPath.ImageFolder = galleryDir;
      try {
        const req: any = {params: {mediaPath: 'link_file_outside'}};
        let error: any;
        await GalleryMWs.loadFile(req, {} as any, err => { error = err; });
        expect(error?.code).to.equal(ErrorCodes.PATH_ERROR);
        expect(req.resultPipe).to.be.undefined;
      } finally {
        ProjectPath.ImageFolder = original;
      }
    });
  });
});
