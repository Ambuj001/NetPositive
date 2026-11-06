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

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) || "/api").replace(/\/$/, "");

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
  amountUsdc: string;
  amountUsdcBaseUnits: string;
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
  /** The spender's signed "Ready" permit for the CodeMailbox (EIP-712). Null until they press Ready. */
  ready?: { validUntil: number; signature: string; signedAt: string } | null;
  /** Set when an admin has ruled on a dispute. */
  resolution?: { outcome: "release" | "refund"; note: string | null; by: string; at: string } | null;
  lastError?: string | null;
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
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "request_failed", data.message ?? "Request failed", data.details);
  }
  return data as T;
}

type ApiClient = {
  <T>(path: string, opts?: ApiOpts): Promise<T>;
  health: () => Promise<{ ok: boolean; escrowMode: string; worldIdMock: boolean }>;
  nonce: (address: string) => Promise<{ message: string }>;
  verify: (address: string, signature: string) => Promise<{ token: string; user: ApiUser }>;
  me: (token: string) => Promise<{ user: ApiUser }>;
  listOpen: (limit?: number, brand?: string) => Promise<{ requests: ApiRequest[] }>;
  listMine: (token: string) => Promise<{ asCryptoSpender: ApiRequest[]; asCryptoBuyer: ApiRequest[] }>;
  get: (id: string) => Promise<{ request: ApiRequest }>;
  /** `pending_funding` request plus the escrow contract the wallet must deposit into. Null contract means mock escrow. */
  create: (
    body: { brand: string; amountInr: number; amountUsdc: string },
    token: string,
  ) => Promise<{ request: ApiRequest; escrowContract: string | null }>;
  fund: (id: string, txHash: string, token: string) => Promise<{ request: ApiRequest }>;
  /** A World-ID-verified buyer takes an open order. Locks it to them for the fulfil window. */
  accept: (id: string, token: string) => Promise<{ request: ApiRequest }>;
  cancel: (id: string, token: string) => Promise<{ request: ApiRequest }>;
  /** The EIP-712 "Ready" typed data for the spender's wallet to sign (gasless). */
  readyPermit: (id: string, token: string) => Promise<{ validUntil: number; typedData: unknown }>;
  ready: (id: string, body: { validUntil: number; signature: string }, token: string) => Promise<{ request: ApiRequest }>;
  /** Settle: the spender confirms the voucher works and the escrow releases the USDC to the buyer on-chain. */
  confirm: (id: string, token: string) => Promise<{ request: ApiRequest }>;
  dispute: (id: string, reason: string, token: string) => Promise<{ request: ApiRequest }>;
  /** The voucher for the spender: `code`/`pin` for legacy vouchers, `sealed` when it is locked to their vault key. */
  voucher: (id: string, token: string) => Promise<{ voucher: { requestId: string; brand: string; code?: string; pin?: string | null; sealed?: unknown } }>;
};

/** Callable for World ID routes, with named methods for the order book and sign-in. */
export const api: ApiClient = Object.assign(call, {
  health: () => call<{ ok: boolean; escrowMode: string; worldIdMock: boolean }>("/health"),
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
    call<{ request: ApiRequest; escrowContract: string | null }>("/requests", { body, token }),
  fund: (id: string, txHash: string, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/fund`, { method: "POST", body: { txHash }, token }),
  accept: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/accept`, { method: "POST", body: {}, token }),
  cancel: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {}, token }),
  readyPermit: (id: string, token: string) => call<{ validUntil: number; typedData: unknown }>(`/requests/${encodeURIComponent(id)}/ready-permit`, { token }),
  ready: (id: string, body: { validUntil: number; signature: string }, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/ready`, { method: "POST", body, token }),
  confirm: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/confirm`, { method: "POST", body: {}, token }),
  dispute: (id: string, reason: string, token: string) =>
    call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/dispute`, { method: "POST", body: { reason }, token }),
  voucher: (id: string, token: string) =>
    call<{ voucher: { requestId: string; brand: string; code?: string; pin?: string | null; sealed?: unknown } }>(`/requests/${encodeURIComponent(id)}/voucher`, { token }),
});

/* --------------------------------------------------------------- display */

export const STATUS: Record<ReqStatus, { label: string; tone: "mint" | "amber" | "iris" | "rose" | "mute"; note: string }> = {
  pending_funding: { label: "Awaiting deposit", tone: "amber", note: "Deposit USDC into escrow to publish the request." },
  open: { label: "Open", tone: "mint", note: "Live in the order book. Waiting for a verified buyer." },
  accepted: { label: "Accepted", tone: "amber", note: "A buyer is purchasing the voucher." },
  code_submitted: { label: "Code submitted", tone: "iris", note: "Check the voucher and confirm, or it auto-releases." },
  disputed: { label: "Disputed", tone: "rose", note: "Under review by an admin." },
  releasing: { label: "Releasing", tone: "iris", note: "Sending USDC to the buyer on-chain." },
  released: { label: "Completed", tone: "mint", note: "USDC released. Trade settled." },
  refunding: { label: "Refunding", tone: "iris", note: "Returning USDC to the seller on-chain." },
  refunded: { label: "Refunded", tone: "mute", note: "USDC returned to the seller." },
  cancelled: { label: "Cancelled", tone: "mute", note: "Cancelled before funding." },
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
