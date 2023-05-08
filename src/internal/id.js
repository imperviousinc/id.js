import { EnsResolver, isAddress } from 'ethers';
import { createBatchProvider } from './multicall.js';

export class Id {
  #handlers = {};

  #defaultHandler = null;

  #provider = null;

  #batchProvider = null;

  #network = null;

  constructor(options) {
    this.update(options);
  }

  get provider() {
    return this.#provider;
  }

  async getRegistration(name) {
    return this.#call('getRegistration', name);
  }

  update(options) {
    if (options.network) {
      this.#network = options.network;
    }
    if (options.provider) {
      this.#provider = options.provider;
      this.#batchProvider = createBatchProvider(this.#provider);
    }
    if (options.overrideProvider !== false) {
      this.#overrideProviderResolver(this.#provider);
    }
    if (!this.#network) {
      throw new Error('Network not set');
    }
    if (!this.#provider) {
      throw new Error('Provider not set');
    }

    this.#updateHandlers();
  }

  async transfer(name, options) {
    return this.#call('transfer', name, options);
  }

  async getOwner(name) {
    return this.#call('getOwner', name);
  }

  async getName(address) {
    if (!isAddress(address)) {
      throw new Error('Invalid address');
    }

    const calls = await Promise.all([
      this.#call('getName', `${address}.eth`),
      this.#call('getName', `${address}.forever`),
      // default handler
      this.#call('getName', `${address}.invalid`),
    ]);

    return calls[0] || calls[1] || calls[2];
  }

  async getRecords(name, recordIds) {
    return this.#call('getRecords', name, recordIds);
  }

  async setRecords(name, records, options) {
    return this.#call('setRecords', name, records, options);
  }

  async getDns(name, rrSetIds) {
    const records = await this.getRecords(name, { dns: Array.isArray(rrSetIds) ? rrSetIds : [rrSetIds] });
    return Array.isArray(rrSetIds) ? records.dns : records.dns[0];
  }

  async getText(name, key) {
    const records = await this.getRecords(name, { text: Array.isArray(key) ? key : [key] });
    return typeof key === 'string' ? records.text[key] : records.text;
  }

  async getAddress(name, coinType = 'ETH') {
    const records = await this.getRecords(name, { address: Array.isArray(coinType) ? coinType : [coinType] });
    return Array.isArray(coinType) ? records.address : records.address[coinType];
  }

  async getContentHash(name) {
    const records = await this.getRecords(name, { contentHash: true });
    return records.contentHash;
  }

  async setAddress(name, addressOrCoinValues, options) {
    const coinTypeValues = isAddress(addressOrCoinValues)
      ? { 60: addressOrCoinValues }
      : addressOrCoinValues;

    return this.setRecords(name, { address: coinTypeValues }, options);
  }

  async setText(name, keyValuePairs, options) {
    return this.setRecords(name, { text: keyValuePairs }, options);
  }

  async setDns(name, rrSetData, options) {
    const rrSetArray = Array.isArray(rrSetData) ? rrSetData : [rrSetData];
    return this.setRecords(name, { dns: rrSetArray }, options);
  }

  async setContentHash(name, contentHash, options) {
    return this.setRecords(name, { contentHash }, options);
  }

  async getResolver(name) {
    return this.#call('getResolver', name);
  }

  async setResolver(name, resolver, options) {
    return this.#call('setResolver', name, resolver, options);
  }

  async register(name, options) {
    return this.#call('register', name, options);
  }

  async renew(name, options) {
    return this.#call('renew', name, options);
  }

  async getPrice(name, options) {
    return this.#call('getPrice', name, options);
  }

  async getMinCommitmentAge(name, options) {
    return this.#call('getMinCommitmentAge', name, options);
  }

  async getMaxCommitmentAge(name, options) {
    return this.#call('getMaxCommitmentAge', name, options);
  }

  async getExpiry(name, options) {
    return this.#call('getExpiry', name, options);
  }

  async canEditRecords(name, address, options) {
    return this.#call('canEditRecords', name, address, options);
  }

  async getManager(name, options) {
    return this.#call('getManager', name, options);
  }

  async setManager(name, address, options) {
    return this.#call('setManager', name, address, options);
  }

  async commit(name, options) {
    return this.#call('commit', name, options);
  }

  async makeCommitment(name, options) {
    return this.#call('makeCommitment', name, options);
  }

  async getCommitmentTime(name, options) {
    return this.#call('getCommitmentTime', name, options);
  }

  async requiresCommitment(name) {
    return this.#call('requiresCommitment', name);
  }

  async #call(method, name, ...args) {
    const { Domain, nameSplit } = await import('./common/utils.js');
    const labels = nameSplit(name);

    if (labels.length === 0) {
      throw new Error(`invalid name ${name}`);
    }
    const domain = new Domain(labels);

    const handler = await this.#getHandler(domain);
    return handler[method](domain, ...args);
  }

  async #getHandler(domain) {
    const tld = domain.labels[domain.labels.length - 1];
    let handler = this.#handlers[tld] || this.#defaultHandler;
    if (handler) {
      return handler;
    }

    const options = {
      network: this.#network,
      provider: this.#batchProvider,
    };

    switch (tld) {
      case 'eth': {
        const { EnsHandler } = await import('./ens.handler.js');
        handler = new EnsHandler(options);
        this.#handlers[tld] = handler;
        break;
      }
      case 'forever': {
        const { ForeverHandler } = await import('./forever.handler.js');
        handler = new ForeverHandler(options);
        this.#handlers[tld] = handler;
        break;
      }
      default: {
        const { DefaultHandler } = await import('./default.handler.js');
        handler = new DefaultHandler(options);
      }
    }

    return handler;
  }

  #updateHandlers() {
    const options = {
      network: this.#network,
      provider: this.#batchProvider,
    };
    if (this.#defaultHandler) {
      this.#defaultHandler.update(options);
    }
    for (const handler of Object.values(this.#handlers)) {
      handler.update(options);
    }
  }

  #overrideProviderResolver(provider) {
    provider.getResolver = async (name) => {
      const resolverAddress = await this.getResolver(name);
      return new EnsResolver(this.#provider, resolverAddress, name);
    };
    provider.resolveName = async (name) => this.getAddress(name);
    provider.lookupAddress = async (address) => this.getName(address);
  }
}
