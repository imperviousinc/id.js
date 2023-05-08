import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { CommitmentNotRequiredError } from '../src/index.js';
import { createId, resetFork } from './utils.js';

const { ethers } = pkg;

describe('Commitments', async () => {
  let id = null;
  before(async () => {
    await resetFork();
    id = await createId();
  });

  it('should generate commitments', async () => {
    const name = 'purpelsauce.www';
    const commitment = await id.makeCommitment(name, {
      secret: '0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
    });
    assert.equal(commitment.length, 66);
  });

  it('should not make commitment if not required', async () => {
    const name = 'purpelsauce.www';
    const commitment = '0xd3f57ac725a77d52fefd152d07f21245f10d90815e2599b460756cb3d31320ba';

    const requiresCommitment = await id.requiresCommitment(name);
    assert.equal(requiresCommitment, false);

    try {
      await id.commit(name, commitment);
    } catch (e) {
      assert.instanceOf(e, CommitmentNotRequiredError);
    }
  });

  it('should commit', async () => {
    const name = 'purpelsauce.records';
    const requiresCommitment = await id.requiresCommitment(name);
    assert.equal(requiresCommitment, true);

    const commitment = await id.makeCommitment(name, {
      secret: '0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
    });

    const commitmentTime1 = await id.getCommitmentTime(name, commitment);
    assert.equal(commitmentTime1, BigInt(0));

    const tx = await id.commit(name, commitment);
    await tx.wait();

    const commitmentTime2 = await id.getCommitmentTime(name, commitment);
    assert.notEqual(commitmentTime2, BigInt(0));
  });

  it('should get min/max ages', async () => {
    const name = 'purpelsauce.www';
    const min = await id.getMinCommitmentAge(name);
    const max = await id.getMaxCommitmentAge(name);

    assert.equal(min, 60);
    assert.equal(max, 604800);
  });
});
