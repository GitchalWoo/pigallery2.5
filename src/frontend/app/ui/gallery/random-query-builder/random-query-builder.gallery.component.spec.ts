import {RandomQueryBuilderGalleryComponent} from './random-query-builder.gallery.component';
import {SearchQueryTypes, TextSearchQueryMatchTypes, type TextSearch} from '../../../../../common/entities/SearchQueryDTO';
import {type ContentWrapper} from '../../../../../common/entities/ContentWrapper';

// #1313: the random link starts with the photos on the screen
describe('RandomQueryBuilderGalleryComponent.getShownQuery', () => {
  it('uses the query of the opened search', () => {
    const searchQuery = {type: SearchQueryTypes.any_text, value: 'sunset'} as TextSearch;
    const content = {searchResult: {searchQuery}} as unknown as ContentWrapper;
    expect(RandomQueryBuilderGalleryComponent.getShownQuery(content)).toBe(searchQuery);
  });

  it('uses the opened folder as an exact directory search', () => {
    const content = {directory: {path: 'trips/', name: '2024'}} as unknown as ContentWrapper;
    expect(RandomQueryBuilderGalleryComponent.getShownQuery(content)).toEqual({
      type: SearchQueryTypes.directory,
      matchType: TextSearchQueryMatchTypes.exact_match,
      value: 'trips/2024'
    });
  });

  it('is disabled without a folder or a search', () => {
    expect(RandomQueryBuilderGalleryComponent.getShownQuery(null)).toBeNull();
    expect(RandomQueryBuilderGalleryComponent.getShownQuery({} as ContentWrapper)).toBeNull();
  });
});
