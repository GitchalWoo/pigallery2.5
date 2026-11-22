import {Injectable, signal} from '@angular/core';
import {HttpEventType} from '@angular/common/http';
import {NetworkService} from '../../../model/network/network.service';
import {UploadUtils} from '../../../../../common/UploadUtils';
import {Utils} from '../../../../../common/Utils';
import {ContentLoaderService} from '../contentLoader.service';
import {Config} from '../../../../../common/config/public/Config';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {NotificationService} from '../../../model/notification.service';
import {PG2ConfMap} from '../../../../../common/PG2ConfMap';
import {ErrorCodes, type ErrorDTO} from '../../../../../common/entities/Error';
import {type Message} from '../../../../../common/entities/Message';

// a file the server could not save, matched to the uploaded file by its name
interface UploadFileError {
  filename: string;
  error: string;
}

export interface UploadProgress {
  name: string;
  progress: number;
  error?: string;
  done: boolean;
  status?: 'queued' | 'uploading' | 'done' | 'error';
  lastUpdate: number;
  count?: number; // Added for consolidated items
  // a failure that may go away when sent again (e.g. the connection dropped)
  onRetry?: () => void;
}

interface QueuedUpload {
  file: File;
  directory: string;
  progressItem: UploadProgress;
}

@Injectable({
  providedIn: 'root'
})
export class UploaderService {
  public readonly uploadProgressSignal = signal<UploadProgress[]>([]);

  get uploadProgress(): UploadProgress[] {
    return this.uploadProgressSignal();
  }
  private uploadQueue: QueuedUpload[] = [];
  private activeUploads = 0;
  private MAX_CONCURRENT_UPLOADS = 1;
  private readonly DEFAULT_MAX_CONCURRENT_UPLOADS = 1;
  private readonly MAX_ALLOWED_CONCURRENT_UPLOADS = 10;
  private speedTimer: any = null;
  // Result of the current batch: everything uploaded since the queue was last empty.
  // A retried file does not count as failed anymore.
  private batchUploaded = 0;
  private readonly batchFailed = new Set<UploadProgress>();
  private lastProgressSum = 0;
  private lastUpdateTimestamp = 0;

  constructor(private networkService: NetworkService,
              private notificationService: NotificationService,
              private authService: AuthenticationService,
              private contentLoaderService: ContentLoaderService) {
  }

  // Known gap: a folder the user can only navigate (its content is hidden) still offers the upload,
  // the server then answers "Directory not found". The client does not know the access of a folder.
  public canUpload(): boolean {
    const dir = this.contentLoaderService.content.value.directory;
    if (!Config.Upload.enabled ||
      !this.authService.isAuthenticated() ||
      this.authService.user.value.role < Config.Upload.minimumRole ||
      !dir) {
      return false;
    }

    if (Config.Upload.enforcedDirectoryConfig === true) {
      if (!dir.metaFile || !dir.metaFile.some(m => PG2ConfMap.upload[m.name])) {
        return false;
      }
    }

    return true;
  }


  public async uploadFiles(filesIn: FileList | File[]): Promise<void> {
    if (this.canUpload() === false) {
      this.notificationService.error($localize`Upload is not supported for this directory.`);
      return;
    }
    const files = [];
    for (let i = 0; i < filesIn.length; i++) {
      files.push(filesIn[i]);
    }
    const dirDto = this.contentLoaderService.content.value.directory;
    const directory = Utils.concatUrls(dirDto.path, dirDto.name);
    const maxBytes = Config.Upload.maxFileSizeMB * 1024 * 1024;
    const supportedFiles = files.filter(f => {
      if (!UploadUtils.isUploadableExtension(UploadUtils.getExtension(f.name), Config.Upload.blockedExtensions)) {
        this.rejectFile(f, $localize`Unsupported file format`);
        return false;
      }
      // the server would reject it too, only after the whole file was sent
      if (f.size > maxBytes) {
        this.rejectFile(f, $localize`The file is larger than the upload limit of ${Config.Upload.maxFileSizeMB}:limit: MB`);
        return false;
      }
      return true;
    });

    if (supportedFiles.length === 0) {
      return;
    }

    // Track each file individually in the progress list
    const progressItems: UploadProgress[] = [];
    const existingFiles: File[] = [];

    for (const f of supportedFiles) {
      // Check if the file already exists in the current directory
      const dir = this.contentLoaderService.content.value.directory;
      let fileExists = false;
      if (dir) {
        fileExists = (dir.media && dir.media.some(m => m.name === f.name)) ||
          (dir.metaFile && dir.metaFile.some(m => m.name === f.name));
      }

      if (fileExists) {
        existingFiles.push(f);
      } else {
        const progressItem: UploadProgress = {
          name: f.name,
          progress: 0,
          done: false,
          status: 'queued',
          lastUpdate: Date.now()
        };
        progressItems.push(progressItem);
        this.uploadQueue.push({
          file: f,
          directory,
          progressItem
        });
      }
    }

    if (existingFiles.length > 0) {
      const existingItem: UploadProgress = {
        name: existingFiles.length === 1 ? existingFiles[0].name : existingFiles.length + ' ' + $localize`files already exist`,
        progress: 100,
        done: true,
        status: 'error',
        lastUpdate: Date.now(),
        error: $localize`File already exists`,
        count: existingFiles.length
      };
      // an error needs the user's attention: it stays until it is closed
      this.uploadProgressSignal.update(list => [...list, existingItem]);
    }

    if (progressItems.length === 0) {
      return;
    }

    this.uploadProgressSignal.update(list => [...list, ...progressItems]);
    this.startSpeedTracking();
    this.processQueue();
  }

  private startSpeedTracking(): void {
    if (this.speedTimer) {
      return;
    }
    this.lastProgressSum = this.uploadProgress.reduce((a, b) => a + (b.status === 'uploading' ? b.progress : 0), 0);
    this.lastUpdateTimestamp = Date.now();
    this.speedTimer = setInterval(() => {
      const currentProgressSum = this.uploadProgress.reduce((a, b) => a + (b.status === 'uploading' ? b.progress : 0), 0);
      const now = Date.now();
      const timeDiff = (now - this.lastUpdateTimestamp) / 1000; // in seconds

      if (timeDiff >= 1 && this.activeUploads > 0) {
        const speed = (currentProgressSum - this.lastProgressSum) / timeDiff; // % per second

        if (speed > 20 && this.MAX_CONCURRENT_UPLOADS < this.MAX_ALLOWED_CONCURRENT_UPLOADS) {
          this.MAX_CONCURRENT_UPLOADS++;
          this.processQueue();
        } else if (speed < 20 && this.MAX_CONCURRENT_UPLOADS > this.DEFAULT_MAX_CONCURRENT_UPLOADS) {
          this.MAX_CONCURRENT_UPLOADS--;
        }

        this.lastProgressSum = currentProgressSum;
        this.lastUpdateTimestamp = now;
      }

      if (this.activeUploads === 0 && this.uploadQueue.length === 0) {
        this.stopSpeedTracking();
      }
    }, 1000);
  }

  private stopSpeedTracking(): void {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
  }

  private processQueue(): void {
    while (this.activeUploads < this.MAX_CONCURRENT_UPLOADS && this.uploadQueue.length > 0) {
      const upload = this.uploadQueue.shift();
      this.activeUploads++;
      this._uploadFile(upload);
    }
  }

  private _uploadFile(upload: QueuedUpload): void {
    const {file, directory, progressItem} = upload;
    progressItem.status = 'uploading';
    this.notifyProgressChanged();

    const formData = new FormData();
    formData.append('files', file);

    const url = '/upload/' + (directory || '');

    this.networkService.postFormData<UploadFileError[]>(url, formData).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          progressItem.progress = Math.round((100 * event.loaded) / event.total);
          progressItem.lastUpdate = Date.now();
          this.notifyProgressChanged();
        } else if (event.type === HttpEventType.Response) {
          const response = event.body as Message<UploadFileError[]>;
          // the server answered, so sending it again would fail the same way
          if (response?.error) {
            this.onUploadFailed(upload, UploaderService.describeError(response.error));
            return;
          }
          const serverErrors = response?.result || [];
          const serverError = serverErrors.find((e) => e.filename === progressItem.name);
          if (serverError) {
            this.onUploadFailed(upload, serverError.error);
            return;
          }
          progressItem.progress = 100;
          progressItem.lastUpdate = Date.now();
          progressItem.status = 'done';
          progressItem.done = true;
          this.batchUploaded++;
          this.notifyProgressChanged();
          this.onUploadFinished();
          this._cleanupProgress([progressItem]);
        }
      },
      // the error interceptor passes on the ErrorDTO of the server, or a text when there was no answer from it
      error: (err: ErrorDTO | string) => {
        if (typeof err === 'object' && UploaderService.isFolderError(err)) {
          // sending it again would fail the same way
          this.onUploadFailed(upload, UploaderService.describeError(err));
          return;
        }
        // e.g. the connection dropped or too many uploads at once: sending it again may work
        this.onUploadFailed(upload, (typeof err === 'object' ? err?.message : err) || $localize`Upload failed.`, true);
      }
    });
  }

  /**
   * Closes a failed or rejected file.
   */
  public dismiss(item: UploadProgress): void {
    this.batchFailed.delete(item);
    this.uploadProgressSignal.update(list => list.filter(i => i !== item));
  }

  /**
   * The folder can't be saved to: not writable, or the user can't see its content
   * (a hidden or not existing folder answers DIRECTORY_NOT_FOUND, the two are not told apart).
   */
  private static isFolderError(err: ErrorDTO): boolean {
    return err?.code === ErrorCodes.PERMISSION_DENIED || err?.code === ErrorCodes.DIRECTORY_NOT_FOUND;
  }

  private static describeError(err: ErrorDTO): string {
    if (UploaderService.isFolderError(err)) {
      return $localize`Can't save to this folder`;
    }
    return err.message || $localize`Upload failed.`;
  }

  // Not sent at all. Like a failed file, it stays until it is closed.
  private rejectFile(file: File, error: string): void {
    const item: UploadProgress = {
      name: file.name,
      progress: 100,
      done: true,
      status: 'error',
      error,
      lastUpdate: Date.now()
    };
    this.uploadProgressSignal.update(list => [...list, item]);
  }

  // An error needs the user's attention, so it stays until it is closed
  private onUploadFailed(upload: QueuedUpload, error: string, retryable = false): void {
    const {progressItem} = upload;
    this.batchFailed.add(progressItem);
    progressItem.error = error;
    progressItem.done = true;
    progressItem.status = 'error';
    progressItem.lastUpdate = Date.now();
    progressItem.onRetry = retryable ? (): void => this.retry(upload) : undefined;
    this.notifyProgressChanged();
    this.onUploadFinished();
  }

  private retry(upload: QueuedUpload): void {
    const {progressItem} = upload;
    this.batchFailed.delete(progressItem);
    progressItem.progress = 0;
    progressItem.error = undefined;
    progressItem.done = false;
    progressItem.status = 'queued';
    progressItem.onRetry = undefined;
    progressItem.lastUpdate = Date.now();
    this.notifyProgressChanged();
    this.uploadQueue.push(upload);
    this.startSpeedTracking();
    this.processQueue();
  }

  private onUploadFinished(): void {
    this.activeUploads--;
    this.processQueue();
    if (this.activeUploads > 0 || this.uploadQueue.length > 0) {
      return;
    }
    this.MAX_CONCURRENT_UPLOADS = this.DEFAULT_MAX_CONCURRENT_UPLOADS; // Reset for next batch
    if (this.batchUploaded > 0) {
      this.contentLoaderService.reloadCurrentContent().catch(console.error);
    }
    if (this.batchFailed.size === 0) {
      this.notificationService.success($localize`Upload completed.`);
    } else if (this.batchUploaded > 0) {
      this.notificationService.warning($localize`Upload completed with errors`);
    } else {
      this.notificationService.error($localize`Upload failed.`);
    }
    this.batchUploaded = 0;
    this.batchFailed.clear();
  }

  private notifyProgressChanged(): void {
    this.uploadProgressSignal.update(list => [...list]);
  }

  private _cleanupProgress(items: UploadProgress[]): void {
    // Remove from list after some time
    items.forEach(item => {
      setTimeout(() => {
        if (item.status === 'error') {
          // an error stays until it is closed (or retried)
          return;
        }
        if (!item.done) {
          // If for some reason it's not done yet, retry later
          this._cleanupProgress([item]);
          return;
        }
        this.uploadProgressSignal.update(list => list.filter(i => i !== item));
      }, 5000);
    });
  }
}
