import { Interface } from 'ethers';

// ERC-137 registries (https://eips.ethereum.org/EIPS/eip-137)
export const ERC137 = new Interface([
  'function setRecord(bytes32,address,address,uint64)',
  'function setSubnodeRecord(bytes32,bytes32,address,address,uint64)',
  'function setSubnodeOwner(bytes32,bytes32,address)',
  'function setResolver(bytes32,address)',
  'function setTTL(bytes32,uint64)',
  'function setApprovalForAll(address,bool)',
  'function owner(bytes32) view returns (address)',
  'function resolver(bytes32) view returns (address)',
  'function ttl(bytes32) view returns (uint64)',
  'function recordExists(bytes32) view returns (bool)',
]);
