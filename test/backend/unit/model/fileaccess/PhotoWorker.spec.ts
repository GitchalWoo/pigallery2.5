import {expect} from 'chai';
import * as path from 'path';
import * as fs from 'fs';
const sharp = require('sharp') as typeof import('sharp');
import {PhotoWorker, ThumbnailSourceType} from '../../../../../src/backend/model/fileaccess/PhotoWorker';

describe('PhotoWorker Video Rendering', () => {
  const assetsFolder = path.join(__dirname, '../../../assets');
  const sampleVideo = path.join(assetsFolder, 'video.mp4');
  const rotatedVideo = path.join(assetsFolder, 'video_rotate.mp4');
  const tempDir = path.join(__dirname, '../../../../../test/tmp/photoworker-tests');

  before(async () => {
    await fs.promises.mkdir(tempDir, {recursive: true});
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, {recursive: true, force: true});
    } catch {
      // ignore
    }
  });

  it('should render square thumbnail from video', async () => {
    const outPath = path.join(tempDir, 'thumb_square.jpg');
    await PhotoWorker.renderFromVideo({
      type: ThumbnailSourceType.Video,
      mediaPath: sampleVideo,
      size: 100,
      makeSquare: true,
      outPath,
      quality: 80,
      useLanczos3: false,
      smartSubsample: false,
      sharpOptions: {},
      animate: false,
    });

    expect(fs.existsSync(outPath)).to.be.true;
    const meta = await sharp(outPath).metadata();
    expect(meta.width).to.equal(100);
    expect(meta.height).to.equal(100);
  });

  it('should render rectangular thumbnail keeping aspect ratio', async () => {
    const outPath = path.join(tempDir, 'thumb_rect.jpg');
    await PhotoWorker.renderFromVideo({
      type: ThumbnailSourceType.Video,
      mediaPath: sampleVideo,
      size: 60,
      makeSquare: false,
      outPath,
      quality: 80,
      useLanczos3: false,
      smartSubsample: false,
      sharpOptions: {},
      animate: false,
    });

    expect(fs.existsSync(outPath)).to.be.true;
    const meta = await sharp(outPath).metadata();
    // sampleVideo original dimension is 80x60
    expect(meta.height).to.equal(60);
    expect(meta.width).to.equal(80);
  });

  it('should render thumbnail from rotated video', async () => {
    const outPath = path.join(tempDir, 'thumb_rotate.jpg');
    await PhotoWorker.renderFromVideo({
      type: ThumbnailSourceType.Video,
      mediaPath: rotatedVideo,
      size: 60,
      makeSquare: false,
      outPath,
      quality: 80,
      useLanczos3: false,
      smartSubsample: false,
      sharpOptions: {},
      animate: false,
    });

    expect(fs.existsSync(outPath)).to.be.true;
    expect(fs.statSync(outPath).size).to.be.greaterThan(0);
  });

  it('should reject when video file cannot be probed', async () => {
    const outPath = path.join(tempDir, 'thumb_fail.jpg');
    try {
      await PhotoWorker.renderFromVideo({
        type: ThumbnailSourceType.Video,
        mediaPath: '/nonexistent/video.mp4',
        size: 100,
        makeSquare: true,
        outPath,
        quality: 80,
        useLanczos3: false,
        smartSubsample: false,
        sharpOptions: {},
        animate: false,
      });
      expect.fail('Should have failed');
    } catch (err: any) {
      expect(err.toString()).to.include('[FFmpeg]');
    }
  });
});

