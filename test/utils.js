import pkg from 'hardhat';
import { Id } from '../src/index.js';

const { ethers, network } = pkg;

export async function impersonate(address, fund = true) {
  const signer = await ethers.getImpersonatedSigner(address);
  const defaultSigner = await ethers.provider.getSigner();

  if (fund) {
    await defaultSigner.sendTransaction({
      to: address,
      value: BigInt('8000000000000000000'),
    });
  }

  return signer;
}

export async function resetFork() {
  const { url: jsonRpcUrl, blockNumber } = network.config.forking;
  await ethers.provider.send('hardhat_reset', [
    {
      forking: { jsonRpcUrl, blockNumber },
    },
  ]);
}

export async function createId() {
  return new Id({
    network: await ethers.provider.getNetwork(),
    provider: ethers.provider,
  });
}
