import { Contract } from 'ethers';
import { getContractAddress } from './utils.js';

const mutliResovlerABI = [
  'function resolve(address,bytes,bytes[]) view returns (bytes[],address)',
];

const controllerResolverABI = [
  'error ControllerNotFound(address,bytes32)',
  'error UnsupportedControllable(address)',
  'function multicall(address,address,bytes32,bytes4,bytes[]) view returns ((bytes,bool)[] returnData,address)',
  'function findController(address,address,bytes32,bytes4) view returns (address)',
];

export const RegisterStatus = {
  Taken: 0,
  Available: 1,
  Reserved: 2,
  Closed: 3,
};

export function getMultiRegistryResolver(networkId, provider) {
  return new Contract(getContractAddress(networkId, 'multiRegistryResolver'), mutliResovlerABI, provider);
}

export function getControllerResolver(networkId, provider) {
  return new Contract(getContractAddress(networkId, 'controllerResolver'), controllerResolverABI, provider);
}
