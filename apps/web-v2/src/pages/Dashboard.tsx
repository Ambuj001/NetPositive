import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Bot, ChevronDown, CreditCard, Lock, ShieldCheck, Sparkles, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Assistant from "../components/Assistant";
import { Aurora, BrandMark, Button, Pill, cx } from "../components/ui";
import { userIdFor } from "../lib/chatbot";
import { BRANDS, brand, type Order } from "../lib/data";
import { bestReward, inr, quote, round2, usdt } from "../lib/engine";
import { useOrderBook } from "../lib/orderbook";
import { useApp } from "../lib/store";
import { ReviewModal } from "../components/BuyReview";

type Mode = "buy" | "sell";
type OrderType = "market" | "limit";

const PRESETS = [5000, 10000, 25000];
const MARKET_RATE = 90;

/**
 * Whole vouchers only, never over budget. Market fills from the best rate up to `slippage`% above it;
 * limit fills only orders at or below the max INR/USDC rate.
 */
function previewBuy(orders: Order[], budget: number, type: OrderType, limit: number, slippagePct: number) {
  const empty = { fills: [] as Order[], spend: 0, receive: 0 };
  if (!(budget > 0) || (type === "limit" && !(limit > 0))) return empty;
  const pool = orders
    .filter((o) => o.seller !== "you" && o.amount > 0 && o.rate > 0 && (type === "market" || o.rate <= limit))
    .sort((a, b) => a.rate - b.rate || b.amount - a.amount);
  const best = pool.find((o) => o.amount <= budget)?.rate;
  const eligible = type === "market" && best !== undefined ? pool.filter((o) => o.rate <= best * (1 + slippagePct / 100)) : pool;
  // Prefer one voucher that uses the whole budget, then fill greedily.
  const exact = eligible.find((o) => o.amount === budget);
  const fills: Order[] = [];
  let left = budget;
  for (const o of exact ? [exact] : eligible) {
    if (o.amount <= left) {
      fills.push(o);
      left -= o.amount;
    }
  }
  return { fills, spend: budget - left, receive: round2(fills.reduce((s, o) => s + quote(o.amount, o.rate).buyerReceives, 0)) };
}

export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "sell" ? "sell" : "buy";
  const setMode = (m: Mode) => setParams(m === "sell" ? { mode: "sell" } : {}, { replace: true });
  const { fullAddress, myOrders } = useApp();
  const [chatOpen, setChatOpen] = useState(true);
  const [chatKey, setChatKey] = useState(0);
  const active = myOrders.filter((o) => !["released", "refunded", "cancelled"].includes(o.status)).length;

  return (
    <div className="relative pt-28 pb-12">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-gradient font-display text-4xl font-semibold tracking-[-0.03em]">Trade</h1>
            <Pill tone="amber">preview</Pill>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-mute">India · INR</span>
            <Link to="/track" className="flex h-10 items-center gap-2.5 rounded-full bg-white/[0.03] pr-1.5 pl-4 text-[13px] ring-1 ring-white/10 transition hover:bg-white/[0.06]">
              My orders <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/[0.07] px-2 font-mono text-[11px] text-mute">{active}</span>
            </Link>
          </div>
        </div>

        {/* mode switch */}
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <div className="flex rounded-full bg-white/[0.03] p-1 ring-1 ring-white/[0.08]" role="tablist" aria-label="Trade mode">
            {(
              [
                ["buy", "Buy", <ArrowDownLeft key="i" className="size-3.5" />],
                ["sell", "Pay with crypto", <ArrowUpRight key="i" className="size-3.5" />],
              ] as const
            ).map(([m, label, icon]) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cx("relative flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition", mode === m ? "text-ink" : "text-mute hover:text-fg")}
              >
                {mode === m && <motion.span layoutId="trade-mode" className={cx("absolute inset-0 rounded-full", m === "buy" ? "bg-amber" : "bg-mint")} transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                <span className="relative flex items-center gap-2">
                  {icon} {label}
                </span>
              </button>
            ))}
          </div>
          <span className="text-[13.5px] text-mute">{mode === "buy" ? "Buy USDC. Keep your card rewards." : "Choose a voucher. Pay with USDC."}</span>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* chat */}
          <div className="min-w-0">
            {chatOpen ? (
              <Assistant
                key={`${mode}-${chatKey}-${fullAddress}`}
                mode={mode === "buy" ? "buy" : "spend"}
                userId={userIdFor(fullAddress)}
                onRestart={() => setChatKey((k) => k + 1)}
                onClose={() => setChatOpen(false)}
              />
            ) : (
              <button
                onClick={() => setChatOpen(true)}
                className="hairline flex w-full items-center gap-3 rounded-[24px] bg-ink-2/70 p-5 text-left backdrop-blur-xl transition hover:bg-ink-2"
              >
                <span className={cx("grid size-10 place-items-center rounded-2xl ring-1 ring-white/10", mode === "buy" ? "bg-amber/10 text-amber" : "bg-mint/10 text-mint")}>
                  <Bot className="size-5" />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-semibold">NetPositive AI</span>
                  <span className="block text-[12px] text-mute">{mode === "buy" ? "Rank your cards for an order" : "Find a store and draft a request"}</span>
                </span>
                <Sparkles className="size-4 text-mute" />
              </button>
            )}
          </div>

          {/* ticket */}
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <AnimatePresence mode="wait">
              <motion.div key={mode} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                {mode === "buy" ? <BuyTicket /> : <SellTicket />}
              </motion.div>
            </AnimatePresence>
          </aside>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- buy ticket */

function BuyTicket() {
  const { orders } = useOrderBook();
  const { address, openWallet, acceptOrder } = useApp();
  const nav = useNavigate();
  const [type, setType] = useState<OrderType>("market");
  const [spend, setSpend] = useState(10000);
  const [slip, setSlip] = useState(1);
  const [limit, setLimit] = useState(MARKET_RATE);
  const [review, setReview] = useState(false);

  const p = useMemo(() => previewBuy(orders, spend, type, limit, slip), [orders, spend, type, limit, slip]);

  return (
    <Ticket title="Buy USDC" tone="amber">
      <TypeTabs type={type} setType={setType} tone="amber" />
      <AmountField label="You spend" value={spend} onChange={setSpend} tone="amber" />
      {type === "market" ? <Slippage value={slip} onChange={setSlip} tone="amber" /> : <LimitField label="Max rate" value={limit} onChange={setLimit} />}

      <Divider />

      <div className="text-[12.5px] text-mute">Estimated receive</div>
      <div className="mt-2 flex items-baseline gap-2">
        <motion.span key={p.receive.toFixed(2)} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[42px] leading-none font-semibold tracking-tight text-amber tabular">
          {usdt(p.receive)}
        </motion.span>
        <span className="text-[12px] text-dim">USDC</span>
      </div>
      <div className="mt-4 space-y-2 text-[12.5px]">
        <Line k="Matched vouchers" v={p.fills.length ? `${p.fills.length} · ${inr(p.spend)}` : "None"} warn={p.fills.length > 0 && p.spend !== spend} />
        <Line k="Platform fee" v="0%" />
      </div>

      <BuyCalculator spend={p.spend || spend} receive={p.receive} />

      <Button
        variant="amber"
        className="mt-5 w-full"
        size="lg"
        disabled={!p.fills.length}
        onClick={() => (address ? setReview(true) : openWallet())}
        icon={<ArrowRight className="size-4" />}
      >
        {address ? "Review order" : "Connect to review"}
      </Button>
      <p className="mt-3 text-center text-[11.5px] text-dim">
        {p.fills.length ? "Preview only · no funds move until you accept" : type === "limit" ? "No whole vouchers at or below your max rate." : "No whole vouchers fit this amount."}
      </p>
      <CardsLink />

      <ReviewModal
        open={review}
        onClose={() => setReview(false)}
        matched={p.fills}
        receive={p.receive}
        onAccept={() => {
          p.fills.forEach(acceptOrder);
          nav(`/trade/${p.fills[0].id}`);
        }}
      />
    </Ticket>
  );
}

/** Net effective rate for a buyer: (voucher spend − card rewards) ÷ USDC received. */
function BuyCalculator({ spend, receive }: { spend: number; receive: number }) {
  const [open, setOpen] = useState(true);
  const [cardId, setCardId] = useState("all");
  const [value, setValue] = useState<"cash" | "travel">("cash");
  const { cards } = useApp();
  const picked = cards.some((c) => c.id === cardId) ? cardId : "all";
  const { route: best, rewardInr: reward } = useMemo(
    () => bestReward(spend, picked === "all" ? cards : cards.filter((c) => c.id === picked), value),
    [spend, cards, picked, value],
  );
  const rate = receive > 0 ? (spend - reward) / receive : null;

  return (
    <Calc open={open} setOpen={setOpen}>
      <div className="relative">
        <select
          value={picked}
          onChange={(e) => setCardId(e.target.value)}
          aria-label="Card for effective rate"
          className="h-10 w-full appearance-none rounded-xl bg-white/[0.04] px-3 pr-9 text-[13px] ring-1 ring-white/10 outline-none focus:ring-amber/45"
        >
          <option value="all" className="bg-ink-2">
            Best of my cards
          </option>
          {cards.map((c) => (
            <option key={c.id} value={c.id} className="bg-ink-2">
              {c.issuer} {c.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-dim" />
      </div>
      <div className="mt-2 grid grid-cols-2 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/[0.07]" aria-label="Reward value">
        {(["cash", "travel"] as const).map((v) => (
          <button key={v} onClick={() => setValue(v)} aria-pressed={value === v} className={cx("h-8 rounded-lg text-[12px] transition", value === v ? "bg-white/[0.08] text-fg" : "text-mute hover:text-fg")}>
            {v === "cash" ? "Cash value" : "Travel value"}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-1.5 text-[12.5px]">
        <Line k="Voucher spend" v={inr(spend)} />
        <Line k="Estimated rewards" v={`−${inr(reward, 2)}`} />
        {best && <div className="text-[11.5px] text-dim">{best.cardLabel} · {best.channel.name}</div>}
      </div>
      <Rate value={rate} tone="amber" />
      <p className="mt-1.5 text-[11px] leading-relaxed text-dim">Illustrative card rates, based on your selected reward value. Issuer terms and caps apply.</p>
    </Calc>
  );
}

/* -------------------------------------------------------------- sell ticket */

function SellTicket() {
  const { address, balance, humanVerified, openWallet, postOrder, toast } = useApp();
  const nav = useNavigate();
  const [type, setType] = useState<OrderType>("market");
  const [brandId, setBrandId] = useState("lifestyle");
  const [amount, setAmount] = useState(10000);
  const [slip, setSlip] = useState(1);
  const [limit, setLimit] = useState(MARKET_RATE);
  const [review, setReview] = useState(false);
  const [calcOpen, setCalcOpen] = useState(true);

  const rate = type === "limit" ? limit : MARKET_RATE;
  const q = quote(amount || 0, rate > 0 ? rate : 1);
  const short = q.sellerLocks > balance;

  const lock = () => {
    if (!humanVerified) {
      toast({ title: "Verify you're human first", body: "World ID is required once before you lock USDC.", tone: "iris" });
      openWallet();
      return;
    }
    const o = postOrder({ brandId, amount, rate }, q.sellerLocks);
    setReview(false);
    toast({ title: "Request is live", body: `${usdt(q.sellerLocks)} USDC locked in escrow · ${o.id}`, tone: "amber" });
    nav("/track");
  };

  return (
    <Ticket title="Pay with crypto" tone="mint">
      <TypeTabs type={type} setType={setType} tone="mint" />
      <VoucherPicker value={brandId} onChange={setBrandId} />
      <AmountField label="Voucher value" value={amount} onChange={setAmount} tone="mint" />
      {type === "market" ? (
        <>
          <Slippage value={slip} onChange={setSlip} tone="mint" />
          <p className="mt-1.5 text-[11px] text-dim">Buyers can fill down to ₹{(MARKET_RATE * (1 - slip / 100)).toFixed(2)} / USDC.</p>
        </>
      ) : (
        <LimitField label="Your rate" value={limit} onChange={setLimit} />
      )}

      <Divider />

      <div className="text-[12.5px] text-mute">You receive</div>
      <div className="mt-2 flex items-baseline gap-2">
        <motion.span key={amount} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[42px] leading-none font-semibold tracking-tight text-mint tabular">
          {inr(amount || 0)}
        </motion.span>
        <span className="text-[12px] text-dim">{brand(brandId).name} voucher</span>
      </div>
      <div className="mt-4 space-y-2 border-b border-white/[0.07] pb-3 text-[12.5px]">
        <Line k="Buyer receives" v={`${usdt(q.buyerReceives)} USDC`} />
        <Line k="Seller fee · 1%" v={`${usdt(q.fee)} USDC`} />
      </div>
      <div className="mt-3 flex justify-between text-[13px]">
        <span className="text-mute">Total USDC</span>
        <span className="font-semibold tabular">{usdt(q.sellerLocks)}</span>
      </div>

      <Calc open={calcOpen} setOpen={setCalcOpen}>
        <div className="space-y-1.5 text-[12.5px]">
          <Line k="Voucher value" v={inr(amount || 0)} />
          <Line k="USDC including 1% fee" v={usdt(q.sellerLocks)} />
        </div>
        <Rate value={q.sellerLocks > 0 ? (amount || 0) / q.sellerLocks : null} tone="mint" />
        <p className="mt-1.5 text-[11px] text-dim">Voucher value ÷ total USDC, including the fee.</p>
      </Calc>

      <Button
        className="mt-5 w-full"
        size="lg"
        disabled={!(amount > 0) || (!!address && short)}
        onClick={() => (address ? setReview(true) : openWallet())}
        icon={<ArrowRight className="size-4" />}
      >
        {!address ? "Connect to review" : short ? "Not enough USDC" : "Review request"}
      </Button>
      <p className="mt-3 text-center text-[11.5px] text-dim">Preview only · no funds move until you lock</p>
      <CardsLink />

      <AnimatePresence>
        {review && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReview(false)}>
            <motion.div
              role="dialog"
              aria-modal
              aria-label="Review request"
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 24, scale: 0.97, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              className="hairline w-full max-w-[420px] rounded-[26px] bg-ink-2 p-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold tracking-tight">Review request</h3>
                <button onClick={() => setReview(false)} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                <BrandMark id={brandId} size={38} />
                <div className="flex-1">
                  <div className="text-[14px] font-medium">{brand(brandId).name} voucher</div>
                  <div className="font-mono text-[11px] text-dim">
                    {type} · ₹{rate.toFixed(2)} / USDC
                  </div>
                </div>
                <div className="font-display text-xl font-semibold tabular">{inr(amount)}</div>
              </div>
              <div className="mt-4 space-y-2 rounded-2xl bg-white/[0.02] p-4 text-[13px] ring-1 ring-white/[0.06]">
                <Line k="Buyer receives" v={`${usdt(q.buyerReceives)} USDC`} />
                <Line k="Fee (1%)" v={`${usdt(q.fee)} USDC`} />
                <div className="flex justify-between border-t border-white/[0.06] pt-2">
                  <span className="text-mute">You lock</span>
                  <span className="font-semibold text-mint tabular">{usdt(q.sellerLocks)} USDC</span>
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-mute">
                <ShieldCheck className="size-3.5 text-mint" /> Released only after the voucher checks out. Back to you if nobody fills it in 30 min.
              </p>
              <Button className="mt-5 w-full" size="lg" onClick={lock} icon={<Lock className="size-4" />}>
                {humanVerified ? `Lock ${usdt(q.sellerLocks)} USDC` : "Verify with World ID to lock"}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ticket>
  );
}

function VoucherPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const b = brand(value);
  return (
    <div className="relative mt-5">
      <div className="mb-2 text-[12.5px] text-mute">Voucher</div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-12 w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-3 text-left ring-1 ring-white/10 transition hover:ring-white/20"
      >
        <BrandMark id={value} size={28} />
        <span className="flex-1 text-[14px]">{b.name}</span>
        <ChevronDown className={cx("size-4 text-dim transition", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="hairline absolute inset-x-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-2xl bg-ink-3 p-1.5 shadow-2xl"
          >
            {BRANDS.map((x) => (
              <li key={x.id}>
                <button
                  role="option"
                  aria-selected={x.id === value}
                  onClick={() => {
                    onChange(x.id);
                    setOpen(false);
                  }}
                  className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition hover:bg-white/[0.05]", x.id === value && "bg-mint/[0.08]")}
                >
                  <BrandMark id={x.id} size={24} />
                  <span className="flex-1">{x.name}</span>
                  <span className="text-[11px] text-dim">{x.category}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------ shared parts */

function Ticket({ title, tone, children }: { title: string; tone: "mint" | "amber"; children: ReactNode }) {
  return (
    <div className="hairline relative overflow-hidden rounded-[26px] bg-ink-2/85 p-6 backdrop-blur-xl">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-32"
        style={{ background: `radial-gradient(60% 100% at 50% 0%, ${tone === "mint" ? "rgba(61,220,151,0.12)" : "rgba(245,181,68,0.12)"}, transparent)` }}
      />
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

function TypeTabs({ type, setType, tone }: { type: OrderType; setType: (t: OrderType) => void; tone: "mint" | "amber" }) {
  return (
    <div className="mt-5 grid grid-cols-2 rounded-2xl bg-white/[0.03] p-1 ring-1 ring-white/[0.07]" role="tablist" aria-label="Order type">
      {(["market", "limit"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={type === t} onClick={() => setType(t)} className={cx("relative h-9 rounded-xl text-[13px] capitalize transition", type === t ? "text-fg" : "text-mute hover:text-fg")}>
          {type === t && <motion.span layoutId={`type-${tone}`} className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10" />}
          <span className="relative">{t}</span>
        </button>
      ))}
    </div>
  );
}

function AmountField({ label, value, onChange, tone }: { label: string; value: number; onChange: (n: number) => void; tone: "mint" | "amber" }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[12.5px] text-mute">{label}</div>
      <label className={cx("flex items-baseline gap-2 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/10 transition", tone === "mint" ? "focus-within:ring-mint/45" : "focus-within:ring-amber/45")}>
        <span className="font-display text-3xl text-mute">₹</span>
        <input
          type="number"
          inputMode="numeric"
          value={value || ""}
          onChange={(e) => onChange(Math.max(0, Math.min(500000, parseInt(e.target.value || "0"))))}
          className="w-full min-w-0 bg-transparent font-display text-[40px] leading-none font-semibold tracking-tight outline-none tabular"
          aria-label={`${label} in rupees`}
        />
        <span className="text-[12px] text-dim">INR</span>
      </label>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={cx(
              "h-9 rounded-xl text-[12.5px] ring-1 transition tabular",
              value === p ? (tone === "mint" ? "bg-mint/10 text-mint ring-mint/40" : "bg-amber/10 text-amber ring-amber/40") : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20",
            )}
          >
            {inr(p)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slippage({ value, onChange, tone = "mint" }: { value: number; onChange: (n: number) => void; tone?: "mint" | "amber" }) {
  const pct = ((value - 1) / 7) * 100;
  return (
    <div className="mt-5">
      <div className="flex justify-between text-[12.5px]">
        <span className="text-mute">Slippage tolerance</span>
        <span className={cx("font-medium tabular", tone === "mint" ? "text-mint" : "text-amber")}>{value}%</span>
      </div>
      <input
        type="range"
        min={1}
        max={8}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range mt-3"
        style={{ background: `linear-gradient(to right, var(--color-${tone}) ${pct}%, rgb(255 255 255 / 0.1) ${pct}%)` }}
        aria-label="Slippage tolerance"
      />
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-dim">
        <span>1%</span>
        <span>8%</span>
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
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium">
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

function Rate({ value, tone }: { value: number | null; tone: "mint" | "amber" }) {
  return (
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className={cx("font-display text-[30px] font-semibold tracking-tight tabular", tone === "mint" ? "text-mint" : "text-amber")}>{value === null ? "—" : `₹${value.toFixed(2)}`}</span>
      <span className="text-[11px] text-dim">/ USDC</span>
    </div>
  );
}

function Line({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{k}</span>
      <span className={cx("tabular", warn && "text-amber")}>{v}</span>
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
