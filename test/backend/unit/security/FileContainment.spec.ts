import assert from 'assert/strict';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {Config} from '../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../src/backend/ProjectPath';
import {DiskManager} from '../../../../src/backend/model/fileaccess/DiskManager';
import {PublicRouter} from '../../../../src/backend/routes/PublicRouter';
import {PhotoProcessing} from '../../../../src/backend/model/fileaccess/fileprocessing/PhotoProcessing';
import {GPXProcessing} from '../../../../src/backend/model/fileaccess/fileprocessing/GPXProcessing';
import {ThumbnailSourceType} from '../../../../src/backend/model/fileaccess/PhotoWorker';

describe('Filesystem containment at resource boundaries', () => {
  let root: string;
  let originalPaths: Pick<typeof ProjectPath, 'ImageFolder' | 'TempFolder' | 'TranscodedFolder' | 'FrontendFolder'>;

  beforeEach(() => {
    originalPaths = {
      ImageFolder: ProjectPath.ImageFolder, TempFolder: ProjectPath.TempFolder,
      TranscodedFolder: ProjectPath.TranscodedFolder, FrontendFolder: ProjectPath.FrontendFolder
    };
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-resource-containment-'));
    ProjectPath.ImageFolder = path.join(root, 'gallery');
    ProjectPath.TempFolder = path.join(root, 'cache');
    ProjectPath.TranscodedFolder = path.join(ProjectPath.TempFolder, 'tc');
    ProjectPath.FrontendFolder = path.join(root, 'frontend');
    for (const dir of [ProjectPath.ImageFolder, ProjectPath.TranscodedFolder,
      path.join(ProjectPath.FrontendFolder, 'en/assets'), path.join(root, 'outside')]) {
      fs.mkdirSync(dir, {recursive: true});
    }
    fs.writeFileSync(path.join(ProjectPath.ImageFolder, 'photo.jpg'), 'source');
    fs.writeFileSync(path.join(ProjectPath.ImageFolder, 'route.gpx'), '<gpx/>');
    fs.writeFileSync(path.join(root, 'outside/file'), 'outside');
  });

  afterEach(() => {
    Object.assign(ProjectPath, originalPaths);
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('serves static assets using the frontend root and rejects external asset symlinks', async () => {
    const routes: {route: string | RegExp; handlers: any[]}[] = [];
    const languages = Config.Server.languages;
    Config.Server.languages = ['en'];
    try {
      PublicRouter.route({use: () => {}, get: (route: string | RegExp, ...handlers: any[]) => {
        routes.push({route, handlers});
      }} as any);
    } finally {
      Config.Server.languages = languages;
    }
    const assetRoute = routes.find(r => r.route instanceof RegExp && r.route.test('/assets/icon.svg'));
    assert.ok(assetRoute);
    const assets = path.join(ProjectPath.FrontendFolder, 'en/assets');
    fs.writeFileSync(path.join(assets, 'icon.svg'), '<svg/>');
    fs.symlinkSync(path.join(root, 'outside/file'), path.join(ProjectPath.ImageFolder, 'icon.svg'));
    fs.symlinkSync(path.join(root, 'outside/file'), path.join(assets, 'escape.svg'));
    for (const [file, expectedStatus] of [['icon.svg', 200], ['escape.svg', 403], ['missing.svg', 404]] as const) {
      const req: any = {params: {file}, localePath: 'en'};
      let status = 200;
      let sent: string;
      const res: any = {sendStatus: (code: number) => {status = code;}, sendFile: (name: string) => {sent = name;}};
      // Exercise the shared normalizer and actual static-file handler without a TCP listener.
      assetRoute.handlers[1](req, res, (err: unknown) => assert.equal(err, undefined));
      await assetRoute.handlers[2](req, res);
      assert.equal(status, expectedStatus);
      assert.equal(sent, status === 200 ? path.join(assets, file) : undefined);
    }
  });

  it('rejects final-file cache symlinks before serving or overwriting them', async () => {
    const photo = path.join(ProjectPath.ImageFolder, 'photo.jpg');
    const gpx = path.join(ProjectPath.ImageFolder, 'route.gpx');
    const outside = path.join(root, 'outside/file');
    fs.symlinkSync(outside, PhotoProcessing.generateConvertedPath(photo, 240));
    fs.symlinkSync(outside, GPXProcessing.generateConvertedPath(gpx));
    assert.equal(await PhotoProcessing.convertedPhotoExist(photo, 240), false);
    assert.equal(await GPXProcessing.compressedGPXExist(gpx), false);
    await assert.rejects(PhotoProcessing.generateThumbnail(photo, 240, ThumbnailSourceType.Photo, false), /symlink escapes/);
    await assert.rejects(GPXProcessing.compressGPX(gpx), /symlink escapes/);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
  });

  it('does not index external or dangling symlinks while retaining internal file aliases', async () => {
    fs.symlinkSync(path.join(root, 'outside/file'), path.join(ProjectPath.ImageFolder, 'external.jpg'));
    fs.symlinkSync('missing.jpg', path.join(ProjectPath.ImageFolder, 'dangling.jpg'));
    fs.symlinkSync('photo.jpg', path.join(ProjectPath.ImageFolder, 'internal.jpg'));
    fs.symlinkSync(path.join(root, 'outside'), path.join(ProjectPath.ImageFolder, 'external-dir'));
    const directory = await DiskManager.scanDirectoryNoMetadata('', {noVideo: true, noMetaFile: true});
    assert.deepEqual(directory.media.map(file => file.name).sort(), ['internal.jpg', 'photo.jpg']);
    assert.equal(directory.directories.length, 0);
  });

  it('creates missing cache directories below the trusted temporary root', async () => {
    fs.rmSync(ProjectPath.TranscodedFolder, {recursive: true});
    const out = await GPXProcessing.compressGPX(path.join(ProjectPath.ImageFolder, 'route.gpx'));
    assert.ok(fs.readFileSync(out, 'utf8').includes('<gpx'));
  });
});
