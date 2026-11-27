import {promises as fsp} from 'fs';
import * as path from 'path';
import {ProjectPath} from '../../ProjectPath';
import {Config} from '../../../common/config/private/Config';
import {JobProgressDTO, JobProgressStates,} from '../../../common/entities/job/JobProgressDTO';

export class JobProgressManager {
  private static readonly VERSION = 3;
  private db: {
    version: number;
    progresses: Record<string, { progress: JobProgressDTO; timestamp: number }>;
  } = {
    version: JobProgressManager.VERSION,
    progresses: {},
  };
  private readonly dbPath: string;
  private timer: NodeJS.Timeout = null;
  private saving: Promise<void> = null;

  constructor() {
    this.dbPath = path.join(ProjectPath.DBFolder, 'jobs.db');
    this.loadDB().catch(console.error);
  }

  get Progresses(): Record<string, JobProgressDTO> {
    const m: Record<string, JobProgressDTO> = {};
    for (const key of Object.keys(this.db.progresses)) {
      m[key] = this.db.progresses[key].progress;
      if (
          this.db.progresses[key].progress.state === JobProgressStates.running
      ) {
        m[key].time.end = Date.now();
      }
    }
    return m;
  }

  onJobProgressUpdate(progress: JobProgressDTO): void {
    this.db.progresses[progress.HashName] = {progress, timestamp: Date.now()};
    this.delayedSave();
  }

  /**
   * Writes out a pending delayed save and waits for a save in flight,
   * so no write happens after shutdown (e.g. after the DB folder was removed).
   */
  async cleanUp(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.save();
    }
    await this.saving;
  }

  private async loadDB(): Promise<void> {
    try {
      await fsp.access(this.dbPath);
    } catch {
      return;
    }
    const data = await fsp.readFile(this.dbPath, 'utf8');
    const db = JSON.parse(data);
    if (db.version !== JobProgressManager.VERSION) {
      return;
    }
    this.db = db;

    while (
        Object.keys(this.db.progresses).length >
        Config.Jobs.maxSavedProgress
        ) {
      let min: string = null;
      for (const key of Object.keys(this.db.progresses)) {
        if (
            min === null ||
            this.db.progresses[min].timestamp > this.db.progresses[key].timestamp
        ) {
          min = key;
        }
      }
      delete this.db.progresses[min];
    }

    for (const key of Object.keys(this.db.progresses)) {
      if (
          this.db.progresses[key].progress.state === JobProgressStates.running ||
          this.db.progresses[key].progress.state === JobProgressStates.cancelling
      ) {
        this.db.progresses[key].progress.state = JobProgressStates.interrupted;
      }
    }
  }

  private async saveDB(): Promise<void> {
    await fsp.mkdir(path.dirname(this.dbPath), {recursive: true});
    await fsp.writeFile(this.dbPath, JSON.stringify(this.db));
  }

  /**
   * Saves after the previous save finished, so two writes never overlap.
   */
  private save(): Promise<void> {
    const saving = (this.saving || Promise.resolve())
      .then(() => this.saveDB())
      .catch(console.error)
      .finally(() => {
        if (this.saving === saving) {
          this.saving = null;
        }
      });
    this.saving = saving;
    return saving;
  }

  private delayedSave(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      this.save().catch(console.error);
    }, 5000);
  }
}
