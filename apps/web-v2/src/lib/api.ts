/**
 * Client for the NetPositive backend (Express + Firestore, `backend/` on backend-integration).
 * Data model: requests/{id} with the lifecycle below. See backend/README.md.
 */

export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8080").replace(/\/$/, "");

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
  requester: string;
  fulfiller: string | null;
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
  lastError?: string | null;
};

export type ApiUser = {
  address: string;
  worldIdNullifier: string | null;
  verificationLevel: string | null;
  reputation: { completed: number; disputes: number; strikes: number };
  banned: boolean;
};

/** Backend brand ids (config.BRANDS) → frontend brand ids (lib/data.ts). */
const BRAND_MAP: Record<string, string> = { makemytrip: "mmt" };
export const brandIdFromApi = (b: string) => BRAND_MAP[b] ?? b;

/* ---------------------------------------------------------------- client */

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init: { method?: string; body?: object; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline", "The NetPositive backend isn't reachable.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  health: () => call<{ ok: boolean; escrowMode: string; worldIdMock: boolean }>("/health"),
  nonce: (address: string) => call<{ message: string }>("/auth/nonce", { body: { address } }),
  verify: (address: string, signature: string) => call<{ token: string; user: ApiUser }>("/auth/verify", { body: { address, signature } }),
  me: (token: string) => call<{ user: ApiUser }>("/auth/me", { token }),
  listOpen: (limit = 50) => call<{ requests: ApiRequest[] }>(`/requests?limit=${limit}`),
  listMine: (token: string) => call<{ asRequester: ApiRequest[]; asFulfiller: ApiRequest[] }>("/requests/mine", { token }),
  get: (id: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}`),
  cancel: (id: string, token: string) => call<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {}, token }),
};

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
