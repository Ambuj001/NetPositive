import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bot, Check, LoaderCircle, Lock, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Aurora, BrandMark, Button, cx } from "../components/ui";
import { ApiError, api } from "../lib/api";
import type { Order } from "../lib/data";
import { brand } from "../lib/data";
import { lockUsdc, mockTxHash } from "../lib/escrow";
import { inr, quote, usdt } from "../lib/engine";
import { toOrder, useOrderBook } from "../lib/orderbook";
import { useApp } from "../lib/store";
import { useWorldId } from "../lib/world";

/** Rupees per USDC when a spender posts a new request. */
const RATE = 93.98;
/** $1 test voucher. Face value is the rate rounded to a whole rupee, which the order API requires. */
const ONE_USD_INR = Math.round(RATE);
const PLACES = [
  { id: "amazon", api: "amazon", label: "Amazon" },
  { id: "flipkart", api: "flipkart", label: "Flipkart" },
  { id: "myntra", api: "myntra", label: "Myntra" },
  { id: "blinkit", api: "blinkit", label: "Blinkit" },
] as const;
type Place = (typeof PLACES)[number];
const AMOUNTS = [
  { inr: ONE_USD_INR, label: "$1" },
  { inr: 500, label: "₹500" },
  { inr: 1000, label: "₹1,000" },
  { inr: 2000, label: "₹2,000" },
] as const;

function amountLabel(n: number) {
  return AMOUNTS.find((a) => a.inr === n)?.label ?? inr(n);
}

type Step = "place" | "amount" | "matched" | "posted";
type LockPhase = "create" | "lock" | "publish";
type Block =
  | { kind: "text"; text: string }
  | { kind: "orders"; orders: Order[]; selectedId: string | null; place: string }
  | { kind: "posted"; orderId: string };
type Msg = { id: number; from: "bot" | "user"; blocks: Block[] };

let nextId = 1;
const say = (text: string): Block => ({ kind: "text", text });
const bot = (...blocks: Block[]): Msg => ({ id: nextId++, from: "bot", blocks });
const user = (text: string): Msg => ({ id: nextId++, from: "user", blocks: [say(text)] });

function amountUsdc(n: number) {
  const trimmed = n.toFixed(6).replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

const greeting = () => [bot(say("Where do you want to spend crypto today?"))];

export default function Spend() {
  const { address } = useApp();
  const nav = useNavigate();
  const { orders: book } = useOrderBook();
  const [session, setSession] = useState(0);

  return (
    <div className="relative min-h-dvh pt-28 pb-10">
      <Aurora className="h-[55vh] opacity-60" />
      <div className="relative mx-auto max-w-6xl px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {address && (
            <div className="label flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-mint" /> {address}
            </div>
          )}
          <h1 className="text-gradient mt-3 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Spend USDC</h1>
        </motion.div>
        <div className="mt-8">
          <SpendChat key={session} book={book} onRestart={() => setSession((s) => s + 1)} onClose={() => nav("/home")} />
        </div>
      </div>
    </div>
  );
}

export function SpendChat({ book, onRestart, onClose }: { book: Order[]; onRestart: () => void; onClose: () => void }) {
  const { fullAddress, humanVerified, openWallet, token, signIn, postOrder, toast, walletRequest } = useApp();
  const { verifyHuman } = useWorldId();
  const [msgs, setMsgs] = useState<Msg[]>(greeting);
  const [step, setStep] = useState<Step>("place");
  const [place, setPlace] = useState<Place | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [phase, setPhase] = useState<LockPhase | null>(null);
  const [lockError, setLockError] = useState("");
  const [held, setHeld] = useState<{ id: string; txHash: string; auth: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const push = (...m: Msg[]) => setMsgs((all) => [...all, ...m]);
  const qt = quote(amount ?? 0, RATE);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const pickPlace = (next: Place) => {
    if (step !== "place" || busy) return;
    setPlace(next);
    push(user(next.label), bot(say(`${next.label}. How much do you want to spend?`)));
    setStep("amount");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const pickAmount = async (n: number) => {
    if (step !== "amount" || busy || review || !place) return;
    setBusy(true);
    setAmount(n);
    const label = amountLabel(n);
    push(user(label));
    try {
      const { orders, match, count } = await loadBrand(place, n, book);
      if (match) {
        const extra = count > 1 ? ` I picked the newest of ${count}.` : "";
        push(
          bot(
            say(`There's already a ${place.label} ${label} order in the book. I've selected it, so there's no need to lock USDC again.${extra}`),
            { kind: "orders", orders, selectedId: match.id, place: place.label },
          ),
        );
        setStep("matched");
        return;
      }
      push(
        bot(
          say(`No ${place.label} ${label} order is open. Review a new one and I'll lock your USDC, then post it for a gift-card buyer.`),
          { kind: "orders", orders, selectedId: null, place: place.label },
        ),
      );
      setLockError("");
      setReview(true);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!amount || !place || phase) return;
    if (held) {
      setLockError("");
      setPhase("publish");
      try {
        const funded = await api.fund(held.id, held.txHash, held.auth);
        finish(funded.request.id);
      } catch (error) {
        setPhase(null);
        setLockError(error instanceof Error ? error.message : "Couldn't publish the order.");
      }
      return;
    }
    if (!fullAddress) {
      openWallet();
      return;
    }
    setLockError("");
    setPhase("create");
    let createdId = "";
    let deposited = false;
    let auth = token;
    try {
      if (!auth) auth = await signIn();
      if (!auth) {
        setPhase(null);
        return;
      }
      if (!humanVerified) {
        const ok = await verifyHuman();
        if (!ok) {
          setPhase(null);
          return;
        }
      }
      const created = await api.create({ brand: place.api, amountInr: amount, amountUsdc: amountUsdc(qt.sellerLocks) }, auth);
      createdId = created.request.id;
      setPhase("lock");
      const txHash = created.escrowContract
        ? await lockUsdc(walletRequest, {
            from: fullAddress,
            escrow: created.escrowContract,
            escrowId: created.request.escrowId,
            amountBaseUnits: created.request.amountUsdcBaseUnits,
          })
        : mockTxHash();
      deposited = Boolean(created.escrowContract);
      if (deposited) setHeld({ id: createdId, txHash, auth });
      setPhase("publish");
      const funded = await api.fund(createdId, txHash, auth);
      finish(funded.request.id);
    } catch (error) {
      if (createdId && !deposited && auth) await api.cancel(createdId, auth).catch(() => undefined);
      if (error instanceof ApiError && error.code === "unreachable") {
        const local = postOrder({ brandId: place.id, amount, rate: RATE }, qt.sellerLocks);
        setReview(false);
        setPhase(null);
        setStep("posted");
        push(bot(say(`The server isn't reachable, so this lock is only on this device. ${usdt(qt.sellerLocks)} USDC is set aside and ${local.id} is in your tracker.`)));
        toast({ title: "Saved on this device", body: "The order book server didn't answer, so nothing was locked on Arc.", tone: "amber" });
        return;
      }
      setPhase(null);
      const message = error instanceof Error ? error.message : "Couldn't post the order.";
      setLockError(deposited ? `${message} The USDC deposit already went through, so this order was left in place.` : message);
    }
  };

  const finish = (id: string) => {
    setHeld(null);
    setReview(false);
    setPhase(null);
    setStep("posted");
    push(bot(say(`Done. ${usdt(qt.sellerLocks)} USDC is locked and order ${id} is live. A gift-card buyer can buy the ${place?.label ?? "store"} voucher and send you the code. After you redeem it, the USDC releases to them.`), { kind: "posted", orderId: id }));
    toast({ title: "Order is live", body: `${usdt(qt.sellerLocks)} USDC locked · ${id}`, tone: "mint" });
  };

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (step === "place") {
      const hit = PLACES.find((p) => text.toLowerCase() === p.label.toLowerCase());
      if (hit) return pickPlace(hit);
      push(bot(say("Pick Amazon, Flipkart, Myntra, or Blinkit.")));
      return;
    }
    if (step === "amount") {
      if (/^\$?\s*1$/.test(text)) return void pickAmount(ONE_USD_INR);
      const n = Number(text.replace(/[₹,\s$]/g, ""));
      const opt = AMOUNTS.find((a) => a.inr === n);
      if (opt) return void pickAmount(opt.inr);
      push(bot(say("Pick ₹500, ₹1,000, ₹2,000, or $1.")));
    }
  };

  const quick =
    step === "place"
      ? PLACES.map((p) => ({ label: p.label, on: () => pickPlace(p) }))
      : step === "amount" && !review
        ? AMOUNTS.map((a) => ({ label: a.label, on: () => void pickAmount(a.inr) }))
        : step === "posted"
          ? [{ label: "Spend again", on: onRestart }]
          : [];

  return (
    <>
      <div className="hairline relative flex h-[min(760px,calc(100dvh_-_230px))] min-h-[520px] flex-col overflow-hidden rounded-[28px] bg-ink-2/85 backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40" style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(61,220,151,0.14), transparent)" }} />
        <div className="relative flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <span className="relative grid size-10 place-items-center rounded-2xl bg-mint/10 text-mint ring-1 ring-white/10">
            <Bot className="size-5" />
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-mint ring-2 ring-ink-2" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">NetPositive AI</div>
            <div className="truncate text-[11.5px] text-mute">Spend USDC</div>
          </div>
          <button type="button" onClick={onRestart} disabled={!!held} className="grid size-9 place-items-center rounded-full text-mute ring-1 ring-white/10 transition hover:text-fg disabled:opacity-40" aria-label="Start over" title="Start over">
            <RotateCcw className="size-4" />
          </button>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-mute ring-1 ring-white/10 transition hover:text-fg" aria-label="Close assistant" title="Close">
            <X className="size-4" />
          </button>
        </div>

        <div ref={scroller} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6" aria-live="polite">
          {msgs.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className={cx("flex gap-2.5", m.from === "user" && "justify-end")}>
              {m.from === "bot" && (
                <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-mint/10 text-mint">
                  <Sparkles className="size-3.5" />
                </span>
              )}
              <div className={cx("min-w-0 space-y-2.5", m.from === "user" ? "max-w-[80%]" : "w-full max-w-[640px]")}>
                {m.blocks.map((b, i) =>
                  b.kind === "text" ? (
                    <div
                      key={i}
                      className={cx(
                        "w-fit max-w-full rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap",
                        m.from === "user" ? "ml-auto rounded-br-md bg-mint text-ink" : "rounded-tl-md bg-white/[0.045] text-fg/90 ring-1 ring-white/[0.06]",
                      )}
                    >
                      {b.text}
                    </div>
                  ) : b.kind === "posted" ? (
                    <Posted key={i} orderId={b.orderId} />
                  ) : (
                    <OrdersInChat key={i} orders={b.orders} selectedId={b.selectedId} place={b.place} />
                  ),
                )}
              </div>
            </motion.div>
          ))}
          <AnimatePresence>
            {busy && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-full bg-mint/10 text-mint">
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

        <div className="relative border-t border-white/[0.06] p-3 md:p-4">
          {quick.length > 0 && !busy && (
            <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
              {quick.map((q) => (
                <button key={q.label} type="button" onClick={q.on} className="shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] text-fg/85 ring-1 ring-white/12 transition hover:bg-white/[0.06] hover:ring-white/25">
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
            className="flex items-center gap-2 rounded-2xl bg-white/[0.04] p-1.5 pl-4 ring-1 ring-white/10 transition focus-within:ring-mint/45"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={step === "place" ? "Where do you want to spend?" : step === "amount" ? "Type 500, 1000, 2000, or $1" : "This order is set."}
              maxLength={500}
              disabled={step === "matched" || step === "posted"}
              className="h-10 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-dim disabled:cursor-not-allowed"
              aria-label="Message the assistant"
            />
            <button type="submit" disabled={!input.trim() || busy || step === "matched" || step === "posted"} className="grid size-10 place-items-center rounded-xl bg-mint text-ink transition disabled:opacity-30" aria-label="Send">
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </button>
          </form>
        </div>
      </div>

      <ReviewModal
        open={review}
        brandId={place?.id ?? "amazon"}
        title={place ? `${place.label} ${amountLabel(amount ?? 0)} voucher` : "Voucher"}
        amount={amount ?? 0}
        lock={qt.sellerLocks}
        receives={qt.buyerReceives}
        fee={qt.fee}
        phase={phase}
        error={lockError}
        publishOnly={!!held}
        onClose={() => {
          if (phase || held) return;
          setReview(false);
        }}
        onConfirm={() => void confirm()}
      />
    </>
  );
}

async function loadBrand(place: Place, amount: number, book: Order[]) {
  try {
    const { requests } = await api.listOpen(50, place.api);
    const orders = requests.map(toOrder);
    const matches = orders.filter((o) => o.amount === amount);
    return { orders, match: matches[0] ?? null, count: matches.length };
  } catch {
    const orders = book.filter((o) => o.brandId === place.id);
    const matches = orders.filter((o) => o.amount === amount);
    return { orders, match: matches[0] ?? null, count: matches.length };
  }
}

function Posted({ orderId }: { orderId: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-mint/[0.06] p-4 ring-1 ring-mint/30 sm:flex-row sm:items-center">
      <span className="grid size-10 place-items-center rounded-full bg-mint text-ink">
        <Check className="size-5" />
      </span>
      <div className="flex-1">
        <div className="text-[14px] font-medium">Request {orderId} is live</div>
        <div className="text-[12px] text-mute">A gift-card buyer can fill it. Your USDC stays locked until you redeem their voucher.</div>
      </div>
      <Button size="sm" to={`/trade/${orderId}`} icon={<ArrowRight className="size-3.5" />}>
        Open order
      </Button>
    </div>
  );
}

function OrdersInChat({ orders, selectedId, place }: { orders: Order[]; selectedId: string | null; place: string }) {
  if (!orders.length) return <div className="rounded-2xl bg-white/[0.03] px-4 py-3 text-[13px] text-mute ring-1 ring-white/[0.06]">No open orders for {place}.</div>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {orders.map((o) => {
        const on = o.id === selectedId;
        const b = brand(o.brandId);
        return (
          <div key={o.id} className={cx("flex items-center gap-3 rounded-2xl p-3 ring-1", on ? "bg-mint/[0.07] ring-mint/50" : "bg-white/[0.03] ring-white/[0.07]")}>
            <BrandMark id={o.brandId} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">
                {b.name} {inr(o.amount)}
              </span>
              <span className="block font-mono text-[11px] text-dim">{o.id}</span>
            </span>
            {on ? (
              <Button size="sm" to={`/trade/${o.id}`}>
                Open
              </Button>
            ) : (
              <span className="text-[12px] text-mute tabular">{usdt(quote(o.amount, o.rate).sellerLocks)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const LOCK_STEPS: { key: LockPhase; label: string }[] = [
  { key: "create", label: "Create the order" },
  { key: "lock", label: "Lock USDC in escrow" },
  { key: "publish", label: "Post it for a gift-card buyer" },
];

function ReviewModal({
  open,
  brandId,
  title,
  amount,
  lock,
  receives,
  fee,
  phase,
  error,
  publishOnly,
  onClose,
  onConfirm,
}: {
  open: boolean;
  brandId: string;
  title: string;
  amount: number;
  lock: number;
  receives: number;
  fee: number;
  phase: LockPhase | null;
  error: string;
  publishOnly: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const rank = phase ? LOCK_STEPS.findIndex((s) => s.key === phase) : -1;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Review order"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="hairline w-full max-w-[440px] rounded-[26px] bg-ink-2 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold tracking-tight">Review order</h3>
              <button type="button" onClick={onClose} disabled={!!phase || publishOnly} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5 disabled:opacity-40" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
              <BrandMark id={brandId} size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">{title}</div>
                <div className="text-[12px] text-dim">{amount === ONE_USD_INR ? `Test size · ₹${ONE_USD_INR} face value at ₹${RATE.toFixed(2)} / USDC.` : "You spend crypto. A buyer purchases the gift card."}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 rounded-2xl bg-white/[0.02] p-4 text-[13px] ring-1 ring-white/[0.06]">
              <Line k="You lock" v={`${usdt(lock)} USDC`} mint />
              <Line k="Gift-card buyer receives" v={`${usdt(receives)} USDC`} />
              <Line k="Fee" v={`${usdt(fee)} USDC`} />
              <Line k="Rate" v={`₹${RATE.toFixed(2)} / USDC`} />
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-mute">USDC is locked before the order goes live. After you redeem the voucher, it releases to the person who bought the gift card.</p>
            {phase && (
              <div className="mt-4 space-y-2">
                {LOCK_STEPS.map((s, i) => {
                  const done = i < rank;
                  const on = i === rank;
                  return (
                    <div key={s.key} className={cx("flex items-center gap-3 rounded-xl p-3 ring-1", on ? "bg-mint/[0.05] ring-mint/40" : "ring-white/[0.06]")}>
                      <span className={cx("grid size-6 place-items-center rounded-full", done ? "bg-mint text-ink" : on ? "text-mint" : "text-dim")}>
                        {done ? <Check className="size-3.5" /> : on ? <LoaderCircle className="size-4 animate-spin" /> : <Lock className="size-3.5" />}
                      </span>
                      <span className={cx("text-[13.5px]", on || done ? "text-fg" : "text-dim")}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {error && <p className="mt-3 text-[12.5px] leading-relaxed text-rose">{error}</p>}
            {!phase && (
              <Button className="mt-5 w-full" size="lg" onClick={onConfirm} icon={publishOnly ? <ArrowRight className="size-4" /> : <Lock className="size-4" />}>
                {publishOnly ? "Publish order" : "Lock USDC & post order"}
              </Button>
            )}
            {phase && <p className="mt-3 text-center text-[12px] text-dim">Confirm each prompt in your wallet. On a mock server the lock is recorded without a chain transaction.</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Line({ k, v, mint }: { k: string; v: string; mint?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-mute">{k}</span>
      <span className={cx("tabular", mint && "font-semibold text-mint")}>{v}</span>
    </div>
  );
}
