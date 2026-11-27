import {Component, ViewChild, ChangeDetectionStrategy} from '@angular/core';
import {Config} from '../../../../common/config/public/Config';
import {CookieNames} from '../../../../common/CookieNames';
import {CookieService} from 'ngx-cookie-service';
import { BsDropdownDirective, BsDropdownToggleDirective, BsDropdownMenuDirective } from 'ngx-bootstrap/dropdown';

import { NgIconComponent } from '@ng-icons/core';
import {Router} from '@angular/router';

@Component({
    selector: 'app-language',
    templateUrl: './language.component.html',
    styleUrls: ['./language.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
    BsDropdownDirective,
    BsDropdownToggleDirective,
    NgIconComponent,
    BsDropdownMenuDirective
]
})
export class LanguageComponent {
  languages: string[] = [];
  current: string = null;
  // the server sets the language and redirects back to the current page
  getLanguageUrl(language: string): string {
    return Config.Server.getAppUrl(language, this.router.url);
  }

  @ViewChild('dropdown', {static: true}) dropdown: BsDropdownDirective;

  constructor(private cookieService: CookieService, private router: Router) {
    this.languages = Config.Server.languages.sort();
    if (this.cookieService.get(CookieNames.lang) != null) {
      this.current = this.cookieService.get(CookieNames.lang);
    }
  }
}

