import {expect} from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import {VideoConverterWorker} from '../../../../../src/backend/model/fileaccess/VideoConverterWorker';
import {FFmpegPresets} from '../../../../../src/common/config/private/PrivateConfig';
import {FFmpegFactory} from '../../../../../src/backend/model/FFmpegFactory';

describe('VideoConverterWorker', () => {
  const assetsFolder = path.join(__dirname, '../../../assets');
  const sampleVideo = path.join(assetsFolder, 'video.mp4');
  const tempDir = path.join(__dirname, '../../../../../test/tmp/videoconverter-tests');

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

  it('should transcode video to mp4 with custom parameters', async () => {
    const outPath = path.join(tempDir, 'converted.mp4');

    await VideoConverterWorker.convert({
      videoPath: sampleVideo,
      input: {},
      output: {
        path: outPath,
        codec: 'libx264',
        format: 'mp4',
        fps: 20,
        resolution: 240,
        bitRate: 200 * 1024,
        crf: 28,
        preset: FFmpegPresets.ultrafast,
      },
    });

    expect(fs.existsSync(outPath)).to.be.true;
    expect(fs.existsSync(outPath + '.part')).to.be.false;

    const probe = await FFmpegFactory.probe(outPath);
    const vStream = probe.streams.find(s => s.codec_type === 'video');
    expect(vStream).to.exist;
    expect(vStream!.height).to.equal(240);
    expect(vStream!.codec_name).to.equal('h264');
    // Frame rate is 20
    expect(parseInt(vStream!.avg_frame_rate || '', 10)).to.equal(20);
  });

  it('should reject when transcoding invalid input video', async () => {
    const outPath = path.join(tempDir, 'fail.mp4');

    try {
      await VideoConverterWorker.convert({
        videoPath: '/nonexistent/file.mp4',
        input: {},
        output: {
          path: outPath,
          codec: 'libx264',
          format: 'mp4',
        },
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.toString()).to.include('[FFmpeg]');
      expect(fs.existsSync(outPath)).to.be.false;
      expect(fs.existsSync(outPath + '.part')).to.be.false;
    }
  });
});
