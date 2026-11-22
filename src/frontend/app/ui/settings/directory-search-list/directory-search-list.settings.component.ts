import {ChangeDetectionStrategy, Component, EventEmitter, Input, Output} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {NgIconComponent} from '@ng-icons/core';
import {type DirectorySearch, SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../../common/entities/SearchQueryDTO';
import {TextSearchMatchingTypes} from '../../gallery/search/query-enrty/TextSearchMatchingTypes';

@Component({
  selector: 'app-settings-directory-search-list',
  templateUrl: './directory-search-list.settings.component.html',
  host: {class: 'd-block'},
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, NgIconComponent]
})
export class DirectorySearchListSettingsComponent {
  @Input() list: DirectorySearch[] = [];
  @Input() idName = '';
  @Input() disabled = false;
  @Input() newItem: () => DirectorySearch = () => ({
    type: SearchQueryTypes.directory,
    value: '',
    matchType: TextSearchQueryMatchTypes.exact_match,
    negate: false
  });
  @Output() changed = new EventEmitter<void>();

  readonly matching = TextSearchMatchingTypes;

  setMatchingType(rule: DirectorySearch, value: string): void {
    this.matching.set(rule, value);
    this.changed.emit();
  }

  add(): void {
    this.list.push(this.newItem());
    this.changed.emit();
  }

  remove(index: number): void {
    this.list.splice(index, 1);
    this.changed.emit();
  }
}
