import {expect} from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import {FFmpegCommand, FFmpegFactory} from '../../../../src/backend/model/FFmpegFactory';

describe('FFmpegFactory and FFmpegCommand', () => {
  const assetsFolder = path.join(__dirname, '../../assets');
  const sampleVideo = path.join(assetsFolder, 'video.mp4');
  const rotatedVideo = path.join(assetsFolder, 'video_rotate.mp4');
  const mkvVideo = path.join(assetsFolder, 'video_mkv.mkv');
  const tempDir = path.join(__dirname, '../../../../test/tmp/ffmpeg-tests');

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

  describe('Path Resolution', () => {
    it('should resolve ffmpeg and ffprobe paths', () => {
      const ffmpegPath = FFmpegFactory.getFfmpegPath();
      const ffprobePath = FFmpegFactory.getFfprobePath();

      expect(ffmpegPath).to.be.a('string').and.not.be.empty;
      expect(ffprobePath).to.be.a('string').and.not.be.empty;
    });

    it('should support custom path overrides and getters', () => {
      const origFfmpeg = FFmpegFactory.getFfmpegPath();
      const origFfprobe = FFmpegFactory.getFfprobePath();

      FFmpegFactory.setFfmpegPath('/custom/ffmpeg');
      FFmpegFactory.setFfprobePath('/custom/ffprobe');
      expect(FFmpegFactory.getFfmpegPath()).to.equal('/custom/ffmpeg');
      expect(FFmpegFactory.getFfprobePath()).to.equal('/custom/ffprobe');

      // Restore
      FFmpegFactory.setFfmpegPath(origFfmpeg);
      FFmpegFactory.setFfprobePath(origFfprobe);
      expect(FFmpegFactory.getFfmpegPath()).to.equal(origFfmpeg);
      expect(FFmpegFactory.getFfprobePath()).to.equal(origFfprobe);
    });

    it('should provide factory function through FFmpegFactory.get()', () => {
      const factory = FFmpegFactory.get();
      expect(factory).to.be.a('function');
      const cmd = factory(sampleVideo);
      expect(cmd).to.be.instanceOf(FFmpegCommand);
      expect(factory.setFfmpegPath).to.be.a('function');
      expect(factory.setFfprobePath).to.be.a('function');
    });
  });

  describe('ffprobe metadata', () => {
    it('should probe standard mp4 video', async () => {
      const data = await FFmpegFactory.probe(sampleVideo);
      expect(data).to.have.property('streams');
      expect(data).to.have.property('format');

      const videoStream = data.streams.find(s => s.codec_type === 'video');
      expect(videoStream).to.exist;
      expect(videoStream!.width).to.equal(80);
      expect(videoStream!.height).to.equal(60);
      expect(data.format.duration).to.be.a('number').and.be.closeTo(13.72, 0.1);
      expect(data.format.bit_rate).to.be.a('number').and.be.greaterThan(1000);
    });

    it('should probe rotated video and extract rotation', async () => {
      const data = await FFmpegFactory.probe(rotatedVideo);
      const videoStream = data.streams.find(s => s.codec_type === 'video');
      expect(videoStream).to.exist;
      expect(videoStream!.rotation).to.equal(90);
    });

    it('should probe mkv video container', async () => {
      const data = await FFmpegFactory.probe(mkvVideo);
      expect(data.format.format_name).to.include('matroska');
      expect(data.format.duration).to.be.a('number').and.be.closeTo(13.69, 0.1);
    });

    it('should reject when file does not exist', async () => {
      try {
        await FFmpegFactory.probe('/nonexistent/path/video.mp4');
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err.message).to.include('ffprobe');
      }
    });

    it('should support callback style on FFmpegCommand.ffprobe', (done) => {
      const cmd = new FFmpegCommand(sampleVideo);
      cmd.ffprobe((err, data) => {
        expect(err).to.be.null;
        expect(data).to.exist;
        expect(data!.streams.length).to.be.greaterThan(0);
        done();
      });
    });
  });

  describe('FFmpegCommand', () => {
    it('should check available codecs via getAvailableCodecs', (done) => {
      const cmd = new FFmpegCommand();
      cmd.getAvailableCodecs((err) => {
        expect(err).to.be.null;
        done();
      });
    });

    it('should compute correct scale filter expressions', () => {
      const cmd = new FFmpegCommand() as any;
      expect(cmd.computeScaleFilter('200x200')).to.equal('scale=w=200:h=200');
      expect(cmd.computeScaleFilter('200x?')).to.equal('scale=w=200:h=trunc(ow/a/2)*2');
      expect(cmd.computeScaleFilter('?x60')).to.equal('scale=w=trunc(oh*a/2)*2:h=60');
      expect(cmd.computeScaleFilter('50%')).to.equal('scale=w=trunc(iw*0.5000/2)*2:h=trunc(ih*0.5000/2)*2');
      expect(cmd.computeScaleFilter('custom:filter')).to.equal('scale=custom:filter');
    });

    it('should split option strings correctly', () => {
      const cmd = new FFmpegCommand() as any;
      expect(cmd.splitOptions('-crf 23')).to.deep.equal(['-crf', '23']);
      expect(cmd.splitOptions('-movflags +faststart')).to.deep.equal(['-movflags', '+faststart']);
      expect(cmd.splitOptions('-vf "scale=w=10:h=20"')).to.deep.equal(['-vf', 'scale=w=10:h=20']);
      expect(cmd.splitOptions('-single')).to.deep.equal(['-single']);
    });

    it('should generate screenshots with takeScreenshots', (done) => {
      const cmd = new FFmpegCommand(sampleVideo);
      const outFilename = 'thumb_test.jpg';
      let started = false;

      cmd
        .outputOptions(['-qscale:v 50'])
        .on('start', (commandLine: string) => {
          started = true;
          expect(commandLine).to.include('-i');
          expect(commandLine).to.include(outFilename);
        })
        .on('end', () => {
          expect(started).to.be.true;
          const outFilePath = path.join(tempDir, outFilename);
          expect(fs.existsSync(outFilePath)).to.be.true;
          expect(fs.statSync(outFilePath).size).to.be.greaterThan(0);
          done();
        })
        .on('error', (err: any) => {
          done(err);
        });

      cmd.takeScreenshots({
        timemarks: ['10%'],
        size: '100x100',
        filename: outFilename,
        folder: tempDir,
      });
    });

    describe('Pure Argv Builders', () => {
      it('should build screenshot argv matching fluent-ffmpeg contract', () => {
        const cmd = new FFmpegCommand('/path/to/input.mp4');
        cmd.outputOptions(['-qscale:v 50']);
        const args = cmd.buildScreenshotArgs('/path/to/thumb.jpg', '200x200', 1.5);

        expect(args).to.deep.equal([
          '-ss', '1.500000',
          '-i', '/path/to/input.mp4',
          '-y',
          '-vf', 'scale=w=200:h=200',
          '-vframes', '1',
          '-qscale:v', '50',
          '/path/to/thumb.jpg',
        ]);
      });

      it('should preserve paths with spaces and unicode without shell escaping in argv', () => {
        const complexInput = '/media/user/My Photos 2026/Zażółć gęślą jaźń/film z wakacji.mp4';
        const complexOutput = '/media/user/My Photos 2026/thumbnails/miniatura testowa.jpg';
        const cmd = new FFmpegCommand(complexInput);
        cmd.outputOptions(['-qscale:v 50']);
        const args = cmd.buildScreenshotArgs(complexOutput, '?x120', 0);

        // Verify each path is an exact unescaped element in argv
        expect(args).to.include(complexInput);
        expect(args).to.include(complexOutput);
        expect(args).to.deep.equal([
          '-i', complexInput,
          '-y',
          '-vf', 'scale=w=trunc(oh*a/2)*2:h=120',
          '-vframes', '1',
          '-qscale:v', '50',
          complexOutput,
        ]);
      });

      it('should build transcode argv matching fluent-ffmpeg contract', () => {
        const cmd = new FFmpegCommand('/source/video.mp4');
        cmd
          .inputOptions(['-fflags +genpts'])
          .videoBitrate('1024k')
          .videoCodec('libx264')
          .fps(25)
          .size('?x720')
          .addOption(['-crf 23', '-preset medium', '-movflags +faststart'])
          .format('mp4');

        // Set output path via property reflection for testing buildArgs
        (cmd as any).outputPathValue = '/dest/output.mp4';
        const args = cmd.buildArgs();

        expect(args).to.deep.equal([
          '-fflags', '+genpts',
          '-i', '/source/video.mp4',
          '-y',
          '-b:v', '1024k',
          '-vcodec', 'libx264',
          '-r', '25',
          '-filter:v', 'scale=w=trunc(oh*a/2)*2:h=720',
          '-crf', '23',
          '-preset', 'medium',
          '-movflags', '+faststart',
          '-f', 'mp4',
          '/dest/output.mp4',
        ]);
      });

      it('should fail gracefully with actionable error when binary cannot be spawned', (done) => {
        const origPath = FFmpegFactory.getFfmpegPath();
        FFmpegFactory.setFfmpegPath('/nonexistent/binary/path/ffmpeg');

        const cmd = new FFmpegCommand(sampleVideo);
        cmd.on('error', (err: any) => {
          FFmpegFactory.setFfmpegPath(origPath);
          expect(err.message).to.include('Failed to start ffmpeg');
          done();
        });

        cmd.save(path.join(tempDir, 'should_fail.mp4'));
      });
    });
  });
});

