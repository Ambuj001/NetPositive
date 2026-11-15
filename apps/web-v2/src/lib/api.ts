/**
 * One client for wallet sign-in, World ID, and the request book.
 *
 * POST /auth/nonce            { address } → { message }
 * POST /auth/verify           { address, signature } → { token, user }
 * GET  /auth/me               → { user }
 * POST /world-id/rp-signature { action } → { sig, nonce, created_at, expires_at, rp_id? }
 * POST /world-id/verify       { rp_id, idkitResponse } → { verified, user }
 * GET  /requests              → { requests }
 * GET  /requests/mine         → { asCryptoSpender, asCryptoBuyer }
 *
 * In dev, leave VITE_API_URL empty. Vite proxies /api to the backend.
 * Data model: requests/{id}. See backend/README.md.
 */
import { ARC } from "./chain";
import type { Card } from "./engine";
import { parseTerms, retryAfterSeconds, serverErrorText, type EscrowTerms } from "./terms";


// VITE_BACKEND_URL (set in .env.production) wins over the older VITE_API_URL, so a stale value left in a hosting
// dashboard cannot point a new build at a backend that no longer exists.
const BASE = ((import.meta.env.VITE_BACKEND_URL as string | undefined) || (import.meta.env.VITE_API_URL as string | undefined) || "/api").replace(/\/$/, "");

export const API_URL = BASE;

/* ---------------------------------------------------------------- schema */

export type ReqStatus =
  | "pending_funding"
  | "open"
  | "accepted"
  | "code_submitted"
  | "disputed"
  | "releasing"
  | "released"
  | "refunding"
  | "refunded"
  | "cancelled";

/** Mirrors the Firestore `requests/{id}` document as serialized by the API (timestamps are ISO strings). */
export type ApiRequest = {
  id: string;
  /** Wallet that locked USDC and wants the voucher. */
  crypto_spender: string;
  /** Wallet that buys the gift card and receives the USDC. */
  crypto_buyer: string | null;
  brand: string;
  amountInr: number;
  /** What the buyer receives, without the fee. */
  amountUsdc: string;
  amountUsdcBaseUnits: string;
  /** Fee locked on top of the amount. Missing on orders created before escrow V2. */
  feeUsdcBaseUnits?: string;
  /** Amount + fee: what the spender's wallet approves and what leaves it. */
  totalUsdcBaseUnits?: string;
  /** Reference passed to the escrow's `deposit`. */
  escrowRef?: string;
  /** The escrow's on-chain id (derived from the depositor and the reference). Used by every other call and read. */
  escrowId: string;
  status: ReqStatus;
  escrowTxHash: string | null;
  releaseTxHash: string | null;
  refundTxHash: string | null;
  fulfilDeadline: string | null;
  reviewDeadline: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  fundedAt?: string | null;
  acceptedAt?: string | null;
  codeSubmittedAt?: string | null;
  settledAt?: string | null;
  disputeReason?: string | null;
  /** Wallet that opened the dispute. */
  disputedBy?: string | null;
  disputedAt?: string | null;
  /** The spender's signed "Ready" permit: the escrow's EIP-712 Assign for this buyer. Null until they press Ready. */
  ready?: { validUntil: number; epoch?: number; signature: string; signedAt: string } | null;
  /** Set when an admin has ruled on a dispute. */
  resolution?: { outcome: "release" | "refund"; note: string | null; by: string; at: string } | null;
  lastError?: string | null;
};

/** A crypto buyer's standing "I want to buy USDC for this amount" (Firestore `buyIntents/{address}`). */
export type BuyIntent = {
  id: string;
  /** Wallet that wants the USDC. */
  crypto_buyer: string;
  amountInr: number;
  /** Backend brand id of the voucher they would use, or null for "none": any voucher will do. */
  voucher: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type ApiUser = {
  address: string;
  worldIdNullifier: string | null;
  verificationLevel: string | null;
  reputation?: { completed: number; disputes: number; strikes: number };
  banned?: boolean;
};

/** Backend brand ids (config.BRANDS) → frontend brand ids (lib/data.ts). */
const BRAND_MAP: Record<string, string> = { makemytrip: "mmt" };
export const brandIdFromApi = (b: string) => BRAND_MAP[b] ?? b;

/* ---------------------------------------------------------------- client */

export class ApiError extends Error {
  status: number;
  code: string;
  /** Extra facts the server attached to the error (for example which wallet a World ID is linked to). */
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** How the server's escrow is set up. Null when it runs the local mock escrow. */
export type EscrowInfo = { version: number; contract: string; token: string; chainId: number; ttlSeconds: number };

export type Health = { ok: boolean; escrowMode: string; worldIdMock: boolean; chainId?: number; escrowContract?: string | null; escrowVersion?: number };

/** Dispute reasons the backend accepts as `category`. */
export type DisputeCategory = "invalid_code" | "already_redeemed" | "wrong_amount" | "wrong_brand" | "expired" | "code_changed" | "code_is_valid" | "other";

type ApiOpts = { method?: string; body?: unknown; token?: string | null };

async function call<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "unreachable", "Couldn't reach the server. You can keep browsing. Posting and accepting stay locked.");
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; details?: unknown };
  if (!res.ok) throw apiErrorFrom(res, data);
  return data as T;
}

/** Errors are JSON `{ error: "<code>", message, details }`. A 429 also carries how long to wait (Retry-After). */
export function apiErrorFrom(res: { status: number; headers: { get(name: string): string | null } }, data: { error?: string; message?: string; details?: unknown }) {
  const code = data.error ?? (res.status === 429 ? "rate_limited" : "request_failed");
  if (res.status === 429) {
    const details = { ...(data.details && typeof data.details === "object" ? data.details : {}), retryAfterSeconds: retryAfterSeconds(res.headers.get("retry-after")) };
    return new ApiError(429, code, serverErrorText({ status: 429, code, details }) ?? "Too many requests. Wait a moment and try again.", details);
  }
  const err = new ApiError(res.status, code, data.message ?? "Request failed", data.details);
  const better = serverErrorText(err);
  if (better) err.message = better;
  return err;
}

type ApiClient = {
  <T>(path: string, opts?: ApiOpts): Promise<T>;
  health: () => Promise<Health>;
  /** `/health`, asked once and remembered (asked again after a failure). */
  serverInfo: () => Promise<Health>;
  /** What the escrow charges and allows right now (GET /escrow/terms). Remembered for 30 seconds; `fresh` asks again. */
  terms: (fresh?: boolean) => Promise<EscrowTerms>;
  nonce: (address: string) => Promise<{ message: string }>;
  verify: (address: string, signature: string) => Promise<{ token: string; user: ApiUser }>;
  me: (token: string) => Promise<{ user: ApiUser }>;
  listOpen: (limit?: number, brand?: string) => Promise<{ requests: ApiRequest[] }>;
  listMine: (token: string) => Promise<{ asCryptoSpender: ApiRequest[]; asCryptoBuyer: ApiRequest[] }>;
  get: (id: string) => Promise<{ request: ApiRequest }>;
  /**
   * `pending_funding` request plus the escrow the wallet must deposit into. `amountUsdc` is what the buyer receives;
   * the server answers with the fee and the total. A null contract means the server runs the mock escrow.
   */
  create: (
    body: { brand: string; amountInr: number; amountUsdc: string },
    token: string,
  ) => Promise<{ request: ApiRequest; escrowContract: string | null; escrow?: EscrowInfo | null }>;
  fund: (id: string, txHash: string, token: string) => Promise<{ request: ApiRequest }>;
  /** The signed-in wallet's saved card reward profiles (never card numbers), and whether they closed the "add your cards" pop-up. */
  cardsList: (token: string) => Promise<{ cards: Card[]; promptDismissed: boolean }>;
  /** Add a card, or update it if it is already saved. */
  cardSave: (card: Card, token: string) => Promise<{ card: Card }>;
  cardRemove: (id: string, token: string) => Promise<{ ok: true }>;
  cardsPromptDismiss: (token: string) => Promise<{ ok: true }>;
  /** A signed-in buyer (World-ID-verified while the server requires it) takes an open order. Locks it to them for the fulfil window. */
  accept: (id: string, token: string) => Promise<{ request: ApiRequest }>;
  cancel: (id: string, token: string) => Promise<{ request: ApiRequest }>;
  /** The EIP-712 "Ready" typed data for the spender's wallet to sign (gasless). */
  readyPermit: (id: string, token: string) => Promise<{ validUntil: number; typedData: unknown }>;
  ready: (id: string, body: { validUntil: number; signature: string }, token: string) => Promise<{ request: ApiRequest }>;
  /** Settle: call after the spender's wallet has sent `release` to the escrow. The server checks the chain and records it. */
  confirm: (id: string, token: string) => Promise<{ request: ApiRequest }>;
  /** Call after the spender's wallet has sent `dispute` to the escrow. */
  dispute: (id: string, body: { category: DisputeCategory; reason: string }, token: string) => Promise<{ request: ApiRequest }>;
  /** Buy requests that fit an amount. With a brand: same voucher or no voucher. Without: amount only. */
  matchBuyIntents: (amountInr: number, brand?: string) => Promise<{ intents: BuyIntent[] }>;
  myBuyIntent: (token: string) => Promise<{ intent: BuyIntent | null }>;
  /** Create or replace my buy request. `voucher` null means none. */
  postBuyIntent: (body: { amountInr: number; voucher: string | null }, token: string) => Promise<{ intent: BuyIntent }>;
  withdrawBuyIntent: (token: string) => Promise<{ ok: boolean }>;
  /** The voucher for the spender: `code`/`pin` for legacy vouchers, `sealed` when it is locked to their vault key. */
  voucher: (id: string, token: string) => Promise<{ voucher: VoucherPayload }>;
  vaultConfig: () => Promise<VaultConfig>;
  putVaultKey: (body: { publicKey: string; signature: string }, token: string) => Promise<{ key: VaultKeyRecord }>;
  getVaultKey: (address: string, token: string) => Promise<{ key: VaultKeyRecord }>;
  /** Buyer hands over the voucher. `sealed` is the vault envelope; `{code, pin}` is only used when the server is in legacy mode. */
  submitCode: (id: string, body: { sealed: unknown } | { code: string; pin?: string }, token: string) => Promise<{ request: ApiRequest }>;
};

export type VaultConfig = {
  mode: "legacy" | "both" | "sealed";
  envelopeVersion: number;
  keyMessage: string;
  adminPublicKey: string | null;
};

export type VaultKeyRecord = {
  address: string;
  publicKey: string;
  kid: string;
  signature: string;
};

export type VoucherPayload = {
  requestId: string;
  brand: string;
  requester?: string;
  fulfiller?: string;
  code?: string;
  pin?: string | null;
  sealed?: unknown;
};

let healthOnce: Promise<Health> | null = null;
let termsOnce: { at: number; value: Promise<EscrowTerms> } | null = null;

/** Callable for World ID routes, with named methods for the order book and sign-in. */
export const api: ApiClient = Object.assign(call, {
  health: () => call<Health>("/health"),
  serverInfo: () => {
    healthOnce ??= call<Health>("/health").catch((e: unknown) => {
      healthOnce = null;
      throw e;
    });
    return healthOnce;
  },
  terms: (fresh = false) => {
    if (!fresh && termsOnce && Date.now() - termsOnce.at < 30_000) return termsOnce.value;
    const value = call<unknown>("/escrow/terms").then((raw) => {
      const terms = parseTerms(raw);
      if (!terms) throw new ApiError(502, "bad_terms", "The server's escrow terms could not be read.");
      return terms;
    });
    const mine = { at: Date.now(), value };
    termsOnce = mine;
    value.catch(() => {
      if (termsOnce === mine) termsOnce = null;
    });
    return value;
  },
  nonce: (address: string) => call<{ message: string }>("/auth/nonce", { body: { address } }),
  verify: (address: string, signature: string) => call<{ token: string; user: ApiUser }>("/auth/verify", { body: { address, signature } }),
  me: (token: string) => call<{ user: ApiUser }>("/auth/me", { token }),
  listOpen: (limit = 50, brand?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (brand) q.set("brand", brand);
    return call<{ requests: ApiRequest[] }>(`/requests?${q}`);
  },
  listMine: (token: string) => call<{ asCryptoSpender: ApiRequest[]; asCryptoBuyer: ApiRequest[] }>("/requests/mine", { token }),
  get: (id: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}`),
  create: (body: { brand: string; amountInr: number; amountUsdc: string }, token: string) =>
    call<{ request: ApiRequest; escrowContract: string | null; escrow?: EscrowInfo | null }>("/requests", { body, token }),
  fund: (id: string, txHash: string, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/fund`, { method: "POST", body: { txHash }, token }),
  cardsList: (token: string) => call<{ cards: Card[]; promptDismissed: boolean }>("/cards", { token }),
  cardSave: (card: Card, token: string) => call<{ card: Card }>(`/cards/${encodeURIComponent(card.id)}`, { method: "PUT", body: card, token }),
  cardRemove: (id: string, token: string) => call<{ ok: true }>(`/cards/${encodeURIComponent(id)}`, { method: "DELETE", body: {}, token }),
  cardsPromptDismiss: (token: string) => call<{ ok: true }>("/cards/prompt/dismiss", { method: "POST", body: {}, token }),
  accept: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/accept`, { method: "POST", body: {}, token }),
  cancel: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {}, token }),
  readyPermit: (id: string, token: string) => call<{ validUntil: number; typedData: unknown }>(`/requests/${encodeURIComponent(id)}/ready-permit`, { token }),
  ready: (id: string, body: { validUntil: number; signature: string }, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/ready`, { method: "POST", body, token }),
  confirm: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/confirm`, { method: "POST", body: {}, token }),
  dispute: (id: string, body: { category: DisputeCategory; reason: string }, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/dispute`, { method: "POST", body, token }),
  voucher: (id: string, token: string) => call<{ voucher: VoucherPayload }>(`/requests/${encodeURIComponent(id)}/voucher`, { token }),
  vaultConfig: () => call<VaultConfig>("/vault/config"),
  putVaultKey: (body: { publicKey: string; signature: string }, token: string) =>
    call<{ key: VaultKeyRecord }>("/vault/key", { method: "PUT", body, token }),
  getVaultKey: (address: string, token: string) =>
    call<{ key: VaultKeyRecord }>(`/vault/key/${encodeURIComponent(address)}`, { token }),
  submitCode: (id: string, body: { sealed: unknown } | { code: string; pin?: string }, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/submit-code`, { method: "POST", body, token }),
  matchBuyIntents: (amountInr: number, brand?: string) => {
    const q = new URLSearchParams({ amountInr: String(amountInr) });
    if (brand) q.set("brand", brand);
    return call<{ intents: BuyIntent[] }>(`/buy-intents?${q}`);
  },
  myBuyIntent: (token: string) => call<{ intent: BuyIntent | null }>("/buy-intents/mine", { token }),
  postBuyIntent: (body: { amountInr: number; voucher: string | null }, token: string) => call<{ intent: BuyIntent }>("/buy-intents", { body, token }),
  withdrawBuyIntent: (token: string) => call<{ ok: boolean }>("/buy-intents/mine", { method: "DELETE", token }),
});

/* --------------------------------------------------------------- display */

export const STATUS: Record<ReqStatus, { label: string; tone: "mint" | "amber" | "iris" | "rose" | "mute"; note: string }> = {
  pending_funding: { label: "Awaiting deposit", tone: "amber", note: "Deposit USDC into escrow to publish the request." },
  open: { label: "Open", tone: "mint", note: "Live in the order book. Waiting for a buyer." },
  accepted: { label: "Accepted", tone: "amber", note: "A buyer is purchasing the voucher." },
  code_submitted: { label: "Code submitted", tone: "iris", note: "Check the voucher and confirm, or it is paid to the buyer when the review window ends." },
  disputed: { label: "Disputed", tone: "rose", note: "Under review by the arbiter." },
  releasing: { label: "Releasing", tone: "iris", note: "Sending USDC to the buyer on-chain." },
  released: { label: "Completed", tone: "mint", note: "USDC released. Trade settled." },
  refunding: { label: "Refunding", tone: "iris", note: "Returning USDC to the spender on-chain." },
  refunded: { label: "Refunded", tone: "mute", note: "USDC returned to the spender." },
  cancelled: { label: "Cancelled", tone: "mute", note: "Cancelled by the spender." },
};

/** Happy-path steps used by the tracker. */
export const STEPS: { key: ReqStatus; label: string }[] = [
  { key: "pending_funding", label: "Created" },
  { key: "open", label: "Funded" },
  { key: "accepted", label: "Accepted" },
  { key: "code_submitted", label: "Code in" },
  { key: "released", label: "Released" },
];

export function stepIndex(s: ReqStatus) {
  if (s === "releasing") return 3.5;
  if (s === "disputed") return 3;
  const i = STEPS.findIndex((x) => x.key === s);
  return i < 0 ? -1 : i;
}

export const isFinal = (s: ReqStatus) => s === "released" || s === "refunded" || s === "cancelled";

/**
 * Text for the 409s the server sends when it looked at the chain and the wallet's step isn't there yet.
 * Returns null for any other error, so callers can fall back to their own wording.
 */
export function onchainStepText(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === "wallet_action_required") {
    const fn = (e.details as { function?: unknown } | undefined)?.function;
    const which = typeof fn === "string" && fn ? `the "${fn}" transaction` : "the wallet transaction for this step";
    return `The escrow on ${ARC.name} doesn't show ${which} yet. Confirm it in your wallet, wait for it to go through, then press the button again.`;
  }
  if (e.code === "not_assigned_onchain") return `The escrow on ${ARC.name} doesn't show this wallet as the buyer yet. Confirm the order from your wallet first, and don't buy the voucher before that goes through.`;
  if (e.code === "buyer_dispute_unavailable") return "Only the spender can open a dispute. As the buyer you are paid automatically when the review window ends, unless the spender disputes first.";
  if (e.code === "not_delivered_onchain") return `The escrow on ${ARC.name} doesn't show the voucher as delivered yet. Confirm the delivery transaction in your wallet, wait for it to go through, then send the code again.`;
  return null;
}
