import {
  Contract, id as keccak256Str, Interface, ZeroAddress,
} from 'ethers';
import { getContractAddress, Price } from './common/utils.js';
import {
  getRecords, Resolver, reverseLookup, setRecords,
} from './common/resolver.js';
import { getControllerResolver, getMultiRegistryResolver } from './common/multiresolver.js';
import { ERC137 } from './common/erc137.js';
import { CommitmentNotRequiredError } from './common/errors.js';

const ifaceBase = '0xa608d7c6';

export class ForeverHandler {
  #network = null;

  #provider = null;

  #registrar = null;

  #registry = null;

  #controller = new Interface([
    'function makeCommitmentWithConfig(string,address,bytes32,address,address) view returns (bytes32)',
    'function available(string) returns (bool)',
    'function registerWithConfig(string,address,bytes32,address,address) payable',
    'function requireCommitReveal() returns (bool)',
    'function price(string) view returns (uint256)',
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

    const [required, controllerAddress] = await this.#requiresCommitment();
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
      args: [domain.sld, owner, options.secret, resolver, owner],
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

    return (await this.getManager(domain)) === address;
  }

  async requiresCommitment(domain) {
    const [requiresCommitment] = await this.#requiresCommitment(domain);
    return requiresCommitment;
  }

  async getName(address) {
    const mrr = getMultiRegistryResolver(this.#network.chainId, this.#provider);
    return reverseLookup(mrr, this.#registry, address.sld);
  }

  async #requiresCommitment(domain) {
    const [results, controllerAddr] = await this.#controllerMulticall(domain, [
      { name: 'requireCommitReveal', args: [] },
    ]);

    if (!results[0].success) {
      return [true, controllerAddr];
    }
    return [results[0].data, controllerAddr];
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
      return registrarWithSigner.reclaim(keccak256Str(domain.sld), to);
    }

    const registryWithSigner = await this.#registry.connect(signer);
    return registryWithSigner.setOwner(domain.namehash, to);
  }

  async getRegistration(domain) {
    if (!domain.isSLD()) {
      throw new Error('Cannot check registration of non-SLD');
    }

    const [controllerData, registrarOwner] = await Promise.allSettled([
      this.#controllerMulticall(domain, [
        { name: 'available', args: [domain.sld] },
      ]),
      this.#registrar.ownerOf(domain.namehash),
    ]);

    if (controllerData.status === 'rejected') {
      throw new Error(`Failed to get registration for ${domain.name}: ${controllerData.reason}`);
    }

    const [results, address] = controllerData.value;

    const [status] = results;
    if (!status.success) {
      throw new Error(`Unsupported controller ${address} for .${domain.tld}`);
    }

    return {
      status: status.data ? 'unregistered' : 'registered',
      ownershipType: 'emancipated',
      owner: registrarOwner.status === 'fulfilled' ? registrarOwner.value : ZeroAddress,
      reservedFor: null,
      expiry: 0n,
      source: {
        name: 'forever.registrar',
        address: this.#registrar.target,
        id: BigInt(domain.sldHash).toString(),
      },
    };
  }

  async getPrice(domain) {
    if (!domain.isSLD()) {
      throw new Error('Cannot check registration of non-SLD');
    }

    const [results, address] = await this.#controllerMulticall(domain, [
      { name: 'price', args: [domain.sld] },
    ]);
    const [price] = results;

    if (!price.success) {
      throw new Error(`Unsupported controller ${address} for .${domain.parent.name}`);
    }

    const p = new Price();
    p.base = price.data;
    p.premium = BigInt(0);
    p.recurring = false;
    return p;
  }

  /* eslint-disable class-methods-use-this, no-unused-vars  */
  async renew(domain, options) {
    throw new Error('Renew is not applicable for .forever domains');
  }
  /* eslint-enable class-methods-use-this, no-unused-vars  */

  async register(domain, options) {
    if (!domain.isSLD()) {
      throw new Error('Cannot register non-SLD');
    }

    const [results, address] = await this.#controllerMulticall(domain, [
      { name: 'available', args: [domain.sld] },
      { name: 'requireCommitReveal', args: [] },
    ]);

    let [status, requireCommitReveal] = results;
    if (!status.success) {
      throw new Error(`Unsupported controller ${address} for .forever`);
    }

    requireCommitReveal = requireCommitReveal.success ? requireCommitReveal.data : true;

    if (!status.data) {
      throw new Error(`Name ${domain.name} is already taken`);
    }

    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();

    const contract = new Contract(address, this.#controller, this.#provider);
    const contractWithSigner = contract.connect(signer);

    const owner = options.owner ?? signerAddress;
    const resolver = options.resolver ?? getContractAddress(this.#network.chainId, 'foreverResolver');
    const secret = requireCommitReveal ? options.secret
      : '0x0000000000000000000000000000000000000000000000000000000000000000';
    const args = [
      domain.sld,
      owner,
      secret,
      resolver,
      owner, // addr
      options.value ? { value: options.value } : {}, // tx options
    ];

    return contractWithSigner.registerWithConfig(...args);
  }

  async transfer(domain, options) {
    if (!options.to) {
      throw new Error('to address is required');
    }
    if (!domain.isSLD()) {
      throw new Error('Cannot transfer non-SLD');
    }

    const to = options.to;
    const signer = options?.signer || await this.#provider.getSigner();
    const signerAddress = await signer.getAddress();
    const from = options.from ?? signerAddress;

    const registrarWithSigner = this.#registrar.connect(signer);
    return registrarWithSigner.safeTransferFrom(from, to, domain.sldHash);
  }

  async setResolver(domain, resolver, options) {
    const signer = options?.signer || await this.#provider.getSigner();

    if (domain.isTLD()) {
      const registrarWithSigner = this.#registrar.connect(signer);
      return registrarWithSigner.setResolver(domain.namehash, resolver);
    }

    const registryWithSigner = this.#registry.connect(signer);
    return registryWithSigner.setResolver(domain.namehash, resolver);
  }

  async getOwner(domain) {
    if (domain.isTLD()) {
      return this.#registrar.owner();
    }

    return this.#registrar.ownerOf(BigInt(domain.sldHash));
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
    const registrarAddr = getContractAddress(this.#network.chainId, 'foreverRegistrar');
    this.#registrar = new Contract(
      registrarAddr,
      [
        ...this.#erc721,
        'function setResolver(address)',
        'function reclaim(uint256,address)',
        'function nameExpires(uint256) view returns(uint256)',
        'function owner() view returns(address)',
      ],
      this.#provider,
    );

    const registryAddr = getContractAddress(this.#network.chainId, 'foreverRegistry');
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
}
