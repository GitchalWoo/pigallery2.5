import {expect} from 'chai';
import {setImmediate as yieldToJobs} from 'node:timers/promises';
import {Job} from '../../../../../src/backend/model/jobs/jobs/Job';
import {type IJob} from '../../../../../src/backend/model/jobs/jobs/IJob';
import {type DynamicConfig} from '../../../../../src/common/entities/DynamicConfig';
import {JobProgressStates} from '../../../../../src/common/entities/job/JobProgressDTO';

class FailingJob extends Job {
  readonly Name = 'Failing job';
  readonly ConfigTemplate: DynamicConfig[] = [];
  readonly Supported = true;

  protected async init(): Promise<void> {
    // nothing to prepare
  }

  protected async step(): Promise<boolean> {
    throw new Error('boom');
  }
}

class EmptyJob extends Job {
  readonly Name = 'Empty job';
  readonly ConfigTemplate: DynamicConfig[] = [];
  readonly Supported: boolean = true;

  protected async init(): Promise<void> {
    // nothing to prepare
  }

  protected async step(): Promise<boolean> {
    return false;
  }
}

class UnsupportedJob extends EmptyJob {
  override readonly Supported: boolean = false;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await yieldToJobs();
  }
};

describe('Job', () => {

  it('logs the reason of a failure with its prefix', async () => {
    const job = new FailingJob();
    job.JobListener = {
      onJobFinished: async (): Promise<void> => undefined,
      onProgressUpdate: (): void => undefined,
    };
    await job.start({});
    await settle();
    expect(job.Progress.State).to.equal(JobProgressStates.failed);
    expect(job.Progress.Logs.map(l => l.comment)).to.include('Failed with: Error: boom');
  });

  it('catches an error of the finish listener', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const finished: IJob[] = [];
      const job = new EmptyJob();
      job.JobListener = {
        onJobFinished: async (j: IJob): Promise<void> => {
          finished.push(j);
          throw new Error('listener failed');
        },
        onProgressUpdate: (): void => undefined,
      };
      await job.start({});
      await settle();
      expect(finished).to.deep.equal([job]);
      expect(unhandled).to.deep.equal([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('rejects the start of an unsupported job with an Error', async () => {
    const job = new UnsupportedJob();
    const err = await job.start({}).then((): unknown => null, (e: unknown) => e);
    expect(err).to.be.instanceOf(Error);
    expect((err as Error).message).to.contain('not supported');
  });
});
