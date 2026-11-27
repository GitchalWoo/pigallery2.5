import {Injectable} from '@angular/core';
import {ToastrService} from 'ngx-toastr';
import {BehaviorSubject} from 'rxjs';
import {NetworkService} from './network/network.service';
import {AuthenticationService} from './network/authentication.service';
import {type NotificationDTO, NotificationType,} from '../../../common/entities/NotificationDTO';
import {type UserDTO, UserRoles} from '../../../common/entities/UserDTO';

export interface CountedNotificationDTO extends NotificationDTO {
  count: number;
}

@Injectable()
export class NotificationService {
  options = {
    positionClass: 'toast-top-center',
    closeButton: true,
    tapToDismiss: false,
  };
  countedNotifications: CountedNotificationDTO[] = [];
  private readonly notificationCount = new BehaviorSubject(0);
  readonly numberOfNotifications = this.notificationCount.asObservable();
  lastUser: UserDTO = null;

  constructor(
      private toastr: ToastrService,
      private networkService: NetworkService,
      private authService: AuthenticationService
  ) {
    this.authService.user.subscribe(() => {
      if (
          this.authService.isAuthenticated() &&
          (!this.lastUser ||
              this.lastUser.id !== this.authService.user.value.id) &&
          this.authService.user.value.role >= UserRoles.User
      ) {
        this.getServerNotifications();
      }
      this.lastUser = this.authService.user.value;
    });
  }

  get Toastr(): ToastrService {
    return this.toastr;
  }

  groupNotifications(notifications: NotificationDTO[]): void {
    const groups = new Map<string, CountedNotificationDTO>();
    notifications.forEach((n) => {
      let key = n.message;
      if (n.details) {
        key += JSON.stringify(n.details);
      }
      groups.set(key, {...n, count: (groups.get(key)?.count ?? 0) + 1});
    });
    this.countedNotifications = Array.from(groups.values());
    this.notificationCount.next(notifications.length);
  }

  /**
   * Makes notification details readable:
   * strings are shown without JSON quoting/escaping, one sentence per line,
   * objects are pretty-printed.
   */
  static formatDetails(details: unknown): string {
    if (typeof details !== 'string') {
      return JSON.stringify(details, null, 2);
    }
    return details
      .replace(/^Error: /, '')
      .replace(/([.!?])\s+(?=[A-Z])/g, '$1\n');
  }

  async getServerNotifications(): Promise<void> {
    try {
      this.groupNotifications(
          (await this.networkService.getJson<NotificationDTO[]>(
              '/notifications'
          )) || []
      );
      // The message is the title, the details go below it, like on the admin page
      this.countedNotifications.forEach((noti) => {
        const title = '(' + noti.count + ') ' + noti.message;
        const details = noti.details ? NotificationService.formatDetails(noti.details) : null;
        switch (noti.type) {
          case NotificationType.error:
            this.error(details, title);
            break;
          case NotificationType.warning:
            this.warning(details, title);
            break;
          case NotificationType.info:
            this.info(details, title);
            break;
        }
      });
    } catch (e) {
      console.error(e);
    }
  }

  success(text: string, title: string = null): void {
    this.toastr.success(text, title, this.options);
  }

  error(text: string, title?: string): void {
    this.toastr.error(text, title, this.options);
  }

  warning(text: string, title?: string): void {
    this.toastr.warning(text, title, this.options);
  }

  info(text: string, title: string = null): void {
    this.toastr.info(text, title, this.options);
  }
}
