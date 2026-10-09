import {ChangeDetectionStrategy, Component} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {NgIconComponent} from '@ng-icons/core';
import {IconComponent} from '../../../icon.component';
import {LanguageComponent} from '../../../ui/language/language.component';
import {LoginComponent} from '../../../ui/login/login.component';

/** Prism replaces the template while inheriting the original login behavior. */
@Component({
  selector: 'app-login',
  templateUrl: './prism-login.component.html',
  styleUrls: ['../../../ui/login/login.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [LanguageComponent, IconComponent, FormsModule, NgIconComponent]
})
export class PrismLoginComponent extends LoginComponent {}
