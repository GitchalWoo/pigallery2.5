import {expect} from 'chai';
import {DBTestHelper} from '../../../DBTestHelper';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
import {UserEntity} from '../../../../../src/backend/model/database/enitites/UserEntity';
import {SharingEntity} from '../../../../../src/backend/model/database/enitites/SharingEntity';
import {VersionEntity} from '../../../../../src/backend/model/database/enitites/VersionEntity';
import {UserRoles} from '../../../../../src/common/entities/UserDTO';
import {DataStructureVersion} from '../../../../../src/common/DataStructureVersion';

DBTestHelper.describe()('OIDC schema migration', (helper: DBTestHelper) => {
  beforeEach(async () => { await helper.initDB(); });
  afterEach(async () => { await helper.clearDB(); });

  for (const missingColumns of [
    ['oidcIssuer', 'oidcSubject'], ['oidcIssuer'], ['oidcSubject'], []
  ]) {
    it(`should preserve existing users and shares at version 43 (missing: ${missingColumns.join(', ') || 'none'})`, async () => {
      const conn = await SQLConnection.getConnection();
      const user = await conn.getRepository(UserEntity).save({
        name: 'existing-user', password: 'existing-password-hash', role: UserRoles.Admin,
        overrideAllowBlockList: true, allowQuery: {type: 100, value: '/allowed'} as any,
        oidcIssuer: 'https://issuer.example', oidcSubject: 'existing-subject'
      });
      const share = await conn.getRepository(SharingEntity).save({
        sharingKey: 'existing-share', creator: user, searchQuery: {type: 100, value: '/'} as any,
        expires: Date.now() + 100000, timeStamp: Date.now()
      });
      for (const column of missingColumns) {
        await conn.query(`ALTER TABLE ${conn.driver.escape('user_entity')} DROP COLUMN ${conn.driver.escape(column)}`);
      }
      const version = (await conn.getRepository(VersionEntity).find())[0];
      version.version = 43;
      await conn.getRepository(VersionEntity).save(version);
      await SQLConnection.close();

      const migrated = await SQLConnection.getConnection();
      const expected = {...user};
      for (const column of missingColumns) {
        (expected as unknown as Record<string, unknown>)[column] = null;
      }
      expect(await migrated.getRepository(UserEntity).findOneBy({id: user.id})).to.deep.equal(expected);
      const restoredShare = await migrated.getRepository(SharingEntity).findOne({
        where: {id: share.id}, relations: {creator: true}
      });
      expect(restoredShare.sharingKey).to.equal(share.sharingKey);
      expect(restoredShare.searchQuery).to.deep.equal(share.searchQuery);
      expect(restoredShare.creator.id).to.equal(user.id);
      expect((await migrated.getRepository(VersionEntity).find())[0].version).to.equal(DataStructureVersion);
      await SQLConnection.close();
      const reopened = await SQLConnection.getConnection();
      expect(await reopened.getRepository(UserEntity).findOneBy({id: user.id})).to.deep.equal(expected);
    });
  }
});
