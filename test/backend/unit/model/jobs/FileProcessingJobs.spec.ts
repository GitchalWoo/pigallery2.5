import {expect} from 'chai';
import {copyFile, mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {mock} from 'node:test';
import {setImmediate as yieldToJobs} from 'node:timers/promises';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {PhotoProcessing} from '../../../../../src/backend/model/fileaccess/fileprocessing/PhotoProcessing';
import {VideoProcessing} from '../../../../../src/backend/model/fileaccess/fileprocessing/VideoProcessing';
import {JobManager} from '../../../../../src/backend/model/jobs/JobManager';
import {Config} from '../../../../../src/common/config/private/Config';
import {DefaultsJobs} from '../../../../../src/common/entities/job/JobDTO';
import {JobProgressStates} from '../../../../../src/common/entities/job/JobProgressDTO';

describe('File processing jobs', function () {
  this.timeout(60000);
  const assets = path.join(__dirname, '../../../assets');
  let fixture: string;
  let media: string[];
  let manager: JobManager;
  let original: {db: string; media: string; cache: string; video: boolean; schedules: typeof Config.Jobs.scheduled};

  beforeEach(async () => {
    original = {
      db: Config.Database.dbFolder, media: Config.Media.folder, cache: Config.Media.tempFolder,
      video: Config.Media.Video.enabled, schedules: Config.Jobs.scheduled,
    };
    fixture = await mkdtemp(path.join(tmpdir(), 'pg-file-jobs-'));
    const root = path.join(fixture, 'images');
    const album = path.join(root, 'summer');
    await mkdir(album, {recursive: true});
    media = [path.join(root, 'árvíztűrő.jpg'), path.join(album, 'beach.jpg'), path.join(album, 'video.mp4')];
    await copyFile(path.join(assets, 'test image öüóőúéáű-.,.jpg'), media[0]);
    await copyFile(path.join(assets, 'two_ratings.jpg'), media[1]);
    await copyFile(path.join(assets, 'video.mp4'), media[2]);

    Config.Database.dbFolder = fixture;
    Config.Media.folder = root;
    Config.Media.tempFolder = path.join(fixture, 'cache');
    Config.Media.Video.enabled = true;
    Config.Jobs.scheduled = [];
    ProjectPath.reset();
    PhotoProcessing.init();
    // The job progress persistence timer is unrelated to file conversion.
    mock.timers.enable({apis: ['setTimeout']});
    manager = new JobManager();
    await manager.init();
  });

  afterEach(async () => {
    await manager?.cleanUp();
    mock.timers.reset();
    Config.Database.dbFolder = original.db;
    Config.Media.folder = original.media;
    Config.Media.tempFolder = original.cache;
    Config.Media.Video.enabled = original.video;
    Config.Jobs.scheduled = original.schedules;
    ProjectPath.reset();
    await rm(fixture, {recursive: true, force: true});
  });

  async function runJob(name: string, config: Record<string, unknown>) {
    const job = manager.getAvailableJobs().find(job => job.Name === name);
    expect(job, name).to.exist;
    await manager.run(name, config, true, false);
    const deadline = performance.now() + 45000;
    while (job.InProgress && performance.now() < deadline) {
      await yieldToJobs();
    }
    expect(job.InProgress, name).to.equal(false);
    const progress = Object.values(manager.getProgresses()).find(progress => progress.jobName === name);
    expect(progress.state).to.equal(JobProgressStates.finished);
    return progress;
  }

  it('generates photo and video thumbnails, then skips cached thumbnails', async () => {
    const size = Config.Media.Photo.thumbnailSizes[0];
    const paths = media.map(file => PhotoProcessing.generateConvertedPath(file, size));
    expect(paths.some(existsSync)).to.equal(false);
    const job = DefaultsJobs[DefaultsJobs['Photo Converting']];
    const config = {sizes: [size], indexedOnly: false};
    expect((await runJob(job, config)).steps.processed).to.equal(3);
    for (const thumbnail of paths) {
      expect(thumbnail).to.include(ProjectPath.TranscodedFolder + path.sep);
      expect((await stat(thumbnail)).size).to.be.greaterThan(0);
    }
    const next = await runJob(job, config);
    expect(next.steps).to.include({processed: 0, skipped: 3});
  });

  it('transcodes the video into the cache', async () => {
    const converted = VideoProcessing.generateConvertedFilePath(media[2]);
    expect(existsSync(converted)).to.equal(false);
    const progress = await runJob(DefaultsJobs[DefaultsJobs['Video Converting']], {indexedOnly: false});
    expect(converted).to.include(ProjectPath.TranscodedFolder + path.sep);
    expect((await stat(converted)).size).to.be.greaterThan(0);
    expect(await VideoProcessing.isValidConvertedPath(converted)).to.equal(true);
    expect(progress.steps.processed).to.equal(1);
  });
});
