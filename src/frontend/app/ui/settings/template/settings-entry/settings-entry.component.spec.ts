import {UserRoles} from '../../../../../../common/entities/UserDTO';
import type {AuthenticationService} from '../../../../model/network/authentication.service';
import {describe, expect, it, vi} from 'vitest';
import {SettingsEntryComponent} from './settings-entry.component';
import {ThemeConfig} from '../../../../../../common/config/public/ClientConfig';
import {PRISM_THEME} from '../../../../../../common/config/public/PrismTheme';

describe('Prism selection in saved theme configurations', () => {
  const setup = (themes: ThemeConfig[]) => {
    const component = new SettingsEntryComponent(null, null, null, null);
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
    const component = new SettingsEntryComponent(null, null, null, null);
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

describe('role settings', () => {
  it('limits even cached role options to the current user', () => {
    let role = UserRoles.Admin;
    const auth = {isAuthorized: (required: UserRoles) => role >= required};
    const component = new SettingsEntryComponent(null, null, null, auth as AuthenticationService);
    const state = {isEnumType: true, type: UserRoles, tags: {uiOptions: [UserRoles.Admin, UserRoles.Developer]}} as any;
    expect(component.getOptionsView(state).map(option => option.key)).toEqual([UserRoles.Admin]);
    role = UserRoles.Developer;
    expect(component.getOptionsView(state).map(option => option.key)).toEqual([UserRoles.Admin, UserRoles.Developer]);
  });
});

// #1315: the limits of a number setting are shown on its field and the form can't be saved out of them
describe('number setting limits', () => {
  const setup = (value: number, limits: { min?: number, max?: number } = {min: 8, max: 64}) => {
    const component = new SettingsEntryComponent(null, null, null, null);
    component.writeValue({type: 'unsignedInt', value, default: 16, ...limits} as any);
    return component;
  };

  it('accepts a value inside the limits', () => {
    const component = setup(16);
    expect(component.validate()).toBeNull();
    expect(component.rangeError).toBeNull();
  });

  it('does not accept a value above the limits', () => {
    const component = setup(200);
    expect(component.validate()).toEqual({max: {max: 64, actual: 200}});
    expect(component.rangeError).toBe('The value must be between 8 and 64.');
  });

  it('does not accept a value below the limits', () => {
    expect(setup(4).validate()).toEqual({min: {min: 8, actual: 4}});
  });

  it('names the only limit there is', () => {
    expect(setup(-1, {min: 0}).rangeError).toBe('The value must be at least 0.');
    expect(setup(11, {max: 10}).rangeError).toBe('The value must be at most 10.');
  });

  it('shows the limits while typing and hides them once the value is inside again', () => {
    const component = setup(16);
    component.StringValue = '200';
    expect(component.rangeError).toBe('The value must be between 8 and 64.');
    expect(component.validate()).not.toBeNull();
    component.StringValue = '16';
    expect(component.rangeError).toBeNull();
    expect(component.validate()).toBeNull();
  });

  it('keeps the required check for an empty value', () => {
    const component = setup(16);
    component.required = true;
    component.state.value = '';
    expect(component.validate()).toEqual({required: true});
    component.required = false;
    expect(component.validate()).toBeNull();
  });
});
