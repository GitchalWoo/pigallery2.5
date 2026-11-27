import {ExtensionInstallerComponent} from './extension-installer.component';
import {type SettingsService} from '../settings.service';
import {type ExtensionInstallerService} from './extension-installer.service';
import {type NotificationService} from '../../../model/notification.service';
import {ErrorCodes, ErrorDTO, errorMessage} from '../../../../../common/entities/Error';
import {type ExtensionListItem} from '../../../../../common/entities/extension/ExtensionListItem';

// NetworkService rejects with the server's ErrorDTO (a plain object), not an Error (upstream e8b0138f)
describe('ExtensionInstallerComponent errors', () => {
  const create = (installExtension: () => Promise<void>) => {
    const error = vi.fn();
    const component = new ExtensionInstallerComponent(
      {getSettings: vi.fn()} as unknown as SettingsService,
      {installExtension} as unknown as ExtensionInstallerService,
      {error, success: vi.fn()} as unknown as NotificationService
    );
    return {component, error};
  };

  it('shows the message of a failed install, not [object Object]', async () => {
    const {component, error} = create(() => Promise.reject({code: ErrorCodes.GENERAL_ERROR, message: 'Download failed'}));
    await component.installExtension({id: 'x', name: 'Sample', installed: false} as ExtensionListItem);
    expect(error).toHaveBeenCalledExactlyOnceWith('Failed to install extension "Sample"', 'Download failed');
  });

  it('reads the message of an ErrorDTO, an Error and a string', () => {
    expect(errorMessage(new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'from the server'))).toBe('from the server');
    expect(errorMessage(new Error('thrown'))).toBe('thrown');
    expect(errorMessage('plain text')).toBe('plain text');
  });
});
