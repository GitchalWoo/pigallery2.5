import {expect} from 'chai';
import {DataSource} from 'typeorm';
import {DBTestHelper} from '../../../DBTestHelper';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
import {UserEntity} from '../../../../../src/backend/model/database/enitites/UserEntity';
import {SharingEntity} from '../../../../../src/backend/model/database/enitites/SharingEntity';
import {VersionEntity} from '../../../../../src/backend/model/database/enitites/VersionEntity';
import {PasswordHelper} from '../../../../../src/backend/model/PasswordHelper';
import {UserRoles} from '../../../../../src/common/entities/UserDTO';
import {DataStructureVersion} from '../../../../../src/common/DataStructureVersion';
import {
  DirectorySearch,
  SearchQueryTypes,
  TextSearch,
  TextSearchQueryMatchTypes
} from '../../../../../src/common/entities/SearchQueryDTO';

// to help WebStorm to handle the test cases
declare let describe: any;
declare const it: any;
const tmpDescribe = describe;
describe = DBTestHelper.describe();

/**
 * Upgrade of a populated version 44 database (the schema before #1205) to version 45.
 */
describe('DatabaseMigrations 44 -> 45', (sqlHelper: DBTestHelper) => {
  describe = tmpDescribe;

  const isSQLite = (conn: DataSource) => conn.options.type === 'better-sqlite3';
  const q = (conn: DataSource, name: string) => conn.driver.escape(name);

  const allowQuery: TextSearch = {type: SearchQueryTypes.directory, value: '/allowed'};
  const shareQuery: TextSearch = {type: SearchQueryTypes.directory, value: '/shared'};
  const dirQuery: DirectorySearch = {type: SearchQueryTypes.directory, value: '/shared/*', matchType: TextSearchQueryMatchTypes.globMatch};

  /**
   * Turns the current schema back into version 44: no directory lists, no directory query, searchQuery NOT NULL.
   * An unknown column in each table checks that the migration does not drop or rebuild what it does not know.
   */
  const downgradeTo44 = async (conn: DataSource): Promise<void> => {
    const runner = conn.createQueryRunner();
    try {
      if (isSQLite(conn)) {
        await runner.query('PRAGMA foreign_keys = OFF');
      }
      for (const [table, column] of [['user_entity', 'allowDirectoryList'], ['user_entity', 'blockDirectoryList'], ['sharing_entity', 'directoryQuery']]) {
        await runner.query(`ALTER TABLE ${q(conn, table)} DROP COLUMN ${q(conn, column)}`);
      }
      if (isSQLite(conn)) {
        const table = await runner.getTable('sharing_entity');
        const column = table.findColumnByName('searchQuery');
        const notNull = column.clone();
        notNull.isNullable = false;
        await runner.changeColumn(table, column, notNull);
      } else {
        await runner.query(`ALTER TABLE ${q(conn, 'sharing_entity')} MODIFY ${q(conn, 'searchQuery')} TEXT NOT NULL`);
      }
      for (const table of ['user_entity', 'sharing_entity']) {
        await runner.query(`ALTER TABLE ${q(conn, table)} ADD COLUMN ${q(conn, 'legacyNote')} TEXT NULL`);
        await runner.query(`UPDATE ${q(conn, table)} SET ${q(conn, 'legacyNote')} = 'must survive'`);
      }
      await runner.query(`UPDATE ${q(conn, 'version_entity')} SET ${q(conn, 'version')} = 44`);
    } finally {
      if (isSQLite(conn)) {
        await runner.query('PRAGMA foreign_keys = ON');
      }
      await runner.release();
    }
  };

  const populate = async (conn: DataSource): Promise<{ user: UserEntity, sharings: SharingEntity[] }> => {
    const user = await conn.getRepository(UserEntity).save({
      name: 'existing user', password: PasswordHelper.cryptPassword('existing password'),
      role: UserRoles.User, overrideAllowBlockList: true, allowQuery
    } as unknown as UserEntity);
    const sharings: SharingEntity[] = [];
    for (const [key, password] of [['share-open', null], ['share-password', 'secret']]) {
      sharings.push(await conn.getRepository(SharingEntity).save({
        sharingKey: key, creator: user, searchQuery: shareQuery, password,
        expires: Date.now() + 100000, timeStamp: 1234
      } as unknown as SharingEntity));
    }
    return {user, sharings};
  };

  const reopen = async (): Promise<DataSource> => {
    await SQLConnection.close();
    return await SQLConnection.getConnection() as DataSource;
  };

  beforeEach(async () => {
    await sqlHelper.initDB();
  });

  afterEach(async () => {
    await sqlHelper.clearDB();
  });

  it('keeps the users and the sharings and adds the directory access columns', async () => {
    const conn = await SQLConnection.getConnection() as DataSource;
    const {user, sharings} = await populate(conn);
    await downgradeTo44(conn);

    const migrated = await reopen();

    expect((await migrated.getRepository(VersionEntity).find())[0].version).to.equal(DataStructureVersion);
    const users = await migrated.getRepository(UserEntity).find();
    expect(users.map(u => u.name)).to.include('existing user');
    const migratedUser = users.find(u => u.id === user.id);
    expect(migratedUser.password).to.equal(user.password);
    expect(migratedUser.allowQuery).to.deep.equal(allowQuery);
    expect(migratedUser.allowDirectoryList).to.equal(null);
    expect(migratedUser.blockDirectoryList).to.equal(null);

    const migratedSharings = await migrated.getRepository(SharingEntity).find({relations: ['creator'], order: {id: 'ASC'}});
    expect(migratedSharings.map(s => [s.id, s.sharingKey, s.password, s.expires, s.timeStamp, s.creator.id]))
      .to.deep.equal(sharings.map(s => [s.id, s.sharingKey, s.password, s.expires, s.timeStamp, user.id]));
    for (const s of migratedSharings) {
      expect(s.searchQuery).to.deep.equal(shareQuery);
      expect(s.directoryQuery).to.equal(null);
    }

    // unknown columns are not touched
    for (const table of ['user_entity', 'sharing_entity']) {
      const rows = await migrated.query(`SELECT ${q(migrated, 'legacyNote')} AS note FROM ${q(migrated, table)}`);
      expect(rows.map((r: { note: string }) => r.note)).to.include('must survive');
    }

    if (isSQLite(migrated)) {
      expect(await migrated.query('PRAGMA integrity_check')).to.deep.equal([{integrity_check: 'ok'}]);
      expect(await migrated.query('PRAGMA foreign_key_check')).to.deep.equal([]);
      expect(await migrated.query('PRAGMA foreign_keys')).to.deep.equal([{foreign_keys: 1}]);
    }
  });

  it('allows directory sharings and directory lists after the upgrade', async () => {
    const conn = await SQLConnection.getConnection() as DataSource;
    const {user} = await populate(conn);
    await downgradeTo44(conn);

    const migrated = await reopen();
    const saved = await migrated.getRepository(SharingEntity).save({
      sharingKey: 'share-directory', creator: user, searchQuery: null, directoryQuery: dirQuery,
      password: null, expires: Date.now() + 100000, timeStamp: Date.now()
    } as unknown as SharingEntity);
    const found = await migrated.getRepository(SharingEntity).findOneBy({id: saved.id});
    expect(found.searchQuery).to.equal(null);
    expect(found.directoryQuery).to.deep.equal(dirQuery);

    await migrated.getRepository(UserEntity).update({id: user.id}, {allowDirectoryList: [dirQuery], blockDirectoryList: []});
    const updated = await migrated.getRepository(UserEntity).findOneBy({id: user.id});
    expect(updated.allowDirectoryList).to.deep.equal([dirQuery]);
  });

  it('deleting a user still deletes its sharings after the upgrade', async () => {
    const conn = await SQLConnection.getConnection() as DataSource;
    const {user} = await populate(conn);
    await downgradeTo44(conn);

    const migrated = await reopen();
    await migrated.getRepository(UserEntity).delete({id: user.id});
    expect(await migrated.getRepository(SharingEntity).count()).to.equal(0);
  });

  it('can be retried after a partial upgrade', async () => {
    const conn = await SQLConnection.getConnection() as DataSource;
    await populate(conn);
    await downgradeTo44(conn);
    // MySQL commits each DDL: a failed run can leave some of the new columns behind
    await conn.query(`ALTER TABLE ${q(conn, 'user_entity')} ADD COLUMN ${q(conn, 'allowDirectoryList')} TEXT NULL`);

    const migrated = await reopen();
    expect((await migrated.getRepository(VersionEntity).find())[0].version).to.equal(DataStructureVersion);
    expect(await migrated.getRepository(SharingEntity).count()).to.equal(2);
  });
});
