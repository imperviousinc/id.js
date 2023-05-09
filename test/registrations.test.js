import { expect, assert } from 'chai';
import pkg from 'hardhat';
import { createId, resetFork } from './utils.js';
import {ZeroAddress} from "ethers";

const { ethers } = pkg;

const expected = {
  'purplesauce.eth': {
    status: 'registered',
    ownershipType: 'emancipated',
    owner: '0xad64b16d897B78bAB654212E0c8297BAa1bff605',
    reservedFor: null,
    expiry: 1844176511n,
    source: {
      name: 'ens.nameWrapper',
      address: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401',
      id: '44834269168588066828382389952956267825100904050388597575761372056325286867146',
    },
  },
  'buffrr.eth': {
    status: 'registered',
    ownershipType: 'emancipated',
    owner: '0xad64b16d897B78bAB654212E0c8297BAa1bff605',
    reservedFor: null,
    expiry: 1786718196n,
    source: {
      name: 'ens.registrar',
      address: '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85',
      id: '17256426415258880895198210160632585472269575254526856154457989302483090776653',
    },
  },
  'nonexistentname123.eth': {
    status: 'unregistered',
    ownershipType: 'emancipated',
    owner: ZeroAddress,
    reservedFor: null,
    expiry: 0n,
    source: {
      name: 'ens.nameWrapper',
      address: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401',
      id: '89215767674054714409203077802041400992681425730238558358435247218268918351722',
    },
  },
  'purplesauce.www': {
    status: 'registered',
    ownershipType: 'emancipated',
    owner: '0x4FeFEc75cd8C2D831055C0E8E029f533b3eBcE4B',
    reservedFor: null,
    expiry: 1708575323n,
    source: {
      name: 'impervious.registrar',
      address: '0x06081C6B2B876EABDC41DFD3345e8Fa59588C02e',
      id: '70162306609079368723299341819664535030071777967408214280993443851403133687057',
    },
  },
  'purplesauce.records': {
    status: 'registered',
    ownershipType: null,
    owner: '0x4FeFEc75cd8C2D831055C0E8E029f533b3eBcE4B',
    reservedFor: null,
    expiry: 1708575323n,
    source: {
      name: 'impervious.registrar',
      address: '0x06081C6B2B876EABDC41DFD3345e8Fa59588C02e',
      id: '35948275635343343051875111912223771825646110822283538565189135760329281076820',
    },
  },
  'purplesauce123.records': {
    status: 'unregistered',
    ownershipType: null,
    owner: '0x0000000000000000000000000000000000000000',
    reservedFor: null,
    expiry: 0n,
    source: {
      name: 'impervious.registrar',
      address: '0x06081C6B2B876EABDC41DFD3345e8Fa59588C02e',
      id: '56838612062026775604459488541592132890157801699913497589183506013166006207915',
    },
  },
  'rainbowpunch.records': {
    status: 'reserved',
    ownershipType: null,
    owner: '0x0000000000000000000000000000000000000000',
    reservedFor: '0xC4f1051c5bD738FD7cf0F6E680c6c0A8B6157aEe',
    expiry: 0n,
    source: {
      name: 'impervious.registrar',
      address: '0x06081C6B2B876EABDC41DFD3345e8Fa59588C02e',
      id: '1365459436881624131292608615364611869845707317528159656377620045475680188315',
    },
  },
  'purplesauce.forever': {
    status: 'registered',
    ownershipType: 'emancipated',
    owner: '0x0000000000000000000000000000000000000000',
    reservedFor: null,
    expiry: 0n,
    source: {
      name: 'forever.registrar',
      address: '0x8436F16c090B0A6B2A7ae4CfCc82E007302a4b38',
      id: '58131958439658858166783622711991968125038725641451181152150068356977405457071',
    },
  },
  'purplesauce123.forever': {
    status: 'unregistered',
    ownershipType: 'emancipated',
    owner: '0x0000000000000000000000000000000000000000',
    reservedFor: null,
    expiry: 0n,
    source: {
      name: 'forever.registrar',
      address: '0x8436F16c090B0A6B2A7ae4CfCc82E007302a4b38',
      id: '49321146898621210958005920695241417637013023674679903372620053263708729905845',
    },
  },

};

describe('Registration details', () => {
  let id = null;
  before(async () => {
    await resetFork();
    id = await createId();
  });

  it('should return correct name status data', async () => {
    const names = Object.keys(expected);

    for (const name of names) {
      const actual = await id.getRegistration(name);
      assert.deepEqual(actual, expected[name]);
    }
  });
});
