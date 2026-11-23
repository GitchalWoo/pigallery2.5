import {Connection} from 'typeorm';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {UserEntity} from './enitites/UserEntity';
import {SharingEntity} from './enitites/SharingEntity';
import {VersionEntity} from './enitites/VersionEntity';
import {DataStructureVersion} from '../../../common/DataStructureVersion';
import {Logger} from '../../Logger';

const LOG_TAG = '[DatabaseMigrations]';

/** Versioned schema upgrades and backups, run before application queries. */
export class DatabaseMigrations {
  public static async run(connection: Connection): Promise<void> {
    let version = null;
    try {
      version = (await connection.getRepository(VersionEntity).find())[0];
      // eslint-disable-next-line no-empty
    } catch (ex) {
    }
    if (version && version.version === DataStructureVersion) {
      return;
    }
    if (version && version.version > DataStructureVersion) {
      throw new Error(`Database schema version ${version.version} is newer than supported version ${DataStructureVersion}`);
    }
    Logger.info(LOG_TAG, 'Updating database scheme');
    await this.backupSQLite(connection);

    // Known versions get only their own changes, without general schema synchronization:
    // that would drop unknown columns and rebuilds SQLite tables (a rebuilt user table deletes the sharings).
    if (version && [43, 44, 45].includes(version.version)) {
      if (version.version === 43) {
        // Version 43 was shipped both with and without the OIDC identity columns.
        await this.migrateOIDCIdentity(connection, version);
      }
      if (version.version === 44) {
        await this.migrateDirectoryAccess(connection, version);
      }
      if (version.version === 45) {
        await this.migrateSharingDownloads(connection, version);
      }
      return;
    }
    if (!version) {
      version = new VersionEntity();
    }
    version.version = DataStructureVersion;

    try {
      await connection.synchronize(false);
      await connection.getRepository(VersionEntity).save(version);
    } catch (e) {
      Logger.error(
        LOG_TAG,
        'Could not synchronize database scheme: ' + (e as Error).toString()
      );
      throw e;
    }
  }

  private static async backupSQLite(connection: Connection): Promise<void> {
    if (connection.options.type !== 'better-sqlite3' || connection.options.database === ':memory:') {
      return;
    }
    const backupPath = `${connection.options.database}.bak-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const runner = connection.createQueryRunner();
    try {
      // Backups contain password hashes and private gallery data. Reserve a private file.
      await fs.promises.writeFile(backupPath, '', {flag: 'wx', mode: 0o600});
      // SQLite's backup API includes committed WAL contents. Copying just the DB file does not.
      const database = await runner.connect() as {backup(destination: string): Promise<unknown>};
      await database.backup(backupPath);
      Logger.info(LOG_TAG, `Created SQLite database backup before schema upgrade: ${backupPath}`);
    } catch (err) {
      throw new Error(`Cannot back up SQLite database; schema upgrade aborted: ${(err as Error).message}`);
    } finally {
      await runner.release();
    }
  }

  private static async migrateOIDCIdentity(connection: Connection, version: VersionEntity): Promise<void> {
    const runner = connection.createQueryRunner();
    const sqlite = connection.options.type === 'better-sqlite3';
    try {
      if (sqlite) {
        await runner.startTransaction();
      }
      const tableName = connection.getMetadata(UserEntity).tableName;
      const table = await runner.getTable(tableName);
      if (!table) {
        throw new Error(`Cannot migrate OIDC identities: missing table ${tableName}`);
      }
      for (const column of ['oidcIssuer', 'oidcSubject']) {
        if (!table.findColumnByName(column)) {
          // Raw ADD COLUMN avoids TypeORM rebuilding the SQLite user table and its relations.
          await runner.query(`ALTER TABLE ${connection.driver.escape(tableName)} ADD COLUMN ${connection.driver.escape(column)} TEXT NULL`);
        }
      }
      // MySQL DDL commits implicitly; checking each column makes a retry safe after partial failure.
      version.version = 44;
      await runner.manager.getRepository(VersionEntity).save(version);
      if (sqlite) {
        await runner.commitTransaction();
      }
      Logger.info(LOG_TAG, 'Migrated OIDC identity columns to database schema version 44');
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      await runner.release();
    }
  }

  /**
   * Version 45: directory allow/block lists of the users and the directory query of the sharings (#1205).
   * The new columns are nullable, so the existing users and sharings keep seeing what they saw.
   * searchQuery of the sharings becomes nullable (a sharing can be a directory sharing only):
   * SQLite can't change a column, the sharing table is rebuilt with its rows.
   */
  private static async migrateDirectoryAccess(connection: Connection, version: VersionEntity): Promise<void> {
    const runner = connection.createQueryRunner();
    const sqlite = connection.options.type === 'better-sqlite3';
    const escape = (name: string) => connection.driver.escape(name);
    try {
      if (sqlite) {
        // the rebuild drops the sharing table, nothing may cascade from it. The pragma is a no-op inside a transaction.
        await runner.query('PRAGMA foreign_keys = OFF');
        await runner.startTransaction();
      }
      const addColumns = async (tableName: string, columns: string[]): Promise<void> => {
        const table = await runner.getTable(tableName);
        if (!table) {
          throw new Error(`Cannot migrate directory access: missing table ${tableName}`);
        }
        for (const column of columns) {
          if (!table.findColumnByName(column)) {
            // Raw ADD COLUMN avoids TypeORM rebuilding the table and its relations.
            await runner.query(`ALTER TABLE ${escape(tableName)} ADD COLUMN ${escape(column)} TEXT NULL`);
          }
        }
      };
      const userTable = connection.getMetadata(UserEntity).tableName;
      const sharingTable = connection.getMetadata(SharingEntity).tableName;
      await addColumns(userTable, ['allowDirectoryList', 'blockDirectoryList']);
      await addColumns(sharingTable, ['directoryQuery']);

      const table = await runner.getTable(sharingTable);
      const searchQuery = table.findColumnByName('searchQuery');
      if (!searchQuery) {
        throw new Error(`Cannot migrate directory access: missing column ${sharingTable}.searchQuery`);
      }
      if (!searchQuery.isNullable) {
        if (sqlite) {
          const nullable = searchQuery.clone();
          nullable.isNullable = true;
          await runner.changeColumn(table, searchQuery, nullable);
        } else {
          await runner.query(`ALTER TABLE ${escape(sharingTable)} MODIFY ${escape('searchQuery')} TEXT NULL`);
        }
      }
      if (sqlite) {
        const violations = await runner.query('PRAGMA foreign_key_check');
        if (violations.length > 0) {
          throw new Error('Cannot migrate directory access: foreign key check failed: ' + JSON.stringify(violations));
        }
      }
      version.version = 45;
      await runner.manager.getRepository(VersionEntity).save(version);
      if (sqlite) {
        await runner.commitTransaction();
      }
      Logger.info(LOG_TAG, 'Migrated directory access columns to database schema version 45');
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      if (sqlite) {
        await runner.query('PRAGMA foreign_keys = ON');
      }
      await runner.release();
    }
  }

  private static async migrateSharingDownloads(connection: Connection, version: VersionEntity): Promise<void> {
    const runner = connection.createQueryRunner();
    const escape = (name: string) => connection.driver.escape(name);
    try {
      if (connection.options.type === 'better-sqlite3') {
        await runner.startTransaction();
      }
      const tableName = connection.getMetadata(SharingEntity).tableName;
      const table = await runner.getTable(tableName);
      if (!table) {
        throw new Error(`Cannot migrate sharing downloads: missing table ${tableName}`);
      }
      if (!table.findColumnByName('preventDownload')) {
        await runner.query(`ALTER TABLE ${escape(tableName)} ADD COLUMN ${escape('preventDownload')} BOOLEAN NOT NULL DEFAULT FALSE`);
      }
      version.version = 46;
      await runner.manager.getRepository(VersionEntity).save(version);
      if (runner.isTransactionActive) {
        await runner.commitTransaction();
      }
      Logger.info(LOG_TAG, 'Migrated sharing download policy to database schema version 46');
    } catch (err) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      throw err;
    } finally {
      await runner.release();
    }
  }
}
