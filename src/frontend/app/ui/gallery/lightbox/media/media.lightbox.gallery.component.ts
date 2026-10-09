import {Component, ElementRef, EventEmitter, Input, type OnChanges, type OnDestroy, Output, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef} from '@angular/core';
import {GridMedia} from '../../grid/GridMedia';
import {MediaDTOUtils} from '../../../../../../common/entities/MediaDTO';
import {DomSanitizer, type SafeStyle} from '@angular/platform-browser';
import {SupportedFormats} from '../../../../../../common/SupportedFormats';
import {Config} from '../../../../../../common/config/public/Config';
import {LightboxService} from '../lightbox.service';
import {LoadingBarService} from '../../../../model/loading-bar.service';


interface PhotoRequest {
  id: number;
  type: 'base' | 'upgrade';
  src: string;
  doneLoading: () => void;
  completed: boolean;
}

@Component({
  selector: 'app-gallery-lightbox-media',
  styleUrls: ['./media.lightbox.gallery.component.css'],
  templateUrl: './media.lightbox.gallery.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: []
})
export class GalleryLightboxMediaComponent implements OnChanges, OnDestroy {
  @Input() gridMedia: GridMedia;
  @Input() nextGridMedia: GridMedia;
  @Input() loadMedia = false; // prevents loading media
  @Input() windowAspect = 1;
  @Input() zoom = 1;
  @Input() drag = {x: 0, y: 0};
  @Output() videoSourceError = new EventEmitter();

  @ViewChild('video', {static: false}) video: ElementRef<HTMLVideoElement>;
  @ViewChild('liveVideo', {static: false}) liveVideo: ElementRef<HTMLVideoElement>;
  @ViewChild('image', {static: false}) imageElement: ElementRef<HTMLImageElement>;

  prevGirdPhoto: GridMedia = null;

  public imageSize = {width: 'auto', height: '100'};
  // do not skip to the next photo if not both are loaded (or resulted in an error)
  public imageLoadFinished = {
    this: false,
    next: false
  };
  thumbnailSrc: string = null;
  liveVideoSrc: string = null;
  liveVideoPlaying = false;
  liveVideoClickLocked = false;
  private liveVideoTouchActive = false;
  photo = {
    src: null as string,
    isBestFit: null as boolean,
  };
  public transcodeNeedVideos = SupportedFormats.TranscodeNeed.Videos;
  private nextImage = new Image();

  private upgradeImage: HTMLImageElement = null;
  // if media not loaded, show thumbnail
  public mediaLoaded = false;
  private videoProgress = 0;
  public highResError = false;
  private isDestroyed = false;
  private currentRequestId = 0;
  private baseRequest: PhotoRequest | null = null;
  private upgradeRequest: PhotoRequest | null = null;

  private get activeRequest(): PhotoRequest | null {
    return this.upgradeRequest ?? this.baseRequest;
  }

  constructor(public elementRef: ElementRef,
              public lightboxService: LightboxService,
              private sanitizer: DomSanitizer,
              private changeDetector: ChangeDetectorRef,
              private loadingBarService: LoadingBarService) {
  }

  get ImageTransform(): SafeStyle {
    return this.sanitizer.bypassSecurityTrustStyle(
      'scale(' +
      this.zoom +
      ') translate(calc(' +
      -50 / this.zoom +
      '% + ' +
      this.drag.x / this.zoom +
      'px), calc(' +
      -50 / this.zoom +
      '% + ' +
      this.drag.y / this.zoom +
      'px))'
    );
  }

  public get VideoProgress(): number {
    return this.videoProgress;
  }

  public set VideoProgress(value: number) {
    if (!this.video && value === null && typeof value === 'undefined') {
      return;
    }
    this.video.nativeElement.currentTime =
      this.video.nativeElement.duration * (value / 100);
    if (this.video.nativeElement.paused) {
      this.video.nativeElement.play().catch(console.error);
    }
  }

  public get VideoVolume(): number {
    if (!this.video) {
      return 1;
    }
    return this.video.nativeElement.volume;
  }

  public set VideoVolume(value: number) {
    if (!this.video) {
      return;
    }
    this.video.nativeElement.muted = false;
    this.video.nativeElement.volume = value;
  }

  public get Muted(): boolean {
    if (!this.video) {
      return false;
    }
    return this.video.nativeElement.muted;
  }

  public get Paused(): boolean {
    if (!this.video) {
      return true;
    }
    return this.video.nativeElement.paused;
  }

  private get ThumbnailUrl(): string {
    if (this.gridMedia.isThumbnailAvailable() === true) {
      return this.gridMedia.getThumbnailPath();
    }

    if (this.gridMedia.isReplacementThumbnailAvailable() === true) {
      return this.gridMedia.getReplacementThumbnailPath();
    }
    return null;
  }

  public isRenderedMediaLoaded(): boolean {
    if (!this.gridMedia) {
      return false;
    }
    if (this.gridMedia.isVideo()) {
      return !!this.video && this.video.nativeElement.readyState >= 3; // HAVE_FUTURE_DATA
    }
    if (this.gridMedia.isPhoto()) {
      return this.imageLoadFinished.this || (this.imageElement && this.imageElement.nativeElement.complete);
    }
    return false;
  }

  public isNextMediaLoaded(): boolean {
    if (!this.nextGridMedia || !this.nextGridMedia.isPhoto()) {
      return true;
    }
    return this.imageLoadFinished.next || this.nextImage.complete;
  }

  ngOnChanges(): void {
    // media changed
    const mediaChanged = !this.prevGirdPhoto || !this.gridMedia ||
      !MediaDTOUtils.equals(this.prevGirdPhoto.media, this.gridMedia.media);
    if (mediaChanged) {
      this.cancelActiveRequest();
      this.highResError = false;
      this.prevGirdPhoto = this.gridMedia;
      this.thumbnailSrc = null;
      this.liveVideoSrc = null;
      this.liveVideoClickLocked = false;
      this.photo.src = null;
      if (this.nextImage.src) {
        this.nextImage.onload = null;
        this.nextImage.onerror = null;
        try {
          this.nextImage.removeAttribute('src');
        } catch (e) {
          this.nextImage.src = '';
        }
      }
      this.mediaLoaded = false;
      this.imageLoadFinished = {
        this: false,
        next: false
      };
    } else {
      this.prevGirdPhoto = this.gridMedia;
    }
    this.setImageSize();
    if (
      this.thumbnailSrc == null &&
      this.gridMedia &&
      this.ThumbnailUrl !== null
    ) {
      this.thumbnailSrc = this.ThumbnailUrl;
    }

    if (
      this.liveVideoSrc == null &&
      this.gridMedia &&
      this.gridMedia.isLivePhoto()
    ) {
      this.liveVideoSrc = this.gridMedia.getLiveVideoPath();
    }

    this.loadPhoto();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.cancelActiveRequest();
    if (this.nextImage) {
      this.nextImage.onload = null;
      this.nextImage.onerror = null;
      try {
        this.nextImage.removeAttribute('src');
      } catch (e) {
        this.nextImage.src = '';
      }
    }
  }

  public cancelUpgradeRequest(): void {
    if (this.upgradeRequest && !this.upgradeRequest.completed) {
      this.upgradeRequest.completed = true;
      this.upgradeRequest.doneLoading();
    }
    this.upgradeRequest = null;
    if (this.upgradeImage) {
      this.upgradeImage.onload = null;
      this.upgradeImage.onerror = null;
      try {
        this.upgradeImage.src = '';
      } catch (e) {
        // ignore
      }
      this.upgradeImage = null;
    }
  }

  public cancelActiveRequest(): void {
    if (this.baseRequest && !this.baseRequest.completed) {
      this.baseRequest.completed = true;
      this.baseRequest.doneLoading();
    }
    this.baseRequest = null;
    this.cancelUpgradeRequest();
  }

  public mute(): void {
    if (!this.video) {
      return;
    }

    this.video.nativeElement.muted = !this.video.nativeElement.muted;
  }

  public playPause(): void {
    if (!this.video) {
      return;
    }
    if (this.video.nativeElement.paused) {
      this.video.nativeElement.play().catch(console.error);
    } else {
      this.video.nativeElement.pause();
    }
  }

  public startLiveVideo(): void {
    if (!this.liveVideo || this.liveVideoClickLocked) {
      return;
    }
    this.liveVideoPlaying = true;
    this.liveVideo.nativeElement.currentTime = 0;
    this.liveVideo.nativeElement.play().catch(console.error);
  }

  public startLiveVideoTouch(): void {
    this.liveVideoTouchActive = true;
    this.startLiveVideo();
  }

  public stopLiveVideo(): void {
    if (!this.liveVideo || this.liveVideoClickLocked) {
      return;
    }
    this.liveVideoPlaying = false;
    this.liveVideo.nativeElement.pause();
  }

  public toggleLiveVideo(): void {
    // Suppress the synthetic click fired after a touch sequence
    if (this.liveVideoTouchActive) {
      this.liveVideoTouchActive = false;
      return;
    }
    if (!this.liveVideo) {
      return;
    }
    if (this.liveVideoClickLocked) {
      this.liveVideoClickLocked = false;
      this.liveVideoPlaying = false;
      this.liveVideo.nativeElement.pause();
    } else {
      this.liveVideoClickLocked = true;
      this.liveVideoPlaying = true;
      this.liveVideo.nativeElement.currentTime = 0;
      this.liveVideo.nativeElement.play().catch(console.error);
    }
  }

  public onVideoLoadStart(): void {
    this.imageLoadFinished.this = true;
  }

  public onVideoError(): void {
    this.imageLoadFinished.this = true;
    console.error('Error: cannot load video for lightbox');
  }

  public onLiveVideoError(): void {
    this.liveVideoPlaying = false;
    console.error('Error: cannot load live video for lightbox');
  }

  public onImageError(): void {
    const req = this.baseRequest;
    if (!req || req.completed) {
      return;
    }
    this.finishBasePhotoLoadError(req.id);
  }

  public onImageLoad(): void {
    const req = this.baseRequest;
    const img = this.imageElement?.nativeElement;

    if (!req || req.completed) {
      return;
    }
    const requestId = req.id;
    if (img && typeof img.decode === 'function') {
      img.decode().then(() => {
        if (this.isDestroyed || !this.baseRequest || this.baseRequest.id !== requestId || this.baseRequest.completed) {
          return;
        }
        this.finishBasePhotoLoadSuccess(requestId);
      }).catch(() => {
        if (this.isDestroyed || !this.baseRequest || this.baseRequest.id !== requestId || this.baseRequest.completed) {
          return;
        }
        if (img.complete && img.naturalWidth > 0) {
          this.finishBasePhotoLoadSuccess(requestId);
        } else {
          this.finishBasePhotoLoadError(requestId);
        }
      });
    } else {
      if (this.isDestroyed || !this.baseRequest || this.baseRequest.id !== requestId || this.baseRequest.completed) {
        return;
      }
      this.finishBasePhotoLoadSuccess(requestId);
    }
  }

  public onUpgradeImageLoad(requestId?: number): void {
    const req = this.upgradeRequest;
    if (!req || req.completed) {
      return;
    }
    const targetId = requestId ?? req.id;
    if (req.id !== targetId) {
      return;
    }
    const upgradeImg = this.upgradeImage;
    const promote = () => {
      if (this.isDestroyed || !this.upgradeRequest || this.upgradeRequest.id !== targetId || this.upgradeRequest.completed) {
        return;
      }
      this.photo.src = req.src;
      this.photo.isBestFit = false;
      this.highResError = false;
      this.upgradeRequest.completed = true;
      this.upgradeRequest.doneLoading();
      this.upgradeRequest = null;
      this.upgradeImage = null;
      this.changeDetector.markForCheck();
    };

    if (upgradeImg && typeof upgradeImg.decode === 'function') {
      upgradeImg.decode().then(promote).catch(() => {
        if (this.isDestroyed || !this.upgradeRequest || this.upgradeRequest.id !== targetId || this.upgradeRequest.completed) {
          return;
        }
        if (upgradeImg.naturalWidth > 0) {
          promote();
        } else {
          this.onUpgradeImageError(targetId);
        }
      });
    } else {
      promote();
    }
  }

  public onUpgradeImageError(requestId?: number): void {
    const req = this.upgradeRequest;
    if (!req || req.completed) {
      return;
    }
    const targetId = requestId ?? req.id;
    if (req.id !== targetId) {
      return;
    }
    this.highResError = true;
    req.completed = true;
    req.doneLoading();
    this.upgradeRequest = null;
    this.upgradeImage = null;
    this.changeDetector.markForCheck();
  }

  private finishBasePhotoLoadSuccess(requestId: number): void {
    if (!this.baseRequest || this.baseRequest.id !== requestId || this.baseRequest.completed) {
      return;
    }
    this.mediaLoaded = true;
    this.imageLoadFinished.this = true;
    this.baseRequest.completed = true;
    this.baseRequest.doneLoading();
    this.baseRequest = null;
    this.loadNextPhoto();
    this.changeDetector.markForCheck();
  }

  private finishBasePhotoLoadError(requestId: number): void {
    if (!this.baseRequest || this.baseRequest.id !== requestId || this.baseRequest.completed) {
      return;
    }
    this.imageLoadFinished.this = true;
    console.error(
      'Error: cannot load media for lightbox url: ' +
      this.baseRequest.src
    );
    this.baseRequest.completed = true;
    this.baseRequest.doneLoading();
    this.baseRequest = null;
    this.loadNextPhoto();
    this.changeDetector.markForCheck();
  }

  public showThumbnail(): boolean {
    return (
      this.gridMedia &&
      !this.mediaLoaded &&
      this.thumbnailSrc !== null &&
      (this.gridMedia.isThumbnailAvailable() ||
        this.gridMedia.isReplacementThumbnailAvailable())
    );
  }

  onSourceError(): void {
    this.mediaLoaded = false;
    this.videoSourceError.emit();
  }

  public onVideoProgress(): void {
    this.videoProgress =
      (100 / this.video.nativeElement.duration) *
      this.video.nativeElement.currentTime;
  }

  /**
   * Loads next photo to faster show it on navigation.
   * Called after the current photo is loaded
   * @private
   */
  private loadNextPhoto(): void {
    if (!this.nextGridMedia || !this.loadMedia) {
      return;
    }
    // Videos do not support preloading
    if (!this.nextGridMedia.isPhoto()) {
      this.imageLoadFinished.next = true;
      return;
    }
    this.nextImage.src = this.nextGridMedia.getBestSizedMediaPath(window.innerWidth, window.innerHeight);

    this.nextImage.onload = () => this.imageLoadFinished.next = true;
    this.nextImage.onerror = () => {
      console.error('Cant preload:' + this.nextImage.src);
      this.imageLoadFinished.next = true;
    };

    if (this.nextImage.complete) {
      this.imageLoadFinished.next = true;
    }
  }

  /**
   * Checks if the available preview size is adequate for lightbox display.
   * Returns false if the preview would be significantly smaller than the lightbox area.
   */
  private isPreviewAdequateForLightbox(): boolean {
    if (!Config.Gallery.Lightbox.loadFullImageIfPreviewTooSmall) {
      return true;
    }

    const selectedSize = this.gridMedia.getMediaSize(window.innerWidth, window.innerHeight);
    const minDisplaySize = Math.min(window.innerWidth, window.innerHeight);

    // If the selected preview size is less than 50% of the minimum display dimension,
    // consider it inadequate for lightbox display (e.g., 240px on a 1080p screen)
    return selectedSize >= minDisplaySize * 0.5;
  }

  private loadPhoto(): void {
    if (!this.gridMedia || !this.loadMedia || !this.gridMedia.isPhoto()) {
      return;
    }

    const wantOriginal = this.zoom > 1 && Config.Gallery.Lightbox.loadFullImageOnZoom !== false;

    if (this.photo.src == null) {
      let targetSrc: string;
      let isBestFit: boolean;

      if (!wantOriginal && this.isPreviewAdequateForLightbox()) {
        targetSrc = this.gridMedia.getBestSizedMediaPath(window.innerWidth, window.innerHeight);
        isBestFit = true;
      } else {
        targetSrc = this.gridMedia.getOriginalMediaPath();
        isBestFit = false;
      }

      this.cancelActiveRequest();
      const requestId = ++this.currentRequestId;
      const doneLoading = this.loadingBarService.begin();
      this.baseRequest = {
        id: requestId,
        type: 'base',
        src: targetSrc,
        doneLoading,
        completed: false
      };
      this.photo.src = targetSrc;
      this.photo.isBestFit = isBestFit;
      this.highResError = false;
    } else if (wantOriginal && this.photo.isBestFit === true) {
      const originalSrc = this.gridMedia.getOriginalMediaPath();
      if (this.upgradeRequest?.src === originalSrc) {
        return;
      }

      this.cancelActiveRequest();
      const requestId = ++this.currentRequestId;
      const doneLoading = this.loadingBarService.begin();
      this.upgradeRequest = {
        id: requestId,
        type: 'upgrade',
        src: originalSrc,
        doneLoading,
        completed: false
      };
      this.highResError = false;

      this.upgradeImage = new Image();
      this.upgradeImage.src = originalSrc;
      this.upgradeImage.onload = () => this.onUpgradeImageLoad(requestId);
      this.upgradeImage.onerror = () => this.onUpgradeImageError(requestId);
      if (this.upgradeImage.complete) {
        this.onUpgradeImageLoad(requestId);
      }
    }
  }

  private setImageSize(): void {
    if (!this.gridMedia) {
      return;
    }

    const photoAspect = MediaDTOUtils.calcAspectRatio(this.gridMedia.media);

    if (photoAspect < this.windowAspect) {
      this.imageSize.height = '100';
      this.imageSize.width = null;
    } else {
      this.imageSize.height = null;
      this.imageSize.width = '100';
    }
  }
}

