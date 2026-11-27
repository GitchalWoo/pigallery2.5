import {expect} from 'chai';
import {mock} from 'node:test';
import {ObjectManagers} from '../../../../../src/backend/model/ObjectManagers';
import {UserEntity} from '../../../../../src/backend/model/database/enitites/UserEntity';
import {
  ANDSearchQuery,
  DatePatternFrequency,
  DatePatternSearch,
  DirectorySearch,
  SearchQueryTypes,
  TextSearch,
  TextSearchQueryMatchTypes
} from '../../../../../src/common/entities/SearchQueryDTO';
import {UserRoles} from '../../../../../src/common/entities/UserDTO';
import {Brackets} from 'typeorm';
import {DBTestHelper} from '../../../DBTestHelper';
import {SharingEntity} from '../../../../../src/backend/model/database/enitites/SharingEntity';
import {SessionManager} from '../../../../../src/backend/model/database/SessionManager';
import {Config} from '../../../../../src/common/config/private/Config';
import {DirectorySearchConfig} from '../../../../../src/common/config/private/PrivateConfig';

declare let describe: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;
const tmpDescribe = describe;
describe = DBTestHelper.describe(); // fake it so the IDE plays nicely (recognize the test)

describe('SessionManager', (sqlHelper: DBTestHelper) => {
  describe = tmpDescribe;
  describe('projection keys', () => {
    it('keeps the SHA-256 no-projection key within the existing column width', () => {
      expect(SessionManager.NO_PROJECTION_KEY).to.equal('f4b9f37058397b082c3699920b007065');
    });

    it('shares keys for reordered equivalent queries but separates permission scopes', () => {
      const sm = new SessionManager();
      const directory = {type: SearchQueryTypes.directory, value: 'private'} as TextSearch;
      const keyword = {type: SearchQueryTypes.keyword, value: 'family'} as TextSearch;
      const query = {type: SearchQueryTypes.AND, list: [directory, keyword]} as ANDSearchQuery;
      const reordered = {list: [{value: 'family', type: SearchQueryTypes.keyword}, directory], type: SearchQueryTypes.AND} as ANDSearchQuery;
      const otherScope = {type: SearchQueryTypes.AND, list: [directory, {...keyword, value: 'public'}]} as ANDSearchQuery;

      const key = sm.createProjectionKey(query);
      expect(sm.createProjectionKey(directory)).to.equal('89039d9f5530956922990ebf6551940a');
      expect(key).to.match(/^[a-f0-9]{32}$/);
      expect(sm.createProjectionKey(reordered)).to.equal(key);
      expect(sm.createProjectionKey(otherScope)).to.not.equal(key);
      expect(key).to.not.equal(SessionManager.NO_PROJECTION_KEY);
    });
  });

  describe('buildContext', () => {

    // Reset ObjectManagers before each test
    beforeEach(async () => {
      await sqlHelper.initDB();
    });

    afterEach(sqlHelper.clearDB);

    it('should create a basic context with user and no queries', async () => {
      // Create a basic user with no queries
      const sm = new SessionManager();
      const user = new UserEntity();
      user.id = 1;
      user.name = 'testuser';
      user.role = UserRoles.Admin;

      // Create the context
      const context = await sm.buildContext(user);

      // Verify the context
      expect(context).to.not.be.null;
      expect(context.user).to.be.eql(user);
      expect(context.projectionQuery).to.be.undefined;
    });

    it('AUD6: should strip password from user in buildContext', async () => {
      const sm = new SessionManager();
      const user = new UserEntity();
      user.id = 99;
      user.name = 'hasheduser';
      user.role = UserRoles.User;
      user.password = '$2b$10$supersecretbcryptpasswordhash';

      const context = await sm.buildContext(user);

      expect(context).to.not.be.null;
      expect((context.user as any).password).to.be.undefined;
      expect(user.password).to.be.undefined;
    });

    it('should create a context with allowQuery and set projectionQuery', async () => {
      // Create a basic user with no queries
      const sm = new SessionManager();
      // Create a user with allowQuery
      const user = new UserEntity();
      user.id = 2;
      user.name = 'allowuser';
      user.role = UserRoles.Admin;
      user.overrideAllowBlockList = true;
      user.allowQuery = {
        type: SearchQueryTypes.directory,
        value: '/allowed/path',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;

      // Mock the SearchManager.prepareAndBuildWhereQuery method
      const mockProjectionQuery = new Brackets(qb => qb.where('directory.path = :path', {path: '/allowed/path'}));
      ObjectManagers.getInstance().SearchManager = {
        prepareAndBuildWhereQuery: (query: any) => {
          // Verify the query is passed correctly
          expect(query).to.be.eql(user.allowQuery);
          return Promise.resolve(mockProjectionQuery);
        },
        hasDirectoryQuery:()=>true
      } as any;



      // Create the context
      const context = await sm.buildContext(user);

      // Verify the context
      expect(context).to.not.be.null;
      expect(context.user).to.be.eql(user);
      expect(context.projectionQuery).to.be.eql(mockProjectionQuery);
      expect(context.user.projectionKey).to.be.a('string').and.not.empty;
    });

    it('should create a context with blockQuery, negate it, and set projectionQuery', async () => {
      // Create a basic user with no queries
      const sm = new SessionManager();
      // Create a user with blockQuery
      const user = new UserEntity();
      user.id = 3;
      user.name = 'blockuser';
      user.role = UserRoles.Admin;
      user.overrideAllowBlockList = true;
      user.blockQuery = {
        type: SearchQueryTypes.directory,
        value: '/blocked/path',
        matchType: TextSearchQueryMatchTypes.exact_match,
        negate: false
      } as TextSearch;

      // Clone the original blockQuery for later comparison
      const originalBlockQuery = JSON.parse(JSON.stringify(user.blockQuery));

      // Mock the SearchManager.prepareAndBuildWhereQuery method
      const mockProjectionQuery = new Brackets(qb => qb.where('directory.path != :path', {path: '/blocked/path'}));
      ObjectManagers.getInstance().SearchManager = {
        prepareAndBuildWhereQuery: (query: any) => {
          // Verify the query has been negated
          expect(query).to.not.be.eql(originalBlockQuery);
          expect(query.negate).to.be.true;
          return Promise.resolve(mockProjectionQuery);
        },
        hasDirectoryQuery:()=>true
      } as any;

      // Create the context
      const context = await sm.buildContext(user);

      // Verify the context
      expect(context).to.not.be.null;
      expect(context.user).to.be.eql(user);
      expect(context.projectionQuery).to.be.eql(mockProjectionQuery);
      expect(context.user.projectionKey).to.be.a('string').and.not.empty;
      // Verify the blockQuery was not changed
      expect((user.blockQuery as TextSearch).negate).to.be.false;
    });

    it('should create a context with both allowQuery and blockQuery, combine them with AND', async () => {
      const sm = new SessionManager();
      // Create a user with both allowQuery and blockQuery
      const user = new UserEntity();
      user.id = 4;
      user.name = 'bothuser';
      user.role = UserRoles.Admin;
      user.overrideAllowBlockList = true;
      user.allowQuery = {
        type: SearchQueryTypes.AND,
        list:[
          {
            type: SearchQueryTypes.directory,
            value: '/allowed/path',
            matchType: TextSearchQueryMatchTypes.exact_match
          } as TextSearch,
          {
            type: SearchQueryTypes.file_name,
            value: 'photo',
            matchType: TextSearchQueryMatchTypes.exact_match
          } as TextSearch
        ]
      } as ANDSearchQuery;
      user.blockQuery = {
        type: SearchQueryTypes.directory,
        value: '/blocked/path',
        matchType: TextSearchQueryMatchTypes.exact_match,
        negate: false
      } as TextSearch;

      // Clone the original queries for later comparison
      const originalAllowQuery = JSON.parse(JSON.stringify(user.allowQuery));

      // Mock the SearchManager.prepareAndBuildWhereQuery method
      const mockProjectionQuery = new Brackets(qb => qb.where('complex combined query'));
      ObjectManagers.getInstance().SearchManager = {
        prepareAndBuildWhereQuery: (query: any) => {
          // Verify the query is an AND combination of allowQuery and negated blockQuery
          expect(query.type).to.be.eql(SearchQueryTypes.AND);
          expect(query.list).to.have.lengthOf(2);
          expect(query.list[0]).to.be.eql(originalAllowQuery);
          expect(query.list[1].negate).to.be.true;
          return Promise.resolve(mockProjectionQuery);
        },
        hasDirectoryQuery:()=>true
      } as any;

      // Create the context
      const context = await sm.buildContext(user);

      // Verify the context
      expect(context).to.not.be.null;
      expect(context.user).to.be.eql(user);
      expect(context.projectionQuery).to.be.eql(mockProjectionQuery);
      expect(context.user.projectionKey).to.be.a('string').and.not.empty;
      // Verify the blockQuery was not changed
      expect((user.blockQuery as TextSearch).negate).to.be.false;
    });

    it('should generate consistent projectionKey for the same query', async () => {
      const sm = new SessionManager();
      // Create two identical users with the same query
      const user1 = new UserEntity();
      user1.id = 5;
      user1.name = 'user1';
      user1.role = UserRoles.Admin;
      user1.overrideAllowBlockList = true;
      user1.allowQuery = {
        type: SearchQueryTypes.directory,
        value: '/allowed/path',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;

      const user2 = new UserEntity();
      user2.id = 6;
      user2.name = 'user2';
      user2.role = UserRoles.Admin;
      user2.overrideAllowBlockList = true;
      user2.allowQuery = {
        type: SearchQueryTypes.directory,
        value: '/allowed/path',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;
      // Mock the SearchManager.prepareAndBuildWhereQuery method
 /*     ObjectManagers.getInstance().SearchManager = {
        prepareAndBuildWhereQuery: (query: any) => {
          return Promise.resolve(mockProjectionQuery);
        }
      } as any;*/

      // Create the contexts
      const context1 = await sm.buildContext(user1);
      const context2 = await sm.buildContext(user2);

      // Verify both users have the same projectionKey despite being different users
      expect(context1.user.projectionKey).to.be.a('string').and.not.empty;
      expect(context2.user.projectionKey).to.be.a('string').and.not.empty;
      expect(context1.user.projectionKey).to.be.eql(context2.user.projectionKey);
    });
  });

  describe('buildAllowListForSharing', () => {
    // Reset ObjectManagers before each test
    beforeEach(async () => {
      await sqlHelper.initDB();
    });

    afterEach(sqlHelper.clearDB);

    it('should return sharing.searchQuery unchanged when creator has no allow/block query', async () => {
      const sm = new SessionManager();
      const creator = new UserEntity();
      creator.id = 10;
      creator.name = 'creator1';
      creator.role = UserRoles.Admin;
      creator.overrideAllowBlockList = true; // use only user queries; none set

      const sharing = new SharingEntity();
      sharing.creator = creator as any;
      sharing.searchQuery = {
        type: SearchQueryTypes.directory,
        value: '/shared/path',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;

      const result = sm.buildAllowListForSharing(sharing);
      expect(result).to.be.eql(sharing.searchQuery);
    });

    it('should AND creator allowQuery with sharing.searchQuery', async () => {
      const sm = new SessionManager();
      const creator = new UserEntity();
      creator.id = 11;
      creator.name = 'creator2';
      creator.role = UserRoles.Admin;
      creator.overrideAllowBlockList = true;
      creator.allowQuery = {
        type: SearchQueryTypes.directory,
        value: '/allowed/by/creator',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;

      const sharing = new SharingEntity();
      sharing.creator = creator as any;
      sharing.searchQuery = {
        type: SearchQueryTypes.file_name,
        value: 'holiday',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;

      const result = sm.buildAllowListForSharing(sharing) as ANDSearchQuery;
      expect(result.type).to.be.eql(SearchQueryTypes.AND);
      expect(result.list).to.have.lengthOf(2);
      expect(result.list[0]).to.be.eql(creator.allowQuery);
      expect(result.list[1]).to.be.eql(sharing.searchQuery);
    });

    it('should AND creator (allow AND negated block) with sharing.searchQuery', async () => {
      const sm = new SessionManager();
      const creator = new UserEntity();
      creator.id = 12;
      creator.name = 'creator3';
      creator.role = UserRoles.Admin;
      creator.overrideAllowBlockList = true;
      creator.allowQuery = {
        type: SearchQueryTypes.directory,
        value: '/allowed',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;
      creator.blockQuery = {
        type: SearchQueryTypes.file_name,
        value: 'secret',
        matchType: TextSearchQueryMatchTypes.exact_match,
        negate: false
      } as TextSearch;

      const sharing = new SharingEntity();
      sharing.creator = creator as any;
      sharing.searchQuery = {
        type: SearchQueryTypes.directory,
        value: '/event/path',
        matchType: TextSearchQueryMatchTypes.exact_match
      } as TextSearch;

      const result = sm.buildAllowListForSharing(sharing) as ANDSearchQuery;
      expect(result.type).to.be.eql(SearchQueryTypes.AND);
      expect(result.list).to.have.lengthOf(2);
      const creatorQuery = result.list[0] as ANDSearchQuery;
      expect(creatorQuery.type).to.be.eql(SearchQueryTypes.AND);
      expect(creatorQuery.list).to.have.lengthOf(2);
      expect(creatorQuery.list[0]).to.be.eql(creator.allowQuery);
      expect((creatorQuery.list[1] as TextSearch).negate).to.be.true;
      expect(result.list[1]).to.be.eql(sharing.searchQuery);
    });
  });

  describe('getAvailableUserSessions', () => {
    // Reset ObjectManagers before each test
    beforeEach(async () => {
      await sqlHelper.initDB();
    });

    afterEach(sqlHelper.clearDB);

    it('should return unauthenticated session when authenticationRequired is false', async () => {
      const sm = new SessionManager();

      // Backup and override config
      const originalAuthRequired = Config.Users.authenticationRequired;
      (Config.Users as any).authenticationRequired = false;

      // Stub UserManager.getUnAuthenticatedUser
      const om = ObjectManagers.getInstance();
      const originalGetUnauth = (om.UserManager as any).getUnAuthenticatedUser;

      const unauthUser = new UserEntity();
      unauthUser.id = 99 as any;
      unauthUser.name = 'unauth';
      unauthUser.role = UserRoles.Guest as any;

      (om.UserManager as any).getUnAuthenticatedUser = () => unauthUser;

      // Also ensure find() would not be used (defensive)
      const originalFind = (om.UserManager as any).find;
      (om.UserManager as any).find = () => { throw new Error('find() should not be called when auth is disabled'); };

      try {
        const sessions = await sm.getAvailableUserSessions();
        expect(sessions).to.have.lengthOf(1);
        expect(sessions[0].user).to.eql(unauthUser);
        expect(sessions[0].projectionQuery).to.be.undefined;
        expect(sessions[0].user.projectionKey).to.be.a('string').and.not.empty;
      } finally {
        // restore stubs and config
        (om.UserManager as any).getUnAuthenticatedUser = originalGetUnauth;
        (om.UserManager as any).find = originalFind;
        (Config.Users as any).authenticationRequired = originalAuthRequired;
      }
    });

    it('should return contexts for users when authenticationRequired is true', async () => {
      const sm = new SessionManager();

      // Backup and enforce config
      const originalAuthRequired = Config.Users.authenticationRequired;
      (Config.Users as any).authenticationRequired = true;

      const om = ObjectManagers.getInstance();
      // Stub UserManager.find to return two users
      const originalFind = (om.UserManager as any).find;

      const u1 = new UserEntity();
      u1.id = 1 as any;
      u1.name = 'u1';
      u1.role = UserRoles.User as any;

      const u2 = new UserEntity();
      u2.id = 2 as any;
      u2.name = 'u2';
      u2.role = UserRoles.Admin as any;

      (om.UserManager as any).find = () => Promise.resolve([u1, u2]);

      try {
        const sessions = await sm.getAvailableUserSessions();
        expect(sessions).to.have.lengthOf(2);
        const users = sessions.map(s => s.user);
        expect(users).to.have.members([u1 as any, u2 as any]);
        sessions.forEach(s => {
          expect(s.projectionQuery).to.be.undefined;
          expect(s.user.projectionKey).to.be.a('string').and.not.empty;
        });
      } finally {
        (om.UserManager as any).find = originalFind;
        (Config.Users as any).authenticationRequired = originalAuthRequired;
      }
    });
  });

  describe('directory allow/block list', () => {
    const dq = (value: string, matchType = TextSearchQueryMatchTypes.exact_match, negate = false): DirectorySearch =>
      ({type: SearchQueryTypes.directory, value, matchType, negate});
    const anyPhoto = {type: SearchQueryTypes.file_name, value: 'Photo', matchType: TextSearchQueryMatchTypes.like} as TextSearch;

    const user = (u: Partial<UserEntity> = {}): UserEntity => ({
      id: 1,
      name: 'user',
      role: UserRoles.User,
      overrideAllowBlockList: true,
      ...u
    } as UserEntity);

    const sharing = (s: Partial<SharingEntity> = {}): SharingEntity => ({
      sharingKey: 'key',
      searchQuery: anyPhoto,
      creator: user(),
      ...s
    } as unknown as SharingEntity);

    beforeEach(async () => {
      await sqlHelper.initDB();
    });

    after(sqlHelper.clearDB);

    it('builds directory lists and filters into the context', async () => {
      const sm = new SessionManager();
      const context = await sm.buildContext(user({
        allowDirectoryList: [dq('public')],
        blockDirectoryList: [dq('private')]
      }));
      expect(context.directoryAccess.allowLists).to.deep.equal([[dq('public')]]);
      expect(context.directoryAccess.blockList).to.deep.equal([dq('private')]);
      expect(context.directoryAccess.allowQuery.directory).to.be.instanceOf(Brackets);
      expect(context.directoryAccess.allowQuery.directories).to.be.instanceOf(Brackets);
      expect(context.directoryAccess.notBlockedQuery.directory).to.be.instanceOf(Brackets);
      expect(context.directoryAccess.notBlockedQuery.directories).to.be.instanceOf(Brackets);
      // media in not available directories is filtered too
      expect(context.projectionQuery).to.be.instanceOf(Brackets);
      expect(context.hasDirectoryProjection).to.be.true;
      expect(context.user.projectionKey).to.not.equal(SessionManager.NO_PROJECTION_KEY);
    });

    it('does not set directory filters for empty lists', async () => {
      const sm = new SessionManager();
      const context = await sm.buildContext(user({allowDirectoryList: [], blockDirectoryList: []}));
      expect(context.directoryAccess.allowLists).to.be.undefined;
      expect(context.directoryAccess.blockList).to.be.undefined;
      expect(context.directoryAccess.allowQuery).to.be.undefined;
      expect(context.directoryAccess.notBlockedQuery).to.be.undefined;
      expect(context.projectionQuery).to.be.undefined;
      expect(context.user.projectionKey).to.equal(SessionManager.NO_PROJECTION_KEY);
    });

    it('uses the global config if the user does not override it', async () => {
      const sm = new SessionManager();
      Config.Users.allowDirectoryList = [new DirectorySearchConfig('public')];
      try {
        const context = await sm.buildContext(user({overrideAllowBlockList: false, allowDirectoryList: [dq('other')]}));
        expect(context.directoryAccess.allowLists).to.deep.equal([[dq('public')]]);
        // plain objects, not the config instances
        expect(context.directoryAccess.allowLists[0][0]).to.not.be.instanceOf(DirectorySearchConfig);
        expect(context.user.projectionKey).to.equal(sm.createProjectionKey(
          {type: SearchQueryTypes.directory, value: 'public', matchType: TextSearchQueryMatchTypes.exact_match} as TextSearch));
      } finally {
        Config.Users.allowDirectoryList = [];
      }
    });

    it('fails on invalid directory lists', async () => {
      const sm = new SessionManager();
      const invalid: any[] = [
        [{type: SearchQueryTypes.directory, value: ''}],
        [{type: SearchQueryTypes.keyword, value: 'public'}],
        [{value: 'public'}],
        [{type: SearchQueryTypes.directory, value: 'public', matchType: 999}],
        [{type: SearchQueryTypes.directory, value: 'public', negate: 'yes'}],
        dq('public') // not an array
      ];
      for (const list of invalid) {
        let err: Error = null;
        try {
          await sm.buildContext(user({allowDirectoryList: list}));
        } catch (e) {
          err = e;
        }
        expect(err, JSON.stringify(list)).to.not.be.null;
      }
    });

    describe('sharing', () => {
      it('creates sharing user with the directory query of the sharing', () => {
        const sm = new SessionManager();
        const sharingUser = sm.createSharingUser(sharing({directoryQuery: dq('public')}));
        expect(sharingUser.role).to.equal(UserRoles.LimitedGuest);
        expect(sharingUser.overrideAllowBlockList).to.be.true;
        expect(sharingUser.sharingDirectoryQuery).to.deep.equal(dq('public'));
        expect(sm.createSharingUser(sharing()).sharingDirectoryQuery).to.be.null;
      });

      it('default directory view does not limit the directories', async () => {
        const sm = new SessionManager();
        const context = await sm.buildContext(sm.createSharingUser(sharing({
          directoryQuery: dq('*', TextSearchQueryMatchTypes.globMatch),
          defaultDirectoryView: 'public'
        })));
        expect(context.directoryAccess.allowLists).to.deep.equal([[dq('*', TextSearchQueryMatchTypes.globMatch)]]);
      });

      it('sharing without directory query gets directory access by visible photos', async () => {
        const sm = new SessionManager();
        const context = await sm.buildContext(sm.createSharingUser(sharing()));
        expect(context.directoryAccess.byPhotos).to.be.true;
        expect(context.directoryAccess.allowLists).to.be.undefined;
        const dirContext = await sm.buildContext(sm.createSharingUser(sharing({directoryQuery: dq('public')})));
        expect(dirContext.directoryAccess.byPhotos).to.be.undefined;
        const userContext = await sm.buildContext(user());
        expect(userContext.directoryAccess.byPhotos).to.be.undefined;
      });

      it('sharing without search query is valid with directory query', async () => {
        const sm = new SessionManager();
        const context = await sm.buildContext(sm.createSharingUser(sharing({searchQuery: null, directoryQuery: dq('public')})));
        expect(context.directoryAccess.allowLists).to.deep.equal([[dq('public')]]);
        // the directory query filters the media
        expect(context.projectionQuery).to.be.instanceOf(Brackets);
      });

      it('sharing needs a search or a directory query', () => {
        const sm = new SessionManager();
        expect(() => sm.createSharingUser(sharing({searchQuery: null}))).to.throw();
        expect(() => sm.createSharingUser(sharing({searchQuery: {type: SearchQueryTypes.any_text, value: ''} as TextSearch}))).to.throw();
      });

      it('combines the directory query of the sharing with the lists of the creator', async () => {
        const sm = new SessionManager();
        const context = await sm.buildContext(sm.createSharingUser(sharing({
          directoryQuery: dq('public'),
          creator: user({allowDirectoryList: [dq('other')], blockDirectoryList: [dq('private')]})
        })));
        expect(context.directoryAccess.allowLists).to.deep.equal([[dq('other')], [dq('public')]]);
        expect(context.directoryAccess.blockList).to.deep.equal([dq('private')]);
      });

      it('inherits the effective directory lists of the creator', () => {
        const sm = new SessionManager();
        Config.Users.blockDirectoryList = [new DirectorySearchConfig('global')];
        try {
          const own = sm.createSharingUser(sharing({creator: user({blockDirectoryList: [dq('private')]})}));
          expect(own.blockDirectoryList).to.deep.equal([dq('private')]);

          const global = sm.createSharingUser(sharing({
            creator: user({overrideAllowBlockList: false, blockDirectoryList: [dq('private')]})
          }));
          expect(global.blockDirectoryList).to.deep.equal([dq('global')]);
          expect(global.blockDirectoryList[0]).to.not.be.instanceOf(DirectorySearchConfig);
        } finally {
          Config.Users.blockDirectoryList = [];
        }
      });

      it('projection key matches the one used for cache cleanup and depends on the directory query', async () => {
        const sm = new SessionManager();
        const sh = sharing({directoryQuery: dq('public'), creator: user({blockDirectoryList: [dq('private')]})});
        const context = await sm.buildContext(sm.createSharingUser(sh));
        expect(context.user.projectionKey).to.equal(sm.createProjectionKey(sm.buildAllowListForSharing(sh)));
        // the directory query also filters the media
        const context2 = await sm.buildContext(sm.createSharingUser({...sh, directoryQuery: dq('other')} as SharingEntity));
        expect(context2.user.projectionKey).to.not.equal(context.user.projectionKey);
      });
    });
  });

  describe('createProjectionKey with relative dates', () => {
    const day = 24 * 60 * 60 * 1000;
    const relative: DatePatternSearch = {
      type: SearchQueryTypes.date_pattern,
      daysLength: 2,
      frequency: DatePatternFrequency.every_year
    };

    before(async () => {
      await sqlHelper.initDB();
    });

    afterEach(() => {
      mock.timers.reset();
    });

    after(sqlHelper.clearDB);

    it('should keep projectionKey stable across days for queries without relative dates', () => {
      const sm = new SessionManager();
      const nonRelativeQuery: TextSearch = {
        type: SearchQueryTypes.keyword,
        value: 'summer',
        matchType: TextSearchQueryMatchTypes.like
      };

      mock.timers.enable({apis: ['Date'], now: new Date('2026-06-10T12:00:00Z')});
      const key1 = sm.createProjectionKey(nonRelativeQuery);

      mock.timers.tick(day);
      const key2 = sm.createProjectionKey(nonRelativeQuery);

      expect(key2).to.equal(key1);
      // the fork's SHA-256 keys of fixed queries do not change
      expect(sm.createProjectionKey({type: SearchQueryTypes.directory, value: 'private'} as TextSearch))
        .to.equal('89039d9f5530956922990ebf6551940a');
    });

    it('should use the default key without a projection query', () => {
      const sm = new SessionManager();
      expect(sm.createProjectionKey(null)).to.equal(SessionManager.NO_PROJECTION_KEY);
      expect(sm.createProjectionKey(undefined)).to.equal(SessionManager.NO_PROJECTION_KEY);
    });

    it('should change projectionKey across midnight for queries with relative dates', () => {
      const sm = new SessionManager();
      const nestedRelative: ANDSearchQuery = {
        type: SearchQueryTypes.AND,
        list: [
          {type: SearchQueryTypes.keyword, value: 'holiday'} as TextSearch,
          relative
        ]
      };

      mock.timers.enable({apis: ['Date'], now: new Date('2026-06-10T10:00:00Z')});
      const directDay1Morning = sm.createProjectionKey(relative);
      const nestedDay1Morning = sm.createProjectionKey(nestedRelative);

      mock.timers.tick(60 * 60 * 1000);
      expect(sm.createProjectionKey(relative)).to.equal(directDay1Morning);
      expect(sm.createProjectionKey(nestedRelative)).to.equal(nestedDay1Morning);

      mock.timers.tick(day);
      const directDay2 = sm.createProjectionKey(relative);
      const nestedDay2 = sm.createProjectionKey(nestedRelative);

      expect(directDay2).to.not.equal(directDay1Morning);
      expect(nestedDay2).to.not.equal(nestedDay1Morning);
      expect(directDay2).to.match(/^[a-f0-9]{32}$/);
    });

    it('should change the day key at both the UTC and the server-local midnight', () => {
      const originalTZ = process.env.TZ;
      // UTC-4 in June: the UTC date changes at 20:00 local time, the local date 4 hours later
      process.env.TZ = 'America/New_York';
      try {
        mock.timers.enable({apis: ['Date'], now: new Date('2026-06-10T23:30:00Z')});
        const evening = SessionManager.getDayKey();
        mock.timers.setTime(new Date('2026-06-11T00:30:00Z').getTime()); // UTC midnight passed
        const afterUTCMidnight = SessionManager.getDayKey();
        mock.timers.setTime(new Date('2026-06-11T03:30:00Z').getTime()); // still the same local day
        expect(SessionManager.getDayKey()).to.equal(afterUTCMidnight);
        mock.timers.setTime(new Date('2026-06-11T04:30:00Z').getTime()); // local midnight passed
        const afterLocalMidnight = SessionManager.getDayKey();

        expect(afterUTCMidnight).to.not.equal(evening);
        expect(afterLocalMidnight).to.not.equal(afterUTCMidnight);
      } finally {
        if (originalTZ === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTZ;
        }
      }
    });

    it('should match buildContext projectionKey in getProjectionKeyForUser', async () => {
      const sm = new SessionManager();
      const plainUser = new UserEntity();
      plainUser.id = 20;
      plainUser.name = 'plain';
      plainUser.role = UserRoles.User;
      plainUser.overrideAllowBlockList = true;

      const relativeUser = new UserEntity();
      relativeUser.id = 21;
      relativeUser.name = 'relative';
      relativeUser.role = UserRoles.User;
      relativeUser.overrideAllowBlockList = true;
      relativeUser.allowQuery = relative;

      const plainCtx = await sm.buildContext(plainUser);
      expect(sm.getProjectionKeyForUser(plainUser)).to.equal(plainCtx.user.projectionKey);
      expect(sm.getProjectionKeyForUser(plainUser)).to.equal(SessionManager.NO_PROJECTION_KEY);

      const relCtx = await sm.buildContext(relativeUser);
      expect(sm.getProjectionKeyForUser(relativeUser)).to.equal(relCtx.user.projectionKey);
      // the Timeline cache bypass still applies
      expect(relCtx.hasTimeDependentProjection).to.equal(true);
    });
  });

  describe('day change cleanup', () => {
    const day1 = new Date('2026-06-10T12:00:00Z');
    const day2 = new Date('2026-06-11T12:00:00Z');
    let restore: (() => void)[];

    const stubOnNewDay = (manager: { onNewDay?: () => Promise<void> }, impl: () => Promise<void>) => {
      const original = Object.prototype.hasOwnProperty.call(manager, 'onNewDay') ? manager.onNewDay : undefined;
      manager.onNewDay = impl;
      restore.push(() => {
        if (original) {
          manager.onNewDay = original;
        } else {
          delete manager.onNewDay;
        }
      });
    };

    beforeEach(async () => {
      restore = [];
      mock.timers.enable({apis: ['Date'], now: day1});
      await sqlHelper.initDB();
    });

    afterEach(async () => {
      restore.forEach(r => r());
      mock.timers.reset();
      await sqlHelper.clearDB();
    });

    it('runs the cleanup once for concurrent first requests of a new day, and they wait for it', async () => {
      const om = ObjectManagers.getInstance();
      let calls = 0;
      let finished = false;
      stubOnNewDay(om.AlbumManager, async () => {
        calls++;
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        finished = true;
      });
      const admin = () => ({name: 'admin', role: UserRoles.Admin} as UserEntity);

      await om.SessionManager.buildContext(admin());
      expect(calls).to.equal(0); // already done for day 1 at startup

      mock.timers.setTime(day2.getTime());
      const finishedWhenBuilt: boolean[] = [];
      await Promise.all(Array.from({length: 5}, async () => {
        await om.SessionManager.buildContext(admin());
        finishedWhenBuilt.push(finished);
      }));
      expect(calls).to.equal(1);
      expect(finishedWhenBuilt).to.deep.equal([true, true, true, true, true]);
    });

    it('keeps cleaning up the other managers when one fails, and retries it only the next day', async () => {
      const om = ObjectManagers.getInstance();
      let failing = 0;
      let albums = 0;
      stubOnNewDay(om.PersonManager, async () => {
        failing++;
        throw new Error('test failure');
      });
      stubOnNewDay(om.AlbumManager, async () => {
        albums++;
      });
      mock.timers.setTime(day2.getTime());
      await om.onDayChangeIfNeeded();
      await om.onDayChangeIfNeeded();
      expect(failing).to.equal(1);
      expect(albums).to.equal(1);

      mock.timers.setTime(day2.getTime() + 24 * 60 * 60 * 1000);
      await om.onDayChangeIfNeeded();
      expect(failing).to.equal(2);
      expect(albums).to.equal(2);
    });
  });
});
