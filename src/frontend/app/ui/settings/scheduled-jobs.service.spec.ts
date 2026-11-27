import {JobDTOUtils} from '../../../../common/entities/job/JobDTO';
import {type JobProgressDTO, JobProgressStates} from '../../../../common/entities/job/JobProgressDTO';
import {type NetworkService} from '../../model/network/network.service';
import {type NotificationService} from '../../model/notification.service';
import {type BackendtextService} from '../../model/backendtext.service';
import {ScheduledJobsService} from './scheduled-jobs.service';

describe('ScheduledJobsService', () => {
  const name = 'Indexing';
  const config = {indexChangesOnly: true};
  const hash = JobDTOUtils.getHashName(name, config);
  const progress = (state: JobProgressStates): Record<string, JobProgressDTO> => ({
    [hash]: {HashName: hash, jobName: name, state, steps: {all: 3, processed: 1, skipped: 0}, time: {start: 1, end: 2}, logs: []},
  });

  function setup() {
    const notifications = {warning: vi.fn(), success: vi.fn()};
    const getJson = vi.fn();
    const service = new ScheduledJobsService(
      {getJson} as unknown as NetworkService,
      notifications as unknown as NotificationService,
      {getJobName: (job: string) => job} as BackendtextService
    );
    const finish = vi.fn();
    service.onJobFinish.subscribe(finish);
    return {service, getJson, notifications, finish};
  }

  afterEach(() => vi.useRealTimers());

  it('counts disappearing active jobs and keeps explicit failure warnings', async () => {
    const {service, getJson, notifications, finish} = setup();
    getJson.mockResolvedValueOnce({}).mockResolvedValueOnce(progress(JobProgressStates.running))
      .mockResolvedValueOnce(progress(JobProgressStates.failed)).mockResolvedValueOnce({});
    service.progress.next(progress(JobProgressStates.cancelling));

    await service.forceUpdate();
    expect(finish).toHaveBeenCalledExactlyOnceWith(hash);
    expect(notifications.success).toHaveBeenCalledExactlyOnceWith('Job finished: Indexing');
    await service.forceUpdate();
    await service.forceUpdate();
    expect(notifications.warning).toHaveBeenCalledExactlyOnceWith('Job failed: Indexing');
    await service.forceUpdate();
    expect(finish).toHaveBeenCalledTimes(2);
  });

  it('ignores an older poll arriving after a newer completion', async () => {
    const {service, getJson, finish} = setup();
    let resolveOlder: (value: ReturnType<typeof progress>) => void;
    const older = new Promise<ReturnType<typeof progress>>(resolve => resolveOlder = resolve);
    getJson.mockReturnValueOnce(older).mockResolvedValueOnce({});
    service.progress.next(progress(JobProgressStates.running));

    const poll = service.forceUpdate();
    await service.forceUpdate();
    resolveOlder(progress(JobProgressStates.running));
    await poll;
    expect(service.progress.value).toEqual({});
    expect(finish).toHaveBeenCalledExactlyOnceWith(hash);
  });

  it('shares one poll among settings cards and stops it on the last unsubscribe', async () => {
    vi.useFakeTimers();
    const {service, getJson} = setup();
    getJson.mockImplementation((path: string) => Promise.resolve(path.endsWith('/available')
      ? [{Name: name, ConfigTemplate: [{id: 'indexChangesOnly', defaultValue: true}]}]
      : progress(JobProgressStates.running)));
    service.subscribeToProgress();
    service.subscribeToProgress();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getDefaultConfig(name)).toEqual(config);
    expect(service.progress.value[hash].state).toBe(JobProgressStates.running);
    expect(getJson).toHaveBeenCalledTimes(2);
    service.unsubscribeFromProgress();
    await vi.advanceTimersByTimeAsync(15000);
    expect(getJson).toHaveBeenCalledTimes(3);
    service.unsubscribeFromProgress();
    await vi.advanceTimersByTimeAsync(30000);
    expect(getJson).toHaveBeenCalledTimes(3);
    service.subscribeToProgress();
    expect(getJson).toHaveBeenCalledTimes(5);
    service.unsubscribeFromProgress();
  });
});
