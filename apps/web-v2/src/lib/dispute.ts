/**
 * Disputes: API calls, the 1 USDC stake on Arc testnet, and screenshot helpers.
 * The JWT only ever goes in the Authorization header.
 */
import { API_URL, ApiError, type ApiRequest } from "./api";

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

export type Bond = {
  required: boolean;
  amountUsdc: string | number;
  amountBaseUnits: string;
  escrowContract: string;
  escrowId: string;
};

/** What this backend stores on a request once a dispute is open (see backend/src/services/disputes.js). */
export type DisputeInfo = {
  /** Wallet that raised it. */
  by?: string | null;
  category?: string | null;
  reason?: string | null;
  openedAt?: string | null;
  /** none = no stake was asked; held = locked in escrow; returned / forfeited = after the decision. */
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
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? "error", data.message ?? `Request failed (${res.status})`);
  }
  return res;
}
const json = async <T,>(path: string, init: Init) => (await (await send(path, init)).json()) as T;
const rid = (id: string) => encodeURIComponent(id);

/** Text to show for any error. A banned account always gets the same line. */
export function disputeError(e: unknown) {
  if (e instanceof ApiError && e.code === "banned") return "Your account is banned";
  const w = e as { code?: number; message?: string };
  if (w?.code === 4001 || /reject|denied|cancel/i.test(w?.message ?? "")) return "You rejected the request in your wallet.";
  return e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";
}

export const disputeApi = {
  get: (id: string, token: string) => json<{ request: DisputeRequest }>(`/requests/${rid(id)}`, { token }),
  bond: (id: string, token: string) => json<{ bond: Bond }>(`/requests/${rid(id)}/dispute/bond`, { token, json: {} }),
  open: (id: string, token: string, body: { category: Category; reason: string; bondTxHash?: string }) =>
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

/* ------------------------------------------------------------ Arc + stake */

export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_HEX = "0x4cef52";
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
const APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)
const DEPOSIT_SELECTOR = "0x1de26e16"; // deposit(bytes32,uint256)
const ARC_CHAIN = {
  chainId: ARC_CHAIN_HEX,
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
};

export type Rpc = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

const pad32 = (hex: string) => hex.replace(/^0x/i, "").padStart(64, "0");
const encodeApprove = (spender: string, amount: bigint) => APPROVE_SELECTOR + pad32(spender) + pad32(amount.toString(16));
function encodeDeposit(id: string, amount: bigint) {
  const h = id.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("Escrow id from the server is not a 32-byte hash.");
  return DEPOSIT_SELECTOR + h.toLowerCase() + pad32(amount.toString(16));
}

async function ensureArc(rpc: Rpc) {
  const cur = await rpc({ method: "eth_chainId" });
  const n = typeof cur === "number" ? cur : typeof cur === "string" ? Number(cur) : NaN; // Number() reads "0x…" too
  if (n === ARC_CHAIN_ID) return;
  try {
    await rpc({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await rpc({ method: "wallet_addEthereumChain", params: [ARC_CHAIN] });
  }
}

async function waitForReceipt(rpc: Rpc, hash: string) {
  for (let i = 0; i < 60; i++) {
    const r = (await rpc({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (r) {
      if (r.status === "0x0") throw new Error("The transaction failed on-chain.");
      return;
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("The transaction is still pending. Wait a moment and press Try again. You won't be charged twice.");
}

async function sendTx(rpc: Rpc, tx: { from: string; to: string; data: string }, onHash?: (h: string) => void) {
  const hash = await rpc({ method: "eth_sendTransaction", params: [{ ...tx, value: "0x0" }] });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Your wallet didn't return a transaction hash.");
  onHash?.(hash);
  await waitForReceipt(rpc, hash);
  return hash;
}

/**
 * Stake in two wallet steps: USDC.approve(escrow) then escrow.deposit(escrowId).
 * `onDepositHash` fires as soon as the deposit is sent, before it confirms, so it can be saved.
 */
export async function stakeBond(
  rpc: Rpc,
  from: string,
  bond: Bond,
  hooks: { onStep: (s: "switch" | "approve" | "deposit") => void; onDepositHash: (h: string) => void },
) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(bond.escrowContract)) throw new Error("The server sent no escrow address.");
  const amount = BigInt(bond.amountBaseUnits);
  if (amount <= 0n) throw new Error("The stake amount from the server is not valid.");
  hooks.onStep("switch");
  await ensureArc(rpc);
  hooks.onStep("approve");
  await sendTx(rpc, { from, to: ARC_USDC, data: encodeApprove(bond.escrowContract, amount) });
  hooks.onStep("deposit");
  return sendTx(rpc, { from, to: bond.escrowContract, data: encodeDeposit(bond.escrowId, amount) }, hooks.onDepositHash);
}

/* ----------------------------------------- remember a paid stake locally */

// A paid deposit hash survives a failed submit or a closed tab, so the user never pays twice.
const BOND_KEY = (id: string) => `netpositive:dispute-bond:${id}`;
export const savedBond = (id: string) => {
  try {
    const v = localStorage.getItem(BOND_KEY(id));
    return v && /^0x[0-9a-fA-F]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
};
export const saveBond = (id: string, hash: string) => {
  try {
    localStorage.setItem(BOND_KEY(id), hash);
  } catch {
    /* storage blocked: still works this session */
  }
};
export const clearBond = (id: string) => {
  try {
    localStorage.removeItem(BOND_KEY(id));
  } catch {
    /* nothing to clear */
  }
};

export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
