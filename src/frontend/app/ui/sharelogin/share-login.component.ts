import {Component, ElementRef, type OnInit, ChangeDetectionStrategy, ViewChild} from '@angular/core';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ErrorCodes} from '../../../../common/entities/Error';
import {Config} from '../../../../common/config/public/Config';
import {NavigationService} from '../../model/navigation.service';
import {ShareService} from '../gallery/share.service';
import { LanguageComponent } from '../language/language.component';
import { IconComponent } from '../../icon.component';
import { AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIconComponent } from '@ng-icons/core';

@Component({
    selector: 'app-share-login',
    templateUrl: './share-login.component.html',
    styleUrls: ['./share-login.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
    LanguageComponent,
    IconComponent,
    FormsModule,
    NgIconComponent,
    AsyncPipe
]
})
export class ShareLoginComponent implements OnInit {
  @ViewChild('passwordInput') passwordInput: ElementRef<HTMLInputElement>;
  password: string;
  loginError = false;
  inProgress = false;
  title: string;

  constructor(
      public shareService: ShareService,
      private authService: AuthenticationService,
      private navigation: NavigationService
  ) {
    this.title = Config.Server.applicationTitle;
  }

  ngOnInit(): void {
    const usedKey = this.authService.user.value?.usedSharingKey;
    if (this.authService.isAuthenticated() && (!usedKey || usedKey === this.shareService.getSharingKey())) {
      this.navigation.toGallery();
    }
  }

  async onLogin(): Promise<void> {
    this.loginError = false;

    this.inProgress = true;
    try {
      await this.authService.shareLogin(this.password);
    } catch (error) {
      if (
          (error && error.code === ErrorCodes.CREDENTIAL_NOT_FOUND) ||
          error === 'Unauthorized'
      ) {
        if (await this.shareService.reloadPublicSharing()) {
          this.loginError = true;
          // a fresh start for the next try
          this.password = '';
          this.passwordInput?.nativeElement.focus();
        } else {
          await this.navigation.toShareProblem(this.shareService.sharingIsValid.value !== false);
        }
      }
    }

    this.inProgress = false;
  }
}

