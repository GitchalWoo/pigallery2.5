import {ComponentFixture, TestBed} from '@angular/core/testing';
import {signal} from '@angular/core';
import {provideIcons} from '@ng-icons/core';
import {ionAlertCircle, ionCheckmarkCircle, ionChevronDownOutline, ionChevronUpOutline, ionCloudUploadOutline} from '@ng-icons/ionicons';
import {UploaderComponent} from './uploader.gallery.component';
import {UploaderService, UploadProgress} from './uploader.service';

class MockUploaderService {
  readonly uploadProgressSignal = signal<UploadProgress[]>([]);
  dismiss = vi.fn((item: UploadProgress) => this.uploadProgressSignal.update((l) => l.filter((i) => i !== item)));

  get uploadProgress(): UploadProgress[] {
    return this.uploadProgressSignal();
  }
}

describe('UploaderComponent', () => {
  let fixture: ComponentFixture<UploaderComponent>;
  let service: MockUploaderService;

  const failed = (name: string, onRetry?: () => void): UploadProgress => ({
    name, progress: 100, done: true, status: 'error', error: 'Unknown Error',
    // long ago: an error is shown until it is closed, not only for a few seconds
    lastUpdate: Date.now() - 60000,
    onRetry
  });
  const card = (): HTMLElement => fixture.nativeElement.querySelector('.upload-progress-item');

  beforeEach(async () => {
    service = new MockUploaderService();
    await TestBed.configureTestingModule({
      imports: [UploaderComponent],
      providers: [
        {provide: UploaderService, useValue: service},
        provideIcons({ionAlertCircle, ionCheckmarkCircle, ionChevronDownOutline, ionChevronUpOutline, ionCloudUploadOutline})
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(UploaderComponent);
  });

  it('should keep showing a failed file and call its retry action', () => {
    const onRetry = vi.fn();
    service.uploadProgressSignal.set([failed('beach.jpg', onRetry)]);
    fixture.detectChanges();
    expect(card().textContent).toContain('beach.jpg');
    (card().querySelector('.upload-retry') as HTMLElement).click();
    expect(onRetry).toHaveBeenCalled();
  });

  it('should not offer a retry when it would fail the same way', () => {
    service.uploadProgressSignal.set([failed('beach.jpg')]);
    fixture.detectChanges();
    expect(card().querySelector('.upload-retry')).toBeNull();
  });

  it('should close a failed file', () => {
    const item = failed('beach.jpg');
    service.uploadProgressSignal.set([item]);
    fixture.detectChanges();
    (card().querySelector('.upload-dismiss') as HTMLElement).click();
    fixture.detectChanges();
    expect(service.dismiss).toHaveBeenCalledWith(item);
    expect(card()).toBeNull();
  });
});

describe('UploaderComponent - summary card', () => {
  let fixture: ComponentFixture<UploaderComponent>;
  let service: MockUploaderService;

  const running = (name: string): UploadProgress => ({
    name, progress: 10, done: false, status: 'uploading', lastUpdate: Date.now()
  });
  const summary = (): HTMLElement => fixture.nativeElement.querySelector('.summary-card');

  beforeEach(async () => {
    service = new MockUploaderService();
    await TestBed.configureTestingModule({
      imports: [UploaderComponent],
      providers: [
        {provide: UploaderService, useValue: service},
        provideIcons({ionAlertCircle, ionCheckmarkCircle, ionChevronDownOutline, ionChevronUpOutline, ionCloudUploadOutline})
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(UploaderComponent);
    // more than five files: a summary card replaces the list
    service.uploadProgressSignal.set(['a', 'b', 'c', 'd', 'e', 'f'].map(n => running(n + '.jpg')));
    fixture.detectChanges();
  });

  it('should be a focusable, collapsed toggle', () => {
    expect(summary().getAttribute('role')).toBe('button');
    expect(summary().getAttribute('tabindex')).toBe('0');
    expect(summary().getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.textContent).not.toContain('a.jpg');
  });

  it('should show and hide the details with Enter', () => {
    summary().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    fixture.detectChanges();
    expect(summary().getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('a.jpg');

    summary().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    fixture.detectChanges();
    expect(summary().getAttribute('aria-expanded')).toBe('false');
  });

  it('should show the details with Space without scrolling the page', () => {
    const space = new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true});
    summary().dispatchEvent(space);
    fixture.detectChanges();
    expect(space.defaultPrevented).toBe(true);
    expect(summary().getAttribute('aria-expanded')).toBe('true');
  });

  it('should still toggle on click', () => {
    summary().click();
    fixture.detectChanges();
    expect(summary().getAttribute('aria-expanded')).toBe('true');
  });
});
