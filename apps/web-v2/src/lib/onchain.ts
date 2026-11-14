/**
 * Read an order's escrow straight from the VoucherEscrow contract on Arc, without going through the NetPositive
 * server. This is how a buyer can check that the USDC really is locked before spending money on a voucher.
 * Pure functions (no React, no env) so node tests can import them.
 */
export const ESCROW_STATUS = ["None", "Funded", "Released", "Refunded", "Delivered", "Disputed"] as const;

export type OnchainEscrow = { depositor: string; amount: bigint; status: number; claimableAt: number; block: number };

const SEL_ESCROWS = "0x2d83549c"; // escrows(bytes32) -> (address depositor, uint256 amount, uint8 status)
const SEL_CLAIMABLE = "0xc6e1c6d7"; // claimableAt(bytes32) -> uint256

export function encodeEscrowRead(escrowId: string) {
  const id = escrowId.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("Escrow id is not a 32-byte hash");
  return { escrows: SEL_ESCROWS + id, claimableAt: SEL_CLAIMABLE + id };
}

export function decodeEscrow(hex: string): { depositor: string; amount: bigint; status: number } {
  const h = hex.replace(/^0x/i, "");
  if (h.length < 192) throw new Error("The contract returned no escrow data (wrong address, or not this contract)");
  return { depositor: `0x${h.slice(24, 64)}`.toLowerCase(), amount: BigInt(`0x${h.slice(64, 128)}`), status: Number(BigInt(`0x${h.slice(128, 192)}`)) };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One JSON-RPC batch to a public Arc node: the escrow record, its timeout and the block it was read at. */
export async function readEscrow(rpcUrl: string, contract: string, escrowId: string, fetchFn: Fetch = fetch as unknown as Fetch): Promise<OnchainEscrow> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error("No escrow contract address");
  const data = encodeEscrowRead(escrowId);
  const call = (id: number, d: string) => ({ jsonrpc: "2.0", id, method: "eth_call", params: [{ to: contract, data: d }, "latest"] });
  const res = await fetchFn(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([call(1, data.escrows), call(2, data.claimableAt), { jsonrpc: "2.0", id: 3, method: "eth_blockNumber", params: [] }]),
    signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(12_000) : undefined,
  });
  if (!res.ok) throw new Error(`The Arc node answered HTTP ${res.status}`);
  const out = (await res.json()) as { id: number; result?: string; error?: { message?: string } }[];
  const by = (id: number) => {
    const r = Array.isArray(out) ? out.find((x) => x.id === id) : undefined;
    if (!r || r.error || typeof r.result !== "string") throw new Error(r?.error?.message || "The Arc node gave no answer");
    return r.result;
  };
  const e = decodeEscrow(by(1));
  return { ...e, claimableAt: Number(BigInt(by(2))), block: Number(BigInt(by(3))) };
}

export type Verdict = { ok: boolean; tone: "good" | "warn" | "bad"; title: string; detail: string };

/** Compare what the chain says with what the server says about an order. The chain wins. */
export function judgeEscrow(server: { status: string; crypto_spender: string; amountUsdcBaseUnits: string }, chain: OnchainEscrow): Verdict {
  const usdc = (n: bigint) => `${(Number(n) / 1e6).toFixed(2)} USDC`;
  const state = ESCROW_STATUS[chain.status] ?? `state ${chain.status}`;
  const expected = BigInt(server.amountUsdcBaseUnits);
  const live = ["open", "accepted", "code_submitted", "disputed", "releasing", "refunding"].includes(server.status);
  if (chain.status === 0) {
    return server.status === "pending_funding"
      ? { ok: true, tone: "warn", title: "Not locked yet", detail: "The contract has no deposit for this order yet. Don't buy a voucher for it until this shows Funded." }
      : { ok: false, tone: "bad", title: "No deposit on-chain", detail: `The server says "${server.status.replaceAll("_", " ")}", but the contract has no deposit under this escrow id. Don't proceed.` };
  }
  if (chain.status === 2) return { ok: true, tone: "good", title: "Released on-chain", detail: `The contract paid this escrow out (block ${chain.block}).` };
  if (chain.status === 3) return { ok: true, tone: "warn", title: "Refunded on-chain", detail: "The contract returned this deposit to the spender. There is nothing left to earn on this order." };
  if (chain.amount !== expected) return { ok: false, tone: "bad", title: "Amount doesn't match", detail: `The contract holds ${usdc(chain.amount)}, but the order says ${usdc(expected)}. Don't proceed.` };
  if (chain.depositor !== server.crypto_spender.toLowerCase()) return { ok: false, tone: "bad", title: "Different depositor", detail: `The deposit came from ${chain.depositor}, not the spender on this order. Don't proceed.` };
  if (!live) return { ok: false, tone: "warn", title: `Still ${state.toLowerCase()} on-chain`, detail: `The server says "${server.status.replaceAll("_", " ")}", but the contract still holds ${usdc(chain.amount)}. It may be catching up; refresh in a minute.` };
  return { ok: true, tone: "good", title: `${usdc(chain.amount)} locked on Arc`, detail: `Read from the contract at block ${chain.block}: ${state}, deposited by the spender. Only the escrow's rules can move it.` };
}
