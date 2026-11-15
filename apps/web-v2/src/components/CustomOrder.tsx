import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, ChevronDown, CreditCard } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AMOUNTS, PLACES, ReviewModal, amountLabel } from "../pages/Spend";
import { useMarketRate } from "../lib/rates";
import { inr, quote, usdt } from "../lib/engine";
import { MOCK_NOTE } from "../lib/escrowFlow";
import { useLockOrder } from "../lib/lockOrder";
import { useApp } from "../lib/store";
import { checkAmount, feePercent, limitsLine, toBaseUnits } from "../lib/terms";
import { useTerms } from "../lib/useTerms";
import { RecommendedBuyers } from "./BuyRequest";
import { BrandMark, Button, DUR, EASE, Segmented, cx } from "./ui";

/** Largest voucher the order API accepts. */
const MAX_INR = 100_000;
type OrderType = "market" | "limit";

/**
 * Side panel on the Pay-with-crypto tab: build an order yourself (store, amount, rate) instead of going through the chat.
 * It posts through the same sign-in, World ID, wallet-lock and publish steps as the chat (see lib/lockOrder.ts).
 */
export function CustomOrder() {
  const { address, openWallet } = useApp();
  const { toast } = useApp();
  const nav = useNavigate();
  const lock = useLockOrder();
  const [type, setType] = useState<OrderType>("market");
  const [placeId, setPlaceId] = useState<(typeof PLACES)[number]["id"]>(PLACES[0].id);
  const [amount, setAmount] = useState<number>(500);
  const market = useMarketRate();
  const { terms, feeBps, estimated } = useTerms();
  // Starts empty and follows the live rate until the person types their own.
  const [typedLimit, setLimit] = useState<number | null>(null);
  const limit = typedLimit ?? market.rate ?? 0;
  const [review, setReview] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);

  const place = PLACES.find((p) => p.id === placeId) ?? PLACES[0];
  const rate = type === "limit" ? limit : market.rate;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_INR;
  const validRate = rate !== null && rate >= 1 && rate <= 1000;
  const q = quote(validAmount && validRate ? amount : 0, validRate ? rate : 0, feeBps);
  // The escrow's own limits (from the server): outside them, paused or over the launch cap is said here, not in the wallet.
  const check = terms && validAmount && validRate ? checkAmount(terms, toBaseUnits(q.buyerReceives)) : terms?.paused ? checkAmount(terms, 0n) : null;
  const blocked = check && !check.ok ? check.text : null;
  const ready = validAmount && validRate && q.sellerLocks > 0 && !blocked;
  const noMarketRate = type === "market" && market.rate === null;
  const feeLabel = `${feePercent(feeBps)}${estimated ? " (estimated)" : ""}`;
  const hint = !validAmount
    ? `Enter a whole-rupee amount up to ${inr(MAX_INR)}.`
    : noMarketRate
      ? market.loading
        ? "Loading the live rate…"
        : "The live rate isn't available. Switch to Limit and enter your own rate."
      : !validRate
        ? "Enter a rate between ₹1 and ₹1,000 per USDC."
        : blocked
          ? blocked
          : "Preview only · no funds move until you lock";

  /** Open the review for the store and amount entered. Used by the button and by picking a recommended buyer. */
  const startReview = () => {
    if (!address) return openWallet();
    lock.reset();
    setReview(true);
  };

  const confirm = async () => {
    if (!ready || lock.phase) return;
    const res = await lock.run({ brandApi: place.api, amountInr: amount, usdcReceives: q.buyerReceives, usdcTotal: q.sellerLocks });
    if (!res) return;
    setReview(false);
    // A development server with the mock escrow records the order without moving USDC. Say so instead of "locked".
    toast(res.mock ? { title: "Demo order recorded", body: MOCK_NOTE, tone: "amber" } : { title: "Order is live", body: `${res.total} USDC locked · ${res.id}`, tone: "mint" });
    nav(`/track?id=${encodeURIComponent(res.id)}`);
  };

  return (
    <Ticket title="Create an order" sub="Pick the store, amount and rate. You review everything before any USDC is locked." right={<TypeTabs type={type} setType={setType} />}>
      {/* Inputs on the left, the live summary and the button on the right (stacked on narrow screens). */}
      <div className="mt-5 grid gap-x-8 gap-y-6 md:grid-cols-2">
        <div className="min-w-0">
          <VoucherPicker value={placeId} onChange={(id) => setPlaceId(id as typeof placeId)} />
          <AmountField label="Voucher value" value={amount} onChange={setAmount} />
          {type === "limit" ? (
            <LimitField label="Your rate" value={limit} onChange={setLimit} />
          ) : (
            <p className={cx("mt-3 text-[12px] tabular", market.rate === null && !market.loading ? "text-amber-ink" : "text-mute")}>
              {market.rate !== null ? `Live P2P rate: ₹${market.rate.toFixed(2)} / USDC.` : market.loading ? "Loading the live rate…" : "The live rate isn't available right now. Use a Limit order to set your own rate."}
            </p>
          )}
          {terms && <p className="mt-1 text-[12px] text-dim">{limitsLine(terms)}</p>}
        </div>

        <div className="well min-w-0 self-start p-4 sm:p-5">
          <div className="text-[12.5px] text-mute">You get a voucher worth</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <motion.span key={amount} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE }} className="font-display text-[34px] leading-none font-semibold tracking-tight text-fg tabular">
              {inr(validAmount ? amount : 0)}
            </motion.span>
            <span className="text-[12.5px] text-mute">{place.label}</span>
          </div>
          <div className="mt-4 space-y-2 border-b border-line pb-3 text-[13px]">
            <Line k="USDC buyer receives" v={`${usdt(q.buyerReceives)} USDC`} />
            <Line k={`Fee · ${feeLabel}`} v={`${usdt(q.fee)} USDC`} />
            <Line k="Effective rate" v={ready ? `₹${(amount / q.sellerLocks).toFixed(2)} / USDC` : "—"} />
          </div>
          <div className="mt-3 flex items-baseline justify-between text-[14px]">
            <span className="text-mute">Total USDC you lock</span>
            <span className="text-[17px] font-semibold tabular">{usdt(q.sellerLocks)}</span>
          </div>
          <Button className="mt-4 w-full" size="md" disabled={!ready} onClick={startReview} icon={<ArrowRight className="size-4" />}>
            {address ? "Review order" : "Connect to review"}
          </Button>
          <p className={cx("mt-2 text-center text-[12px]", blocked || noMarketRate ? "text-amber-ink" : "text-dim")} role={blocked ? "alert" : undefined}>{hint}</p>
          <Calc open={calcOpen} setOpen={setCalcOpen}>
            <div className="space-y-1.5 text-[12.5px]">
              <Line k="Voucher value" v={inr(validAmount ? amount : 0)} />
              <Line k={`USDC including ${feePercent(feeBps)} fee`} v={usdt(q.sellerLocks)} />
            </div>
            <Rate value={ready ? amount / q.sellerLocks : null} />
            <p className="mt-1.5 text-[11px] text-dim">Voucher value ÷ total USDC, including the fee.</p>
          </Calc>
        </div>
      </div>

      {/* Buy requests (Firestore `buyIntents`) that match the store and amount entered above: same amount, and the same
          voucher or no voucher. It follows the inputs live. */}
      <RecommendedBuyers amount={validAmount ? amount : 0} brandId={place.api} brandName={place.label} className="mt-6" onPick={startReview} pickDisabled={!ready || !!lock.phase} />
      <CardsLink />

      <ReviewModal
        open={review}
        brandId={place.id}
        title={`${place.label} ${amountLabel(amount)} voucher`}
        amount={amount}
        lock={q.sellerLocks}
        receives={q.buyerReceives}
        fee={q.fee}
        rate={validRate ? rate : null}
        feeBps={feeBps}
        feeEstimated={estimated}
        limits={terms ? limitsLine(terms) : null}
        blocked={blocked}
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
    </Ticket>
  );
}

/* ------------------------------------------------------------ pieces (design from the Trade dashboard) */

function Ticket({ title, sub, right, children }: { title: string; sub: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="mt-1 max-w-[52ch] text-[13px] leading-relaxed text-mute">{sub}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function TypeTabs({ type, setType }: { type: OrderType; setType: (t: OrderType) => void }) {
  return (
    <Segmented
      id="order-type"
      label="Order type"
      value={type}
      onChange={setType}
      options={[
        { value: "market", label: "Market" },
        { value: "limit", label: "Limit" },
      ]}
    />
  );
}

function VoucherPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = PLACES.find((p) => p.id === value) ?? PLACES[0];
  const root = useRef<HTMLDivElement>(null);
  // Closes on a click outside or Escape, like every other menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={root}>
      <div className="mb-1.5 text-[12.5px] text-mute">Store</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="field flex h-11 items-center gap-3 px-3 text-left"
      >
        <BrandMark id={current.id} size={26} />
        <span className="flex-1 text-[14px]">{current.label}</span>
        <ChevronDown className={cx("size-4 text-dim transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: DUR.fast, ease: EASE }} className="panel absolute inset-x-0 top-full z-20 mt-1.5 max-h-64 overflow-y-auto p-1.5 shadow-[0_20px_50px_-16px_rgba(12,13,15,0.3)]">
            {PLACES.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-sunken", p.id === value && "bg-brand-soft text-brand-ink")}
                >
                  <BrandMark id={p.id} size={24} />
                  <span className="flex-1">{p.label}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function AmountField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 text-[12.5px] text-mute">{label}</div>
      <label className="field flex h-14 items-center gap-2 px-4">
        <span className="font-display text-[22px] text-mute">₹</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_INR}
          value={value || ""}
          onChange={(e) => onChange(Math.max(0, Math.min(MAX_INR, parseInt(e.target.value || "0", 10) || 0)))}
          className="w-full min-w-0 bg-transparent font-display text-[28px] leading-none font-semibold tracking-tight outline-none tabular"
          aria-label={`${label} in rupees`}
        />
        <span className="text-[12px] text-dim">INR</span>
      </label>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {AMOUNTS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onChange(a.inr)}
            className={cx("h-9 rounded-full text-[12.5px] ring-1 transition-colors duration-200 tabular", value === a.inr ? "bg-brand-soft text-brand-ink ring-brand/40" : "text-mute ring-line-2 hover:bg-sunken hover:text-fg")}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LimitField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="field mt-3 flex h-11 items-center justify-between px-3.5">
      <span className="text-[13px] text-mute">{label}</span>
      <span className="flex items-center gap-1 text-[14px] tabular">
        ₹
        <input type="number" step="0.1" value={value || ""} onChange={(e) => onChange(Number(e.target.value) || 0)} className="w-20 bg-transparent text-right font-medium outline-none" aria-label={`${label}, rupees per USDC`} />
        <span className="text-[11.5px] text-dim">/ USDC</span>
      </span>
    </label>
  );
}

function Calc({ open, setOpen, children }: { open: boolean; setOpen: (o: boolean) => void; children: ReactNode }) {
  return (
    <section className="mt-3 border-t border-line">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between pt-3 text-[12.5px] text-mute transition-colors hover:text-fg">
        How the rate is worked out
        <ChevronDown className={cx("size-4 text-dim transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: DUR.base, ease: EASE }} className="overflow-hidden">
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Rate({ value }: { value: number | null }) {
  return (
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className="font-display text-[26px] font-semibold tracking-tight text-fg tabular">{value === null ? "—" : `₹${value.toFixed(2)}`}</span>
      <span className="text-[11px] text-dim">/ USDC</span>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{k}</span>
      <span className="tabular">{v}</span>
    </div>
  );
}

function CardsLink() {
  return (
    <Link to="/cards" className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[13px] text-mute transition-colors hover:text-fg">
      <span className="flex items-center gap-2.5">
        <CreditCard className="size-4" /> My cards
      </span>
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}
