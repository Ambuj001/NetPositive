import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeGetEscrow, encodeGetEscrow, judgeEscrow, readEscrow, untilText, type OnchainEscrow } from "../src/lib/onchain.ts";
import { ARC, WalletStepError, assertOnArc, assertUsdc, switchToArc, usdcAllowance, usdcText } from "../src/lib/arc.ts";

const ID = "0x" + "ab".repeat(32);
const SPENDER = "0x" + "11".repeat(20);
const BUYER = "0x" + "44".repeat(20);
const USDC = "0x3600000000000000000000000000000000000000";
const word = (v: bigint | number | string) => (typeof v === "string" ? v.replace(/^0x/, "") : BigInt(v).toString(16)).padStart(64, "0");

/** getEscrow return data: depositor, openUntil, epoch, fulfiller, deadline, status, token, reviewWindow, fulfillWindow, amount, fee, bond. */
const record = (o: Partial<{ depositor: string; openUntil: number; epoch: number; fulfiller: string; deadline: number; status: number; amount: bigint; fee: bigint }> = {}) =>
  "0x" +
  [o.depositor ?? SPENDER, o.openUntil ?? 1_800_000_000, o.epoch ?? 0, o.fulfiller ?? "0x" + "00".repeat(20), o.deadline ?? 1_800_000_000, o.status ?? 1, USDC, 3600, 1800, o.amount ?? 5_370_000n, o.fee ?? 53_700n, 1_000_000n].map(word).join("");

test("escrow read: calldata is getEscrow's selector + the escrow id", () => {
  assert.equal(encodeGetEscrow(ID), "0xf023b811" + "ab".repeat(32));
  assert.equal(encodeGetEscrow(ID.toUpperCase().replace("0X", "0x")), "0xf023b811" + "ab".repeat(32));
  assert.throws(() => encodeGetEscrow("0x1234"), /32-byte/);
});

test("escrow read: decodes the 12 words of getEscrow in order, and rejects short returns", () => {
  assert.deepEqual(decodeGetEscrow(record({ fulfiller: BUYER, epoch: 2, deadline: 1_800_000_500, status: 2 })), {
    depositor: SPENDER,
    openUntil: 1_800_000_000,
    epoch: 2,
    fulfiller: BUYER,
    deadline: 1_800_000_500,
    status: 2,
    token: USDC,
    reviewWindow: 3600,
    fulfillWindow: 1800,
    amount: 5_370_000n,
    fee: 53_700n,
    bond: 1_000_000n,
  });
  // No buyer bound: the zero address reads as null, not as a wallet.
  assert.equal(decodeGetEscrow(record()).fulfiller, null);
  assert.throws(() => decodeGetEscrow("0x"), /no escrow data/);
  // The old three-word escrows() shape is not accepted as an escrow record.
  assert.throws(() => decodeGetEscrow("0x" + word(SPENDER) + word(1n) + word(1n)), /no escrow data/);
});

test("escrow read: one JSON-RPC batch, answers matched by id in any order", async () => {
  let sent: { method: string; params: { to: string; data: string }[] }[] = [];
  const fake = async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => [{ id: 2, result: "0x10" }, { id: 1, result: record({ fulfiller: BUYER }) }] };
  };
  const contract = "0x" + "22".repeat(20);
  const e = await readEscrow("https://rpc.example", contract, ID, fake as never);
  assert.equal(e.block, 16);
  assert.equal(e.fulfiller, BUYER);
  assert.equal(e.amount, 5_370_000n);
  assert.deepEqual(sent.map((c) => c.method), ["eth_call", "eth_blockNumber"]);
  assert.deepEqual(sent[0].params[0], { to: contract, data: "0xf023b811" + "ab".repeat(32) });
  await assert.rejects(readEscrow("https://rpc.example", contract, ID, (async () => ({ ok: true, status: 200, json: async () => [{ id: 1, error: { message: "execution reverted" } }] })) as never), /execution reverted/);
  await assert.rejects(readEscrow("https://rpc.example", "0x12", ID, fake as never), /No escrow contract address/);
});

/* ---------------------------------------------------------------- verdict */

const NOW = 1_799_999_000_000; // 1000 s before the default deadline
const order = { status: "open", crypto_spender: SPENDER.toUpperCase().replace("0X", "0x"), crypto_buyer: null as string | null, amountUsdcBaseUnits: "5370000" };
const chain = (o: Partial<OnchainEscrow> = {}): OnchainEscrow => ({ ...decodeGetEscrow(record()), block: 9, ...o });

test("verdict: an open, funded order is good and says amount, fee and expiry", () => {
  const v = judgeEscrow(order, chain(), NOW);
  assert.equal(v.tone, "good");
  assert.match(v.title, /5\.37 USDC locked on Arc/);
  assert.match(v.detail, /5\.37 USDC for the buyer plus a 0\.05 USDC fee/);
  assert.match(v.detail, /expires in 17 min/);
});

test("verdict: the amount compared is what the buyer is paid, not the total with the fee", () => {
  // amountUsdcBaseUnits == on-chain amount: fine even though the contract also holds the fee.
  assert.equal(judgeEscrow(order, chain({ fee: 999_999n }), NOW).tone, "good");
  // An order that claimed the total (amount + fee) as its amount would be flagged.
  assert.match(judgeEscrow({ ...order, amountUsdcBaseUnits: "5423700" }, chain(), NOW).title, /Amount doesn't match/);
  assert.match(judgeEscrow(order, chain({ amount: 1n }), NOW).title, /Amount doesn't match/);
  assert.equal(judgeEscrow({ ...order, amountUsdcBaseUnits: "abc" }, chain(), NOW).tone, "bad");
});

test("verdict: every mismatch says don't proceed", () => {
  assert.equal(judgeEscrow(order, chain({ status: 0 }), NOW).tone, "bad");
  assert.equal(judgeEscrow({ ...order, status: "pending_funding" }, chain({ status: 0 }), NOW).tone, "warn");
  const other = judgeEscrow(order, chain({ depositor: "0x" + "33".repeat(20) }), NOW);
  assert.match(other.title, /Different depositor/);
  assert.match(other.detail, /Don't proceed/);
  // The contract would pay someone other than the buyer on the order.
  const wrongBuyer = judgeEscrow({ ...order, status: "accepted", crypto_buyer: BUYER }, chain({ fulfiller: "0x" + "55".repeat(20) }), NOW);
  assert.equal(wrongBuyer.tone, "bad");
  assert.match(wrongBuyer.title, /Different buyer on-chain/);
});

test("verdict: the new statuses each read correctly", () => {
  // 1 Funded, server says accepted but nobody is bound on-chain: a warning for the buyer.
  const unbound = judgeEscrow({ ...order, status: "accepted", crypto_buyer: BUYER }, chain(), NOW);
  assert.equal(unbound.tone, "warn");
  assert.match(unbound.title, /no buyer bound yet/);
  // 1 Funded with the buyer bound.
  const bound = judgeEscrow({ ...order, status: "accepted", crypto_buyer: BUYER }, chain({ fulfiller: BUYER }), NOW);
  assert.equal(bound.tone, "good");
  assert.match(bound.detail, /bound to buyer 0x4444…4444/);
  assert.match(bound.detail, /delivery deadline is in 17 min/);
  // 2 Delivered: still locked, review window running.
  const delivered = judgeEscrow({ ...order, status: "code_submitted", crypto_buyer: BUYER }, chain({ status: 2, fulfiller: BUYER }), NOW);
  assert.equal(delivered.tone, "good");
  assert.match(delivered.title, /locked · delivered/);
  assert.match(delivered.detail, /review window ends in 17 min/);
  // 3 Disputed: frozen.
  const disputed = judgeEscrow({ ...order, status: "disputed", crypto_buyer: BUYER }, chain({ status: 3, fulfiller: BUYER }), NOW);
  assert.equal(disputed.tone, "warn");
  assert.match(disputed.title, /Disputed on-chain/);
  // 4 Released, 5 Refunded, 6 Resolved: settled, whatever the server says.
  assert.equal(judgeEscrow({ ...order, status: "released" }, chain({ status: 4, fulfiller: BUYER }), NOW).tone, "good");
  assert.match(judgeEscrow({ ...order, status: "released" }, chain({ status: 4, fulfiller: BUYER }), NOW).title, /Released on-chain/);
  assert.match(judgeEscrow(order, chain({ status: 5 }), NOW).title, /Refunded on-chain/);
  assert.match(judgeEscrow({ ...order, status: "disputed" }, chain({ status: 6 }), NOW).title, /Dispute resolved on-chain/);
  // The old contract's numbering (2 = Released) must not come back: 2 is Delivered and still holds the money.
  assert.doesNotMatch(judgeEscrow({ ...order, status: "code_submitted" }, chain({ status: 2 }), NOW).title, /Released/);
  // The server says finished but the contract still holds the funds.
  assert.equal(judgeEscrow({ ...order, status: "released" }, chain(), NOW).tone, "warn");
});

test("phase deadline text", () => {
  assert.equal(untilText(1000, 1_000_000), "has passed");
  assert.equal(untilText(1000 + 90, 1_000_000), "in 2 min");
  assert.equal(untilText(1000 + 3 * 3600, 1_000_000), "in 3 h");
  assert.equal(untilText(1000 + 30 * 86400, 1_000_000), "in 30 days");
});

/* ---------------------------------------------------------- wallet steps */

function wallet(opts: { chain?: string; knowsArc?: boolean; canAdd?: boolean; addSwitches?: boolean; balance?: bigint; allowance?: bigint }) {
  let chainId = opts.chain ?? "0x1";
  let knows = opts.knowsArc ?? false;
  const calls: string[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    calls.push(method);
    const p = params as { chainId?: string; data?: string }[];
    if (method === "eth_chainId") return chainId;
    if (method === "wallet_switchEthereumChain") {
      if (opts.canAdd === false) throw Object.assign(new Error("Unsupported chain"), { code: 4902 });
      if (!knows) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      chainId = p[0].chainId!;
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      if (opts.canAdd === false) throw Object.assign(new Error("The method wallet_addEthereumChain is not supported"), { code: 4200 });
      knows = true;
      if (opts.addSwitches) chainId = p[0].chainId!;
      return null;
    }
    if (method === "eth_call") return "0x" + word(p[0].data!.startsWith("0x70a08231") ? (opts.balance ?? 0n) : (opts.allowance ?? 0n));
    throw new Error("unexpected " + method);
  };
  return { request, calls };
}

test("switch to Arc: adds the network when the wallet doesn't know it, then switches", async () => {
  const w = wallet({});
  await switchToArc(w.request, "MetaMask");
  assert.deepEqual(w.calls.filter((c) => c.startsWith("wallet_")), ["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
  const w2 = wallet({ addSwitches: true });
  await switchToArc(w2.request);
  assert.deepEqual(w2.calls.filter((c) => c.startsWith("wallet_")), ["wallet_switchEthereumChain", "wallet_addEthereumChain"]);
  const w3 = wallet({ chain: ARC.hex });
  await switchToArc(w3.request);
  assert.deepEqual(w3.calls, ["eth_chainId"]);
});

test("switch to Arc: a wallet that can't add networks gets a plain explanation naming it and the network", async () => {
  const w = wallet({ canAdd: false });
  await assert.rejects(switchToArc(w.request, "Phantom"), (e: unknown) => e instanceof WalletStepError && e.kind === "unsupported_network" && e.message.includes(`Phantom can't use ${ARC.name}`) && /MetaMask, Rabby/.test(e.message));
  const declined = { request: async ({ method }: { method: string }) => { if (method === "eth_chainId") return "0x1"; throw Object.assign(new Error("User rejected the request."), { code: 4001 }); } };
  await assert.rejects(switchToArc(declined.request as never), (e: unknown) => e instanceof WalletStepError && e.kind === "rejected");
});

test("a wallet on another chain is named, never sent a transaction", async () => {
  await assertOnArc(wallet({ chain: ARC.hex }).request);
  await assert.rejects(assertOnArc(wallet({ chain: "0x1" }).request), (e: unknown) => e instanceof WalletStepError && e.kind === "wrong_network" && /on chain 1,/.test(e.message) && e.message.includes(`(chain ${ARC.id})`));
});

test("USDC preflight: too little USDC is caught before any wallet prompt, with the faucet on testnet", async () => {
  const poor = wallet({ balance: 3_200_000n });
  await assert.rejects(assertUsdc(poor.request, SPENDER, 5_370_000n), (e: unknown) => e instanceof WalletStepError && e.kind === "insufficient_usdc" && /has 3\.20 USDC/.test(e.message) && /needs 5\.37/.test(e.message) && /faucet\.circle\.com/.test(e.message));
  await assertUsdc(wallet({ balance: 5_400_000n }).request, SPENDER, 5_370_000n);
  await assert.rejects(assertUsdc(wallet({ balance: 5_370_000n }).request, SPENDER, 5_370_000n), /network fee/); // exact amount leaves nothing for gas
  // With a real fee estimate the check is exact, and says how much.
  await assertUsdc(wallet({ balance: 5_372_640n }).request, SPENDER, 5_370_000n, 2_640n);
  await assert.rejects(assertUsdc(wallet({ balance: 5_372_639n }).request, SPENDER, 5_370_000n, 2_640n), /needs 5\.37 plus up to 0\.0027 USDC for the network fee/);
  assert.equal(await usdcAllowance(wallet({ allowance: 9n }).request, SPENDER, "0x" + "22".repeat(20)), 9n);
  assert.equal(usdcText(5_370_000n), "5.37");
  assert.equal(usdcText(20_000n), "0.02");
});
