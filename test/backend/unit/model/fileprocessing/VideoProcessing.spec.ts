import {expect} from 'chai';
import {VideoProcessing} from '../../../../../src/backend/model/fileaccess/fileprocessing/VideoProcessing';
import {Config} from '../../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import * as path from 'path';


describe('VideoProcessing', () => {

  beforeEach(async () => {
    await Config.load();
  });

  /* eslint-disable no-unused-expressions,@typescript-eslint/no-unused-expressions */
  it('should generate converted file path', async () => {

    ProjectPath.ImageFolder = path.join(__dirname, './../../../assets');
    const videoPath = path.join(ProjectPath.ImageFolder, 'video.mp4');
    expect(await VideoProcessing
      .isValidConvertedPath(VideoProcessing.generateConvertedFilePath(videoPath)))
      .to.be.true;

    expect(await VideoProcessing
      .isValidConvertedPath(VideoProcessing.generateConvertedFilePath(videoPath + 'noPath')))
      .to.be.false;

    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.bitRate = 10;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.mp4Codec = 'codec_text' as any;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.format = 'format_test' as any;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.resolution = 1 as any;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
  });

  it('should convert video and detect existing converted video', async () => {
    const fs = require('fs');
    ProjectPath.ImageFolder = path.join(__dirname, './../../../assets');
    ProjectPath.TranscodedFolder = path.join(__dirname, '../../../../../test/tmp/transcoded-tests');
    const videoPath = path.join(ProjectPath.ImageFolder, 'video.mp4');

    await fs.promises.mkdir(ProjectPath.TranscodedFolder, {recursive: true});
    try {
      expect(await VideoProcessing.convertedVideoExist(videoPath)).to.be.false;
      await VideoProcessing.convertVideo(videoPath);
      expect(await VideoProcessing.convertedVideoExist(videoPath)).to.be.true;
      // Second call should return early since already converted
      await VideoProcessing.convertVideo(videoPath);
      expect(await VideoProcessing.convertedVideoExist(videoPath)).to.be.true;
    } finally {
      try {
        await fs.promises.rm(ProjectPath.TranscodedFolder, {recursive: true, force: true});
      } catch {
        // ignore
      }
    }
  });

});
