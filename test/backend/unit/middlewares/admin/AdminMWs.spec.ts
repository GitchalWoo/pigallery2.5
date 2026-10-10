import {expect} from 'chai';
import {AdminMWs} from '../../../../../src/backend/middlewares/admin/AdminMWs';
import {ErrorCodes, ErrorDTO} from '../../../../../src/common/entities/Error';
import {ObjectManagers} from '../../../../../src/backend/model/ObjectManagers';
import {MessengerRepository} from '../../../../../src/backend/model/messenger/MessengerRepository';

describe('AdminMWs', () => {
  let managers: ObjectManagers;
  const originals: Record<string, unknown> = {};
  let calls: Array<{name: string; args: unknown[]}>;
  let error: any;
  let originalGetMessengers: () => unknown[];

  const invoke = async (method: (req: any, res: any, next: (err?: any) => void) => unknown, req: any = {}) => {
    error = undefined;
    await method(req, {}, (err?: any) => { error = err; });
  };

  beforeEach(() => {
    managers = ObjectManagers.getInstance();
    calls = [];
    originalGetMessengers = MessengerRepository.Instance.getAll;
    (MessengerRepository.Instance as any).getAll = () => [{Name: 'test-messenger'}];
    for (const key of ['GalleryManager', 'PersonManager', 'JobManager']) originals[key] = (managers as any)[key];
    (managers as any).GalleryManager = {
      countDirectories: async () => 1, countPhotos: async () => 2, countVideos: async () => 3,
      countMediaSize: async () => 40, getPossibleDuplicates: async () => ['duplicate'],
    };
    (managers as any).PersonManager = {countFaces: async () => 5};
    (managers as any).JobManager = {
      run: async (...args: unknown[]) => { calls.push({name: 'run', args}); },
      stop: (...args: unknown[]) => { calls.push({name: 'stop', args}); },
      getAvailableJobs: () => ['job'], getProgresses: () => ['progress'],
    };
  });

  afterEach(() => {
    for (const key of Object.keys(originals)) (managers as any)[key] = originals[key];
    (MessengerRepository.Instance as any).getAll = originalGetMessengers;
  });

  it('collects statistics and possible duplicates', async () => {
    const stats: any = {};
    await invoke(AdminMWs.loadStatistic, stats);
    expect(error).to.equal(undefined);
    expect(stats.resultPipe).to.include({directories: 1, photos: 2, videos: 3, diskUsage: 40, persons: 5});
    const duplicateReq: any = {};
    await invoke(AdminMWs.getDuplicates, duplicateReq);
    expect(duplicateReq.resultPipe).to.deep.equal(['duplicate']);
  });

  it('starts and stops jobs with the requested arguments', async () => {
    const req: any = {params: {id: 'scan'}, body: {config: {indexedOnly: false}, soloRun: true, allowParallelRun: false}};
    await invoke(AdminMWs.startJob, req);
    expect(error).to.equal(undefined);
    expect(req.resultPipe).to.equal('ok');
    expect(calls[0]).to.deep.equal({name: 'run', args: ['scan', {indexedOnly: false}, true, false]});

    const stopReq: any = {params: {id: 'scan'}};
    await invoke(AdminMWs.stopJob, stopReq);
    expect(error).to.equal(undefined);
    expect(calls[1]).to.deep.equal({name: 'stop', args: ['scan']});
  });

  it('returns available job data', async () => {
    const jobs: any = {};
    AdminMWs.getAvailableJobs(jobs, {} as any, () => undefined);
    expect(jobs.resultPipe).to.deep.equal(['job']);
    const progress: any = {};
    AdminMWs.getJobProgresses(progress, {} as any, () => undefined);
    expect(progress.resultPipe).to.deep.equal(['progress']);
    const messengers: any = {};
    AdminMWs.getAvailableMessengers(messengers, {} as any, () => undefined);
    expect(messengers.resultPipe).to.deep.equal(['test-messenger']);
  });

  it('wraps job and statistics errors as application errors', async () => {
    (managers as any).JobManager.run = async () => { throw new Error('job failed'); };
    await invoke(AdminMWs.startJob, {params: {id: 'broken'}, body: {config: {}}});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.JOB_ERROR);

    (managers as any).GalleryManager.countPhotos = async () => { throw new Error('database failed'); };
    await invoke(AdminMWs.loadStatistic, {});
    expect(error).to.be.instanceOf(ErrorDTO);
    expect(error.code).to.equal(ErrorCodes.GENERAL_ERROR);
  });
});
