import {Component, HostListener, type OnDestroy, type OnInit, ChangeDetectionStrategy, signal, viewChild} from '@angular/core';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ActivatedRoute, type Params, Router} from '@angular/router';
import {ContentService} from './content.service';
import {GalleryGridComponent} from './grid/grid.gallery.component';
import {Config} from '../../../../common/config/public/Config';
import {ShareService} from './share.service';
import {NavigationService} from '../../model/navigation.service';
import {UserRoles} from '../../../../common/entities/UserDTO';
import {interval, Observable, Subscription} from 'rxjs';
import {PageHelper} from '../../model/page.helper';
import {type PhotoDTO} from '../../../../common/entities/PhotoDTO';
import {QueryParams} from '../../../../common/QueryParams';
import {GallerySortingService, type GroupedDirectoryContent} from './navigator/sorting.service';
import {FilterService} from './filter/filter.service';
import {PiTitleService} from '../../model/pi-title.service';
import {GPXFilesFilterPipe} from '../../pipes/GPXFilesFilterPipe';
import {MDFilesFilterPipe} from '../../pipes/MDFilesFilterPipe';
import {ContentLoaderService} from './contentLoader.service';
import {GalleryLightboxComponent} from './lightbox/lightbox.gallery.component';
import {FrameComponent} from '../frame/frame.component';

import {RandomQueryBuilderGalleryComponent} from './random-query-builder/random-query-builder.gallery.component';
import {PhotoFrameBuilderGalleryComponent} from './photo-frame-builder/photo-frame-builder.gallery.component';
import {GalleryNavigatorComponent} from './navigator/navigator.gallery.component';
import {DirectoriesComponent} from './directories/directories.component';
import {GalleryBlogComponent} from './blog/blog.gallery.component';
import {GalleryMapComponent} from './map/map.gallery.component';
import {PhotoFilterPipe} from '../../pipes/PhotoFilterPipe';
import {MediaButtonModalComponent} from './grid/photo/media-button-modal/media-button-modal.component';
import {type ContentWrapperWithError} from '../../../../common/entities/ContentWrapper';
import {SearchQueryUtils} from '../../../../common/SearchQueryUtils';
import {UploaderService} from './uploader/uploader.service';
import {GalleryService} from './gallery.service';
import {UploaderComponent} from './uploader/uploader.gallery.component';
import {QueryService} from '../../model/query.service';
import {type MediaDTO} from '../../../../common/entities/MediaDTO';
import {LightboxService} from './lightbox/lightbox.service';
import {EmptyStateComponent} from '../utils/empty-state/empty-state.component';
import {SpinnerComponent} from '../utils/spinner/spinner.component';
import {NgIconComponent} from '@ng-icons/core';
import {SearchQueryParserService} from './search/search-query-parser.service';

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    GalleryLightboxComponent,
    FrameComponent,
    RandomQueryBuilderGalleryComponent,
    PhotoFrameBuilderGalleryComponent,
    GalleryNavigatorComponent,
    DirectoriesComponent,
    GalleryBlogComponent,
    GalleryMapComponent,
    GalleryGridComponent,
    GPXFilesFilterPipe,
    PhotoFilterPipe,
    MediaButtonModalComponent,
    UploaderComponent,
    EmptyStateComponent,
    SpinnerComponent,
    NgIconComponent
]
})
export class GalleryComponent implements OnInit, OnDestroy {
  readonly grid = viewChild(GalleryGridComponent);

  public showSearchBar = false;
  public showShare = false;
  public showRandomPhotoBuilder = false;
  public blogOpen = Config.Gallery.TopBlogStartsOpen;

  config = Config;
  public isPhotoWithLocation = false;
  public readonly countDownSignal = signal<{
    day: number;
    hour: number;
    minute: number;
    second: number;
  } | null>(null);

  get countDown(): {
    day: number;
    hour: number;
    minute: number;
    second: number;
  } | null {
    return this.countDownSignal();
  }
  public readonly mapEnabled: boolean;
  public directoryContent: GroupedDirectoryContent;
  public isUploadOver = false;
  private expiryCheckedFor: {key: string; expires: number} = null;
  private $counter: Observable<number>;
  private subscription: Record<string, Subscription> = {
    content: null,
    route: null,
    timer: null,
    sorting: null,
  };

  constructor(
    public contentLoader: ContentLoaderService,
    public contentService: ContentService,
    public galleryService: GalleryService,
    private authService: AuthenticationService,
    private router: Router,
    private shareService: ShareService,
    private route: ActivatedRoute,
    private navigation: NavigationService,
    private filterService: FilterService,
    private sortingService: GallerySortingService,
    private piTitleService: PiTitleService,
    private gpxFilesFilterPipe: GPXFilesFilterPipe,
    private mdFilesFilterPipe: MDFilesFilterPipe,
    public uploaderService: UploaderService,
    private queryService: QueryService,
    private lightboxService: LightboxService,
    private searchQueryParser: SearchQueryParserService,
  ) {
    this.mapEnabled = Config.Map.enabled;
    PageHelper.showScrollY('gallery');
  }

  readonly mediaIdFn = (media: MediaDTO): string =>
    this.queryService.getMediaStringId(media);

  get ContentWrapper(): ContentWrapperWithError {
    return this.contentLoader.content.value;
  }

  get emptyState(): {icon: string; message: string; hint?: string; upload?: boolean} | null {
    const content = this.ContentWrapper;
    const result = content?.searchResult || content?.directory;
    if (!result || content.error || content.directory?.isPartial || result.directories?.length || result.media?.length) {
      return null;
    }
    if (content.searchResult) {
      const query = this.searchQueryParser.stringify(content.searchResult.searchQuery);
      return {
        icon: 'ionSearchOutline',
        message: query ? $localize`Search for "${query}:QUERY:" matched nothing.` : $localize`No search results.`,
        hint: $localize`Check the spelling or try a different search.`
      };
    }
    if (result.metaFile?.some(file => !file.name.toLowerCase().endsWith('.pg2conf'))) {
      return null;
    }
    const upload = this.uploaderService.canUpload();
    return {
      icon: 'ionFolderOutline',
      message: $localize`This folder is empty.`,
      hint: upload ? $localize`Drop photos or videos here, or choose files to upload.` : undefined,
      upload,
    };
  }

  uploadFromEmptyFolder(input: HTMLInputElement): void {
    if (input.files?.length) {
      this.uploaderService.uploadFiles(input.files);
    }
    input.value = '';
  }

  retry(): void {
    this.contentLoader.reloadCurrentContent().catch(console.error);
  }

  get isEmptyFrame(): boolean {
    const content = this.ContentWrapper;
    return this.lightboxService.playback && !!content && !content.error &&
      (!!content.searchResult || (!!content.directory && !content.directory.isPartial)) &&
      !!this.directoryContent && !this.directoryContent.mediaGroups.some(group => group.media.length > 0);
  }

  get ShowMarkDown(): boolean {
    return !this.preventDownload && this.config.MetaFile.markdown && this.directoryContent?.metaFile && this.mdFilesFilterPipe.transform(this.directoryContent.metaFile).length > 0;
  }

  get preventDownload(): boolean {
    return this.authService.preventDownload;
  }

  @HostListener('contextmenu', ['$event'])
  @HostListener('dragstart', ['$event'])
  preventSavingMedia(event: Event): void {
    if (this.preventDownload && (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement)) {
      event.preventDefault();
    }
  }

  get ShowMap(): boolean {
    return (this.isPhotoWithLocation || this.gpxFilesFilterPipe.transform(this.directoryContent?.metaFile)?.length > 0) && this.mapEnabled;
  }

  updateTimer(t: number): void {
    const sharing = this.shareService.sharingSubject.value;
    if (!sharing || sharing === this.shareService.UnknownSharingKey) {
      this.countDownSignal.set(null);
      return;
    }
    // if the timer is longer than 10 years, just do not show it
    if (
      (sharing.expires - Date.now()) /
      1000 /
      86400 /
      365 >
      10
    ) {
      this.countDownSignal.set(null);
      return;
    }

    const remaining = sharing.expires - Date.now();
    t = Math.max(0, Math.floor(remaining / 1000));
    if (remaining <= 0 && (this.expiryCheckedFor?.key !== sharing.sharingKey ||
      this.expiryCheckedFor.expires !== sharing.expires)) {
      this.expiryCheckedFor = {key: sharing.sharingKey, expires: sharing.expires};
      this.contentLoader.reloadCurrentContent().catch(console.error);
    }
    const day = Math.floor(t / 86400);
    t -= day * 86400;
    const hour = Math.floor(t / 3600) % 24;
    t -= hour * 3600;
    const minute = Math.floor(t / 60) % 60;
    t -= minute * 60;
    const second = t % 60;
    this.countDownSignal.set({day, hour, minute, second});
  }

  ngOnDestroy(): void {
    if (this.subscription.content !== null) {
      this.subscription.content.unsubscribe();
    }
    if (this.subscription.route !== null) {
      this.subscription.route.unsubscribe();
    }
    if (this.subscription.timer !== null) {
      this.subscription.timer.unsubscribe();
    }
    if (this.subscription.sorting !== null) {
      this.subscription.sorting.unsubscribe();
    }
  }

  async ngOnInit(): Promise<boolean> {
    await this.shareService.wait();
    if (!this.authService.isAuthenticated()) {
      return this.navigation.toLogin();
    }
    this.showSearchBar = this.authService.canSearch();
    this.showShare =
      Config.Sharing.enabled &&
      this.authService.isAuthorized(UserRoles.User);
    this.showRandomPhotoBuilder =
      Config.RandomPhoto.enabled &&
      this.authService.isAuthorized(UserRoles.User);
    this.subscription.content = this.contentService.sortedFilteredContent
      .subscribe((dc: GroupedDirectoryContent) => {
        this.onContentChange(dc);
      });
    this.subscription.route = this.route.params.subscribe(this.onRoute);

    if (this.shareService.isSharing()) {
      this.$counter = interval(1000);
      this.subscription.timer = this.$counter.subscribe((x): void =>
        this.updateTimer(x)
      );
    }
  }

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (this.uploaderService.canUpload()) {
      event.preventDefault();
      event.stopPropagation();
      this.isUploadOver = true;
    }
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    if (this.uploaderService.canUpload()) {
      event.preventDefault();
      event.stopPropagation();
      this.isUploadOver = false;
    }
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    if (this.uploaderService.canUpload()) {
      event.preventDefault();
      event.stopPropagation();
      this.isUploadOver = false;
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        this.uploaderService.uploadFiles(files);
      }
    }
  }

  private onRoute = async (params: Params): Promise<void> => {
    const searchLink = params[QueryParams.gallery.search.query];
    if (searchLink) {
      const searchQuery = SearchQueryUtils.parseSearchLink(searchLink);
      if (!searchQuery) {
        this.contentLoader.showBrokenSearchLink();
        return;
      }
      this.contentLoader.search(searchQuery).catch(console.error);
      this.piTitleService.setSearchTitle(searchQuery);
      return;
    }

    if (
      params[QueryParams.gallery.sharingKey_params] &&
      params[QueryParams.gallery.sharingKey_params] !== ''
    ) {
      const key = params[QueryParams.gallery.sharingKey_params];
      const sharing = await this.shareService.getCurrentSharing();
      if (key !== this.shareService.getSharingKey()) {
        return;
      }
      const route = this.shareService.getDefaultRoute(sharing);
      if (!route) {
        if (sharing !== this.shareService.UnknownSharingKey) {
          await this.router.navigate(['/error']);
        }
        return;
      }
      if (!this.authService.user.value?.usedSharingKey) {
        await this.router.navigate(route, {queryParams: {[QueryParams.gallery.sharingKey_query]: key}, queryParamsHandling: 'merge'});
        return;
      }
      await this.onRoute({
        [route[0] === '/search' ? QueryParams.gallery.search.query : QueryParams.gallery.directory]: route[1],
      });
      return;
    }

    let directoryName = params[QueryParams.gallery.directory];
    directoryName = directoryName || '';

    this.piTitleService.setDirectoryTitle(directoryName);
    this.contentLoader.loadDirectory(directoryName);
  };

  private onContentChange = (content: GroupedDirectoryContent): void => {
    if (!content) {
      return;
    }
    this.directoryContent = content;

    // enforce change detection on grid
    this.directoryContent.mediaGroups = this.directoryContent.mediaGroups?.slice();
    this.isPhotoWithLocation = false;

    for (const mediaGroup of content.mediaGroups) {

      if (
        mediaGroup.media
          .findIndex((m: PhotoDTO) => !!m.metadata?.positionData?.GPSData?.longitude) !== -1
      ) {
        this.isPhotoWithLocation = true;
        break;
      }
    }
  };

}
