import { AbiCoder, Contract } from 'ethers';
import { getContractAddress } from './common/utils.js';

class BatchProvider {
  #pendingCalls = [];

  #pendingPromises = [];

  #debounceTimeout = null;

  #enabled = true;

  #multicall = null;

  #provider = null;

  constructor(provider) {
    this.#provider = provider;
  }

  async #getMulticall() {
    if (this.#multicall) return this.#multicall;
    const network = await this.#provider.getNetwork();
    const addr = await getContractAddress(network.chainId, 'multicall');
    this.#multicall = new Contract(addr, [
      'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) '
      + 'payable returns (tuple(bool success, bytes returnData)[] returnData)',
    ], this.#provider);
    return this.#multicall;
  }

  get(target, prop, receiver) {
    const func = Reflect.get(target, prop, receiver);
    if (!(func instanceof Function)) {
      return func;
    }

    if (prop !== 'call' || !this.#enabled) {
      return function apply(...args) {
        return Reflect.apply(func, this === receiver ? target : this, args);
      };
    }

    const stack = Error().stack;
    const that = this;
    return function InterceptedCall(...args) {
      return that.call(args, stack);
    };
  }

  async call(args, stack) {
    const { to, data } = args[0];
    return new Promise((resolve, reject) => {
      this.#pendingCalls.push({
        target: to,
        allowFailure: true,
        callData: data,
        stack,
      });

      this.#pendingPromises.push({ resolve, reject });
      this.maybeFire();
    });
  }

  async maybeFire() {
    if (this.#debounceTimeout) {
      clearTimeout(this.#debounceTimeout);
    }

    this.#debounceTimeout = setTimeout(() => {
      this.fire();
    }, 6);
  }

  async fire() {
    const pendingCalls = this.#pendingCalls;
    const pendingPromises = this.#pendingPromises;
    this.#pendingCalls = [];
    this.#pendingPromises = [];

    if (pendingCalls.length !== pendingPromises.length) {
      throw new Error('Invalid state calls != promises');
    }

    let responses = null;
    try {
      const m = await this.#getMulticall();
      responses = await m.aggregate3.staticCall(pendingCalls);
    } catch (e) {
      pendingPromises.forEach((promise) => promise.reject(e));
      return;
    }

    if (responses.length !== pendingPromises.length) {
      pendingPromises.forEach((promise) => promise.reject(new Error('Invalid state responses != promises')));

      return;
    }

    for (let i = responses.length - 1; i > -1; i--) {
      const promise = pendingPromises.pop();
      const [success, returnData] = responses[i];

      if (success) {
        promise.resolve(returnData);
        continue;
      }

      const e = AbiCoder.getBuiltinCallException('call', {
        to: pendingCalls[i].target,
        data: pendingCalls[i].callData,
      }, returnData);

      e.stack += `\n${pendingCalls[i].stack.split('\n').slice(1).join('\n')}`;
      promise.reject(e);
    }
  }
}

export function createBatchProvider(provider) {
  return new Proxy(provider, new BatchProvider(provider));
}
