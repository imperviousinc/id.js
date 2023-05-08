import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { Id } from '../src/index.js';
import { impersonate } from './utils.js';
import {RawContentHash} from "../src/internal/common/utils.js";

const { ethers } = pkg;

const testNames = [
  'purplesauce.www',
  'purplesauce.forever',
  // unwrapped
  'buffrr.eth',
];

describe('Manage', async () => {
  let id = null;
  before(async () => {
    id = new Id({
      network: await ethers.provider.getNetwork(),
      provider: ethers.provider,
    });
  });

  it('should allow changing manager/operator', async () => {
    for (let name of testNames) {
      const currentSigner = await ethers.provider.getSigner();
      const currentAddress = await currentSigner.getAddress();

      const signer = await impersonate(await id.getOwner(name));
      const tx = await id.setManager(name, currentAddress, {
        signer,
      });

      await tx.wait();
      const tx2 = await id.setRecords(name, {
        contentHash: new RawContentHash('0x01'),
      });
      await tx2.wait();
      assert.equal((await id.getContentHash(name)).hexBytes, '0x01');
    }
  });

  it('should handle name wrapper operator differences', async () => {
    const currentSigner = await ethers.provider.getSigner();
    const currentAddress = await currentSigner.getAddress();

    // getManager should equal owner since there can be multiple approved operators in the public resolver
    assert.equal(await id.getManager('purplesauce.eth'), await id.getOwner('purplesauce.eth'));

    // wrap the name
    const signer = await impersonate(await id.getOwner('purplesauce.eth'));
    let fail = false;
    try {
      await id.setManager('purplesauce.eth', currentAddress, {
        signer,
      });
    } catch (e) {
      fail = true;
    }
    assert.equal(fail, true, 'should fail to set manager on wrapped name for now');
  });
});
