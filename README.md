
<img src="./test/id.js.svg">

⚠️ Note: this is still an alpha release.

A compact library for interacting with domains on the new internet. Supports Impervious domains, Forever and ENS.

## Features

- Tiny! About 26kb gzipped < 1 cat pic and with dynamic imports it can be even smaller!

- Fast! Seamless batching with Promise.all/allSettled

- Simple API for registering, renewing, transferring, resolving, and more.

- Supports Dns, text, address & content hash records

- Supports Impervious domains such as .f, .www and .contract

- Supports .forever domains

- Supports ENS including the latest controller & name wrapper!


## Installation

```shell
npm i @imperviousinc/id ethers
```

## Quick start

```js
import { Id } from '@imperviousinc/id';
import { BrowserProvider, Contract, parseEther } from 'ethers';

const provider = new BrowserProvider(...); // get a provider
const network = await provider.getNetwork() ;

const id = new Id({network, provider});

// Efficiently batch multiple requests with a single eth_call
const results = await Promise.all([
  id.getOwner('live.forever'),
  id.getText('vitalik.eth', 'url'),
  id.getPrice('bob.eth', 365*24*60*60),
  id.getAddress('bitcoin.contract'),
  id.getName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
  id.getDns('impervious.forever', 'A'),
  id.getRegistration('example.eth')
]);

console.log(results);
```

id.js overrides ether's resolver to enable it to query Impervious domains, Forever and ENS:

```js
// Send bob.forever 1 ETH
await id.provider.sendTransaction({
  to: 'bob.forever',
  value: parseEther('1'),
})

// Use .contract domains with ethers!
const contract = new Contract('impervious.contract', abi, id.provider)
```

Continue with [documentation](https://idjs.io)
