import {Config} from '../../../common/config/public/Config';
import {ThemeModes} from '../../../common/config/public/ClientConfig';
import {type GalleryCacheService} from '../ui/gallery/cache.gallery.service';
import {ThemeService} from './theme.service';

describe('ThemeService phone metadata', () => {
  const meta = document.createElement('meta');
  const documentStyles = document.createElement('style');
  const oldEnabled = Config.Gallery.Themes.enabled;
  const oldDesign = document.documentElement.getAttribute('data-gallery-design');
  const oldMode = document.documentElement.getAttribute('data-bs-theme');

  beforeEach(() => {
    meta.name = 'theme-color';
    meta.content = '#000000';
    documentStyles.textContent = `
      html[data-gallery-design="legacy"] body { background-color: rgb(255, 255, 255); }
      html[data-gallery-design="prism"] body { background-color: rgb(236, 241, 250); }
      html[data-bs-theme="dark"] body { background-color: rgb(25, 27, 31); }
    `;
    document.head.append(meta, documentStyles);
    Config.Gallery.Themes.enabled = true;
  });

  afterEach(() => {
    meta.remove();
    documentStyles.remove();
    Config.Gallery.Themes.enabled = oldEnabled;
    for (const [attribute, value] of [['data-gallery-design', oldDesign], ['data-bs-theme', oldMode]]) {
      if (value === null) {
        document.documentElement.removeAttribute(attribute);
      } else {
        document.documentElement.setAttribute(attribute, value);
      }
    }
  });

  const createService = (): ThemeService => new ThemeService({
    getThemeMode: () => ThemeModes.light,
    setThemeMode: vi.fn(),
  } as unknown as GalleryCacheService);

  it.each([['legacy', 'rgb(255, 255, 255)'], ['prism', 'rgb(236, 241, 250)']])(
    'uses the visible %s background as light and dark modes change', (design, light) => {
      document.documentElement.setAttribute('data-gallery-design', design);
      const service = createService();
      expect(meta.content).toBe(light);
      service.setMode(ThemeModes.dark);
      expect(meta.content).toBe('rgb(25, 27, 31)');
      service.setMode(ThemeModes.light);
      expect(meta.content).toBe(light);
    }
  );

  it('keeps the fallback when the page background is transparent', () => {
    documentStyles.textContent = 'body { background-color: transparent; }';
    createService();
    expect(meta.content).toBe('#000000');
  });
});
