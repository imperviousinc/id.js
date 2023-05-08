import { answer, name } from 'dns-packet';
import types from 'dns-packet/types.js';
import classes from 'dns-packet/classes.js';
import { keccak256 } from 'ethers';
import { Buffer } from 'buffer';

export function rrSetIdEncode(domain, rrSetId) {
  if (typeof rrSetId === 'string') {
    rrSetId = { name: domain.name, type: rrSetId };
  }

  const setNamehash = keccak256(name.encode(rrSetId.name));
  const setType = types.toType(rrSetId.type);
  return [setNamehash, setType];
}

export function encodeDNSRRSets(rrSets) {
  rrSets = JSON.parse(JSON.stringify(rrSets));
  rrSets = rrSets.map(dnsPacketFormat);

  // Sort record sets by name and type to prevent accidental overwrites
  rrSets = rrSets.sort((a, b) => {
    const nameCompare = a.name === b.name ? 0 : a.name < b.name ? -1 : 1;
    if (nameCompare !== 0) return nameCompare;
    return a.type === b.type ? 0 : a.type < b.type ? -1 : 1;
  });

  // If two or more records have the same name and type
  // but one has empty rdata remove to prevent the contract
  // from deleting the entire set
  let i = 0;
  while (i < rrSets.length) {
    const rrSet = rrSets[i];
    const next = rrSets[i + 1];

    if (!next || rrSet.name !== next.name || rrSet.type !== next.type) {
      i += 1;
      continue;
    }

    if (!rrSet.data && next.data) {
      rrSets.splice(i, 1);
    } else if (rrSet.data && !next.data) {
      rrSets.splice(i + 1, 1);
    }

    i += 2;
  }

  const buf = Buffer.alloc(sizeOfAll(rrSets));
  packAll(rrSets, buf, 0);

  return buf;
}

export function rrSetDecode(wire) {
  if (wire === '0x') return [];
  const raw = Buffer.from(wire.slice(2), 'hex');
  let offset = 0;
  let length = raw.length;
  let rrs = [];
  while (length > 0) {
    const decoded = answer.decode(raw, offset);
    offset += answer.decode.bytes;
    length -= answer.decode.bytes;
    const rr = presentationFormat(decoded);
    delete rr.flush;
    rrs.push(rr);
  }

  return rrs;
}

function packAll(rrs, buf, offset) {
  for (let i = 0; i < rrs.length; i++) {
    offset += pack(rrs[i], buf, offset);
  }
  return offset;
}

function pack(rr, buf, offset) {
  if (!rr.data) {
    if (!buf) buf = Buffer.alloc(name.encodingLength(rr.name) + 8);
    if (!offset) offset = 0;

    const oldOffset = offset;

    name.encode(rr.name, buf, offset);
    offset += name.encode.bytes;

    buf.writeUInt16BE(types.toType(rr.type), offset);
    offset += 2;

    const klass = classes.toClass(rr.class === undefined ? 'IN' : rr.class);
    buf.writeUInt16BE(klass, offset + 2);
    offset += 2;

    buf.writeUInt32BE(rr.ttl || 0, offset + 4);
    offset += 4;

    return offset - oldOffset;
  }

  answer.encode(rr, buf, offset);
  return answer.encode.bytes;
}

function sizeOfAll(rrs) {
  let len = 0;
  for (let i = 0; i < rrs.length; i++) len += sizeOf(rrs[i]);
  return len;
}

function sizeOf(rr) {
  if (!rr.data) {
    return name.encodingLength(rr.name) + 8;
  }

  rr = dnsPacketFormat(rr);
  return answer.encodingLength(rr);
}

function dnsPacketFormat(rr) {
  const t = typeof rr.type === 'string' ? rr.type : types.toString(rr.type);
  if (!rr.data) return rr;

  switch (t) {
    case 'TLSA':
      if (typeof rr.data.certificate !== 'string') return rr;
      rr.data.certificate = Buffer.from(rr.data.certificate.replace(/\s+/g, ''), 'hex');
      return rr;
    case 'DS':
      if (typeof rr.data.digest !== 'string') return rr;
      rr.data.digest = Buffer.from(rr.data.digest.replace(/\s+/g, ''), 'hex');
      return rr;
    case 'DNSKEY':
      if (typeof rr.data.key !== 'string') return rr;
      rr.data.key = Buffer.from(rr.data.key.replace(/\s+/g, ''), 'base64');
      return rr;
    default:
      return rr;
  }
}

function presentationFormat(rr) {
  const t = typeof rr.type === 'string' ? rr.type : types.toString(rr.type);
  if (!rr.data) return rr;

  switch (t) {
    case 'TLSA':
      if (isObject(rr.data.certificate)) {
        rr.data.certificate = rr.data.certificate.toString('hex').toUpperCase();
      }
      return rr;
    case 'TXT':
      if (isObject(rr.data)) {
        rr.data = rr.data.toString();
      }
      if (Array.isArray(rr.data) && rr.data.length > 0 && rr.data[0] instanceof Buffer) {
        rr.data = rr.data.map((d) => d.toString('utf-8'));
      }
      if (Array.isArray(rr.data) && rr.data.length === 1) {
        rr.data = rr.data[0];
      }
      return rr;
    case 'DS':
      if (isObject(rr.data.digest)) {
        rr.data.digest = rr.data.digest.toString('hex').toUpperCase();
      }
      return rr;
    case 'DNSKEY':
      if (isObject(rr.data.key)) {
        rr.data.key = rr.data.key.toString('base64');
      }
      return rr;
    default:
      return rr;
  }
}

function isObject(value) {
  if (value !== null && typeof value === 'object') {
    return !(value instanceof Array);
  }
  return false;
}
