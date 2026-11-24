import {expect} from 'chai';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
import {SharingManager} from '../../../../../src/backend/model/database/SharingManager';
import {UpdateSharingDTO} from '../../../../../src/common/entities/SharingDTO';
import {UserEntity} from '../../../../../src/backend/model/database/enitites/UserEntity';
import {UserDTO, UserRoles} from '../../../../../src/common/entities/UserDTO';
import {DBTestHelper} from '../../../DBTestHelper';
import {DirectorySearch, SearchQueryTypes, TextSearch, TextSearchQueryMatchTypes} from '../../../../../src/common/entities/SearchQueryDTO';

// to help WebStorm to handle the test cases
declare let describe: any;
declare const after: any;
describe = DBTestHelper.describe();

describe('SharingManager', (sqlHelper: DBTestHelper) => {


  let creator: UserDTO = null;

  const setUpSqlDB = async () => {
    await sqlHelper.initDB();

    const conn = await SQLConnection.getConnection();

    creator = await conn.getRepository(UserEntity).save({
      id: null,
      name: 'test use',
      password: '',
      role: UserRoles.User
    });

    await SQLConnection.close();
  };


  beforeEach(async () => {
    await setUpSqlDB();
  });

  after(async () => {
    await sqlHelper.clearDB();
  });


  it('should create sharing', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKey',
      searchQuery: {value: '/', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.id).to.not.equals(null);
    expect(saved.creator.id).to.equals(creator.id);
    expect(saved.sharingKey).to.equals(sharing.sharingKey);
    expect(saved.timeStamp).to.equals(sharing.timeStamp);
    expect(saved.password).to.equals(sharing.password);
    expect(saved.expires).to.equals(sharing.expires);
  });

  it('allows an admin to edit a share without changing its owner', async () => {
    const sm = new SharingManager();
    const connection = await SQLConnection.getConnection();
    const users = connection.getRepository(UserEntity);
    const admin = await users.save({name: 'admin actor', password: '', role: UserRoles.Admin});
    const developer = await users.save({name: 'developer actor', password: '', role: UserRoles.Developer});
    const other = await users.save({name: 'other actor', password: '', role: UserRoles.User});
    const share = await sm.createSharing({
      id: null, sharingKey: 'editable', creator, expires: Date.now() + 60_000,
      timeStamp: Date.now(), searchQuery: {type: SearchQueryTypes.directory, value: '/'} as TextSearch,
    });
    const expires = share.expires + 60_000;
    await expect(sm.updateSharing({...share, creator: other, expires}, false)).to.be.rejectedWith('Sharing not found');
    expect((await sm.updateSharing({...share, creator: admin, expires}, true)).expires).to.equal(expires);
    expect((await sm.findOne(share.sharingKey)).creator.id).to.equal(creator.id);

    await users.update(creator.id, {role: UserRoles.Developer});
    await expect(sm.updateSharing({...share, creator: admin}, true)).to.be.rejectedWith('Sharing not found');
    expect((await sm.updateSharing({...share, creator: developer}, true)).expires).to.equal(share.expires);
    expect((await sm.findOne(share.sharingKey)).creator.id).to.equal(creator.id);
  });


  it('should find sharing', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKey',
      searchQuery: {value: '/', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    await sm.createSharing(sharing);
    const found = await sm.findOne('testKey');

    expect(found.id).to.not.equals(null);
    expect(found.sharingKey).to.equals(sharing.sharingKey);
    expect(found.timeStamp).to.equals(sharing.timeStamp);
    expect(found.password).to.equals(sharing.password);
    expect(found.expires).to.equals(sharing.expires);
  });


  it('should update sharing', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKey',
      searchQuery: {value: '/', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.password).to.equals(sharing.password);
    expect(saved.expires).to.equals(sharing.expires);

    const update: UpdateSharingDTO = {
      id: saved.id,
      sharingKey: saved.sharingKey,
      searchQuery: saved.searchQuery,
      password: null,
      creator,
      expires: Date.now() + 2000,
      timeStamp: Date.now()
    };
    const updated = await sm.updateSharing(update, false);

    expect(updated.id).to.equals(saved.id);
    expect(updated.sharingKey).to.equals(sharing.sharingKey);
    expect(updated.timeStamp).to.equals(sharing.timeStamp);
    expect(updated.password).to.equals(update.password);
    expect(updated.expires).to.equals(update.expires);
  });

  it('should create sharing with defaultDirectoryView', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeyWithDirDefault',
      searchQuery: {value: '/vacation*', type: SearchQueryTypes.directory} as TextSearch,
      defaultDirectoryView: '/vacation',
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.id).to.not.equals(null);
    expect(saved.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(saved.defaultDirectoryView).to.equals('/vacation');
    expect(saved.defaultSearchView == null).to.be.true;

    const found = await sm.findOne('testKeyWithDirDefault');
    expect(found.id).to.equals(saved.id);
    expect(found.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(found.defaultDirectoryView).to.equals('/vacation');
    expect(found.defaultSearchView == null).to.be.true;
  });

  it('should create sharing with defaultSearchView and not overwrite searchQuery', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeyWithSearchDefault',
      searchQuery: {value: '/vacation*', type: SearchQueryTypes.directory} as TextSearch,
      defaultSearchView: {value: 'sunset', type: SearchQueryTypes.keyword} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.id).to.not.equals(null);
    expect(saved.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(saved.defaultSearchView).to.deep.equals(sharing.defaultSearchView);
    expect(saved.defaultDirectoryView == null).to.be.true;

    const found = await sm.findOne('testKeyWithSearchDefault');
    expect(found.id).to.equals(saved.id);
    expect(found.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(found.defaultSearchView).to.deep.equals(sharing.defaultSearchView);
    expect(found.defaultDirectoryView == null).to.be.true;
  });

  it('should fail to create sharing if both defaultDirectoryView and defaultSearchView are set', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeyWithBothDefaults',
      searchQuery: {value: '/vacation*', type: SearchQueryTypes.directory} as TextSearch,
      defaultDirectoryView: '/vacation',
      defaultSearchView: {value: 'sunset', type: SearchQueryTypes.keyword} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    try {
      await sm.createSharing(sharing);
      expect.fail('should have thrown error');
    } catch (err) {
      expect(err.message).to.contain('cannot be set at the same time');
    }
  });

  it('should update sharing with defaultDirectoryView', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeyUpdateDir',
      searchQuery: {value: '/vacation*', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.defaultDirectoryView == null).to.be.true;
    expect(saved.defaultSearchView == null).to.be.true;

    const update: UpdateSharingDTO = {
      id: saved.id,
      sharingKey: saved.sharingKey,
      searchQuery: saved.searchQuery,
      defaultDirectoryView: '/vacation/day1',
      password: null,
      creator,
      expires: Date.now() + 2000,
      timeStamp: Date.now()
    };
    const updated = await sm.updateSharing(update, false);

    expect(updated.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(updated.defaultDirectoryView).to.equals('/vacation/day1');
    expect(updated.defaultSearchView == null).to.be.true;

    const found = await sm.findOne('testKeyUpdateDir');
    expect(found.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(found.defaultDirectoryView).to.equals('/vacation/day1');
    expect(found.defaultSearchView == null).to.be.true;
  });

  it('should update sharing with defaultSearchView and not overwrite searchQuery', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeyUpdateSearch',
      searchQuery: {value: '/vacation*', type: SearchQueryTypes.directory} as TextSearch,
      defaultDirectoryView: '/vacation',
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.defaultDirectoryView).to.equals('/vacation');

    const update: UpdateSharingDTO = {
      id: saved.id,
      sharingKey: saved.sharingKey,
      searchQuery: saved.searchQuery,
      defaultSearchView: {value: 'beach', type: SearchQueryTypes.keyword} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 2000,
      timeStamp: Date.now()
    };
    const updated = await sm.updateSharing(update, false);

    expect(updated.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(updated.defaultSearchView).to.deep.equals(update.defaultSearchView);
    expect(updated.defaultDirectoryView == null).to.be.true;

    const found = await sm.findOne('testKeyUpdateSearch');
    expect(found.searchQuery).to.deep.equals(sharing.searchQuery);
    expect(found.defaultSearchView).to.deep.equals(update.defaultSearchView);
    expect(found.defaultDirectoryView == null).to.be.true;
  });

  it('should fail to update sharing if both defaultDirectoryView and defaultSearchView are set', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeyUpdateBoth',
      searchQuery: {value: '/vacation*', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);

    const update: UpdateSharingDTO = {
      id: saved.id,
      sharingKey: saved.sharingKey,
      searchQuery: saved.searchQuery,
      defaultDirectoryView: '/vacation/day1',
      defaultSearchView: {value: 'beach', type: SearchQueryTypes.keyword} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 2000,
      timeStamp: Date.now()
    };

    try {
      await sm.updateSharing(update, false);
      expect.fail('should have thrown error');
    } catch (err) {
      expect(err.message).to.contain('cannot be set at the same time');
    }
  });

  it('AUD3: should keep defaultSearchView separate from searchQuery', async () => {
    const sm = new SharingManager();

    const sharing: UpdateSharingDTO = {
      id: null,
      sharingKey: 'testKeySeparate',
      searchQuery: {value: '/photos', type: SearchQueryTypes.directory} as TextSearch,
      defaultSearchView: {value: '/photos/vacation', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 1000,
      timeStamp: Date.now()
    };

    const saved = await sm.createSharing(sharing);
    expect(saved.searchQuery).to.deep.equal({value: '/photos', type: SearchQueryTypes.directory});
    expect(saved.defaultSearchView).to.deep.equal({value: '/photos/vacation', type: SearchQueryTypes.directory});

    const update: UpdateSharingDTO = {
      id: saved.id,
      sharingKey: saved.sharingKey,
      searchQuery: {value: '/photos/2026', type: SearchQueryTypes.directory} as TextSearch,
      defaultSearchView: {value: '/photos/2026/summer', type: SearchQueryTypes.directory} as TextSearch,
      password: null,
      creator,
      expires: Date.now() + 2000,
      timeStamp: Date.now()
    };
    const updated = await sm.updateSharing(update, false);
    expect(updated.searchQuery).to.deep.equal({value: '/photos/2026', type: SearchQueryTypes.directory});
    expect(updated.defaultSearchView).to.deep.equal({value: '/photos/2026/summer', type: SearchQueryTypes.directory});
  });

  it('AUD13: should preserve query filter when filtering by creator in listAllForQuery', async () => {
    const sm = new SharingManager();
    const conn = await SQLConnection.getConnection();
    const otherUser = await conn.getRepository(UserEntity).save({
      id: null,
      name: 'other user',
      password: '',
      role: UserRoles.User
    });

    const q1: TextSearch = {value: '/folder1', type: SearchQueryTypes.directory};
    const q2: TextSearch = {value: '/folder2', type: SearchQueryTypes.directory};

    // Share 1: creator, q1
    await sm.createSharing({
      id: null,
      sharingKey: 'share1',
      searchQuery: q1,
      password: null,
      creator,
      expires: Date.now() + 10000,
      timeStamp: Date.now()
    });

    // Share 2: creator, q2
    await sm.createSharing({
      id: null,
      sharingKey: 'share2',
      searchQuery: q2,
      password: null,
      creator,
      expires: Date.now() + 10000,
      timeStamp: Date.now()
    });

    // Share 3: otherUser, q1
    await sm.createSharing({
      id: null,
      sharingKey: 'share3',
      searchQuery: q1,
      password: null,
      creator: otherUser,
      expires: Date.now() + 10000,
      timeStamp: Date.now()
    });

    // Filtering by q1 and creator: should ONLY return share1 (not share2 or share3)
    const results = await sm.listAllForQuery(q1, creator);
    expect(results.length).to.equal(1);
    expect(results[0].sharingKey).to.equal('share1');

    // Filtering by q1 without user: should return share1 and share3
    const allQ1 = await sm.listAllForQuery(q1);
    expect(allQ1.length).to.equal(2);
    expect(allQ1.map(s => s.sharingKey).sort()).to.deep.equal(['share1', 'share3']);
  });

  describe('directory query', () => {
    const dq = (value: string): DirectorySearch =>
      ({type: SearchQueryTypes.directory, value, matchType: TextSearchQueryMatchTypes.globMatch});

    const newSharing = (s: Partial<UpdateSharingDTO>): UpdateSharingDTO => ({
      id: null,
      sharingKey: 'key_' + Math.random().toString(36).substring(7),
      searchQuery: null,
      password: null,
      creator,
      expires: Date.now() + 100000,
      timeStamp: Date.now(),
      ...s
    } as UpdateSharingDTO);

    it('should create sharing with only directory query', async () => {
      const sm = new SharingManager();
      const saved = await sm.createSharing(newSharing({directoryQuery: dq('/photos/*')}));
      const found = await sm.findOne(saved.sharingKey);
      expect(found.searchQuery).to.be.null;
      expect(found.directoryQuery).to.deep.equal(dq('/photos/*'));
    });

    it('should not create sharing without search and directory query', async () => {
      const sm = new SharingManager();
      let err: Error = null;
      try {
        await sm.createSharing(newSharing({}));
      } catch (e) {
        err = e;
      }
      expect(err).to.not.be.null;
    });

    it('should not create sharing with non directory directory query', async () => {
      const sm = new SharingManager();
      let err: Error = null;
      try {
        await sm.createSharing(newSharing({directoryQuery: {type: SearchQueryTypes.keyword, value: 'x'} as unknown as DirectorySearch}));
      } catch (e) {
        err = e;
      }
      expect(err).to.not.be.null;
    });

    it('should update directory query and keep the sharing valid', async () => {
      const sm = new SharingManager();
      const saved = await sm.createSharing(newSharing({directoryQuery: dq('/photos/*')}));
      const updated = await sm.updateSharing({...saved, directoryQuery: dq('/other/*')} as UpdateSharingDTO, true);
      expect(updated.directoryQuery).to.deep.equal(dq('/other/*'));

      let err: Error = null;
      try {
        await sm.updateSharing({...saved, searchQuery: null, directoryQuery: null} as UpdateSharingDTO, true);
      } catch (e) {
        err = e;
      }
      expect(err).to.not.be.null;
    });

    it('should list sharings by directory query and creator', async () => {
      const sm = new SharingManager();
      const byDir = await sm.createSharing(newSharing({directoryQuery: dq('/photos/*')}));
      await sm.createSharing(newSharing({directoryQuery: dq('/other/*')}));
      const bySearch = await sm.createSharing(newSharing({searchQuery: dq('/photos/*')}));

      const found = await sm.listAllForQuery(dq('/photos/*'));
      expect(found.map(s => s.sharingKey).sort()).to.deep.equal([byDir.sharingKey, bySearch.sharingKey].sort());

      // the creator filter does not replace the query filter
      const foundForCreator = await sm.listAllForQuery(dq('/photos/*'), creator);
      expect(foundForCreator.map(s => s.sharingKey).sort()).to.deep.equal([byDir.sharingKey, bySearch.sharingKey].sort());
      expect(await sm.listAllForQuery(dq('/photos/*'), {id: creator.id + 1000} as UserDTO)).to.deep.equal([]);
    });
  });
});
