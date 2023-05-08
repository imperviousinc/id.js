import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { createId, impersonate, resetFork } from './utils.js';

const { ethers } = pkg;

const testNames = [
  'purplesauce.www',
  'purplesauce.forever',
];

const commitmentTestNames = [
  'purplesauce.records',
  'purplesauce.eth',
];

describe('Register', async () => {
  let id = null;
  before(async () => {
    await resetFork();
    id = await createId();
  });

  it('should register a name', async () => {
    for (let name of testNames) {
      name = `ABcD${name}`;
      let data = await id.getRegistration(name);
      expect(data.status).to.equal('unregistered');

      const price = await id.getPrice(name, 31536000);
      const tx = await id.register(name, {
        duration: 31536000,
        value: price.buffered,
      });

      await tx.wait();

      data = await id.getRegistration(name.toLowerCase());
      expect(data.status).to.equal('registered');
    }
  });

  it('should register with commitment', async () => {
    for (let name of commitmentTestNames) {
      name = `45678${name}`;
      let data = await id.getRegistration(name);
      expect(data.status).to.equal('unregistered');

      const secret = '0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF';
      let commitment = null;
      commitment = await id.makeCommitment(name, {
        secret,
        duration: 31536000,
      });

      let tx = await id.commit(name, commitment);
      await tx.wait();

      const minAge = await id.getMinCommitmentAge(name);
      await id.provider.send('evm_increaseTime', [Number(minAge)]);
      await id.provider.send('evm_mine');

      const price = await id.getPrice(name, 31536000);
      tx = await id.register(name, {
        duration: 31536000,
        value: price.buffered,
        secret,
      });

      await tx.wait();

      data = await id.getRegistration(name);
      expect(data.status).to.equal('registered');
    }
  });

  it('should register reserved', async () => {
    const name = 'rainbowpunch.records';
    let data = await id.getRegistration(name);
    expect(data.status).to.equal('reserved');

    const signer = await impersonate(data.reservedFor);

    const secret = '0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF';
    const commitment = await id.makeCommitment(name, {
      secret,
      duration: 31536000,
    }, { signer });

    let tx = await id.commit(name, commitment);
    await tx.wait();

    const minAge = await id.getMinCommitmentAge(name);
    await id.provider.send('evm_increaseTime', [Number(minAge)]);
    await id.provider.send('evm_mine');

    const price = await id.getPrice(name, 31536000);
    tx = await id.register(name, {
      duration: 31536000,
      value: price.buffered,
      secret,
      signer,
    });

    await tx.wait();

    data = await id.getRegistration(name);
    expect(data.status).to.equal('registered');
    expect(data.reservedFor).to.equal(null);
  });
});
