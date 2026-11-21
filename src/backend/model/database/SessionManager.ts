import * as crypto from 'crypto';
import {SessionUser, SessionContext} from '../SessionContext';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';
import {Config} from '../../../common/config/private/Config';
import {ANDSearchQuery, SearchListQuery, SearchQueryDTO, SearchQueryTypes} from '../../../common/entities/SearchQueryDTO';
import {SharingEntity} from './enitites/SharingEntity';
import {ObjectManagers} from '../ObjectManagers';
import {Logger} from '../../Logger';
import {UserRoles} from '../../../common/entities/UserDTO';
import {UserEntity} from './enitites/UserEntity';
import {SQLConnection} from './SQLConnection';

const LOG_TAG = '[SessionManager]';

// Permission-scoped caches need collision-resistant keys. Keep 128 bits of
// SHA-256 output as lowercase hex to fit the existing varchar(32) columns.
// This provides 64-bit generic collision resistance, not full SHA-256 strength.
const hashProjectionKey = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

export class SessionManager {

  public static readonly NO_PROJECTION_KEY = hashProjectionKey('No Key');

  // Session stamps by user id or sharing key (see getSessionStamp), so they do not need a DB query per request.
  private stamps = new Map<string, { stamp: string, expires?: number }>();
  private stampGeneration = 0;

  /**
   * Creates the user that is used during a sharing session.
   * It inherits the restrictions of the sharing creator.
   */
  public createSharingUser(sharing: SharingEntity): SessionUser {
    return {
      name: 'Guest',
      role: UserRoles.LimitedGuest,
      usedSharingKey: sharing.sharingKey,
      overrideAllowBlockList: true,
      allowQuery: this.buildAllowListForSharing(sharing)
    } as SessionUser;
  }

  /**
   * Signature of the DB row a session is based on: the user, or the sharing (with its creator).
   * Sessions are stored in the cookie, a session is only valid while its stamp is unchanged,
   * so deleting or changing the user or sharing ends it. Null if the row does not exist or the sharing expired.
   */
  public async getSessionStamp(user: SessionUser): Promise<string> {
    const key = user.usedSharingKey ? 'sharing:' + user.usedSharingKey : 'user:' + user.id;
    let entry = this.stamps.get(key);
    if (!entry) {
      const generation = this.stampGeneration;
      const row = await this.loadSessionRow(user);
      entry = {
        stamp: row ? crypto.createHmac('sha256', (Config.Server.sessionSecret || []).join(''))
          .update(JSON.stringify(row)).digest('hex') : null,
        expires: (row as SharingEntity)?.expires
      };
      // do not cache it if the row changed during the query
      if (generation === this.stampGeneration) {
        this.stamps.set(key, entry);
      }
    }
    return entry.expires < Date.now() ? null : entry.stamp;
  }

  /**
   * Needs to be called after every user or sharing change.
   */
  public invalidateSessionCache(): void {
    this.stampGeneration++;
    this.stamps.clear();
  }

  private async loadSessionRow(user: SessionUser): Promise<UserEntity | SharingEntity> {
    const connection = await SQLConnection.getConnection();
    if (user.usedSharingKey) {
      // not using SharingManager.findOne, that also deletes the expired sharings
      return connection.getRepository(SharingEntity)
        .createQueryBuilder('share')
        .leftJoinAndSelect('share.creator', 'creator')
        .where('share.sharingKey = :sharingKey', {sharingKey: user.usedSharingKey})
        .getOne();
    }
    if (typeof user.id !== 'number') {
      return null;
    }
    return connection.getRepository(UserEntity).findOneBy({id: user.id});
  }
  public buildAllowListForSharing(sharing: SharingEntity): SearchQueryDTO {
    const creatorQuery = this.getQueryForUser(sharing.creator);
    let finalQuery = sharing.searchQuery;
    if (creatorQuery) {
      finalQuery = {
        type: SearchQueryTypes.AND,
        list: [
          creatorQuery,
          sharing.searchQuery
        ]
      } as ANDSearchQuery;
    }
    return finalQuery;
  }

  public createProjectionKey(q: SearchQueryDTO) {
    const canonical = SearchQueryUtils.stringifyForComparison(q);
    return hashProjectionKey(canonical);
  }

  public static isTimeDependent(q: SearchQueryDTO): boolean {
    if (!q) {
      return false;
    }
    if (q.type === SearchQueryTypes.date_pattern) {
      return true;
    }
    return ((q as SearchListQuery).list || []).some(SessionManager.isTimeDependent);
  }

  public async buildContext(user: SessionUser): Promise<SessionContext> {
    const context = new SessionContext();
    context.user = user;
    delete (context.user as any).password;
    context.user.projectionKey = SessionManager.NO_PROJECTION_KEY;
    let finalQuery = this.getQueryForUser(user);

    if (finalQuery) {
      // Build the Brackets-based query
      context.projectionQuery = await ObjectManagers.getInstance().SearchManager.prepareAndBuildWhereQuery(finalQuery);
      context.hasDirectoryProjection = ObjectManagers.getInstance().SearchManager.hasDirectoryQuery(finalQuery);
      if (context.hasDirectoryProjection) {
        context.projectionQueryForSubDir = await ObjectManagers.getInstance().SearchManager.prepareAndBuildWhereQuery(finalQuery, true, {directory: 'directories'});
      }
      context.user.projectionKey = this.createProjectionKey(finalQuery);
      context.hasTimeDependentProjection = SessionManager.isTimeDependent(finalQuery);
      if (SearchQueryUtils.isQueryEmpty(finalQuery)) {
        Logger.silly(LOG_TAG, 'Empty Projection query.');
      } else {
        Logger.silly(LOG_TAG, 'Projection query: ' + JSON.stringify(finalQuery));
      }
    }
    return context;
  }

  async getAvailableUserSessions(): Promise<SessionContext[]> {
    // If authentication is not required, expose the unauthenticated session only
    if (Config.Users.authenticationRequired === false) {
      const user = ObjectManagers.getInstance().UserManager.getUnAuthenticatedUser();
      const ctx = await this.buildContext(user as unknown as SessionUser);
      return [ctx];
    }

    // List all users and build a session context for each
    const users = await ObjectManagers.getInstance().UserManager.find({} as any);
    const sessions: SessionContext[] = [];
    for (const u of users as unknown as SessionUser[]) {
      try {
        const ctx = await this.buildContext(u);
        sessions.push(ctx);
      } catch (e) {
        // Log and continue on individual user context build failure to ensure we return other sessions
        Logger.warn(LOG_TAG, 'Failed to build session context for user id=' + (u as any)?.id + ': ' + (e as Error)?.message);
      }
    }
    return sessions;
  }

  private getQueryForUser(user: SessionUser): SearchQueryDTO {
    let blockQuery = user.overrideAllowBlockList ? user.blockQuery : Config.Users.blockQuery;
    const allowQuery = user.overrideAllowBlockList ? user.allowQuery : Config.Users.allowQuery;

    if (SearchQueryUtils.isQueryEmpty(allowQuery) && SearchQueryUtils.isQueryEmpty(blockQuery)) {
      return null;
    }

    if (!SearchQueryUtils.isQueryEmpty(blockQuery)) {
      blockQuery = SearchQueryUtils.negate(blockQuery);
    }
    let query = !SearchQueryUtils.isQueryEmpty(allowQuery) ? allowQuery : blockQuery;
    if (!SearchQueryUtils.isQueryEmpty(allowQuery) && !SearchQueryUtils.isQueryEmpty(blockQuery)) {
      query = {
        type: SearchQueryTypes.AND,
        list: [
          allowQuery,
          blockQuery
        ]
      } as ANDSearchQuery;
    }
    return query;

  }
}
