/**
 * Client for the NetPositive AI chatbot API (branch `ai-chatbot`, chatbot/server.py).
 * Run it with:  cd chatbot && python3 server.py   (http://127.0.0.1:8787)
 */

export const CHATBOT_URL = ((import.meta.env.VITE_CHATBOT_URL as string | undefined) || "http://127.0.0.1:8787").replace(/\/$/, "");

export class ChatbotError extends Error {
  kind: "offline" | "no_ai_key" | "api";
  constructor(kind: ChatbotError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

async function call<T>(path: string, body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(CHATBOT_URL + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ChatbotError("offline", "The AI server isn't reachable.");
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

export const chatbot = {
  health: () => call<{ ok: boolean; model: string }>("/health"),
  portfolio: (userId: string) => call<{ cards: string[] }>(`/portfolio?user_id=${encodeURIComponent(userId)}`),
  addCard: (userId: string, card: string) => call<{ ok: true; added: string; portfolio: string[] }>("/portfolio/add", { user_id: userId, card }),
  removeCard: (userId: string, card: string) => call<{ ok: true; removed: string; portfolio: string[] }>("/portfolio/remove", { user_id: userId, card }),
  suggest: (query: string) => call<Suggest>("/merchants/suggest", { query }),
  draft: (merchant: string, amount: number, item?: string | null) => call<Draft>("/request/draft", { merchant, amount, item: item ?? undefined }),
  fulfil: (userId: string, brand: string, amount: number) => call<Fulfil>("/request/fulfil", { user_id: userId, brand, amount }),
  chat: (userId: string, role: "buyer" | "seller", message: string) =>
    call<{ reply: string; tools_used: string[] }>("/chat", { user_id: userId, role, message }),
  reset: (userId: string, role: "buyer" | "seller") => call<{ ok: true }>("/chat", { user_id: userId, role, reset: true }),
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
