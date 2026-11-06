// Run: node --test test/vault.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deriveVaultKeys, keyBindingMessage, openSealed, recoverSigner, sealTo, voucherAad } from "../src/lib/vaultCrypto.ts";

const CODE = "9000111122223333";
const PIN = "424242";

test("the key-binding signature recovers the wallet that signed it", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const keys = deriveVaultKeys(await acct.signMessage({ message: "NetPositive vault key v1\n\nfixture" }));
  const message = keyBindingMessage(acct.address, keys.publicKeyHex);
  const signature = await acct.signMessage({ message });
  assert.equal(recoverSigner(message, signature), acct.address.toLowerCase());
});

test("a sealed code is unreadable except by the spender key for that trade", async () => {
  const spender = privateKeyToAccount(generatePrivateKey());
  const buyer = privateKeyToAccount(generatePrivateKey());
  const keys = deriveVaultKeys(await spender.signMessage({ message: "NetPositive vault key v1\n\nspender" }));
  const stranger = deriveVaultKeys(await buyer.signMessage({ message: "NetPositive vault key v1\n\nbuyer" }));
  const aad = voucherAad("order-1", spender.address, buyer.address);
  const env = sealTo({ code: CODE, pin: PIN }, [keys.publicKeyHex], aad);

  assert.equal(JSON.stringify(env).includes(CODE), false);
  assert.equal(JSON.stringify(env).includes(PIN), false);
  assert.deepEqual(openSealed(env, keys.privateKey, aad), { code: CODE, pin: PIN });
  assert.throws(() => openSealed(env, stranger.privateKey, aad));
  assert.throws(() => openSealed(env, keys.privateKey, voucherAad("order-2", spender.address, buyer.address)));
});

test("a missing pin opens as no pin", async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const keys = deriveVaultKeys(await acct.signMessage({ message: "NetPositive vault key v1\n\npin" }));
  const aad = voucherAad("order-3", acct.address, "0x0000000000000000000000000000000000000002");
  const env = sealTo({ code: CODE, pin: null }, [keys.publicKeyHex], aad);
  assert.deepEqual(openSealed(env, keys.privateKey, aad), { code: CODE, pin: null });
});
