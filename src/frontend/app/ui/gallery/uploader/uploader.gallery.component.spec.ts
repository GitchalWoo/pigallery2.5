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
