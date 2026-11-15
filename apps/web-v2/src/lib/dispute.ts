/**
 * Disputes: API calls and screenshot helpers. Only the spender can open one, by sending `dispute` to the escrow from
 * their wallet (see escrowFlow.ts) and then telling the server why. The escrow locks the order's dispute stake in that
 * same transaction and returns it unless the dispute is decided against them.
 * The JWT only ever goes in the Authorization header.
 */
import { API_URL, ApiError, apiErrorFrom, onchainStepText, type ApiRequest } from "./api";

/* ------------------------------------------------------------------ types */

export const CATEGORIES = [
  { value: "invalid_code", label: "Code is invalid" },
  { value: "already_redeemed", label: "Code was already redeemed" },
  { value: "wrong_amount", label: "Wrong amount" },
  { value: "wrong_brand", label: "Wrong brand" },
  { value: "expired", label: "Code has expired" },
  { value: "code_changed", label: "Code was changed after I checked it" },
  { value: "code_is_valid", label: "The code is valid (other side is wrong)" },
  { value: "other", label: "Something else" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];
export const categoryLabel = (v?: string | null) => CATEGORIES.find((c) => c.value === v)?.label ?? v ?? "Unknown";

export const REASON_MIN = 5;
export const REASON_MAX = 1000;
export const MAX_SHOTS = 4;
export const MAX_SHOT_BYTES = 500 * 1024;
export const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Answer of POST /requests/:id/dispute/bond. With escrow V2 the contract takes the stake itself inside the `dispute`
 * transaction (`onchain: true`, `amountBaseUnits` = this order's stake). `required` is only true on a server that
 * still wants a separate stake payment, which this app cannot make.
 */
export type Bond = { required: boolean; onchain?: boolean; amountBaseUnits?: string; amountUsdc?: string | number };

/** What this backend stores on a request once a dispute is open (see backend/src/services/disputes.js). */
export type DisputeInfo = {
  /** Wallet that raised it. */
  by?: string | null;
  category?: string | null;
  reason?: string | null;
  openedAt?: string | null;
  /** Only on disputes from before escrow V2. none = no stake was asked; held = locked; returned / forfeited = after the decision. */
  bond?: { status?: string | null; amountBaseUnits?: string | null } | null;
  /** The other person's single reply. */
  response?: { by?: string | null; text?: string | null; at?: string | null } | null;
};
export type Resolution = { verdict?: string | null; note?: string | null; at?: string | null } | null;
export type DisputeRequest = Omit<ApiRequest, "resolution"> & { dispute?: DisputeInfo | null; resolution?: Resolution };

export type Evidence = { id: string; by?: string | null; mime?: string | null; size?: number | null; note?: string | null; createdAt?: string | null };

/* ------------------------------------------------------------------- http */

type Init = { method?: string; token: string; json?: object; raw?: { body: Blob; type: string } };

async function send(path: string, init: Init): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.json || init.raw ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${init.token}`,
        ...(init.json ? { "Content-Type": "application/json" } : {}),
        ...(init.raw ? { "Content-Type": init.raw.type } : {}),
      },
      body: init.json ? JSON.stringify(init.json) : init.raw?.body,
    });
  } catch {
    throw new ApiError(0, "offline", "The NetPositive backend isn't reachable.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; details?: unknown };
    throw apiErrorFrom(res, { ...data, message: data.message ?? `Request failed (${res.status})` });
  }
  return res;
}
const json = async <T,>(path: string, init: Init) => (await (await send(path, init)).json()) as T;
const rid = (id: string) => encodeURIComponent(id);

/** Text to show for any error. A banned account always gets the same line. */
export function disputeError(e: unknown) {
  if (e instanceof ApiError && e.code === "banned") return "Your account is banned";
  const onchain = onchainStepText(e);
  if (onchain) return onchain;
  const w = e as { code?: number; message?: string };
  if (w?.code === 4001 || /user rejected|user denied|rejected the request/i.test(w?.message ?? "")) return "You rejected the request in your wallet. Nothing was sent.";
  return e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";
}

export const disputeApi = {
  get: (id: string, token: string) => json<{ request: DisputeRequest }>(`/requests/${rid(id)}`, { token }),
  bond: (id: string, token: string) => json<{ bond: Bond }>(`/requests/${rid(id)}/dispute/bond`, { token, json: {} }),
  /** Call after the spender's wallet has sent `dispute` to the escrow. */
  open: (id: string, token: string, body: { category: Category; reason: string }) =>
    json<{ request?: DisputeRequest }>(`/requests/${rid(id)}/dispute`, { token, json: body }),
  respond: (id: string, token: string, text: string) => json<unknown>(`/requests/${rid(id)}/dispute/respond`, { token, json: { text } }),
  uploadEvidence: (id: string, token: string, file: Blob) =>
    json<unknown>(`/requests/${rid(id)}/evidence`, { token, raw: { body: file, type: file.type } }),
  listEvidence: async (id: string, token: string): Promise<Evidence[]> => {
    const d = await json<unknown>(`/requests/${rid(id)}/evidence`, { token });
    const list = Array.isArray(d) ? d : ((d as { evidence?: unknown; items?: unknown })?.evidence ?? (d as { items?: unknown })?.items ?? []);
    return Array.isArray(list) ? (list as Evidence[]).filter((x) => x && typeof x.id === "string") : [];
  },
  /** Fetches the image with the auth header and returns a blob URL (revoke it when done). */
  evidenceUrl: async (id: string, evidenceId: string, token: string) =>
    URL.createObjectURL(await (await send(`/requests/${rid(id)}/evidence/${encodeURIComponent(evidenceId)}`, { token })).blob()),
};

/* ------------------------------------------------------------ screenshots */

/**
 * Returns an image the server will accept (png/jpeg/webp, at most 500 KB), shrinking
 * big phone screenshots when needed. Throws a readable message when it can't.
 */
export async function prepareShot(file: File): Promise<File> {
  if (!SHOT_TYPES.includes(file.type)) throw new Error(`${file.name}: use a PNG, JPEG or WebP image.`);
  if (file.size <= MAX_SHOT_BYTES) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name}: couldn't read this image.`);
  try {
    for (const scale of [1, 0.8, 0.65, 0.5, 0.4]) {
      const canvas = document.createElement("canvas");
      const k = Math.min(1, 1600 / bitmap.width) * scale;
      canvas.width = Math.max(1, Math.round(bitmap.width * k));
      canvas.height = Math.max(1, Math.round(bitmap.height * k));
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
        if (blob && blob.size <= MAX_SHOT_BYTES) return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(`${file.name}: still over 500 KB after shrinking. Crop it and try again.`);
}

export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
