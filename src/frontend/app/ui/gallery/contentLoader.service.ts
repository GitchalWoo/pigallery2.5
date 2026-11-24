import {Injectable, type OnDestroy} from '@angular/core';
import {Router} from '@angular/router';
import {NetworkService} from '../../model/network/network.service';
import {ContentWrapperUtils, type ContentWrapperWithError, type PackedContentWrapperWithError} from '../../../../common/entities/ContentWrapper';
import {type SubDirectoryDTO,} from '../../../../common/entities/DirectoryDTO';
import {GalleryCacheService} from './cache.gallery.service';
import {BehaviorSubject, EMPTY, from, Observable, Subject, Subscription, timer} from 'rxjs';
import {Config} from '../../../../common/config/public/Config';
import {ShareService} from './share.service';
import {QueryParams} from '../../../../common/QueryParams';
import {ErrorCodes} from '../../../../common/entities/Error';
import {filter, map, startWith, switchMap} from 'rxjs/operators';
import {type MediaDTO} from '../../../../common/entities/MediaDTO';
import {type FileDTO} from '../../../../common/entities/FileDTO';
import {GalleryService} from './gallery.service';
import {type SearchQueryDTO} from '../../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../../common/SearchQueryUtils';

@Injectable()
export class ContentLoaderService implements OnDestroy {
  public content: BehaviorSubject<ContentWrapperWithError>;
  public originalContent: Observable<DirectoryContent>;
  private ongoingContentRequest: symbol = null;
  private fallbackNavigation: string | null = null;
  private lastContentRequest: { type: 'directory' | 'search', value: string } = null;
  private pollingTimerRestart = new Subject<void>();
  private pollingSub: Subscription;

  constructor(
    private networkService: NetworkService,
    private galleryCacheService: GalleryCacheService,
    private shareService: ShareService,
    private galleryService: GalleryService,
    private router: Router
  ) {
    this.content = new BehaviorSubject<ContentWrapperWithError>(
      {} as ContentWrapperWithError
    );
    this.originalContent = this.content.pipe(
      map((c) => (c?.directory ? c?.directory : c?.searchResult))
    );
    this.setupAutoUpdate();
  }

  ngOnDestroy(): void {
    this.unSubPolling();
  }

  setupAutoUpdate() {
    this.pollingSub = this.galleryService.autoPollIntervalS.pipe(
      switchMap(interval => {
        if (!interval) {
          return EMPTY; // stop polling
        }

        // Start polling or restart when pollingTimerRestart emits
        return this.pollingTimerRestart.pipe(
          startWith(void 0),
          switchMap(() =>
            timer(
              interval * 1000,
              interval * 1000
            ).pipe(
              filter(() => this.ongoingContentRequest === null),
              switchMap(_i => from(this.reloadCurrentContent()))
            )
          )
        );
      })
    ).subscribe({
      error: err => console.error(err)
    });
  }

  setContent(content: ContentWrapperWithError): void {
    const previous = this.content.value;
    if (previous?.error === content?.error &&
        JSON.stringify(previous?.directory?.availableParents) === JSON.stringify(content?.directory?.availableParents) &&
        ContentWrapperUtils.equals(previous, content)) {
      return;
    }
    this.content.next(content);
  }

  public async loadDirectory(directoryName: string, forceReload = false): Promise<void> {

    const generation = this.galleryCacheService.getMediaCacheGeneration();
    const request = Symbol();
    // load from cache
    const cachedCw = this.galleryCacheService.getDirectory(directoryName);

    this.setContent(ContentWrapperUtils.unpack(cachedCw));
    this.ongoingContentRequest = request;
    this.lastContentRequest = {type: 'directory', value: directoryName};

    // prepare server request
    const params: Record<string, unknown> = {};
    if (Config.Sharing.enabled === true) {
      if (this.shareService.isSharing()) {
        params[QueryParams.gallery.sharingKey_query] =
          this.shareService.getSharingKey();
      }
    }
    let cw :PackedContentWrapperWithError = null;

    try {
      if (
        !forceReload &&
        cachedCw?.directory &&
        cachedCw?.directory.lastModified &&
        cachedCw?.directory.lastScanned &&
        !cachedCw?.directory.isPartial
      ) {
        params[QueryParams.gallery.knownLastModified] =
          cachedCw?.directory.lastModified;
        params[QueryParams.gallery.knownLastScanned] =
          cachedCw?.directory.lastScanned;
      }

      cw = await this.networkService.getJson<PackedContentWrapperWithError>(
        '/gallery/content/' + encodeURIComponent(directoryName),
        params
      );
    } catch (e) {
      if (e?.code === ErrorCodes.DIRECTORY_NOT_FOUND) {
        if (this.ongoingContentRequest === request) {
          this.ongoingContentRequest = null;
          if (generation === this.galleryCacheService.getMediaCacheGeneration()) {
            await this.onDirectoryNotFound(directoryName);
          }
        }
        return;
      }
      console.error(e);
    }
    if (this.ongoingContentRequest !== request) {
      return;
    }
    this.ongoingContentRequest = null;
    this.pollingTimerRestart.next();
    if (generation !== this.galleryCacheService.getMediaCacheGeneration()) {
      return;
    }
    this.fallbackNavigation = null;

    if (!cw || cw.notModified === true) {
      return;
    }

    if (cw?.directory) {
      this.galleryCacheService.setDirectory(cw); // save it before adding references
    }
    this.setContent(ContentWrapperUtils.unpack(cw));

  }

  private async onDirectoryNotFound(directoryName: string): Promise<void> {
    const key = this.shareService.getSharingKey();
    const route = key
      ? this.shareService.getDefaultRoute(this.shareService.sharingSubject.value)
      : ['/gallery', ''];
    const normalize = SearchQueryUtils.normalizeDirectoryPath;
    const target = route && JSON.stringify([key, ...route]);
    if (target && target !== this.fallbackNavigation &&
        (route[0] !== '/gallery' || normalize(route[1]) !== normalize(directoryName))) {
      this.fallbackNavigation = target;
      const queryParams = key ? {[QueryParams.gallery.sharingKey_query]: key} : {};
      if (await this.router.navigate(route, {queryParams, replaceUrl: true})) {
        return;
      }
    }
    this.fallbackNavigation = null;
    this.lastContentRequest = null;
    this.setContent({directory: null, searchResult: null, error: $localize`Directory not found`});
  }

  public async search(query: SearchQueryDTO, forceReload = false): Promise<void> {
    this.fallbackNavigation = null;
    const queryStr = JSON.stringify(query);
    const generation = this.galleryCacheService.getMediaCacheGeneration();
    const request = Symbol();
    this.ongoingContentRequest = request;
    this.lastContentRequest = {type: 'search', value: queryStr};

    if (!forceReload) {
      this.setContent({} as PackedContentWrapperWithError); // don't empty the page when its just a reload
    }

    let cw = this.galleryCacheService.getSearch(query);
    if (forceReload || (!cw || cw.searchResult == null)) {
      try {
        const key = this.shareService.getSharingKey();
        const params = key ? {[QueryParams.gallery.sharingKey_query]: key} : undefined;
        cw = await this.networkService.getJson<PackedContentWrapperWithError>('/search/' + encodeURIComponent(queryStr), params);
        if (generation === this.galleryCacheService.getMediaCacheGeneration() && cw?.searchResult) {
          this.galleryCacheService.setSearch(cw);
        }
      } catch (e) {
        cw = cw || {
          directory: null,
          searchResult: null
        } as PackedContentWrapperWithError;
        if (e.code === ErrorCodes.LocationLookUp_ERROR) {
          cw.error = $localize`Cannot find location` + ': ' + e.message;
        } else {
          cw.error = $localize`Unknown server error` + ': ' + e.message;
        }
      }
    }

    if (this.ongoingContentRequest !== request) {
      return;
    }
    this.ongoingContentRequest = null;
    this.pollingTimerRestart.next();
    if (generation !== this.galleryCacheService.getMediaCacheGeneration()) {
      return;
    }

    this.setContent(ContentWrapperUtils.unpack(cw));
  }

  isSearchResult(): boolean {
    return !!this.content.value.searchResult;
  }

  public async reloadCurrentContent(): Promise<void> {
    if (!this.lastContentRequest) {
      return;
    }

    if (this.lastContentRequest.type === 'directory') {
      await this.loadDirectory(this.lastContentRequest.value, true);
    } else if (this.lastContentRequest.type === 'search') {
      await this.search(JSON.parse(this.lastContentRequest.value), true);
    }
  }

  private unSubPolling() {

    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = null;
    }
  }
}


export interface DirectoryContent {
  directories: SubDirectoryDTO[];
  media: MediaDTO[];
  metaFile: FileDTO[];
}
