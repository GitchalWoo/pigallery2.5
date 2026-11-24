import {ComponentFixture, TestBed} from '@angular/core/testing';
import {provideRouter, Router} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {NgIconsModule} from '@ng-icons/core';
import {ionChevronDownOutline, ionSaveOutline, ionSearchOutline, ionTrashOutline, ionAddOutline} from '@ng-icons/ionicons';
import {GallerySearchComponent} from './search.gallery.component';
import {SearchQueryParserService} from './search-query-parser.service';
import {AutoCompleteService} from './autocomplete.service';
import {GallerySearchFieldBaseComponent} from './search-field-base/search-field-base.gallery.component';
import {AlbumsService} from '../../albums/albums.service';
import {AuthenticationService} from '../../../model/network/authentication.service';
import {UserRoles} from '../../../../../common/entities/UserDTO';

describe('GallerySearchComponent - Enter key of phone keyboards (#1214)', () => {
  let fixture: ComponentFixture<GallerySearchComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;

  const render = async (): Promise<void> => {
    for (let i = 0; i < 3; ++i) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [NgIconsModule.withIcons({ionChevronDownOutline, ionSaveOutline, ionSearchOutline, ionTrashOutline, ionAddOutline})],
      providers: [
        SearchQueryParserService,
        provideRouter([]),
        {provide: AlbumsService, useValue: {}},
        {provide: AuthenticationService, useValue: {user: new BehaviorSubject({role: UserRoles.Admin})}},
      ],
    });
    TestBed.overrideComponent(GallerySearchFieldBaseComponent, {
      add: {providers: [{provide: AutoCompleteService, useValue: {}}]}
    });
    fixture = TestBed.createComponent(GallerySearchComponent);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
  });

  afterEach(() => {
    document.querySelectorAll('modal-container, bs-modal-backdrop').forEach((e) => e.remove());
  });

  it('should label the Enter key of the navbar search field as search', () => {
    const input = (fixture.nativeElement as HTMLElement).querySelector('input.search-text');
    expect(input.getAttribute('enterkeyhint')).toBe('search');
  });

  it('should search when the navbar form is submitted', async () => {
    fixture.componentInstance.rawSearchText = 'cat';
    fixture.componentInstance.validateRawSearchText();
    const form = (fixture.nativeElement as HTMLElement).querySelector('form.navbar-form');
    form.dispatchEvent(new Event('submit', {cancelable: true}));
    await render();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0][0]).toBe('/search');
  });

  it('should submit the navbar form with its search button', () => {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('form.navbar-form button'));
    expect(buttons.map((b) => b.getAttribute('type'))).toEqual(['submit', 'button']);
  });

  it('should search and close the dialog when the dialog form is submitted', async () => {
    const modalTrigger = (fixture.nativeElement as HTMLElement).querySelectorAll('form.navbar-form button')[1] as HTMLButtonElement;
    modalTrigger.click();
    await render();

    const modalForm = document.querySelector('modal-container form.form-horizontal') as HTMLFormElement;
    expect(modalForm).not.toBeNull();
    // the Search button of the footer is the only submit button of the dialog form
    const submits = Array.from(modalForm.querySelectorAll('button')).filter((b) => b.type === 'submit');
    expect(submits.length).toBe(1);
    expect(submits[0].closest('.modal-footer')).not.toBeNull();
    expect(modalForm.querySelector('input.search-text').getAttribute('enterkeyhint')).toBe('search');

    const hide = vi.spyOn(fixture.componentInstance, 'hideSearchModal');
    modalForm.dispatchEvent(new Event('submit', {cancelable: true}));
    await render();

    expect(hide).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
