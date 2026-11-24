import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../../common/entities/Error';
import {ObjectManagers} from '../../model/ObjectManagers';

export class UserRequestConstrainsMWs {
  public static forceSelfRequest(
      req: Request,
      res: Response,
      next: NextFunction
  ): void {
    if (
        typeof req.params === 'undefined' ||
        typeof req.params.id === 'undefined'
    ) {
      return next();
    }
    if (req.session.context?.user.id !== parseInt(req.params.id as string, 10)) {
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED));
    }

    return next();
  }

  public static async notAboveOwnRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawId = req.params?.id;
    if (typeof rawId !== 'string' || !/^\d+$/.test(rawId) || Number(rawId) > 0xffffffff) {
      return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'User id is missing or not valid.'));
    }
    try {
      const target = await ObjectManagers.getInstance().UserManager.findOne({id: Number(rawId)});
      const ownRole = req.session?.context?.user?.role;
      if (!target || !Number.isInteger(ownRole) || target.role > ownRole) {
        return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED));
      }
      return next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, null, err));
    }
  }

  public static notSelfRequest(
      req: Request,
      res: Response,
      next: NextFunction
  ): void {
    if (
        typeof req.params === 'undefined' ||
        typeof req.params.id === 'undefined'
    ) {
      return next();
    }

    if (req.session.context?.user.id === parseInt(req.params.id as string, 10)) {
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED));
    }

    return next();
  }
}
