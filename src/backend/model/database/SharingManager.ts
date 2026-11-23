import {UpdateSharingDTO} from '../../../common/entities/SharingDTO';
import {SQLConnection} from './SQLConnection';
import {SharingEntity} from './enitites/SharingEntity';
import {Config} from '../../../common/config/private/Config';
import {PasswordHelper} from '../PasswordHelper';
import {Brackets, DeleteResult, SelectQueryBuilder} from 'typeorm';
import {UserDTO, UserRoles} from '../../../common/entities/UserDTO';
import {UserEntity} from './enitites/UserEntity';
import {DirectorySearch, SearchQueryDTO} from '../../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';
import {ObjectManagers} from '../ObjectManagers';

export class SharingManager {
  /**
   * A sharing needs at least a media (searchQuery) or a directory (directoryQuery) restriction,
   * otherwise it would show everything the creator can see.
   */
  private static validateQueries(sharing: UpdateSharingDTO): void {
    if (SearchQueryUtils.isQueryEmpty(sharing.searchQuery) && !sharing.directoryQuery) {
      throw new Error('Invalid sharing: either searchQuery or directoryQuery needs to be set');
    }
    if (sharing.searchQuery) {
      SearchQueryUtils.validateSearchQuery(sharing.searchQuery);
    }
    if (sharing.directoryQuery) {
      SearchQueryUtils.validateDirectorySearch(sharing.directoryQuery, 'Sharing directoryQuery');
    }
  }

  private static async removeExpiredLink(): Promise<DeleteResult> {
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(SharingEntity)
      .createQueryBuilder('share')
      .where('expires < :now', {now: Date.now()})
      .delete()
      .execute();
  }

  async deleteSharing(sharingKey: string): Promise<void> {
    const connection = await SQLConnection.getConnection();
    const sharing = await connection
      .getRepository(SharingEntity)
      .findOneBy({sharingKey});
    await connection.getRepository(SharingEntity).remove(sharing);
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
  }

  async listAll(): Promise<SharingEntity[]> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(SharingEntity)
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.creator', 'creator')
      .getMany();
  }


  async listAllForQuery(query: SearchQueryDTO, user?: UserDTO): Promise<SharingEntity[]> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    const q: SelectQueryBuilder<SharingEntity> = connection
      .getRepository(SharingEntity)
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.creator', 'creator')
      // a sharing matches if either its media or its directory query is the given query
      .where(new Brackets(b => {
        b.where('share.searchQuery = :query', {query: SearchQueryUtils.stringifyForComparison(query)})
          .orWhere('share.directoryQuery = :query');
      }));
    if (user) {
      q.andWhere('share.creator = :user', {user: user.id});
    }
    return await q.getMany();
  }

  async findOne(sharingKey: string): Promise<SharingEntity> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    return await connection.getRepository(SharingEntity)
      .createQueryBuilder('share')
      .leftJoinAndSelect('share.creator', 'creator')
      .where('share.sharingKey = :sharingKey', {sharingKey})
      .getOne();
  }

  async createSharing(sharing: UpdateSharingDTO): Promise<SharingEntity> {
    await SharingManager.removeExpiredLink();
    const connection = await SQLConnection.getConnection();
    if (sharing.password) {
      sharing.password = await PasswordHelper.cryptPasswordAsync(sharing.password);
    }
    if (sharing.searchQuery) {
      sharing.searchQuery = SearchQueryUtils.sortQuery(sharing.searchQuery);
    }
    if (sharing.defaultDirectoryView && sharing.defaultSearchView) {
      throw new Error('defaultDirectoryView and defaultSearchView cannot be set at the same time');
    }
    SharingManager.validateQueries(sharing);
    if (sharing.directoryQuery) {
      sharing.directoryQuery = SearchQueryUtils.sortQuery(sharing.directoryQuery) as DirectorySearch;
    }
    if (sharing.defaultSearchView) {
      SearchQueryUtils.validateSearchQuery(sharing.defaultSearchView);
      sharing.defaultSearchView = SearchQueryUtils.sortQuery(sharing.defaultSearchView);
    }
    const ret = await connection.getRepository(SharingEntity).save(sharing);
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
    return ret;
  }

  async updateSharing(
    inSharing: UpdateSharingDTO,
    forceUpdate: boolean
  ): Promise<SharingEntity> {
    if (!Number.isInteger(inSharing.id) || inSharing.id < 1 || inSharing.id > 0xffffffff ||
      !Number.isInteger(inSharing.creator?.id) || !Number.isInteger(inSharing.creator?.role)) {
      throw new Error('Invalid sharing or creator ID');
    }
    const connection = await SQLConnection.getConnection();
    const repository = connection.getRepository(SharingEntity);
    const actor = inSharing.creator;
    const canManageOthers = forceUpdate === true && actor.role >= UserRoles.Admin;

    const sharing = await repository.findOne({
      where: canManageOthers ? {id: inSharing.id} : {id: inSharing.id, creator: {id: actor.id}},
      relations: {creator: true},
    });
    if (!sharing || (canManageOthers && sharing.creator.role > actor.role)) {
      throw new Error('Sharing not found');
    }

    if (
      sharing.timeStamp < Date.now() - Config.Sharing.updateTimeout &&
      !canManageOthers
    ) {
      throw new Error('Sharing is locked, can\'t update anymore');
    }
    if (inSharing.defaultDirectoryView && inSharing.defaultSearchView) {
      throw new Error('defaultDirectoryView and defaultSearchView cannot be set at the same time');
    }
    if (inSharing.password == null) {
      sharing.password = null;
    } else {
      sharing.password = await PasswordHelper.cryptPasswordAsync(inSharing.password);
    }
    // allow updating searchQuery and directoryQuery and canonicalize them
    SharingManager.validateQueries(inSharing);
    sharing.searchQuery = inSharing.searchQuery ? SearchQueryUtils.sortQuery(inSharing.searchQuery) : null;
    sharing.directoryQuery = inSharing.directoryQuery ? SearchQueryUtils.sortQuery(inSharing.directoryQuery) as DirectorySearch : null;
    if (inSharing.defaultSearchView) {
      SearchQueryUtils.validateSearchQuery(inSharing.defaultSearchView);
      sharing.defaultSearchView = SearchQueryUtils.sortQuery(inSharing.defaultSearchView);
      sharing.defaultDirectoryView = null;
    } else if (inSharing.defaultSearchView === null) {
      sharing.defaultSearchView = null;
    }
    if (inSharing.defaultDirectoryView) {
      sharing.defaultDirectoryView = inSharing.defaultDirectoryView;
      sharing.defaultSearchView = null;
    } else if (inSharing.defaultDirectoryView === null) {
      sharing.defaultDirectoryView = null;
    }
    sharing.expires = inSharing.expires;

    const update = repository.createQueryBuilder()
      .update()
      .set({
        password: sharing.password,
        searchQuery: sharing.searchQuery,
        directoryQuery: sharing.directoryQuery,
        defaultSearchView: sharing.defaultSearchView,
        defaultDirectoryView: sharing.defaultDirectoryView,
        expires: sharing.expires,
        ...(typeof inSharing.preventDownload === 'boolean' ? {preventDownload: inSharing.preventDownload} : {}),
      })
      .where({id: sharing.id});
    const creatorColumn = connection.driver.escape(repository.metadata.findRelationWithPropertyPath('creator').joinColumns[0].databaseName);
    update.andWhere(`${creatorColumn} = :creatorId`, {creatorId: sharing.creator.id});
    if (canManageOthers) {
      const eligibleCreator = connection.getRepository(UserEntity).createQueryBuilder('creator')
        .select('creator.id')
        .where('creator.role <= :maxRole', {maxRole: actor.role});
      update.andWhere(`${creatorColumn} IN (${eligibleCreator.getQuery()})`, eligibleCreator.getParameters());
    }
    if (!(await update.execute()).affected) {
      throw new Error('Sharing not found');
    }
    ObjectManagers.getInstance().SessionManager.invalidateSessionCache();
    return repository.findOneByOrFail({id: sharing.id});
  }
}
