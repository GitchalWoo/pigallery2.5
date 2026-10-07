import {expect} from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {Config} from '../../../../../src/common/config/private/Config';
import {SQLConnection} from '../../../../../src/backend/model/database/SQLConnection';
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

  it('should migrate users', async () => {
    const conn = await SQLConnection.getConnection();
    const a = new UserEntity();
    a.name = 'migrated admin';
    a.password = PasswordHelper.cryptPassword('Test admin');
    a.role = UserRoles.Admin;
    await conn.getRepository(UserEntity).save(a);

    const version = (await conn.getRepository(VersionEntity).find())[0];
    version.version--;
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

    // Reopen connection: triggers safe schemeSync
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
