import {BehaviorSubject} from 'rxjs';
import {ErrorCodes} from '../../../../common/entities/Error';
import {ContentLoaderService} from './contentLoader.service';

describe('ContentLoaderService directory fallback', () => {
  const setup = (shareKey: string | null = null) => {
    const getJson = vi.fn().mockRejectedValue({code: ErrorCodes.DIRECTORY_NOT_FOUND});
    const navigate = vi.fn().mockResolvedValue(true);
    const cache = {
      getMediaCacheGeneration: vi.fn().mockReturnValue(0), getDirectory: () => ({}), setDirectory: vi.fn()
    };
    const service = new ContentLoaderService(
      {getJson} as any, cache as any,
      {getSharingKey: () => shareKey, isSharing: () => !!shareKey,
        sharingSubject: new BehaviorSubject(null), getDefaultRoute: () => ['/gallery', 'shared']} as any,
      {autoPollIntervalS: new BehaviorSubject(0)} as any, {navigate} as any
    );
    return {service, getJson, navigate, cache};
  };

  it('goes to the root after a 404 and stops if the root also fails', async () => {
    const {service, navigate} = setup();
    await service.loadDirectory('missing');
    expect(navigate).toHaveBeenCalledWith(['/gallery', ''], {queryParams: {}, replaceUrl: true});
    await service.loadDirectory('/./');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(service.content.value.error).toBe('Directory not found');
    service.ngOnDestroy();
  });

  it('keeps the sharing key when returning to the share default', async () => {
    const {service, navigate} = setup('the-key');
    await service.loadDirectory('restricted');
    expect(navigate).toHaveBeenCalledWith(['/gallery', 'shared'], {queryParams: {sk: 'the-key'}, replaceUrl: true});
    service.ngOnDestroy();
  });

  it('discards a previous account response, including its fallback navigation', async () => {
    const {service, navigate, cache} = setup();
    const pending = service.loadDirectory('missing');
    cache.getMediaCacheGeneration.mockReturnValue(1);
    await pending;
    expect(navigate).not.toHaveBeenCalled();
    expect(service.content.value.error).toBeUndefined();
    service.ngOnDestroy();
  });
});
