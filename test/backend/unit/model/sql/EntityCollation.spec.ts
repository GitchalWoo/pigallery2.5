import {expect} from 'chai';
import {DataSource} from 'typeorm';
import {Config} from '../../../../../src/common/config/private/Config';
import {DatabaseType} from '../../../../../src/common/config/private/PrivateConfig';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
import {MediaEntity} from '../../../../../src/backend/model/database/enitites/MediaEntity';
import {PersonEntry} from '../../../../../src/backend/model/database/enitites/person/PersonEntry';

/**
 * The charset and collation of the case-sensitive text columns depend on the DB type.
 * They have to follow the type the connection is built with, not the one at import time
 * (the tests switch between SQLite and MySQL in one process).
 */
describe('Entity column collation', () => {
  const originalType = Config.Database.type;

  afterEach(() => {
    Config.Database.type = originalType;
  });

  const columnsOf = async (type: DatabaseType) => {
    Config.Database.type = type;
    // Only builds the metadata, does not connect.
    const dataSource = new DataSource(type === DatabaseType.mysql
      ? {type: 'mysql', connectorPackage: 'mysql2', database: 'collation_check', entities: SQLConnection.getEntries()}
      : {type: 'better-sqlite3', database: ':memory:', entities: SQLConnection.getEntries()});
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    const media = dataSource.getMetadata(MediaEntity);
    const columns = [
      'metadata.cameraData.model', 'metadata.cameraData.make',
      'metadata.positionData.country', 'metadata.positionData.state', 'metadata.positionData.city',
      'metadata.keywords', 'metadata.faces', 'metadata.persons'
    ].map(p => media.findColumnWithPropertyPath(p));
    columns.push(dataSource.getMetadata(PersonEntry).findColumnWithPropertyPath('name'));
    expect(columns.every(c => !!c)).to.equal(true);
    return columns;
  };

  it('uses the case-sensitive MySQL collation when built for MySQL', async () => {
    // build for SQLite first: that must not leak into the MySQL schema
    await columnsOf(DatabaseType.sqlite);
    for (const column of await columnsOf(DatabaseType.mysql)) {
      expect(column.charset, column.propertyPath).to.equal('utf8mb4');
      expect(column.collation, column.propertyPath).to.equal('utf8mb4_bin');
    }
  });

  it('uses no MySQL collation when built for SQLite', async () => {
    await columnsOf(DatabaseType.mysql);
    for (const column of await columnsOf(DatabaseType.sqlite)) {
      expect(column.collation, column.propertyPath).to.equal(undefined);
    }
  });
});
