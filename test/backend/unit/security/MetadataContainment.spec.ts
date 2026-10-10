import assert from 'assert/strict';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {Config} from '../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {MetadataLoader} from '../../../../src/backend/model/fileaccess/MetadataLoader';
import {DiskManager} from '../../../../src/backend/model/fileaccess/DiskManager';

describe('Metadata filesystem containment', () => {
  let root: string;
  let originalFolder: string;
  let originalMarkers: string[];
  const assets = path.resolve(__dirname, '../../assets/sidecar');
  beforeEach(() => {
    originalFolder = ProjectPath.ImageFolder;
    originalMarkers = Config.Indexing.excludeFileList;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-metadata-containment-'));
    ProjectPath.ImageFolder = path.join(root, 'gallery');
    fs.mkdirSync(ProjectPath.ImageFolder);
    fs.mkdirSync(path.join(root, 'outside'));
    fs.copyFileSync(path.join(assets, 'no_metadata.jpg'), path.join(ProjectPath.ImageFolder, 'photo.jpg'));
    fs.copyFileSync(path.join(assets, 'no_metadata.jpg.xmp'), path.join(root, 'outside/metadata.xmp'));
  });
  afterEach(() => {
    ProjectPath.ImageFolder = originalFolder;
    Config.Indexing.excludeFileList = originalMarkers;
    fs.rmSync(root, {recursive: true, force: true});
  });

  for (const kind of ['loadPhotoMetadata', 'loadVideoMetadata'] as const) {
    it(`rejects external source files and symlinks before ${kind}`, async () => {
      const outside = path.join(root, 'outside/photo.jpg');
      fs.copyFileSync(path.join(ProjectPath.ImageFolder, 'photo.jpg'), outside);
      fs.symlinkSync(outside, path.join(ProjectPath.ImageFolder, 'alias.jpg'));
      await assert.rejects(MetadataLoader[kind](outside), /Path traversal/);
      await assert.rejects(MetadataLoader[kind](path.join(ProjectPath.ImageFolder, 'alias.jpg')), /symlink escapes/);
    });
  }

  it('skips external sidecars while retaining contained sidecar aliases', async () => {
    const photo = path.join(ProjectPath.ImageFolder, 'photo.jpg');
    const sidecar = photo + '.xmp';
    fs.symlinkSync(path.join(root, 'outside/metadata.xmp'), sidecar);
    const rejected = await MetadataLoader.loadPhotoMetadata(photo);
    assert.equal(rejected.keywords, undefined);
    fs.unlinkSync(sidecar);
    fs.copyFileSync(path.join(root, 'outside/metadata.xmp'), path.join(ProjectPath.ImageFolder, 'metadata.xmp'));
    fs.symlinkSync('metadata.xmp', sidecar);
    const allowed = await MetadataLoader.loadPhotoMetadata(photo);
    assert.deepEqual(allowed.keywords, ['first', 'second']);
  });

  it('retains contained source aliases', async () => {
    fs.symlinkSync('photo.jpg', path.join(ProjectPath.ImageFolder, 'alias.jpg'));
    const result = await MetadataLoader.loadPhotoMetadata(path.join(ProjectPath.ImageFolder, 'alias.jpg'));
    assert.ok(result.fileSize > 0);
    assert.ok(result.size.width > 0);
  });

  it('ignores external and dangling exclusion marker links', async () => {
    const dir = {name: 'gallery', parentDirRelativeName: '', parentDirAbsoluteName: root};
    Config.Indexing.excludeFileList = ['.ignore'];
    fs.symlinkSync(path.join(root, 'outside/metadata.xmp'), path.join(ProjectPath.ImageFolder, '.ignore'));
    assert.equal(await DiskManager.excludeDir(dir), false);
    fs.unlinkSync(path.join(ProjectPath.ImageFolder, '.ignore'));
    fs.symlinkSync('missing', path.join(ProjectPath.ImageFolder, '.ignore'));
    assert.equal(await DiskManager.excludeDir(dir), false);
    fs.unlinkSync(path.join(ProjectPath.ImageFolder, '.ignore'));
    fs.writeFileSync(path.join(ProjectPath.ImageFolder, '.ignore'), '');
    assert.equal(await DiskManager.excludeDir(dir), true);
  });

  it('does not resolve exclusion markers outside the gallery', async () => {
    Config.Indexing.excludeFileList = ['../outside/metadata.xmp'];
    assert.equal(await DiskManager.excludeDir({name: 'gallery', parentDirRelativeName: '', parentDirAbsoluteName: root}), false);
  });
});
