import test from "node:test";
import assert from "node:assert/strict";
import { allFailedText, parseServerEscrow, pollDelay, readFirst, sourceOrder, sourceText, walletReader, type Reader } from "../src/lib/escrowRead.ts";
import { RecordAfterTxError, recordAfterTx, retryable } from "../src/lib/afterTx.ts";
import type { OnchainEscrow } from "../src/lib/onchain.ts";

const rec: OnchainEscrow = { depositor: "0x" + "aa".repeat(20), openUntil: 10, epoch: 0, fulfiller: null, deadline: 10, status: 1, token: "0x" + "36".repeat(20), reviewWindow: 1, fulfillWindow: 1, amount: 5n, fee: 1n, bond: 0n, block: 7 };
const ok = (source: Reader["source"], calls: string[]): Reader => ({ source, read: async () => (calls.push(source), { escrow: rec }) });
const fail = (source: Reader["source"], calls: string[], why = "Failed to fetch"): Reader => ({ source, read: async () => (calls.push(source), Promise.reject(new Error(why))) });

test("readFirst: the first source that answers wins, and later ones are not asked", async () => {
  const calls: string[] = [];
  const r = await readFirst([ok("rpc", calls), ok("wallet", calls), ok("server", calls)]);
  assert.ok(r.ok && r.reading.source === "rpc");
  assert.deepEqual(calls, ["rpc"]);
});

test("readFirst: a blocked public node falls back to the wallet, then to the server", async () => {
  const calls: string[] = [];
  const w = await readFirst([fail("rpc", calls), ok("wallet", calls), ok("server", calls)]);
  assert.ok(w.ok && w.reading.source === "wallet");
  assert.deepEqual(w.failed.map((f) => f.source), ["rpc"]);
  const s = await readFirst([fail("rpc", []), fail("wallet", [], "no wallet connected"), ok("server", [])]);
  assert.ok(s.ok && s.reading.source === "server");
  const none = await readFirst([fail("rpc", []), fail("wallet", []), fail("server", [], "HTTP 404")]);
  assert.equal(none.ok, false);
  assert.match(allFailedText(none.failed), /public node: Failed to fetch; your wallet: Failed to fetch; NetPositive's server: HTTP 404/);
});

test("sourceOrder: public node first; after it fails, the wallet goes first for a minute; the server is always last", () => {
  assert.deepEqual(sourceOrder({ rpcFailedAt: null, now: 0, hasWallet: true }), ["rpc", "wallet", "server"]);
  assert.deepEqual(sourceOrder({ rpcFailedAt: 0, now: 30_000, hasWallet: true }), ["wallet", "rpc", "server"]);
  assert.deepEqual(sourceOrder({ rpcFailedAt: 0, now: 61_000, hasWallet: true }), ["rpc", "wallet", "server"]);
  assert.deepEqual(sourceOrder({ rpcFailedAt: 0, now: 1, hasWallet: false }), ["rpc", "server"]);
});

test("pollDelay: 15 s, backing off after failures, capped at 2 min", () => {
  assert.equal(pollDelay(0), 15_000);
  assert.equal(pollDelay(1), 30_000);
  assert.equal(pollDelay(2), 60_000);
  assert.equal(pollDelay(10), 120_000);
});

test("wording per source is honest: browser and wallet are independent; the server is not and says so", () => {
  assert.equal(sourceText("rpc").independent, true);
  assert.match(sourceText("rpc").detail, /by your browser.*not involved/);
  assert.equal(sourceText("wallet").independent, true);
  assert.match(sourceText("wallet").detail, /your wallet's own Arc node/);
  const s = sourceText("server");
  assert.equal(s.independent, false);
  assert.match(s.detail, /through NetPositive's server, because your browser couldn't reach any Arc node\. Open the contract in the explorer to check it independently/);
});

test("parseServerEscrow: the server's decimal strings become the same record shape; junk is refused", () => {
  const body = { escrow: { status: "funded", statusCode: 1, depositor: "0x" + "AA".repeat(20), fulfiller: null, token: "0x" + "36".repeat(20), amount: "1000000", fee: "10000", bond: "1000000", epoch: 2, openUntil: 100, deadline: 100, reviewWindow: 86400, fulfillWindow: 3600 }, chainTime: 50, source: "server" };
  const p = parseServerEscrow(body);
  assert.equal(p.escrow.depositor, "0x" + "aa".repeat(20));
  assert.equal(p.escrow.amount, 1_000_000n);
  assert.equal(p.escrow.status, 1);
  assert.equal(p.escrow.fulfiller, null);
  assert.equal(p.escrow.epoch, 2);
  assert.equal(p.chainTime, 50);
  assert.equal(parseServerEscrow({ escrow: { ...body.escrow, statusCode: undefined, status: "delivered" } }).escrow.status, 2);
  assert.throws(() => parseServerEscrow({}), /no escrow record/);
  assert.throws(() => parseServerEscrow({ escrow: { ...body.escrow, amount: 1 } }), /bad amount/);
  assert.throws(() => parseServerEscrow({ escrow: { ...body.escrow, statusCode: 9 } }), /unknown status/);
});

test("walletReader: refuses to read on another chain (never switches it), reads on the right one", async () => {
  const word = (v: string | bigint | number) => (typeof v === "string" ? v.replace(/^0x/, "") : BigInt(v).toString(16)).padStart(64, "0");
  const ret = "0x" + [rec.depositor, 10, 0, "0x" + "00".repeat(20), 10, 1, rec.token, 1, 1, 5, 1, 0].map(word).join("");
  const calls: string[] = [];
  const on = (chain: string) => async ({ method }: { method: string }) => (calls.push(method), method === "eth_chainId" ? chain : ret);
  const r = walletReader(on("0x13b2"), 5042, { to: "0x" + "22".repeat(20), data: "0xf023b811" });
  assert.equal((await r.read()).escrow.amount, 5n);
  await assert.rejects(walletReader(on("0x1"), 5042, { to: "0x", data: "0x" }).read(), /on chain 1, not 5042/);
  assert.ok(!calls.includes("wallet_switchEthereumChain"));
});

/* ------------------------------------------- server call after a confirmed transaction */

test("recordAfterTx: retries an unreachable server or a lagging node, then succeeds without sending anything twice", async () => {
  let n = 0;
  const out = await recordAfterTx(async () => {
    n++;
    if (n === 1) throw Object.assign(new Error("x"), { status: 0, code: "unreachable" });
    if (n === 2) throw Object.assign(new Error("x"), { status: 409, code: "wallet_action_required" });
    return "recorded";
  }, { what: "release", tx: "0x" + "ab".repeat(32), chainDone: true, sleep: async () => {} });
  assert.equal(out, "recorded");
  assert.equal(n, 3);
});

test("recordAfterTx: when the server never answers, the person is told the money moved and pressing again is safe", async () => {
  await assert.rejects(
    recordAfterTx(() => Promise.reject(Object.assign(new Error("x"), { status: 0, code: "unreachable" })), { what: "release", tx: "0x" + "ab".repeat(32), chainDone: true, tries: 2, sleep: async () => {} }),
    (e: unknown) => e instanceof RecordAfterTxError && /went through on-chain \(tx 0xabababab…\), so there is nothing more to pay.*won't send it twice/.test((e as Error).message),
  );
  // A real refusal (403) is passed through unchanged, and nothing retried.
  let n = 0;
  await assert.rejects(recordAfterTx(() => (n++, Promise.reject(Object.assign(new Error("forbidden"), { status: 403, code: "not_requester" }))), { what: "x", tx: null, chainDone: true, sleep: async () => {} }), /forbidden/);
  assert.equal(n, 1);
  assert.equal(retryable({ status: 503 }), true);
  assert.equal(retryable({ status: 400, code: "bad" }), false);
});
