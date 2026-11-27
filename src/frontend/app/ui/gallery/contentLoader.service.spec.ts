import {BehaviorSubject} from 'rxjs';
import {ErrorCodes} from '../../../../common/entities/Error';
import {ContentLoaderService} from './contentLoader.service';
import {SearchQueryTypes} from '../../../../common/entities/SearchQueryDTO';
import {NotificationService} from '../../model/notification.service';
import {ContentWrapperUtils, type PackedContentWrapper} from '../../../../common/entities/ContentWrapper';
import {type PhotoDTO} from '../../../../common/entities/PhotoDTO';
import {QueryParams} from '../../../../common/QueryParams';

describe('ContentLoaderService', () => {
  const wrapper: PackedContentWrapper = {
    directory: {
      id: 1, name: 'photos', path: '', lastModified: 1, lastScanned: 2, parent: null,
      cache: {mediaCount: 0}, media: [], directories: [], metaFile: [],
    },
    searchResult: null,
    map: {faces: [], keywords: [], lens: [], camera: [], directories: []},
  };
  const deferred = () => {
    let resolve: (value: unknown) => void;
    let reject: (reason: unknown) => void;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return {promise, resolve, reject};
  };

  const setup = (shareKey: string | null = null, sharing: unknown = null) => {
    const getJson = vi.fn().mockRejectedValue({code: ErrorCodes.DIRECTORY_NOT_FOUND});
    const navigate = vi.fn().mockResolvedValue(true);
    const cache = {
      getMediaCacheGeneration: vi.fn().mockReturnValue(0), getDirectory: vi.fn().mockReturnValue({}),
      setDirectory: vi.fn(), getSearch: vi.fn(), setSearch: vi.fn(),
    };
    const warning = vi.fn();
    const service = new ContentLoaderService(
      {getJson} as any, cache as any,
      {getSharingKey: () => shareKey, isSharing: () => !!shareKey,
        sharingSubject: new BehaviorSubject(sharing), getCurrentSharing: () => Promise.resolve(sharing),
        getDefaultRoute: (s: {directory?: string} | null) => s ? ['/gallery', s.directory ?? 'shared'] : null} as any,
      {autoPollIntervalS: new BehaviorSubject(0)} as any, {navigate} as any,
      {warning} as unknown as NotificationService
    );
    return {service, getJson, navigate, cache, warning};
  };

  it('goes to the root after a 404 and stops if the root also fails', async () => {
    const {service, navigate, warning} = setup();
    await service.loadDirectory('missing');
    expect(navigate).toHaveBeenCalledWith(['/gallery', ''], {queryParams: {}, replaceUrl: true});
    await service.loadDirectory('/./');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledExactlyOnceWith('Folder not found.');
    expect(service.content.value.error).toBe('Directory not found');
    expect(service.canRetry).toBe(false);
    service.ngOnDestroy();
  });

  it('keeps the sharing key when returning to the share default', async () => {
    const {service, navigate} = setup('the-key', {sharingKey: 'the-key'});
    await service.loadDirectory('restricted');
    expect(navigate).toHaveBeenCalledWith(['/gallery', 'shared'], {queryParams: {sk: 'the-key'}, replaceUrl: true});
    service.ngOnDestroy();
  });

  it('waits for the sharing if the 404 of the folder arrives first (upstream 5c09394f)', async () => {
    const sharing = deferred();
    const {service, navigate} = setup('the-key');
    (service as unknown as {shareService: {getCurrentSharing: () => Promise<unknown>}})
      .shareService.getCurrentSharing = () => sharing.promise;
    const loading = service.loadDirectory('timestamps');
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();

    sharing.resolve({sharingKey: 'the-key', directory: 'Balaton nyár'});
    await loading;

    expect(navigate).toHaveBeenCalledWith(['/gallery', 'Balaton nyár'], {queryParams: {sk: 'the-key'}, replaceUrl: true});
    expect(service.content.value.error).toBeUndefined();
    service.ngOnDestroy();
  });

  it('discards a previous account response, including its fallback navigation', async () => {
    const {service, navigate, cache, warning} = setup();
    const pending = service.loadDirectory('missing');
    cache.getMediaCacheGeneration.mockReturnValue(1);
    await pending;
    expect(navigate).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    expect(service.content.value.error).toBeUndefined();
    service.ngOnDestroy();
  });

  it('lets the user retry an initial folder error', async () => {
    const {service, getJson, cache} = setup();
    cache.getDirectory.mockReturnValueOnce({directory: {...wrapper.directory, isPartial: true}});
    getJson.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(wrapper);
    await service.loadDirectory('photos');
    expect(service.content.value.error).toBe('Could not load this folder.');
    expect(service.canRetry).toBe(true);
    await service.reloadCurrentContent();
    expect(service.content.value.directory?.name).toBe('photos');
    expect(service.canRetry).toBe(false);
    service.ngOnDestroy();
  });

  it('keeps a displayed folder on a transient refresh failure even with the cache off', async () => {
    const {service, getJson} = setup();
    getJson.mockResolvedValueOnce(wrapper).mockRejectedValueOnce(new Error('connection lost'));
    await service.loadDirectory('photos');
    const shown = service.content.value;
    await service.reloadCurrentContent();
    expect(service.content.value).toBe(shown);
    service.ngOnDestroy();
  });

  it.each(['directory', 'search'] as const)('publishes a removed keyword on a %s refresh', async kind => {
    const {service, getJson} = setup();
    const query = {type: SearchQueryTypes.any_text};
    const response = (keywords?: string[]): PackedContentWrapper => {
      const directory = {...wrapper.directory, cache: {mediaCount: 1}};
      const media: PhotoDTO = {
        id: 7, name: 'one.jpg', directory,
        metadata: {size: {width: 10, height: 10}, fileSize: 7, creationDate: 1, ...(keywords && {keywords})},
      };
      return ContentWrapperUtils.pack(kind === 'directory'
        ? {directory: {...directory, media: [media]}, searchResult: null}
        : {directory: null, searchResult: {searchQuery: query, resultOverflow: false, media: [media], directories: [], metaFile: []}});
    };
    const currentPhoto = (): PhotoDTO => {
      const content = service.content.value;
      return (content.directory ?? content.searchResult).media[0] as PhotoDTO;
    };
    getJson.mockResolvedValueOnce(response(['favorite'])).mockResolvedValueOnce(response());
    if (kind === 'directory') {
      await service.loadDirectory('photos');
    } else {
      await service.search(query);
    }
    expect(currentPhoto().metadata.keywords).toEqual(['favorite']);
    await service.reloadCurrentContent();
    expect(currentPhoto().metadata.keywords).toBeUndefined();
    service.ngOnDestroy();
  });

  it('drops the displayed folder when a refresh fails after an account change', async () => {
    const {service, getJson, cache} = setup();
    getJson.mockResolvedValueOnce(wrapper).mockRejectedValueOnce(new Error('connection lost'));
    await service.loadDirectory('photos');
    expect(service.isCurrentAccountContent).toBe(true);
    cache.getMediaCacheGeneration.mockReturnValue(1);
    expect(service.isCurrentAccountContent).toBe(false);
    await service.reloadCurrentContent();
    expect(service.content.value.directory).toBeNull();
    expect(service.content.value.error).toBe('Could not load this folder.');
    service.ngOnDestroy();
  });

  it('requests full directory data when a cached listing lacks the content-access flag', async () => {
    const {service, getJson, cache} = setup();
    cache.getDirectory.mockReturnValue(wrapper);
    getJson.mockResolvedValue({...wrapper, directory: {...wrapper.directory, contentAvailable: true}});
    await service.loadDirectory('photos');
    expect(getJson).toHaveBeenLastCalledWith('/gallery/content/photos', {});
    expect(service.content.value.directory?.contentAvailable).toBe(true);

    cache.getDirectory.mockReturnValue({...wrapper, directory: {...wrapper.directory, contentAvailable: false}});
    getJson.mockResolvedValue({notModified: true});
    await service.loadDirectory('photos');
    expect(getJson).toHaveBeenLastCalledWith('/gallery/content/photos', {
      [QueryParams.gallery.knownLastModified]: wrapper.directory.lastModified,
      [QueryParams.gallery.knownLastScanned]: wrapper.directory.lastScanned,
    });
    expect(service.content.value.directory?.contentAvailable).toBe(false);
    service.ngOnDestroy();
  });

  it('lets a newer request win even when the same folder was requested twice', async () => {
    const {service, getJson, warning} = setup();
    const first = deferred();
    getJson.mockReturnValueOnce(first.promise).mockResolvedValueOnce(wrapper);
    const old = service.loadDirectory('photos');
    await service.loadDirectory('photos');
    first.reject({code: ErrorCodes.DIRECTORY_NOT_FOUND});
    await old;
    expect(service.content.value.directory?.name).toBe('photos');
    expect(warning).not.toHaveBeenCalled();
    service.ngOnDestroy();
  });

  it('retries a failed search, then keeps the displayed result on transient refresh failure', async () => {
    const {service, getJson} = setup();
    const query = {type: SearchQueryTypes.any_text};
    getJson.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({searchResult: {searchQuery: query, media: [], directories: []}})
      .mockRejectedValueOnce(new Error('offline'));
    await service.search(query);
    expect(service.content.value.error).toBe('Could not load search results.');
    expect(service.canRetry).toBe(true);
    await service.reloadCurrentContent();
    const shown = service.content.value;
    expect(shown.searchResult?.searchQuery).toEqual(query);
    await service.reloadCurrentContent();
    expect(service.content.value).toBe(shown);
    service.ngOnDestroy();
  });

  it('does not retry a broken search link or let the superseded search replace it', async () => {
    const {service, getJson, cache} = setup();
    const first = deferred();
    getJson.mockReturnValueOnce(first.promise);
    const pending = service.search({type: SearchQueryTypes.any_text});
    service.showBrokenSearchLink();
    first.resolve({searchResult: {media: [], directories: []}});
    await pending;
    await service.reloadCurrentContent();
    expect(service.content.value.error).toBe('This search link is broken.');
    expect(service.canRetry).toBe(false);
    expect(getJson).toHaveBeenCalledOnce();
    expect(cache.setSearch).not.toHaveBeenCalled();
    service.ngOnDestroy();
  });
});
