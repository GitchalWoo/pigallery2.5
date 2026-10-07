// A few suites use the shared managers without owning their final teardown.
// Close the remaining pool and scheduled work rather than forcing Mocha to exit.
exports.mochaHooks = {
  async afterAll() {
    const {ObjectManagers} = require('../src/backend/model/ObjectManagers');
    await ObjectManagers.reset();
  },
};
