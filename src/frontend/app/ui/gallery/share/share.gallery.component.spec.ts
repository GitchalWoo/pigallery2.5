import {BehaviorSubject} from 'rxjs';
import {SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../../common/entities/SearchQueryDTO';
import {GalleryShareComponent} from './share.gallery.component';

describe('GalleryShareComponent folder sharing', () => {
  const setup = () => {
    const exact = {type: SearchQueryTypes.directory, value: 'family', matchType: TextSearchQueryMatchTypes.exact_match};
    const recursive = {...exact, value: 'family/*', matchType: TextSearchQueryMatchTypes.globMatch};
    const share = {id: 1, sharingKey: 'exact', directoryQuery: exact};
    const content = new BehaviorSubject({
      directory: {path: '', name: 'family', cache: {mediaCount: 2, recursiveMediaCount: 6}}
    });
    const service = {
      getSharingListForQuery: vi.fn().mockResolvedValue([share]),
      getUrl: vi.fn().mockReturnValue('https://example.test/share/exact'),
      createSharingByDirectory: vi.fn().mockResolvedValue(share),
      updateSharingByDirectory: vi.fn().mockResolvedValue({...share, directoryQuery: recursive}),
      createSharingByQuery: vi.fn().mockResolvedValue(share),
    };
    const clipboard = {copy: vi.fn().mockResolvedValue(true), isSupported: true};
    const notification = {success: vi.fn()};
    const component = new GalleryShareComponent(
      service as any, {content} as any, notification as any, null, null, clipboard as any
    );
    component.ngOnInit();
    return {component, service, clipboard, notification, exact, recursive, content};
  };

  it('creates exact folder shares by default, lists both variants, and updates the scope', async () => {
    const {component, service, exact, recursive} = setup();
    expect(component.sharedMediaCount).toBe(2);
    await component.get();
    expect(service.createSharingByDirectory).toHaveBeenCalledWith(exact, null, expect.any(Number), 'family', false);
    expect(service.getSharingListForQuery.mock.calls.slice(0, 2)).toEqual([[exact], [recursive]]);
    expect(component.activeShares).toHaveLength(1);

    component.input.recursive = true;
    component.input.preventDownload = true;
    expect(component.sharedMediaCount).toBe(6);
    await component.update();
    expect(service.updateSharingByDirectory).toHaveBeenCalledWith(1, recursive, null, expect.any(Number), 'family', true);
    expect(component.isRecursive(component.sharing)).toBe(true);
    component.ngOnDestroy();
  });

  it('shares the gallery root and copies the supplied link', async () => {
    const {component, service, clipboard, notification, content} = setup();
    content.next({directory: {path: '/', name: '.', cache: {mediaCount: 2, recursiveMediaCount: 6}}});
    await component.get();
    expect(service.createSharingByDirectory).toHaveBeenCalledWith(
      expect.objectContaining({value: '/', matchType: TextSearchQueryMatchTypes.exact_match}), null, expect.any(Number), '/', false);
    await component.copy('https://example.test/share/other');
    expect(clipboard.copy).toHaveBeenCalledWith('https://example.test/share/other');
    expect(notification.success).toHaveBeenCalledOnce();
    component.ngOnDestroy();
  });

  it('keeps search-result shares scoped to their search', async () => {
    const {component, service, content} = setup();
    const searchQuery = {type: SearchQueryTypes.any_text, value: 'picnic'};
    content.next({searchResult: {searchQuery}} as any);
    component.input.preventDownload = true;
    await component.get();
    expect(service.createSharingByQuery).toHaveBeenCalledWith(searchQuery, null, expect.any(Number), undefined, undefined, true);
    expect(service.createSharingByDirectory).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it.each(['family*', 'family?'])('keeps sharing exact when the path contains a glob character (%s)', async name => {
    const {component, service, content} = setup();
    content.next({directory: {path: 'family', name, cache: {mediaCount: 2, recursiveMediaCount: 6}}});
    component.input.recursive = true;
    expect(component.canShareSubfolders).toBe(false);
    expect(component.sharedMediaCount).toBe(2);
    await component.get();
    expect(service.createSharingByDirectory).toHaveBeenCalledWith({
      type: SearchQueryTypes.directory, value: 'family/' + name, matchType: TextSearchQueryMatchTypes.exact_match
    }, null, expect.any(Number), 'family/' + name, false);
    component.ngOnDestroy();
  });
});
