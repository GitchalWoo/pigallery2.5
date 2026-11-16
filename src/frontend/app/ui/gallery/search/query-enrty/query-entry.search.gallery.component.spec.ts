import {GallerySearchQueryEntryComponent} from './query-entry.search.gallery.component';
import {
  type RangeSearch,
  type SearchQueryDTO,
  SearchQueryTypes,
  type TextSearch,
  TextSearchQueryMatchTypes
} from '../../../../../../common/entities/SearchQueryDTO';

describe('GallerySearchQueryEntryComponent match types', () => {
  // only the getters and setters are tested, they need no injected services
  const entry = (queryEntry: SearchQueryDTO): GallerySearchQueryEntryComponent => {
    const c = Object.create(GallerySearchQueryEntryComponent.prototype) as GallerySearchQueryEntryComponent;
    c.queryEntry = queryEntry;
    return c;
  };

  it('shows = and != for a range search', () => {
    const c = entry({type: SearchQueryTypes.rating, min: 1, max: 2} as RangeSearch);
    expect(c.MatchingTypes).toEqual(['=', '!=']);
    expect(c.SelectedMatchType).toBe('=');
    c.SelectedMatchType = '!=';
    expect((c.queryEntry as RangeSearch).negate).toBe(true);
    expect(c.SelectedMatchType).toBe('!=');
  });

  it('offers no negation for orientation', () => {
    const c = entry({type: SearchQueryTypes.orientation, landscape: true} as SearchQueryDTO);
    expect(c.MatchingTypes).toEqual(['=']);
    expect(c.SelectedMatchType).toBe('=');
  });

  it('keeps the text match types', () => {
    const c = entry({type: SearchQueryTypes.any_text, value: 'a', matchType: TextSearchQueryMatchTypes.globMatch} as TextSearch);
    expect(c.SelectedMatchType).toBe('glob');
    c.SelectedMatchType = '!=';
    expect((c.queryEntry as TextSearch).matchType).toBe(TextSearchQueryMatchTypes.exact_match);
    expect((c.queryEntry as TextSearch).negate).toBe(true);
  });
});
