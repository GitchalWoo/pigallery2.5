import {UserDTO, UserRoles} from '../../../common/entities/UserDTO';
import {UserEntity} from './enitites/UserEntity';
import {SQLConnection} from './SQLConnection';
import {PasswordHelper} from '../PasswordHelper';
import {FindOptionsWhere, LessThanOrEqual} from 'typeorm';
import {UserSettingsDTO} from '../../../common/entities/UserSettingsDTO';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';
import {Config} from '../../../common/config/private/Config';
import {ObjectManagers} from '../ObjectManagers';

export class UserManager {


  public async findOne(filter: FindOptionsWhere<UserEntity>): Promise<UserEntity> {
    const connection = await SQLConnection.getConnection();
    const verifyPassword = typeof filter.password == 'string';
    const pass = filter.password as string;
    delete filter.password;
    const user = await connection.getRepository(UserEntity).findOneBy(filter);

    if (verifyPassword && !await PasswordHelper.comparePasswordAsync(pass, user.password)) {
      throw new Error('No entry found');
    }
    return user;
  }

  public async find(filter: FindOptionsWhere<UserDTO>): Promise<UserEntity[]> {
    const connection = await SQLConnection.getConnection();
    return await connection.getRepository(UserEntity).findBy(filter);
  }

  public async createUser(user: UserDTO): Promise<UserEntity> {
    const connection = await SQLConnection.getConnection();
    // Validate search queries if provided
    if (user.allowQuery) {
      SearchQueryUtils.validateSearchQuery(user.allowQuery, 'User allowQuery');
    }
    if (user.blockQuery) {
      SearchQueryUtils.validateSearchQuery(user.blockQuery, 'User blockQuery');
    }
    user.password = await PasswordHelper.cryptPasswordAsync(user.password);
    const ret = await connection.getRepository(UserEntity).save(user);
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
    return ret;
  }

  public async deleteUser(id: number, maxRole = UserRoles.Developer): Promise<UserEntity> {
    const connection = await SQLConnection.getConnection();
    const user = await connection.getRepository(UserEntity).findOneBy({id});
    const result = await connection.getRepository(UserEntity).delete({id, role: LessThanOrEqual(maxRole)});
    if (!result.affected) throw new Error('User cannot be deleted');
    // ends the sessions of the user and of its sharings
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
    return user;
  }

  public async changeRole(id: number, newRole: UserRoles, maxRole = UserRoles.Developer): Promise<UserEntity> {
    const connection = await SQLConnection.getConnection();
    const userRepository = connection.getRepository(UserEntity);
    const result = await userRepository.update({id, role: LessThanOrEqual(maxRole)}, {role: newRole});
    if (!result.affected) throw new Error('User role cannot be changed');
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
    return userRepository.findOneByOrFail({id});
  }

  public async updateSettings(id: number, settings: UserSettingsDTO, maxRole = UserRoles.Developer): Promise<UserEntity> {
    const connection = await SQLConnection.getConnection();
    const userRepository = connection.getRepository(UserEntity);
    const changes: Partial<UserEntity> = {};

    if (typeof settings.overrideAllowBlockList !== 'undefined') {
      changes.overrideAllowBlockList = settings.overrideAllowBlockList;
    }

    if (typeof settings.allowQuery !== 'undefined') {
      if (settings.allowQuery) {
        SearchQueryUtils.validateSearchQuery(settings.allowQuery, 'User allowQuery');
      }
      changes.allowQuery = settings.allowQuery ?? null;
    }

    if (typeof settings.blockQuery !== 'undefined') {
      if (settings.blockQuery) {
        SearchQueryUtils.validateSearchQuery(settings.blockQuery, 'User blockQuery');
      }
      changes.blockQuery = settings.blockQuery ?? null;
    }

    if (settings.newPassword && settings.newPassword.length > 0) {
      changes.password = await PasswordHelper.cryptPasswordAsync(settings.newPassword);
    }

    const target = {id, role: LessThanOrEqual(maxRole)};
    if (Object.keys(changes).length) {
      const result = await userRepository.update(target, changes);
      if (!result.affected) throw new Error('User settings cannot be changed');
    }
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
    return userRepository.findOneByOrFail(target);
  }

  getUnAuthenticatedUser(): UserDTO {
    return {
      name: UserRoles[Config.Users.unAuthenticatedUserRole],
      role: Config.Users.unAuthenticatedUserRole,
    } as UserDTO;
  }
}
