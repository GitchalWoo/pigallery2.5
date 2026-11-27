import {NavigationError, NavigationStart, type Router} from '@angular/router';
import {Subject} from 'rxjs';
import {type Event} from '@angular/router';
import {isChunkLoadError, PageLoader, reloadAfterUpgrade, reloadOnChunkLoadError, reloadOnStaleChunks} from './lazy-loading';
import {Config} from '../../../common/config/public/Config';

describe('reload after an upgrade', () => {
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.removeItem('pigallery2-chunk-reload');
    assign = vi.spyOn(PageLoader, 'assign').mockImplementation(() => undefined);
  });

  afterEach(() => {
    sessionStorage.removeItem('pigallery2-chunk-reload');
    assign.mockRestore();
  });

  it('recognizes the failed dynamic imports of the browsers', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/chunk-A.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot match any routes'))).toBe(false);
  });

  it('reloads a lazy page that failed to load', () => {
    reloadOnChunkLoadError(new NavigationError(1, '/albums', new TypeError('Failed to fetch dynamically imported module: x')));
    expect(assign).toHaveBeenCalledExactlyOnceWith(Config.Server.getAppUrl('/albums'));
  });

  it('does not reload for other navigation errors', () => {
    reloadOnChunkLoadError(new NavigationError(1, '/albums', new Error('Cannot match any routes')));
    expect(assign).not.toHaveBeenCalled();
  });

  it('reloads only once in a while, so missing files can not cause a reload loop', () => {
    reloadAfterUpgrade('/a');
    reloadAfterUpgrade('/b');
    expect(assign).toHaveBeenCalledExactlyOnceWith('/a');
  });

  it('listens to the navigation errors of the router', () => {
    const events = new Subject<Event>();
    const subscription = reloadOnStaleChunks({events} as unknown as Router);
    events.next(new NavigationStart(1, '/faces'));
    events.next(new NavigationError(1, '/faces', new TypeError('Failed to fetch dynamically imported module: y')));
    expect(assign).toHaveBeenCalledExactlyOnceWith(Config.Server.getAppUrl('/faces'));
    subscription.unsubscribe();
  });
});
