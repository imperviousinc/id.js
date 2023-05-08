import {assert} from 'chai';
import pkg from 'hardhat';
import {Id} from '../src/index.js';
import {resetFork} from './utils.js';

const {ethers} = pkg;

describe('Multicall', async () => {
  /**
   *
   * @type {Id}
   */
  let id = null;
  before(async () => {
    await resetFork();

  });

  it('should batch calls', async () => {
    let callCount = 0;
    const provider = new Proxy(ethers.provider, {
      get: function (target, property, receiver) {
        if (property === 'call') {
          return async function (...args) {
            callCount++;
            return target.call(...args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
      set: function (target, property, value, receiver) {
        return Reflect.set(target, property, value, receiver);
      }
    });

    id = new Id({
      network: await provider.getNetwork(),
      provider: provider,
    })

    await Promise.all([
      id.getOwner('purplesauce.eth'),
      id.getOwner('purplesauce.www'),
      id.getOwner('purplesauce.forever'),
      id.getManager('purplesauce.eth'),
      id.getRegistration('purplesauce.eth'),
      id.getRegistration('purplesauce.www'),
      id.getRegistration('purplesauce.forever'),
      id.getRecords('vitalik.eth', {
        text: ['url', 'email', 'notice', 'avatar', 'proof', 'social'],
        address: [60, 0],
        dns: [
          {
            name: 'vitalik.eth',
            type: 'A',
          },
          {
            name: '_443._tcp.vitalik.eth',
            type: 'TLSA',
          },
        ]
      }),
      id.getOwner('live.forever'),
      id.getText('vitalik.eth', 'url'),
      id.getPrice('bob.eth', 365*24*60*60),
      id.getAddress('bitcoin.contract'),
      id.getName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
      id.getDns('impervious.forever', 'A')
    ]);

    assert.equal(callCount, 1);

  });

});
