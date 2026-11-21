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
      assert.equal(writeFile.mock.callCount(), 1);
      await writeFile.mock.calls[0].result;

      const saved = JSON.parse(await fs.readFile(join(folder, 'jobs.db'), 'utf8'));
      assert.deepEqual(saved.progresses[job.HashName].progress, progress);
    } finally {
      mock.timers.reset();
      writeFile.mock.restore();
      ProjectPath.DBFolder = originalDBFolder;
      await fs.rm(folder, {recursive: true, force: true});
    }
  });
});
