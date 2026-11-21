import {Injectable, computed, inject} from '@angular/core';
import {Location} from '@angular/common';
import {ShareService} from '../ui/gallery/share.service';
import {type MediaDTO} from '../../../common/entities/MediaDTO';
import {QueryParams} from '../../../common/QueryParams';
import {Utils} from '../../../common/Utils';
import {Config} from '../../../common/config/public/Config';
import {type ParentDirectoryDTO, type SubDirectoryDTO,} from '../../../common/entities/DirectoryDTO';
import {ContentLoaderService} from '../ui/gallery/contentLoader.service';

export interface LightboxHistoryState {
  lightboxClosesWithBack?: boolean;
  lightboxRevealsInGrid?: boolean;
}

@Injectable()
export class QueryService {
  private location = inject(Location);

  constructor(
    private shareService: ShareService,
    private galleryService: ContentLoaderService
  ) {
  }

  public readonly params = computed((): Record<string, string> => this.getParams());

  getLightboxLink(media: MediaDTO, revealInGrid = true): { queryParams: Record<string, string>; state: LightboxHistoryState } {
    return {queryParams: this.getParams({media}), state: {lightboxClosesWithBack: true, lightboxRevealsInGrid: revealInGrid}};
  }

  lightboxClosesWithBack(): boolean {
    return !!(this.location.getState() as LightboxHistoryState | null)?.lightboxClosesWithBack;
  }

  lightboxRevealsInGrid(): boolean {
    return (this.location.getState() as LightboxHistoryState | null)?.lightboxRevealsInGrid !== false;
  }

  keepLightboxState(): LightboxHistoryState {
    return {lightboxClosesWithBack: this.lightboxClosesWithBack(), lightboxRevealsInGrid: this.lightboxRevealsInGrid()};
  }

  getMediaStringId(media: MediaDTO): string {
    if (this.galleryService.isSearchResult()) {
      return Utils.concatUrls(
        media.directory.path,
        media.directory.name,
        media.name
      );
    } else {
      return media.name;
    }
  }

  getParams(lightbox?: { media?: MediaDTO,map?:boolean}): { [key: string]: string } {
    const query: { [key: string]: string } = {};
    if (lightbox?.media) {
      query[QueryParams.gallery.photo] = this.getMediaStringId(lightbox?.media);
    }
    if (lightbox?.map && !lightbox?.media) {
      query[QueryParams.gallery.map.show] = 'true';
    }
    if (Config.Sharing.enabled === true) {
      if (this.shareService.isSharing()) {
        query[QueryParams.gallery.sharingKey_query] =
          this.shareService.getSharingKey();
      }
    }
    return query;
  }

  getParamsForDirs(directory: ParentDirectoryDTO | SubDirectoryDTO): {
    [key: string]: any;
  } {
    const params: { [key: string]: any } = {};
    if (Config.Sharing.enabled === true) {
      if (this.shareService.isSharing()) {
        params[QueryParams.gallery.sharingKey_query] =
          this.shareService.getSharingKey();
      }
    }
    if (
      directory &&
      directory.lastModified &&
      directory.lastScanned &&
      !directory.isPartial
    ) {
      params[QueryParams.gallery.knownLastModified] = directory.lastModified;
      params[QueryParams.gallery.knownLastScanned] = directory.lastScanned;
    }

    return params;
  }
}
