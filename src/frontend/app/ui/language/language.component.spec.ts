import {Router} from '@angular/router';
import {type CookieService} from 'ngx-cookie-service';
import {LanguageComponent} from './language.component';
import {Config} from '../../../../common/config/public/Config';

describe('LanguageComponent', () => {
  const oldUrlBase = Config.Server.urlBase;
  const oldLanguages = Config.Server.languages;

  beforeEach(() => {
    Config.Server.languages = ['en', 'hu', 'de'];
  });

  afterEach(() => {
    Config.Server.urlBase = oldUrlBase;
    Config.Server.languages = oldLanguages;
  });

  const create = (url: string): LanguageComponent =>
    new LanguageComponent({get: (): string => 'en'} as unknown as CookieService, {url} as Router);

  it('links every language to the page that is open', () => {
    Config.Server.urlBase = '';
    expect(create('/faces').getLanguageUrl('hu')).toBe('/hu/faces');
    expect(create('/gallery/Trips%2F2026?p=a.jpg').getLanguageUrl('hu')).toBe('/hu/gallery/Trips%2F2026?p=a.jpg');
  });

  it('keeps the application prefix', () => {
    Config.Server.urlBase = 'photos';
    expect(create('/albums').getLanguageUrl('de')).toBe('/photos/de/albums');
  });
});
