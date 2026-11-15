/**
 * Client for the NetPositive AI chatbot API (branch `ai-chatbot`, chatbot/server.py).
 * Run it with:  cd chatbot && python3 server.py   (http://127.0.0.1:8787)
 *
 * User endpoints need `Authorization: Bearer <the same JWT the backend issued at sign-in>`; every call takes it as
 * its last argument. A production build has no default address: without VITE_CHATBOT_URL the assistant is off.
 */

type Env = Record<string, string | boolean | undefined>;
const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};

/** Where the chatbot lives: the configured URL, the local server under `vite dev`, or "" (off) in a production build. */
export function resolveChatbotUrl(value: unknown, dev: boolean) {
  const v = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  return v || (dev ? "http://127.0.0.1:8787" : "");
}

export const CHATBOT_URL = resolveChatbotUrl(env.VITE_CHATBOT_URL, env.DEV === true);
/** False in a production build without VITE_CHATBOT_URL: nothing is ever sent to 127.0.0.1 from someone's browser. */
export const CHATBOT_ENABLED = CHATBOT_URL !== "";
export const CHATBOT_OFF_NOTE = "The AI assistant is switched off on this site. The quick actions still work.";

export class ChatbotError extends Error {
  kind: "offline" | "no_ai_key" | "api" | "auth" | "disabled";
  constructor(kind: ChatbotError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Request headers: JSON when there is a body, and the sign-in token when there is one. */
export function chatbotHeaders(hasBody: boolean, token?: string | null): Record<string, string> {
  return { ...(hasBody ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function call<T>(path: string, body?: object, token?: string | null): Promise<T> {
  if (!CHATBOT_ENABLED) throw new ChatbotError("disabled", CHATBOT_OFF_NOTE);
  let res: Response;
  try {
    res = await fetch(CHATBOT_URL + path, {
      method: body ? "POST" : "GET",
      headers: chatbotHeaders(!!body, token),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ChatbotError("offline", "The AI server isn't reachable.");
  }
  if (res.status === 401 || res.status === 403) throw new ChatbotError("auth", token ? "Your sign-in has expired. Sign in again to use the assistant." : "Sign in with your wallet to use the assistant.");
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after"));
    throw new ChatbotError("api", Number.isFinite(wait) && wait > 0 ? `Too many requests. Try again in ${Math.ceil(wait)} seconds.` : "Too many requests. Wait a moment and try again.");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ChatbotError("api", `Unexpected response (${res.status}).`);
  }
  const err = (data as { error?: unknown })?.error;
  if (!res.ok || typeof err === "string") {
    const msg = typeof err === "string" ? err : `Request failed (${res.status}).`;
    if (/OPENROUTER_API_KEY/i.test(msg)) throw new ChatbotError("no_ai_key", msg);
    throw new ChatbotError("api", (data as { message?: string })?.message || humanError(msg));
  }
  return data as T;
}

function humanError(code: string) {
  const map: Record<string, string> = {
    unknown_card: "I couldn't find that card. Try the full name, like “HDFC Regalia Gold”.",
    unknown_merchant: "Pick one of the suggested stores.",
    no_voucher: "There's no voucher for that store yet.",
  };
  return map[code] ?? code.replace(/_/g, " ");
}

/* ------------------------------------------------------------------ types */

export type Tile = { merchant_id: string; name: string; voucher_brand: string | null; category: string | null; site: string };

export type Suggest = {
  mode: "tiles" | "store_locked" | "fallback";
  item: string | null;
  selected: Tile | null;
  tiles?: Tile[];
  alternatives?: Tile[];
  voucher_available?: boolean;
  notes: string[];
};

export type Draft = {
  ok: true;
  request: { voucher_brand: string; merchant: string; merchant_id: string; item: string | null; amount_inr: number; suggested_split: number[] };
  disclaimers: string[];
};

export type FulfilOption = {
  rank: number;
  card: string;
  channel: string;
  expected_value_rupees: number;
  expected_value_pct: number;
  points: number | null;
  verified: boolean;
  grade: string;
  link: string | null;
  portal: string | null;
  portal_note: string;
  steps: string[];
  note: string;
  source: string;
  checked_on: string;
  best?: boolean;
};

export type Fulfil = {
  voucher_brand: string;
  amount_inr: number;
  options: FulfilOption[];
  not_recommended: unknown[];
  no_data_for_cards: string[];
  second_option: { name: string; url: string; note: string };
  notes: string[];
  must_match: { voucher_brand: string; total_amount_inr: number; suggested_split: number[]; tip: string };
};

/* -------------------------------------------------------------- endpoints */

type Auth = string | null | undefined;

export const chatbot = {
  health: () => call<{ ok: boolean; model: string }>("/health"),
  portfolio: (userId: string, token?: Auth) => call<{ cards: string[] }>(`/portfolio?user_id=${encodeURIComponent(userId)}`, undefined, token),
  addCard: (userId: string, card: string, token?: Auth) => call<{ ok: true; added: string; portfolio: string[] }>("/portfolio/add", { user_id: userId, card }, token),
  removeCard: (userId: string, card: string, token?: Auth) => call<{ ok: true; removed: string; portfolio: string[] }>("/portfolio/remove", { user_id: userId, card }, token),
  suggest: (query: string, token?: Auth) => call<Suggest>("/merchants/suggest", { query }, token),
  draft: (merchant: string, amount: number, item?: string | null, token?: Auth) => call<Draft>("/request/draft", { merchant, amount, item: item ?? undefined }, token),
  fulfil: (userId: string, brand: string, amount: number, token?: Auth) => call<Fulfil>("/request/fulfil", { user_id: userId, brand, amount }, token),
  chat: (userId: string, role: "buyer" | "seller", message: string, token?: Auth) =>
    call<{ reply: string; tools_used: string[] }>("/chat", { user_id: userId, role, message }, token),
  reset: (userId: string, role: "buyer" | "seller", token?: Auth) => call<{ ok: true }>("/chat", { user_id: userId, role, reset: true }, token),
};

/** API user ids allow [A-Za-z0-9_.-]{1,64}; a lower-cased wallet address fits. */
export const userIdFor = (address: string) => (address || "guest").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 64) || "guest";

/** Popular cards from chatbot/data/cards.json, shown as quick-add chips. */
export const POPULAR_CARDS = [
  "HDFC Infinia",
  "HDFC Regalia Gold",
  "HDFC Millennia",
  "ICICI Emeralde Private Metal",
  "Amazon Pay ICICI",
  "Axis Magnus",
  "Axis Atlas",
  "Flipkart Axis",
  "SBI Cashback",
  "Amex Platinum Travel",
  "Kotak Zen Signature",
];
