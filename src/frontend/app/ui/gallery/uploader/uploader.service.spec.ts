import {BehaviorSubject, Subject} from 'rxjs';
import {HttpEventType} from '@angular/common/http';
import {UploaderService, UploadProgress} from './uploader.service';
import {Config} from '../../../../../common/config/public/Config';
import {UserRoles} from '../../../../../common/entities/UserDTO';
import {ErrorCodes} from '../../../../../common/entities/Error';
import type {NetworkService} from '../../../model/network/network.service';
import type {NotificationService} from '../../../model/notification.service';
import type {AuthenticationService} from '../../../model/network/authentication.service';
import type {ContentLoaderService} from '../contentLoader.service';

class MockNetworkService {
  requests: { url: string, data: FormData, subject: Subject<unknown> }[] = [];
  postFormData = vi.fn((url: string, data: FormData) => {
    const subject = new Subject<unknown>();
    this.requests.push({url, data, subject});
    return subject.asObservable();
  });
}

describe('UploaderService', () => {
  let service: UploaderService;
  let network: MockNetworkService;
  let notification: { success: ReturnType<typeof vi.fn>, warning: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn> };
  let contentLoader: {
    content: BehaviorSubject<unknown>, isCurrentAccountContent: boolean, reloadCurrentContent: ReturnType<typeof vi.fn>
  };
  const uploadConfig = {...Config.Upload};

  const file = (name: string, content = 'image'): File => new File([content], name);
  const item = (name: string): UploadProgress => service.uploadProgress.find((i) => i.name === name);
  const sentNames = (): string[] => network.requests.map((r) => (r.data.get('files') as File).name);
  const respond = (index: number, body: unknown): void => {
    network.requests[index].subject.next({type: HttpEventType.Response, body});
    network.requests[index].subject.complete();
  };
  const succeed = (index: number): void => respond(index, {error: null, result: []});

  beforeEach(() => {
    vi.useFakeTimers();
    Config.Upload.enabled = true;
    Config.Upload.minimumRole = UserRoles.User;
    Config.Upload.enforcedDirectoryConfig = false;
    network = new MockNetworkService();
    notification = {success: vi.fn(), warning: vi.fn(), error: vi.fn()};
    contentLoader = {
      content: new BehaviorSubject<unknown>({directory: {path: '/', name: 'album', metaFile: [], contentAvailable: true}}),
      isCurrentAccountContent: true,
      reloadCurrentContent: vi.fn().mockResolvedValue(undefined)
    };
    const auth = {
      isAuthenticated: (): boolean => true,
      user: new BehaviorSubject({role: UserRoles.Admin})
    };
    service = new UploaderService(network as unknown as NetworkService,
      notification as unknown as NotificationService,
      auth as unknown as AuthenticationService,
      contentLoader as unknown as ContentLoaderService);
  });

  afterEach(() => {
    Object.assign(Config.Upload, uploadConfig);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('offers uploads only once the server confirms content access to the whole folder', () => {
    expect(service.canUpload()).toBe(true);
    contentLoader.isCurrentAccountContent = false;
    expect(service.canUpload()).toBe(false);
    contentLoader.isCurrentAccountContent = true;
    for (const directory of [{}, {contentAvailable: false}, {contentAvailable: true, isPartial: true}]) {
      contentLoader.content.next({directory});
      expect(service.canUpload()).toBe(false);
    }
  });

  it('still requires a recognized upload marker when directory configuration is enforced', () => {
    Config.Upload.enforcedDirectoryConfig = true;
    expect(service.canUpload()).toBe(false);
    contentLoader.content.next({directory: {contentAvailable: true, metaFile: [{name: '.uploader.pg2conf'}]}});
    expect(service.canUpload()).toBe(true);
  });
  it('should name the unsupported file and not send it', async () => {
    await service.uploadFiles([file('beach.jpg'), file('notes.txt')]);
    expect(sentNames()).toEqual(['beach.jpg']);
    expect(item('notes.txt')).toEqual(expect.objectContaining({status: 'error', error: 'Unsupported file format'}));
    expect(notification.warning).not.toHaveBeenCalled();
  });

  it('should reject blocked extensions by default', async () => {
    await service.uploadFiles([file('logo.svg'), file('.uploader.pg2conf')]);
    expect(network.requests.length).toBe(0);
    expect(item('logo.svg').status).toBe('error');
    expect(item('.uploader.pg2conf').status).toBe('error');
  });

  it('should reject a file above the size limit without sending it', async () => {
    Config.Upload.maxFileSizeMB = 1;
    await service.uploadFiles([new File([new Uint8Array(1024 * 1024 + 1)], 'big.jpg'), file('beach.jpg')]);
    expect(item('big.jpg')).toEqual(expect.objectContaining({status: 'error', error: expect.stringContaining('1 MB')}));
    expect(sentNames()).toEqual(['beach.jpg']); // only beach.jpg is sent
  });

  it('should say "Can\'t save to this folder" when the server refuses the folder', async () => {
    await service.uploadFiles([file('beach.jpg')]);
    // the error interceptor passes on the ErrorDTO of the response
    network.requests[0].subject.error({code: ErrorCodes.PERMISSION_DENIED, message: 'Upload is not enabled in this directory'});
    expect(item('beach.jpg')).toEqual(expect.objectContaining({status: 'error', error: 'Can\'t save to this folder'}));
    expect(item('beach.jpg').onRetry).toBeUndefined(); // it would fail the same way
    expect(notification.error).toHaveBeenCalledWith('Upload failed.');
  });

  it('should say "Can\'t save to this folder" when the user can\'t see the folder', async () => {
    await service.uploadFiles([file('beach.jpg')]);
    // a hidden folder (or one that the user can only navigate) answers 404 like a not existing one
    network.requests[0].subject.error({code: ErrorCodes.DIRECTORY_NOT_FOUND, message: 'Directory not found'});
    expect(item('beach.jpg')).toEqual(expect.objectContaining({status: 'error', error: 'Can\'t save to this folder'}));
    expect(item('beach.jpg').onRetry).toBeUndefined(); // it would fail the same way
    expect(notification.error).toHaveBeenCalledWith('Upload failed.');
  });

  it('should show an error of the whole request in the response body as a failure, not a success', async () => {
    await service.uploadFiles([file('beach.jpg')]);
    respond(0, {error: {code: ErrorCodes.UPLOAD_ERROR, message: 'Directory not found'}, result: null});
    expect(item('beach.jpg')).toEqual(expect.objectContaining({status: 'error', error: 'Directory not found'}));
    expect(item('beach.jpg').onRetry).toBeUndefined();
    expect(notification.success).not.toHaveBeenCalled();
    expect(notification.error).toHaveBeenCalledWith('Upload failed.');
    expect(contentLoader.reloadCurrentContent).not.toHaveBeenCalled();
  });

  it('should offer a retry for a file whose connection dropped', async () => {
    await service.uploadFiles([file('beach.jpg')]);
    network.requests[0].subject.error('Unknown Error');
    expect(item('beach.jpg').error).toBe('Unknown Error');
    expect(item('beach.jpg').onRetry).toBeDefined();
    expect(notification.error).toHaveBeenCalledTimes(1);

    item('beach.jpg').onRetry();
    expect(network.requests.length).toBe(2);
    expect(item('beach.jpg')).toEqual(expect.objectContaining({status: 'uploading', error: undefined, onRetry: undefined}));

    succeed(1);
    expect(item('beach.jpg').status).toBe('done');
    // the retried file does not count as failed anymore
    expect(notification.success).toHaveBeenCalledWith('Upload completed.');
    expect(contentLoader.reloadCurrentContent).toHaveBeenCalled();
  });

  it('should keep a failed file until it is closed and remove a finished one', async () => {
    await service.uploadFiles([file('beach.jpg'), file('lake.jpg')]);
    succeed(0);
    respond(1, {error: null, result: [{filename: 'lake.jpg', error: 'File already exists: lake.jpg'}]});
    expect(notification.warning).toHaveBeenCalledWith('Upload completed with errors');

    await vi.advanceTimersByTimeAsync(6000);
    expect(item('beach.jpg')).toBeUndefined();
    expect(item('lake.jpg')).toEqual(expect.objectContaining({status: 'error', error: 'File already exists: lake.jpg'}));
    expect(item('lake.jpg').onRetry).toBeUndefined();

    service.dismiss(item('lake.jpg'));
    expect(service.uploadProgress).toEqual([]);
  });
});
