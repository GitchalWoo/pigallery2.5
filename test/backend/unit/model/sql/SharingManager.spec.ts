import {expect} from 'chai';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
import {SharingManager} from '../../../../../src/backend/model/database/SharingManager';
import {UpdateSharingDTO} from '../../../../../src/common/entities/SharingDTO';
import {UserEntity} from '../../../../../src/backend/model/database/enitites/UserEntity';
import {UserDTO, UserRoles} from '../../../../../src/common/entities/UserDTO';
import {DBTestHelper} from '../../../DBTestHelper';
import {SearchQueryTypes, TextSearch} from '../../../../../src/common/entities/SearchQueryDTO';

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

    const saved = await sm.createSharing(sharing);
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

});
