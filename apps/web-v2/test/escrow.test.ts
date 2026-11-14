import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  SELECTORS,
  ZERO_BYTES32,
  encodeAccept,
  encodeApprove,
  encodeCancel,
  encodeDeposit,
  encodeDispute,
  encodeMarkDelivered,
  encodeRelease,
  escrowStep,
  lockTerms,
  lockUsdc,
  planStep,
  usdcBaseUnits,
  usdcExact,
} from "../src/lib/escrow.ts";
import { ARC } from "../src/lib/arc.ts";
import type { EscrowRecord } from "../src/lib/onchain.ts";

const ID = "0x" + "ab".repeat(32);
const REF = "0x" + "cd".repeat(32);
const USDC = "0x3600000000000000000000000000000000000000";
const ESCROW = "0x" + "22".repeat(20);
const SPENDER = "0x" + "11".repeat(20);
const BUYER = "0x" + "44".repeat(20);
const word = (v: bigint | number | string) => (typeof v === "string" ? v.replace(/^0x/, "") : BigInt(v).toString(16)).padStart(64, "0");
const selector = (sig: string) => "0x" + Buffer.from(keccak_256(new TextEncoder().encode(sig))).subarray(0, 4).toString("hex");

test("selectors are the first four bytes of keccak256 of the V2 signatures", () => {
  assert.equal(SELECTORS.approve, selector("approve(address,uint256)"));
  assert.equal(SELECTORS.deposit, selector("deposit(bytes32,address,uint256,uint64,uint256)"));
  assert.equal(SELECTORS.accept, selector("accept(bytes32,uint64,bytes)"));
  assert.equal(SELECTORS.markDelivered, selector("markDelivered(bytes32,bytes32)"));
  assert.equal(SELECTORS.release, selector("release(bytes32)"));
  assert.equal(SELECTORS.cancel, selector("cancel(bytes32)"));
  assert.equal(SELECTORS.dispute, selector("dispute(bytes32,bytes32)"));
  assert.equal("0xf023b811", selector("getEscrow(bytes32)"));
  assert.deepEqual([SELECTORS.deposit, SELECTORS.accept, SELECTORS.markDelivered, SELECTORS.release, SELECTORS.cancel, SELECTORS.dispute], ["0xd67bd797", "0x5a4e6b04", "0x4c69bf78", "0x67d42a8b", "0xc4d252f5", "0x82cbf88b"]);
});

test("deposit: ref, token, amount, ttl, maxTotal as five static words", () => {
  const data = encodeDeposit(REF, USDC, 5_370_000n, 86_400, 5_423_700n);
  assert.equal(data, "0xd67bd797" + "cd".repeat(32) + word(USDC) + word(5_370_000n) + word(86_400) + word(5_423_700n));
  assert.equal(data.length, 10 + 5 * 64);
  assert.throws(() => encodeDeposit("0x1234", USDC, 1n, 3600, 1n), /Escrow reference is not a 32-byte hash/);
  assert.throws(() => encodeDeposit(REF, "0x1234", 1n, 3600, 1n), /Not an address/);
  assert.throws(() => encodeDeposit(REF, USDC, 1n, 0, 1n), /lifetime/);
});

test("approve: spender and the exact amount", () => {
  assert.equal(encodeApprove(ESCROW, 5_423_700n), "0x095ea7b3" + word(ESCROW) + word(5_423_700n));
});

test("accept: id, validUntil, then the signature as dynamic bytes (offset 0x60, length, padded data)", () => {
  const sig = "0x" + "9a".repeat(65); // a normal 65-byte signature
  const data = encodeAccept(ID, 1_800_000_000, sig);
  assert.equal(data, "0x5a4e6b04" + "ab".repeat(32) + word(1_800_000_000) + word(0x60) + word(65) + "9a".repeat(65) + "00".repeat(31));
  assert.equal((data.length - 10) % 64, 0);
  // A length that is already a multiple of 32 gets no padding; an ERC-1271 wallet's longer signature works too.
  assert.equal(encodeAccept(ID, 1, "0x" + "01".repeat(64)), "0x5a4e6b04" + "ab".repeat(32) + word(1) + word(0x60) + word(64) + "01".repeat(64));
  assert.equal(encodeAccept(ID, 1, "0x" + "01".repeat(200)).length, 10 + 64 * 4 + 64 * 7);
  assert.throws(() => encodeAccept(ID, 1, "0x"), /not valid hex/);
  assert.throws(() => encodeAccept(ID, 1, "0xabc"), /not valid hex/);
  assert.throws(() => encodeAccept(ID, 0, sig), /expiry/);
  assert.throws(() => encodeAccept("0x12", 1, sig), /Escrow id is not a 32-byte hash/);
});

test("markDelivered, release, cancel, dispute", () => {
  assert.equal(encodeMarkDelivered(ID), "0x4c69bf78" + "ab".repeat(32) + "0".repeat(64));
  assert.equal(encodeMarkDelivered(ID, REF), "0x4c69bf78" + "ab".repeat(32) + "cd".repeat(32));
  assert.equal(encodeRelease(ID), "0x67d42a8b" + "ab".repeat(32));
  assert.equal(encodeCancel(ID), "0xc4d252f5" + "ab".repeat(32));
  assert.equal(encodeDispute(ID), "0x82cbf88b" + "ab".repeat(32) + "0".repeat(64));
  assert.equal(encodeDispute(ID, ZERO_BYTES32), encodeDispute(ID));
  assert.throws(() => encodeRelease("nope"), /32-byte/);
});

/* ------------------------------------------------------ terms of a lock */

test("USDC amounts: text to base units and back", () => {
  assert.equal(usdcBaseUnits("5.37"), 5_370_000n);
  assert.equal(usdcBaseUnits("106"), 106_000_000n);
  assert.equal(usdcBaseUnits("0.000001"), 1n);
  assert.throws(() => usdcBaseUnits("1.0000001"), /Not a USDC amount/);
  assert.throws(() => usdcBaseUnits("-1"), /Not a USDC amount/);
  assert.equal(usdcExact(5_370_000n), "5.37");
  assert.equal(usdcExact(53_700n), "0.0537");
  assert.equal(usdcExact(1_000_000n), "1.00");
  assert.equal(usdcExact(1n), "0.000001");
});

test("lock terms: the server's fee and total are accepted when they match what was reviewed", () => {
  const t = lockTerms({ receives: "5.37", total: "5.42" }, { amountUsdcBaseUnits: "5370000", feeUsdcBaseUnits: "53700", totalUsdcBaseUnits: "5423700" });
  assert.deepEqual(t, { amount: 5_370_000n, fee: 53_700n, total: 5_423_700n });
});

test("lock terms: anything beyond rounding stops before the wallet is asked", () => {
  const shown = { receives: "5.37", total: "5.42" };
  // The fee doubled since the screen was drawn.
  assert.throws(() => lockTerms(shown, { amountUsdcBaseUnits: "5370000", feeUsdcBaseUnits: "107400", totalUsdcBaseUnits: "5477400" }), /total is 5\.4774 USDC \(fee 0\.1074\), but you reviewed 5\.42 USDC/);
  // A cheaper total is also a surprise.
  assert.throws(() => lockTerms(shown, { amountUsdcBaseUnits: "5370000", feeUsdcBaseUnits: "0", totalUsdcBaseUnits: "5370000" }), /reviewed 5\.42/);
  // The buyer's amount is not what was asked for.
  assert.throws(() => lockTerms(shown, { amountUsdcBaseUnits: "5360000", feeUsdcBaseUnits: "53600", totalUsdcBaseUnits: "5413600" }), /would pay the buyer 5\.36 USDC, not the 5\.37/);
  // Numbers that don't add up, or an old server that sends no fee or total.
  assert.throws(() => lockTerms(shown, { amountUsdcBaseUnits: "5370000", feeUsdcBaseUnits: "53700", totalUsdcBaseUnits: "5370000" }), /don't add up/);
  assert.throws(() => lockTerms(shown, { amountUsdcBaseUnits: "5370000" }), /didn't say what fee and total/);
  for (const bad of [/Nothing was locked/]) assert.throws(() => lockTerms(shown, {}), bad);
});

/* -------------------------------------------- what each step does on-chain */

const NOW = 1_800_000_000;
const rec = (o: Partial<EscrowRecord> = {}): EscrowRecord => ({ depositor: SPENDER, openUntil: NOW + 3600, epoch: 0, fulfiller: null, deadline: NOW + 3600, status: 1, token: USDC, reviewWindow: 3600, fulfillWindow: 1800, amount: 5_370_000n, fee: 53_700n, bond: 1_000_000n, ...o });
const permit = { validUntil: NOW + 600, signature: "0x" + "9a".repeat(65) };
const why = (p: ReturnType<typeof planStep>) => (p.do === "stop" ? p.why : p.do);

test("accept: sent only with a live permit on an open escrow; a retry after success is skipped", () => {
  assert.equal(planStep("accept", rec(), BUYER, NOW, permit).do, "send");
  assert.equal(planStep("accept", rec({ fulfiller: BUYER }), BUYER.toUpperCase().replace("0X", "0x"), NOW, permit).do, "skip");
  assert.match(why(planStep("accept", rec(), BUYER, NOW, null)), /hasn't pressed Ready/);
  assert.match(why(planStep("accept", rec(), BUYER, NOW, { ...permit, validUntil: NOW - 1 })), /Ready permit has expired.*don't buy the voucher/);
  assert.match(why(planStep("accept", rec({ fulfiller: "0x" + "55".repeat(20) }), BUYER, NOW, permit)), /Another wallet is already bound/);
  // A permit signed before the buyer slot was reopened (older epoch) is refused before any gas is spent.
  assert.equal(planStep("accept", rec({ epoch: 1 }), BUYER, NOW, { ...permit, epoch: 1 }).do, "send");
  assert.match(why(planStep("accept", rec({ epoch: 1 }), BUYER, NOW, { ...permit, epoch: 0 })), /earlier round.*press Ready again/);
  assert.match(why(planStep("accept", rec(), SPENDER, NOW, permit)), /can't also be the buyer/);
  assert.match(why(planStep("accept", rec({ openUntil: NOW }), BUYER, NOW, permit)), /expired on-chain/);
  assert.match(why(planStep("accept", rec({ status: 5 }), BUYER, NOW, permit)), /no longer open/);
  assert.match(why(planStep("accept", rec({ status: 0 }), BUYER, NOW, permit)), /no deposit/);
});

test("markDelivered: only the bound buyer, before the deadline; skipped once delivered", () => {
  assert.equal(planStep("markDelivered", rec({ fulfiller: BUYER }), BUYER, NOW).do, "send");
  for (const status of [2, 3, 4, 6]) assert.equal(planStep("markDelivered", rec({ fulfiller: BUYER, status }), BUYER, NOW).do, "skip");
  assert.match(why(planStep("markDelivered", rec(), BUYER, NOW)), /not the buyer bound to the order/);
  assert.match(why(planStep("markDelivered", rec({ fulfiller: BUYER, deadline: NOW }), BUYER, NOW)), /deadline has passed/);
  assert.match(why(planStep("markDelivered", rec({ fulfiller: BUYER, status: 5 }), BUYER, NOW)), /refunded/);
});

test("release: the spender, once a buyer is bound; skipped when already released", () => {
  assert.equal(planStep("release", rec({ fulfiller: BUYER, status: 2 }), SPENDER, NOW).do, "send");
  assert.equal(planStep("release", rec({ fulfiller: BUYER, status: 3 }), SPENDER, NOW).do, "send"); // releasing ends a dispute too
  assert.equal(planStep("release", rec({ fulfiller: BUYER, status: 4 }), SPENDER, NOW).do, "skip");
  assert.match(why(planStep("release", rec({ status: 1 }), SPENDER, NOW)), /nobody to pay/);
  assert.match(why(planStep("release", rec({ fulfiller: BUYER, status: 2 }), BUYER, NOW)), /Only the wallet that locked/);
  assert.match(why(planStep("release", rec({ fulfiller: BUYER, status: 5 }), SPENDER, NOW)), /already been settled/);
});

test("cancel: only while no buyer is bound; nothing to send when nothing was deposited or it is already refunded", () => {
  assert.equal(planStep("cancel", rec(), SPENDER, NOW).do, "send");
  assert.equal(planStep("cancel", rec({ status: 0 }), SPENDER, NOW).do, "skip");
  assert.equal(planStep("cancel", rec({ status: 5 }), SPENDER, NOW).do, "skip");
  assert.match(why(planStep("cancel", rec({ fulfiller: BUYER }), SPENDER, NOW)), /buyer is already bound/);
  assert.match(why(planStep("cancel", rec({ status: 2, fulfiller: BUYER }), SPENDER, NOW)), /can't be cancelled any more/);
  assert.match(why(planStep("cancel", rec(), BUYER, NOW)), /Only the wallet that locked/);
});

test("dispute: only the spender, only after delivery; skipped when already disputed", () => {
  assert.equal(planStep("dispute", rec({ fulfiller: BUYER, status: 2 }), SPENDER, NOW).do, "send");
  assert.equal(planStep("dispute", rec({ fulfiller: BUYER, status: 3 }), SPENDER, NOW).do, "skip");
  assert.match(why(planStep("dispute", rec({ fulfiller: BUYER, status: 2 }), BUYER, NOW)), /Only the spender/);
  assert.match(why(planStep("dispute", rec({ fulfiller: BUYER }), SPENDER, NOW)), /hasn't marked the voucher delivered/);
  assert.match(why(planStep("dispute", rec({ fulfiller: BUYER, status: 4 }), SPENDER, NOW)), /already been settled/);
});

/* ------------------------------------------------------- against a wallet */

const getEscrowReturn = (e: EscrowRecord) => "0x" + [e.depositor, e.openUntil, e.epoch, e.fulfiller ?? "0x" + "00".repeat(20), e.deadline, e.status, e.token, e.reviewWindow, e.fulfillWindow, e.amount, e.fee, e.bond].map(word).join("");

function wallet(opts: { chain?: string; escrow?: EscrowRecord; balance?: bigint; allowance?: bigint }) {
  const sent: { to: string; data: string; from: string; value: string }[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    const p = params as { to?: string; data?: string }[];
    if (method === "eth_chainId") return opts.chain ?? ARC.hex;
    if (method === "eth_call") {
      const d = p[0].data!;
      if (d.startsWith("0xf023b811")) return getEscrowReturn(opts.escrow ?? rec({ status: 0 }));
      return "0x" + word(d.startsWith("0x70a08231") ? (opts.balance ?? 0n) : (opts.allowance ?? 0n));
    }
    if (method === "eth_sendTransaction") {
      sent.push(p[0] as never);
      return "0x" + word(sent.length);
    }
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
    throw Object.assign(new Error("unexpected " + method), { code: 4902 });
  };
  return { request, sent };
}

const terms = { from: SPENDER, escrow: ESCROW, escrowRef: REF, escrowId: ID, token: USDC, amount: 5_370_000n, total: 5_423_700n, ttlSeconds: 86_400 };

test("lock: approves exactly the total, then deposits the buyer's amount with the total as the ceiling", async () => {
  const w = wallet({ balance: 10_000_000n });
  const hashes: string[] = [];
  const hash = await lockUsdc(w.request, { ...terms, onDepositHash: (h) => hashes.push(h) });
  assert.deepEqual(w.sent.map((t) => t.to), [USDC, ESCROW]);
  assert.equal(w.sent[0].data, encodeApprove(ESCROW, 5_423_700n));
  assert.equal(w.sent[1].data, encodeDeposit(REF, USDC, 5_370_000n, 86_400, 5_423_700n));
  assert.ok(w.sent.every((t) => t.value === "0x0" && t.from === SPENDER));
  assert.deepEqual(hashes, [hash]);
});

test("lock: an allowance that already covers the total is reused; a smaller one is simply raised", async () => {
  const enough = wallet({ balance: 10_000_000n, allowance: 5_423_700n });
  await lockUsdc(enough.request, terms);
  assert.deepEqual(enough.sent.map((t) => t.to), [ESCROW]);
  const small = wallet({ balance: 10_000_000n, allowance: 1n });
  await lockUsdc(small.request, terms);
  assert.deepEqual(small.sent.map((t) => t.data.slice(0, 10)), ["0x095ea7b3", "0xd67bd797"]); // one approve to the total, no reset to zero first
});

test("lock: stops without sending when something is off", async () => {
  const poor = wallet({ balance: 5_400_000n }); // covers the amount but not amount + fee
  await assert.rejects(lockUsdc(poor.request, terms), /needs 5\.42/);
  assert.equal(poor.sent.length, 0);
  await assert.rejects(lockUsdc(wallet({ balance: 10_000_000n }).request, { ...terms, token: "0x" + "99".repeat(20) }), /token other than USDC/);
  const taken = wallet({ balance: 10_000_000n, escrow: rec() });
  await assert.rejects(lockUsdc(taken.request, terms), /already has a record/);
  assert.equal(taken.sent.length, 0);
  const elsewhere = wallet({ chain: "0x1", balance: 10_000_000n });
  await assert.rejects(lockUsdc(elsewhere.request, terms));
  assert.equal(elsewhere.sent.length, 0);
});

test("steps: the transaction goes to the escrow with the right calldata, and a repeat is not sent twice", async () => {
  const a = { from: BUYER, escrow: ESCROW, escrowId: ID, permit: { validUntil: Math.floor(Date.now() / 1000) + 600, signature: permit.signature } };
  const open = wallet({ escrow: rec({ openUntil: Math.floor(Date.now() / 1000) + 3600 }) });
  assert.match((await escrowStep(open.request, "accept", a))!, /^0x/);
  assert.deepEqual(open.sent.map((t) => [t.to, t.data]), [[ESCROW, encodeAccept(ID, a.permit.validUntil, a.permit.signature)]]);

  const bound = wallet({ escrow: rec({ fulfiller: BUYER }) });
  assert.equal(await escrowStep(bound.request, "accept", a), null);
  assert.equal(bound.sent.length, 0);

  const delivered = wallet({ escrow: rec({ fulfiller: BUYER, status: 2 }) });
  await escrowStep(delivered.request, "release", { from: SPENDER, escrow: ESCROW, escrowId: ID });
  assert.equal(delivered.sent[0].data, encodeRelease(ID));
  await assert.rejects(escrowStep(delivered.request, "dispute", { from: BUYER, escrow: ESCROW, escrowId: ID }), /Only the spender/);
  assert.equal(delivered.sent.length, 1);
});
