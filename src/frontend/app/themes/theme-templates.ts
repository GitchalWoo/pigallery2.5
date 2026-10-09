import {type Type} from '@angular/core';
import {Config} from '../../../common/config/public/Config';

type TemplateLoader = () => Promise<Type<unknown>>;

// Page overrides are compiled Angular components, owned by the theme.
// A theme without an override continues to use the original page.
const themeTemplates: Record<string, {login: TemplateLoader}> = {
  prism: {
    login: () => import('./prism/login/prism-login.component').then(m => m.PrismLoginComponent)
  }
};

export function loadLoginComponent(): Promise<Type<unknown>> {
  const override = Config.Gallery.Themes.enabled
    ? themeTemplates[Config.Gallery.Themes.selectedTheme]?.login
    : undefined;
  return override ? override() : import('../ui/login/login.component').then(m => m.LoginComponent);
}
