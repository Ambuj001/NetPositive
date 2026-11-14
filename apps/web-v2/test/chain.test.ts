import assert from "node:assert/strict";
import { test } from "node:test";
import { ARC, ARC_USDC, CHAINS, EscrowConfigError, IS_DEV, chainFor, chainMismatch, pickEscrow, resolveNetwork } from "../src/lib/chain.ts";

const A = "0x" + "Aa".repeat(20);
const B = "0x" + "bb".repeat(20);

test("network: mainnet and testnet values, testnet by default, anything else is an error", () => {
  assert.deepEqual(
    { id: CHAINS.mainnet.id, hex: CHAINS.mainnet.hex, name: CHAINS.mainnet.name, rpc: CHAINS.mainnet.rpc, explorer: CHAINS.mainnet.explorer, faucet: CHAINS.mainnet.faucet },
    { id: 5042, hex: "0x13b2", name: "Arc", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io", faucet: null },
  );
  assert.deepEqual({ id: CHAINS.testnet.id, hex: CHAINS.testnet.hex, name: CHAINS.testnet.name, rpc: CHAINS.testnet.rpc }, { id: 5042002, hex: "0x4cef52", name: "Arc Testnet", rpc: "https://rpc.testnet.arc.io" });
  for (const c of Object.values(CHAINS)) assert.equal(Number.parseInt(c.hex, 16), c.id);
  assert.equal(ARC_USDC, "0x3600000000000000000000000000000000000000");
  assert.equal(resolveNetwork(undefined), "testnet");
  assert.equal(resolveNetwork(""), "testnet");
  assert.equal(resolveNetwork(" Mainnet "), "mainnet");
  assert.throws(() => resolveNetwork("main"), /must be "mainnet" or "testnet"/);
  assert.equal(chainFor("mainnet", " https://my.node ").rpc, "https://my.node");
  assert.equal(chainFor("mainnet", "").rpc, "https://rpc.mainnet.arc.io");
  // Under node there is no build env: testnet, and never "dev".
  assert.equal(ARC.network, "testnet");
  assert.equal(IS_DEV, false);
});

test("escrow address: the build's address wins, a different server address stops everything", () => {
  assert.deepEqual(pickEscrow(A, { built: A.toLowerCase(), dev: false }), { mode: "chain", contract: A.toLowerCase() });
  assert.deepEqual(pickEscrow(A.toLowerCase(), { built: A, dev: false }), { mode: "chain", contract: A.toLowerCase() }); // case-insensitive
  assert.throws(() => pickEscrow(B, { built: A, dev: false }), (e: unknown) => e instanceof EscrowConfigError && e.kind === "mismatch" && /wrong contract/.test(e.message));
  assert.throws(() => pickEscrow(B, { built: A, dev: true }), (e: unknown) => e instanceof EscrowConfigError && e.kind === "mismatch"); // also in dev
});

test("escrow address: the server's word is only trusted in development", () => {
  assert.deepEqual(pickEscrow(B, { built: null, dev: true }), { mode: "chain", contract: B });
  assert.throws(() => pickEscrow(B, { built: null, dev: false }), (e: unknown) => e instanceof EscrowConfigError && e.kind === "not_configured" && /VITE_ESCROW_CONTRACT/.test(e.message));
});

test("mock escrow (server has no contract): allowed in development, an error in a production build", () => {
  assert.deepEqual(pickEscrow(null, { built: null, dev: true }), { mode: "mock" });
  assert.deepEqual(pickEscrow(undefined, { built: A, dev: true }), { mode: "mock" });
  for (const built of [null, A]) {
    assert.throws(() => pickEscrow(null, { built, dev: false }), (e: unknown) => e instanceof EscrowConfigError && e.kind === "not_configured" && /Escrow is not configured/.test(e.message));
  }
  assert.throws(() => pickEscrow("not-an-address", { built: A, dev: false }), EscrowConfigError);
  // Defaults come from the build env; under node that is a production-like build with nothing configured.
  assert.throws(() => pickEscrow(null), /Escrow is not configured/);
});

test("server chain: a different chain id is named; a matching or missing one is fine", () => {
  assert.equal(chainMismatch(5042, CHAINS.mainnet), null);
  assert.equal(chainMismatch("5042", CHAINS.mainnet), null);
  assert.equal(chainMismatch(undefined, CHAINS.mainnet), null);
  assert.match(chainMismatch(5042002, CHAINS.mainnet)!, /set up for Arc \(chain 5042\), but the server is on chain 5042002/);
  assert.match(chainMismatch(5042, CHAINS.testnet)!, /Arc Testnet/);
});
