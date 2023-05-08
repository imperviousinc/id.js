import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { createId, resetFork } from './utils.js';

const { ethers } = pkg;

describe('Renew', async () => {
  let id = null;
  before(async () => {
    await resetFork();
    id = await createId();
  });

  it('should read expiry', async () => {
    const data = await id.getRegistration('purplesauce.www');
    assert.equal(data.expiry, BigInt(1708575323));
  });

  it('should renew', async () => {
    const testNames = ['purplesauce.www',  'purplesauce.eth', 'buffrr.eth']
    for (let name of testNames) {
      const data = await id.getRegistration(name);
      const price = await id.getPrice(name, 31536000);
      const tx = await id.renew(name, {
        duration: 31536000,
        value: price.buffered,
      });
      await tx.wait();

      const data2 = await id.getRegistration(name);
      assert.equal(data2.expiry, data.expiry + BigInt(31536000));
    }

  });
});
