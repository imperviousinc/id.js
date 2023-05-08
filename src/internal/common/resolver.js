import { dnsEncode, getAddress, Interface } from 'ethers';
import { RawAddress, RawContentHash, namehash } from './utils.js';

export const Resolver = new Interface([
  // ITextResolver
  'function text(bytes32,string) view returns(string)',
  'function setText(bytes32,string,string)',

  // ILegacyAddressResolver
  'function addr(bytes32) view returns(address)',
  'function setAddr(bytes32,address)',

  // IAddressResolver
  'function addr(bytes32, uint256) view returns (bytes)',
  'function setAddr(bytes32,uint256,bytes)',

  // IContentHashResolver
  'function contenthash(bytes32) view returns (bytes)',
  'function setContenthash(bytes32,bytes)',

  // INameResolver
  'function name(bytes32) view returns (string)',
  'function setName(bytes32,string)',

  // IPublicKeyResolver
  'function pubkey(bytes32) view returns (bytes)',
  'function setPubkey(bytes32,bytes32,bytes32)',

  // IABIResolver
  'function ABI(bytes32, uint256) view returns (bytes)',
  'function setABI(bytes32,uint256,bytes)',

  // IInterfaceResolver
  'function interfaceImplementer(bytes32, bytes4) view returns (address)',
  'function setInterface(bytes32,bytes4,address)',

  // IDNSResolver
  'function dnsRecord(bytes32, bytes32, uint16) view returns (bytes)',
  'function setDNSRecords(bytes32,bytes)',

  // IMulticallable
  'function multicall(bytes[]) returns(bytes[])',
]);

export async function setRecords(resolver, domain, recordSets) {
  const calls = await encodeSetRecords(domain, recordSets);
  if (calls.length > 1) {
    return resolver.multicall(calls);
  }

  const data = {
    to: resolver.target,
    data: calls[0],
  };

  return resolver.runner.sendTransaction(data);
}

export async function encodeSetRecords(domain, recordSets) {
  const calls = [];
  if (!recordSets) throw new Error('recordSets is required');

  if (recordSets.dns) calls.push(await encodeSetDnsRecords(domain, recordSets.dns));
  if (recordSets.text) calls.push(...await encodeSetTextCalls(domain, recordSets.text));
  if (recordSets.contentHash) calls.push(await encodeSetContentHashCall(domain, recordSets.contentHash));
  if (recordSets.address) calls.push(...await encodeSetAddrCalls(domain, recordSets.address));
  if (calls.length === 0) {
    throw new Error('nothing to set');
  }
  return calls;
}

export async function reverseLookup(mrr, registry, address) {
  const name = `${address.slice(2).toLowerCase()}.addr.reverse`;
  const node = namehash(name);
  const dnsLikeName = dnsEncode(name);
  const calls = [
    Resolver.encodeFunctionData('name', [node]),
  ];
  const [returnData] = await mrr.resolve.staticCall(registry.target, dnsLikeName, calls);
  const returns = returnData.toArray()[0];
  if (!returns) return null;
  const result = Resolver.decodeFunctionResult('name', returns);
  if (!result[0] || result.length === 0) return null;

  return result[0];
}

export async function getRecords(mrr, registry, domain, recordIds) {
  const dnsLikeName = dnsEncode(domain.name);
  const calls = [];
  const {
    dns, text, contentHash, address,
  } = recordIds;
  let dnsDecoder = null; let contentHashDecoder = null; let textDecoder = null; let
    addressDecoder = null;

  if (dns) {
    const [calldatas, decoder] = await encodeDnsRecordCalls(domain, dns);
    calls.push(...calldatas);
    dnsDecoder = decoder;
  }
  if (text) {
    const [calldatas, decoder] = await encodeTextCalls(domain, text);
    calls.push(...calldatas);
    textDecoder = decoder;
  }
  if (address) {
    const [calldatas, decoder] = await encodeAddrCalls(domain, address);
    calls.push(...calldatas);
    addressDecoder = decoder;
  }
  if (contentHash) {
    const [calldata, decoder] = await encodeContentHashCall(domain);
    calls.push(calldata);
    contentHashDecoder = decoder;
  }

  // batch & decode responses
  const [returnData] = await mrr.resolve.staticCall(registry.target, dnsLikeName, calls);
  const responses = {};
  const returns = returnData.toArray();

  if (dns) responses.dns = await dnsDecoder(returns.splice(0, dns.length));
  if (text) responses.text = await textDecoder(returns.splice(0, text.length));
  if (addressDecoder) responses.address = await addressDecoder(returns.splice(0, address.length));
  if (contentHash) responses.contentHash = await contentHashDecoder(returns.splice(0, 1)[0]);

  return responses;
}

async function encodeContentHashCall(domain) {
  const call = Resolver.encodeFunctionData('contenthash', [domain.namehash]);
  const decoder = async (returnData) => new RawContentHash(Resolver.decodeFunctionResult('contenthash', returnData).toArray()[0]);
  return [call, decoder];
}

async function encodeAddrCalls(domain, coinTypes) {
  const calls = coinTypes.map((coinType) => {
    coinType = parseCoinType(coinType);
    if (coinType === 60) {
      return Resolver.encodeFunctionData('addr(bytes32)', [domain.namehash]);
    }
    return Resolver.encodeFunctionData(
      'addr(bytes32,uint256)',
      [domain.namehash, coinType],
    );
  });

  const decoder = async (returnDatas) => {
    const responses = {};

    for (let [i, coinType] of coinTypes.entries()) {
      coinType = parseCoinType(coinType);
      const coinTypeStr = coinTypeToString(coinType);
      if (!returnDatas[i]) {
        responses[coinTypeStr] = null;
        continue;
      }

      if (coinType === 60) {
        const returnData = Resolver.decodeFunctionResult('addr(bytes32)', returnDatas[i]).toArray()[0];
        responses[coinTypeStr] = getAddress(returnData);
        continue;
      }

      const returnData = Resolver.decodeFunctionResult('addr(bytes32,uint256)', returnDatas[i]).toArray()[0];
      if (returnData === '0x' || returnData === null) {
        responses[coinTypeStr] = null;
        continue;
      }

      responses[coinTypeStr] = new RawAddress(returnData);
    }

    return responses;
  };

  return [calls, decoder];
}

async function encodeSetContentHashCall(domain, contentHash) {
  if (!(contentHash instanceof RawContentHash)) {
    throw new Error('contentHash must be instance of RawContentHash');
  }

  return Resolver.encodeFunctionData('setContenthash', [domain.namehash, contentHash.hexBytes]);
}

async function encodeSetAddrCalls(domain, address) {
  const calls = [];
  for (let [inputCoinType, coinAddr] of Object.entries(address)) {
    const coinType = parseCoinType(inputCoinType);
    if (coinAddr instanceof RawAddress) {
      calls.push(
        Resolver.encodeFunctionData(
          'setAddr(bytes32,uint256,bytes)',
          [domain.namehash, coinType, coinAddr.hexBytes],
        ),
      );
      continue;
    }
    if (coinType === 60) {
      calls.push(
        Resolver.encodeFunctionData(
          'setAddr(bytes32,address)',
          [domain.namehash, coinAddr],
        ),
      );
      continue;
    }
    throw new Error(`Coin type '${inputCoinType}' is not supported`);
  }
  return calls;
}

async function encodeSetTextCalls(domain, keys) {
  const calls = [];
  for (const [key, value] of Object.entries(keys)) {
    calls.push(Resolver.encodeFunctionData('setText', [domain.namehash, key, value]));
  }
  return calls;
}

async function encodeSetDnsRecords(domain, rrSets) {
  const ensip6 = await import('./ensip6.js');
  const buf = ensip6.encodeDNSRRSets(rrSets);
  return Resolver.encodeFunctionData('setDNSRecords', [domain.namehash, buf]);
}

async function encodeDnsRecordCalls(domain, rrSetIds) {
  const ensip6 = await import('./ensip6.js');
  const callDatas = rrSetIds.map((rrSetId) => {
    const [setNamehash, setType] = ensip6.rrSetIdEncode(domain, rrSetId);
    return Resolver.encodeFunctionData('dnsRecord', [domain.namehash, setNamehash, setType]);
  });

  const decoder = async (returnDatas) => {
    const rrs = [];
    for (const data of returnDatas) {
      const [wire] = Resolver.decodeFunctionResult('dnsRecord', data);
      const decoded = ensip6.rrSetDecode(wire);
      if (decoded.length === 0) continue;
      rrs.push(...decoded);
    }

    return rrs;
  };
  return [callDatas, decoder];
}

async function encodeTextCalls(domain, keys) {
  const callDatas = keys.map((key) => Resolver.encodeFunctionData('text', [domain.namehash, key]));

  const decoder = async (returnDatas) => {
    if (keys.length === 1 && returnDatas.length === 0) {
      return { [keys[0]]: null };
    }
    const values = returnDatas.map((data) => {
      const [result] = Resolver.decodeFunctionResult('text', data);
      return result;
    });
    return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  };
  return [callDatas, decoder];
}

function parseCoinType(coinType) {
  if (coinType === 'ETH') return 60;
  if (typeof coinType === 'string' && !/^\d+$/.test(coinType)) throw new Error(`unsupported coin type ${coinType}`);

  const parsed = parseInt(coinType, 10);
  if (!Number.isInteger(parsed)) throw new Error(`unsupported coin type ${coinType}`);
  return parsed;
}

function coinTypeToString(coinType) {
  if (coinType === 60) return 'ETH';
  return coinType.toString();
}
