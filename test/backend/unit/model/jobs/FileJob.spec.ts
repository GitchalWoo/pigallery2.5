import {expect} from 'chai';
import {FileJob} from '../../../../../src/backend/model/jobs/jobs/FileJob';
import {JobProgress} from '../../../../../src/backend/model/jobs/jobs/JobProgress';
import {DirectoryScanSettings, DiskManager} from '../../../../../src/backend/model/fileaccess/DiskManager';
import {DynamicConfig} from '../../../../../src/common/entities/DynamicConfig';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';

class TestFileJob extends FileJob {
  public readonly Name = 'Test file job';
  public readonly Supported = true;
  public readonly ConfigTemplate: DynamicConfig[] = [];
  public processed: string[] = [];
  public failOn: string | null = null;
  public filterOut: string | null = null;

  constructor(scan: DirectoryScanSettings = {noPhoto: true, noVideo: true, noMetaFile: true}) { super(scan); }
  public setup(indexedOnly: boolean): void {
    (this as any).config = {indexedOnly};
    (this as any).progress = new JobProgress(this.Name, 'test', this.LOG_TAG);
  }
  public queueFile(file: string): void { this.fileQueue.push(file); }
  public queueDirectory(directory: string): void { this.directoryQueue.push(directory); }
  public getQueuedFiles(): string[] { return [...this.fileQueue]; }
  public getQueuedDirectories(): string[] { return [...this.directoryQueue]; }
  public runStep(): Promise<boolean> { return this.step(); }
  protected async filterMediaFiles(files: any[]): Promise<any[]> { return files.filter(file => file.name !== this.filterOut); }
  protected async shouldProcess(_filePath: string): Promise<boolean> { return true; }
  protected async processFile(filePath: string): Promise<void> {
    this.processed.push(filePath);
    if (filePath === this.failOn) throw new Error('fixture processing failure');
  }
}

describe('FileJob processing loop', () => {
  it('continues after a file processing error and stops after queued files are consumed', async () => {
    const job = new TestFileJob();
    job.setup(false);
    job.directoryQueue = [];
    job.queueFile('/gallery/first.jpg');
    job.queueFile('/gallery/second.jpg');
    job.failOn = '/gallery/first.jpg';
    const originalError = console.error;
    console.error = () => undefined;
    try {
      expect(await job.runStep()).to.equal(true);
      expect(await job.runStep()).to.equal(true);
      expect(await job.runStep()).to.equal(false);
    } finally {
      console.error = originalError;
    }
    expect(job.processed).to.deep.equal(['/gallery/first.jpg', '/gallery/second.jpg']);
    expect(job.Progress.Processed).to.equal(2);
  });

  it('does not scan or query when indexed-only processing is already exhausted', async () => {
    const job = new TestFileJob();
    job.setup(true);
    job.directoryQueue = [];
    job.DBProcessing.hasMoreMedia = false;
    expect(await job.runStep()).to.equal(false);
    expect(job.processed).to.deep.equal([]);
  });

  it('scans child directories, filters media, and records filtered files as skipped', async () => {
    const job = new TestFileJob({noVideo: true, noMetaFile: true});
    job.setup(false);
    job.filterOut = 'skip.jpg';
    job.queueDirectory('/gallery');
    const originalScan = DiskManager.scanDirectoryNoMetadata;
    (DiskManager as any).scanDirectoryNoMetadata = async () => ({
      path: '/', name: '', media: [{name: 'keep.jpg'}, {name: 'skip.jpg'}], metaFile: [] as any[],
      directories: [{path: '/', name: 'child', media: [], metaFile: [], directories: []} as any],
    });
    try {
      expect(await job.runStep()).to.equal(true);
    } finally {
      DiskManager.scanDirectoryNoMetadata = originalScan;
    }
    expect(job.getQueuedFiles()).to.deep.equal([ProjectPath.ImageFolder + '/keep.jpg']);
    expect(job.getQueuedDirectories()).to.deep.equal(['/child']);
    expect(job.Progress.Skipped).to.equal(1);
  });
});
