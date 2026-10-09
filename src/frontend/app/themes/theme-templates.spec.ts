import {afterEach, describe, expect, it} from 'vitest';
import {Config} from '../../../common/config/public/Config';
import {LoginComponent} from '../ui/login/login.component';
import {PrismLoginComponent} from './prism/login/prism-login.component';
import {loadLoginComponent} from './theme-templates';

describe('Theme page overrides', () => {
  const originalName = Config.Gallery.Themes.selectedTheme;
  const originalEnabled = Config.Gallery.Themes.enabled;

  afterEach(() => {
    Config.Gallery.Themes.selectedTheme = originalName;
    Config.Gallery.Themes.enabled = originalEnabled;
  });

  it('replaces login with the Prism page when selected', async () => {
    Config.Gallery.Themes.enabled = true;
    Config.Gallery.Themes.selectedTheme = 'prism';
    expect(await loadLoginComponent()).toBe(PrismLoginComponent);
    expect(PrismLoginComponent.prototype.onLogin).toBe(LoginComponent.prototype.onLogin);
    expect(PrismLoginComponent.prototype.onLoginWithOIDC).toBe(LoginComponent.prototype.onLoginWithOIDC);
  });

  it.each(['classic', 'default', 'custom'])('keeps the original login for %s', async name => {
    Config.Gallery.Themes.enabled = true;
    Config.Gallery.Themes.selectedTheme = name;
    expect(await loadLoginComponent()).toBe(LoginComponent);
  });

  it('keeps the original login when themes are disabled', async () => {
    Config.Gallery.Themes.enabled = false;
    Config.Gallery.Themes.selectedTheme = 'prism';
    expect(await loadLoginComponent()).toBe(LoginComponent);
  });
});
