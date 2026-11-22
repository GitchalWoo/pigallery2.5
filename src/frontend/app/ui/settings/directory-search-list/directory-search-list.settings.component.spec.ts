import {TestBed} from '@angular/core/testing';
import {provideIcons} from '@ng-icons/core';
import {ionAddOutline, ionTrashOutline} from '@ng-icons/ionicons';
import {SearchQueryTypes, TextSearchQueryMatchTypes} from '../../../../../common/entities/SearchQueryDTO';
import {DirectorySearchConfig} from '../../../../../common/config/private/PrivateConfig';
import {CustomSettingsEntries} from '../template/CustomSettingsEntries';
import {DirectorySearchListSettingsComponent} from './directory-search-list.settings.component';

describe('DirectorySearchListSettingsComponent', () => {
  it('registers the custom global directory settings editor', () => {
    expect(CustomSettingsEntries.getFullName({arrayType: DirectorySearchConfig})).toBe('DirectorySearchConfig-Array');
  });

  it('edits the path and combined match type and supports adding and removing rules', async () => {
    TestBed.configureTestingModule({
      imports: [DirectorySearchListSettingsComponent],
      providers: [provideIcons({ionAddOutline, ionTrashOutline})]
    });
    const fixture = TestBed.createComponent(DirectorySearchListSettingsComponent);
    const component = fixture.componentInstance;
    const changed = vi.fn();
    component.changed.subscribe(changed);
    fixture.componentRef.setInput('idName', 'allowed');
    fixture.detectChanges();

    const view = fixture.nativeElement as HTMLElement;
    view.querySelector('button').click();
    fixture.detectChanges();
    await fixture.whenStable();

    const input = view.querySelector<HTMLInputElement>('#allowed-path-0');
    input.value = '/photos/*';
    input.dispatchEvent(new Event('input'));
    const match = view.querySelector<HTMLSelectElement>('#allowed-match-0');
    match.value = '!glob';
    match.dispatchEvent(new Event('change'));
    expect(component.list).toEqual([{
      type: SearchQueryTypes.directory,
      value: '/photos/*',
      matchType: TextSearchQueryMatchTypes.globMatch,
      negate: true
    }]);

    view.querySelector<HTMLButtonElement>('[aria-label="Remove directory rule"]').click();
    expect(component.list).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(4);
  });
});
