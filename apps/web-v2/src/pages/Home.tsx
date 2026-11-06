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
  ShoppingBag,
  Sparkles,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Aurora, BrandMark, Button, cx } from "../components/ui";
import { brand, findBrand } from "../lib/data";
import { CHATBOT_URL, ChatbotError, POPULAR_CARDS, chatbot, userIdFor, type Draft, type Fulfil, type Suggest, type Tile } from "../lib/chatbot";
import { inr, quote, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

type Mode = "spend" | "buy";
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

let nextId = 1;
const bot = (...blocks: Block[]): Msg => ({ id: nextId++, from: "bot", blocks });
const user = (text: string): Msg => ({ id: nextId++, from: "user", blocks: [{ kind: "text", text }] });
const say = (text: string): Block => ({ kind: "text", text });

/* ================================================================= page */

export default function Home() {
  const { address, fullAddress, openWallet, balance } = useApp();
  const [mode, setMode] = useState<Mode | null>(null);
  const [session, setSession] = useState(0);

  if (!address) return <NotConnected onConnect={openWallet} />;

  const pick = (m: Mode) => {
    setMode(m);
    setSession((s) => s + 1);
  };

  return (
    <div className="relative min-h-dvh pt-28">
      <Aurora className="h-[55vh] opacity-60" />
      <div className="relative mx-auto max-w-6xl px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <div className="label flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-mint" /> {address}
            </div>
            <h1 className="text-gradient mt-3 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">
              {mode ? (mode === "spend" ? "Spend USDC" : "Buy USDC") : "What do you want to do?"}
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/[0.03] px-4 py-2 text-[12.5px] text-mute ring-1 ring-white/[0.07]">
            <Wallet className="size-3.5 text-mint" /> Demo balance <span className="font-medium text-fg tabular">{usdt(balance)} USDC</span>
          </div>
        </motion.div>

        <div className={cx("mt-8 grid grid-cols-1 gap-4", mode ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "md:grid-cols-2")}>
          {/* Choice cards */}
          <div className={mode ? "grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-1 lg:content-start lg:gap-4" : "contents"}>
            <Choice
              n={1}
              active={mode === "spend"}
              compact={!!mode}
              tone="mint"
              icon={<ShoppingBag className="size-5" />}
              title="Spend USDC"
              body="Shop at any Indian store. Tell the assistant what you want, it finds the voucher and locks your USDC in escrow."
              points={["Any brand, any amount", "1% fee, nothing else", "USDC released only after the voucher checks out"]}
              onClick={() => pick("spend")}
            />
            <Choice
              n={2}
              active={mode === "buy"}
              compact={!!mode}
              tone="amber"
              icon={<CreditCard className="size-5" />}
              title="Buy USDC"
              body="Pay with your card and get USDC below market. The assistant ranks only your cards and keeps 100% of your rewards."
              points={["No platform fee", "Best card + channel, ranked", "Rewards stay between you and your bank"]}
              onClick={() => pick("buy")}
            />
          </div>

          <AnimatePresence mode="wait">
            {mode && (
              <motion.div
                key={session}
                className="min-w-0"
                initial={{ opacity: 0, y: 20, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <Assistant mode={mode} userId={userIdFor(fullAddress)} onRestart={() => setSession((s) => s + 1)} onClose={() => setMode(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ choices */

function Choice({
  n,
  active,
  compact,
  tone,
  icon,
  title,
  body,
  points,
  onClick,
}: {
  n: number;
  active: boolean;
  compact: boolean;
  tone: "mint" | "amber";
  icon: ReactNode;
  title: string;
  body: string;
  points: string[];
  onClick: () => void;
}) {
  const c =
    tone === "mint"
      ? { text: "text-mint", ring: "ring-mint/50", bg: "bg-mint/10", glow: "rgba(61,220,151,0.16)", btn: "primary" as const }
      : { text: "text-amber", ring: "ring-amber/55", bg: "bg-amber/10", glow: "rgba(245,181,68,0.16)", btn: "amber" as const };
  return (
    <motion.button
      layout
      onClick={onClick}
      aria-pressed={active}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={cx(
        "group relative w-full min-w-0 overflow-hidden rounded-[26px] bg-gradient-to-b from-white/[0.06] to-white/[0.015] text-left ring-1 backdrop-blur-xl transition-shadow",
        active ? c.ring : "ring-white/10 hover:ring-white/20",
        compact ? "p-4" : "p-7 md:p-8",
      )}
      style={{ boxShadow: active ? `0 30px 80px -30px ${c.glow.replace("0.16", "0.6")}` : undefined }}
    >
      <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full blur-3xl transition-opacity duration-500 group-hover:opacity-100" style={{ background: c.glow, opacity: active ? 1 : 0.5 }} />
      <div className="relative flex items-center gap-3">
        <span className={cx("grid place-items-center rounded-2xl ring-1 ring-white/10", c.bg, c.text, compact ? "size-10" : "size-12")}>{icon}</span>
        <span className="font-mono text-[11px] text-dim">0{n}</span>
        {active && <span className={cx("ml-auto rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", c.text, c.ring)}>open</span>}
      </div>
      <div className={cx("relative font-display font-semibold tracking-tight", compact ? "mt-3 text-[18px]" : "mt-7 text-[30px] md:text-[34px]")}>{title}</div>
      {!compact && (
        <>
          <p className="relative mt-3 max-w-md text-[15px] leading-relaxed text-mute">{body}</p>
          <ul className="relative mt-6 space-y-2">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-2 text-[13.5px] text-fg/85">
                <Check className={cx("size-4", c.text)} /> {p}
              </li>
            ))}
          </ul>
          <span
            className={cx(
              "relative mt-8 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium text-ink transition group-hover:brightness-110",
              tone === "mint" ? "bg-mint" : "bg-amber",
            )}
          >
            <Sparkles className="size-4" /> Start with the AI assistant <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </span>
        </>
      )}
    </motion.button>
  );
}

function NotConnected({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="relative grid min-h-dvh place-items-center px-6 pt-24">
      <Aurora className="opacity-60" />
      <div className="hairline relative w-full max-w-md rounded-[28px] bg-ink-2/80 p-8 text-center backdrop-blur-xl">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-mint/10 text-mint ring-1 ring-mint/25">
          <Wallet className="size-6" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">Connect your wallet</h1>
        <p className="mt-2 text-[14px] text-mute">Your wallet is your account. Connect to spend or buy USDC with the AI assistant.</p>
        <Button className="mt-6 w-full" size="lg" onClick={onConnect} icon={<ArrowRight className="size-4" />}>
          Connect wallet
        </Button>
      </div>
    </div>
  );
}

/* ============================================================ assistant */

function Assistant({ mode, userId, onRestart, onClose }: { mode: Mode; userId: string; onRestart: () => void; onClose: () => void }) {
  const { orders, balance, humanVerified, openWallet, postOrder, toast } = useApp();
  const nav = useNavigate();
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
          push(bot(say("Hi! I'll help you pay for a shop with your USDC.\n\nWhat do you want to buy? You can say something like **Nike shoes**, **groceries** or **shoes from Myntra**.")));
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
      push(bot(say("Here's your request. Check it and lock your USDC to post it."), { kind: "draft", data: d }));
      setStep("confirm");
    } catch (e) {
      fail(e);
    }
  };

  const lock = () => {
    const d = ctx.current.draft;
    if (!d) return;
    if (!humanVerified) {
      push(bot(say("One step first: verify you're a real person with World ID. It's once per account.")));
      openWallet();
      return;
    }
    const q = quote(d.request.amount_inr, RATE);
    if (q.sellerLocks > balance) {
      push(bot(say(`That needs **${usdt(q.sellerLocks)} USDC** but your demo balance is ${usdt(balance)} USDC. Try a smaller amount.`)));
      setStep("ask_amount");
      return;
    }
    const brandId = findBrand(d.request.merchant_id) ? d.request.merchant_id : "amazon";
    const o = postOrder({ brandId, amount: d.request.amount_inr, rate: RATE }, q.sellerLocks);
    toast({ title: "Request is live", body: `${usdt(q.sellerLocks)} USDC locked in escrow · ${o.id}`, tone: "mint" });
    push(user("Lock & post"), bot(say(`Done. **${usdt(q.sellerLocks)} USDC** is locked in escrow and your request is live for verified buyers.`), { kind: "posted", orderId: o.id }));
    setStep("posted");
  };

  const addCard = async (name: string) => {
    push(user(name));
    try {
      const r = await think(() => chatbot.addCard(userId, name));
      setPortfolio(r.portfolio);
      push(bot(say(`Added **${r.added}**.`), { kind: "portfolio", cards: r.portfolio }));
    } catch (e) {
      fail(e);
    }
  };

  const removeCard = async (name: string) => {
    try {
      const r = await chatbot.removeCard(userId, name);
      setPortfolio(r.portfolio);
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
    const b = brand(o.brandId);
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
        ? ["Nike shoes", "Groceries", "Shoes from Myntra", "A Lifestyle voucher"].map((l) => ({ label: l, on: () => search(l) }))
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
            ? "What do you want to buy?"
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
    <div className="hairline relative flex h-[min(760px,calc(100dvh_-_230px))] min-h-[520px] flex-col overflow-hidden rounded-[28px] bg-ink-2/85 backdrop-blur-xl">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: `radial-gradient(60% 100% at 50% 0%, ${tone === "mint" ? "rgba(61,220,151,0.14)" : "rgba(245,181,68,0.13)"}, transparent)` }}
      />
      {/* header */}
      <div className="relative flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
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
      <div ref={scroller} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6" aria-live="polite">
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
                  onOpenTrade={(id) => nav(`/trade/${id}`)}
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
      <div className="relative border-t border-white/[0.06] p-3 md:p-4">
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
        <p className="px-4 pb-3 text-[11px] text-dim">Released only after a signed voucher check. Back to you automatically if nobody fills it in 30 min.</p>
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
          <div className="text-[14px] font-medium">Request {b.orderId} is live</div>
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

