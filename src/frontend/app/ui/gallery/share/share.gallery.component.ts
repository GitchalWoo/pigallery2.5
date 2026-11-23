import {Component, Input, type OnDestroy, type OnInit, TemplateRef, ChangeDetectionStrategy} from '@angular/core';
import {Utils} from '../../../../../common/Utils';
import {ShareService} from '../share.service';
import {type ContentWrapper} from '../../../../../common/entities/ContentWrapper';
import {type ResponseSharingDTO} from '../../../../../common/entities/SharingDTO';
import {Config} from '../../../../../common/config/public/Config';
import {NotificationService} from '../../../model/notification.service';
import {BsModalRef, BsModalService} from 'ngx-bootstrap/modal';
import {Subscription} from 'rxjs';
import {UserRoles} from '../../../../../common/entities/UserDTO';
import {AuthenticationService} from '../../../model/network/authentication.service';
import { ClipboardService } from '../../../model/clipboard.service';
import {ContentLoaderService} from '../contentLoader.service';
import { DatePipe } from '@angular/common';
import { NgIconComponent } from '@ng-icons/core';
import { FormsModule } from '@angular/forms';
import { type DirectorySearch, type SearchQueryDTO, SearchQueryTypes, TextSearchQueryMatchTypes } from '../../../../../common/entities/SearchQueryDTO';
import { StringifySearchQuery } from '../../../pipes/StringifySearchQuery';
import { SearchQueryUtils } from '../../../../../common/SearchQueryUtils';

@Component({
    selector: 'app-gallery-share',
    templateUrl: './share.gallery.component.html',
    styleUrls: ['./share.gallery.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
    NgIconComponent,
    FormsModule,
    DatePipe,
    StringifySearchQuery
]
})
export class GalleryShareComponent implements OnInit, OnDestroy {
  enabled = true;
  @Input() dropDownItem = false;
  url = '';
  urlValid = false;
  shareRequestPending = false;
  showSharingList = false;

  input = {
    valid: {
      amount: 30,
      type: ValidityTypes.Days as ValidityTypes,
    },
    password: null as string,
    recursive: false,
    preventDownload: false,
  };
  currentDir: string | null = null;
  currentQuery: SearchQueryDTO = null;
  sharingTarget = '';
  currentMediaCount = 0;
  currentRecursiveMediaCount = 0;
  currentMediaCountIsLowerBound = false;
  sharing: ResponseSharingDTO = null;
  contentSubscription: Subscription = null;
  readonly passwordRequired = Config.Sharing.passwordRequired;
  readonly ValidityTypes = ValidityTypes;

  modalRef: BsModalRef;
  invalidSettings = $localize`Invalid settings`;

  activeShares: ResponseSharingDTO[] = [];
  private activeSharesRequest = 0;

  text = {
    Yes: 'Yes',
    No: 'No',
  };

  constructor(
      public sharingService: ShareService,
      public galleryService: ContentLoaderService,
      private notification: NotificationService,
      private modalService: BsModalService,
      public authService: AuthenticationService,
      private clipboardService: ClipboardService
  ) {
    this.text.Yes = $localize`Yes`;
    this.text.No = $localize`No`;
  }

  public get IsAdmin() {
    return this.authService.user.value.role > UserRoles.Admin;
  }

  ngOnInit(): void {
    this.contentSubscription = this.galleryService.content.subscribe(
        async (content: ContentWrapper) => {
          this.activeSharesRequest++;
          this.activeShares = [];
          this.enabled = !!(content?.directory || content?.searchResult);
          this.currentDir = null;
          this.currentQuery = null;
          this.sharingTarget = '';
          this.currentMediaCount = 0;
          this.currentRecursiveMediaCount = 0;
          this.currentMediaCountIsLowerBound = false;

          if (content?.searchResult) {
            const sr = content.searchResult;
            this.currentQuery = sr.searchQuery;
            this.sharingTarget = $localize`Search query`;
            this.currentMediaCount = (sr.media ? sr.media.length : 0);
            this.currentMediaCountIsLowerBound = !!sr.resultOverflow;
          } else if (content?.directory) {
            this.currentDir = SearchQueryUtils.normalizeDirectoryPath(
              Utils.concatUrls(content.directory.path, content.directory.name)) || '/';
            this.sharingTarget = this.currentDir;
            // Prefer mediaCount, fallback to media length if needed
            this.currentMediaCount = (typeof content?.directory.cache?.mediaCount === 'number' ? content.directory.cache?.mediaCount : (content.directory.media ? content.directory.media.length : 0));
            this.currentRecursiveMediaCount = content.directory.cache?.recursiveMediaCount ?? this.currentMediaCount;
            this.currentMediaCountIsLowerBound = false;
          }

          if (!this.enabled) {
            return;
          }
          await this.updateActiveSharesList();
        }
    );
  }

  ngOnDestroy(): void {
    this.activeSharesRequest++;
    if (this.contentSubscription !== null) {
      this.contentSubscription.unsubscribe();
    }
  }


  async deleteSharing(sharing: ResponseSharingDTO): Promise<void> {
    await this.sharingService.deleteSharing(sharing);
    await this.updateActiveSharesList();
  }

  private async updateActiveSharesList() {
    const request = ++this.activeSharesRequest;
    try {
      const queries = this.isDirectorySharing
        ? [this.buildDirectoryQuery(false)]
        : this.currentQuery ? [this.currentQuery] : [];
      if (this.canShareSubfolders) {
        queries.push(this.buildDirectoryQuery(true));
      }
      if (this.currentDir === '/') {
        // Older root shares used "." in their directory search query.
        const legacyRootQuery: DirectorySearch = {...this.buildDirectoryQuery(false), value: '.'};
        queries.push(legacyRootQuery);
      }
      const lists = await Promise.all(queries.map(query => this.sharingService.getSharingListForQuery(query)));
      if (request === this.activeSharesRequest) {
        this.activeShares = [...new Map(lists.flat().map(share => [share.sharingKey, share])).values()];
      }
    } catch (e) {
      if (request === this.activeSharesRequest) {
        this.activeShares = [];
      }
      console.error(e);
    }
  }

  get isDirectorySharing(): boolean {
    return this.currentDir !== null;
  }

  get canShareSubfolders(): boolean {
    return this.isDirectorySharing && !/[*?]/.test(this.currentDir);
  }

  get sharedMediaCount(): number {
    return this.canShareSubfolders && this.input.recursive ? this.currentRecursiveMediaCount : this.currentMediaCount;
  }

  private buildDirectoryQuery(recursive: boolean): DirectorySearch {
    recursive = recursive && this.canShareSubfolders;
    return {
      type: SearchQueryTypes.directory,
      value: recursive ? Utils.concatUrls(this.currentDir, '*') : this.currentDir,
      matchType: recursive ? TextSearchQueryMatchTypes.globMatch : TextSearchQueryMatchTypes.exact_match
    };
  }

  isRecursive(share: ResponseSharingDTO): boolean {
    return share.directoryQuery?.matchType === TextSearchQueryMatchTypes.globMatch &&
      share.directoryQuery.value.endsWith('*');
  }

  calcValidity(): number {
    switch (parseInt(this.input.valid.type.toString(), 10)) {
      case ValidityTypes.Minutes:
        return this.input.valid.amount * 1000 * 60;
      case ValidityTypes.Hours:
        return this.input.valid.amount * 1000 * 60 * 60;
      case ValidityTypes.Days:
        return this.input.valid.amount * 1000 * 60 * 60 * 24;
      case ValidityTypes.Months:
        return this.input.valid.amount * 1000 * 60 * 60 * 24 * 30;
      case ValidityTypes.Forever:
        return -1;
    }
    throw new Error('unknown type: ' + this.input.valid.type);
  }

  async update(): Promise<void> {
    if (this.shareRequestPending || this.sharing == null || (!this.isDirectorySharing && !this.currentQuery)) {
      return;
    }
    const {id} = this.sharing;
    const valid = this.calcValidity();
    this.urlValid = false;
    this.url = $localize`loading..`;
    this.shareRequestPending = true;
    try {
      this.sharing = this.isDirectorySharing
        ? await this.sharingService.updateSharingByDirectory(
          id, this.buildDirectoryQuery(this.input.recursive), this.input.password, valid, this.currentDir, this.input.preventDownload)
        : await this.sharingService.updateSharingByQuery(id, this.currentQuery, this.input.password, valid,
          undefined, undefined, this.input.preventDownload);
      this.urlValid = true;
      this.url = this.sharingService.getUrl(this.sharing);
      await this.updateActiveSharesList();
    } finally {
      this.shareRequestPending = false;
    }
  }

  async get(): Promise<void> {
    if (this.shareRequestPending) {
      return;
    }
    if(Config.Sharing.passwordRequired && !this.input.password){
      this.url = $localize`Set password.`;
      return;
    }
    if (!this.isDirectorySharing && !this.currentQuery) {
      this.url = $localize`Invalid settings`;
      return;
    }
    const valid = this.calcValidity();
    this.urlValid = false;
    this.url = $localize`loading..`;
    this.shareRequestPending = true;
    try {
      this.sharing = this.isDirectorySharing
        ? await this.sharingService.createSharingByDirectory(
          this.buildDirectoryQuery(this.input.recursive), this.input.password, valid, this.currentDir, this.input.preventDownload)
        : await this.sharingService.createSharingByQuery(this.currentQuery, this.input.password, valid,
          undefined, undefined, this.input.preventDownload);
      this.url = this.sharingService.getUrl(this.sharing);
      this.urlValid = true;
      await this.updateActiveSharesList();
    } finally {
      this.shareRequestPending = false;
    }
  }

  async openModal(template: TemplateRef<unknown>): Promise<void> {
    this.url = $localize`Click share to get a link.`;
    this.urlValid = false;
    this.sharing = null;
    this.input.password = '';
    this.input.recursive = false;
    this.input.preventDownload = false;
    if (this.modalRef) {
      this.modalRef.hide();
    }
    this.modalRef = this.modalService.show(template);
  }

  async copy(url = this.url): Promise<void> {
    if (await this.clipboardService.copy(url)) {
      this.onCopy();
    }
  }

  onCopy(): void {
    this.notification.success($localize`Sharing link has been copied to clipboard`);
  }

  public hideModal(): void {
    this.modalRef.hide();
    this.modalRef = null;
    this.sharing = null;
  }

  async share() {
    await this.get();
    if (this.urlValid && this.clipboardService.isSupported) {
      await this.copy();
    }

  }

}


export enum ValidityTypes {
  Minutes = 1, Hours = 2, Days = 3, Months = 4, Forever = 99
}
