import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { Id } from '../src/index.js';
import { impersonate } from './utils.js';

const { ethers } = pkg;

describe('Transfer', async () => {
  const owner2 = '0x1234567890123456789012345678901234567891';
  let id = null;
  before(async () => {
    id = new Id({
      network: await ethers.provider.getNetwork(),
      provider: ethers.provider,
    });
  });

  it('should transfer ownership of an NFT TLD', async () => {
    const name = 'f';
    const oldOwner = await id.getOwner(name);
    await id.transfer(name, { to: owner2, signer: await impersonate(oldOwner) });
    const newOwner = await id.getOwner(name);
    expect(newOwner).to.equal(owner2);
    expect(newOwner).to.not.equal(oldOwner);
  });
  it('should transfer ownership of an unlocked TLD', async () => {
    const name = 'records';
    const oldOwner = await id.getOwner(name);
    await id.transfer(name, { to: owner2, signer: await impersonate(oldOwner) });
    const newOwner = await id.getOwner(name);
    expect(newOwner).to.equal(owner2);
    expect(newOwner).to.not.equal(oldOwner);
  });

  it('should transfer ownership of SLDs', async () => {
    const testNames = ['purplesauce.forever', 'purplesauce.www', 'purplesauce.eth', 'buffrr.eth'];
    for (const name of testNames) {
      const oldOwner = await id.getOwner(name);
      await id.transfer(name, { to: owner2, signer: await impersonate(oldOwner) });
      const newOwner = await id.getOwner(name);
      expect(newOwner).to.equal(owner2);
      expect(newOwner).to.not.equal(oldOwner);
    }
  });
});
