import {Component, type OnDestroy, type OnInit, ChangeDetectionStrategy} from '@angular/core';
import {AuthenticationService} from './model/network/authentication.service';
import {Config} from '../../common/config/public/Config';
import {Title} from '@angular/platform-browser';
import {ShareService} from './ui/gallery/share.service';
import {skip, Subscription} from 'rxjs';
import {NavigationService} from './model/navigation.service';
import {ThemeService} from './model/theme.service';
import { RouterOutlet } from '@angular/router';

@Component({
    selector: 'app-pi-gallery2',
    template: `
    <router-outlet></router-outlet>`,
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [RouterOutlet]
})
export class AppComponent implements OnInit, OnDestroy {
  private subscription: Subscription = null;

  constructor(
    private authenticationService: AuthenticationService,
    private shareService: ShareService,
    private navigation: NavigationService,
    private title: Title,
    // injected so the theme is applied on start (its constructor initializes it)
    private themeService: ThemeService
  ) {
  }

  async ngOnInit(): Promise<void> {
    this.title.setTitle(Config.Server.applicationTitle);
    await this.shareService.wait();
    // The share guard handles the first unauthenticated entry, before Router has committed the URL.
    const guardHandlesEntry = this.shareService.isSharing() && !this.authenticationService.isAuthenticated();
    this.subscription = this.authenticationService.user.pipe(skip(guardHandlesEntry ? 1 : 0)).subscribe(() => {
      if(this.navigation.isErrorPage()){ //stay on the error page, do not auto navigate
        return;
      }
      if (this.authenticationService.isAuthenticated()) {
        if (this.navigation.isLoginPage()) {
          return this.navigation.toAfterLogin();
        }
      } else {
        // before the first page, the guards send the user to the login page (with the url they opened)
        if (!this.navigation.isLoginPage() && this.navigation.hasNavigated()) {
          // the session ended (e.g. the user was deleted): the login takes the user back to this page; not after logging out
          return this.navigation.toLogin(this.authenticationService.loggedOutByUser ? undefined : this.navigation.url());
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.subscription != null) {
      this.subscription.unsubscribe();
    }
  }

}
