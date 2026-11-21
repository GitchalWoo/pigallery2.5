import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../../common/entities/Error';
import {ObjectManagers} from '../../model/ObjectManagers';
import {Utils} from '../../../common/Utils';
import {Config} from '../../../common/config/private/Config';

import {UserRoles} from '../../../common/entities/UserDTO';

export class UserMWs {
  private static grantableRole(req: Request, value: unknown): UserRoles | null {
    // HTML selects submit their enum keys as strings.
    const role = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof role === 'number' && Number.isInteger(role) &&
        role >= UserRoles.Guest && role <= UserRoles.Developer && role <= req.session?.context?.user?.role) {
      return role;
    }
    return null;
  }

  public static async createUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      return next(new ErrorDTO(ErrorCodes.USER_MANAGEMENT_DISABLED));
    }
    if (
      typeof req.body === 'undefined' ||
      typeof req.body.newUser === 'undefined'
    ) {
      return next();
    }

    const user = req.body.newUser;
    const role = UserMWs.grantableRole(req, user?.role);
    if (role === null || user.id != null || Array.isArray(user)) {
      return next(new ErrorDTO(ErrorCodes.USER_CREATION_ERROR, 'Invalid user or role above your own.'));
    }
    try {
      await ObjectManagers.getInstance().UserManager.createUser({...user, role});
      return next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.USER_CREATION_ERROR, null, err));
    }
  }

  public static async deleteUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      return next(new ErrorDTO(ErrorCodes.USER_MANAGEMENT_DISABLED));
    }
    if (
      typeof req.params === 'undefined' ||
      typeof req.params.id === 'undefined'
    ) {
      return next();
    }

    try {
      // the sessions of the deleted user end on their next request (see AuthenticationMWs.authenticate)
      await ObjectManagers.getInstance().UserManager.deleteUser(
        parseInt(req.params.id as string, 10)
      );
      return next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, null, err));
    }
  }

  public static async changeRole(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      return next(new ErrorDTO(ErrorCodes.USER_MANAGEMENT_DISABLED));
    }
    if (
      typeof req.params === 'undefined' ||
      typeof req.params.id === 'undefined' ||
      typeof req.body === 'undefined' ||
      typeof req.body.newRole === 'undefined'
    ) {
      return next();
    }

    const role = UserMWs.grantableRole(req, req.body.newRole);
    if (role === null) {
      return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'Invalid role or role above your own.'));
    }
    try {
      await ObjectManagers.getInstance().UserManager.changeRole(
        parseInt(req.params.id as string, 10),
        role
      );
      return next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, null, err));
    }
  }

  public static async updateSettings(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      return next(new ErrorDTO(ErrorCodes.USER_MANAGEMENT_DISABLED));
    }
    if (
      typeof req.params === 'undefined' ||
      typeof req.params.id === 'undefined' ||
      typeof req.body === 'undefined' ||
      typeof req.body.settings === 'undefined'
    ) {
      return next();
    }

    try {
      const updatedUser = await ObjectManagers.getInstance().UserManager.updateSettings(
        parseInt(req.params.id as string, 10),
        req.body.settings
      );
      if (req.session?.context?.user?.id === updatedUser.id) {
        //clean up after a change
        await ObjectManagers.getInstance().ProjectedCacheManager.cleanupNonExistingProjections();
      }
      return next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'Can\'t update user settings', err));
    }
  }

  public static async listUsers(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      return next(new ErrorDTO(ErrorCodes.USER_MANAGEMENT_DISABLED));
    }

    try {
      let result = await ObjectManagers.getInstance().UserManager.find({});
      result = Utils.clone(result);
      for (const item of result) {
        item.password = '';
      }
      req.resultPipe = result;
      next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, null, err));
    }
  }
}
