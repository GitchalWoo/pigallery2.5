import {expect} from 'chai';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {mock} from 'node:test';
import {setImmediate as yieldToJobs} from 'node:timers/promises';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {ObjectManagers} from '../../../../../src/backend/model/ObjectManagers';
import {JobManager} from '../../../../../src/backend/model/jobs/JobManager';
import {JobRepository} from '../../../../../src/backend/model/jobs/JobRepository';
import {FileJob} from '../../../../../src/backend/model/jobs/jobs/FileJob';
import {type IJob} from '../../../../../src/backend/model/jobs/jobs/IJob';
import {IndexingJob} from '../../../../../src/backend/model/jobs/jobs/IndexingJob';
import {Job} from '../../../../../src/backend/model/jobs/jobs/Job';
import {Config} from '../../../../../src/common/config/private/Config';
import {type DynamicConfig} from '../../../../../src/common/entities/DynamicConfig';
import {JobProgressStates} from '../../../../../src/common/entities/job/JobProgressDTO';
import {type JobScheduleDTO, JobTriggerType} from '../../../../../src/common/entities/job/JobScheduleDTO';

class CountingJob extends Job {
  readonly ConfigTemplate: DynamicConfig[] = [];
  readonly Supported = true;

  constructor(readonly Name: string, private readonly runs: string[]) {
    super();
  }

  protected async init(): Promise<void> {
    this.runs.push(this.Name);
    this.Progress.All = 3;
  }

  protected async step(): Promise<boolean> {
    if (this.Progress.Processed >= this.Progress.All) {
      return false;
    }
    this.Progress.Processed++;
    return true;
  }
}

class BrokenFileJob extends FileJob {
  readonly Name = 'File job with an unreadable photo';
  readonly Supported = true;
  readonly processed: string[] = [];

  constructor() {
    super({noMetaFile: true, noVideo: true});
  }

  protected async shouldProcess(): Promise<boolean> {
    return true;
  }

  protected async processFile(filePath: string): Promise<void> {
    if (path.basename(filePath) === 'broken.jpg') {
      throw new Error('Unsupported image');
    }
    this.processed.push(path.basename(filePath));
  }
}

class TestJobManager extends JobManager {
  get scheduledCount(): number {
    return this.timers.length;
  }
}

describe('JobManager progress and schedules', () => {
  const hour = 60 * 60 * 1000;
  const now = Date.UTC(2026, 10, 26, 12);
  let directory: string;
  let originalFolders: {db: string; media: string};
  let originalSchedules: typeof Config.Jobs.scheduled;
  let manager: TestJobManager;
  let runs: string[];
  let jobA: CountingJob;
  let jobB: CountingJob;
  let jobC: CountingJob;
  let fileJob: BrokenFileJob;
  const indexingJob = JobRepository.Instance.getAvailableJobs().find(job => job instanceof IndexingJob);

  beforeEach(async () => {
    originalFolders = {db: Config.Database.dbFolder, media: Config.Media.folder};
    originalSchedules = Config.Jobs.scheduled;
    directory = await mkdtemp(path.join(tmpdir(), 'pg-job-test-'));
    Config.Database.dbFolder = directory;
    Config.Media.folder = directory;
    ProjectPath.reset();
    runs = [];
    jobA = new CountingJob('Test job A', runs);
    jobB = new CountingJob('Test job B', runs);
    jobC = new CountingJob('Test job C', runs);
    fileJob = new BrokenFileJob();
    for (const job of [jobA, jobB, jobC, fileJob]) {
      JobRepository.Instance.register(job);
    }
    manager = new TestJobManager();
    mock.timers.enable({apis: ['Date', 'setTimeout'], now});
  });

  afterEach(async () => {
    await manager.cleanUp();
    for (const job of [jobA, jobB, jobC, fileJob]) {
      manager.stop(job.Name);
      await until(() => !job.InProgress);
      delete JobRepository.Instance.availableJobs[job.Name];
    }
    mock.restoreAll();
    mock.timers.reset();
    Config.Jobs.scheduled = originalSchedules;
    Config.Database.dbFolder = originalFolders.db;
    Config.Media.folder = originalFolders.media;
    ProjectPath.reset();
    await rm(directory, {recursive: true, force: true});
  });

  async function start(schedules: JobScheduleDTO[] = []): Promise<void> {
    Config.Jobs.scheduled = schedules;
    await manager.init();
  }

  const schedule = (job: IJob, trigger: JobScheduleDTO['trigger']): JobScheduleDTO => ({
    name: job.Name, jobName: job.Name, config: {}, allowParallelRun: false, trigger,
  });

  const progressOf = (job: IJob) => Object.values(manager.getProgresses()).find(progress => progress.jobName === job.Name);

  async function until(condition: () => boolean): Promise<void> {
    const deadline = performance.now() + 3000;
    while (!condition() && performance.now() < deadline) {
      await yieldToJobs();
    }
    expect(condition()).to.equal(true);
  }

  it('reports progress, rejects a concurrent run, and cancels a running job', async () => {
    await start();
    await manager.run(jobA.Name, {}, true, false);
    expect(progressOf(jobA).state).to.equal(JobProgressStates.running);
    await expect(manager.run(jobB.Name, {}, true, false)).to.be.rejectedWith('another is running');
    manager.stop(jobA.Name);
    await until(() => !jobA.InProgress);
    expect(progressOf(jobA).state).to.equal(JobProgressStates.canceled);
    expect(runs).to.deep.equal([jobA.Name]);
  });

  it('logs an unreadable photo and continues the file job', async () => {
    for (const photo of ['beach.jpg', 'broken.jpg', 'mountain.jpg']) {
      await writeFile(path.join(directory, photo), '');
    }
    await start();
    await manager.run(fileJob.Name, {indexedOnly: false}, true, false);
    await until(() => !fileJob.InProgress);
    const progress = progressOf(fileJob);
    expect(progress.state).to.equal(JobProgressStates.finished);
    expect(fileJob.processed.sort()).to.deep.equal(['beach.jpg', 'mountain.jpg']);
    expect(progress.logs.map(log => log.comment).join('\n')).to.match(/broken\.jpg.*Unsupported image/);
  });

  it('logs a failed index and continues with other folders', async () => {
    for (const name of ['beach', 'unreadable', 'mountain']) {
      await mkdir(path.join(directory, name));
    }
    const indexed: string[] = [];
    const managers = ObjectManagers.getInstance();
    const indexDirectory = async (folder: string) => {
      const name = path.basename(folder) || '.';
      if (name === 'unreadable') {
        throw new Error('EACCES: permission denied');
      }
      indexed.push(name);
      return {directories: name === '.' ? ['beach', 'unreadable', 'mountain'].map(n => ({path: '/', name: n})) : []};
    };
    const indexing = {IsSavingInProgress: false, indexDirectory};
    mock.method(managers, 'IndexingManager', () => indexing, {getter: true});
    await start();
    await manager.run(indexingJob.Name, {indexChangesOnly: false}, true, false);
    await until(() => !indexingJob.InProgress);
    expect(indexed.sort()).to.deep.equal(['.', 'beach', 'mountain']);
    expect(progressOf(indexingJob).state).to.equal(JobProgressStates.finished);
    expect(progressOf(indexingJob).logs.map(log => log.comment).join('\n')).to.include('Indexing failed for: /unreadable');
  });

  it('runs a dated job and its chain when the timer fires and skips a past schedule', async () => {
    const past = new CountingJob('Past job', runs);
    await start([
      schedule(jobA, {type: JobTriggerType.scheduled, time: now + hour}),
      schedule(jobB, {type: JobTriggerType.after, afterScheduleName: jobA.Name}),
      schedule(jobC, {type: JobTriggerType.after, afterScheduleName: jobB.Name}),
      schedule(past, {type: JobTriggerType.scheduled, time: now - hour}),
    ]);
    expect(manager.scheduledCount).to.equal(1);
    mock.timers.tick(hour - 1);
    expect(runs).to.deep.equal([]);
    mock.timers.tick(1);
    await until(() => runs.length === 3 && !jobC.InProgress);
    expect(runs).to.deep.equal([jobA.Name, jobB.Name, jobC.Name]);
    expect(progressOf(jobA).steps.processed).to.equal(3);
  });

  it('skips the chain on solo runs and cancellation', async () => {
    await start([
      schedule(jobA, {type: JobTriggerType.never}),
      schedule(jobB, {type: JobTriggerType.after, afterScheduleName: jobA.Name}),
    ]);
    await manager.run(jobA.Name, {}, true, false);
    await until(() => !jobA.InProgress);
    await manager.run(jobA.Name, {}, false, false);
    manager.stop(jobA.Name);
    await until(() => !jobA.InProgress);
    expect(runs).to.deep.equal([jobA.Name, jobA.Name]);
  });

  it('reschedules a periodic job and clears future timers on cleanup', async () => {
    await start([schedule(jobA, {type: JobTriggerType.periodic, periodicity: 7, atTime: 13 * 60})]);
    mock.timers.tick(hour);
    await until(() => runs.length === 1 && !jobA.InProgress && manager.scheduledCount === 1);
    mock.timers.tick(24 * hour);
    await until(() => runs.length === 2 && !jobA.InProgress && manager.scheduledCount === 1);
    await manager.cleanUp();
    mock.timers.tick(24 * hour);
    expect(manager.scheduledCount).to.equal(0);
    expect(runs).to.deep.equal([jobA.Name, jobA.Name]);
  });
});
