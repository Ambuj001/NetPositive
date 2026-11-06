import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronDown, CreditCard } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AMOUNTS, PLACES, RATE, ONE_USD_INR, ReviewModal, amountLabel } from "../pages/Spend";
import { inr, quote, usdt } from "../lib/engine";
import { useLockOrder } from "../lib/lockOrder";
import { useApp } from "../lib/store";
import { BrandMark, Button, cx } from "./ui";

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
  const [amount, setAmount] = useState<number>(AMOUNTS[1].inr);
  const [limit, setLimit] = useState(RATE);
  const [review, setReview] = useState(false);
  const [calcOpen, setCalcOpen] = useState(true);
  const [savedLocally, setSavedLocally] = useState<string | null>(null);

  const place = PLACES.find((p) => p.id === placeId) ?? PLACES[0];
  const rate = type === "limit" ? limit : RATE;
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= MAX_INR;
  const validRate = rate >= 1 && rate <= 1000;
  const q = quote(validAmount ? amount : 0, validRate ? rate : 1);
  const ready = validAmount && validRate && q.sellerLocks > 0;
  const hint = !validAmount ? `Enter a whole-rupee amount up to ${inr(MAX_INR)}.` : !validRate ? "Enter a rate between ₹1 and ₹1,000 per USDC." : "Preview only · no funds move until you lock";

  const confirm = async () => {
    if (!ready || lock.phase) return;
    const res = await lock.run({ brandApi: place.api, brandId: place.id, amountInr: amount, rate, usdcLock: q.sellerLocks });
    if (!res) return;
    setReview(false);
    if (res.kind === "live") {
      toast({ title: "Order is live", body: `${usdt(q.sellerLocks)} USDC locked · ${res.id}`, tone: "mint" });
      nav(`/trade/${res.id}`);
    } else {
      setSavedLocally(res.order.id);
    }
  };

  return (
    <Ticket title="Create an order">
      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">Prefer to set it up yourself? Pick the store, amount and rate.</p>
      <TypeTabs type={type} setType={setType} />
      <VoucherPicker value={placeId} onChange={(id) => setPlaceId(id as typeof placeId)} />
      <AmountField label="Voucher value" value={amount} onChange={setAmount} />
      {type === "limit" ? <LimitField label="Your rate" value={limit} onChange={setLimit} /> : <p className="mt-3 text-[11.5px] text-dim">Market rate: ₹{RATE.toFixed(2)} / USDC.</p>}

      <Divider />

      <div className="text-[12.5px] text-mute">You get a voucher worth</div>
      <div className="mt-2 flex items-baseline gap-2">
        <motion.span key={amount} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[42px] leading-none font-semibold tracking-tight text-mint tabular">
          {inr(validAmount ? amount : 0)}
        </motion.span>
        <span className="text-[12px] text-dim">{place.label}</span>
      </div>
      <div className="mt-4 space-y-2 border-b border-white/[0.07] pb-3 text-[12.5px]">
        <Line k="Buyer receives" v={`${usdt(q.buyerReceives)} USDC`} />
        <Line k="Seller fee · 1%" v={`${usdt(q.fee)} USDC`} />
      </div>
      <div className="mt-3 flex justify-between text-[13px]">
        <span className="text-mute">Total USDC you lock</span>
        <span className="font-semibold tabular">{usdt(q.sellerLocks)}</span>
      </div>

      <Calc open={calcOpen} setOpen={setCalcOpen}>
        <div className="space-y-1.5 text-[12.5px]">
          <Line k="Voucher value" v={inr(validAmount ? amount : 0)} />
          <Line k="USDC including 1% fee" v={usdt(q.sellerLocks)} />
        </div>
        <Rate value={ready ? amount / q.sellerLocks : null} />
        <p className="mt-1.5 text-[11px] text-dim">Voucher value ÷ total USDC, including the fee.</p>
      </Calc>

      <Button
        className="mt-5 w-full"
        size="lg"
        disabled={!ready}
        onClick={() => {
          if (!address) return openWallet();
          setSavedLocally(null);
          lock.reset();
          setReview(true);
        }}
        icon={<ArrowRight className="size-4" />}
      >
        {address ? "Review order" : "Connect to review"}
      </Button>
      <p className="mt-3 text-center text-[11.5px] text-dim">{hint}</p>
      {savedLocally && (
        <p className="mt-3 rounded-xl bg-amber/10 px-3 py-2 text-center text-[12px] text-amber ring-1 ring-amber/25">
          Saved on this device as {savedLocally}. The server didn't answer, so nothing was locked. <Link to="/track" className="underline">See Track</Link>
        </p>
      )}
      <CardsLink />

      <ReviewModal
        open={review}
        brandId={place.id}
        title={`${place.label} ${amountLabel(amount)} voucher`}
        amount={amount}
        lock={q.sellerLocks}
        receives={q.buyerReceives}
        fee={q.fee}
        rate={rate}
        phase={lock.phase}
        error={lock.error}
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

function Ticket({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hairline relative overflow-hidden rounded-[26px] bg-ink-2/85 p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32" style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(61,220,151,0.12), transparent)" }} />
      <div className="relative flex items-center justify-between">
        <h2 className="font-display text-[22px] font-semibold tracking-tight">{title}</h2>
        <span className="grid size-8 place-items-center rounded-full bg-[#2775ca] font-display text-[13px] font-bold text-white" aria-hidden>
          $
        </span>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function TypeTabs({ type, setType }: { type: OrderType; setType: (t: OrderType) => void }) {
  return (
    <div className="mt-5 grid grid-cols-2 rounded-2xl bg-white/[0.03] p-1 ring-1 ring-white/[0.07]" role="tablist" aria-label="Order type">
      {(["market", "limit"] as const).map((t) => (
        <button key={t} type="button" role="tab" aria-selected={type === t} onClick={() => setType(t)} className={cx("relative h-9 rounded-xl text-[13px] capitalize transition", type === t ? "text-fg" : "text-mute hover:text-fg")}>
          {type === t && <motion.span layoutId="type-mint" className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10" />}
          <span className="relative">{t}</span>
        </button>
      ))}
    </div>
  );
}

function VoucherPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = PLACES.find((p) => p.id === value) ?? PLACES[0];
  return (
    <div className="relative mt-5">
      <div className="mb-2 text-[12.5px] text-mute">Store</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-12 w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-3 text-left ring-1 ring-white/10 transition hover:ring-white/20"
      >
        <BrandMark id={current.id} size={28} />
        <span className="flex-1 text-[14px]">{current.label}</span>
        <ChevronDown className={cx("size-4 text-dim transition", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="hairline absolute inset-x-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-2xl bg-ink-3 p-1.5 shadow-2xl">
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
                  className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition hover:bg-white/[0.05]", p.id === value && "bg-mint/[0.08]")}
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
      <div className="mb-2 text-[12.5px] text-mute">{label}</div>
      <label className="flex items-baseline gap-2 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/10 transition focus-within:ring-mint/45">
        <span className="font-display text-3xl text-mute">₹</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_INR}
          value={value || ""}
          onChange={(e) => onChange(Math.max(0, Math.min(MAX_INR, parseInt(e.target.value || "0", 10) || 0)))}
          className="w-full min-w-0 bg-transparent font-display text-[40px] leading-none font-semibold tracking-tight outline-none tabular"
          aria-label={`${label} in rupees`}
        />
        <span className="text-[12px] text-dim">INR</span>
      </label>
      <div className="mt-2.5 grid grid-cols-4 gap-2">
        {AMOUNTS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onChange(a.inr)}
            className={cx("h-9 rounded-xl text-[12.5px] ring-1 transition tabular", value === a.inr ? "bg-mint/10 text-mint ring-mint/40" : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20")}
            title={a.inr === ONE_USD_INR ? `$1 test voucher (${inr(ONE_USD_INR)})` : undefined}
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
    <div className="mt-5 flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2.5 ring-1 ring-white/[0.07]">
      <span className="text-[12.5px] text-mute">{label}</span>
      <span className="flex items-center gap-1 text-[14px] tabular">
        ₹
        <input type="number" step="0.1" value={value || ""} onChange={(e) => onChange(Number(e.target.value) || 0)} className="w-16 bg-transparent text-right outline-none" aria-label={`${label}, rupees per USDC`} />
        <span className="text-[11px] text-dim">/ USDC</span>
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div className="relative my-6 h-px bg-white/[0.07]">
      <span className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink-2 text-dim ring-1 ring-white/10">
        <ArrowDownLeft className="size-3.5" />
      </span>
    </div>
  );
}

function Calc({ open, setOpen, children }: { open: boolean; setOpen: (o: boolean) => void; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.07]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium">
        Net effective rate
        <ChevronDown className={cx("size-4 text-dim transition", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Rate({ value }: { value: number | null }) {
  return (
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className="font-display text-[30px] font-semibold tracking-tight text-mint tabular">{value === null ? "—" : `₹${value.toFixed(2)}`}</span>
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
    <Link to="/cards" className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[13px] text-mute transition hover:text-fg">
      <span className="flex items-center gap-2.5">
        <CreditCard className="size-4" /> My cards
      </span>
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}
