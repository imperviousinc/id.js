import {
  Contract, id as keccak256Str, Interface, ZeroAddress,
} from 'ethers';
import { getContractAddress, Price } from './common/utils.js';
import {
  getRecords, Resolver, reverseLookup, setRecords,
} from './common/resolver.js';
import { getControllerResolver, getMultiRegistryResolver, RegisterStatus } from './common/multiresolver.js';
import { ERC137 } from './common/erc137.js';
import { CommitmentNotRequiredError } from './common/errors.js';

const ifaceBase = '0x490d5184';
const ifaceSupportsOptionalCommit = '0xfd7a9152';

export class DefaultHandler {
  #network = null;

  #provider = null;

  #root = null;

  #legacyRoot = null;

  #registrar = null;

  #registry = null;

  #controller = new Interface([
    'function makeCommitmentWithConfig(bytes32,string,address,bytes32,address,address) view returns (bytes32)',
    'function renew(bytes32 node, string calldata name, uint duration) payable',
    'function availabilityInfo(bytes32,string) returns (uint8,address)',
    'function registerWithConfig(bytes32,string,address,uint256,bytes32,address,address) payable',
    'function registerReservedWithConfig(bytes32,string,address,uint256,address,address) payable',
    'function requireCommitReveal(bytes32) returns (bool)',
    'function registerNow(bytes32,string,address,uint,address,address) payable',
    'function supportsInterface(bytes4) returns (bool)',
    'function rentPrice(bytes32,string,uint256) view returns (uint256)',
    'function minCommitmentAge() view returns (uint256)',
    'function maxCommitmentAge() view returns (uint256)',
    'function commitments(bytes32) view returns (uint256)',
    'function commit(bytes32)',
  ]);

  #erc721 = [
    'function ownerOf(uint256) view returns (address)',
    'function safeTransferFrom(address,address,uint256)',
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

    const [required, controllerAddress] = await this.#requiresCommitment(domain);
    if (!required) {
      throw new CommitmentNotRequiredError();
    }

    const controller = new Contract(controllerAddress, this.#controller, this.#provider);
    const signer = options?.signer || await this.#provider.getSigner();
    const controllerWithSigner = controller.connect(signer);
    return controllerWithSigner.commit(commitment);
  }

  async makeCommitment(domain, options) {
    if (!domain.isSLD()) {
      throw new Error('Cannot make commitment for non-SLD');
    }

    if (!options.secret) {
      throw new Error('Must provide secret');
    }

    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();
    const owner = options.owner || signerAddress;
    const resolver = options.resolver ?? getContractAddress(this.#network.chainId, 'imperviousResolver');

    const [results] = await this.#controllerMulticall(domain, [{
      name: 'makeCommitmentWithConfig',
      args: [domain.parent.namehash, domain.sld, owner, options.secret, resolver, owner],
    }]);

    if (!results[0].success) {
      throw new Error('Commitment failed');
    }

    return results[0].data;
  }

  async canEditRecords(domain, address) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs');
    }

    return (await this.#registry.owner(domain.namehash)) === address;
  }

  async requiresCommitment(domain) {
    const [requiresCommitment] = await this.#requiresCommitment(domain);
    return requiresCommitment;
  }

  async #requiresCommitment(domain) {
    const [results, controllerAddr] = await this.#controllerMulticall(domain, [
      { name: 'supportsInterface', args: [ifaceSupportsOptionalCommit] },
      { name: 'requireCommitReveal', args: [domain.namehash] },
    ]);

    if (!results[0].success) {
      throw new Error(`Failed checking supported interfaces for ${controllerAddr}`);
    }
    if (!results[0].data || !results[1].success) {
      return [true, controllerAddr];
    }

    return [results[1].data, controllerAddr];
  }

  async getName(address) {
    const mrr = getMultiRegistryResolver(this.#network.chainId, this.#provider);
    return reverseLookup(mrr, this.#registry, address.sld);
  }

  async getManager(domain) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs');
    }

    return this.#registry.owner(domain.namehash);
  }

  async setManager(domain, to, options) {
    if (!domain.isSLD()) {
      throw new Error('Not supported for non-SLDs yet');
    }

    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();
    const ownerAddress = await this.getOwner(domain);
    const currentManager = await this.getManager(domain);

    if (signerAddress !== ownerAddress && signerAddress !== currentManager) {
      throw new Error(`signer ${signerAddress} is not owner or manager`);
    }

    // if owner, reclaim ownership in the registry
    if (signerAddress === ownerAddress) {
      const registrarWithSigner = await this.#registrar.connect(signer);
      return registrarWithSigner.reclaim(domain.parent.namehash, keccak256Str(domain.sld), to);
    }

    const registryWithSigner = await this.#registry.connect(signer);
    return registryWithSigner.setOwner(domain.namehash, to);
  }

  async getRegistration(domain) {
    if (!domain.isSLD()) {
      throw new Error('Cannot check registration of non-SLD');
    }

    const registration = {
      status: 'unregistered',
      ownershipType: null,
      owner: ZeroAddress,
      reservedFor: null,
      expiry: 0n,
      source: {
        name: 'impervious.registrar',
        address: this.#registry.target,
        id: BigInt(domain.namehash).toString(),
      },
    };

    const [controllerData, registrarOwner, registrarExpiry, lockedTLD] = await Promise.allSettled([
      this.#controllerMulticall(domain, [
        { name: 'availabilityInfo', args: [domain.parent.namehash, domain.sld] },
      ]),
      this.#registrar.ownerOf(domain.namehash),
      this.#registrar.nameExpires(domain.namehash),
      this.#legacyRoot.locked(domain.tldHash),
    ]);

    registration.ownershipType = lockedTLD.status === 'fulfilled' && lockedTLD.value ? 'emancipated' : null;

    if (controllerData.status === 'rejected') {
      throw new Error(`Failed to get controller data for ${domain.name}`);
    }
    if (lockedTLD.status === 'rejected') {
      throw new Error(`Failed to get locked TLD status for ${domain.tld}: ${lockedTLD.reason}`);
    }

    let [results, address] = controllerData.value;
    results = results[0];
    if (!results.success) {
      throw new Error(`Unsupported controller ${address} for .${domain.tld}`);
    }

    const status = parseInt(results.data[0], 10);
    if (status === RegisterStatus.Available) {
      return registration;
    } if (status === RegisterStatus.Reserved) {
      registration.status = 'reserved';
      registration.reservedFor = results.data[1];
      return registration;
    } if (status === RegisterStatus.Taken) {
      registration.status = 'registered';

      if (registrarOwner.status === 'rejected' || registrarExpiry.status === 'rejected') {
        throw new Error(`Failed to get owner/expiry for ${domain.name}`);
      }
      registration.owner = registrarOwner.value;
      registration.expiry = registrarExpiry.value;
    } if (status === RegisterStatus.Closed) {
      registration.status = 'closed';
    }

    return registration;
  }

  async getPrice(domain, duration) {
    if (!domain.isSLD()) {
      throw new Error('Cannot check registration of non-SLD');
    }

    const [results, address] = await this.#controllerMulticall(domain, [
      { name: 'rentPrice', args: [domain.parent.namehash, domain.sld, duration] },
    ]);
    const [rentPrice] = results;

    if (!rentPrice.success) {
      throw new Error(`Unsupported controller ${address} for .${domain.parent.name}`);
    }

    const p = new Price();
    p.base = rentPrice.data;
    p.premium = BigInt(0);
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
    return contractWithSigner.renew(domain.parent.namehash, domain.sld, options.duration, txOptions);
  }

  async register(domain, options) {
    if (!domain.isSLD()) {
      throw new Error('Cannot register non-SLD');
    }

    // batch call controller address, registration, and other supported features.
    const [results, address] = await this.#controllerMulticall(domain, [
      { name: 'availabilityInfo', args: [domain.parent.namehash, domain.sld] },
      { name: 'supportsInterface', args: [ifaceSupportsOptionalCommit] },
      { name: 'requireCommitReveal', args: [domain.parent.namehash] },
    ]);

    let [status, supportsOptionalCommit, requireCommitReveal] = results;
    if (!status.success) {
      throw new Error(`Unsupported controller ${address} for .${domain.parent.name}`);
    }

    const reservedAddress = status.data[1];
    status = parseInt(status.data[0], 10);

    if (status === RegisterStatus.Taken) {
      throw new Error(`Name ${domain.name} is already taken`);
    }
    if (status === RegisterStatus.Closed) {
      throw new Error(`Registrations are closed for .${domain.parent.name}`);
    }

    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();

    if (status === RegisterStatus.Reserved && signerAddress !== reservedAddress) {
      throw new Error(`Name ${domain.name} is reserved for ${reservedAddress}, got signer = ${signerAddress}`);
    }

    const contract = new Contract(address, this.#controller, this.#provider);
    const contractWithSigner = contract.connect(signer);

    const owner = options.owner ?? signerAddress;
    const resolver = options.resolver ?? getContractAddress(this.#network.chainId, 'imperviousResolver');

    const args = [
      domain.parent.namehash,
      domain.sld,
      owner,
      options.duration,
      options.secret || null,
      resolver,
      owner, // addr
    ];

    const method = status === RegisterStatus.Reserved
      ? 'registerReservedWithConfig' : (supportsOptionalCommit.data && requireCommitReveal.success
        && !requireCommitReveal.data ? 'registerNow' : 'registerWithConfig'
      );

    if (method === 'registerReservedWithConfig' || method === 'registerNow') {
      args.splice(4, 1);
    }

    const txOptions = options.value ? { value: options.value } : {};
    return contractWithSigner[method](...args, txOptions);
  }

  async transfer(domain, options) {
    if (!options.to) {
      throw new Error('to address is required');
    }
    if (domain.isSubdomain()) {
      throw new Error('Transfer subdomain not supported');
    }

    const to = options.to;

    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();
    const from = options?.from || signerAddress;

    if (domain.isTLD()) {
      const [, wrapped] = await this.#getTLDOnwer(domain);
      if (wrapped) {
        const rootWithSigner = this.#root.connect(signer);
        return rootWithSigner.safeTransferFrom(from, to, domain.namehash);
      }
      const registrarWithSigner = this.#registrar.connect(signer);
      return registrarWithSigner.transferNodeOwnership(domain.namehash, to);
    }
    // Not a TLD, SLD or subdomain.
    if (!domain.isSLD()) {
      throw new Error('Cannot transfer root');
    }

    const registrarWithSigner = this.#registrar.connect(signer);
    return registrarWithSigner.safeTransferFrom(from, to, domain.namehash);
  }

  async setResolver(domain, resolver, options) {
    const signer = options?.signer || await this.#provider.getSigner();
    if (domain.isTLD()) {
      throw new Error('not implemented yet');
    }

    const registryWithSigner = this.#registry.connect(signer);
    return registryWithSigner.setResolver(domain.namehash, resolver);
  }

  async getOwner(domain) {
    if (domain.isTLD()) {
      const [owner] = await this.#getTLDOnwer(domain);
      return owner;
    }

    const tokenId = BigInt(domain.namehash);
    return this.#registrar.ownerOf(tokenId);
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

  async #findController(domain) {
    const cr = getControllerResolver(this.#network.chainId, this.#provider);
    return cr.findController(
      this.#registry.target,
      this.#registrar.target,
      domain.parent.namehash,
      ifaceBase,
    );
  }

  #init() {
    const rootAddr = getContractAddress(this.#network.chainId, 'imperviousRootWrapper');
    this.#root = new Contract(rootAddr, this.#erc721, this.#provider);
    const legacyRootAddr = getContractAddress(this.#network.chainId, 'imperviousRoot');
    this.#legacyRoot = new Contract(legacyRootAddr, ['function locked(bytes32) view returns (bool)'], this.#provider);

    const registrarAddr = getContractAddress(this.#network.chainId, 'imperviousRegistrar');
    this.#registrar = new Contract(
      registrarAddr,
      [
        ...this.#erc721,
        'function ownerOfNode(bytes32) view returns (address)',
        'function transferNodeOwnership(bytes32 node, address owner)',
        'function setResolver(bytes32,address)',
        'function reclaim(bytes32 node, bytes32 label, address owner)',
        'function nameExpires(uint256) view returns(uint256)',
      ],
      this.#provider,
    );

    const registryAddr = getContractAddress(this.#network.chainId, 'imperviousRegistry');
    this.#registry = new Contract(registryAddr, ERC137, this.#provider);
  }

  async #controllerMulticall(domain, calls) {
    const calldatas = calls.map((call) => this.#controller.encodeFunctionData(call.name, call.args));

    const cr = getControllerResolver(this.#network.chainId, this.#provider);
    const [results, address] = await cr.multicall(
      this.#registry.target,
      this.#registrar.target,
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

  async #getTLDOnwer(domain) {
    const [ownerResult, wrappedOwnerResult] = await Promise.allSettled([
      this.#registrar.ownerOfNode(domain.namehash),
      this.#root.ownerOf(BigInt(domain.namehash)),
    ]);

    if (ownerResult.status === 'rejected') {
      throw new Error(`Failed to get owner for ${domain.name}: ${ownerResult.reason}`);
    }
    if (ownerResult.value === ZeroAddress) {
      throw new Error(`Name '${domain.name}' not registered`);
    }
    if (ownerResult.value !== this.#root.target) {
      return [ownerResult.value, false];
    }
    if (wrappedOwnerResult.status === 'rejected') {
      throw new Error(`Failed to read owner of from impervious root: ${wrappedOwnerResult.reason}`);
    }

    return [wrappedOwnerResult.value, true];
  }
}
