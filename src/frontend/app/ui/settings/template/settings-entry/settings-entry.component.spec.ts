import {describe, expect, it, vi} from 'vitest';
import {SettingsEntryComponent} from './settings-entry.component';
import {ThemeConfig} from '../../../../../../common/config/public/ClientConfig';
import {PRISM_THEME} from '../../../../../../common/config/public/PrismTheme';

describe('Prism selection in saved theme configurations', () => {
  const setup = (themes: ThemeConfig[]) => {
    const component = new SettingsEntryComponent(null, null, null);
    component.state = {
      rootConfig: {__state: {availableThemes: {value: themes, arrayType: ThemeConfig}}}
    } as any;
    component.onChange = vi.fn();
    return component;
  };

  it('offers Prism without modifying an older saved list until selected', () => {
    const custom = new ThemeConfig('custom', ':root { --bs-primary: coral; }');
    const themes = [custom];
    const component = setup(themes);
    expect(component.AvailableThemes.map(theme => theme.key)).toContain('prism');
    expect(themes).toEqual([custom]);
    component.selectTheme('prism');
    expect(themes.map(theme => theme.name)).toEqual(['custom', 'prism']);
    expect(themes[1].theme).toBe(PRISM_THEME);
    expect(themes[0]).toBe(custom);
    expect(component.onChange).toHaveBeenCalledWith('prism');
  });

  it('keeps an existing customized Prism definition and does not duplicate it', () => {
    const themes = [new ThemeConfig('prism', '')];
    const component = setup(themes);
    component.selectTheme('prism');
    component.selectTheme('prism');
    expect(themes).toHaveLength(1);
    expect(themes[0].theme).toBe('');
    expect(component.AvailableThemes.filter(theme => theme.key === 'prism')).toHaveLength(1);
  });

  it('leaves the saved theme list untouched when selecting default', () => {
    const themes: ThemeConfig[] = [];
    const component = setup(themes);
    component.selectTheme('default');
    expect(themes).toHaveLength(0);
    expect(component.onChange).toHaveBeenCalledWith('default');
  });

  it('handles theme controls before settings state is bound', () => {
    const component = new SettingsEntryComponent(null, null, null);
    component.onChange = vi.fn();
    expect(component.AvailableThemes.map(theme => theme.key)).toEqual(['default', 'prism']);
    expect(component.SelectedThemeSettings).toEqual({theme: 'N/A'});
    component.selectTheme('prism');
    expect(component.onChange).not.toHaveBeenCalled();
    component.state = {rootConfig: {}} as any;
    expect(() => component.selectTheme('prism')).not.toThrow();
    expect(component.AvailableThemes.map(theme => theme.key)).toEqual(['default', 'prism']);
  });

  it('initializes a missing theme list when its settings entry is present', () => {
    const component = setup(undefined);
    component.selectTheme('prism');
    expect((component.state.rootConfig as any).__state.availableThemes.value[0].theme).toBe(PRISM_THEME);
    expect(component.onChange).toHaveBeenCalledWith('prism');
  });

});
