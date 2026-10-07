import {expect} from 'chai';
import assert from 'assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import {UploadManager} from '../../../../src/backend/model/UploadManager';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {Config} from '../../../../src/common/config/private/Config';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';

declare const describe: any;
declare const before: any;
declare const after: any;
declare const it: any;

describe('UploadManager', () => {
  const uploadManager = new UploadManager();
  const testDir = path.join(__dirname, 'tmp');

  before(async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, {recursive: true});
    }
    Config.Media.folder = testDir;
    Config.Upload.enabled = true;
    ProjectPath.reset();

    // Mock ObjectManagers
    const om: any = ObjectManagers.getInstance();
    om.VersionManager = {onNewDataVersion: () => Promise.resolve()};
    om.initDone = true;
  });

  after(async () => {
    await ObjectManagers.reset();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, {recursive: true, force: true});
    }
  });

  it('should save a supported file', async () => {
    const file: any = {
      originalname: 'test.jpg',
      buffer: Buffer.from('test image content')
    };
    await uploadManager.saveFile('test_subdir', file);

    const savedPath = path.join(testDir, 'test_subdir', 'test.jpg');
    expect(fs.existsSync(savedPath)).to.be.true;
    expect(fs.readFileSync(savedPath).toString()).to.equal('test image content');
  });

  it('should throw error for unsupported file', async () => {
    const file: any = {
      originalname: 'test.exe',
      buffer: Buffer.from('test content')
    };
    try {
      await uploadManager.saveFile('', file);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.contain('Unsupported file format');
    }
  });

  it('should handle multiple files with some errors', async () => {
    const files: any[] = [
      {
        originalname: 'valid.jpg',
        buffer: Buffer.from('valid jpg')
      },
      {
        originalname: 'invalid.exe',
        buffer: Buffer.from('invalid exe')
      }
    ];

    const errors = await uploadManager.saveFiles('multi_test', files);
    expect(errors.length).to.equal(1);
    expect(errors[0].filename).to.equal('invalid.exe');
    expect(errors[0].error).to.contain('Unsupported file format');

    const validPath = path.join(testDir, 'multi_test', 'valid.jpg');
    expect(fs.existsSync(validPath)).to.be.true;
  });

  it('should throw error if upload is disabled', async () => {
    Config.Upload.enabled = false;
    try {
      const file: any = {
        originalname: 'test.jpg',
        buffer: Buffer.from('test content')
      };
      await uploadManager.saveFiles('', [file]);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.equal('Upload is disabled');
    } finally {
      Config.Upload.enabled = true;
    }
  });

  it('should throw error if enforcedDirectoryConfig is true and .uploader.pg2conf is missing', async () => {
    Config.Upload.enforcedDirectoryConfig = true;
    try {
      const file: any = {
        originalname: 'test.jpg',
        buffer: Buffer.from('test content')
      };
      await uploadManager.saveFiles('no_config_dir', [file]);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.equal('Upload is not enabled in this directory');
    } finally {
      Config.Upload.enforcedDirectoryConfig = false;
    }
  });

  it('should save file if enforcedDirectoryConfig is true and .uploader.pg2conf exists', async () => {
    Config.Upload.enforcedDirectoryConfig = true;
    const dir = 'config_dir';
    const fullDirPath = path.join(testDir, dir);
    if (!fs.existsSync(fullDirPath)) {
      fs.mkdirSync(fullDirPath, {recursive: true});
    }
    fs.writeFileSync(path.join(fullDirPath, '.uploader.pg2conf'), '');

    try {
      const file: any = {
        originalname: 'test.jpg',
        buffer: Buffer.from('test content')
      };
      await uploadManager.saveFiles(dir, [file]);
      const savedPath = path.join(fullDirPath, 'test.jpg');
      expect(fs.existsSync(savedPath)).to.be.true;
    } finally {
      Config.Upload.enforcedDirectoryConfig = false;
    }
  });

  it('should return error if file already exists', async () => {
    const file: any = {
      originalname: 'exists.jpg',
      buffer: Buffer.from('content')
    };
    await uploadManager.saveFile('exists_test', file);

    const errors = await uploadManager.saveFiles('exists_test', [file]);
    expect(errors.length).to.equal(1);
    expect(errors[0].filename).to.equal('exists.jpg');
    expect(errors[0].error).to.contain('already exists');
  });

  it('should reject path traversal in directory parameter (S5)', async () => {
    const file: any = {
      originalname: 'escape.jpg',
      buffer: Buffer.from('content')
    };
    try {
      await uploadManager.saveFile('../../etc', file);
      expect.fail('Should have failed path traversal');
    } catch (e) {
      expect(e.message).to.contain('Path traversal detected');
    }
  });

  it('should reject upload targeting directory symlink pointing outside ImageFolder', async () => {
    const outsideDir = path.join(testDir, '..', 'tmp_outside_upload');
    if (!fs.existsSync(outsideDir)) {
      fs.mkdirSync(outsideDir, {recursive: true});
    }
    const symlinkPath = path.join(testDir, 'symlink_outside');
    if (!fs.existsSync(symlinkPath)) {
      fs.symlinkSync(outsideDir, symlinkPath);
    }
    try {
      const file: any = {
        originalname: 'escape.jpg',
        buffer: Buffer.from('content')
      };
      await uploadManager.saveFile('symlink_outside', file);
      expect.fail('Should have rejected symlink upload');
    } catch (e) {
      expect(e.message).to.contain('symlink escapes base directory');
      expect(fs.existsSync(path.join(outsideDir, 'escape.jpg'))).to.be.false;
    } finally {
      if (fs.existsSync(symlinkPath)) {
        fs.unlinkSync(symlinkPath);
      }
      if (fs.existsSync(outsideDir)) {
        fs.rmSync(outsideDir, {recursive: true, force: true});
      }
    }
  });

  it('does not unlink an existing file when opening the destination fails', async () => {
    const destination = path.join(testDir, 'untouched.jpg');
    fs.writeFileSync(destination, 'original');
    const originalOpen = fs.promises.open;
    const failure = Object.assign(new Error('permission denied'), {code: 'EACCES'});
    fs.promises.open = async () => { throw failure; };
    try {
      await assert.rejects(uploadManager.saveFile('', {
        originalname: 'untouched.jpg', buffer: Buffer.from('replacement')
      } as Express.Multer.File), err => err === failure);
      expect(fs.readFileSync(destination, 'utf8')).to.equal('original');
    } finally {
      fs.promises.open = originalOpen;
    }
  });

  it('closes and removes its own partial file after a write failure', async () => {
    const originalOpen = fs.promises.open;
    const failure = Object.assign(new Error('disk full'), {code: 'ENOSPC'});
    let opened: fs.promises.FileHandle;
    fs.promises.open = async (...args: Parameters<typeof originalOpen>) => {
      opened = await originalOpen(...args);
      const originalWrite = opened.writeFile.bind(opened);
      opened.writeFile = async () => {
        await originalWrite(Buffer.from('partial'));
        throw failure;
      };
      return opened;
    };
    try {
      await assert.rejects(uploadManager.saveFile('', {
        originalname: 'partial.jpg', buffer: Buffer.from('full content')
      } as Express.Multer.File), err => err === failure);
      expect(opened.fd).to.equal(-1);
      expect(fs.existsSync(path.join(testDir, 'partial.jpg'))).to.be.false;
    } finally {
      fs.promises.open = originalOpen;
    }
  });

  it('should prevent overwrite race using wx exclusive flag (AUD10)', async () => {
    const file1: any = {
      originalname: 'race.jpg',
      buffer: Buffer.from('first content')
    };
    const file2: any = {
      originalname: 'race.jpg',
      buffer: Buffer.from('second content')
    };

    // Run two simultaneous saveFile calls for the same file
    const results = await Promise.allSettled([
      uploadManager.saveFile('race_test', file1),
      uploadManager.saveFile('race_test', file2)
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).to.equal(1);
    expect(rejected.length).to.equal(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).to.contain('already exists');
  });
});
