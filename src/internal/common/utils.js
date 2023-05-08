import { ensNormalize, id as keccak256Str, namehash as nh } from 'ethers';
import { addresses } from './addresses.js';

export function getContractAddress(networkId, contract) {
  if (networkId === BigInt(31337)) networkId = '1';

  if (!addresses[contract]) {
    throw new Error(`unknown contract ${contract}`);
  }
  if (!addresses[contract][networkId]) {
    throw new Error(`contract ${contract} address not found for network ${networkId}`);
  }

  return addresses[contract][networkId];
}

export function namehash(name) {
  if (!isValidName(name)) {
    throw new Error(`invalid name ${name}`);
  }

  return nh(name);
}

export function isValidName(name) {
  try {
    return (nameSplit(name).length !== 0);
  } catch (error) {
    // do nothing
  }
  return false;
}

export function nameSplit(name) {
  const normal = ensNormalize(name);
  const labels = [];

  if (normal.length === 0) {
    return labels;
  }

  let last = 0;
  for (let i = 0; i < normal.length; i++) {
    const d = normal[i];
    if (d === '.') {
      labels.push(checkLabel(normal.slice(last, i)));
      last = i + 1;
    }
  }

  labels.push(checkLabel(normal.slice(last)));
  return labels;
}

export function normalize(name) {
  if (!isValidName(name)) {
    throw new Error(`invalid name ${name}`);
  }

  return ensNormalize(name);
}

function checkLabel(label) {
  if (label.length === 0) {
    throw new Error('invalid name; empty label');
  }
  if (label.length > 63) {
    throw new Error('invalid name; label too long');
  }
  return label;
}

export class Price {
  constructor() {
    this.base = BigInt(0);
    this.premium = BigInt(0);
    this.recurring = true;
  }

  get total() {
    return this.base + this.premium;
  }

  get buffered() {
    return (this.base + this.premium) * (BigInt(103) / BigInt(100));
  }
}

export class Domain {
  #hash = null;

  #parent = null;

  constructor(labels) {
    this.labels = labels;
  }

  get parent() {
    if (this.#parent) {
      return this.#parent;
    }

    if (this.labels.length > 1) {
      this.#parent = new Domain(this.labels.slice(1));
    }
    return this.#parent;
  }

  get name() {
    return this.labels.join('.');
  }

  get namehash() {
    if (this.#hash) {
      return this.#hash;
    }

    this.#hash = namehash(this.name);
    return this.#hash;
  }

  get tld() {
    if (this.labels.length < 1) {
      throw new Error('no tld part');
    }
    return this.labels[this.labels.length - 1];
  }

  get tldHash() {
    return keccak256Str(this.tld);
  }

  get sld() {
    if (this.labels.length < 2) {
      throw new Error('no sld part');
    }
    return this.labels[this.labels.length - 2];
  }

  get sldHash() {
    return keccak256Str(this.sld);
  }

  get subdomains() {
    if (this.labels.length < 3) {
      throw new Error('no subdomain part');
    }
    return this.labels.slice(0, -2);
  }

  isTLD() {
    return this.labels.length === 1;
  }

  isSLD() {
    return this.labels.length === 2;
  }

  isSubdomain() {
    return this.labels.length > 2;
  }

  toString() {
    return this.name;
  }
}

export class RawAddress {
  constructor(hexBytes) {
    this.hexBytes = hexBytes;
  }

  toString() {
    return `raw-bytes[${this.hexBytes}]`;
  }
}

export class RawContentHash {
  constructor(hexBytes) {
    this.hexBytes = hexBytes;
  }

  toString() {
    return `raw-bytes[${this.hexBytes}]`;
  }
}
