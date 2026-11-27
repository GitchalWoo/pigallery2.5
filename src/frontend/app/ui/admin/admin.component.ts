import {type AfterViewInit, Component, ElementRef, type OnInit, QueryList, ViewChildren, ChangeDetectionStrategy} from '@angular/core';
import {NotificationService} from '../../model/notification.service';
import {NotificationType} from '../../../../common/entities/NotificationDTO';
import { ViewportScroller, AsyncPipe, DatePipe } from '@angular/common';
import {ConfigStyle, SettingsService} from '../settings/settings.service';
import {ConfigPriority} from '../../../../common/config/public/ClientConfig';
import {WebConfig} from '../../../../common/config/private/WebConfig';
import {type ISettingsComponent} from '../settings/template/ISettingsComponent';
import {WebConfigClassBuilder} from 'typeconfig/src/decorators/builders/WebConfigClassBuilder';
import {enumToTranslatedArray} from '../EnumTranslations';
import {PiTitleService} from '../../model/pi-title.service';
import { FrameComponent } from '../frame/frame.component';
import { BsDropdownDirective, BsDropdownToggleDirective, BsDropdownMenuDirective } from 'ngx-bootstrap/dropdown';
import { NgIconComponent } from '@ng-icons/core';
import { TemplateComponent } from '../settings/template/template.component';
import { GalleryStatisticComponent } from '../settings/gallery-statistic/gallery-statistic.component';
import { UsersComponent } from '../settings/users/users.component';
import { SharingsListComponent } from '../settings/sharings-list/sharings-list.component';
import { ExtensionInstallerComponent } from '../settings/extension-installer/extension-installer.component';
import { StringifyEnum } from '../../pipes/StringifyEnum';
import { ScheduledJobsService } from '../settings/scheduled-jobs.service';

@Component({
    selector: 'app-admin',
    templateUrl: './admin.component.html',
    styleUrls: ['./admin.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    providers: [SettingsService, ScheduledJobsService],
    imports: [
    FrameComponent,
    BsDropdownDirective,
    BsDropdownToggleDirective,
    BsDropdownMenuDirective,
    NgIconComponent,
    TemplateComponent,
    GalleryStatisticComponent,
    UsersComponent,
    SharingsListComponent,
    ExtensionInstallerComponent,
    AsyncPipe,
    DatePipe,
    StringifyEnum
]
})
export class AdminComponent implements OnInit, AfterViewInit {
  @ViewChildren('setting') settingsComponents: QueryList<ISettingsComponent>;
  @ViewChildren('setting', {read: ElementRef})
  settingsComponentsElemRef: QueryList<ElementRef>;
  contents: ISettingsComponent[] = [];
  configPriorities: { key: number; value: string; }[];
  configStyles: { key: number; value: string; }[];
  public readonly ConfigPriority = ConfigPriority;
  public readonly ConfigStyle = ConfigStyle;
  public readonly configPaths: string[] = [];
  versionDetailsOpen = false;

  constructor(
    public viewportScroller: ViewportScroller,
    public notificationService: NotificationService,
    public settingsService: SettingsService,
    private piTitleService: PiTitleService
  ) {
    this.configPriorities = enumToTranslatedArray(ConfigPriority);
    this.configStyles = enumToTranslatedArray(ConfigStyle);
    const wc = WebConfigClassBuilder.attachPrivateInterface(new WebConfig());
    this.configPaths = Object.keys(wc.State)
        .filter(s => !wc.__state[s].volatile);
  }

  ngAfterViewInit(): void {
    setTimeout(() => (this.contents = this.settingsComponents.toArray()), 0);
  }

  ngOnInit(): void {
    // AdminGuard lets only admins in
    this.piTitleService.setTitle($localize`Admin`);
  }

  versionCommitUrl(commit: string): string | null {
    return /^[0-9a-f]{40}$/i.test(commit) ? `https://github.com/GitchalWoo/pigallery2.5/commit/${commit}` : null;
  }

  leaveVersionArea(area: HTMLElement): void {
    if (!area.contains(document.activeElement)) {
      this.versionDetailsOpen = false;
    }
  }

  leaveVersionFocus(area: HTMLElement, event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node && area.contains(event.relatedTarget)) && !area.matches(':hover')) {
      this.versionDetailsOpen = false;
    }
  }

  closeVersionPopover(trigger: HTMLAnchorElement): void {
    trigger.focus();
    this.versionDetailsOpen = false;
  }

  public getCss(type: NotificationType): string {
    switch (type) {
      case NotificationType.error:
        return 'danger';
      case NotificationType.warning:
        return 'warning';
      case NotificationType.info:
        return 'info';
    }
    return 'info';
  }

  /**
   * Makes notification details readable:
   * strings are shown without JSON quoting/escaping, one sentence per line,
   * objects are pretty-printed.
   */
  public formatDetails(details: unknown): string {
    if (typeof details !== 'string') {
      return JSON.stringify(details, null, 2);
    }
    return details
      .replace(/^Error: /, '')
      .replace(/([.!?])\s+(?=[A-Z])/g, '$1\n');
  }
}



