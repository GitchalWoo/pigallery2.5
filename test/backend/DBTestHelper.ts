import {Config} from '../../src/common/config/private/Config';
import * as path from 'path';
import * as fs from 'fs';
import {SQLConnection} from '../../src/backend/model/database/SQLConnection';
import {DatabaseType} from '../../src/common/config/private/PrivateConfig';
import {ProjectPath} from '../../src/backend/ProjectPath';
import {DirectoryBaseDTO, ParentDirectoryDTO, SubDirectoryDTO} from '../../src/common/entities/DirectoryDTO';
import {ObjectManagers} from '../../src/backend/model/ObjectManagers';
import {DiskManager} from '../../src/backend/model/fileaccess/DiskManager';
import {GalleryManager} from '../../src/backend/model/database/GalleryManager';
import {DataSource} from 'typeorm';
import {Utils} from '../../src/common/Utils';
import {TestHelper} from '../TestHelper';
import {VideoDTO} from '../../src/common/entities/VideoDTO';
import {PhotoDTO} from '../../src/common/entities/PhotoDTO';
import {Logger} from '../../src/backend/Logger';
import {SessionUser, SessionContext} from '../../src/backend/model/SessionContext';
import {SessionManager} from '../../src/backend/model/database/SessionManager';
import {DirectoryEntity} from '../../src/backend/model/database/enitites/DirectoryEntity';
import {MediaEntity} from '../../src/backend/model/database/enitites/MediaEntity';
import {ProjectedDirectoryCacheEntity} from '../../src/backend/model/database/enitites/ProjectedDirectoryCacheEntity';
import {VersionEntity} from '../../src/backend/model/database/enitites/VersionEntity';
import {DataStructureVersion} from '../../src/common/DataStructureVersion';

declare let describe: any;
const savedDescribe = describe;

class GalleryManagerTest extends GalleryManager {

  public async getDirIdAndTime(connection: DataSource, directoryName: string, directoryParent: string) {
    return super.getDirIdAndTime(connection, directoryName, directoryParent);
  }

  public async getParentDirFromId(connection: DataSource, session: SessionContext, dir: number): Promise<ParentDirectoryDTO> {
    return super.getParentDirFromId(connection, session, dir);
  }

}

const LOG_TAG = '[DBTestHelper]';

export class DBTestHelper {

  /**
   * Columns, indexes and foreign keys of the freshly built MySQL test schema.
   * Fast resets only empty the tables while the schema still matches it.
   */
  private static mysqlSchemaFingerprint: string = null;
  private static mysqlSchemaJustBuilt = false;
  static enable = {
    sqlite: process.env.TEST_SQLITE !== 'false',
    mysql: process.env.TEST_MYSQL !== 'false'
  };
  public static readonly savedDescribe = savedDescribe;
  public readonly testGalleyEntities: {
    dir: ParentDirectoryDTO,
    subDir: SubDirectoryDTO,
    subDir2: SubDirectoryDTO,
    v: VideoDTO,
    p: PhotoDTO,
    p2: PhotoDTO,
    p3: PhotoDTO,
    p4: PhotoDTO
  } = {
    /**
     * dir
     * |- v
     * |- p
     * |- p2
     * |-> subDir
     *     |- p3
     * |-> subDir2
     *     |- p4
     */

    dir: null,
    subDir: null,
    subDir2: null,
    v: null,
    p: null,
    p2: null,
    p3: null,
    p4: null
  };
  public static get defaultSession(): SessionContext {
    const session = new SessionContext();
    session.user = {projectionKey: SessionManager.NO_PROJECTION_KEY} as SessionUser;
    return session;
  }

  constructor(public dbType: DatabaseType) {
  }

  static describe(settingsOverride: {
    sqlite?: boolean;
    mysql?: boolean;
  } = {}): (name: string, tests: (helper?: DBTestHelper) => void) => void {
    const settings = Utils.clone(DBTestHelper.enable);
    for (const key of Object.keys(settingsOverride)) {
      (settings as any)[key] = (settingsOverride as any)[key];
    }
    return (name: string, tests: (helper?: DBTestHelper) => void) => {
      savedDescribe(name, async () => {
        if (settings.sqlite) {
          const helper = new DBTestHelper(DatabaseType.sqlite);
          savedDescribe('sqlite', () => {
            return tests(helper);
          });
        }
        if (settings.mysql) {
          const helper = new DBTestHelper(DatabaseType.mysql);
          savedDescribe('mysql', function(): void {
            this.timeout(99999999); // hint for the test environment
            return tests(helper);
          });
        }
      });
    };
  }

  public static async persistTestDir(directory: DirectoryBaseDTO): Promise<ParentDirectoryDTO> {
    // Managers initialised by the caller belong to the caller: keep them running.
    const ownsManagers = !ObjectManagers.isReady();
    if (ownsManagers) {
      await ObjectManagers.getInstance().init();
    }
    const connection = await SQLConnection.getConnection();
    const indexingManager = ObjectManagers.getInstance().IndexingManager;
    const hadOwnIndexDirectory = Object.prototype.hasOwnProperty.call(indexingManager, 'indexDirectory');
    const indexDirectory = indexingManager.indexDirectory;
    indexingManager.indexDirectory = () => Promise.resolve(null);


    await ObjectManagers.getInstance().IndexingManager.saveToDB(directory as ParentDirectoryDTO);
    // not saving subdirs. saveToDB destroys data
    // await im.saveToDB(subDir);
    // await im.saveToDB(subDir2);

    if (ObjectManagers.getInstance().IndexingManager &&
      ObjectManagers.getInstance().IndexingManager.IsSavingInProgress) {
      await ObjectManagers.getInstance().IndexingManager.SavingReady;
    }

    const gm = new GalleryManagerTest();

    const dir = await gm.getParentDirFromId(connection, this.defaultSession,
      (await gm.getDirIdAndTime(connection, directory.name, path.join(directory.path, path.sep))).id);

    const populateDir = async (d: DirectoryBaseDTO) => {
      for (let i = 0; i < d.directories.length; i++) {
        d.directories[i] = await gm.getParentDirFromId(connection, this.defaultSession,
          (await gm.getDirIdAndTime(connection, d.directories[i].name,
            path.join(DiskManager.pathFromParent(d), path.sep))).id);
        await populateDir(d.directories[i]);
      }
    };
    await populateDir(dir);

    if (ownsManagers) {
      await ObjectManagers.reset();
    } else if (hadOwnIndexDirectory) {
      indexingManager.indexDirectory = indexDirectory;
    } else {
      delete indexingManager.indexDirectory;
    }
    return dir;
  }

  // Arrow functions, so the methods can be passed to Mocha hooks directly (e.g. `after(sqlHelper.clearDB)`).
  public initDB = async (): Promise<void> => {
    await Config.load();
    Config.Extensions.enabled = false; // make all tests clean
    if (this.dbType === DatabaseType.sqlite) {
      await this.initSQLite();
    } else if (this.dbType === DatabaseType.mysql) {
      await this.initMySQL();
    } else {
      throw new Error('Unknown test database type: ' + this.dbType);
    }
  };

  public clearDB = async (): Promise<void> => {
    if (this.dbType === DatabaseType.sqlite) {
      await this.clearUpSQLite();
    } else if (this.dbType === DatabaseType.mysql) {
      await this.clearUpMysql();
    } else {
      throw new Error('Unknown test database type: ' + this.dbType);
    }
  };

  public setUpTestGallery = async (): Promise<void> => {
    const directory: ParentDirectoryDTO = TestHelper.getDirectoryEntry(null, '.');
    this.testGalleyEntities.subDir = TestHelper.getDirectoryEntry(directory, 'The Phantom Menace');
    this.testGalleyEntities.subDir2 = TestHelper.getDirectoryEntry(directory, 'Return of the Jedi');
    this.testGalleyEntities.p = TestHelper.getRandomizedPhotoEntry(directory, 'Photo1');
    this.testGalleyEntities.p2 = TestHelper.getRandomizedPhotoEntry(directory, 'Photo2');
    this.testGalleyEntities.p3 = TestHelper.getRandomizedPhotoEntry(this.testGalleyEntities.subDir, 'Photo3');
    this.testGalleyEntities.p4 = TestHelper.getRandomizedPhotoEntry(this.testGalleyEntities.subDir2, 'Photo4');
    this.testGalleyEntities.v = TestHelper.getVideoEntry1(directory);

    this.testGalleyEntities.dir = await DBTestHelper.persistTestDir(directory);
    this.testGalleyEntities.subDir = this.testGalleyEntities.dir.directories[0];
    this.testGalleyEntities.subDir2 = this.testGalleyEntities.dir.directories[1];
    this.testGalleyEntities.p = (this.testGalleyEntities.dir.media.filter(m => m.name === this.testGalleyEntities.p.name)[0] as any);
    this.testGalleyEntities.p.directory = this.testGalleyEntities.dir;
    this.testGalleyEntities.p2 = (this.testGalleyEntities.dir.media.filter(m => m.name === this.testGalleyEntities.p2.name)[0] as any);
    this.testGalleyEntities.p2.directory = this.testGalleyEntities.dir;
    this.testGalleyEntities.v = (this.testGalleyEntities.dir.media.filter(m => m.name === this.testGalleyEntities.v.name)[0] as any);
    this.testGalleyEntities.v.directory = this.testGalleyEntities.dir;
    this.testGalleyEntities.p3 = (this.testGalleyEntities.dir.directories[0].media[0] as any);
    this.testGalleyEntities.p3.directory = this.testGalleyEntities.dir.directories[0];
    this.testGalleyEntities.p4 = (this.testGalleyEntities.dir.directories[1].media[0] as any);
    this.testGalleyEntities.p2.directory = this.testGalleyEntities.dir.directories[1];
  };

  /**
   * Gallery with nested directories, each photo name starts with the given prefix:
   * ./ (rootPhoto)
   *  public/ (publicPhoto, publicTrack.gpx)
   *    sub/ (subPhoto)
   *  private/ (privatePhoto)
   *    deep/ (deepPhoto)
   *  other/ (otherPhoto)
   */
  public setUpNestedTestGallery = async (): Promise<void> => {
    const root = TestHelper.getDirectoryEntry(null, '.');
    const pub = TestHelper.getDirectoryEntry(root, 'public');
    const sub = TestHelper.getDirectoryEntry(pub, 'sub');
    const priv = TestHelper.getDirectoryEntry(root, 'private');
    const deep = TestHelper.getDirectoryEntry(priv, 'deep');
    const other = TestHelper.getDirectoryEntry(root, 'other');
    TestHelper.getRandomizedPhotoEntry(root, 'rootPhoto');
    TestHelper.getRandomizedPhotoEntry(pub, 'publicPhoto');
    TestHelper.getRandomizedGPXEntry(pub, 'publicTrack');
    TestHelper.getRandomizedPhotoEntry(sub, 'subPhoto');
    TestHelper.getRandomizedPhotoEntry(priv, 'privatePhoto');
    TestHelper.getRandomizedPhotoEntry(deep, 'deepPhoto');
    TestHelper.getRandomizedPhotoEntry(other, 'otherPhoto');
    await DBTestHelper.persistTestDir(root);
    await ObjectManagers.getInstance().init();
    // grandchildren are only saved with their parents
    await ObjectManagers.getInstance().IndexingManager.saveToDB(pub as ParentDirectoryDTO);
    await ObjectManagers.getInstance().IndexingManager.saveToDB(priv as ParentDirectoryDTO);
  };

  public static async printDB() {
    const conn = await SQLConnection.getConnection();
    const dirs = await conn.getRepository(DirectoryEntity).createQueryBuilder('dir').getMany();
    const dCache = await conn.getRepository(ProjectedDirectoryCacheEntity).createQueryBuilder('c').leftJoinAndSelect('c.cover', 'cover').getMany();
    const media = await conn.getRepository(MediaEntity).createQueryBuilder('m').getMany();

    return JSON.stringify({dirs, dCache, media}, null, 2);
  }

  private async initMySQL(): Promise<void> {
    await this.resetMySQL();
  }

  private async resetMySQL(): Promise<void> {
    Logger.debug(LOG_TAG, 'resetting up mysql');
    await this.clearUpMysql();
    // Opening the connection creates the database and builds the schema if it was dropped.
    await ObjectManagers.getInstance().init();
    if (DBTestHelper.mysqlSchemaJustBuilt) {
      DBTestHelper.mysqlSchemaFingerprint = await DBTestHelper.getMysqlSchemaFingerprint(await SQLConnection.getConnection());
      DBTestHelper.mysqlSchemaJustBuilt = false;
    }
  }

  private async clearUpMysql(): Promise<void> {
    Logger.debug(LOG_TAG, 'clearing up mysql');
    // Reset first: it stops schedules and waits for background saves that would otherwise hit the emptied tables.
    await ObjectManagers.reset();
    Config.Database.type = DatabaseType.mysql;
    Config.Database.mysql.database = 'pigallery2_test';
    await fs.promises.rm(TestHelper.TMP_DIR, {recursive: true, force: true});
    // Rebuilding the schema is slow on MySQL: empty the tables instead, as long as no test changed the schema.
    if (!(await DBTestHelper.emptyMysqlTables())) {
      const conn = await SQLConnection.getConnection();
      await conn.query('DROP DATABASE IF EXISTS ' + conn.options.database);
      DBTestHelper.mysqlSchemaFingerprint = null;
      DBTestHelper.mysqlSchemaJustBuilt = true;
    }
    await SQLConnection.close();
  }

  private static async getMysqlSchemaFingerprint(conn: DataSource): Promise<string> {
    const db = conn.options.database;
    const columns = await conn.query(
      'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME, EXTRA ' +
      'FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, COLUMN_NAME', [db]);
    const indexes = await conn.query(
      'SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME ' +
      'FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX', [db]);
    const foreignKeys = await conn.query(
      'SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE ' +
      'FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? ORDER BY TABLE_NAME, CONSTRAINT_NAME', [db]);
    return JSON.stringify({columns, indexes, foreignKeys});
  }

  /**
   * Empties every table except the version row and resets the ids, like a fresh DB.
   * DELETE + resetting AUTO_INCREMENT is several times faster than TRUNCATE on InnoDB.
   * Returns false (and changes nothing) if the schema differs from the freshly built one,
   * e.g. a migration test changed columns or the version, or if emptying fails.
   */
  private static async emptyMysqlTables(): Promise<boolean> {
    if (DBTestHelper.mysqlSchemaFingerprint === null) {
      return false;
    }
    let conn: DataSource;
    try {
      conn = await SQLConnection.getConnection();
      const versions = await conn.getRepository(VersionEntity).find();
      if (versions.length !== 1 || versions[0].version !== DataStructureVersion ||
        (await DBTestHelper.getMysqlSchemaFingerprint(conn)) !== DBTestHelper.mysqlSchemaFingerprint) {
        return false;
      }
    } catch (e) {
      Logger.debug(LOG_TAG, 'Could not check the mysql schema, dropping the db', e);
      return false;
    }
    const versionTable = conn.getMetadata(VersionEntity).tableName;
    const tables = (await conn.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [conn.options.database]))
      .map((r: { TABLE_NAME: string }) => r.TABLE_NAME)
      .filter((t: string) => t !== versionTable);
    const qr = conn.createQueryRunner();
    try {
      await qr.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const table of tables) {
        await qr.query('DELETE FROM `' + table + '`');
        await qr.query('ALTER TABLE `' + table + '` AUTO_INCREMENT = 1');
      }
      return true;
    } catch (e) {
      Logger.debug(LOG_TAG, 'Could not empty the mysql tables, dropping the db', e);
      return false;
    } finally {
      try {
        await qr.query('SET FOREIGN_KEY_CHECKS = 1');
      } finally {
        await qr.release();
      }
    }
  }

  private async initSQLite(): Promise<void> {
    await this.resetSQLite();
  }

  private async resetSQLite(): Promise<void> {
    Logger.debug(LOG_TAG, 'resetting sqlite');
    await this.clearUpSQLite();
    await ObjectManagers.getInstance().init();
  }

  private async clearUpSQLite(): Promise<void> {
    Logger.debug(LOG_TAG, 'clearing up sqlite');
    Config.Database.type = DatabaseType.sqlite;
    Config.Database.dbFolder = TestHelper.TMP_DIR;
    ProjectPath.reset();
    await ObjectManagers.reset();
    await fs.promises.rm(TestHelper.TMP_DIR, {recursive: true, force: true});
  }

}
