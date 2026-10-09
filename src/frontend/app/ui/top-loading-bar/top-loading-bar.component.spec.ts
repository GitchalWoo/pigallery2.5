import {ComponentFixture, TestBed} from '@angular/core/testing';
import {TopLoadingBarComponent} from './top-loading-bar.component';
import {LoadingBarService} from '../../model/loading-bar.service';

describe('TopLoadingBarComponent', () => {
  let component: TopLoadingBarComponent;
  let fixture: ComponentFixture<TopLoadingBarComponent>;
  let loadingBarService: LoadingBarService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopLoadingBarComponent],
      providers: [LoadingBarService]
    }).compileComponents();

    loadingBarService = TestBed.inject(LoadingBarService);
    fixture = TestBed.createComponent(TopLoadingBarComponent);
    component = fixture.componentInstance;
  });

  it('should not render progressbar when idle', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.top-loading-bar');
    expect(el).toBeNull();
  });

  it('should render progressbar with accessibility attributes when loading', () => {
    loadingBarService.start();
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.top-loading-bar');
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-label')).toBe('Loading');
  });

  it('should hide progressbar when loading completes', () => {
    loadingBarService.start();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.top-loading-bar')).not.toBeNull();

    loadingBarService.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.top-loading-bar')).toBeNull();
  });

  it('should respect suppressed input even when service is loading', () => {
    loadingBarService.start();
    component.suppressed = true;
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.top-loading-bar');
    expect(el).toBeNull();
  });

  it('should support explicit active input override', () => {
    component.active = true;
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.top-loading-bar');
    expect(el).not.toBeNull();

    component.active = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.top-loading-bar')).toBeNull();
  });

  it('should apply custom zIndex when provided', () => {
    loadingBarService.start();
    component.zIndex = 10000;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement.querySelector('.top-loading-bar');
    expect(el).not.toBeNull();
    expect(el.style.zIndex).toBe('10000');
  });
});

