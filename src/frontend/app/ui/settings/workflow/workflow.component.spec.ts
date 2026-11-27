import {ComponentFixture, TestBed} from '@angular/core/testing';
import {NO_ERRORS_SCHEMA} from '@angular/core';
import {AsyncPipe, DatePipe} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {of} from 'rxjs';
import {ModalDirective} from 'ngx-bootstrap/modal';
import {provideIcons} from '@ng-icons/core';
import {
  ionChevronDownOutline,
  ionChevronForwardOutline,
  ionInformationCircleOutline,
  ionTrashOutline,
  ionWarningOutline
} from '@ng-icons/ionicons';
import {WorkflowComponent} from './workflow.component';
import {ScheduledJobsService} from '../scheduled-jobs.service';
import {BackendtextService} from '../../../model/backendtext.service';
import {ConfigStyle, SettingsService} from '../settings.service';
import {JobTriggerType} from '../../../../../common/entities/job/JobScheduleDTO';
import {type JobScheduleConfig} from '../../../../../common/config/private/PrivateConfig';

describe('WorkflowComponent - job details toggle', () => {
  let fixture: ComponentFixture<WorkflowComponent>;

  const toggle = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('.card-header [role="button"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowComponent],
      providers: [
        {
          provide: ScheduledJobsService, useValue: {
            subscribeToProgress: vi.fn(),
            unsubscribeFromProgress: vi.fn(),
            getAvailableMessengers: vi.fn().mockResolvedValue(undefined),
            isValidJob: () => true,
            getConfigTemplate: (): unknown[] => [],
            getProgress: (): null => null,
            progress: of({}),
            availableJobs: of([]),
            availableMessengers: of([]),
          }
        },
        {provide: SettingsService, useValue: {configStyle: ConfigStyle.full}},
        {
          provide: BackendtextService,
          useValue: {getJobName: (n: string) => n, getJobDescription: (): string => null, get: (n: string) => n}
        },
        provideIcons({
          ionChevronDownOutline, ionChevronForwardOutline, ionInformationCircleOutline, ionTrashOutline, ionWarningOutline
        }),
      ],
    })
      // only the template of this component is under test: its child components are left unrendered
      .overrideComponent(WorkflowComponent, {
        set: {imports: [FormsModule, ModalDirective, AsyncPipe, DatePipe], schemas: [NO_ERRORS_SCHEMA]}
      })
      .compileComponents();
    fixture = TestBed.createComponent(WorkflowComponent);
    fixture.componentInstance.writeValue([{
      name: 'Nightly indexing',
      jobName: 'Indexing',
      config: {},
      trigger: {type: JobTriggerType.never},
      allowParallelRun: false,
    } as unknown as JobScheduleConfig]);
    fixture.detectChanges();
  });

  const detailsShown = (): boolean => fixture.componentInstance.showDetails['Nightly indexing'] === true;

  it('should be a focusable, collapsed toggle', () => {
    expect(toggle().textContent).toContain('Nightly indexing');
    expect(toggle().getAttribute('tabindex')).toBe('0');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('should show and hide the details with Enter', () => {
    toggle().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    fixture.detectChanges();
    expect(detailsShown()).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    toggle().dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    fixture.detectChanges();
    expect(detailsShown()).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('should show the details with Space without scrolling the page', () => {
    const space = new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true});
    toggle().dispatchEvent(space);
    fixture.detectChanges();
    expect(space.defaultPrevented).toBe(true);
    expect(detailsShown()).toBe(true);
  });

  it('should still toggle on click', () => {
    toggle().click();
    fixture.detectChanges();
    expect(detailsShown()).toBe(true);
  });
});
