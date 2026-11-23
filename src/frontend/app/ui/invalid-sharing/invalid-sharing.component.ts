import {ChangeDetectionStrategy, Component} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {Config} from '../../../../common/config/public/Config';
import {IconComponent} from '../../icon.component';
import {NavigationService} from '../../model/navigation.service';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ShareService} from '../gallery/share.service';

@Component({
  selector: 'app-invalid-sharing',
  templateUrl: './invalid-sharing.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [IconComponent],
})
export class InvalidSharingComponent {
  readonly title = Config.Server.applicationTitle;

  constructor(
    private route: ActivatedRoute,
    private authentication: AuthenticationService,
    private sharing: ShareService,
    private navigation: NavigationService
  ) {}

  get retry(): boolean {
    return this.route.snapshot.queryParamMap.get('retry') === '1';
  }

  get currentUrl(): string {
    return window.location.href;
  }

  get canOpenGallery(): boolean {
    const user = this.authentication.user.value;
    return !!user && !user.usedSharingKey;
  }

  openGallery(): void {
    this.sharing.dropSharing();
    this.navigation.toDefault().catch(console.error);
  }
}
