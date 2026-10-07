import {expect} from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {Config} from '../../../../../src/common/config/private/Config';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
import {DatabaseMigrations} from '../../../../../src/backend/model/database/DatabaseMigrations';
import {UserEntity} from '../../../../../src/backend/model/database/enitites/UserEntity';
import {UserRoles} from '../../../../../src/common/entities/UserDTO';
import {PasswordHelper} from '../../../../../src/backend/model/PasswordHelper';
import {DirectoryEntity} from '../../../../../src/backend/model/database/enitites/DirectoryEntity';
import {SharingEntity} from '../../../../../src/backend/model/database/enitites/SharingEntity';
import {PhotoEntity, PhotoMetadataEntity} from '../../../../../src/backend/model/database/enitites/PhotoEntity';
import {
  CameraMetadataEntity,
  GPSMetadataEntity,
  MediaDimensionEntity,
  PositionMetaDataEntity
} from '../../../../../src/backend/model/database/enitites/MediaEntity';
import {VersionEntity} from '../../../../../src/backend/model/database/enitites/VersionEntity';
import {DatabaseType} from '../../../../../src/common/config/private/PrivateConfig';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {TestHelper} from '../../../../TestHelper';
import {DataSource} from 'typeorm';
import {DataStructureVersion} from '../../../../../src/common/DataStructureVersion';
import {rejects} from 'assert';


describe('Typeorm integration', () => {


  const setUpSqlDB = async () => {
    await fs.promises.rm(TestHelper.TMP_DIR, {recursive: true, force: true});

    Config.Database.type = DatabaseType.sqlite;
    Config.Database.dbFolder = TestHelper.TMP_DIR;
    ProjectPath.reset();

  };

  const teardownUpSqlDB = async () => {
    await SQLConnection.close();
    await fs.promises.rm(TestHelper.TMP_DIR, {recursive: true});
  };

  beforeEach(async () => {
    await setUpSqlDB();
  });

  afterEach(async () => {
    await teardownUpSqlDB();
  });


  const getDir = (namePrefix = '') => {
    const d = new DirectoryEntity();
    d.name = namePrefix + 'test dir';
    d.path = '.';
    d.lastModified = Date.now();
    d.lastScanned = null;
    d.parent = null;
    d.media = [];
    d.directories = [];
    return d;
  };


  const getPhoto = () => {
    const sd = new MediaDimensionEntity();
    sd.height = 200;
    sd.width = 200;
    const gps = new GPSMetadataEntity();
    gps.latitude = 1;
    gps.longitude = 1;
    const pd = new PositionMetaDataEntity();
    pd.city = 'New York';
    pd.country = 'Alderan';
    pd.state = 'Death star';
    pd.GPSData = gps;
    const cd = new CameraMetadataEntity();
    cd.ISO = 100;
    cd.model = '60D';
    cd.make = 'Canon';
    cd.fStop = 1;
    cd.exposure = 1;
    cd.focalLength = 1;
    cd.lens = 'Lens';
    const m = new PhotoMetadataEntity();
    m.keywords = ['apple'];
    m.cameraData = cd;
    m.positionData = pd;
    m.size = sd;
    m.creationDate = Date.now();
    m.fileSize = 123456789;


    const d = new PhotoEntity();
    d.name = 'test media.jpg';
    d.directory = null;
    d.metadata = m;
    return d;
  };

  const snapshot = async (connection: DataSource): Promise<Record<string, Record<string, unknown>[]>> => {
    const tables: {name: string}[] = await connection.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const {name} of tables) {
      result[name] = await connection.query(`SELECT * FROM ${connection.driver.escape(name)} ORDER BY rowid`);
    }
    return result;
  };

  for (const missingColumns of [
    ['oidcIssuer', 'oidcSubject'], ['oidcIssuer'], ['oidcSubject'], []
  ]) {
    it(`should migrate a version-43 database preserving all data (missing: ${missingColumns.join(', ') || 'none'})`, async () => {
      const conn = await SQLConnection.getConnection();
      const user = await conn.getRepository(UserEntity).save({
        name: 'existing admin', password: PasswordHelper.cryptPassword('existing password'),
        role: UserRoles.Admin, overrideAllowBlockList: true,
        allowQuery: {type: 100, value: '/allowed'} as any,
        blockQuery: {type: 100, value: '/blocked'} as any,
        oidcIssuer: 'https://issuer.example', oidcSubject: 'existing-subject'
      });
      await conn.getRepository(SharingEntity).save({
        sharingKey: 'existing-share', creator: user, searchQuery: {type: 100, value: '/'} as any,
        password: 'existing-share-password', expires: Date.now() + 100000, timeStamp: Date.now()
      });
      const directory = await conn.getRepository(DirectoryEntity).save(getDir());
      const photo = getPhoto();
      photo.directory = directory;
      await conn.getRepository(PhotoEntity).save(photo);

      // Reproduce the deployed pre-hardening schema, including its unchanged version record.
      for (const column of missingColumns) {
        await conn.query(`ALTER TABLE "user_entity" DROP COLUMN "${column}"`);
      }
      // A generic synchronize would remove this unrelated column and its data.
      await conn.query('ALTER TABLE "user_entity" ADD COLUMN "legacyNote" TEXT');
      await conn.query('UPDATE "user_entity" SET "legacyNote" = ?', ['must survive']);
      await conn.query('UPDATE "version_entity" SET "version" = 43');
      const before = await snapshot(conn);
      const backupsBefore = fs.readdirSync(TestHelper.TMP_DIR).filter(f => f.includes('.bak-'));
      await SQLConnection.close();

      const [migrated, concurrent] = await Promise.all([SQLConnection.getConnection(), SQLConnection.getConnection()]);
      expect(concurrent).to.equal(migrated);
      const after = await snapshot(migrated);
      expect(after.version_entity[0].version).to.equal(DataStructureVersion);
      after.version_entity[0].version = 43;
      for (const row of after.user_entity) {
        for (const column of missingColumns) {
          expect(row[column]).to.equal(null);
          delete row[column];
        }
      }
      expect(after).to.deep.equal(before);
      expect((await migrated.getRepository(UserEntity).findOneBy({id: user.id})).password).to.equal(user.password);
      expect(await migrated.query('PRAGMA integrity_check')).to.deep.equal([{integrity_check: 'ok'}]);
      expect(await migrated.query('PRAGMA foreign_key_check')).to.deep.equal([]);

      const backupsAfter = fs.readdirSync(TestHelper.TMP_DIR).filter(f => f.includes('.bak-'));
      const newBackups = backupsAfter.filter(f => !backupsBefore.includes(f));
      expect(newBackups).to.have.length(1);
      const backup = await new DataSource({
        type: 'better-sqlite3', database: path.join(TestHelper.TMP_DIR, newBackups[0]), synchronize: false
      }).initialize();
      try {
        expect(await snapshot(backup)).to.deep.equal(before);
      } finally {
        await backup.destroy();
      }

      await SQLConnection.close();
      await SQLConnection.getConnection();
      expect(fs.readdirSync(TestHelper.TMP_DIR).filter(f => f.includes('.bak-'))).to.deep.equal(backupsAfter);
    });
  }

  it('should back up committed WAL data before the version-43 migration', async () => {
    const conn = await SQLConnection.getConnection();
    await conn.query('PRAGMA journal_mode = WAL');
    await conn.query('PRAGMA wal_autocheckpoint = 0');
    await conn.query('ALTER TABLE "user_entity" DROP COLUMN "oidcIssuer"');
    await conn.query('ALTER TABLE "user_entity" DROP COLUMN "oidcSubject"');
    await conn.query('UPDATE "version_entity" SET "version" = 43');
    await conn.query('INSERT INTO "user_entity" (name, password, role) VALUES (?, ?, ?)',
      ['user in WAL', 'unchanged hash', UserRoles.Admin]);
    const before = await snapshot(conn);
    const dbPath = SQLConnection.getSQLiteDB(Config.Database);
    expect(fs.statSync(`${dbPath}-wal`).size).to.be.greaterThan(0);
    const backupsBefore = fs.readdirSync(TestHelper.TMP_DIR).filter(f => f.includes('.bak-'));

    // Keep the connection open so closing it cannot checkpoint the WAL before the backup.
    await DatabaseMigrations.run(conn);
    const newBackups = fs.readdirSync(TestHelper.TMP_DIR).filter(f => f.includes('.bak-') && !backupsBefore.includes(f));
    expect(newBackups).to.have.length(1);
    const backup = await new DataSource({
      type: 'better-sqlite3', database: path.join(TestHelper.TMP_DIR, newBackups[0]), synchronize: false
    }).initialize();
    try {
      expect(await snapshot(backup)).to.deep.equal(before);
      expect(await backup.query('PRAGMA integrity_check')).to.deep.equal([{integrity_check: 'ok'}]);
    } finally {
      await backup.destroy();
    }
  });

  it('should leave the schema and version unchanged when the SQLite backup fails', async () => {
    const conn = await SQLConnection.getConnection();
    await conn.query('ALTER TABLE "user_entity" DROP COLUMN "oidcIssuer"');
    await conn.query('ALTER TABLE "user_entity" DROP COLUMN "oidcSubject"');
    await conn.query('UPDATE "version_entity" SET "version" = 43');
    const before = await snapshot(conn);
    const runner = conn.createQueryRunner();
    const database = await runner.connect() as {backup(destination: string): Promise<unknown>};
    const originalBackup = database.backup;
    try {
      database.backup = async () => { throw new Error('simulated disk full'); };
      await rejects(
        DatabaseMigrations.run(conn),
        /schema upgrade aborted: simulated disk full/
      );
      expect(await snapshot(conn)).to.deep.equal(before);
    } finally {
      database.backup = originalBackup;
      await runner.release();
    }
  });

  it('should roll back a failed SQLite migration and allow startup to retry', async () => {
    const conn = await SQLConnection.getConnection();
    await conn.query('ALTER TABLE "user_entity" DROP COLUMN "oidcIssuer"');
    await conn.query('ALTER TABLE "user_entity" DROP COLUMN "oidcSubject"');
    await conn.query('UPDATE "version_entity" SET "version" = 43');
    await conn.query(`CREATE TRIGGER fail_version_update BEFORE UPDATE ON "version_entity"
      BEGIN SELECT RAISE(ABORT, 'simulated version update failure'); END`);
    const before = await snapshot(conn);
    await SQLConnection.close();
    await rejects(SQLConnection.getConnection(), /simulated version update failure/);

    const inspection = await new DataSource({
      type: 'better-sqlite3', database: SQLConnection.getSQLiteDB(Config.Database), synchronize: false
    }).initialize();
    try {
      expect(await snapshot(inspection)).to.deep.equal(before);
      expect((await inspection.query('PRAGMA table_info("user_entity")')).map((c: {name: string}) => c.name))
        .to.not.include.members(['oidcIssuer', 'oidcSubject']);
      await inspection.query('DROP TRIGGER fail_version_update');
    } finally {
      await inspection.destroy();
    }
    const retry = await SQLConnection.getConnection();
    expect((await retry.getRepository(VersionEntity).find())[0].version).to.equal(DataStructureVersion);
    expect(await retry.query('PRAGMA integrity_check')).to.deep.equal([{integrity_check: 'ok'}]);
  });

  it('should refuse to downgrade a database from a newer schema version', async () => {
    const conn = await SQLConnection.getConnection();
    await conn.query('UPDATE "version_entity" SET "version" = ?', [DataStructureVersion + 1]);
    const before = await snapshot(conn);
    await SQLConnection.close();
    await rejects(SQLConnection.getConnection(), /newer than supported version/);
    const inspection = await new DataSource({
      type: 'better-sqlite3', database: SQLConnection.getSQLiteDB(Config.Database), synchronize: false
    }).initialize();
    try {
      expect(await snapshot(inspection)).to.deep.equal(before);
    } finally {
      await inspection.destroy();
    }
  });

  it('should migrate users', async () => {
    const conn = await SQLConnection.getConnection();
    const a = new UserEntity();
    a.name = 'migrated admin';
    a.password = PasswordHelper.cryptPassword('Test admin');
    a.role = UserRoles.Admin;
    await conn.getRepository(UserEntity).save(a);

    const version = (await conn.getRepository(VersionEntity).find())[0];
    version.version = 42;
    await conn.getRepository(VersionEntity).save(version);

    await SQLConnection.close();

    const conn2 = await SQLConnection.getConnection();
    const admins = await conn2.getRepository(UserEntity).findBy({name: 'migrated admin'});
    expect(admins.length).to.be.equal(1);
  });

  it('AUD4: should preserve shares across schema upgrade without dropping tables', async () => {
    const conn = await SQLConnection.getConnection();
    const user = new UserEntity();
    user.name = 'share creator';
    user.password = PasswordHelper.cryptPassword('test');
    user.role = UserRoles.User;
    const savedUser = await conn.getRepository(UserEntity).save(user);

    const share = new SharingEntity();
    share.sharingKey = 'preservedShareKey';
    share.searchQuery = {value: '/', type: 100} as any;
    share.creator = savedUser;
    share.expires = Date.now() + 100000;
    share.timeStamp = Date.now();
    await conn.getRepository(SharingEntity).save(share);

    // Downgrade version record to trigger schema update
    const version = (await conn.getRepository(VersionEntity).find())[0];
    version.version--;
    await conn.getRepository(VersionEntity).save(version);

    await SQLConnection.close();

    // Reopen connection: runs the database migrations
    const conn2 = await SQLConnection.getConnection();
    const shares = await conn2.getRepository(SharingEntity).findBy({sharingKey: 'preservedShareKey'});
    expect(shares.length).to.equal(1);
    expect(shares[0].sharingKey).to.equal('preservedShareKey');
  });

  it('AUD4: tryConnection should be non-destructive and never mutate schema or data', async () => {
    const conn = await SQLConnection.getConnection();
    const user = new UserEntity();
    user.name = 'persistent user';
    user.password = PasswordHelper.cryptPassword('test');
    user.role = UserRoles.User;
    await conn.getRepository(UserEntity).save(user);

    await SQLConnection.close();

    // tryConnection should succeed without dropping or mutating
    const canConnect = await SQLConnection.tryConnection(Config.Database);
    expect(canConnect).to.be.true;

    // Verify user is still there
    const conn2 = await SQLConnection.getConnection();
    const foundUsers = await conn2.getRepository(UserEntity).findBy({name: 'persistent user'});
    expect(foundUsers.length).to.equal(1);
  });

  it('AUD8: should generate random admin bootstrap credentials when not in test mode', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalWarn = Config.Users.suppressDefUserWarn;
    try {
      process.env.NODE_ENV = 'production';
      Config.Users.suppressDefUserWarn = false;

      await SQLConnection.init();
      const conn = await SQLConnection.getConnection();
      const admin = await conn.getRepository(UserEntity).findOneBy({name: 'admin'});
      expect(admin).to.exist;
      // Should NOT be the default 'admin' password
      expect(PasswordHelper.comparePassword('admin', admin.password)).to.be.false;

      // Bootstrap file should exist and contain the temporary password
      const bootstrapFile = path.join(ProjectPath.getAbsolutePath(Config.Database.dbFolder), 'admin-bootstrap.txt');
      expect(fs.existsSync(bootstrapFile)).to.be.true;
      const content = fs.readFileSync(bootstrapFile, 'utf8');
      expect(content).to.include('Username: admin');
      expect(content).to.include('Password: ');
    } finally {
      process.env.NODE_ENV = originalEnv;
      Config.Users.suppressDefUserWarn = originalWarn;
    }
  });

  it('should open and close connection', async () => {
    const conn = await SQLConnection.getConnection();
    expect(conn.isConnected).to.equal(true);
    await SQLConnection.close();
    expect(conn.isConnected).to.equal(false);
  });

  it('should open and close connection twice', async () => {
    let conn = await SQLConnection.getConnection();
    expect(conn.isConnected).to.equal(true);
    await SQLConnection.close();
    expect(conn.isConnected).to.equal(false);

    conn = await SQLConnection.getConnection();
    expect(conn.isConnected).to.equal(true);
    await SQLConnection.close();
    expect(conn.isConnected).to.equal(false);
  });

  it('should add a user', async () => {
    const conn = await SQLConnection.getConnection();
    const userRepository = conn.getRepository(UserEntity);
    const a = new UserEntity();
    a.name = 'test';
    a.password = PasswordHelper.cryptPassword('test');
    a.role = UserRoles.Admin;
    await userRepository.save(a);
    expect((await userRepository.find()).length).to.equal(1);
  });


  it('should add a dir', async () => {
    const conn = await SQLConnection.getConnection();
    const dr = conn.getRepository(DirectoryEntity);
    await dr.save(getDir());
    expect((await dr.find()).length).to.equal(1);
  });

  it('should add a media', async () => {
    const conn = await SQLConnection.getConnection();
    const pr = conn.getRepository(PhotoEntity);
    const dir = await conn.getRepository(DirectoryEntity).save(getDir());
    const photo = getPhoto();
    photo.directory = dir;
    await pr.save(photo);
    expect((await pr.find()).length).to.equal(1);
  });

  it('should find a media', async () => {
    const conn = await SQLConnection.getConnection();
    const pr = conn.getRepository(PhotoEntity);
    const dir = await conn.getRepository(DirectoryEntity).save(getDir());
    const photo = getPhoto();
    photo.directory = dir;
    await pr.save(photo);

    const photos = await pr
      .createQueryBuilder('media')
      .orderBy('media.metadata.creationDate', 'ASC') //TODO: Offset: Create a test where it is ".orderBy('media.metadata.creationDate + (media.metadata.creationDateOffset * 60000)', 'ASC')" instead
      .where('media.metadata.positionData.city LIKE :text COLLATE utf8_general_ci', {text: '%' + photo.metadata.positionData.city + '%'})
      .innerJoinAndSelect('media.directory', 'directory')
      .limit(10)
      .getMany();

    expect(photos.length).to.equal(1);
    expect(photos[0].directory.name).to.equal(dir.name);
  });


  it('should not find a media', async () => {
    const conn = await SQLConnection.getConnection();
    const pr = conn.getRepository(PhotoEntity);
    const dir = await conn.getRepository(DirectoryEntity).save(getDir());
    const photo = getPhoto();
    photo.directory = dir;
    const city = photo.metadata.positionData.city;
    photo.metadata.positionData = null;
    await pr.save(photo);
    const photos = await pr
      .createQueryBuilder('media')
      .orderBy('media.metadata.creationDate', 'ASC') //TODO: Offset: Create a test where it is ".orderBy('media.metadata.creationDate + (media.metadata.creationDateOffset * 60000)', 'ASC')" instead
      .where('media.metadata.positionData.city LIKE :text COLLATE utf8_general_ci', {text: '%' + city + '%'})
      .innerJoinAndSelect('media.directory', 'directory')
      .limit(10)
      .getMany();

    expect(photos.length).to.equal(0);
  });

  it('should open and close connection twice with media added ', async () => {
    let conn = await SQLConnection.getConnection();
    const dir = await conn.getRepository(DirectoryEntity).save(getDir());
    const dir2 = getDir('dir2');
    dir2.parent = dir;
    await conn.getRepository(DirectoryEntity).save(dir2);
    const photo = getPhoto();
    photo.directory = dir2;
    await await conn.getRepository(PhotoEntity).save(photo);
    await SQLConnection.close();
    expect(conn.isConnected).to.equal(false);

    conn = await SQLConnection.getConnection();
    expect(conn.isConnected).to.equal(true);
    await SQLConnection.close();
    expect(conn.isConnected).to.equal(false);
  });

});
