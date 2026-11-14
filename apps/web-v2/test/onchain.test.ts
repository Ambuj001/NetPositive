import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEscrow, encodeEscrowRead, judgeEscrow, readEscrow } from "../src/lib/onchain.ts";
import { WalletStepError, assertUsdc, switchToArc, usdcAllowance, usdcText } from "../src/lib/arc.ts";

const ID = "0x" + "ab".repeat(32);
const SPENDER = "0x" + "11".repeat(20);
const word = (v: bigint | string) => (typeof v === "string" ? v.replace(/^0x/, "") : v.toString(16)).padStart(64, "0");
const record = (depositor: string, amount: bigint, status: number) => "0x" + word(depositor) + word(amount) + word(BigInt(status));

test("escrow read: calldata is the contract's selectors + the escrow id", () => {
  assert.deepEqual(encodeEscrowRead(ID), { escrows: "0x2d83549c" + "ab".repeat(32), claimableAt: "0xc6e1c6d7" + "ab".repeat(32) });
  assert.throws(() => encodeEscrowRead("0x1234"), /32-byte/);
});

test("escrow read: decodes (address, uint256, uint8) and rejects empty returns", () => {
  assert.deepEqual(decodeEscrow(record(SPENDER, 5_370_000n, 1)), { depositor: SPENDER, amount: 5_370_000n, status: 1 });
  assert.throws(() => decodeEscrow("0x"), /no escrow data/);
});

test("escrow read: one JSON-RPC batch, answers matched by id in any order", async () => {
  let sent: { method: string; params: unknown[] }[] = [];
  const fake = async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => [{ id: 3, result: "0x10" }, { id: 2, result: "0x" + word(1_800_000_000n) }, { id: 1, result: record(SPENDER, 5_370_000n, 1) }] };
  };
  const e = await readEscrow("https://rpc.example", "0x" + "22".repeat(20), ID, fake as never);
  assert.deepEqual(e, { depositor: SPENDER, amount: 5_370_000n, status: 1, claimableAt: 1_800_000_000, block: 16 });
  assert.deepEqual(sent.map((c) => c.method), ["eth_call", "eth_call", "eth_blockNumber"]);
  await assert.rejects(readEscrow("https://rpc.example", "0x" + "22".repeat(20), ID, (async () => ({ ok: true, status: 200, json: async () => [{ id: 1, error: { message: "execution reverted" } }] })) as never), /execution reverted/);
});

test("verdict: the chain decides, and every mismatch says don't proceed", () => {
  const order = { status: "open", crypto_spender: SPENDER.toUpperCase().replace("0X", "0x"), amountUsdcBaseUnits: "5370000" };
  const chain = { depositor: SPENDER, amount: 5_370_000n, status: 1, claimableAt: 0, block: 9 };
  assert.equal(judgeEscrow(order, chain).tone, "good");
  assert.match(judgeEscrow(order, chain).title, /5\.37 USDC locked on Arc/);
  assert.equal(judgeEscrow(order, { ...chain, status: 0 }).tone, "bad");
  assert.equal(judgeEscrow({ ...order, status: "pending_funding" }, { ...chain, status: 0 }).tone, "warn");
  assert.match(judgeEscrow(order, { ...chain, amount: 1n }).title, /Amount doesn't match/);
  assert.match(judgeEscrow(order, { ...chain, depositor: "0x" + "33".repeat(20) }).title, /Different depositor/);
  assert.equal(judgeEscrow({ ...order, status: "released" }, { ...chain, status: 2 }).tone, "good");
  assert.equal(judgeEscrow({ ...order, status: "released" }, chain).tone, "warn");
  assert.equal(judgeEscrow(order, { ...chain, status: 3 }).tone, "warn");
});

/* ---------------------------------------------------------- wallet steps */

function wallet(opts: { chain?: string; knowsArc?: boolean; canAdd?: boolean; addSwitches?: boolean; balance?: bigint; allowance?: bigint }) {
  let chain = opts.chain ?? "0x1";
  let knows = opts.knowsArc ?? false;
  const calls: string[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    calls.push(method);
    const p = params as { chainId?: string; data?: string }[];
    if (method === "eth_chainId") return chain;
    if (method === "wallet_switchEthereumChain") {
      if (opts.canAdd === false) throw Object.assign(new Error("Unsupported chain"), { code: 4902 });
      if (!knows) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      chain = p[0].chainId!;
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      if (opts.canAdd === false) throw Object.assign(new Error("The method wallet_addEthereumChain is not supported"), { code: 4200 });
      knows = true;
      if (opts.addSwitches) chain = p[0].chainId!;
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
  const w3 = wallet({ chain: "0x4cef52" });
  await switchToArc(w3.request);
  assert.deepEqual(w3.calls, ["eth_chainId"]);
});

test("switch to Arc: a wallet that can't add networks gets a plain explanation naming it", async () => {
  const w = wallet({ canAdd: false });
  await assert.rejects(switchToArc(w.request, "Phantom"), (e: unknown) => e instanceof WalletStepError && e.kind === "unsupported_network" && /Phantom can't use Arc Testnet/.test(e.message) && /MetaMask, Rabby/.test(e.message));
  const declined = { request: async ({ method }: { method: string }) => { if (method === "eth_chainId") return "0x1"; throw Object.assign(new Error("User rejected the request."), { code: 4001 }); } };
  await assert.rejects(switchToArc(declined.request as never), (e: unknown) => e instanceof WalletStepError && e.kind === "rejected");
});

test("USDC preflight: too little USDC is caught before any wallet prompt, with the faucet", async () => {
  const poor = wallet({ balance: 3_200_000n });
  await assert.rejects(assertUsdc(poor.request, SPENDER, 5_370_000n), (e: unknown) => e instanceof WalletStepError && e.kind === "insufficient_usdc" && /has 3\.20 USDC/.test(e.message) && /needs 5\.37/.test(e.message) && /faucet\.circle\.com/.test(e.message));
  await assertUsdc(wallet({ balance: 5_400_000n }).request, SPENDER, 5_370_000n);
  await assert.rejects(assertUsdc(wallet({ balance: 5_370_000n }).request, SPENDER, 5_370_000n), /gas/); // exact amount leaves nothing for gas
  assert.equal(await usdcAllowance(wallet({ allowance: 9n }).request, SPENDER, "0x" + "22".repeat(20)), 9n);
  assert.equal(usdcText(5_370_000n), "5.37");
  assert.equal(usdcText(20_000n), "0.02");
});
