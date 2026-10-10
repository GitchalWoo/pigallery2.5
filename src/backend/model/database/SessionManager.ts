import * as crypto from 'crypto';
import {ContextUser, SessionContext} from '../SessionContext';
import {SearchQueryUtils} from '../../../common/SearchQueryUtils';
import {Config} from '../../../common/config/private/Config';
import {ANDSearchQuery, SearchListQuery, SearchQueryDTO, SearchQueryTypes} from '../../../common/entities/SearchQueryDTO';
import {SharingEntity} from './enitites/SharingEntity';
import {ObjectManagers} from '../ObjectManagers';
import {Logger} from '../../Logger';

const LOG_TAG = '[SessionManager]';

// Permission-scoped caches need collision-resistant keys. Keep 128 bits of
// SHA-256 output as lowercase hex to fit the existing varchar(32) columns.
// This provides 64-bit generic collision resistance, not full SHA-256 strength.
const hashProjectionKey = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);

export class SessionManager {

  public static readonly NO_PROJECTION_KEY = hashProjectionKey('No Key');

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

  public async buildContext(user: ContextUser): Promise<SessionContext> {
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
      const ctx = await this.buildContext(user as unknown as ContextUser);
      return [ctx];
    }

    // List all users and build a session context for each
    const users = await ObjectManagers.getInstance().UserManager.find({} as any);
    const sessions: SessionContext[] = [];
    for (const u of users as unknown as ContextUser[]) {
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

  private getQueryForUser(user: ContextUser): SearchQueryDTO {
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
