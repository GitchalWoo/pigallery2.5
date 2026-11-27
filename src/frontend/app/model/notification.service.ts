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

  async getServerNotifications(): Promise<void> {
    try {
      this.groupNotifications(
          (await this.networkService.getJson<NotificationDTO[]>(
              '/notifications'
          )) || []
      );
      this.countedNotifications.forEach((noti) => {
        let msg = '(' + noti.count + ') ' + noti.message;
        if (noti.details) {
          msg += ' Details: ' + JSON.stringify(noti.details);
        }
        switch (noti.type) {
          case NotificationType.error:
            this.error(msg, $localize`Server error`);
            break;
          case NotificationType.warning:
            this.warning(msg, $localize`Server error`);
            break;
          case NotificationType.info:
            this.info(msg, $localize`Server info`);
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
