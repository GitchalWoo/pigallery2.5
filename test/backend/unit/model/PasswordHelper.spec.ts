import {expect} from 'chai';
import {PasswordHelper} from '../../../../src/backend/model/PasswordHelper';

describe('PasswordHelper - AUD12 async hashing and comparison', () => {
  it('should asynchronously hash and compare passwords correctly', async () => {
    const raw = 'myStrongPassword123!';
    const hash = await PasswordHelper.cryptPasswordAsync(raw);

    expect(hash).to.be.a('string');
    expect(hash).to.not.equal(raw);

    const match = await PasswordHelper.comparePasswordAsync(raw, hash);
    expect(match).to.be.true;

    const noMatch = await PasswordHelper.comparePasswordAsync('wrongPassword', hash);
    expect(noMatch).to.be.false;
  });

  it('should gracefully handle invalid hash formats', async () => {
    const match = await PasswordHelper.comparePasswordAsync('test', 'not-a-valid-bcrypt-hash');
    expect(match).to.be.false;
  });
});
