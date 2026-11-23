import {Component, ElementRef, type OnInit, ChangeDetectionStrategy, ViewChild} from '@angular/core';
import {LoginCredential} from '../../../../common/entities/LoginCredential';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ErrorCodes} from '../../../../common/entities/Error';
import {Config} from '../../../../common/config/public/Config';
import {NavigationService} from '../../model/navigation.service';
import {LanguageComponent} from '../language/language.component';
import {IconComponent} from '../../icon.component';
import {FormsModule} from '@angular/forms';
import {NgIconComponent} from '@ng-icons/core';


@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    LanguageComponent,
    IconComponent,
    FormsModule,
    NgIconComponent
]
})
export class LoginComponent implements OnInit {
  @ViewChild('passwordInput') passwordInput: ElementRef<HTMLInputElement>;
  loginCredential: LoginCredential;
  loginError = false;
  title: string;
  inProgress = false;
  oidcEnabled = false;
  oidcDisplayName = 'OpenID login';

  constructor(
    private authService: AuthenticationService,
    private navigation: NavigationService
  ) {
    this.loginCredential = new LoginCredential();
    this.title = Config.Server.applicationTitle;
    this.oidcEnabled = !!Config.Users.oidc?.enabled;
    this.oidcDisplayName = Config.Users.oidc?.displayName || 'OpenID login';
  }

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.navigation.toAfterLogin().catch(console.error);
    }
  }

  async onLogin(): Promise<void> {
    this.loginError = false;

    this.inProgress = true;
    try {
      await this.authService.login(this.loginCredential);
    } catch (error) {
      if (error && error.code === ErrorCodes.CREDENTIAL_NOT_FOUND) {
        this.loginError = true;
        // a fresh start for the next try
        this.loginCredential.password = '';
        this.passwordInput?.nativeElement.focus();
      }
    }

    this.inProgress = false;
  }

  get oidcLoginUrl(): string {
    return Config.Server.getApiUrl('/auth/oidc/login');
  }

  onLoginWithOIDC(): void {
    if (!this.oidcEnabled) {
      return;
    }
    // the provider sends the browser back to the app, not to this page: keep the url to return to
    this.navigation.rememberReturnUrl();
    this.openProvider(this.oidcLoginUrl);
  }

  // leaves the app for the OIDC provider
  openProvider(url: string): void {
    window.location.href = url;
  }
}

