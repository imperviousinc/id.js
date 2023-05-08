import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { Id } from '../src/index.js';
import { createId, impersonate, resetFork } from './utils.js';
import {RawAddress, RawContentHash} from "../src/internal/common/utils.js";

const { ethers } = pkg;

const testNames = [
  'purplesauce.www',
  'purplesauce.forever',
  'purplesauce.eth',
];

const dns = [
  {
    type: 'A',
    ttl: 3600,
    class: 'IN',
    data: '127.0.0.1',
  },
  {
    type: 'TXT',
    ttl: 3600,
    class: 'IN',
    data: 'hello world',
  },
  {
    type: 'TXT',
    ttl: 3600,
    class: 'IN',
    data: 'hello world 2',
  },
  {
    name: 'nothanks.invalid',
    type: 'TXT',
    ttl: 3600,
    class: 'IN',
    data: ['hello', 'world'],
  },
  {
    type: 'NS',
    ttl: 3600,
    class: 'IN',
    data: 'example.com',
  },
  {
    type: 'DS',
    ttl: 3600,
    class: 'IN',
    data: {
      keyTag: 30909,
      algorithm: 8,
      digestType: 2,
      digest: 'E2D3C916F6DEEAC73294E8268FB5885044A833FC5459588F4A9184CFC41A5766',
    },
  },
  {
    type: 'DNSKEY',
    ttl: 3600,
    class: 'IN',
    data: {
      flags: 257,
      algorithm: 1,
      key: 'mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==',
    },
  },
];

const text = {
  url: 'https://purplesauce.www',
  email: 'hey@purplesauce.www',
  description: 'purplesauce is awesome',
};

const address = {
  // eth
  'ETH': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  // btc
  '0': new RawAddress('0x009010587f8364b964fcaa70687216b53bd2cbd798'),
};

const contentHash = new RawContentHash('0x01');

function copyDnsForName(name) {
  const d = JSON.parse(JSON.stringify(dns));
  d.forEach((record) => {
    record.name = record.name ?? name;
  });
  return d;
}

describe('Records', async () => {
  /**
   *
   * @type {Id}
   */
  let id = null;
  before(async () => {
    await resetFork();
    id = await createId();
  });

  it('should set DNS records', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const manager = await id.getManager(testNames[i]);
      const signer = await impersonate(manager);
      const name = testNames[i];
      const rrSets = copyDnsForName(name);
      const tx = await id.setRecords(name, { dns: rrSets }, { signer });
      await tx.wait();
    }
  });

  it('should get DNS records', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const expected = copyDnsForName(name);

      const keys = Object.keys(expected).map((key) => ({
        name: expected[key].name,
        type: expected[key].type,
      })).reduce((acc, current) => {
        if (acc.findIndex((item) => item.name === current.name && item.type === current.type) === -1) {
          acc.push(current);
        }
        return acc;
      }, []);
      const actual = await id.getDns(name, keys);
      assert.deepEqual(actual, expected);
    }

    // get non existent record
    const name = 'nothanks.invalid';
    const keys = [{ name: 'nothanks.invalid', type: 'TXT' }];
    const expected =  [];
    const actual = await id.getDns(name, keys);
    assert.deepEqual(actual, expected);
  });

  it('should set text records', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const signer = await impersonate(await id.getManager(name));
      const tx = await id.setRecords(name, { text }, { signer });
      await tx.wait();
    }
  });

  it('should get text records', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const expected = text;
      const actual = await id.getText(name,  Object.keys(expected) );
      assert.deepEqual(actual, expected);
    }

    // get non existent record
    const name = 'nothanks.invalid';
    const actual = await id.getText(name, 'url');
    assert.deepEqual(actual, null);
  });

  it('should set addresses', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const signer = await impersonate(await id.getManager(name));
      const tx = await id.setRecords(name, { address }, { signer });
      await tx.wait();
    }
  });

  it('should get addresses', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const expected = address;
      const actual = await id.getAddress(name, Object.keys(expected));
      assert.deepEqual(actual, expected);
    }

    // get non existent record
    const name = 'nothanks.invalid';
    const actual = await id.getAddress(name, 0);
    assert.deepEqual(actual, null);
  });

  it('should fail to get non-existent coin type', async () => {
    let failed = false;
    try {
      await id.getAddress('vitalik.eth', ['ETHX']);
    } catch (e) {
      failed = true;
    }
    assert(failed);
  });

  it('should set a single text record', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const signer = await impersonate(await id.getManager(name));
      const tx = await id.setText(name, {'url': 'https://purplesauce.f'}, { signer });
      await tx.wait();
      const expected = 'https://purplesauce.f';
      const actual = await id.getText(name, 'url');
      assert.deepEqual(actual, expected);
    }
  });

  it('should get/set content hash', async () => {
    for (let i = 0; i < testNames.length; i++) {
      const name = testNames[i];
      const signer = await impersonate(await id.getManager(name));
      const tx = await id.setContentHash(name, contentHash , { signer });

      await tx.wait();
      assert.equal((await id.getContentHash(name)).hexBytes, contentHash.hexBytes);
    }
  });
});
