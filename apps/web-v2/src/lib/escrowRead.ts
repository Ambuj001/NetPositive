/**
 * Reading an order's escrow without a single point of failure. Sources are tried in order and the first that answers
 * wins; which one answered is kept, because it changes how much the reading can be trusted:
 *
 *   rpc     a public Arc node, over fetch from this browser        independent of NetPositive
 *   wallet  `eth_call` through the connected wallet's own node      independent of NetPositive
 *   server  NetPositive's `GET /escrow/state/:escrowId`             NetPositive's word; check the explorer to be sure
 *
 * Wallet steps never depend on this read: `escrowStep` reads the escrow through the wallet again right before it sends.
 * Pure (no React, no env), so node tests can import it.
 */
import { decodeGetEscrow, type EscrowRecord, type OnchainEscrow } from "./onchain.ts";

export type EscrowSource = "rpc" | "wallet" | "server";

export type Reading = { escrow: OnchainEscrow; source: EscrowSource; chainTime: number | null };

export type Reader = { source: EscrowSource; read: () => Promise<{ escrow: OnchainEscrow; chainTime?: number | null }> };

export type ReadResult = { ok: true; reading: Reading; failed: { source: EscrowSource; message: string }[] } | { ok: false; failed: { source: EscrowSource; message: string }[] };

const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : typeof e === "string" ? e : "no answer").slice(0, 200);

/** Try each reader in order; the first answer wins. Never throws. */
export async function readFirst(readers: Reader[]): Promise<ReadResult> {
  const failed: { source: EscrowSource; message: string }[] = [];
  for (const r of readers) {
    try {
      const out = await r.read();
      return { ok: true, reading: { escrow: out.escrow, source: r.source, chainTime: out.chainTime ?? null }, failed };
    } catch (e) {
      failed.push({ source: r.source, message: msg(e) });
    }
  }
  return { ok: false, failed };
}

/**
 * The order to try sources in. The public node goes first (the most independent check), unless it failed recently:
 * then the wallet's node goes first, so a blocked or rate-limited public node isn't asked again on every poll.
 * The server is always last.
 */
export function sourceOrder(opts: { rpcFailedAt: number | null; now: number; hasWallet: boolean; cooldownMs?: number }): EscrowSource[] {
  const cool = opts.cooldownMs ?? 60_000;
  const rpcCooling = opts.rpcFailedAt !== null && opts.now - opts.rpcFailedAt < cool;
  const independent: EscrowSource[] = !opts.hasWallet ? ["rpc"] : rpcCooling ? ["wallet", "rpc"] : ["rpc", "wallet"];
  return [...independent, "server"];
}

/** How long to wait before the next background read: 15 s normally, doubling after each failure up to 2 min. */
export function pollDelay(failures: number, baseMs = 15_000, maxMs = 120_000) {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 6));
}

/** Escrow status names the server uses, in contract order. */
const STATUS_NAMES = ["none", "funded", "delivered", "disputed", "released", "refunded", "resolved"];

/** `GET /escrow/state/:escrowId` → the same record shape the contract read gives. Throws on anything malformed. */
export function parseServerEscrow(json: unknown): { escrow: OnchainEscrow; chainTime: number | null } {
  const root = json as { escrow?: Record<string, unknown>; chainTime?: unknown } | null;
  const e = root?.escrow;
  if (!e || typeof e !== "object") throw new Error("The server gave no escrow record");
  const addr = (v: unknown, nullable = false): string | null => {
    if (v === null && nullable) return null;
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error("The server's escrow record has a bad address");
    return /^0x0{40}$/.test(v) ? (nullable ? null : v.toLowerCase()) : v.toLowerCase();
  };
  const big = (v: unknown) => {
    if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error("The server's escrow record has a bad amount");
    return BigInt(v);
  };
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < 0) throw new Error("The server's escrow record has a bad number");
    return n;
  };
  const status = typeof e.statusCode === "number" ? e.statusCode : STATUS_NAMES.indexOf(String(e.status));
  if (!Number.isInteger(status) || status < 0 || status > 6) throw new Error("The server's escrow record has an unknown status");
  const record: EscrowRecord = {
    depositor: addr(e.depositor)!,
    openUntil: num(e.openUntil),
    epoch: num(e.epoch),
    fulfiller: addr(e.fulfiller ?? null, true),
    deadline: num(e.deadline),
    status,
    token: addr(e.token)!,
    reviewWindow: num(e.reviewWindow),
    fulfillWindow: num(e.fulfillWindow),
    amount: big(e.amount),
    fee: big(e.fee),
    bond: big(e.bond),
  };
  const chainTime = typeof root?.chainTime === "number" ? root.chainTime : null;
  return { escrow: { ...record, block: null }, chainTime };
}

type Rpc = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

/** The wallet reader: only when the wallet is on the right chain (a read elsewhere would be meaningless), never switching it. */
export function walletReader(request: Rpc, chainId: number, encoded: { to: string; data: string }): Reader {
  return {
    source: "wallet",
    read: async () => {
      const raw = await request({ method: "eth_chainId" });
      const id = typeof raw === "string" ? Number.parseInt(raw, 16) : typeof raw === "number" ? raw : NaN;
      if (id !== chainId) throw new Error(`Your wallet is on chain ${Number.isFinite(id) ? id : "unknown"}, not ${chainId}`);
      const out = await request({ method: "eth_call", params: [encoded, "latest"] });
      return { escrow: { ...decodeGetEscrow(typeof out === "string" ? out : ""), block: null } };
    },
  };
}

/** How the page describes a reading, per source. `independent` is false only for the server. */
export function sourceText(source: EscrowSource, chainName = "Arc"): { short: string; detail: string; independent: boolean } {
  switch (source) {
    case "rpc":
      return { short: "Read from the contract by your browser", detail: `Read from the escrow contract by your browser, through a public ${chainName} node. NetPositive's server was not involved.`, independent: true };
    case "wallet":
      return { short: "Read from the contract by your wallet", detail: `Read from the escrow contract through your wallet's own ${chainName} node. NetPositive's server was not involved.`, independent: true };
    case "server":
      return {
        short: "Read through NetPositive's server",
        detail: `Read through NetPositive's server, because your browser couldn't reach any ${chainName} node. Open the contract in the explorer to check it independently.`,
        independent: false,
      };
  }
}

/** One line for "every source failed": what was tried and why each failed. */
export function allFailedText(failed: { source: EscrowSource; message: string }[]) {
  const name: Record<EscrowSource, string> = { rpc: "public node", wallet: "your wallet", server: "NetPositive's server" };
  return `Couldn't read the escrow from any source (${failed.map((f) => `${name[f.source]}: ${f.message}`).join("; ")}).`;
}
