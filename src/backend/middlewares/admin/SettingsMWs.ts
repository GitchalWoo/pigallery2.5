import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../../common/entities/Error';
import {Config} from '../../../common/config/private/Config';
import {ConfigDiagnostics} from '../../model/diagnostics/ConfigDiagnostics';
import {ConfigClassBuilder} from 'typeconfig/node';
import {TAGS} from '../../../common/config/public/ClientConfig';
import {ObjectManagers} from '../../model/ObjectManagers';
import {ExtensionConfigWrapper} from '../../model/extension/ExtensionConfigWrapper';
import {UserRoles} from '../../../common/entities/UserDTO';
import {isDeepStrictEqual} from 'node:util';

interface RoleState {
  type?: unknown;
  value?: unknown;
  isConfigType?: boolean;
  isConfigArrayType?: boolean;
}


export class SettingsMWs {

  /**
   * General settings updating servcie
   * @param req
   * @param res
   * @param next
   */
  public static async updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    if ((typeof req.body === 'undefined')
      || (typeof req.body.settings === 'undefined')
      || (typeof req.body.settingsPath !== 'string')) {
      return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'settings is needed'));
    }

    try {
      let settings = req.body.settings; // Top level settings JSON
      const settingsPath: string = req.body.settingsPath; // Name of the top level settings
      const transformer = await ExtensionConfigWrapper.original();
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      transformer[settingsPath] = settings;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      settings = ConfigClassBuilder.attachPrivateInterface(transformer[settingsPath]).toJSON({
        skipTags: {secret: true} as TAGS
      });
      const original = await ExtensionConfigWrapper.original();
      const ownRole = req.session.context.user.role;
      if (!Number.isInteger(ownRole)) {
        throw new Error('A valid user role is required to update settings.');
      }
      SettingsMWs.checkGrantedRoles(original, transformer, settingsPath, ownRole);
      if (settingsPath === 'Users') {
        // Array counts alone cannot distinguish replacing an enforced Developer with another account.
        const protectedAccounts = (users: typeof original.Users.enforcedUsers) =>
          users.filter(user => user.role > ownRole)
            .map(user => ConfigClassBuilder.attachPrivateInterface(user).toJSON())
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!isDeepStrictEqual(protectedAccounts(original.Users.enforcedUsers), protectedAccounts(transformer.Users.enforcedUsers))) {
          throw new Error('Cannot change enforced users above your own role.');
        }
      }
      // only updating explicitly set config (not saving config set by the diagnostics)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      original[settingsPath] = settings;
      await ConfigDiagnostics.testConfig(original);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      Config[settingsPath] = settings;
      await original.save();
      await ConfigDiagnostics.runDiagnostics();
      // restart all schedule timers. In case they have changed
      ObjectManagers.getInstance().JobManager.runSchedules();
    //  Logger.info(LOG_TAG, 'new config:');
    //  Logger.info(LOG_TAG, JSON.stringify(Config.toJSON({attachDescription: false}), null, '\t'));
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(new ErrorDTO(ErrorCodes.SETTINGS_ERROR, 'Settings error: ' + err.toString(), err));
      }
      return next(new ErrorDTO(ErrorCodes.SETTINGS_ERROR, 'Settings error: ' + JSON.stringify(err, null, '  '), err));
    }
  }


  /**
   * Nobody can grant a role above their own (e.g. an Admin can't set anything to Developer).
   * Throws if the new settings have more role values above the role of the user than the current config.
   */
  private static checkGrantedRoles(current: object, updated: object, settingsPath: string, ownRole: UserRoles): void {
    const sections = (config: object) => config as Record<string, unknown>;
    const before = SettingsMWs.countRolesAbove(sections(current)[settingsPath], ownRole, settingsPath);
    const after = SettingsMWs.countRolesAbove(sections(updated)[settingsPath], ownRole, settingsPath);
    for (const [key, count] of after) {
      if (count > (before.get(key) ?? 0)) {
        throw new Error(`You can't set ${key.split('=')[0]} to a role above your own (${UserRoles[ownRole]}).`);
      }
    }
  }

  // Counts the role settings that are above maxRole, by their path and value (array items share their path).
  private static countRolesAbove(config: unknown, maxRole: UserRoles, path: string,
                                 out = new Map<string, number>()): Map<string, number> {
    const state = (config as { __state?: Record<string, RoleState> } | null)?.__state;
    if (!state) {
      return out;
    }
    for (const [key, st] of Object.entries(state)) {
      const p = path + '.' + key;
      if (st.type === UserRoles && typeof st.value === 'number' && st.value > Number(maxRole)) {
        const k = p + '=' + UserRoles[st.value];
        out.set(k, (out.get(k) ?? 0) + 1);
      } else if (st.isConfigType) {
        SettingsMWs.countRolesAbove(st.value, maxRole, p, out);
      } else if (st.isConfigArrayType && Array.isArray(st.value)) {
        for (const item of st.value) {
          SettingsMWs.countRolesAbove(item, maxRole, p + '[]', out);
        }
      }
    }
    return out;
  }


}
