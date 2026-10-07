import {Connection} from 'typeorm';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {UserEntity} from './enitites/UserEntity';
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

    // Version 43 was shipped both with and without the OIDC identity columns.
    // Apply only the known additive changes, without general schema synchronization.
    if (version?.version === 43) {
      await this.migrateOIDCIdentity(connection, version);
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
      version.version = DataStructureVersion;
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
}
