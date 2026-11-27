import {ViewportScroller} from '@angular/common';
import {Component, CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {NgIconComponent} from '@ng-icons/core';
import {BehaviorSubject} from 'rxjs';
import {NotificationService} from '../../model/notification.service';
import {PiTitleService} from '../../model/pi-title.service';
import {FrameComponent} from '../frame/frame.component';
import {ScheduledJobsService} from '../settings/scheduled-jobs.service';
import {ConfigStyle, SettingsService} from '../settings/settings.service';
import {AdminComponent} from './admin.component';

@Component({selector: 'app-frame', template: '<ng-content></ng-content>'})
class FrameStub {
  readonly shouldHideNavbar = true;
}

describe('AdminComponent build identity popover', () => {
  const hash = '0123456789abcdef0123456789abcdef01234567';
  const repository = 'https://github.com/GitchalWoo/pigallery2.5/';

  function render(commit?: string) {
    const settings = new BehaviorSubject({
      Environment: {appVersion: 'pigallery2.5@01234567', buildCommitHash: commit, appVersionUrl: repository},
    });
    TestBed.configureTestingModule({
      providers: [
        {provide: ViewportScroller, useValue: {}},
        {provide: NotificationService, useValue: {countedNotifications: []}},
        {provide: PiTitleService, useValue: {setTitle: vi.fn()}},
        {provide: SettingsService, useValue: {settings, configPriority: 1, configStyle: ConfigStyle.compact}},
      ],
    }).overrideComponent(AdminComponent, {
      remove: {imports: [FrameComponent, NgIconComponent], providers: [SettingsService, ScheduledJobsService]},
      add: {imports: [FrameStub], schemas: [CUSTOM_ELEMENTS_SCHEMA]},
    });
    const fixture = TestBed.createComponent(AdminComponent);
    fixture.componentInstance.configPaths.length = 0;
    fixture.detectChanges();
    return fixture;
  }

  it('keeps a full commit link accessible when focus moves from the version', async () => {
    const fixture = render(hash);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.version');
    trigger.focus();
    await fixture.whenStable();
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.version-popover a');
    expect(link.href).toBe(repository + 'commit/' + hash);
    link.focus();
    expect(document.activeElement).toBe(link);
    link.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    fixture.detectChanges();
    expect(document.activeElement).toBe(trigger);
    expect((fixture.nativeElement as HTMLElement).querySelector('.version-popover')).toBeNull();
  });

  it('still shows the version when the build has no commit', async () => {
    const fixture = render();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.version-area')
      .dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('.version-popover');
    expect(panel.textContent).toContain('pigallery2.5@01234567');
    expect(panel.querySelector('a')).toBeNull();
  });
});
