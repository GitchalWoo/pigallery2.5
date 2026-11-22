import {expect} from 'chai';
import assert from 'assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import {UploadedFile, UploadManager} from '../../../../src/backend/model/UploadManager';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {Config} from '../../../../src/common/config/private/Config';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {DirectoryNotFound} from '../../../../src/backend/exceptions/DirectoryNotFound';
import {FolderNotWritable} from '../../../../src/backend/exceptions/FolderNotWritable';

declare const describe: any;
declare const before: any;
declare const after: any;
declare const beforeEach: any;
declare const afterEach: any;
declare const it: any;

describe('UploadManager', () => {
  const uploadManager = new UploadManager();
  const testDir = path.join(__dirname, 'tmp');
  // multer saves the uploaded files to the temp folder first
  const tempDir = path.join(__dirname, 'tmp_upload_temp');
  let tempFiles = 0;
  const uploaded = (originalname: string, content: string): UploadedFile => {
    fs.mkdirSync(tempDir, {recursive: true});
    const tempPath = path.join(tempDir, String(tempFiles++));
    fs.writeFileSync(tempPath, content);
    return {originalname, path: tempPath} as UploadedFile;
  };

  before(async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, {recursive: true});
    }
    // upload never creates folders: the target folders of the tests exist
    for (const dir of ['test_subdir', 'multi_test', 'no_config_dir', 'exists_test', 'race_test',
      'traversal_test', 'blocked_test', 'unblocked_test', 'blocked_jpg_test']) {
      fs.mkdirSync(path.join(testDir, dir), {recursive: true});
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
    fs.rmSync(testDir, {recursive: true, force: true});
    fs.rmSync(tempDir, {recursive: true, force: true});
  });

  it('should save a supported file', async () => {
    const file: any = uploaded('test.jpg', 'test image content');
    await uploadManager.saveFile('test_subdir', file);

    const savedPath = path.join(testDir, 'test_subdir', 'test.jpg');
    expect(fs.existsSync(savedPath)).to.be.true;
    expect(fs.readFileSync(savedPath).toString()).to.equal('test image content');
  });

  it('should throw error for unsupported file', async () => {
    const file: any = uploaded('test.exe', 'test content');
    try {
      await uploadManager.saveFile('', file);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.contain('Unsupported file format');
    }
  });

  it('should reject filenames with path components', async () => {
    for (const name of ['../escape.jpg', '..\\escape.jpg', 'sub/escape.jpg', '../../../../../tmp/poc.gpx',
      'nul\0.jpg', '..', '.', '']) {
      const file: any = uploaded(name, 'test content');
      try {
        await uploadManager.saveFile('traversal_test', file);
        expect.fail('Should have thrown an error for: ' + name);
      } catch (e) {
        expect(e.message, name).to.contain('Invalid filename');
      }
    }
    expect(fs.existsSync(path.join(testDir, 'escape.jpg'))).to.be.false;
    expect(fs.existsSync(path.join(testDir, 'traversal_test', 'escape.jpg'))).to.be.false;
    expect(fs.existsSync(path.join(testDir, 'traversal_test', 'sub'))).to.be.false;
  });

  it('should not accept blocked extensions by default', async () => {
    for (const name of ['.uploader.pg2conf', 'sorting.PG2CONF', 'image.svg']) {
      const file: any = uploaded(name, '{}');
      try {
        await uploadManager.saveFile('blocked_test', file);
        expect.fail('Should have thrown an error for: ' + name);
      } catch (e) {
        expect(e.message, name).to.contain('Unsupported file format');
      }
    }
    expect(fs.readdirSync(path.join(testDir, 'blocked_test'))).to.deep.equal([]);
  });

  it('should accept supported extensions that are removed from blockedExtensions', async () => {
    const blocked = Config.Upload.blockedExtensions;
    Config.Upload.blockedExtensions = [];
    try {
      for (const name of ['.uploader.pg2conf', 'image.svg']) {
        const file: any = uploaded(name, '{}');
        await uploadManager.saveFile('unblocked_test', file);
        expect(fs.existsSync(path.join(testDir, 'unblocked_test', name)), name).to.be.true;
      }
    } finally {
      Config.Upload.blockedExtensions = blocked;
    }
  });

  it('should block any listed extension', async () => {
    const blocked = Config.Upload.blockedExtensions;
    Config.Upload.blockedExtensions = ['JPG'];
    try {
      const file: any = uploaded('image.jpg', 'test');
      await uploadManager.saveFile('blocked_jpg_test', file);
      expect.fail('Should have thrown an error');
    } catch (e) {
      expect(e.message).to.contain('Unsupported file format');
    } finally {
      Config.Upload.blockedExtensions = blocked;
    }
  });

  it('should handle multiple files with some errors', async () => {
    const files: any[] = [
      uploaded('valid.jpg', 'valid jpg'),
      uploaded('invalid.exe', 'invalid exe')
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
      const file: any = uploaded('test.jpg', 'test content');
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
      const file: any = uploaded('test.jpg', 'test content');
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
      const file: any = uploaded('test.jpg', 'test content');
      await uploadManager.saveFiles(dir, [file]);
      const savedPath = path.join(fullDirPath, 'test.jpg');
      expect(fs.existsSync(savedPath)).to.be.true;
    } finally {
      Config.Upload.enforcedDirectoryConfig = false;
    }
  });

  it('should return error if file already exists', async () => {
    await uploadManager.saveFile('exists_test', uploaded('exists.jpg', 'content'));

    const second = uploaded('exists.jpg', 'replacement');
    const errors = await uploadManager.saveFiles('exists_test', [second]);
    expect(errors.length).to.equal(1);
    expect(errors[0].filename).to.equal('exists.jpg');
    expect(errors[0].error).to.contain('already exists');
    // only the name: the path on the disk is not the client's business
    expect(errors[0].error).to.not.contain(testDir);
    // never replaced
    expect(fs.readFileSync(path.join(testDir, 'exists_test', 'exists.jpg'), 'utf8')).to.equal('content');
  });

  it('should move the uploaded file out of the temp folder', async () => {
    const file = uploaded('moved.jpg', 'test image content');
    await uploadManager.saveFile('', file);

    expect(fs.readFileSync(path.join(testDir, 'moved.jpg')).toString()).to.equal('test image content');
    expect(fs.existsSync(file.path)).to.be.false;
  });

  it('should reject a file above the size limit with the limit in the message', async () => {
    const file: UploadedFile = {...uploaded('too_large.jpg', 'content'), tooLarge: true};
    await assert.rejects(uploadManager.saveFile('', file), (e: Error) => {
      expect(e.message).to.contain(Config.Upload.maxFileSizeMB + ' MB');
      return true;
    });
    expect(fs.existsSync(path.join(testDir, 'too_large.jpg'))).to.be.false;
  });

  it('should not follow a dangling symlink in place of the target', async () => {
    const outside = path.join(testDir, '..', 'tmp_dangling_target.jpg');
    fs.rmSync(outside, {force: true});
    fs.symlinkSync(outside, path.join(testDir, 'exists_test', 'dangling.jpg'));
    await assert.rejects(uploadManager.saveFile('exists_test', uploaded('dangling.jpg', 'content')));
    expect(fs.existsSync(outside)).to.be.false;
    expect(fs.lstatSync(path.join(testDir, 'exists_test', 'dangling.jpg')).isSymbolicLink()).to.be.true;
  });

  it('should not create a missing folder', async () => {
    const file: any = uploaded('missing.jpg', 'content');
    await assert.rejects(uploadManager.saveFiles('missing_dir/sub', [file]), (e: Error) => {
      expect(e).to.be.instanceOf(DirectoryNotFound);
      return true;
    });
    await assert.rejects(uploadManager.saveFile('missing_dir', file), DirectoryNotFound);
    expect(fs.existsSync(path.join(testDir, 'missing_dir'))).to.be.false;
  });

  it('should not upload into a file as a folder', async () => {
    fs.writeFileSync(path.join(testDir, 'not_a_dir.jpg'), 'content');
    const file: any = uploaded('inside.jpg', 'content');
    await assert.rejects(uploadManager.saveFiles('not_a_dir.jpg', [file]), DirectoryNotFound);
  });

  it('should reject path traversal in directory parameter (S5)', async () => {
    const file: any = uploaded('escape.jpg', 'content');
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
      const file: any = uploaded('escape.jpg', 'content');
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

  describe('without hard links', () => {
    const originalLink = fs.promises.link;
    const noLink = (code: string) => {
      fs.promises.link = async () => {
        throw Object.assign(new Error(code + ': cross-device link not permitted, link \'' + tempDir + '\''), {code});
      };
    };

    afterEach(() => {
      fs.promises.link = originalLink;
    });

    for (const code of ['EXDEV', 'EPERM']) {
      it('copies the file on ' + code + ' and removes the temp file', async () => {
        noLink(code);
        const file = uploaded('copied_' + code + '.jpg', 'copied content');
        await uploadManager.saveFile('', file);
        expect(fs.readFileSync(path.join(testDir, 'copied_' + code + '.jpg'), 'utf8')).to.equal('copied content');
        expect(fs.existsSync(file.path)).to.be.false;
      });
    }

    it('never replaces an existing file when copying', async () => {
      noLink('EXDEV');
      const destination = path.join(testDir, 'exists_test', 'copy_exists.jpg');
      fs.writeFileSync(destination, 'original');
      await assert.rejects(uploadManager.saveFile('exists_test', uploaded('copy_exists.jpg', 'replacement')),
        (e: Error) => {
          expect(e.message).to.contain('already exists');
          return true;
        });
      expect(fs.readFileSync(destination, 'utf8')).to.equal('original');
    });

    it('does not unlink an existing file when opening the destination fails', async () => {
      noLink('EXDEV');
      const destination = path.join(testDir, 'untouched.jpg');
      fs.writeFileSync(destination, 'original');
      const originalOpen = fs.promises.open;
      const failure = Object.assign(new Error('permission denied'), {code: 'EACCES'});
      fs.promises.open = async () => {
        throw failure;
      };
      try {
        await assert.rejects(uploadManager.saveFile('', uploaded('untouched.jpg', 'replacement')), err => err === failure);
        expect(fs.readFileSync(destination, 'utf8')).to.equal('original');
      } finally {
        fs.promises.open = originalOpen;
      }
    });

    it('closes and removes its own partial file after a write failure', async () => {
      noLink('EXDEV');
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
        await assert.rejects(uploadManager.saveFile('', uploaded('partial.jpg', 'full content')), err => err === failure);
        expect(opened.fd).to.equal(-1);
        expect(fs.existsSync(path.join(testDir, 'partial.jpg'))).to.be.false;
      } finally {
        fs.promises.open = originalOpen;
      }
    });
  });

  it('answers FolderNotWritable without the disk path when the disk refuses the folder', async () => {
    const originalLink = fs.promises.link;
    fs.promises.link = async () => {
      throw Object.assign(new Error('EACCES: permission denied, link \'' + tempDir + '\''), {code: 'EACCES'});
    };
    try {
      await assert.rejects(uploadManager.saveFiles('multi_test', [uploaded('a.jpg', 'a'), uploaded('b.jpg', 'b')]),
        (e: Error) => {
          expect(e).to.be.instanceOf(FolderNotWritable);
          expect(e.message).to.not.contain(tempDir);
          return true;
        });
    } finally {
      fs.promises.link = originalLink;
    }
  });

  it('should prevent overwrite race (AUD10)', async () => {
    const file1 = uploaded('race.jpg', 'first content');
    const file2 = uploaded('race.jpg', 'second content');

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
    // the winner's content, complete
    expect(['first content', 'second content'])
      .to.include(fs.readFileSync(path.join(testDir, 'race_test', 'race.jpg'), 'utf8'));
  });

  describe('temp folder', () => {
    const tempFolder = path.join(__dirname, 'tmp_pg_temp');
    let originalTempFolder: string;

    beforeEach(() => {
      originalTempFolder = Config.Media.tempFolder;
      Config.Media.tempFolder = tempFolder;
      ProjectPath.reset();
    });

    afterEach(() => {
      Config.Media.tempFolder = originalTempFolder;
      ProjectPath.reset();
      fs.rmSync(tempFolder, {recursive: true, force: true});
    });

    it('removes the stale upload temp files', async () => {
      const uploadTemp = await UploadManager.getTempFolder();
      expect(uploadTemp).to.equal(path.join(tempFolder, 'upload'));
      fs.writeFileSync(path.join(uploadTemp, 'stale'), 'left behind');
      fs.writeFileSync(path.join(tempFolder, 'other'), 'not an upload');
      await UploadManager.removeStaleTempFiles();
      expect(fs.existsSync(uploadTemp)).to.be.false;
      expect(fs.existsSync(path.join(tempFolder, 'other'))).to.be.true;
    });

    it('refuses an upload temp folder that is a symlink out of the temp folder', async () => {
      const outside = path.join(__dirname, 'tmp_pg_temp_outside');
      fs.mkdirSync(outside, {recursive: true});
      fs.writeFileSync(path.join(outside, 'keep'), 'outside');
      fs.symlinkSync(outside, path.join(tempFolder, 'upload'));
      try {
        await assert.rejects(UploadManager.getTempFolder(), /symlink escapes base directory/);
        // removing the stale files removes the link only, never its target
        await UploadManager.removeStaleTempFiles();
        expect(fs.existsSync(path.join(tempFolder, 'upload'))).to.be.false;
        expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8')).to.equal('outside');
      } finally {
        fs.rmSync(outside, {recursive: true, force: true});
      }
    });
  });
});
