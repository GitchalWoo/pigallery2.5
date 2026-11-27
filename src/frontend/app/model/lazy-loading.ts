import {type Event, NavigationError, type Router} from '@angular/router';
import {type Subscription} from 'rxjs';
import {Config} from '../../../common/config/public/Config';

export const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  // Chrome / Firefox / Safari wording of a failed dynamic import
  return /dynamically imported module|module script failed|error loading dynamically imported module/i.test(message);
};

const LAST_RELOAD_KEY = 'pigallery2-chunk-reload';

// a separate object, so the tests can replace it
export const PageLoader = {
  assign: (url: string): void => location.assign(url),
};

/**
 * After an upgrade, a tab that is still open references lazy files that no longer exist on the server.
 * Reloading the page loads the new index.html and the new files.
 */
export const reloadAfterUpgrade = (url: string): void => {
  // reload only once in a while, in case the files are really missing from the server
  try {
    const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || 0);
    if (Date.now() - last < 10000) {
      return;
    }
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // no sessionStorage (e.g. privacy settings): reload anyway
  }
  PageLoader.assign(url);
};

/**
 * Lazy routes: a failed load ends the navigation with an error.
 */
export const reloadOnChunkLoadError = (event: NavigationError): void => {
  if (!isChunkLoadError(event.error)) {
    return;
  }
  reloadAfterUpgrade(Config.Server.getAppUrl(event.url));
};

export const reloadOnStaleChunks = (router: Router): Subscription =>
  router.events.subscribe((event: Event) => {
    if (event instanceof NavigationError) {
      reloadOnChunkLoadError(event);
    }
  });
