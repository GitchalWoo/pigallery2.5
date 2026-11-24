import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {GallerySearchFieldBaseComponent} from './search-field-base.gallery.component';
import {AutoCompleteService} from '../autocomplete.service';

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
