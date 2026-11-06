import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Check,
  CreditCard,
  ExternalLink,
  Lock,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandMark, Button, cx } from "./ui";
import { brand } from "../lib/data";
import { CHATBOT_URL, ChatbotError, POPULAR_CARDS, chatbot, type Draft, type Fulfil, type Suggest, type Tile } from "../lib/chatbot";
import { inr, quote, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

/** The AI chat assistant from the ai-chatbot branch, restored as it was on the earlier Home page. */
export type Mode = "spend" | "buy";
const RATE = 90;

/* ------------------------------------------------------------- messages */

type Block =
  | { kind: "text"; text: string }
  | { kind: "tiles"; data: Suggest }
  | { kind: "draft"; data: Draft }
  | { kind: "portfolio"; cards: string[] }
  | { kind: "requests" }
  | { kind: "options"; data: Fulfil; orderId: string }
  | { kind: "offline" }
  | { kind: "posted"; orderId: string };

type Msg = { id: number; from: "bot" | "user"; blocks: Block[] };

type Step =
  | "ask_item"
  | "pick_store"
  | "ask_amount"
  | "confirm"
  | "posted"
  | "cards"
  | "pick_request"
  | "options";

/** Store shortcuts on the Spend greeting. Same tiles the chatbot's /merchants/suggest returns for these sites. */
const QUICK_STORES: Tile[] = [
  { merchant_id: "amazon", name: "Amazon", voucher_brand: "Amazon", category: "general online retail", site: "amazon.in" },
  { merchant_id: "myntra", name: "Myntra", voucher_brand: "Myntra", category: "general online retail", site: "myntra.com" },
  { merchant_id: "flipkart", name: "Flipkart", voucher_brand: "Flipkart", category: "general online retail", site: "flipkart.com" },
  { merchant_id: "ajio", name: "AJIO", voucher_brand: "AJIO", category: "general online retail", site: "ajio.com" },
  { merchant_id: "nike", name: "Nike", voucher_brand: "Nike", category: "general online retail", site: "nike.com" },
];

let nextId = 1;
const bot = (...blocks: Block[]): Msg => ({ id: nextId++, from: "bot", blocks });
const user = (text: string): Msg => ({ id: nextId++, from: "user", blocks: [{ kind: "text", text }] });
const say = (text: string): Block => ({ kind: "text", text });

/* ============================================================ assistant */

type AssistantProps = {
  mode: Mode; userId: string; onRestart: () => void; onClose: () => void;
  orders: ReturnType<typeof useApp>["orders"];
  onStore: (store: Tile) => void; onDraft: (draft: Draft) => void;
  onPost: (draft: Draft) => Promise<ReturnType<typeof useApp>["orders"][number] | null>;
  onRequest: (id: string) => void; onOpenTrade: (id: string) => void;
};
export default function Assistant({ mode, userId, onRestart, onClose, orders, onStore, onDraft, onPost, onRequest, onOpenTrade }: AssistantProps) {
  const { syncAssistantCards } = useApp();

  const role = mode === "spend" ? "seller" : "buyer";
  const tone = mode === "spend" ? "mint" : "amber";

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step>(mode === "spend" ? "ask_item" : "cards");
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const ctx = useRef<{ store?: Tile; item?: string | null; draft?: Draft }>({});
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const push = useCallback((...m: Msg[]) => setMsgs((all) => [...all, ...m]), []);

  /** Shows the typing indicator for at least a beat, so replies feel conversational. */
  const think = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setTyping(true);
    const [r] = await Promise.all([work(), new Promise((res) => setTimeout(res, 450))]).finally(() => setTyping(false));
    return r as T;
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ChatbotError && e.kind === "offline") {
        setOnline(false);
        push(bot({ kind: "offline" }));
      } else push(bot(say(e instanceof Error ? e.message : "Something went wrong.")));
    },
    [push],
  );

  // Greeting + health check
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await chatbot.health();
        if (!live) return;
        setOnline(true);
        if (mode === "spend") {
          push(bot(say("Hi! I'll help you pay for a shop with your USDC.\n\nWhere would you like to spend your crypto? Pick a store below or type one.")));
        } else {
          const pf = await chatbot.portfolio(userId);
          if (!live) return;
          setPortfolio(pf.cards);
          push(
            bot(
              say("Hi! I'll find the best way to buy USDC with your cards. I only rank cards you tell me you hold, and I never ask for card numbers."),
              say(pf.cards.length ? "Here are the cards I have for you. Add more, or continue." : "Which cards do you have? Tap to add, or type a card name."),
              { kind: "portfolio", cards: pf.cards },
            ),
          );
        }
      } catch (e) {
        if (live) fail(e);
      }
    })();
    return () => {
      live = false;
    };
  }, [mode, userId, push, fail]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, typing]);

  /* ----------------------------------------------------------- actions */

  const search = async (q: string) => {
    push(user(q));
    try {
      const s = await think(() => chatbot.suggest(q));
      ctx.current.item = s.item;
      if (s.mode === "store_locked" && s.selected) {
        if (s.voucher_available === false) {
          push(bot(say(`There's no voucher for **${s.selected.name}** yet. Pick another store:`), { kind: "tiles", data: { ...s, selected: null, tiles: s.alternatives } }));
          setStep("pick_store");
          return;
        }
        push(bot(say(`Got it, **${s.selected.name}**${s.item ? ` for ${s.item}` : ""}. Tap it to continue, or pick another store.`), { kind: "tiles", data: s }));
      } else if (s.mode === "fallback") {
        push(bot(say("I couldn't tell what that is, so here are the biggest general stores. Pick one, or tell me more."), { kind: "tiles", data: s }));
      } else {
        push(bot(say(`Stores that sell ${s.item ? `**${s.item}**` : "that"} and take vouchers. Pick one:`), { kind: "tiles", data: s }));
      }
      setStep("pick_store");
    } catch (e) {
      fail(e);
    }
  };

  const pickStore = (t: Tile) => {
    ctx.current.store = t;
    onStore(t);
    push(user(t.name), bot(say(`**${t.name}** it is. How much do you want to spend? (₹)`)));
    setStep("ask_amount");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const setAmount = async (amount: number, label?: string) => {
    const s = ctx.current.store;
    if (!s) return;
    push(user(label ?? inr(amount)));
    if (amount < 250 || amount > 200000) {
      push(bot(say("Please pick an amount between ₹250 and ₹2,00,000.")));
      return;
    }
    try {
      const d = await think(() => chatbot.draft(s.merchant_id, amount, ctx.current.item));
      ctx.current.draft = d;
      onDraft(d);
      push(bot(say("Here's your request. Check it and lock your USDC to post it."), { kind: "draft", data: d }));
      setStep("confirm");
    } catch (e) {
      fail(e);
    }
  };

  const lock = async () => {
    const d = ctx.current.draft;
    if (!d || typing || step !== "confirm") return;
    try {
      const o = await think(() => onPost(d));
      if (!o) return;
      push(user("Lock & post"), bot(say(o.source === "live" ? "Request created. Complete the escrow deposit to publish it." : "Request saved in preview. No funds moved."), { kind: "posted", orderId: o.id }));
      setStep("posted");
    } catch (e) { fail(e); }
  };

  const addCard = async (name: string) => {
    push(user(name));
    try {
      const r = await think(() => chatbot.addCard(userId, name));
      setPortfolio(r.portfolio);
      syncAssistantCards(r.portfolio);
      push(bot(say(`Added **${r.added}**.`), { kind: "portfolio", cards: r.portfolio }));
    } catch (e) {
      fail(e);
    }
  };

  const removeCard = async (name: string) => {
    try {
      const r = await chatbot.removeCard(userId, name);
      setPortfolio(r.portfolio);
      syncAssistantCards(r.portfolio);
    } catch (e) {
      fail(e);
    }
  };

  const showRequests = () => {
    push(user("Show requests"), bot(say("These sellers have already locked their USDC in escrow. Pick one and I'll rank your cards for it."), { kind: "requests" }));
    setStep("pick_request");
  };

  const pickRequest = async (orderId: string) => {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    const b = { ...brand(o.brandId), name: o.brandName || brand(o.brandId).name };
    onRequest(orderId);
    push(user(`${b.name} ${inr(o.amount)}`));
    try {
      const f = await think(() => chatbot.fulfil(userId, b.name, o.amount));
      push(
        bot(
          say(f.options.length ? `Best ways to buy a **${inr(o.amount)} ${b.name}** voucher with your cards, best first:` : "None of your cards has a route for this voucher."),
          { kind: "options", data: f, orderId },
        ),
      );
      setStep("options");
    } catch (e) {
      fail(e);
    }
  };

  const askAi = async (text: string) => {
    push(user(text));
    try {
      const r = await think(() => chatbot.chat(userId, role, text));
      setAiReady(true);
      push(bot(say(r.reply || "…")));
    } catch (e) {
      if (e instanceof ChatbotError && e.kind === "no_ai_key") {
        setAiReady(false);
        push(bot(say("Free-form AI answers are off because the server has no OpenRouter key. The guided steps above still work. Tap an option to continue.")));
      } else fail(e);
    }
  };

  const retry = async () => {
    try {
      await chatbot.health();
      setOnline(true);
      onRestart();
    } catch {
      setOnline(false);
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput("");
    if (mode === "spend") {
      if (step === "ask_item" || step === "pick_store") return void search(text);
      if (step === "ask_amount") {
        const n = Number(text.replace(/[₹,\s]/g, "").replace(/k$/i, "000"));
        if (Number.isFinite(n) && n > 0) return void setAmount(n, text);
      }
      return void askAi(text);
    }
    if (step === "cards" && !/\?|best|which|how|why|what/i.test(text)) return void addCard(text);
    return void askAi(text);
  };

  /* ------------------------------------------------------ quick replies */

  const quick: { label: string; on: () => void }[] =
    mode === "spend"
      ? step === "ask_item"
        ? QUICK_STORES.map((t) => ({ label: t.site, on: () => pickStore(t) }))
        : step === "ask_amount"
          ? [2000, 5000, 10000, 25000].map((a) => ({ label: inr(a), on: () => setAmount(a) }))
          : step === "confirm"
            ? [{ label: "Change amount", on: () => (push(user("Change amount"), bot(say("Sure, how much? (₹)"))), setStep("ask_amount")) }]
            : step === "posted"
              ? [{ label: "Post another request", on: onRestart }]
              : []
      : step === "cards"
        ? [
            ...POPULAR_CARDS.filter((c) => !portfolio.includes(c))
              .slice(0, 5)
              .map((c) => ({ label: `+ ${c}`, on: () => addCard(c) })),
            ...(portfolio.length ? [{ label: "Continue → show requests", on: showRequests }] : []),
          ]
        : step === "options"
          ? [{ label: "See other requests", on: showRequests }]
          : [];

  const placeholder =
    online === false
      ? "AI server offline"
      : mode === "spend"
        ? step === "ask_amount"
          ? "Type an amount, e.g. 10000"
          : step === "ask_item" || step === "pick_store"
            ? "Type a store, e.g. amazon.in"
            : "Ask the assistant anything…"
        : step === "cards"
          ? "Type a card name, e.g. HDFC Regalia Gold"
          : "Ask about cards, caps or rewards…";

  /* ----------------------------------------------------------- render */

  // A block is clickable only if it's the newest of its kind and the conversation is at its step.
  const lastOfKind: Partial<Record<Block["kind"], number>> = {};
  for (const m of msgs) for (const b of m.blocks) lastOfKind[b.kind] = m.id;
  const stepFor: Partial<Record<Block["kind"], Step[]>> = {
    tiles: ["pick_store", "ask_item"],
    draft: ["confirm"],
    portfolio: ["cards"],
    requests: ["pick_request", "options"],
    options: ["options"],
    posted: ["posted"],
  };
  const isActive = (msgId: number, kind: Block["kind"]) => lastOfKind[kind] === msgId && (!stepFor[kind] || stepFor[kind]!.includes(step));

  return (
    <div className="exact-upstream-assistant relative flex min-h-[520px] flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: `radial-gradient(60% 100% at 50% 0%, ${tone === "mint" ? "rgba(61,220,151,0.14)" : "rgba(245,181,68,0.13)"}, transparent)` }}
      />
      {/* header */}
      <div className="exact-chat-header relative flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <span className={cx("relative grid size-10 place-items-center rounded-2xl ring-1 ring-white/10", tone === "mint" ? "bg-mint/10 text-mint" : "bg-amber/10 text-amber")}>
          <Bot className="size-5" />
          <span className={cx("absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-ink-2", online ? "bg-mint" : online === false ? "bg-rose" : "bg-dim")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">NetPositive AI</div>
          <div className="truncate text-[11.5px] text-mute">
            {online === false ? "Offline" : online ? (aiReady === false ? "Guided mode · AI answers off" : "Online · ranks only your cards") : "Connecting…"} ·{" "}
            {mode === "spend" ? "Spend USDC" : "Buy USDC"}
          </div>
        </div>
        <button onClick={onRestart} className="grid size-9 place-items-center rounded-full text-mute ring-1 ring-white/10 transition hover:text-fg" aria-label="Start over" title="Start over">
          <RotateCcw className="size-4" />
        </button>
        <button onClick={onClose} className="grid size-9 place-items-center rounded-full text-mute ring-1 ring-white/10 transition hover:text-fg" aria-label="Close assistant" title="Close">
          <X className="size-4" />
        </button>
      </div>

      {/* messages */}
      <div ref={scroller} className="exact-chat-messages relative flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6" aria-live="polite">
        {msgs.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={cx("flex gap-2.5", m.from === "user" && "justify-end")}
          >
            {m.from === "bot" && (
              <span className={cx("mt-1 grid size-7 shrink-0 place-items-center rounded-full", tone === "mint" ? "bg-mint/10 text-mint" : "bg-amber/10 text-amber")}>
                <Sparkles className="size-3.5" />
              </span>
            )}
            <div className={cx("min-w-0 space-y-2.5", m.from === "user" ? "max-w-[80%]" : "w-full max-w-[640px]")}>
              {m.blocks.map((b, i) => (
                <BlockView
                  key={i}
                  b={b}
                  from={m.from}
                  tone={tone}
                  latest={isActive(m.id, b.kind)}
                  portfolio={portfolio}
                  orders={orders}
                  onPickStore={pickStore}
                  onLock={lock}
                  onRemoveCard={removeCard}
                  onPickRequest={pickRequest}
                  onOpenTrade={onOpenTrade}
                  onRetry={retry}
                />
              ))}
            </div>
          </motion.div>
        ))}
        <AnimatePresence>
          {typing && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
              <span className={cx("grid size-7 place-items-center rounded-full", tone === "mint" ? "bg-mint/10 text-mint" : "bg-amber/10 text-amber")}>
                <Sparkles className="size-3.5" />
              </span>
              <span className="flex gap-1 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.06]">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="size-1.5 rounded-full bg-mute" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                ))}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* composer */}
      <div className="exact-chat-composer relative border-t border-white/[0.06] p-3 md:p-4">
        {quick.length > 0 && !typing && online !== false && (
          <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
            {quick.map((q) => (
              <button
                key={q.label}
                onClick={q.on}
                className={cx(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] ring-1 transition",
                  q.label.startsWith("Continue")
                    ? tone === "mint"
                      ? "bg-mint text-ink ring-mint"
                      : "bg-amber text-ink ring-amber"
                    : "text-fg/85 ring-white/12 hover:bg-white/[0.06] hover:ring-white/25",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={cx("flex items-center gap-2 rounded-2xl bg-white/[0.04] p-1.5 pl-4 ring-1 transition", tone === "mint" ? "ring-white/10 focus-within:ring-mint/45" : "ring-white/10 focus-within:ring-amber/45")}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={online === false}
            placeholder={placeholder}
            maxLength={500}
            className="h-10 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-dim disabled:cursor-not-allowed"
            aria-label="Message the assistant"
          />
          <button
            type="submit"
            disabled={!input.trim() || typing || online === false}
            className={cx("grid size-10 place-items-center rounded-xl text-ink transition disabled:opacity-30", tone === "mint" ? "bg-mint" : "bg-amber")}
            aria-label="Send"
          >
            <SendHorizontal className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- blocks */

function BlockView({
  b,
  from,
  tone,
  latest,
  portfolio,
  orders,
  onPickStore,
  onLock,
  onRemoveCard,
  onPickRequest,
  onOpenTrade,
  onRetry,
}: {
  b: Block;
  from: "bot" | "user";
  tone: "mint" | "amber";
  latest: boolean;
  portfolio: string[];
  orders: ReturnType<typeof useApp>["orders"];
  onPickStore: (t: Tile) => void;
  onLock: () => void;
  onRemoveCard: (c: string) => void;
  onPickRequest: (id: string) => void;
  onOpenTrade: (id: string) => void;
  onRetry: () => void;
}) {
  const accent = tone === "mint" ? "text-mint" : "text-amber";

  if (b.kind === "text")
    return (
      <div
        className={cx(
          "w-fit max-w-full rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap",
          from === "user" ? cx("ml-auto rounded-br-md text-ink", tone === "mint" ? "bg-mint" : "bg-amber") : "rounded-tl-md bg-white/[0.045] text-fg/90 ring-1 ring-white/[0.06]",
        )}
      >
        <RichText text={b.text} />
      </div>
    );

  if (b.kind === "offline")
    return (
      <div className="rounded-2xl bg-rose/[0.06] p-4 ring-1 ring-rose/25">
        <div className="flex items-center gap-2 text-[14px] font-medium text-rose">
          <TriangleAlert className="size-4" /> The AI server isn't running
        </div>
        <p className="mt-1.5 text-[13px] text-mute">
          Start it from the <span className="font-mono text-fg/80">ai-chatbot</span> branch, then retry:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[12px] text-fg/85">cd chatbot && python3 server.py</pre>
        <p className="mt-2 font-mono text-[11px] text-dim">Expected at {CHATBOT_URL}</p>
        <button onClick={onRetry} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-medium text-ink">
          <RotateCcw className="size-3.5" /> Retry
        </button>
      </div>
    );

  if (b.kind === "tiles") {
    const s = b.data;
    const list = s.mode === "store_locked" ? [...(s.selected ? [s.selected] : []), ...(s.alternatives ?? [])] : s.tiles ?? [];
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {list.map((t, i) => {
          const locked = s.mode === "store_locked" && i === 0;
          return (
            <button
              key={t.merchant_id}
              disabled={!latest}
              onClick={() => onPickStore(t)}
              className={cx(
                "group flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition disabled:cursor-default disabled:opacity-60",
                locked ? "bg-mint/[0.07] ring-mint/45" : "bg-white/[0.03] ring-white/[0.07] enabled:hover:bg-white/[0.07] enabled:hover:ring-white/20",
              )}
            >
              <BrandMark id={t.merchant_id} name={t.name} size={36} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-medium">{t.name}</span>
                <span className="block truncate font-mono text-[10.5px] text-dim">{t.site}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (b.kind === "draft") {
    const r = b.data.request;
    const q = quote(r.amount_inr, RATE);
    return (
      <div className="overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.08]">
        <div className="flex items-center gap-3 border-b border-white/[0.06] p-4">
          <BrandMark id={r.merchant_id} name={r.merchant} size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{r.voucher_brand} voucher</div>
            <div className="text-[12px] text-mute">{r.item ? `For ${r.item}` : r.merchant}</div>
          </div>
          <div className="font-display text-2xl font-semibold tabular">{inr(r.amount_inr)}</div>
        </div>
        <div className="divide-y divide-white/[0.05] px-4 text-[13px]">
          {[
            ["Suggested vouchers", r.suggested_split.map((x) => inr(x)).join(" + ")],
            ["Rate", `₹${RATE} / USDC`],
            ["Buyer receives", `${usdt(q.buyerReceives)} USDC`],
            ["Fee (1%)", `${usdt(q.fee)} USDC`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-2.5">
              <span className="text-mute">{k}</span>
              <span className="tabular">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-dashed border-white/10 p-4">
          <div>
            <div className="text-[12px] text-mute">You lock</div>
            <div className="font-display text-xl font-semibold text-mint tabular">{usdt(q.sellerLocks)} USDC</div>
          </div>
          <Button onClick={onLock} disabled={!latest} icon={<Lock className="size-4" />}>
            Lock & post
          </Button>
        </div>
        <p className="px-4 pb-3 text-[11px] text-dim">Escrow funding and delivery continue in the trade view.</p>
      </div>
    );
  }

  if (b.kind === "posted")
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-mint/[0.06] p-4 ring-1 ring-mint/30 sm:flex-row sm:items-center">
        <span className="grid size-10 place-items-center rounded-full bg-mint text-ink">
          <Check className="size-5" />
        </span>
        <div className="flex-1">
          <div className="text-[14px] font-medium">Request {b.orderId}</div>
          <div className="text-[12px] text-mute">You'll get the voucher codes once a buyer fills it and they pass the check.</div>
        </div>
        <Button size="sm" onClick={() => onOpenTrade(b.orderId)} icon={<ArrowRight className="size-3.5" />}>
          Follow the trade
        </Button>
      </div>
    );

  if (b.kind === "portfolio")
    return (
      <div className="flex flex-wrap gap-2">
        {(latest ? portfolio : b.cards).map((c) => (
          <span key={c} className="flex items-center gap-1.5 rounded-full bg-amber/[0.08] py-1.5 pr-1.5 pl-3 text-[12.5px] ring-1 ring-amber/30">
            <CreditCard className="size-3.5 text-amber" /> {c}
            {latest && (
              <button onClick={() => onRemoveCard(c)} className="grid size-5 place-items-center rounded-full text-mute hover:bg-white/10 hover:text-fg" aria-label={`Remove ${c}`}>
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!(latest ? portfolio : b.cards).length && <span className="text-[12.5px] text-dim">No cards yet.</span>}
      </div>
    );

  if (b.kind === "requests") {
    const open = orders.filter((o) => o.seller !== "you").slice(0, 6);
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {open.map((o) => {
          const q = quote(o.amount, o.rate);
          const br = brand(o.brandId);
          return (
            <button
              key={o.id}
              disabled={!latest}
              onClick={() => onPickRequest(o.id)}
              className="group flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3 text-left ring-1 ring-white/[0.07] transition enabled:hover:bg-white/[0.07] enabled:hover:ring-amber/40 disabled:cursor-default disabled:opacity-60"
            >
              <BrandMark id={o.brandId} size={38} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">
                  {br.name} {inr(o.amount)}
                </span>
                <span className="block text-[11.5px] text-mute">
                  Get <span className="text-fg tabular">{usdt(q.buyerReceives)} USDC</span> · ₹{o.rate}
                </span>
              </span>
              <ArrowRight className="size-4 text-dim transition group-hover:translate-x-0.5 group-hover:text-amber" />
            </button>
          );
        })}
      </div>
    );
  }

  if (b.kind === "options") {
    const f = b.data;
    const o = orders.find((x) => x.id === b.orderId);
    const q = o ? quote(o.amount, o.rate) : null;
    return (
      <div className="space-y-2">
        {f.options.map((op) => (
          <div key={op.rank} className={cx("rounded-2xl p-4 ring-1", op.best ? "bg-amber/[0.07] ring-amber/45" : "bg-white/[0.025] ring-white/[0.07]")}>
            <div className="flex items-start gap-3">
              <span className={cx("grid size-7 shrink-0 place-items-center rounded-full font-mono text-[11px]", op.best ? "bg-amber text-ink" : "bg-white/[0.06] text-mute")}>{op.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{op.card}</span>
                  {op.best && <span className="rounded-full bg-amber/15 px-2 py-0.5 font-mono text-[9.5px] tracking-wider text-amber uppercase">best</span>}
                  <span
                    className={cx("flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", op.verified ? "text-mint ring-mint/30" : "text-amber ring-amber/30")}
                    title={`${op.source} · checked ${op.checked_on}`}
                  >
                    {op.verified ? <BadgeCheck className="size-3" /> : <TriangleAlert className="size-3" />} {op.verified ? op.grade.toLowerCase() : "confirm"}
                  </span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-mute">{op.channel}</div>
              </div>
              <div className="text-right">
                <div className={cx("text-[17px] font-semibold tabular", op.best && "text-amber")}>{op.expected_value_pct}%</div>
                <div className="text-[11px] text-dim tabular">≈ {inr(op.expected_value_rupees)} back</div>
              </div>
            </div>
            {op.best && op.steps.length > 0 && (
              <ol className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-3 pl-10">
                {op.steps.slice(0, 4).map((s, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] text-fg/80">
                    <span className={cx("font-mono", accent)}>{i + 1}</span> {s}
                  </li>
                ))}
              </ol>
            )}
            {op.link && (
              <div className="mt-3 pl-10">
                <a href={op.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] text-fg/85 underline decoration-white/25 underline-offset-4 hover:text-fg">
                  Open {op.portal ?? "portal"} <ExternalLink className="size-3" />
                </a>
              </div>
            )}
          </div>
        ))}

        <div className="rounded-2xl bg-white/[0.02] p-3.5 text-[12.5px] ring-1 ring-white/[0.06]">
          <div className="text-mute">
            Must match: <span className="text-fg">{f.must_match.voucher_brand}</span>, total <span className="text-fg">{inr(f.must_match.total_amount_inr)}</span>{" "}
            ({f.must_match.suggested_split.map((x) => inr(x)).join(" + ")})
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-dim">
            Second option:
            <a href={f.second_option.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg/80 hover:text-fg">
              {f.second_option.name} <ArrowUpRight className="size-3" />
            </a>
            · no reward data, so none is claimed
          </div>
        </div>

        {f.options.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl bg-amber/[0.05] p-4 ring-1 ring-amber/25 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="text-[14px] font-medium">Accept this request</div>
              <div className="text-[12px] text-mute">{q ? `You'll receive ${usdt(q.buyerReceives)} USDC from escrow after the voucher check.` : "Open the trade to continue."}</div>
            </div>
            <Button variant="amber" size="sm" disabled={!latest} onClick={() => onOpenTrade(b.orderId)} icon={<ArrowRight className="size-3.5" />}>
              Accept & open trade
            </Button>
          </div>
        )}
      </div>
    );
  }
  return null;
}

/** Renders **bold** and bare URLs from assistant text without injecting HTML. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
        if (/^https?:\/\//.test(p))
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer" className="underline decoration-current/40 underline-offset-2">
              {p.replace(/^https?:\/\//, "").slice(0, 48)}
            </a>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

