import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TIP_WEI, classifyEstimateError, decodeRevert, feesFrom, gasWithMargin, httpRpc, prepareTx, quantity, refusesFeeFields, weiToUsdcBaseUnits } from "../src/lib/txgas.ts";

const TX = { from: "0x" + "11".repeat(20), to: "0x" + "22".repeat(20), data: "0x67d42a8b" };

test("gas limit is the estimate plus 20%, rounded up", () => {
  assert.equal(gasWithMargin(100_000n), 120_000n);
  assert.equal(gasWithMargin(21_001n), 25_202n); // 25201.2 rounds up
  assert.equal(gasWithMargin(0n), 0n);
});

test("fees: max fee is twice the base fee plus the tip", () => {
  assert.deepEqual(feesFrom(160n * 10n ** 9n, 10n ** 9n), { maxPriorityFeePerGas: 10n ** 9n, maxFeePerGas: 321n * 10n ** 9n });
});

test("Arc gas (18 decimals) converts to USDC base units (6 decimals), rounding up", () => {
  assert.equal(weiToUsdcBaseUnits(10n ** 18n), 1_000_000n);
  assert.equal(weiToUsdcBaseUnits(1n), 1n);
  assert.equal(weiToUsdcBaseUnits(0n), 0n);
  assert.equal(weiToUsdcBaseUnits(2_640_000_000_000_000n), 2_640n);
});

test("quantity reads hex quantities and nothing else", () => {
  assert.equal(quantity("0x5208"), 21_000n);
  assert.equal(quantity(21000), 21_000n);
  assert.equal(quantity("21000"), null);
  assert.equal(quantity(null), null);
  assert.equal(quantity("0x"), null);
});

test("revert data becomes a reason: Error(string), known custom errors, unknown selectors", () => {
  const text = "Pausable: paused";
  const hex = Buffer.from(text).toString("hex");
  const data = "0x08c379a0" + (32).toString(16).padStart(64, "0") + text.length.toString(16).padStart(64, "0") + hex.padEnd(64, "0");
  assert.equal(decodeRevert(data), text);
  assert.match(decodeRevert("0xd93c0665"), /paused/); // EnforcedPause()
  assert.match(decodeRevert("0xdeadbeef"), /error 0xdeadbeef/);
  assert.equal(decodeRevert("0x"), "");
  assert.equal(decodeRevert(undefined), "");
});

test("estimate errors: a revert and missing funds are final; an unknown method is not", () => {
  assert.equal(classifyEstimateError({ code: 3, message: "execution reverted", data: "0xd93c0665" }).kind, "revert");
  assert.equal(classifyEstimateError({ code: -32000, message: "execution reverted: TooLate" }).reason, "TooLate");
  // MetaMask-style nesting.
  assert.equal(classifyEstimateError({ code: -32603, message: "Internal JSON-RPC error.", data: { originalError: { code: 3, data: "0xd93c0665" } } }).kind, "unavailable");
  assert.equal(classifyEstimateError({ code: -32603, message: "Internal JSON-RPC error.", data: { code: 3, message: "execution reverted", data: "0xd93c0665" } }).kind, "revert");
  assert.equal(classifyEstimateError({ code: -32000, message: "insufficient funds for gas * price + value" }).kind, "funds");
  assert.equal(classifyEstimateError({ code: -32601, message: "the method eth_estimateGas does not exist" }).kind, "unavailable");
  assert.equal(classifyEstimateError(new Error("Failed to fetch")).kind, "unavailable");
  // A custom error echoed as raw hex is not shown as the reason.
  assert.equal(classifyEstimateError({ code: 3, message: "execution reverted: 0x1234abcd" }).reason, "the escrow contract refused it");
});

test("prepareTx: base fee from the latest block, then eth_gasPrice; tip falls back to 1 gwei", async () => {
  const node = (answers: Record<string, unknown>) => async ({ method }: { method: string }) => {
    if (method in answers) return answers[method];
    throw Object.assign(new Error("method not found"), { code: -32601 });
  };
  const full = await prepareTx(node({ eth_estimateGas: "0x186a0", eth_getBlockByNumber: { baseFeePerGas: "0x2540be400" }, eth_maxPriorityFeePerGas: "0x77359400" }), TX, "release");
  assert.deepEqual(full.fields, { gas: "0x1d4c0", maxFeePerGas: "0x51f4d5c00", maxPriorityFeePerGas: "0x77359400" });
  assert.equal(full.maxCostWei, 120_000n * 22n * 10n ** 9n);

  const legacy = await prepareTx(node({ eth_estimateGas: "0x186a0", eth_getBlockByNumber: { number: "0x1" }, eth_gasPrice: "0x3b9aca00" }), TX, "release");
  assert.equal(BigInt(legacy.fields.maxPriorityFeePerGas!), DEFAULT_TIP_WEI);
  assert.equal(BigInt(legacy.fields.maxFeePerGas!), 3n * 10n ** 9n);

  const nothing = await prepareTx(node({}), TX, "release");
  assert.deepEqual(nothing, { fields: {}, maxCostWei: null });

  // Fees known but no estimate: fees are still sent, the cost is unknown.
  const feesOnly = await prepareTx(node({ eth_gasPrice: "0x3b9aca00" }), TX, "release");
  assert.equal(feesOnly.fields.gas, undefined);
  assert.ok(feesOnly.fields.maxFeePerGas);
  assert.equal(feesOnly.maxCostWei, null);
});

test("httpRpc: posts JSON-RPC and keeps the node's error code and data", async () => {
  const bodies: unknown[] = [];
  const ok = httpRpc("https://rpc.example", async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x5208" }) };
  });
  assert.equal(await ok({ method: "eth_estimateGas", params: [TX] }), "0x5208");
  assert.deepEqual(bodies[0], { jsonrpc: "2.0", id: 1, method: "eth_estimateGas", params: [TX] });
  const bad = httpRpc("https://rpc.example", async () => ({ ok: true, status: 200, json: async () => ({ error: { code: 3, message: "execution reverted", data: "0xd93c0665" } }) }));
  await assert.rejects(bad({ method: "eth_estimateGas", params: [TX] }), (e: { code?: number; data?: string }) => e.code === 3 && e.data === "0xd93c0665");
  const down = httpRpc("https://rpc.example", async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(down({ method: "eth_gasPrice" }), /HTTP 503/);
});

test("refusesFeeFields: only parameter complaints, never a person declining", () => {
  assert.equal(refusesFeeFields({ code: -32602, message: "Invalid transaction params: params specify an EIP-1559 transaction but the current network does not support EIP-1559" }), true);
  assert.equal(refusesFeeFields({ code: 4001, message: "User rejected the request (maxFeePerGas)" }), false);
  assert.equal(refusesFeeFields({ code: -32000, message: "insufficient funds" }), false);
});
