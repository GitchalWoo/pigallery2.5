import {Component, ElementRef, type OnDestroy, type OnInit, type AfterViewInit, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef, computed, inject, input} from '@angular/core';
import {type Dimension, type IRenderable} from '../../../../model/IRenderable';
import {GridMedia} from '../GridMedia';
import {type Params, RouterLink} from '@angular/router';
import {Thumbnail, ThumbnailManagerService,} from '../../thumbnailManager.service';
import {Config} from '../../../../../../common/config/public/Config';
import {PageHelper} from '../../../../model/page.helper';
import {type MediaDTO} from '../../../../../../common/entities/MediaDTO';
import {type PhotoDTO, type PhotoMetadata,} from '../../../../../../common/entities/PhotoDTO';
import {QueryParams} from '../../../../../../common/QueryParams';
import {SearchQueryTypes, type TextSearch, TextSearchQueryMatchTypes,} from '../../../../../../common/entities/SearchQueryDTO';
import {AuthenticationService} from '../../../../model/network/authentication.service';
import {ExtensionService} from '../../../../model/extension.service';
import {MediaButtonModalService} from './media-button-modal/media-button-modal.service';
import {GalleryPhotoLoadingComponent} from './loading/loading.photo.grid.gallery.component';
import {NgIconComponent} from '@ng-icons/core';
import {DurationPipe} from '../../../../pipes/DurationPipe';
import {SafeHtmlPipe} from '../../../../pipes/SafeHTMLPipe';
import {type IClientMediaButtonConfig, type IMetadataFilter} from '../../../../../../common/entities/extension/IClientUIConfig';
import {Utils} from '../../../../../../common/Utils';
import {SearchQueryUtils} from '../../../../../../common/SearchQueryUtils';
import {QueryService} from '../../../../model/query.service';
import {ScrollRestorationService} from '../../../../model/scroll-restoration.service';

export interface IClientMediaButtonConfigWithBaseApiPath extends IClientMediaButtonConfig {
  extensionBasePath: string;
}

@Component({
  selector: 'app-gallery-grid-photo',
  templateUrl: './photo.grid.gallery.component.html',
  styleUrls: ['./photo.grid.gallery.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    GalleryPhotoLoadingComponent,
    NgIconComponent,
    RouterLink,
    DurationPipe,
    SafeHtmlPipe,
  ]
})
export class GalleryPhotoComponent implements IRenderable, OnInit, AfterViewInit, OnDestroy {
  private queryService = inject(QueryService);
  private scrollRestoration = inject(ScrollRestorationService);

  readonly gridMedia = input.required<GridMedia>();
  readonly shownBefore = input(false);
  readonly mediaIdFn = input<((media: MediaDTO) => string) | null>(null);
  readonly extraQueryParams = input<Params | ((media: MediaDTO) => Params)>({});
  fadeIn = false;

  @ViewChild('img', {static: false}) imageRef: ElementRef;
  @ViewChild('photoContainer', {static: true}) container: ElementRef;

  readonly lightboxLink = computed(() => {
    const media = this.gridMedia().media;
    const link = this.queryService.getLightboxLink(media);
    const idFn = this.mediaIdFn();
    const extraParams = this.extraQueryParams();
    const extra = typeof extraParams === 'function' ? extraParams(media) : extraParams;
    if (!idFn && Object.keys(extra).length === 0) {
      return link;
    }
    return {
      queryParams: {
        ...link.queryParams,
        ...extra,
        ...(idFn ? {[QueryParams.gallery.photo]: idFn(media)} : {}),
      },
      state: link.state,
    };
  });

  thumbnail: Thumbnail;
  keywords: { value: string; type: SearchQueryTypes }[] = null;
  infoBarVisible = false;
  animationTimer: number = null;

  readonly SearchQueryTypes: typeof SearchQueryTypes = SearchQueryTypes;
  searchEnabled = true;

  wasInView: boolean = null;
  loaded = false;
  imageError = false;
  private destroyed = false;
  private requestedSrc: string | null = null;
  private loadVersion = 0;
  public mediaButtons: IClientMediaButtonConfigWithBaseApiPath[];

  get hasError(): boolean {
    return (this.thumbnail?.Error && !this.loaded) || this.imageError;
  }

  constructor(
    private thumbnailService: ThumbnailManagerService,
    private authService: AuthenticationService,
    private extensionService: ExtensionService,
    private modalService: MediaButtonModalService,
    private changeDetector: ChangeDetectorRef
  ) {
    this.searchEnabled = this.authService.canSearch();
  }

  get ScrollListener(): boolean {
    return !this.thumbnail.Available && !this.thumbnail.Error;
  }

  get Title(): string {
    const gm = this.gridMedia();
    if (Config.Gallery.captionFirstNaming === false) {
      return gm.media.name;
    }
    if ((gm.media as PhotoDTO).metadata.caption) {
      if ((gm.media as PhotoDTO).metadata.caption.length > 20) {
        return (
          (gm.media as PhotoDTO).metadata.caption.substring(0, 17) +
          '...'
        );
      }
      return (gm.media as PhotoDTO).metadata.caption;
    }
    return gm.media.name;
  }

  updateMediaButtons(): void {
    if (!this.extensionService.UIExtensionConfig) {
      return;
    }

    const allButtons: IClientMediaButtonConfigWithBaseApiPath[] = [];
    this.extensionService.UIExtensionConfig.forEach(config => {
      if (config.mediaButtons) {
        const buttons: IClientMediaButtonConfigWithBaseApiPath[] = Utils.clone(config.mediaButtons)
          .map((b: IClientMediaButtonConfigWithBaseApiPath) => {
            b.extensionBasePath = config.extensionBasePath;
            return b;
          });

        allButtons.push(...buttons);
      }
    });

    this.mediaButtons = allButtons.filter(button => {
      if (this.gridMedia().isVideo() && button.skipVideos) {
        return false;
      }
      if (this.gridMedia().isPhoto() && button.skipPhotos) {
        return false;
      }

      // Check metadataFilter
      if (button.metadataFilter && button.metadataFilter.length > 0) {
        return this.matchesMetadataFilter(button.metadataFilter);
      }

      return true;
    });

    // move always visible buttons to the front
    this.mediaButtons = [...this.mediaButtons.filter(b => b.alwaysVisible), ...this.mediaButtons.filter(b => !b.alwaysVisible)];
  }

  matchesMetadataFilter(filters: IMetadataFilter[]): boolean {
    const metadata = this.gridMedia().media.metadata;

    // All filters must match (AND logic)
    return filters.every(filter => {
      // Get the value from metadata using the field path (e.g., 'rating' or 'size.width')
      const fieldParts = filter.field.split('.');
      let fieldValue: any = metadata;

      for (const part of fieldParts) {
        if (fieldValue === undefined || fieldValue === null) {
          break;
        }
        fieldValue = fieldValue[part];
      }

      if (fieldValue === undefined || fieldValue === null) {
        return filter.comparator === '!contains';
      }

      // Compare based on comparator
      switch (filter.comparator) {
        case '>=':
          return fieldValue >= filter.value;
        case '<=':
          return fieldValue <= filter.value;
        case '==':
          return fieldValue == filter.value; // Use == for loose equality
        case 'contains':
          return GalleryPhotoComponent.contains(fieldValue, filter.value);
        case '!contains':
          return !GalleryPhotoComponent.contains(fieldValue, filter.value);
        default:
          return false;
      }
    });
  }

  private static contains(fieldValue: unknown, value: string | number): boolean {
    if (Array.isArray(fieldValue)) {
      return fieldValue.some(item => item == value);
    }
    return typeof fieldValue === 'string' && fieldValue.includes(String(value));
  }

  ngOnInit(): void {
    this.fadeIn = this.scrollRestoration.restoreTarget() === null && !this.shownBefore();
    const gm = this.gridMedia();
    this.thumbnail = this.thumbnailService.getThumbnail(gm);
    this.requestedSrc = this.thumbnail?.Src ?? null;
    this.loadVersion = 0;
    this.thumbnail.OnLoad = () => {
      if (this.requestedSrc !== this.thumbnail.Src) {
        this.requestedSrc = this.thumbnail.Src;
        this.loadVersion++;
        this.imageError = false;
      }
      this.changeDetector.markForCheck();
    };
    const metadata = gm.media.metadata as PhotoMetadata;
    if (
      (metadata.keywords && metadata.keywords.length > 0) ||
      (metadata.faces && metadata.faces.length > 0)
    ) {
      this.keywords = [];
      if (Config.Faces.enabled) {
        const names: string[] = (metadata.faces || []).map(
          (f): string => f.name
        );
        this.keywords = names
          .filter((name, index): boolean => names.indexOf(name) === index)
          .map((n): { type: SearchQueryTypes; value: string } => ({
            value: n,
            type: SearchQueryTypes.person,
          }));
      }
      this.keywords = this.keywords.concat(
        (metadata.keywords || []).map(
          (k): { type: SearchQueryTypes; value: string } => ({
            value: k,
            type: SearchQueryTypes.keyword,
          })
        )
      );
    }

    this.updateMediaButtons();
  }

  ngAfterViewInit(): void {
    const img = this.imageRef?.nativeElement;
    if (img?.complete && img.naturalWidth > 0) {
      this.requestedSrc = this.thumbnail?.Src ?? img.src;
      this.imageError = false;
      this.loaded = true;
      this.changeDetector.markForCheck();
    }
  }

  onImageError(): void {
    if (this.destroyed) {
      return;
    }
    this.imageError = true;
    this.loaded = false;
    this.changeDetector.markForCheck();
  }

  onImageLoad(): void {
    const img = this.imageRef?.nativeElement;
    if (!img) {
      return;
    }
    const targetImg = img;
    const version = ++this.loadVersion;
    const targetSrc = this.thumbnail?.Src ?? targetImg.getAttribute('src') ?? targetImg.src;
    this.requestedSrc = targetSrc;

    const isCurrent = (): boolean => {
      if (this.destroyed) {
        return false;
      }
      if (this.imageRef?.nativeElement !== targetImg) {
        return false;
      }
      if (this.loadVersion !== version) {
        return false;
      }
      if (this.requestedSrc !== targetSrc) {
        return false;
      }
      const currentAttr = targetImg.getAttribute('src');
      if (currentAttr && currentAttr !== targetSrc && !targetImg.src.endsWith(targetSrc)) {
        return false;
      }
      return !this.imageError;
    };

    if (typeof targetImg.decode === 'function') {
      targetImg.decode()
        .then(() => {
          if (isCurrent()) {
            this.imageError = false;
            this.loaded = true;
            this.changeDetector.markForCheck();
          }
        })
        .catch(() => {
          // Require a usable image for the decode rejection fallback
          if (isCurrent() && targetImg.complete && targetImg.naturalWidth > 0) {
            this.imageError = false;
            this.loaded = true;
            this.changeDetector.markForCheck();
          }
        });
    } else {
      if (isCurrent()) {
        this.imageError = false;
        this.loaded = true;
        this.changeDetector.markForCheck();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.thumbnail.destroy();

    if (this.animationTimer != null) {
      clearTimeout(this.animationTimer);
    }
  }

  isInView(): boolean {
    const el = this.container?.nativeElement;
    if (!el || typeof el.getBoundingClientRect !== 'function') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
    );
  }

  onScroll(): void {
    if (this.thumbnail.Available === true || this.thumbnail.Error === true) {
      return;
    }
    const isInView = this.isInView();
    if (this.wasInView !== isInView) {
      this.wasInView = isInView;
      this.thumbnail.Visible = isInView;
    }
  }

  getPositionSearchQuery(): string {
    return SearchQueryUtils.urlify({
      type: SearchQueryTypes.position,
      matchType: TextSearchQueryMatchTypes.exact_match,
      value: this.getPositionText(),
    } as TextSearch);
  }

  getTextSearchQuery(name: string, type: SearchQueryTypes): string {
    return SearchQueryUtils.urlify({
      type,
      matchType: TextSearchQueryMatchTypes.exact_match,
      value: name,
    } as TextSearch);
  }

  getPositionText(): string {
    const gm = this.gridMedia();
    if (!gm || !gm.isPhoto() || !(gm.media as PhotoDTO).metadata.positionData) {
      return '';
    }
    return ( //not much space in the gridview, so we only deliver city, or state or country
      (gm.media as PhotoDTO).metadata.positionData.city ||
      (gm.media as PhotoDTO).metadata.positionData.state ||
      (gm.media as PhotoDTO).metadata.positionData.country || ''
    ).trim();
  }

  mouseOver(): void {
    this.infoBarVisible = true;
    if (this.animationTimer != null) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
  }

  mouseOut(): void {
    if (this.animationTimer != null) {
      clearTimeout(this.animationTimer);
    }
    this.animationTimer = window.setTimeout((): void => {
      this.animationTimer = null;
      this.infoBarVisible = false;
    }, 500);
  }

  onMediaButtonClick(button: IClientMediaButtonConfigWithBaseApiPath, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    if(!button.apiPath){
      return; // this is a fake button, nothing to call
    }

    if (button.popup) {
      this.modalService.showModal(button, this.gridMedia());
    } else {
      this.modalService.executeButtonAction(button, this.gridMedia());
    }
  }

  public getDimension(): Dimension {
    let rect: DOMRect | null = null;
    const img = this.imageRef?.nativeElement;
    if (img && typeof img.getBoundingClientRect === 'function') {
      const imgRect = img.getBoundingClientRect();
      if (imgRect.width > 0 && imgRect.height > 0) {
        rect = imgRect;
      }
    }
    if (!rect) {
      const container = this.container?.nativeElement;
      if (container && typeof container.getBoundingClientRect === 'function') {
        const containerRect = container.getBoundingClientRect();
        if (containerRect.width > 0 && containerRect.height > 0) {
          rect = containerRect;
        }
      }
    }

    if (!rect) {
      return {
        top: 0,
        left: 0,
        width: 0,
        height: 0,
      };
    }

    return {
      top: rect.top + PageHelper.ScrollY,
      left: rect.left + PageHelper.ScrollX,
      width: rect.width,
      height: rect.height,
    };
  }
}
