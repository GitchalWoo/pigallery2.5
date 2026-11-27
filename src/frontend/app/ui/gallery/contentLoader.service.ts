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
import {NotificationService} from '../../model/notification.service';

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
    private router: Router,
    private notificationService: NotificationService
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
    const cachedCw = this.galleryCacheService.getDirectory(directoryName);
    const alreadyShown = this.content.value;
    const shown = forceReload && this.lastContentRequest?.type === 'directory' &&
      this.lastContentRequest.value === directoryName && alreadyShown?.directory && !alreadyShown.error
      ? alreadyShown : ContentWrapperUtils.unpack(cachedCw);
    this.ongoingContentRequest = request;
    this.lastContentRequest = {type: 'directory', value: directoryName};
    this.setContent(shown);

    // prepare server request
    const params: Record<string, unknown> = {};
    if (Config.Sharing.enabled === true) {
      if (this.shareService.isSharing()) {
        params[QueryParams.gallery.sharingKey_query] =
          this.shareService.getSharingKey();
      }
    }
    let cw: PackedContentWrapperWithError;

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
      if (!this.finishRequest(request, generation)) {
        return;
      }
      if (e?.code === ErrorCodes.DIRECTORY_NOT_FOUND) {
        await this.onDirectoryNotFound(directoryName, generation);
      } else if (!shown?.directory || shown.directory.isPartial) {
        this.setError($localize`Could not load this folder.`);
      }
      return;
    }
    if (!this.finishRequest(request, generation)) {
      return;
    }
    this.fallbackNavigation = null;

    if (cw?.notModified) {
      return;
    }

    if (cw?.directory) {
      this.galleryCacheService.setDirectory(cw); // save it before adding references
      this.setContent(ContentWrapperUtils.unpack(cw));
    } else if (!shown?.directory || shown.directory.isPartial) {
      this.setError($localize`Could not load this folder.`);
    }
  }

  private finishRequest(request: symbol, generation: number): boolean {
    if (this.ongoingContentRequest !== request) {
      return false;
    }
    this.ongoingContentRequest = null;
    this.pollingTimerRestart.next();
    return generation === this.galleryCacheService.getMediaCacheGeneration();
  }

  private async onDirectoryNotFound(directoryName: string, generation: number): Promise<void> {
    const failedRequest = this.lastContentRequest;
    const key = this.shareService.getSharingKey();
    const route = key
      ? this.shareService.getDefaultRoute(this.shareService.sharingSubject.value)
      : ['/gallery', ''];
    const normalize = SearchQueryUtils.normalizeDirectoryPath;
    const target = route && JSON.stringify([key, ...route]);
    if (target && target !== this.fallbackNavigation &&
        (route[0] !== '/gallery' || normalize(route[1]) !== normalize(directoryName))) {
      this.fallbackNavigation = target;
      this.setContent(ContentWrapperUtils.build());
      const queryParams = key ? {[QueryParams.gallery.sharingKey_query]: key} : {};
      this.notificationService.warning($localize`Folder not found.`);
      if (await this.router.navigate(route, {queryParams, replaceUrl: true})) {
        return;
      }
      if (this.lastContentRequest !== failedRequest || generation !== this.galleryCacheService.getMediaCacheGeneration()) {
        return;
      }
    }
    this.fallbackNavigation = null;
    this.lastContentRequest = null;
    this.setError($localize`Directory not found`);
  }

  public async search(query: SearchQueryDTO, forceReload = false): Promise<void> {
    this.fallbackNavigation = null;
    const queryStr = JSON.stringify(query);
    const generation = this.galleryCacheService.getMediaCacheGeneration();
    const request = Symbol();
    const shown = forceReload && this.lastContentRequest?.type === 'search' &&
      this.lastContentRequest.value === queryStr && this.content.value?.searchResult && !this.content.value.error;
    this.ongoingContentRequest = request;
    this.lastContentRequest = {type: 'search', value: queryStr};

    if (!shown) {
      this.setContent(ContentWrapperUtils.build(null, null));
    }

    let cw = this.galleryCacheService.getSearch(query);
    const fetch = forceReload || !cw?.searchResult;
    if (fetch) {
      try {
        const key = this.shareService.getSharingKey();
        const params = key ? {[QueryParams.gallery.sharingKey_query]: key} : undefined;
        cw = await this.networkService.getJson<PackedContentWrapperWithError>('/search/' + encodeURIComponent(queryStr), params);
      } catch (e) {
        if (this.finishRequest(request, generation) && !shown) {
          this.setError(e?.code === ErrorCodes.LocationLookUp_ERROR
            ? $localize`Cannot find location` + ': ' + e.message
            : $localize`Could not load search results.`);
        }
        return;
      }
    }

    if (!this.finishRequest(request, generation)) {
      return;
    }
    if (cw?.searchResult) {
      if (fetch) {
        this.galleryCacheService.setSearch(cw);
      }
      this.setContent(ContentWrapperUtils.unpack(cw));
    } else if (!shown) {
      this.setError($localize`Could not load search results.`);
    }
  }

  public showBrokenSearchLink(): void {
    this.ongoingContentRequest = null;
    this.lastContentRequest = null;
    this.fallbackNavigation = null;
    this.setError($localize`This search link is broken.`);
  }

  public get canRetry(): boolean {
    return !!this.content.value?.error && this.lastContentRequest !== null;
  }

  private setError(error: string): void {
    this.setContent({directory: null, searchResult: null, error});
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
