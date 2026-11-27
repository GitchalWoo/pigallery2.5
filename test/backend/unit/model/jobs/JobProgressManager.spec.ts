import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mock} from 'node:test';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {JobProgressManager} from '../../../../../src/backend/model/jobs/JobProgressManager';
import {JobProgress} from '../../../../../src/backend/model/jobs/jobs/JobProgress';

describe('JobProgressManager', () => {
  it('persists the latest progress when the delayed save runs', async () => {
    const originalDBFolder = ProjectPath.DBFolder;
    const folder = await fs.mkdtemp(join(tmpdir(), 'pg-job-progress-'));
    ProjectPath.DBFolder = folder;
    const writeFile = mock.method(fs, 'writeFile');
    mock.timers.enable({apis: ['setTimeout']});
    try {
      const manager = new JobProgressManager();
      const job = new JobProgress('Index gallery', 'index', '[Test]');
      manager.onJobProgressUpdate(structuredClone(job.toDTO()));
      job.Processed = 2;
      const progress = job.toDTO();
      manager.onJobProgressUpdate(progress);
      assert.equal(manager.Progresses[job.HashName].steps.processed, 2);

      mock.timers.tick(4999);
      assert.equal(writeFile.mock.callCount(), 0);
      mock.timers.tick(1);
      // cleanUp() waits for the save the timer started
      await manager.cleanUp();
      assert.equal(writeFile.mock.callCount(), 1);

      const saved = JSON.parse(await fs.readFile(join(folder, 'jobs.db'), 'utf8'));
      assert.deepEqual(saved.progresses[job.HashName].progress, progress);
    } finally {
      mock.timers.reset();
      writeFile.mock.restore();
      ProjectPath.DBFolder = originalDBFolder;
      await fs.rm(folder, {recursive: true, force: true});
    }
  });

  describe('cleanUp', () => {
    let originalDBFolder: string;
    let folder: string;

    beforeEach(async () => {
      originalDBFolder = ProjectPath.DBFolder;
      folder = await fs.mkdtemp(join(tmpdir(), 'pg-job-progress-'));
      ProjectPath.DBFolder = folder;
    });

    afterEach(async () => {
      mock.timers.reset();
      mock.restoreAll();
      ProjectPath.DBFolder = originalDBFolder;
      await fs.rm(folder, {recursive: true, force: true});
    });

    const readSaved = async () => JSON.parse(await fs.readFile(join(folder, 'jobs.db'), 'utf8'));

    it('writes a pending save right away and cancels its timer', async () => {
      mock.timers.enable({apis: ['setTimeout']});
      const manager = new JobProgressManager();
      const job = new JobProgress('Index gallery', 'index', '[Test]');
      manager.onJobProgressUpdate(job.toDTO());

      await manager.cleanUp();
      assert.ok((await readSaved()).progresses[job.HashName]);

      const writeFile = mock.method(fs, 'writeFile');
      mock.timers.tick(5000);
      await new Promise(setImmediate);
      assert.equal(writeFile.mock.callCount(), 0);
    });

    it('waits for a save already in flight', async () => {
      mock.timers.enable({apis: ['setTimeout']});
      const manager = new JobProgressManager();
      const job = new JobProgress('Index gallery', 'index', '[Test]');
      let finishWrite: () => void;
      const realWriteFile = fs.writeFile;
      let written = false;
      mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
        await new Promise<void>((resolve) => finishWrite = resolve);
        await realWriteFile(...args);
        written = true;
      });
      manager.onJobProgressUpdate(job.toDTO());
      mock.timers.tick(5000);
      while (!finishWrite) {
        await new Promise(setImmediate);
      }

      let cleanedUp = false;
      const cleanUp = manager.cleanUp().then(() => cleanedUp = true);
      await new Promise(setImmediate);
      assert.equal(cleanedUp, false);

      finishWrite();
      await cleanUp;
      assert.equal(written, true);
      assert.ok((await readSaved()).progresses[job.HashName]);
    });

    it('recreates a missing DB folder', async () => {
      const nested = join(folder, 'removed', 'db');
      ProjectPath.DBFolder = nested;
      const manager = new JobProgressManager();
      manager.onJobProgressUpdate(new JobProgress('Index gallery', 'index', '[Test]').toDTO());
      await manager.cleanUp();
      await fs.access(join(nested, 'jobs.db'));
    });

    it('does nothing without pending progress', async () => {
      const writeFile = mock.method(fs, 'writeFile');
      await new JobProgressManager().cleanUp();
      assert.equal(writeFile.mock.callCount(), 0);
    });
  });
});
