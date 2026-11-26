import {SearchManager} from '../../../../../src/backend/model/database/SearchManager';
import {CoverManager} from '../../../../../src/backend/model/database/CoverManager';
import {ObjectManagers} from '../../../../../src/backend/model/ObjectManagers';
import {DBTestHelper} from '../../../DBTestHelper';
import {SearchQueryTypes, TextSearch, TextSearchQueryMatchTypes} from '../../../../../src/common/entities/SearchQueryDTO';
import {ParentDirectoryDTO} from '../../../../../src/common/entities/DirectoryDTO';
import {TestHelper} from '../../../../TestHelper';
import {Config} from '../../../../../src/common/config/private/Config';
import {SortByTypes} from '../../../../../src/common/entities/SortingMethods';
import {ClientSortingConfig} from '../../../../../src/common/config/public/ClientConfig';

const chai = require('chai');
const {expect} = chai;

// runs the tests on every enabled database (SQLite, and MySQL when it is reachable)
DBTestHelper.describe()('SearchManager directory sorting', (sqlHelper: DBTestHelper) => {
  /**
   * root
   * |- r.jpg
   * |-> 2020
   *     |-> Summer
   *         |- 1.jpg
   *         |- 3.jpg
   * |-> 2021
   *     |-> Autumn
   *         |- 5.jpg
   *     |-> Summer
   *         |- 2.jpg
   *         |- 4.jpg
   */
  const trip: TextSearch = {
    value: 'trip',
    matchType: TextSearchQueryMatchTypes.exact_match,
    type: SearchQueryTypes.keyword
  };

  const addPhoto = (dir: ParentDirectoryDTO, name: string): void => {
    const p = TestHelper.getPhotoEntry(dir);
    p.name = name;
    p.metadata.keywords = ['trip'];
  };

  const getNames = async (ascending: boolean): Promise<string[]> => {
    const sm = new SearchManager();
    const media = await sm.getNMedia(DBTestHelper.defaultSession, trip, [{
      method: SortByTypes.Directory,
      ascending
    }], 10, true);
    return media.map((m) => m.name);
  };

  before(async () => {
    await sqlHelper.initDB();
    const root: ParentDirectoryDTO = TestHelper.getDirectoryEntry();
    const y2020 = TestHelper.getDirectoryEntry(root, '2020');
    const y2021 = TestHelper.getDirectoryEntry(root, '2021');
    const summer2020 = TestHelper.getDirectoryEntry(y2020, 'Summer');
    const autumn2021 = TestHelper.getDirectoryEntry(y2021, 'Autumn');
    const summer2021 = TestHelper.getDirectoryEntry(y2021, 'Summer');
    addPhoto(root, 'r.jpg');
    addPhoto(summer2020, '1.jpg');
    addPhoto(summer2020, '3.jpg');
    addPhoto(autumn2021, '5.jpg');
    addPhoto(summer2021, '2.jpg');
    addPhoto(summer2021, '4.jpg');
    // saveToDB only links existing child dirs, so save the nested dirs bottom-up
    for (const d of [summer2020, autumn2021, summer2021, y2020, y2021, root]) {
      await DBTestHelper.persistTestDir(d);
    }
    await ObjectManagers.getInstance().init();
  });

  after(async () => {
    await sqlHelper.clearDB();
  });

  beforeEach(() => {
    Config.loadSync();
  });

  it('should order by directory path, so same-named directories are not interleaved', async () => {
    expect(await getNames(true)).to.deep.equal(['r.jpg', '1.jpg', '3.jpg', '5.jpg', '2.jpg', '4.jpg']);
  });

  it('should reverse the directory order when descending', async () => {
    expect(await getNames(false)).to.deep.equal(['4.jpg', '2.jpg', '5.jpg', '3.jpg', '1.jpg', 'r.jpg']);
  });

  it('should pick the album cover by directory with AlbumCover.Sorting', async () => {
    Config.AlbumCover.SearchQuery = null;
    const cm = new CoverManager();
    Config.AlbumCover.Sorting = [new ClientSortingConfig(SortByTypes.Directory, false)];
    expect((await cm.getCoverForAlbum(DBTestHelper.defaultSession, {searchQuery: trip})).name).to.equal('4.jpg');
    Config.AlbumCover.Sorting = [new ClientSortingConfig(SortByTypes.Directory, true)];
    expect((await cm.getCoverForAlbum(DBTestHelper.defaultSession, {searchQuery: trip})).name).to.equal('r.jpg');
  });
});
