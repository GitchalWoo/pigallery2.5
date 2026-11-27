import {EventEmitter, Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {type JobProgressDTO, JobProgressStates, type OnTimerJobProgressDTO,} from '../../../../common/entities/job/JobProgressDTO';
import {NetworkService} from '../../model/network/network.service';
import {type JobScheduleDTO} from '../../../../common/entities/job/JobScheduleDTO';
import {type JobDTO, JobDTOUtils, type JobStartDTO} from '../../../../common/entities/job/JobDTO';
import {BackendtextService} from '../../model/backendtext.service';
import {NotificationService} from '../../model/notification.service';
import {type DynamicConfig} from '../../../../common/entities/DynamicConfig';

@Injectable()
export class ScheduledJobsService {
  public progress: BehaviorSubject<Record<string, OnTimerJobProgressDTO>>;
  public onJobFinish: EventEmitter<string> = new EventEmitter<string>();
  private timer: number = null;
  public availableJobs: BehaviorSubject<JobDTO[]>;
  public availableMessengers: BehaviorSubject<string[]>;
  public jobStartingStopping: Record<string, boolean> = {};
  private subscribers = 0;
  private progressRequest = 0;
  private appliedProgressRequest = 0;

  constructor(
    private networkService: NetworkService,
    private notification: NotificationService,
    private backendTextService: BackendtextService
  ) {
    this.progress = new BehaviorSubject({});
    this.availableJobs = new BehaviorSubject([]);
    this.availableMessengers = new BehaviorSubject([]);
  }

  public  isValidJob(name: string): boolean {
    return !!this.availableJobs.value.find(j => j.Name === name);
  }

  private async getAvailableJobs(): Promise<void> {
    this.availableJobs.next(
      await this.networkService.getJson<JobDTO[]>('/admin/jobs/available')
    );
  }

  public async getAvailableMessengers(): Promise<void> {
    this.availableMessengers.next(
      await this.networkService.getJson<string[]>('/admin/messengers/available')
    );
  }

  public getConfigTemplate(JobName: string): DynamicConfig[] {
    const job = this.availableJobs.value.find(
      (t) => t.Name === JobName
    );
    if (job && job.ConfigTemplate && job.ConfigTemplate.length > 0) {
      return job.ConfigTemplate;
    }
    return null;
  }

  public getDefaultConfig(jobName: string): Record<string, unknown> {

    const ct = this.getConfigTemplate(jobName);
    if (!ct) {
      return null;
    }
    const config = {} as Record<string, unknown>;
    ct.forEach(c => config[c.id] = c.defaultValue);
    return config;
  }

  getProgress(schedule: JobScheduleDTO): JobProgressDTO {
    return this.progress.value[
      JobDTOUtils.getHashName(schedule.jobName, schedule.config)
      ];
  }

  subscribeToProgress(): void {
    if (++this.subscribers === 1) {
      this.getAvailableJobs().catch(console.error);
      this.getProgressPeriodically();
    }
  }

  unsubscribeFromProgress(): void {
    if (--this.subscribers === 0) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public async forceUpdate(): Promise<void> {
    return await this.loadProgress();
  }

  public async start(
    jobName: string,
    config?: Record<string, unknown>,
    soloRun = false,
    allowParallelRun = false
  ): Promise<void> {
    try {
      this.jobStartingStopping[jobName] = true;
      await this.networkService.postJson(
        '/admin/jobs/scheduled/' + jobName + '/start',
        {
          config,
          allowParallelRun,
          soloRun,
        } as JobStartDTO
      );
      // placeholder to force showing running job
      this.addDummyProgress(jobName, config);
    } finally {
      delete this.jobStartingStopping[jobName];
      this.forceUpdate();
    }
  }

  public async stop(jobName: string): Promise<void> {
    this.jobStartingStopping[jobName] = true;
    await this.networkService.postJson(
      '/admin/jobs/scheduled/' + jobName + '/stop'
    );
    delete this.jobStartingStopping[jobName];
    this.forceUpdate();
  }

  protected async loadProgress(): Promise<void> {
    const request = ++this.progressRequest;
    const nextProgress = await this.networkService.getJson<Record<string, OnTimerJobProgressDTO>>(
      '/admin/jobs/scheduled/progress'
    );
    if (request < this.appliedProgressRequest) {
      return;
    }
    this.appliedProgressRequest = request;
    const prevPrg = this.progress.value;
    this.progress.next(nextProgress);
    for (const [hash, previous] of Object.entries(prevPrg)) {
      const state = nextProgress[hash]?.state;
      if (this.isActive(previous.state) && !this.isActive(state)) {
        this.onJobFinish.emit(hash);
        if (state === JobProgressStates.failed) {
          this.notification.warning(
            $localize`Job failed` +
            ': ' +
            this.backendTextService.getJobName(previous.jobName)
          );
        } else {
          this.notification.success(
            $localize`Job finished` +
            ': ' +
            this.backendTextService.getJobName(previous.jobName)
          );
        }
      }
    }
  }

  protected isAnyJobRunning(): boolean {
    return Object.values(this.progress.value).some(p => this.isActive(p.state));
  }

  private isActive(state: JobProgressStates | undefined): boolean {
    return state === JobProgressStates.running || state === JobProgressStates.cancelling;
  }

  protected getProgressPeriodically(): void {
    if (this.timer != null || this.subscribers === 0) {
      return;
    }
    let repeatTime = 5000;
    if (!this.isAnyJobRunning()) {
      repeatTime = 15000;
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.getProgressPeriodically();
    }, repeatTime);
    this.loadProgress().catch(console.error);
  }

  private addDummyProgress(jobName: string, config: any): void {
    const prgs = this.progress.value;
    prgs[JobDTOUtils.getHashName(jobName, config)] = {
      jobName,
      state: JobProgressStates.running,
      HashName: JobDTOUtils.getHashName(jobName, config),
      logs: [],
      steps: {
        skipped: 0,
        processed: 0,
        all: 0,
      },
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    };
    this.progress.next(prgs);
  }

}
