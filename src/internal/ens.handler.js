import { Contract, Interface, ZeroAddress } from 'ethers';
import { getContractAddress, Price } from './common/utils.js';
import {
  encodeSetRecords, getRecords, Resolver, reverseLookup, setRecords,
} from './common/resolver.js';
import { getControllerResolver, getMultiRegistryResolver } from './common/multiresolver.js';
import { ERC137 } from './common/erc137.js';

const ifaceBase = '0x612e8c09';

export class EnsHandler {
  #network = null;

  #provider = null;

  #registry = null;

  #registrar = null;

  #nameWrapper = null;

  #nameWrapperAbi = [
    'function getData(uint256) view returns (address,uint32,uint64)',
    'function ownerOf(uint256) view returns (address)',
    'function safeTransferFrom(address,address,uint256,uint256,bytes)',
    'function setResolver(bytes32,address)',
  ];

  #controller = new Interface([
    'error CommitmentTooNew(bytes32)',
    'error CommitmentTooOld(bytes32)',
    'error NameNotAvailable(string)',
    'error DurationTooShort(uint256)',
    'error ResolverRequiredWhenDataSupplied()',
    'error UnexpiredCommitmentExists(bytes32)',
    'error InsufficientValue()',
    'error Unauthorised(bytes32)',
    'error MaxCommitmentAgeTooLow()',
    'error MaxCommitmentAgeTooHigh()',
    'function rentPrice(string,uint256) view returns (tuple(uint256,uint256) Price)',
    'function available(string) returns (bool)',
    'function makeCommitment(string,address,uint256,bytes32,address,bytes[],bool,uint16) pure returns (bytes32)',
    'function register(string,address,uint256,bytes32,address,bytes[],bool,uint16) payable',
    'function renew(string,uint256) payable',
    'function commit(bytes32)',
    'function minCommitmentAge() view returns (uint256)',
    'function maxCommitmentAge() view returns (uint256)',
    'function commitments(bytes32) view returns (uint256)',
  ]);

  #registrarAbi = [
    'function nameExpires(uint256) view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    'function safeTransferFrom(address,address,uint256)',
    'function setResolver(address)',
    'function reclaim(uint256,address)',
    'function owner() view returns(address)',
  ];

  constructor(options) {
    this.update(options);
  }

  update(options) {
    if (options.provider) {
      this.#provider = options.provider;
    }
    if (options.network) {
      this.#network = options.network;
    }

    this.#init();
  }

  async getMinCommitmentAge(domain) {
    const [results] = await this.#controllerMulticall(domain, [
      { name: 'minCommitmentAge', args: [] },
    ]);

    return results[0].data;
  }

  async getMaxCommitmentAge(domain) {
    const [results] = await this.#controllerMulticall(domain, [
      { name: 'maxCommitmentAge', args: [] },
    ]);

    return results[0].data;
  }

  async getCommitmentTime(domain, commitment) {
    const [results] = await this.#controllerMulticall(domain, [
      { name: 'commitments', args: [commitment] },
    ]);

    if (!results[0].success) {
      throw new Error('Failed to get commitment');
    }

    return results[0].data;
  }

  async commit(domain, commitment, options) {
    if (!domain.isSLD()) {
      throw new Error('Cannot commit non-SLD');
    }

    const controllerAddress = await this.#findController(domain);
    const controller = new Contract(controllerAddress, this.#controller, this.#provider);
    const signer = options?.signer || await this.#provider.getSigner();
    const controllerWithSigner = controller.connect(signer);
    return controllerWithSigner.commit(commitment);
  }

  async makeCommitment(domain, options) {
    const data = await this.#getRegistrationData(domain, options);
    const [results] = await this.#controllerMulticall(domain, [{
      name: 'makeCommitment',
      args: data.args,
    }]);

    if (!results[0].success) {
      throw new Error('Commitment failed');
    }

    return results[0].data;
  }

  async register(domain, options) {
    const data = await this.#getRegistrationData(domain, options);
    const [results, address] = await this.#controllerMulticall(domain, [
      { name: 'available', args: [domain.sld] },
    ]);
    if (!results[0].success) {
      throw new Error(`Unsupported controller ${address} for .${domain.parent.name}`);
    }
    if (!results[0].data) {
      throw new Error(`Name ${domain.name} is already taken`);
    }

    const contract = new Contract(address, this.#controller, this.#provider);
    const contractWithSigner = contract.connect(data.signer);
    const txOptions = options.value ? { value: options.value } : {};
    data.args.push(txOptions);
    return contractWithSigner.register(...data.args);
  }

  async getName(address) {
    const mrr = getMultiRegistryResolver(this.#network.chainId, this.#provider);
    return reverseLookup(mrr, this.#registry, address.sld);
  }

  async #getRegistrationData(domain, options) {
    if (!domain.isSLD()) {
      throw new Error('Cannot make commitment for non-SLD');
    }
    if (!options.secret) {
      throw new Error('Must provide secret');
    }
    if (!options.duration) {
      throw new Error('Must provide duration');
    }

    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();
    const owner = options.owner || signerAddress;
    const resolver = options.resolver ?? getContractAddress(this.#network.chainId, 'ensResolver');
    const recordData = await encodeSetRecords(domain, {
      address: {
        ETH: owner,
      },
    });
    const reverseRecord = false;
    const fuses = 0;

    return {
      signer,
      args: [
        domain.sld,
        owner,
        options.duration,
        options.secret,
        resolver,
        recordData,
        reverseRecord,
        fuses,
      ],
    };
  }

  async canEditRecords(domain, address) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs');
    }

    return (await this.getManager(domain)) === address;
  }

  async getManager(domain) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs');
    }

    const data = await Promise.all([
      this.#nameWrapper.ownerOf(domain.namehash),
      this.#registry.owner(domain.namehash),
    ]);

    if (data[0] !== ZeroAddress) {
      return data[0];
    }

    return data[1];
  }

  /* eslint-disable class-methods-use-this, no-unused-vars  */
  async requiresCommitment(domain) {
    return true;
  }

  /* eslint-enable class-methods-use-this, no-unused-vars  */

  async setManager(domain, to, options) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs yet');
    }

    const data = await this.getRegistration(domain);
    if (data.status === 'unregistered') {
      throw new Error('Name is not registered');
    }

    const signer = options?.signer || await this.#provider.getSigner();

    if (data.source.name === 'ens.nameWrapper') {
      throw new Error('not implemented');
    }

    const signerAddress = await signer.getAddress();
    const ownerAddress = data.owner;
    const currentManager = await this.getManager(domain);

    if (signerAddress !== ownerAddress && signerAddress !== currentManager) {
      throw new Error(`signer ${signerAddress} is not owner or manager`);
    }

    // if owner, reclaim ownership in the registry
    if (signerAddress === ownerAddress) {
      const registrarWithSigner = await this.#registrar.connect(signer);
      return registrarWithSigner.reclaim(domain.sldHash, to);
    }

    const registryWithSigner = await this.#registry.connect(signer);
    return registryWithSigner.setOwner(domain.namehash, to);
  }

  async getPrice(domain, duration) {
    if (!domain.isSLD()) {
      throw new Error('Cannot check registration of non-SLD');
    }
    if (!duration) {
      throw new Error('Must provide duration');
    }

    const [results, address] = await this.#controllerMulticall(domain, [
      { name: 'rentPrice', args: [domain.sld, duration] },
    ]);
    const [price] = results;

    if (!price.success) {
      throw new Error(`Unsupported controller ${address} for .${domain.parent.name}`);
    }

    const p = new Price();
    p.base = price.data[0];
    p.premium = BigInt(price.data[1]);
    p.recurring = true;
    return p;
  }

  async renew(domain, options) {
    if (!domain.isSLD()) {
      throw new Error('Cannot renew non-SLD');
    }
    if (!options.duration) {
      throw new Error('Must provide duration');
    }

    const address = await this.#findController(domain);
    const contract = new Contract(address, this.#controller, this.#provider);

    const signer = options?.signer || await this.#provider.getSigner();
    const contractWithSigner = contract.connect(signer);

    const txOptions = options.value ? { value: options.value } : {};
    return contractWithSigner.renew(domain.sld, options.duration, txOptions);
  }

  async transfer(domain, options) {
    if (!options.to) {
      throw new Error('to address is required');
    }
    if (!domain.isSLD()) {
      throw new Error('Cannot transfer non-SLD');
    }
    if (domain.tld !== 'eth') {
      throw new Error('Cannot transfer non-eth domain');
    }

    const registration = await this.getRegistration(domain);
    if (registration.status !== 'registered') {
      throw new Error('Domain is not registered');
    }

    const to = options.to;
    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();
    const from = options.from ?? signerAddress;

    if (registration.source.address === this.#nameWrapper.target) {
      const nameWrapperWithSigner = this.#nameWrapper.connect(signer);
      return nameWrapperWithSigner.safeTransferFrom(from, to, domain.namehash, 1, '0x');
    }
    if (registration.source.address === this.#registrar.target) {
      const registrarWithSigner = this.#registrar.connect(signer);
      return registrarWithSigner.safeTransferFrom(from, to, domain.sldHash);
    }

    throw new Error('Unsupported transfer source');
  }

  async setResolver(domain, resolver, options) {
    const signer = options?.signer || await this.#provider.getSigner();
    if (domain.isTLD() && domain.name === 'eth') {
      return this.#registrar.connect(signer).setResolver(resolver);
    }

    const data = await this.getRegistration(domain);
    if (data.source.name === 'ens.nameWrapper') {
      return this.#nameWrapper.connect(signer).setResolver(domain.namehash, resolver);
    }

    const registryWithSigner = this.#registry.connect(signer);
    return registryWithSigner.setResolver(domain.namehash, resolver);
  }

  async getRegistration(domain) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs');
    }

    const registration = {
      status: 'unregistered',
      ownershipType: 'emancipated',
      owner: ZeroAddress,
      reservedFor: null,
      expiry: 0n,
      source: {
        name: 'ens.registry',
        address: this.#registry.target,
        id: BigInt(domain.namehash).toString(),
      },
    };

    const data = await Promise.allSettled([
      this.#controllerMulticall(domain, [
        { name: 'available', args: [domain.sld] },
      ]),
      this.#nameWrapper.getData(domain.namehash),
      this.#registry.owner(domain.namehash),
      this.#registrar.ownerOf(domain.sldHash),
      this.#registrar.nameExpires(domain.sldHash),
    ]);

    const [controllerResult, nameWrapperData, registryOwnerData, registrarOwnerData, registrarExpiry] = data;
    const available = controllerResult.status === 'fulfilled'
      ? controllerResult.value[0][0] : { success: false };

    registration.status = !available.success || domain.tld !== 'eth' ? 'unknown'
      : (available.data ? 'unregistered' : 'registered');

    if (nameWrapperData.status === 'rejected') {
      throw new Error(`Failed to get name wrapper: ${nameWrapperData.reason}`);
    }
    if (registryOwnerData.status === 'rejected') {
      throw new Error(`Failed to get registry owner: ${registryOwnerData.reason}`);
    }

    const [nameWrapperOwner, , nameWrapperExpiry] = nameWrapperData.value;
    const registryOwner = registryOwnerData.value;

    if (nameWrapperOwner !== ZeroAddress
      && registryOwner === this.#nameWrapper.target
      && registrarOwnerData.status === 'fulfilled'
      && registrarOwnerData.value === this.#nameWrapper.target) {
      registration.owner = nameWrapperOwner;
      registration.expiry = nameWrapperExpiry;
      registration.source.name = 'ens.nameWrapper';
      registration.source.address = this.#nameWrapper.target;
      return registration;
    }

    // legacy names
    if (registrarOwnerData.status === 'fulfilled' && (
      registrarOwnerData.value !== ZeroAddress
      && registrarOwnerData.value !== this.#nameWrapper.target
    )) {
      registration.owner = registrarOwnerData.value;
      registration.expiry = registrarExpiry.value;
      registration.source.name = 'ens.registrar';
      registration.source.address = this.#registrar.target;

      // legacy just hashes the label
      registration.source.id = BigInt(domain.sldHash).toString();
      return registration;
    }

    // unregistered names show name wrapper as the source
    if (registration.status === 'unregistered') {
      registration.owner = nameWrapperOwner;
      registration.expiry = nameWrapperExpiry;
      registration.source.name = 'ens.nameWrapper';
      registration.source.address = this.#nameWrapper.target;
      return registration;
    }

    // everything else shows the registry as the source
    registration.owner = registryOwner.value;
    return registration;
  }

  async getOwner(domain) {
    if (domain.isTLD()) {
      if (domain.name === 'eth') return this.#registrar.owner();
      return this.#registry.owner(domain.namehash);
    }

    const data = await this.getRegistration(domain);
    return data.owner;
  }

  async getResolver(domain) {
    return this.#registry.resolver(domain.namehash);
  }

  async getRecords(domain, recordIds) {
    const mrr = getMultiRegistryResolver(this.#network.chainId, this.#provider);
    return getRecords(mrr, this.#registry, domain, recordIds);
  }

  async setRecords(domain, records, options) {
    const resolver = await this.#getResolverWithSigner(domain, options);
    return setRecords(resolver, domain, records);
  }

  async #getResolverWithSigner(domain, options) {
    const resolverAddress = await this.#registry.resolver.staticCall(domain.namehash);

    if (resolverAddress === ZeroAddress) {
      throw new Error(`No resolver set for '${domain.name}'`);
    }

    const signer = options?.signer || await this.#provider.getSigner();
    const contract = new Contract(resolverAddress, Resolver, this.#provider);
    return contract.connect(signer);
  }

  #init() {
    const registryAddr = getContractAddress(this.#network.chainId, 'ensRegistry');
    this.#registry = new Contract(registryAddr, ERC137, this.#provider);

    const registrarAddr = getContractAddress(this.#network.chainId, 'ensRegistrar');
    this.#registrar = new Contract(registrarAddr, this.#registrarAbi, this.#provider);

    const nameWrapperAddr = getContractAddress(this.#network.chainId, 'ensNameWrapper');
    this.#nameWrapper = new Contract(nameWrapperAddr, this.#nameWrapperAbi, this.#provider);
  }

  async #findController(domain) {
    const cr = getControllerResolver(this.#network.chainId, this.#provider);
    return cr.findController(
      this.#registry.target,
      this.#nameWrapper.target,
      domain.parent.namehash,
      ifaceBase,
    );
  }

  async #controllerMulticall(domain, calls) {
    const calldatas = calls.map((call) => this.#controller.encodeFunctionData(call.name, call.args));

    const cr = getControllerResolver(this.#network.chainId, this.#provider);
    const [results, address] = await cr.multicall(
      this.#registry.target,
      this.#nameWrapper.target,
      domain.parent.namehash,
      ifaceBase,
      calldatas,
    );

    return [
      results.map((result, i) => {
        const r = {
          success: result[1],
          data: result[1] ? this.#controller.decodeFunctionResult(calls[i].name, result[0]) : null,
        };
        if (r.success) r.data = r.data.length === 1 ? r.data[0] : r.data.toArray();
        return r;
      }),
      address,
    ];
  }
}
