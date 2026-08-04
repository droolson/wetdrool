const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export const MAX_SIGNAL_CHARACTERS = 2000;
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const EXPORT_SCHEMA = "wetdrool.local-node-export/1";
export const RECORD_SCHEMA = "wetdrool.encrypted-local-record/1";
export const MANIFEST_SCHEMA = "droolnet.signed-local-envelope/1";

function normalizeString(value) {
  return value.normalize("NFC");
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalize(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(normalizeString(value));
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Canonical alpha objects accept safe integers only.");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => canonicalize(entry)).join(",") + "]";
  }
  if (!isPlainObject(value)) {
    throw new TypeError("Canonical alpha objects must be plain JSON values.");
  }

  const normalized = new Map();
  for (const [rawKey, entry] of Object.entries(value)) {
    if (typeof entry === "undefined") {
      throw new TypeError("Undefined values are not canonical.");
    }
    const key = normalizeString(rawKey);
    if (normalized.has(key)) {
      throw new TypeError("Duplicate keys after Unicode normalization.");
    }
    normalized.set(key, entry);
  }

  return (
    "{" +
    [...normalized.keys()]
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalize(normalized.get(key)))
      .join(",") +
    "}"
  );
}

export function utf8(value) {
  return UTF8.encode(value);
}

export function decodeUtf8(bytes) {
  return UTF8_DECODER.decode(bytes);
}

export function concatBytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

export function base64ToBytes(value) {
  if (typeof value !== "string" || value.length > MAX_IMPORT_BYTES * 2) {
    throw new TypeError("Invalid base64 field.");
  }
  const binary = globalThis.atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export function decodeBase58(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    throw new TypeError("Invalid base58 value.");
  }

  let number = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) {
      throw new TypeError("Invalid base58 character.");
    }
    number = number * 58n + BigInt(digit);
  }

  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  bytes.reverse();

  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") {
    leadingZeroes += 1;
  }

  return new Uint8Array([...new Array(leadingZeroes).fill(0), ...bytes]);
}

export function encodeBase58(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Base58 input must be bytes.");
  }

  let number = 0n;
  for (const byte of bytes) {
    number = (number << 8n) | BigInt(byte);
  }

  let encoded = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    number /= 58n;
  }

  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) {
    encoded = "1" + encoded;
    leadingZeroes += 1;
  }

  return encoded || "1";
}

function bytesToBase32(bytes) {
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  }
  return output;
}

export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

export async function cidForBytes(bytes) {
  const digest = await sha256(bytes);
  const cidBytes = concatBytes(
    new Uint8Array([0x01, 0x55]),
    new Uint8Array([0x12, 0x20]),
    digest,
  );
  return "b" + bytesToBase32(cidBytes);
}

export function buildVaultUnlockMessage(publicKey, origin) {
  return [
    "WETDROOL LOCAL NODE UNLOCK v1",
    "",
    "Application: WetDrool",
    "Research layer: WOKE.NET",
    "Origin: " + origin,
    "Wallet: " + publicKey,
    "Purpose: derive a local-only encryption key and prove wallet control",
    "",
    "This is not a transaction, token approval, payment, or age verification.",
    "The signature is processed on this device and is never uploaded.",
  ].join("\n");
}

export function signingBytesForManifest(manifest) {
  return utf8("WETDROOL SIGNED LOCAL ENVELOPE v1\n" + canonicalize(manifest));
}

export async function verifyWalletSignature(messageBytes, signature, publicKey) {
  if (!(messageBytes instanceof Uint8Array) || !(signature instanceof Uint8Array)) {
    return false;
  }
  if (signature.length !== 64) {
    return false;
  }
  const publicKeyBytes = decodeBase58(publicKey);
  if (publicKeyBytes.length !== 32) {
    return false;
  }
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      messageBytes,
    );
  } catch {
    return false;
  }
}

export async function deriveVaultKey(signature, publicKey, origin) {
  const inputKey = await globalThis.crypto.subtle.importKey(
    "raw",
    signature,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const salt = await sha256(utf8("wetdrool:vault-salt:v1:" + publicKey));
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: utf8("wetdrool:local-node:v1:" + origin),
    },
    inputKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealJson(value, key, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: utf8(canonicalize(aad)),
      tagLength: 128,
    },
    key,
    utf8(canonicalize(value)),
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function openJson(sealed, key, aad) {
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(sealed.iv),
      additionalData: utf8(canonicalize(aad)),
      tagLength: 128,
    },
    key,
    base64ToBytes(sealed.ciphertext),
  );
  return JSON.parse(decodeUtf8(new Uint8Array(plaintext)));
}

export async function createUnsignedRecord(body, publicKey, vaultKey) {
  const normalizedBody = normalizeString(body.trim());
  if (normalizedBody.length < 1 || normalizedBody.length > MAX_SIGNAL_CHARACTERS) {
    throw new TypeError("Signal must contain 1 to 2000 characters.");
  }

  const createdAt = new Date().toISOString();
  const author = "solana:" + publicKey;
  const aad = {
    schema: "wokenet.encrypted-object-aad/1",
    app: "wetdrool",
    author,
    contentType: "application/vnd.wetdrool.private-note+json",
    createdAt,
    publication: "local-only",
  };
  const payload = {
    schema: "wetdrool.private-note/1",
    author,
    body: normalizedBody,
    createdAt,
  };
  const sealed = await sealJson(payload, vaultKey, aad);
  const blob = {
    schema: RECORD_SCHEMA,
    aad,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
  };
  const cid = await cidForBytes(utf8(canonicalize(blob)));
  const manifest = {
    schema: MANIFEST_SCHEMA,
    app: "wetdrool",
    author,
    createdAt,
    encryption: {
      algorithm: "AES-256-GCM",
      keyScope: "wallet-derived-local",
    },
    objectCid: cid,
    publication: {
      network: "local-only",
      onchain: false,
      replicated: false,
    },
  };
  return { blob, cid, manifest };
}

function assertRecordShape(record) {
  if (!isPlainObject(record)) {
    throw new TypeError("Record must be an object.");
  }
  if (record.schema !== "wetdrool.signed-local-record/1") {
    throw new TypeError("Unsupported record schema.");
  }
  if (typeof record.cid !== "string" || record.cid.length > 128) {
    throw new TypeError("Invalid record CID.");
  }
  if (typeof record.authorPublicKey !== "string") {
    throw new TypeError("Missing author public key.");
  }
  if (!isPlainObject(record.manifest) || !isPlainObject(record.blob)) {
    throw new TypeError("Record is missing its manifest or encrypted blob.");
  }
  if (typeof record.signature !== "string") {
    throw new TypeError("Record is missing its signature.");
  }
}

export async function verifyRecord(record) {
  try {
    assertRecordShape(record);
    if (record.manifest.schema !== MANIFEST_SCHEMA) {
      return false;
    }
    if (record.blob.schema !== RECORD_SCHEMA) {
      return false;
    }
    if (record.manifest.objectCid !== record.cid) {
      return false;
    }
    if (record.manifest.author !== "solana:" + record.authorPublicKey) {
      return false;
    }
    const recomputedCid = await cidForBytes(utf8(canonicalize(record.blob)));
    if (recomputedCid !== record.cid) {
      return false;
    }
    return verifyWalletSignature(
      signingBytesForManifest(record.manifest),
      base64ToBytes(record.signature),
      record.authorPublicKey,
    );
  } catch {
    return false;
  }
}

export async function decryptRecord(record, vaultKey) {
  if (!(await verifyRecord(record))) {
    throw new Error("Record verification failed.");
  }
  return openJson(record.blob, vaultKey, record.blob.aad);
}

export function makeSignedRecord(unsignedRecord, publicKey, signature) {
  return {
    schema: "wetdrool.signed-local-record/1",
    authorPublicKey: publicKey,
    blob: unsignedRecord.blob,
    cid: unsignedRecord.cid,
    manifest: unsignedRecord.manifest,
    signature: bytesToBase64(signature),
  };
}

export function shortIdentity(value) {
  if (typeof value !== "string" || value.length < 12) {
    return value;
  }
  return value.slice(0, 6) + "…" + value.slice(-6);
}
