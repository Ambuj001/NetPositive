import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bot, Check, LoaderCircle, Lock, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BuyerList } from "../components/BuyRequest";
import { BrandMark, Button, Callout, DUR, Dialog, EASE, Pill, Stepper, cx } from "../components/ui";
import { api, type BuyIntent } from "../lib/api";
import { ARC } from "../lib/chain";
import type { Order } from "../lib/data";
import { brand } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";
import { MOCK_NOTE } from "../lib/escrowFlow";
import { useLockOrder, type LockPhase, type LockResult, type ServerTerms } from "../lib/lockOrder";
import { toOrder } from "../lib/orderbook";
import { suggestionsFor } from "../lib/suggestions";
import { useMarketRate } from "../lib/rates";
import { useApp } from "../lib/store";
import { checkAmount, feePercent, limitsLine, toBaseUnits } from "../lib/terms";
import { useTerms } from "../lib/useTerms";

/** The smallest quick-pick order: a ₹250 voucher. */
export const SMALL_INR = 250;
export const PLACES = [
  { id: "amazon", api: "amazon", label: "Amazon" },
  { id: "flipkart", api: "flipkart", label: "Flipkart" },
  { id: "myntra", api: "myntra", label: "Myntra" },
  { id: "blinkit", api: "blinkit", label: "Blinkit" },
] as const;
export type Place = (typeof PLACES)[number];
export const AMOUNTS = [
  { inr: SMALL_INR, label: "₹250" },
  { inr: 500, label: "₹500" },
  { inr: 1000, label: "₹1,000" },
  { inr: 2000, label: "₹2,000" },
] as const;

export function amountLabel(n: number) {
  return AMOUNTS.find((a) => a.inr === n)?.label ?? inr(n);
}

type Step = "place" | "amount" | "matched" | "posted";
type Block =
  | { kind: "text"; text: string }
  | { kind: "orders"; orders: Order[]; selectedId: string | null; place: string }
  | { kind: "posted"; orderId: string }
  | { kind: "buyers"; intents: BuyIntent[]; amount: number; place: string }
  /** "Create new order" button. Carries the amount it was offered for, so a later pick can't change what it opens. */
  | { kind: "create"; amount: number };
type Msg = { id: number; from: "bot" | "user"; blocks: Block[] };

let nextId = 1;
const say = (text: string): Block => ({ kind: "text", text });
const bot = (...blocks: Block[]): Msg => ({ id: nextId++, from: "bot", blocks });
const user = (text: string): Msg => ({ id: nextId++, from: "user", blocks: [say(text)] });

const greeting = () => [bot(say("Where do you want to spend crypto today?"))];

export function SpendChat({ book, onRestart, onClose }: { book: Order[]; onRestart: () => void; onClose: () => void }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const lock = useLockOrder();
  const [msgs, setMsgs] = useState<Msg[]>(greeting);
  const [step, setStep] = useState<Step>("place");
  const [place, setPlace] = useState<Place | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const push = (...m: Msg[]) => setMsgs((all) => [...all, ...m]);
  // Priced at the live market rate from the backend's rates API, with the fee the escrow charges right now.
  const market = useMarketRate();
  const { terms, feeBps, estimated } = useTerms();
  const qt = quote(amount ?? 0, market.rate ?? 0, feeBps);
  const blocked = terms && amount && market.rate ? checkAmount(terms, toBaseUnits(qt.buyerReceives)) : null;

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
      const [{ orders, match, count }, buyers] = await Promise.all([loadBrand(place, n, book), loadBuyers(place, n)]);
      // Buyers who asked for exactly this amount (this store, or no store in particular).
      const buyerMsg = () => (buyers.length ? [bot(say(`${buyers.length === 1 ? "A USDC buyer is" : `${buyers.length} USDC buyers are`} waiting for a ${label} ${place.label} voucher.`), { kind: "buyers" as const, intents: buyers, amount: n, place: place.label })] : []);
      if (match) {
        const extra = count > 1 ? ` I picked the newest of ${count}.` : "";
        push(
          bot(
            say(`There's already a ${place.label} ${label} order in the book. I've selected it, so there's no need to lock USDC again.${extra}`),
            { kind: "orders", orders, selectedId: match.id, place: place.label },
          ),
        );
        push(...buyerMsg());
        setStep("matched");
        return;
      }
      push(
        bot(
          say(`No ${place.label} ${label} order is open.`),
          { kind: "orders", orders, selectedId: null, place: place.label },
        ),
      );
      // Show who is already waiting first. Creating an order is the next step, and it is the user's click, not automatic.
      push(...buyerMsg());
      push(bot({ kind: "create", amount: n }));
    } finally {
      setBusy(false);
    }
  };

  /** Start a new order for this store at this amount: opens the review. Nothing is locked until they confirm there. */
  const startOrder = (n: number) => {
    setAmount(n);
    if (!market.rate) {
      push(bot(say(market.loading ? "The live rate is still loading. Try again in a moment." : "The live market rate isn't available right now, so I can't price a new order. Try again shortly, or set your own rate with a Limit order in the panel on the right.")));
      return;
    }
    if (terms) {
      const check = checkAmount(terms, toBaseUnits(quote(n, market.rate, feeBps).buyerReceives));
      if (!check.ok) {
        push(bot(say(check.text)));
        return;
      }
    }
    lock.reset();
    setReview(true);
  };

  const confirm = async () => {
    if (!amount || !place || lock.phase || !market.rate || (blocked && !blocked.ok && !lock.held)) return;
    const res = await lock.run({ brandApi: place.api, amountInr: amount, usdcReceives: qt.buyerReceives, usdcTotal: qt.sellerLocks });
    if (!res) return;
    finish(res);
  };

  const finish = ({ id, mock, total }: LockResult) => {
    setReview(false);
    setStep("posted");
    if (mock) {
      // Development server with the mock escrow: the order exists, but no USDC moved. Say exactly that.
      push(bot(say(`Demo server: order ${id} was recorded, but the escrow is simulated, so no USDC was locked.`), { kind: "posted", orderId: id }));
      toast({ title: "Demo order recorded", body: MOCK_NOTE, tone: "amber" });
    } else {
      push(bot(say(`Done. ${total} USDC is locked in escrow and order ${id} is live. A gift-card buyer can buy the ${place?.label ?? "store"} voucher and send you the code. After you confirm it works, you release the USDC to them from your wallet.`), { kind: "posted", orderId: id }));
      toast({ title: "Order is live", body: `${total} USDC locked · ${id}`, tone: "mint" });
    }
    // Straight to this order's tracking page.
    nav(`/track?id=${encodeURIComponent(id)}`);
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
      const n = Number(text.replace(/[₹,\s$]/g, ""));
      const opt = AMOUNTS.find((a) => a.inr === n);
      if (opt) return void pickAmount(opt.inr);
      push(bot(say("Pick ₹250, ₹500, ₹1,000, or ₹2,000.")));
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
      <div className="panel relative flex h-[min(660px,calc(100dvh_-_190px))] min-h-[440px] flex-col overflow-hidden">
        <div className="relative flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <span className="relative grid size-9 place-items-center rounded-xl bg-brand text-white">
            <Bot className="size-[18px]" />
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-pos ring-2 ring-surface" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold tracking-[-0.01em]">NetPositive AI</div>
            <div className="truncate text-[12px] text-mute">Spend USDC</div>
          </div>
          <button type="button" onClick={onRestart} disabled={!!lock.held} className="grid size-9 place-items-center rounded-full text-mute transition-colors hover:bg-sunken hover:text-fg disabled:opacity-40" aria-label="Start over" title="Start over">
            <RotateCcw className="size-4" />
          </button>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-mute transition-colors hover:bg-sunken hover:text-fg" aria-label="Close assistant" title="Close">
            <X className="size-4" />
          </button>
        </div>

        <div ref={scroller} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6" aria-live="polite">
          {msgs.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE }} className={cx("flex gap-2.5", m.from === "user" && "justify-end")}>
              {m.from === "bot" && (
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
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
                        m.from === "user" ? "ml-auto rounded-br-md bg-brand text-white" : "rounded-tl-md bg-sunken text-fg",
                      )}
                    >
                      {b.text}
                    </div>
                  ) : b.kind === "buyers" ? (
                    <BuyerList key={i} intents={b.intents} amount={b.amount} place={b.place} onPick={() => startOrder(b.amount)} pickDisabled={step === "posted" || step === "matched" || review || busy} />
                  ) : b.kind === "create" ? (
                    <CreateOrderPrompt
                      key={i}
                      amount={b.amount}
                      place={place?.label ?? "this store"}
                      disabled={step === "posted" || review || busy}
                      onCreate={() => startOrder(b.amount)}
                    />
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
                <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-brand-ink">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="flex gap-1 rounded-2xl rounded-tl-md bg-sunken px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} className="size-1.5 rounded-full bg-mute" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                  ))}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative border-t border-line p-3 md:p-4">
          {quick.length > 0 && !busy && (
            <div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">
              {quick.map((q) => (
                <button key={q.label} type="button" onClick={q.on} className="h-8 shrink-0 rounded-full px-3.5 text-[12.5px] text-fg ring-1 ring-line-2 transition-colors duration-200 hover:bg-sunken">
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
            className="field flex items-center gap-2 rounded-full p-1 pl-4"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={step === "place" ? "Where do you want to spend?" : step === "amount" ? "Type 250, 500, 1000, or 2000" : "This order is set."}
              maxLength={500}
              disabled={step === "matched" || step === "posted"}
              className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim disabled:cursor-not-allowed"
              aria-label="Message the assistant"
            />
            <button type="submit" disabled={!input.trim() || busy || step === "matched" || step === "posted"} className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white transition-opacity duration-200 hover:bg-brand-2 disabled:opacity-30" aria-label="Send">
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
        rate={market.rate}
        feeBps={feeBps}
        feeEstimated={estimated}
        limits={terms ? limitsLine(terms) : null}
        blocked={blocked && !blocked.ok ? blocked.text : null}
        phase={lock.phase}
        error={lock.error}
        server={lock.terms}
        publishOnly={!!lock.held}
        onClose={() => {
          if (lock.phase || lock.held) return;
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
    const orders = suggestionsFor(requests.map(toOrder));
    const matches = orders.filter((o) => o.amount === amount);
    return { orders, match: matches[0] ?? null, count: matches.length };
  } catch {
    const orders = suggestionsFor(book).filter((o) => o.brandId === place.id);
    const matches = orders.filter((o) => o.amount === amount);
    return { orders, match: matches[0] ?? null, count: matches.length };
  }
}

/** Open buy requests for this amount and store (or no store). Offline or failing just means no recommendations. */
async function loadBuyers(place: Place, amount: number) {
  try {
    const { intents } = await api.matchBuyIntents(amount, place.api);
    return intents;
  } catch {
    return [];
  }
}

function CreateOrderPrompt({ amount, place, disabled, onCreate }: { amount: number; place: string; disabled: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-line sm:flex-row sm:items-center">
      <div className="flex-1 text-[13px] leading-relaxed text-mute">
        Nothing fits? Create a new {place} {amountLabel(amount)} order. You'll review it before any USDC is locked.
      </div>
      <Button size="sm" disabled={disabled} onClick={onCreate} icon={<ArrowRight className="size-3.5" />}>
        Create new order
      </Button>
    </div>
  );
}

function Posted({ orderId }: { orderId: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-brand-soft p-4 sm:flex-row sm:items-center">
      <span className="grid size-10 place-items-center rounded-full bg-brand text-white">
        <Check className="size-5" />
      </span>
      <div className="flex-1">
        <div className="text-[14px] font-medium">Request {orderId} is live</div>
        <div className="text-[12.5px] text-mute">A gift-card buyer can fill it. Your USDC stays locked until you redeem their voucher.</div>
      </div>
      <Button size="sm" to={`/track?id=${encodeURIComponent(orderId)}`} icon={<ArrowRight className="size-3.5" />}>
        Track order
      </Button>
    </div>
  );
}

function OrdersInChat({ orders, selectedId, place }: { orders: Order[]; selectedId: string | null; place: string }) {
  if (!orders.length) return <div className="rounded-2xl px-4 py-3 text-[13px] text-mute ring-1 ring-line">No open orders for {place}.</div>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {orders.map((o) => {
        const on = o.id === selectedId;
        const b = brand(o.brandId);
        return (
          <div key={o.id} className={cx("flex items-center gap-3 rounded-2xl p-3 ring-1", on ? "bg-brand-soft ring-brand/40" : "ring-line")}>
            <BrandMark id={o.brandId} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">
                {b.name} {inr(o.amount)}
              </span>
              <span className="block truncate font-mono text-[11px] text-dim" title={o.id}>{o.id}</span>
            </span>
            {o.demo ? (
              <Pill tone="amber">demo</Pill>
            ) : on ? (
              <Button size="sm" to={`/track?id=${encodeURIComponent(o.id)}`}>
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

export function ReviewModal({
  open,
  brandId,
  title,
  lock,
  receives,
  fee,
  phase,
  error,
  server,
  publishOnly,
  rate,
  feeBps,
  feeEstimated,
  limits,
  blocked,
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
  /** The server's own amount, fee and total for this order, once it has answered. Shown before the wallet prompt. */
  server?: ServerTerms | null;
  publishOnly: boolean;
  /** INR per USDC shown on the order. Null when no rate is available: the order can't be priced or locked. */
  rate: number | null;
  /** The escrow's fee in basis points, from the server's terms. */
  feeBps: number;
  /** True while the terms are loading or unreachable: the fee shown is the usual one, not confirmed. */
  feeEstimated: boolean;
  /** "Orders from 1 to 500 USDC.", when the terms are known. */
  limits?: string | null;
  /** Why this order can't be locked (paused, outside the limits, over the launch cap). Hides the lock button. */
  blocked?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const rank = phase ? LOCK_STEPS.findIndex((s) => s.key === phase) : -1;
  const working = !!phase;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!working && !publishOnly}
      title="Review order"
      description="Nothing is locked until you confirm here and in your wallet."
      testId="review-order"
      footer={
        working ? (
          <p className="w-full text-center text-[12.5px] text-mute">Confirm each prompt in your wallet: one approval, then the deposit.</p>
        ) : publishOnly || (!!rate && !blocked) ? (
          <Button className="w-full" size="lg" onClick={onConfirm} icon={publishOnly ? <ArrowRight className="size-4" /> : <Lock className="size-4" />}>
            {publishOnly ? "Publish order" : "Lock USDC & post order"}
          </Button>
        ) : (
          <Button className="w-full" variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line">
        <BrandMark id={brandId} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-medium">{title}</div>
          <div className="text-[12.5px] text-mute">You spend USDC. A USDC buyer purchases the gift card for you.</div>
        </div>
      </div>
      <dl className="well mt-3 divide-y divide-line px-3.5 text-[13.5px]">
        <Line k={server ? "You lock (confirmed by the server)" : "You lock (estimate)"} v={`${server ? server.total : usdt(lock)} USDC`} strong />
        <Line k="Gift-card buyer receives" v={`${server ? server.receives : usdt(receives)} USDC`} />
        <Line k={server ? "Fee" : `Fee · ${feePercent(feeBps)}${feeEstimated ? " (estimated)" : ""}`} v={`${server ? server.fee : usdt(fee)} USDC`} />
        <Line k="Rate" v={rate ? `₹${rate.toFixed(2)} / USDC` : "Unavailable"} />
      </dl>
      <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
        {server
          ? `Your wallet will ask to approve and deposit exactly ${server.total} USDC on ${ARC.name}. If it shows a different amount, reject it.`
          : "The server sets the final fee and total. They are shown here before your wallet asks for anything, and the order stops if the total differs from this estimate by more than a cent."}{" "}
        After you confirm the voucher works, you release the USDC to the person who bought the gift card.
      </p>
      {limits && !server && <p className="mt-2 text-[12px] text-dim">{limits}</p>}
      <AnimatePresence initial={false}>
        {working && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.slow, ease: EASE }} className="overflow-hidden">
            <Stepper className="mt-4" steps={LOCK_STEPS.map((st, i) => ({ key: st.key, label: st.label, state: i < rank ? "done" : i === rank ? "now" : "todo" }))} />
          </motion.div>
        )}
      </AnimatePresence>
      {!rate && !publishOnly && (
        <Callout role="alert" tone="amber" className="mt-3">
          The live market rate isn't available right now, so this order can't be priced. Try again shortly.
        </Callout>
      )}
      {blocked && !publishOnly && (
        <Callout role="alert" tone="amber" className="mt-3">
          {blocked}
        </Callout>
      )}
      {error && (
        <Callout role="alert" tone="rose" className="mt-3">
          {error}
        </Callout>
      )}
    </Dialog>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-mute">{k}</dt>
      <dd className={cx("text-right tabular", strong && "font-semibold text-fg")}>{v}</dd>
    </div>
  );
}
