// Tests for KeyRegistry + CodeMailbox on an in-process EVM, including against the REAL VoucherEscrow source and the real sealed-box SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { hashTypedData, keccak256, stringToHex, hexToString, toHex } from 'viem';
import { Chain, CHAIN_ID } from './chain.mjs';
import * as V from '../../../backend/vault-sdk/index.js';

const acct = (n) => privateKeyToAccount(`0x${n.toString(16).padStart(64, '0')}`);
const requester = acct(1); // Shivam: has USDC in escrow, receives the code
const fulfiller = acct(2); // Saad: bought the voucher, delivers the code
const outsider = acct(3);
const operator = acct(4);
const deployer = acct(5);
const ZERO = '0x0000000000000000000000000000000000000000';
const escrowIdFor = (requestId) => keccak256(stringToHex(requestId)); // same derivation as backend/src/services/escrow.js
const sigSeed = (tag) => `0x${Buffer.from(tag.padEnd(65, '.')).toString('hex')}`; // stands in for a wallet signature of the key message
const CODE = { code: '9000111122223333', pin: '424242' }; // synthetic, not a real voucher

const types = { Ready: [{ name: 'escrowId', type: 'bytes32' }, { name: 'fulfiller', type: 'address' }, { name: 'validUntil', type: 'uint64' }] };
const domainFor = (mailbox, chainId = CHAIN_ID) => ({ name: 'NetPositiveCodeMailbox', version: '1', chainId, verifyingContract: mailbox.address });
const signReady = (signer, mailbox, message, chainId) => signer.signTypedData({ domain: domainFor(mailbox, chainId), types, primaryType: 'Ready', message });

async function setup({ real = false } = {}) {
  const chain = await Chain.create();
  const registry = await chain.deploy('KeyRegistry', [], deployer.address);
  let escrow, usdc;
  if (real) {
    usdc = await chain.deploy('MockUSDC', [], deployer.address);
    // Same shape as the deployed escrow: fee 0, treasury/rewards unset, 1h timeout.
    escrow = await chain.deploy('VoucherEscrow', [usdc.address, operator.address, operator.address, ZERO, ZERO, 0n, 0n, 3600n], deployer.address);
  } else escrow = await chain.deploy('MockEscrow', [], deployer.address);
  const mailbox = await chain.deploy('CodeMailbox', [escrow.address, registry.address], deployer.address);
  chain.extraAbis = [mailbox.abi, registry.abi];
  const keys = V.deriveVaultKeys(sigSeed('requester-wallet-signature'));
  return { chain, registry, escrow, usdc, mailbox, keys, pk: `0x${keys.publicKeyHex}` };
}
async function fund(ctx, requestId, depositor = requester.address) {
  const id = escrowIdFor(requestId);
  if (ctx.usdc) {
    assert.ok((await ctx.chain.send(ctx.usdc, 'mint', [depositor, 5_000_000n], deployer.address)).ok);
    assert.ok((await ctx.chain.send(ctx.usdc, 'approve', [ctx.escrow.address, 1_000_000n], depositor)).ok);
    const r = await ctx.chain.send(ctx.escrow, 'deposit', [id, 1_000_000n], depositor);
    assert.ok(r.ok, `real escrow deposit failed: ${r.error}`);
  } else assert.ok((await ctx.chain.send(ctx.escrow, 'set', [id, depositor, 1_000_000n, 1], deployer.address)).ok);
  return id;
}
const register = async (ctx, who = requester.address) => assert.ok((await ctx.chain.send(ctx.registry, 'setKey', [ctx.pk], who)).ok);
const validUntilOf = (ctx, secs = 600) => ctx.chain.now + BigInt(secs);

/** What Saad's browser does: seal to the requester's key, then call deliver(). */
async function deliverWith(ctx, requestId, { id, signer = requester, from = fulfiller, permitFor = fulfiller.address, validUntil, kid, keysTo = ctx.keys, ciphertext, permitId } = {}) {
  const escrowId = id ?? escrowIdFor(requestId);
  const vu = validUntil ?? validUntilOf(ctx);
  const env = V.seal(CODE, [keysTo.publicKeyHex], V.voucherAad(requestId, requester.address, fulfiller.address));
  const ct = ciphertext ?? toHex(new TextEncoder().encode(JSON.stringify(env)));
  const sig = await signReady(signer, ctx.mailbox, { escrowId: permitId ?? escrowId, fulfiller: permitFor, validUntil: vu });
  const r = await ctx.chain.send(ctx.mailbox, 'deliver', [escrowId, kid ?? `0x${V.keyId(ctx.keys.publicKeyHex)}`, ct, vu, sig], from.address);
  return { ...r, ct, env, escrowId, validUntil: vu, sig };
}
const expectRevert = (r, name) => { assert.equal(r.ok, false, `expected revert ${name}, but it succeeded`); assert.equal(r.error, name); };

test('key id on-chain equals the SDK key id (clients and contract agree)', async () => {
  const ctx = await setup();
  assert.equal(await ctx.chain.read(ctx.registry, 'keyId', [ctx.pk]), `0x${V.keyId(ctx.keys.publicKeyHex)}`);
});

test('KeyRegistry: register, read back, rotate, reject zero key', async () => {
  const ctx = await setup();
  assert.equal(await ctx.chain.read(ctx.registry, 'currentKeyId', [requester.address]), '0x0000000000000000');
  const r = await ctx.chain.send(ctx.registry, 'setKey', [ctx.pk], requester.address);
  assert.ok(r.ok); assert.equal(r.logs[0].eventName, 'KeySet');
  assert.equal(r.logs[0].args.owner.toLowerCase(), requester.address.toLowerCase());
  const [pk, setAt] = await ctx.chain.read(ctx.registry, 'keyOf', [requester.address]);
  assert.equal(pk, ctx.pk); assert.equal(setAt, ctx.chain.now);
  const other = V.deriveVaultKeys(sigSeed('rotated'));
  assert.ok((await ctx.chain.send(ctx.registry, 'setKey', [`0x${other.publicKeyHex}`], requester.address)).ok);
  assert.equal(await ctx.chain.read(ctx.registry, 'currentKeyId', [requester.address]), `0x${V.keyId(other.publicKeyHex)}`);
  expectRevert(await ctx.chain.send(ctx.registry, 'setKey', [`0x${'00'.repeat(32)}`], requester.address), 'ZeroKey');
  assert.equal((await ctx.chain.read(ctx.registry, 'keyOf', [outsider.address]))[0], `0x${'00'.repeat(32)}`, 'one wallet cannot set another wallet\'s key');
});

test('client-side typed data hash equals the contract digest (so wallets sign exactly what is verified)', async () => {
  const ctx = await setup();
  const message = { escrowId: escrowIdFor('req1'), fulfiller: fulfiller.address, validUntil: 123456n };
  const local = hashTypedData({ domain: domainFor(ctx.mailbox), types, primaryType: 'Ready', message });
  assert.equal(await ctx.chain.read(ctx.mailbox, 'readyDigest', [message.escrowId, message.fulfiller, message.validUntil]), local);
});

test('HAPPY PATH: seal in JS, deliver on-chain, read the event, decrypt in JS; hash and time are recorded', async () => {
  const ctx = await setup();
  const id = await fund(ctx, 'req1'); await register(ctx);
  const r = await deliverWith(ctx, 'req1');
  assert.ok(r.ok, `deliver failed: ${r.error}`);
  const ev = r.logs.find((l) => l.eventName === 'Delivered');
  assert.equal(ev.args.escrowId, id);
  assert.equal(ev.args.fulfiller.toLowerCase(), fulfiller.address.toLowerCase());
  assert.equal(ev.args.recipient.toLowerCase(), requester.address.toLowerCase());
  assert.equal(ev.args.deliveredAt, ctx.chain.now, 'time recorded is the block time');
  assert.equal(ev.args.ciphertext, r.ct);
  assert.equal(ev.args.ciphertextHash, keccak256(r.ct));
  const [f, rec, at, kid, h] = await ctx.chain.read(ctx.mailbox, 'deliveries', [id]);
  assert.equal(f.toLowerCase(), fulfiller.address.toLowerCase()); assert.equal(rec.toLowerCase(), requester.address.toLowerCase());
  assert.equal(at, ctx.chain.now); assert.equal(kid, `0x${V.keyId(ctx.keys.publicKeyHex)}`); assert.equal(h, keccak256(r.ct));
  assert.ok(await ctx.chain.read(ctx.mailbox, 'matches', [id, r.ct]));
  assert.equal(await ctx.chain.read(ctx.mailbox, 'matches', [id, `${r.ct}00`]), false, 'any change to the ciphertext is detected');
  // The requester recovers the code from the public event, using only their wallet-derived key.
  const env = JSON.parse(hexToString(ev.args.ciphertext));
  assert.deepEqual(V.open(env, ctx.keys.privateKey, V.voucherAad('req1', requester.address, fulfiller.address)), CODE);
  // Nobody else can: not the fulfiller's own key, not an outsider's key, not with another request's context.
  const saadKeys = V.deriveVaultKeys(sigSeed('fulfiller-wallet-signature'));
  assert.throws(() => V.open(env, saadKeys.privateKey, V.voucherAad('req1', requester.address, fulfiller.address)));
  assert.throws(() => V.open(env, ctx.keys.privateKey, V.voucherAad('req2', requester.address, fulfiller.address)));
  console.log(`      info  deliver() execution gas: ${r.gas} for a ${(r.ct.length - 2) / 2}-byte ciphertext`);
});

test('the event/storage never contain the plaintext code or PIN', async () => {
  const ctx = await setup();
  await fund(ctx, 'req1'); await register(ctx);
  const r = await deliverWith(ctx, 'req1');
  const blob = JSON.stringify(r.logs.map((l) => l.data)) + r.ct;
  assert.ok(!blob.includes(Buffer.from(CODE.code).toString('hex')) && !hexToString(r.ct).includes(CODE.code) && !hexToString(r.ct).includes(CODE.pin));
});

test('REAL VoucherEscrow: delivery works while Funded, and is refused after release or refund', async () => {
  const ctx = await setup({ real: true });
  const id = await fund(ctx, 'req1'); await register(ctx);
  assert.equal((await ctx.chain.read(ctx.escrow, 'escrows', [id]))[2], 1, 'real escrow is Funded');
  const ok = await deliverWith(ctx, 'req1');
  assert.ok(ok.ok, `deliver against the real escrow failed: ${ok.error}`);
  // released: a second request, delivered nothing, then released by the operator -> delivery must be refused
  const idR = await fund(ctx, 'req-released');
  assert.ok((await ctx.chain.send(ctx.escrow, 'release', [idR, fulfiller.address], operator.address)).ok);
  expectRevert(await deliverWith(ctx, 'req-released'), 'EscrowNotFunded');
  // refunded
  const idF = await fund(ctx, 'req-refunded');
  assert.ok((await ctx.chain.send(ctx.escrow, 'refund', [idF], operator.address)).ok);
  expectRevert(await deliverWith(ctx, 'req-refunded'), 'EscrowNotFunded');
});

test('REAL VoucherEscrow: the full trade, deliver then release to the fulfiller (fee 0)', async () => {
  const ctx = await setup({ real: true });
  const id = await fund(ctx, 'trade1'); await register(ctx);
  assert.ok((await deliverWith(ctx, 'trade1')).ok);
  const before = await ctx.chain.read(ctx.usdc, 'balanceOf', [fulfiller.address]);
  assert.ok((await ctx.chain.send(ctx.escrow, 'release', [id, fulfiller.address], operator.address)).ok);
  assert.equal((await ctx.chain.read(ctx.usdc, 'balanceOf', [fulfiller.address])) - before, 1_000_000n);
});

test('rejects: escrow that was never funded, or does not exist', async () => {
  const ctx = await setup(); await register(ctx);
  expectRevert(await deliverWith(ctx, 'nothing'), 'EscrowNotFunded');
  assert.ok((await ctx.chain.send(ctx.escrow, 'set', [escrowIdFor('r'), requester.address, 1n, 0], deployer.address)).ok);
  expectRevert(await deliverWith(ctx, 'r'), 'EscrowNotFunded');
});

test('rejects: permit signed by the wrong person (outsider, or the fulfiller signing for themselves)', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await register(ctx);
  expectRevert(await deliverWith(ctx, 'req1', { signer: outsider }), 'BadPermit');
  expectRevert(await deliverWith(ctx, 'req1', { signer: fulfiller }), 'BadPermit');
});

test('rejects: a permit for Saad cannot be used by someone else (no front-running or griefing)', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await register(ctx);
  expectRevert(await deliverWith(ctx, 'req1', { from: outsider }), 'BadPermit');
  assert.ok((await deliverWith(ctx, 'req1')).ok, 'the real fulfiller can still deliver afterwards');
});

test('rejects: expired permit, and the boundary second still works', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await register(ctx);
  const vu = validUntilOf(ctx, 100);
  ctx.chain.warp(101);
  expectRevert(await deliverWith(ctx, 'req1', { validUntil: vu }), 'PermitExpired');
  const vu2 = validUntilOf(ctx, 5);
  ctx.chain.warp(5); // exactly at validUntil
  assert.ok((await deliverWith(ctx, 'req1', { validUntil: vu2 })).ok);
});

test('rejects: a permit for another escrow, another chain, or another mailbox cannot be replayed', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await fund(ctx, 'req2'); await register(ctx);
  expectRevert(await deliverWith(ctx, 'req1', { permitId: escrowIdFor('req2') }), 'BadPermit');
  const wrongChain = await deliverWithChain(ctx, 'req1', 5n);
  expectRevert(wrongChain, 'BadPermit');
  const other = await ctx.chain.deploy('CodeMailbox', [ctx.escrow.address, ctx.registry.address], deployer.address);
  const sig = await signReady(requester, other, { escrowId: escrowIdFor('req1'), fulfiller: fulfiller.address, validUntil: validUntilOf(ctx) });
  const env = V.seal(CODE, [ctx.keys.publicKeyHex], V.voucherAad('req1', requester.address, fulfiller.address));
  const r = await ctx.chain.send(ctx.mailbox, 'deliver', [escrowIdFor('req1'), `0x${V.keyId(ctx.keys.publicKeyHex)}`, toHex(new TextEncoder().encode(JSON.stringify(env))), validUntilOf(ctx), sig], fulfiller.address);
  expectRevert(r, 'BadPermit');
});
async function deliverWithChain(ctx, requestId, chainId) {
  const vu = validUntilOf(ctx); const escrowId = escrowIdFor(requestId);
  const sig = await signReady(requester, ctx.mailbox, { escrowId, fulfiller: fulfiller.address, validUntil: vu }, chainId);
  const env = V.seal(CODE, [ctx.keys.publicKeyHex], V.voucherAad(requestId, requester.address, fulfiller.address));
  return ctx.chain.send(ctx.mailbox, 'deliver', [escrowId, `0x${V.keyId(ctx.keys.publicKeyHex)}`, toHex(new TextEncoder().encode(JSON.stringify(env))), vu, sig], fulfiller.address);
}

test('rejects: tampering with the signed validUntil', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await register(ctx);
  const id = escrowIdFor('req1'); const vu = validUntilOf(ctx);
  const sig = await signReady(requester, ctx.mailbox, { escrowId: id, fulfiller: fulfiller.address, validUntil: vu });
  const env = V.seal(CODE, [ctx.keys.publicKeyHex], V.voucherAad('req1', requester.address, fulfiller.address));
  const r = await ctx.chain.send(ctx.mailbox, 'deliver', [id, `0x${V.keyId(ctx.keys.publicKeyHex)}`, toHex(new TextEncoder().encode(JSON.stringify(env))), vu + 100000n, sig], fulfiller.address);
  expectRevert(r, 'BadPermit');
});

test('rejects: requester has no registered key, or ciphertext names a different/stale key', async () => {
  const ctx = await setup(); await fund(ctx, 'req1');
  expectRevert(await deliverWith(ctx, 'req1'), 'NoRecipientKey');
  await register(ctx);
  expectRevert(await deliverWith(ctx, 'req1', { kid: '0x1122334455667788' }), 'WrongKey');
  // rotation: sealed to the OLD key -> refused; sealed to the NEW key -> accepted
  const rotated = V.deriveVaultKeys(sigSeed('rotated-key'));
  assert.ok((await ctx.chain.send(ctx.registry, 'setKey', [`0x${rotated.publicKeyHex}`], requester.address)).ok);
  expectRevert(await deliverWith(ctx, 'req1'), 'WrongKey');
  const ok = await deliverWith(ctx, 'req1', { kid: `0x${V.keyId(rotated.publicKeyHex)}`, keysTo: rotated });
  assert.ok(ok.ok, ok.error);
});

test('rejects: a second delivery for the same escrow (even from the same fulfiller, even with a fresh permit)', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await register(ctx);
  assert.ok((await deliverWith(ctx, 'req1')).ok);
  expectRevert(await deliverWith(ctx, 'req1'), 'AlreadyDelivered');
  ctx.chain.warp(1);
  expectRevert(await deliverWith(ctx, 'req1'), 'AlreadyDelivered');
});

test('rejects: empty and oversized ciphertext; accepts exactly the maximum', async () => {
  const ctx = await setup(); await fund(ctx, 'req1'); await register(ctx);
  expectRevert(await deliverWith(ctx, 'req1', { ciphertext: '0x' }), 'BadCiphertextSize');
  expectRevert(await deliverWith(ctx, 'req1', { ciphertext: `0x${'ab'.repeat(4097)}` }), 'BadCiphertextSize');
  const max = await deliverWith(ctx, 'req1', { ciphertext: `0x${'ab'.repeat(4096)}` });
  assert.ok(max.ok, max.error);
});

test('smart-contract wallet (ERC-1271) requester can approve a fulfiller; an unapproved signature fails', async () => {
  const ctx = await setup();
  const wallet = await ctx.chain.deploy('MockWallet', [], deployer.address);
  const id = await fund(ctx, 'req1', wallet.address);
  assert.ok((await ctx.chain.send(ctx.registry, 'setKey', [ctx.pk], wallet.address)).ok); // the wallet registers its key
  const vu = validUntilOf(ctx); const kid = `0x${V.keyId(ctx.keys.publicKeyHex)}`;
  const env = V.seal(CODE, [ctx.keys.publicKeyHex], V.voucherAad('req1', wallet.address, fulfiller.address));
  const ct = toHex(new TextEncoder().encode(JSON.stringify(env)));
  const digest = await ctx.chain.read(ctx.mailbox, 'readyDigest', [id, fulfiller.address, vu]);
  const sig = `0x${'7a'.repeat(65)}`;
  expectRevert(await ctx.chain.send(ctx.mailbox, 'deliver', [id, kid, ct, vu, sig], fulfiller.address), 'BadPermit');
  assert.ok((await ctx.chain.send(wallet, 'approve', [digest, sig], deployer.address)).ok);
  const ok = await ctx.chain.send(ctx.mailbox, 'deliver', [id, kid, ct, vu, sig], fulfiller.address);
  assert.ok(ok.ok, ok.error);
});

test('constructor rejects zero addresses; matches() is false before any delivery', async () => {
  const ctx = await setup();
  await assert.rejects(ctx.chain.deploy('CodeMailbox', [ZERO, ctx.registry.address], deployer.address), /ZeroAddress/);
  await assert.rejects(ctx.chain.deploy('CodeMailbox', [ctx.escrow.address, ZERO], deployer.address), /ZeroAddress/);
  assert.equal(await ctx.chain.read(ctx.mailbox, 'matches', [escrowIdFor('x'), '0x01']), false);
});
