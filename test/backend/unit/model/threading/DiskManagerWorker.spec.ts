import {expect} from 'chai';
import * as path from 'path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {Config} from '../../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {Utils} from '../../../../../src/common/Utils';
import {DatabaseType} from '../../../../../src/common/config/private/PrivateConfig';
import {DiskManager} from '../../../../../src/backend/model/fileaccess/DiskManager';
import {Logger} from '../../../../../src/backend/Logger';
import {NotificationManager} from '../../../../../src/backend/model/NotifocationManager';

declare const before: any;
declare const afterEach: any;

describe('DiskMangerWorker', () => {
  // loading default settings (this might have been changed by other tests)
  before(() => {
    Config.loadSync();
    Config.Database.type = DatabaseType.sqlite;
    Config.Faces.enabled = true;
    Config.Faces.keywordsToPersons = true;
    Config.Extensions.enabled = false;
  });

  afterEach(() => {
    Config.Indexing.excludeFilenameList = [];
  });

  it('should parse metadata', async () => {
    Config.Media.folder = path.join(__dirname, '/../../../assets');
    ProjectPath.ImageFolder = path.join(__dirname, '/../../../assets');
    const dir = await DiskManager.scanDirectory('/');
    // should match the number of media (photo/video) files in the assets folder
    // TODO: make this test less flaky. Every time a new image is added to the folder, it fails.
    expect(dir.media.length).to.be.equals(18);
    const expected = require(path.join(__dirname, '/../../../assets/test image öüóőúéáű-.,.json'));
    const i = dir.media.findIndex(m => m.name === 'test image öüóőúéáű-.,.jpg');
    expect(Utils.clone(dir.media[i].name)).to.be.deep.equal('test image öüóőúéáű-.,.jpg');
    expect(Utils.clone(dir.media[i].metadata)).to.be.deep.equal(expected);
  });

  describe('excludeFilenameList', () => {
    it('excludeFile should return false when list is empty', () => {
      Config.Indexing.excludeFilenameList = [];
      expect(DiskManager.excludeFile('._photo.jpg')).to.be.false;
      expect(DiskManager.excludeFile('photo.jpg')).to.be.false;
    });

    it('excludeFile should exclude dot-files using glob pattern ".*"', () => {
      Config.Indexing.excludeFilenameList = ['.*'];
      expect(DiskManager.excludeFile('._photo.jpg')).to.be.true;
      expect(DiskManager.excludeFile('.hidden.jpg')).to.be.true;
      expect(DiskManager.excludeFile('photo.jpg')).to.be.false;
      expect(DiskManager.excludeFile('normal_video.mp4')).to.be.false;
    });

    it('excludeFile should exclude files by extension using glob pattern "*.rm"', () => {
      Config.Indexing.excludeFilenameList = ['*.rm'];
      expect(DiskManager.excludeFile('video.rm')).to.be.true;
      expect(DiskManager.excludeFile('VIDEO.RM')).to.be.true; // case insensitive
      expect(DiskManager.excludeFile('video.mp4')).to.be.false;
      expect(DiskManager.excludeFile('video.rm.bak')).to.be.false;
    });

    it('excludeFile should support multiple glob patterns', () => {
      Config.Indexing.excludeFilenameList = ['.*', '*.rm'];
      expect(DiskManager.excludeFile('._photo.jpg')).to.be.true;
      expect(DiskManager.excludeFile('video.rm')).to.be.true;
      expect(DiskManager.excludeFile('photo.jpg')).to.be.false;
    });

    it('excludeFile should support "?" wildcard for single character', () => {
      Config.Indexing.excludeFilenameList = ['photo?.jpg'];
      expect(DiskManager.excludeFile('photo1.jpg')).to.be.true;
      expect(DiskManager.excludeFile('Photo1.JPG')).to.be.true;
      expect(DiskManager.excludeFile('photoA.jpg')).to.be.true;
      expect(DiskManager.excludeFile('photo.jpg')).to.be.false;
      expect(DiskManager.excludeFile('photo12.jpg')).to.be.false;
    });

    it('scanDirectory should exclude files matching glob patterns in excludeFilenameList', async () => {
      Config.Media.folder = path.join(__dirname, '/../../../assets');
      ProjectPath.ImageFolder = path.join(__dirname, '/../../../assets');
      Config.Indexing.excludeFilenameList = ['.*'];
      const dir = await DiskManager.scanDirectory('/');
      // All files starting with '.' should be excluded
      const dotFiles = dir.media.filter(m => m.name.startsWith('.'));
      expect(dotFiles).to.have.length(0);
      // Non-dot files should still be present
      expect(dir.media.length).to.be.greaterThan(0);
    });

    it('scanDirectory should include all files when excludeFilenameList is empty', async () => {
      Config.Media.folder = path.join(__dirname, '/../../../assets');
      ProjectPath.ImageFolder = path.join(__dirname, '/../../../assets');
      Config.Indexing.excludeFilenameList = [];
      const dir = await DiskManager.scanDirectory('/');
      expect(dir.media.length).to.be.equals(18);
    });
  });

  describe('excludeFolderList', () => {
    const savedExcludeFolderList = Config.Indexing.excludeFolderList;

    afterEach(() => {
      Config.Indexing.excludeFolderList = savedExcludeFolderList;
    });

    const root = path.join(__dirname, '/../../../assets');
    const callExcludeDir = (name: string, parent = '.'): Promise<boolean> =>
      DiskManager.excludeDir({
        name,
        parentDirRelativeName: parent,
        parentDirAbsoluteName: path.join(root, parent)
      });

    it('excludes old-style literal basenames anywhere, including case variants', async () => {
      Config.Indexing.excludeFolderList = ['.dtrash', '$RECYCLE.BIN'];
      expect(await callExcludeDir('.dtrash', 'parent')).to.be.true;
      expect(await callExcludeDir('.DTRASH')).to.be.true;
      expect(await callExcludeDir('$Recycle.Bin')).to.be.true;
      expect(await callExcludeDir('photos')).to.be.false;
    });

    it('matches old-style absolute and gallery-relative folder paths with exact case', async () => {
      Config.Indexing.excludeFolderList = ['parent/relative', path.join(root, 'parent', 'absolute')];
      expect(await callExcludeDir('relative', 'parent')).to.be.true;
      expect(await callExcludeDir('absolute', 'parent')).to.be.true;
      expect(await callExcludeDir('Relative', 'parent')).to.be.false;
      expect(await callExcludeDir('Absolute', 'parent')).to.be.false;
      expect(await callExcludeDir('relative', 'other')).to.be.false;
    });

    it('excludeDir should exclude folders using glob pattern "*"', async () => {
      Config.Indexing.excludeFolderList = ['temp*'];
      expect(await callExcludeDir('temp')).to.be.true;
      expect(await callExcludeDir('Temp2024')).to.be.true;
      expect(await callExcludeDir('photos')).to.be.false;
    });

    it('excludeDir should support "?" wildcard for single character', async () => {
      Config.Indexing.excludeFolderList = ['202?'];
      expect(await callExcludeDir('2020')).to.be.true;
      expect(await callExcludeDir('202')).to.be.false;
      expect(await callExcludeDir('20200')).to.be.false;
    });
  });

  for (const noMetadata of [false, true]) {
    it(`skips a file removed after listing (noMetadata: ${noMetadata})`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-scan-'));
      const originalRoot = ProjectPath.ImageFolder;
      const originalWarn = Logger.warn;
      const originalNotifications = NotificationManager.notifications;
      const readdir = fs.readdir;
      const warnings: string[][] = [];
      try {
        ProjectPath.ImageFolder = root;
        NotificationManager.notifications = [];
        Logger.warn = (...args) => warnings.push(args.map(String));
        const retained = path.join(root, 'photo.png');
        const removed = path.join(root, 'gone.png');
        await fs.copyFile(path.join(__dirname, '/../../../assets/test_png.png'), retained);
        await fs.copyFile(retained, removed);
        fs.readdir = (async (...args: Parameters<typeof readdir>) => {
          const entries = await readdir(...args);
          if (args[0] === root) {
            await fs.unlink(removed);
          }
          return entries;
        }) as typeof readdir;

        const result = await DiskManager.scanDirectory('/', {noMetadata});
        expect(result.media.map(media => media.name)).to.deep.equal(['photo.png']);
        expect(result.cache.cover.name).to.equal('photo.png');
        expect(warnings).to.have.length(1);
        expect(warnings[0][0]).to.equal('[DiskManager]');
        expect(warnings[0][1]).to.contain('gone.png');
        expect(NotificationManager.notifications[0].message).to.contain('gone.png');
      } finally {
        fs.readdir = readdir;
        Logger.warn = originalWarn;
        NotificationManager.notifications = originalNotifications;
        ProjectPath.ImageFolder = originalRoot;
        await fs.rm(root, {recursive: true, force: true});
      }
    });
  }
});
