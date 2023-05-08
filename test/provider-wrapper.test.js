import {assert} from 'chai';
import pkg from 'hardhat';
import {Id} from '../src/index.js';
import {createId, impersonate, resetFork} from './utils.js';
import {Contract} from "ethers";

const {ethers} = pkg;

describe('Wrapped provider', async () => {
  /**
   *
   * @type {Id}
   */
  let id = null;
  before(async () => {
    await resetFork();
    id = await createId();
  });

  it('should resolve names', async () => {
    const signer = await impersonate(await id.getOwner('purplesauce.forever'))
    await id.setRecords('purplesauce.forever', {
      address: {
        'ETH': '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',
      }
    }, {signer})

    const contract = new Contract('purplesauce.forever',
      ['function latestAnswer() view returns (int256)'], id.provider);
    const result = await contract.latestAnswer();
    assert.equal(result.toString(), '186309742000');

    // // current balance
    const before = await id.provider.getBalance('impervious.forever');
    const signer2 = await id.provider.getSigner();
    await signer2.sendTransaction({
      to: 'impervious.forever',
      value: ethers.parseEther('0.1'),
    });
    const after = await id.provider.getBalance('impervious.forever');
    assert.equal(after - before, ethers.parseEther('0.1'));

    assert.equal(
      await id.provider.lookupAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'), 'vitalik.eth')
    assert.equal(
      await id.provider.lookupAddress('0xDCbc1ddfBc52d69B10549a4A55B161545CA324fA'), 'buffrr.forever')
  });

});
