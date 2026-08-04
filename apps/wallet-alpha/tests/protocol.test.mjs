import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVaultUnlockMessage,
  canonicalize,
  cidForBytes,
  createUnsignedRecord,
  decodeBase58,
  decryptRecord,
  deriveVaultKey,
  encodeBase58,
  makeSignedRecord,
  signingBytesForManifest,
  utf8,
  verifyRecord,
  verifyWalletSignature,
} from "../protocol.js";

test("canonicalization is stable across object key order", () => {
  const first = canonicalize({ z: 3, a: ["é", true], nested: { b: 2, a: 1 } });
  const second = canonicalize({ nested: { a: 1, b: 2 }, a: ["e\u0301", true], z: 3 });
  assert.equal(first, second);
});

test("base58 preserves leading zero bytes", () => {
  const bytes = new Uint8Array([0, 0, 3, 9, 255, 18]);
  assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
});

test("CIDv1 raw SHA-256 identifiers are deterministic", async () => {
  const first = await cidForBytes(utf8("wetdrool"));
  const second = await cidForBytes(utf8("wetdrool"));
  const different = await cidForBytes(utf8("wokenet"));
  assert.match(first, /^bafkrei[a-z2-7]+$/);
  assert.equal(first, second);
  assert.notEqual(first, different);
});

test("a wallet-signed encrypted local record verifies and decrypts", async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const publicKey = encodeBase58(rawPublicKey);
  const unlockMessage = utf8(buildVaultUnlockMessage(publicKey, "https://wetdrool.com"));
  const unlockSignature = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, unlockMessage),
  );
  assert.equal(
    await verifyWalletSignature(unlockMessage, unlockSignature, publicKey),
    true,
  );

  const vaultKey = await deriveVaultKey(
    unlockSignature,
    publicKey,
    "https://wetdrool.com",
  );
  const unsigned = await createUnsignedRecord("local encrypted proof", publicKey, vaultKey);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      keyPair.privateKey,
      signingBytesForManifest(unsigned.manifest),
    ),
  );
  const record = makeSignedRecord(unsigned, publicKey, signature);

  assert.equal(await verifyRecord(record), true);
  const payload = await decryptRecord(record, vaultKey);
  assert.equal(payload.body, "local encrypted proof");

  record.blob.ciphertext =
    record.blob.ciphertext.slice(0, -2) + (record.blob.ciphertext.endsWith("AA") ? "BB" : "AA");
  assert.equal(await verifyRecord(record), false);
});
