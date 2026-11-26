import {ComponentFixture, TestBed} from '@angular/core/testing';
import {BehaviorSubject} from 'rxjs';
import {provideIcons} from '@ng-icons/core';
import {ionFlagOutline} from '@ng-icons/ionicons';
import {GalleryFilterComponent} from './filter.gallery.component';
import {type FilterOption, FilterService} from './filter.service';

describe('GalleryFilterComponent - filter options', () => {
  let fixture: ComponentFixture<GalleryFilterComponent>;
  let options: FilterOption[];
  let onFilterChange: ReturnType<typeof vi.fn>;

  const optionItems = (): HTMLElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li.filter-option'));

  beforeEach(async () => {
    options = [
      {name: 'Alice', count: 3, selected: true},
      {name: 'Bob', count: 1, selected: true},
    ];
    const filter = {name: 'Faces', mapFn: (): string[] => [], renderType: 1, isArrayValue: true};
    onFilterChange = vi.fn();
    const filterService = {
      AVAILABLE_FILTERS: [filter],
      statistic: [] as unknown[],
      activeFilters: new BehaviorSubject({
        filtersVisible: true,
        areFiltersActive: false,
        dateFilter: {minDate: 0, maxDate: 100, minFilter: Number.MIN_VALUE, maxFilter: Number.MAX_VALUE},
        selectedFilters: [{filter, options}],
      }),
      onFilterChange,
      setShowingFilters: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [GalleryFilterComponent],
      providers: [
        {provide: FilterService, useValue: filterService},
        provideIcons({ionFlagOutline}),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GalleryFilterComponent);
    fixture.detectChanges();
  });

  it('should expose the options as focusable checkboxes', () => {
    const items = optionItems();
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.getAttribute('role')).toBe('checkbox');
      expect(item.getAttribute('tabindex')).toBe('0');
      expect(item.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('should toggle an option on click', () => {
    optionItems()[0].click();
    fixture.detectChanges();
    expect(options[0].selected).toBe(false);
    expect(optionItems()[0].getAttribute('aria-checked')).toBe('false');
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it('should toggle an option with Enter', () => {
    optionItems()[1].dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    fixture.detectChanges();
    expect(options[1].selected).toBe(false);
    expect(optionItems()[1].getAttribute('aria-checked')).toBe('false');
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it('should toggle an option with Space without scrolling the page', () => {
    const space = new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true});
    optionItems()[0].dispatchEvent(space);
    fixture.detectChanges();
    expect(space.defaultPrevented).toBe(true);
    expect(options[0].selected).toBe(false);

    optionItems()[0].dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true}));
    fixture.detectChanges();
    expect(options[0].selected).toBe(true);
    expect(optionItems()[0].getAttribute('aria-checked')).toBe('true');
    expect(onFilterChange).toHaveBeenCalledTimes(2);
  });

  it('should leave the other options alone when the pin selects only one', () => {
    (optionItems()[0].querySelector('.pin') as HTMLElement).click();
    fixture.detectChanges();
    expect(options.map(o => o.selected)).toEqual([true, false]);
    // the pin stops the click, so the option itself does not toggle as well
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });
});
