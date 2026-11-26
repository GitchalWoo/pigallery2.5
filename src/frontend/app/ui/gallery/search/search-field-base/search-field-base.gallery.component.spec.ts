import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {GallerySearchFieldBaseComponent} from './search-field-base.gallery.component';
import {AutoCompleteService} from '../autocomplete.service';
import {AutoCompleteRenderItem} from '../AutoCompleteRenderItem';
import {SearchQueryTypes} from '../../../../../../common/entities/SearchQueryDTO';

describe('GallerySearchFieldBaseComponent - Enter key hint', () => {

  const setUp = async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])]
    });
    TestBed.overrideComponent(GallerySearchFieldBaseComponent, {
      set: {providers: [{provide: AutoCompleteService, useValue: {}}]}
    });
    const fixture = TestBed.createComponent(GallerySearchFieldBaseComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input.search-text') as HTMLInputElement;
    return {fixture, input};
  };

  // the settings and the random link use the field too, where Enter does not search
  it('should not show a search key on phone keyboards by default', async () => {
    const {input} = await setUp();

    expect(input.hasAttribute('enterkeyhint')).toBe(false);
  });

  it('should show a search key on phone keyboards where Enter searches', async () => {
    const {fixture, input} = await setUp();

    fixture.componentRef.setInput('enterKeyHint', 'search');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(input.getAttribute('enterkeyhint')).toBe('search');
  });
});

describe('GallerySearchFieldBaseComponent - autocomplete accessibility', () => {

  const create = () => {
    const fixture = TestBed.createComponent(GallerySearchFieldBaseComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {fixture, el, input: el.querySelector('input.search-text') as HTMLInputElement};
  };
  const showSuggestions = (fixture: ReturnType<typeof create>['fixture']) => {
    fixture.componentInstance.autoCompleteRenders = [
      new AutoCompleteRenderItem('Alice', 'al', SearchQueryTypes.person, 'person:Alice'),
      new AutoCompleteRenderItem('Albania', 'al', SearchQueryTypes.position, 'position:Albania'),
    ];
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])]
    });
    TestBed.overrideComponent(GallerySearchFieldBaseComponent, {
      set: {providers: [{provide: AutoCompleteService, useValue: {}}]}
    });
  });

  it('should be a collapsed combobox without suggestions', () => {
    const {el, input} = create();

    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  it('should point the combobox at the suggestion list', () => {
    const {fixture, el, input} = create();
    showSuggestions(fixture);

    const list = el.querySelector('[role="listbox"]') as HTMLElement;
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(list.id).toBeTruthy();
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(list.querySelectorAll('[role="option"]').length).toBe(2);
  });

  it('should mark the highlighted suggestion as selected', () => {
    const {fixture, el} = create();
    showSuggestions(fixture);

    const options = Array.from(el.querySelectorAll('[role="option"]'));
    expect(options.map(o => o.getAttribute('aria-selected'))).toEqual(['false', 'false']);

    options[0].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(options.map(o => o.getAttribute('aria-selected'))).toEqual(['true', 'false']);

    options[1].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(options.map(o => o.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  // the navbar and the search modal can show a search field at the same time
  it('should give every field its own list id', () => {
    const a = create();
    const b = create();

    expect(a.input.getAttribute('aria-controls')).not.toBe(b.input.getAttribute('aria-controls'));
  });
});
