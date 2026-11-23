import {ServerUserOIDCConfig} from '../../../../../../common/config/private/PrivateConfig';
import {SettingsEntryComponent} from './settings-entry.component';

describe('OIDC issuer settings warning', () => {
  it('follows the entered issuer protocol', () => {
    const config = new ServerUserOIDCConfig() as unknown as {__state: {issuerUrl: SettingsEntryComponent['state']}};
    const entry = new SettingsEntryComponent(null, null, null, null);
    entry.state = {...config.__state.issuerUrl};
    entry.state.value = ' HTTP://localhost:5556/dex ';
    expect(entry.warning).toContain('without encryption');
    entry.state.value = 'https://provider.example';
    expect(entry.warning).toBeUndefined();
    entry.state.value = '';
    expect(entry.warning).toBeUndefined();
  });
});
