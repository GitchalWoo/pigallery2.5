import {Component, type OnDestroy, type OnInit, TemplateRef, ChangeDetectionStrategy} from '@angular/core';
import {type ContentWrapper} from '../../../../../common/entities/ContentWrapper';
import {Config} from '../../../../../common/config/public/Config';
import {NotificationService} from '../../../model/notification.service';
import {BsModalRef, BsModalService} from 'ngx-bootstrap/modal';
import {NetworkService} from '../../../model/network/network.service';
import {Subscription} from 'rxjs';
import {type SearchQueryDTO, SearchQueryTypes, type TextSearch, TextSearchQueryMatchTypes} from '../../../../../common/entities/SearchQueryDTO';
import {ContentLoaderService} from '../contentLoader.service';
import { NgIconComponent } from '@ng-icons/core';
import { FormsModule } from '@angular/forms';
import { ClipboardService } from '../../../model/clipboard.service';
import { GallerySearchQueryBuilderComponent } from '../search/query-builder/query-bulder.gallery.component';
import {SearchQueryUtils} from '../../../../../common/SearchQueryUtils';
import {Utils} from '../../../../../common/Utils';

@Component({
    selector: 'app-gallery-random-query-builder',
    templateUrl: './random-query-builder.gallery.component.html',
    styleUrls: ['./random-query-builder.gallery.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
        NgIconComponent,
        FormsModule,
        GallerySearchQueryBuilderComponent,
    ]
})
export class RandomQueryBuilderGalleryComponent implements OnInit, OnDestroy {
  public searchQueryDTO: SearchQueryDTO = {
    type: SearchQueryTypes.any_text,
    value: '',
  } as TextSearch;
  enabled = false;
  url = '';

  contentSubscription: Subscription = null;

  modalRef: BsModalRef;

  /**
   * The random link starts with the photos on the screen: the query of the opened search or the opened folder.
   */
  private shownQuery: SearchQueryDTO | null = null;

  constructor(
      public contentLoaderService: ContentLoaderService,
      private notification: NotificationService,
      private modalService: BsModalService,
      private clipboardService: ClipboardService
  ) {
  }

  get HTMLSearchQuery(): string {
    return SearchQueryUtils.urlify(this.searchQueryDTO);
  }

  onQueryChange(): void {
    this.url = NetworkService.buildUrl(
        Config.Server.getPublicUrl(Config.Server.apiPath, '/gallery/random/', encodeURIComponent(this.HTMLSearchQuery))
    );
  }

  ngOnInit(): void {
    this.contentSubscription = this.contentLoaderService.content.subscribe(
        (content: ContentWrapper) => {
          this.shownQuery = RandomQueryBuilderGalleryComponent.getShownQuery(content);
          this.enabled = this.shownQuery !== null;
        }
    );
  }

  ngOnDestroy(): void {
    if (this.contentSubscription !== null) {
      this.contentSubscription.unsubscribe();
    }
  }

  static getShownQuery(content: ContentWrapper): SearchQueryDTO | null {
    if (content?.searchResult) {
      return content.searchResult.searchQuery;
    }
    if (content?.directory) {
      return {
        type: SearchQueryTypes.directory,
        matchType: TextSearchQueryMatchTypes.exact_match,
        value: Utils.concatUrls('./', content.directory.path, content.directory.name)
      } as TextSearch;
    }
    return null;
  }

  openModal(template: TemplateRef<unknown>): boolean {
    if (!this.shownQuery) {
      return;
    }
    if (this.modalRef) {
      this.modalRef.hide();
    }

    // a copy: the builder must not change the query of the shown search
    this.searchQueryDTO = structuredClone(this.shownQuery);
    this.onQueryChange();
    this.modalRef = this.modalService.show(template, {class: 'modal-lg'});
    document.body.style.paddingRight = '0px';
    return false;
  }

  async copy(): Promise<void> {
    if (await this.clipboardService.copy(this.url)) {
      this.onCopy();
    }
  }

  onCopy(): void {
    this.notification.success($localize`Url has been copied to clipboard`);
  }

  public hideModal(): void {
    this.modalRef.hide();
    this.modalRef = null;
  }
}
