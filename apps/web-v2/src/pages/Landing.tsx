import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LedBoard } from "../brand/LedBoard";
import { PlusField } from "../brand/PlusField";
import { PixelIcon, type PixelName } from "../components/PixelIcon";
import { BrandMark, Button, Marquee, SectionHead, Sticker, cx } from "../components/ui";
import { ARC } from "../lib/chain";
import { CARDS, routesFor } from "../lib/engine";
import { displayTerms, type DisplayTerms } from "../lib/displayTerms";
import { feePercent } from "../lib/terms";
import { useTerms } from "../lib/useTerms";
import { bps, inr, useRates, type RatesSummary } from "../lib/rates";
import { useApp } from "../lib/store";

export default function Landing() {
  return (
    <>
      <Hero />
      <Stores />
      <Lifecycle />
      <TwoSides />
      <HowItWorks />
      <Rates />
      <Trust />
      <Faq />
      <Band />
    </>
  );
}

const wrap = "mx-auto w-full max-w-[1200px] px-5 md:px-8";

/* ------------------------------------------------------------------ hero */

function Hero() {
  const { address, openWallet } = useApp();
  return (
    <section className="relative overflow-hidden pt-20 pb-16 md:pt-32 md:pb-24">
      <PlusField />
      <div className={cx(wrap, "relative flex flex-col items-center text-center")}>
        <h1 className="sr-only">Buy crypto. Keep rewards.</h1>
        <LedBoard text="BUY CRYPTO" maxCell={14} className="w-full max-w-[826px]" />
        <motion.div
          aria-hidden
          initial={{ opacity: 0, scale: 1.25, rotate: 4 }}
          animate={{ opacity: 1, scale: 1, rotate: -2.5 }}
          transition={{ delay: 0.75, type: "spring", stiffness: 260, damping: 15 }}
          className="mt-5 md:mt-7"
        >
          <Sticker tilt={0} className="text-[11.5vw] leading-[1.08] tracking-[-0.045em] sm:text-[64px] md:text-[80px]">
            KEEP REWARDS
          </Sticker>
        </motion.div>

        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.6 }} className="mt-10 max-w-[600px] text-[18px] leading-relaxed text-mute md:text-[20px]">
          Get USDC in your own wallet by filling a gift-voucher order with the card you already have. No exchange account, no withdrawal queue.
        </motion.p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.05 }} className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[16px] text-mute md:text-[18px]">
          <span>Paid by escrow on Arc</span>
          <Dot />
          <span className="font-medium text-brand">Straight to your wallet</span>
          <Dot />
          <span>World ID humans only</span>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.15, duration: 0.5 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {address ? (
            <Button size="lg" to="/trade">
              Buy USDC
            </Button>
          ) : (
            <Button size="lg" onClick={openWallet} data-testid="hero-connect">
              Buy USDC
            </Button>
          )}
          <Button size="lg" variant="outline" href="#rates">
            See live rates
          </Button>
        </motion.div>
      </div>
    </section>
  );
}

const Dot = () => <span className="text-dim">•</span>;

/* ---------------------------------------------------------------- stores */

/** Stores the order book accepts today (backend BRANDS). */
const STORES: [string, string][] = [
  ["amazon", "Amazon"],
  ["flipkart", "Flipkart"],
  ["myntra", "Myntra"],
  ["swiggy", "Swiggy"],
  ["zomato", "Zomato"],
  ["bigbasket", "BigBasket"],
  ["mmt", "MakeMyTrip"],
  ["blinkit", "Blinkit"],
];

function Stores() {
  return (
    <section aria-label="Stores" className="pb-4">
      <div className="mb-5 text-center text-[13px] text-dim">Stores</div>
      <Marquee speed={42}>
        {STORES.map(([id, name]) => (
          <span key={id} className="mx-8 flex items-center gap-3 text-[20px] font-medium tracking-[-0.02em] text-fg/75">
            <BrandMark id={id} size={28} className="!rounded-md grayscale" />
            {name}
          </span>
        ))}
      </Marquee>
    </section>
  );
}

/* ------------------------------------------------------------- lifecycle */

const STEPS = [
  { t: "Lock USDC", s: "Spender, in escrow" },
  { t: "Accepted", s: "Verified card holder" },
  { t: "Voucher bought", s: "On their rewards card" },
  { t: "Code delivered", s: "Sealed end to end" },
  { t: "Released", s: "When you confirm" },
];

function Lifecycle() {
  const [at, setAt] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setAt((a) => (a + 1) % (STEPS.length + 1)), 1500);
    return () => window.clearInterval(id);
  }, []);
  const pct = (Math.min(at, STEPS.length - 1) / (STEPS.length - 1)) * 100;
  return (
    <section className={cx(wrap, "py-14 md:py-20")} aria-label="Order lifecycle">
      <div className="relative">
        <div className="absolute top-[5px] right-[10%] left-[10%] h-[2px] bg-line" />
        <motion.div className="absolute top-[5px] left-[10%] h-[2px] bg-brand" animate={{ width: `${pct * 0.8}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
        <ol className="relative grid grid-cols-5">
          {STEPS.map((s, i) => {
            const done = i <= at;
            return (
              <li key={s.t} className="flex flex-col items-center text-center">
                <span className={cx("relative size-3 rounded-full border-2 transition-colors duration-300", done ? "border-brand bg-brand" : "border-line-2 bg-canvas")}>
                  {i === at && <span className="absolute inset-[-6px] animate-ping rounded-full border-2 border-brand opacity-50" />}
                </span>
                <span className={cx("mt-4 text-[13px] font-medium tracking-[-0.01em] transition-colors sm:text-[17px]", done ? "text-fg" : "text-dim")}>{s.t}</span>
                <span className="mt-0.5 hidden text-[14px] text-mute sm:block">{s.s}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- 2 sides */

function TwoSides() {
  const { feeBps, estimated } = useTerms();
  return (
    <section className="bg-sunken py-20 md:py-28">
      <div className={wrap}>
        <SectionHead eyebrow="Who it's for" title="One trade. Two people. Both ahead." sub="A card holder who wants USDC in their own wallet, and a crypto holder who wants to shop. An escrow contract sits between them." />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <SideCard
            icon="card"
            title="Want crypto you can actually use?"
            body="Fill an order by buying the gift voucher on your card. The escrow contract releases the USDC to your own wallet, ready for DeFi, with no exchange in between. Every reward point stays with you."
            facts={[
              ["Paid to", "Your own wallet"],
              ["Your rewards", "Stay on your card"],
            ]}
            cta={{ label: "Buy USDC", to: "/trade" }}
          />
          <SideCard
            icon="wallet"
            title="Hold crypto? Spend it."
            body="Pick a store and an amount and lock USDC in escrow. A card holder buys the voucher and sends you the code, and you check it before the USDC is released. No bank account needed."
            facts={[
              ["You set the rate", "₹ per USDC"],
              ["You pay", `USDC + ${feePercent(feeBps)} fee${estimated ? " (est.)" : ""}`],
            ]}
            cta={{ label: "Spend USDC", to: "/trade?mode=sell" }}
          />
        </div>
      </div>
    </section>
  );
}

function SideCard({ icon, title, body, facts, cta }: { icon: PixelName; title: string; body: string; facts: [string, string][]; cta: { label: string; to: string } }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="group flex flex-col rounded-2xl border border-line bg-surface p-7 md:p-8"
    >
      <PixelIcon name={icon} />
      <h3 className="mt-10 text-[22px] font-semibold tracking-[-0.03em]">{title}</h3>
      <p className="mt-2.5 text-[15.5px] leading-relaxed text-mute">{body}</p>
      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-surface p-3.5">
            <div className="text-[12.5px] text-mute">{k}</div>
            <div className="mt-0.5 text-[15px] font-medium">{v}</div>
          </div>
        ))}
      </div>
      <Button to={cta.to} variant="outline" className="mt-6 self-start" icon={<ArrowRight className="size-4" />}>
        {cta.label}
      </Button>
    </motion.div>
  );
}

/* ---------------------------------------------------------- how it works */

type HowStep = { icon: PixelName; title: string; line: string; tags: string[]; detail: ReactNode[] };

/** The four steps, with the escrow's current numbers (`v`) written in. */
const how = (v: DisplayTerms, feeTag: string): HowStep[] => [
  {
    icon: "lock",
    title: "A spender locks USDC in escrow",
    line: "Someone who wants to shop posts an order: a store, a voucher amount and a rate. Their USDC goes into the escrow contract on Arc, and you can check it there yourself.",
    tags: ["Arc escrow", feeTag, `${v.min} to ${v.max} USDC per order`],
    detail: [
      "The spender's wallet sends two transactions: approve USDC, then deposit the amount plus the fee into the escrow contract.",
      "From then on the contract can only pay the buyer the spender names, or refund the spender. No key held by NetPositive can send it anywhere else.",
      "If no one takes the order in time, it expires and the spender gets everything back, fee included.",
    ],
  },
  {
    icon: "human",
    title: "You accept, then bind yourself on-chain",
    line: "Only people who passed World ID's one-person check can accept. When the spender presses Ready, you confirm the order from your wallet, and the USDC can then only go to you or back to them.",
    tags: ["World ID", "One human, one account", "One wallet transaction"],
    detail: [
      "The order book ranks every open order by what it's worth to each card holder after their card's rewards.",
      "Do not buy the voucher before your on-chain confirmation has gone through. Until then the spender can still cancel.",
      "A banned person can't come back on a fresh wallet: the World ID check is bound to the first wallet.",
    ],
  },
  {
    icon: "sealed",
    title: "Buy the voucher and send the code sealed",
    line: "Pay for the voucher on your card, mark it delivered from your wallet, then paste the code. It is encrypted in your browser to the spender's key. The server never sees it.",
    tags: ["Client-side encryption", `${v.fulfil} to deliver`],
    detail: [
      "The code is locked in your browser so that only the spender's wallet can open it. NetPositive stores only the locked box.",
      `You have ${v.fulfil} from your on-chain confirmation to deliver. Miss it and the spender is refunded.`,
    ],
  },
  {
    icon: "clock",
    title: "Escrow pays your wallet",
    line: `The spender checks the voucher and releases the USDC to the wallet you connected. If they neither release nor dispute within ${v.review}, you are paid anyway.`,
    tags: [`${v.review} review window`, v.hasStake ? `${v.stake} USDC dispute stake` : "Disputes"],
    detail: [
      v.hasStake
        ? `If the voucher is bad, the spender can open a dispute by locking a ${v.stake} USDC stake. The escrow freezes until an arbiter decides.`
        : "If the voucher is bad, the spender can open a dispute. The escrow freezes until an arbiter decides.",
      "If the spender was right they are refunded. If they were wrong, you receive the USDC and their stake, and their account is banned.",
      <>
        The full rules are in the{" "}
        <Link to="/docs#disputes" className="link font-medium text-fg">
          docs
        </Link>
        .
      </>,
    ],
  },
];

function HowItWorks() {
  const [open, setOpen] = useState<number | null>(0);
  const { terms, feeBps, estimated } = useTerms();
  const v = useMemo(() => displayTerms(terms), [terms]);
  const feeTag = `${feePercent(feeBps)} fee on top${estimated ? " (launch value)" : ""}`;
  const HOW = how(v, feeTag);
  return (
    <section id="how" className={cx(wrap, "scroll-mt-24 py-20 md:py-28")}>
      <SectionHead eyebrow="How it works" title="From your card to USDC in your wallet, in four steps" sub="Seen from the buyer's side. Every step is enforced by the escrow contract, World ID or encryption, not by trusting the other person." />
      <div className="mt-12 space-y-3">
        {HOW.map((h, i) => {
          const isOpen = open === i;
          return (
            <div key={h.title} className={cx("rounded-2xl border bg-surface transition-colors", isOpen ? "border-line-2" : "border-line")}>
              <button onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-start gap-5 p-5 text-left md:items-center md:p-6" aria-expanded={isOpen}>
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-sunken">
                  <PixelIcon name={h.icon} size={36} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[18px] font-medium tracking-[-0.02em]">
                    <span className="font-mono text-[13px] text-dim">0{i + 1}</span>
                    {h.title}
                  </span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-mute">{h.line}</span>
                  <span className="mt-3 flex flex-wrap gap-1.5">
                    {h.tags.map((t) => (
                      <span key={t} className="rounded-md bg-sunken px-2 py-0.5 text-[12px] text-mute">
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-fg">{isOpen ? <Minus className="size-4" /> : <Plus className="size-4" />}</span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                    <ul className="space-y-2 px-5 pb-6 md:pl-[100px] md:pr-16">
                      {h.detail.map((d, j) => (
                        <li key={j} className="flex gap-3 text-[15px] leading-relaxed text-fg/80">
                          <span className="mt-[9px] size-1.5 shrink-0 rounded-[2px] bg-brand" />
                          {d}
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-[14.5px] text-mute">
        {!v.live && "Time windows and limits shown are the launch values while the current ones load. "}
        Every step, from both sides, is in the{" "}
        <Link to="/docs#buying" className="link font-medium text-fg">
          docs
        </Link>
        .
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ rates */

/** Last values the team captured from the live APIs (6 Nov 2026). Shown, labelled, only when the live feed can't be reached. */
const SNAPSHOT = { at: "6 Nov 2026", usdInr: 94.02, usdtBuy: 103.15, spotBid: 99.61, spotAsk: 99.99 };

function useMarket() {
  const { data, loading } = useRates();
  const live = !!data && typeof data.forex?.usdInr === "number";
  const usdt = data?.assets?.USDT;
  const usdc = data?.assets?.USDC;
  return {
    loading,
    live,
    data,
    usdInr: live ? data!.forex.usdInr! : SNAPSHOT.usdInr,
    usdtBuy: usdt?.p2p?.buy?.price ?? (live ? undefined : SNAPSHOT.usdtBuy),
    usdtSell: usdt?.p2p?.sell?.price ?? (live ? undefined : SNAPSHOT.spotBid),
    spotMid: usdt?.spot?.mid ?? (live ? undefined : (SNAPSHOT.spotBid + SNAPSHOT.spotAsk) / 2),
    usdcBuy: usdc?.p2p?.buy?.price,
    usdcSpot: usdc?.spot?.mid,
  };
}

function names(used: unknown[] | undefined) {
  if (!Array.isArray(used) || !used.length) return "—";
  return used
    .map((u) => (typeof u === "string" ? u : typeof u === "object" && u && "source" in u ? String((u as { source: unknown }).source) : ""))
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(", ");
}

function Rates() {
  const m = useMarket();
  const d: RatesSummary | null = m.data;
  const rows: { k: string; v: number | undefined; prem: number | null | undefined; src: string }[] = [
    { k: "USD / INR · forex", v: m.usdInr, prem: 0, src: m.live ? names(d?.forex.used) : "Coinbase, ECB, ExchangeRate-API" },
    { k: "USDT · P2P buy (₹10k)", v: m.usdtBuy, prem: d?.assets.USDT.p2p.premiumBps.buy ?? (m.live ? null : Math.round(((SNAPSHOT.usdtBuy - SNAPSHOT.usdInr) / SNAPSHOT.usdInr) * 10000)), src: m.live ? names(d?.assets.USDT.p2p.buy.used) : "Binance, Bybit, KuCoin" },
    { k: "USDT · P2P sell (₹10k)", v: m.live ? d?.assets.USDT.p2p.sell.price : undefined, prem: d?.assets.USDT.p2p.premiumBps.sell, src: m.live ? names(d?.assets.USDT.p2p.sell.used) : "Binance, Bybit, KuCoin" },
    { k: "USDT · Indian spot mid", v: m.spotMid, prem: d?.assets.USDT.spot.premiumBps ?? (m.live ? null : Math.round((((SNAPSHOT.spotBid + SNAPSHOT.spotAsk) / 2 - SNAPSHOT.usdInr) / SNAPSHOT.usdInr) * 10000)), src: m.live ? names(d?.assets.USDT.spot.used) : "WazirX, CoinDCX" },
    { k: "USDC · P2P buy (₹10k)", v: m.usdcBuy, prem: d?.assets.USDC?.p2p.premiumBps.buy, src: m.live ? names(d?.assets.USDC?.p2p.buy.used) : "Binance, Bybit" },
  ];

  return (
    <section id="rates" className="scroll-mt-24 bg-sunken py-20 md:py-28">
      <div className={wrap}>
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHead eyebrow="Live rates" title="The market, priced for your trade size" sub="Median of foreign exchanges' P2P ads and Indian order books, with outliers dropped. This is the price a voucher trade has to beat." />
          <div className={cx("flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[13px] ring-1", m.live ? "bg-surface text-fg ring-line" : "bg-surface text-mute ring-line")}>
            <span className={cx("size-1.5 rounded-full", m.live ? "animate-pulse bg-pos" : "bg-dim")} />
            {m.loading ? "Connecting to the feed…" : m.live ? `Live · ${new Date(d!.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `Snapshot · ${SNAPSHOT.at}`}
          </div>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          <div className="self-start overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="grid grid-cols-[1.6fr_1fr_0.8fr] gap-4 border-b border-line px-5 py-3 text-[11.5px] font-medium tracking-[0.08em] text-dim uppercase md:grid-cols-[1.6fr_1fr_0.8fr_1.4fr]">
              <span>Market</span>
              <span className="text-right">Price</span>
              <span className="text-right">vs forex</span>
              <span className="hidden md:block">Sources</span>
            </div>
            {rows.filter((r) => m.live || typeof r.v === "number").map((r) => (
              <div key={r.k} className="grid grid-cols-[1.6fr_1fr_0.8fr] items-center gap-4 border-b border-line px-5 py-3.5 text-[14.5px] last:border-0 md:grid-cols-[1.6fr_1fr_0.8fr_1.4fr]">
                <span className="font-medium">{r.k}</span>
                <span className="tabular text-right">{inr(r.v)}</span>
                <span className={cx("tabular text-right text-[13.5px]", typeof r.prem === "number" && r.prem > 0 ? "text-amber-ink" : "text-mute")}>{r.prem === 0 ? "base" : bps(r.prem)}</span>
                <span className="hidden truncate text-[13px] text-mute md:block">{r.src}</span>
              </div>
            ))}
          </div>
          <Calculator usdtBuy={m.usdtBuy ?? m.usdInr * 1.08} usdtSell={m.usdtSell ?? m.usdInr * 1.04} />
        </div>
        <p className="mt-4 text-[12.5px] text-dim">
          From the NetPositive rates API (<span className="font-mono">GET /rates</span>): size-aware P2P prices from traders with 90%+ completion, median of the best three ads, cross-source outlier rejection.
        </p>
      </div>
    </section>
  );
}

function Calculator({ usdtBuy, usdtSell }: { usdtBuy: number; usdtSell: number }) {
  const [amount, setAmount] = useState(10000);
  const defaultRate = Math.round(((usdtBuy + usdtSell) / 2) * 10) / 10;
  const [rate, setRate] = useState<number | null>(null);
  const r = rate ?? defaultRate;
  const { feeBps, estimated } = useTerms();
  // Example cards only: nobody's own cards are known on the landing page.
  const best = useMemo(() => routesFor(amount, CARDS)[0], [amount]);
  const usdc = amount / r;
  const lock = usdc * (1 + feeBps / 10_000);
  const reward = best ? best.statementInr : 0;
  const buyerEffective = (amount - reward) / usdc;
  const spenderVsP2P = ((r - usdtSell) / usdtSell) * 100;
  const buyerVsP2P = ((usdtBuy - buyerEffective) / usdtBuy) * 100;
  const p = ((amount - 1000) / (50000 - 1000)) * 100;

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 md:p-6">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-medium">Trade calculator</span>
        <span className="text-[12.5px] text-mute">Example card: {best ? `${best.cardLabel} · ${best.channel.name}` : "—"}</span>
      </div>
      <label className="mt-5 block">
        <span className="flex items-baseline justify-between text-[13px] text-mute">
          Voucher value <span className="tabular text-[20px] font-semibold text-fg">{inr(amount, 0)}</span>
        </span>
        <input type="range" className="range mt-3" min={1000} max={50000} step={500} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ ["--p" as string]: `${p}%` }} aria-label="Voucher value" />
      </label>
      <div className="mt-5 flex items-center justify-between text-[13px] text-mute">
        Order rate (₹ per USDC)
        <span className="flex items-center gap-1.5">
          <button className="grid size-7 place-items-center rounded-full ring-1 ring-line hover:bg-sunken" onClick={() => setRate(Math.round((r - 0.5) * 10) / 10)} aria-label="Lower rate">
            <Minus className="size-3" />
          </button>
          <span className="tabular w-16 text-center text-[16px] font-semibold text-fg">{r.toFixed(1)}</span>
          <button className="grid size-7 place-items-center rounded-full ring-1 ring-line hover:bg-sunken" onClick={() => setRate(Math.round((r + 0.5) * 10) / 10)} aria-label="Raise rate">
            <Plus className="size-3" />
          </button>
        </span>
      </div>
      <div className="mt-5 grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-xl bg-line">
        <div className="bg-surface p-4">
          <div className="text-[12.5px] text-mute">Spender locks</div>
          <div className="tabular mt-1 text-[22px] font-semibold tracking-[-0.02em]">{lock.toFixed(2)}</div>
          <div className="text-[12.5px] text-mute">USDC incl. {feePercent(feeBps)} fee{estimated ? " (estimated)" : ""}</div>
          <div className={cx("mt-3 text-[13px] font-medium", spenderVsP2P >= 0 ? "text-pos-ink" : "text-rose-ink")}>
            {spenderVsP2P >= 0 ? `${spenderVsP2P.toFixed(1)}% more ₹ per USDC` : `${(-spenderVsP2P).toFixed(1)}% fewer ₹ per USDC`} than selling on P2P
          </div>
        </div>
        <div className="bg-surface p-4">
          <div className="text-[12.5px] text-mute">Card holder pays</div>
          <div className="tabular mt-1 text-[22px] font-semibold tracking-[-0.02em]">₹{buyerEffective.toFixed(2)}</div>
          <div className="text-[12.5px] text-mute">per USDC after rewards</div>
          <div className={cx("mt-3 text-[13px] font-medium", buyerVsP2P >= 0 ? "text-pos-ink" : "text-rose-ink")}>
            {buyerVsP2P >= 0 ? `${buyerVsP2P.toFixed(1)}% cheaper` : `${(-buyerVsP2P).toFixed(1)}% dearer`} than buying on P2P
          </div>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-dim">Example only: the reward shown is for a sample card ({best ? best.cardLabel : "none"}) at statement-credit value, not your own card. Add your cards in the app to see your real route, and check your issuer's current terms.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ trust */

type TrustItem = { icon: PixelName; title: string; body: string; to?: string; href?: string };

const trust = (v: DisplayTerms): TrustItem[] => [
  { icon: "lock", title: "USDC escrow on Arc", body: "Funds sit in the escrow contract and can only go to the buyer the spender named, or back to the spender. You send every transaction from your own wallet.", to: "/docs#safety" },
  { icon: "human", title: "World ID humans", body: "One-person check once per person. One account each, and a ban follows the person, not the wallet.", href: "https://world.org/world-id" },
  { icon: "sealed", title: "Sealed voucher codes", body: "Encrypted in the browser to the spender's key. The server stores only the locked box.", to: "/docs#vouchers" },
  { icon: "clock", title: "Review window", body: `After delivery the spender has ${v.review} to release or dispute. If they do neither, the buyer is paid.`, to: "/docs#time-limits" },
  { icon: "scale", title: "Disputes with limits", body: "Only the spender can dispute, and only inside the review window. The arbiter can split that one escrow and nothing else; if nobody rules in 30 days, the USDC returns to the spender.", to: "/docs#disputes" },
  { icon: "shield", title: "Check the escrow yourself", body: "Before you spend a rupee, the app reads the deposit straight from the contract on Arc, not from our server.", to: "/docs#safety" },
];

function Trust() {
  const { terms } = useTerms();
  const v = useMemo(() => displayTerms(terms), [terms]);
  const card = "group block h-full rounded-2xl border border-line bg-surface p-6 transition hover:border-line-2 hover:shadow-[0_12px_32px_-20px_rgba(12,13,15,0.25)]";
  return (
    <section id="trust" className={cx(wrap, "scroll-mt-24 py-20 md:py-28")}>
      <SectionHead eyebrow="Trust" title="Built so neither side has to trust the other" sub="Each risk in a voucher trade has a specific control, most of them enforced by the contract or by encryption. Where you still have to trust someone, we say so." />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {trust(v).map((t, i) => {
          const inner = (
            <>
              <div className="flex items-start justify-between">
                <PixelIcon name={t.icon} size={44} />
                <ChevronRight className="size-4 text-dim transition group-hover:translate-x-0.5 group-hover:text-fg" />
              </div>
              <h3 className="mt-8 text-[17px] font-medium tracking-[-0.02em]">{t.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-mute">{t.body}</p>
            </>
          );
          return (
            <motion.div key={t.title} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ delay: i * 0.04, duration: 0.5 }}>
              {t.to ? (
                <Link to={t.to} className={card}>
                  {inner}
                </Link>
              ) : (
                <a href={t.href} target="_blank" rel="noopener noreferrer" className={card}>
                  {inner}
                </a>
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl bg-amber/10 p-5 ring-1 ring-amber/35 md:p-6">
        <h3 className="text-[16px] font-semibold text-amber-ink">What is not solved yet</h3>
        <p className="mt-1.5 max-w-[860px] text-[14.5px] leading-relaxed text-fg/80">
          The escrow contract has not been audited, and its settings are controlled by a single owner wallet for now. A dispute is decided by an arbiter on the team. Nothing checks a voucher automatically, so the spender has to check it in time. Until an audit, orders are limited to {v.max} USDC each and {v.cap} USDC in total{v.live ? "" : " (launch values)"}.{" "}
          <Link to="/docs#safety" className="link font-medium text-fg">
            Read the known limits
          </Link>
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- faq */

const faqs = (v: DisplayTerms): { q: string; a: ReactNode }[] => [
  {
    q: "Do I need an exchange account?",
    a: "No. The escrow contract pays the USDC to the wallet you connect, and NetPositive never holds it. From there it is yours to move or use in DeFi.",
  },
  {
    q: "Is this real money?",
    a: ARC.testnet
      ? `Not yet. NetPositive runs on ${ARC.name}, so the USDC in escrow is testnet USDC. Voucher codes in a real trade are real, so only trade vouchers you'd be happy to buy.`
      : `Yes. NetPositive runs on ${ARC.name}, so the USDC in escrow is real USDC and the voucher codes are real. Only lock what you mean to spend, and only buy vouchers you'd be happy to keep.`,
  },
  {
    q: "Which wallets work?",
    a: "Any EVM wallet can sign in. To trade you need one that can add the Arc network: MetaMask, Rabby, Coinbase Wallet, OKX, Rainbow, Trust, Zerion, Brave, or a mobile wallet through WalletConnect. The app adds Arc for you. Phantom can sign in but can't use Arc, so it can't hold your payout.",
  },
  {
    q: "Why do I need World ID?",
    a: "So every account is a different real person. It stops one person from farming orders with many wallets, and it makes a ban permanent. You can browse without it; it's asked once, the first time you post or accept an order.",
  },
  {
    q: "What if the voucher doesn't work?",
    a: `Don't release. Open a dispute before the review window ends (${v.review} after delivery), with screenshots${v.hasStake ? ` and a ${v.stake} USDC stake` : ""}. The escrow is frozen until an arbiter decides. If you were right, the USDC, the fee and the stake come back to you. If the arbiter finds the voucher was fine, the buyer is paid, receives your stake, and your account is banned.`,
  },
  {
    q: "Is the contract audited?",
    a: (
      <>
        No, not yet. It is live on {ARC.name} with tests but without an independent audit, and a single owner wallet controls its settings for new orders. That is why orders are capped at {v.max} USDC each and {v.cap} USDC in total{v.live ? "" : " (launch values)"}. The{" "}
        <Link to="/docs#safety" className="link font-medium text-fg">
          known limits
        </Link>{" "}
        are listed in the docs.
      </>
    ),
  },
  {
    q: "How is the rate decided?",
    a: "The spender sets it when posting. The live rates above show where P2P and order books are, and the order book shows each card holder what an order is worth after their card's rewards.",
  },
];

function Faq() {
  const [open, setOpen] = useState(0);
  const { terms } = useTerms();
  const FAQS = useMemo(() => faqs(displayTerms(terms)), [terms]);
  return (
    <section id="faq" className={cx(wrap, "scroll-mt-24 border-t border-line py-20 md:py-28")}>
      <div className="grid gap-10 md:grid-cols-[1fr_1.5fr]">
        <div>
          <div className="eyebrow mb-3 flex items-center gap-2">
            <span className="size-1.5 rounded-[2px] bg-brand" /> FAQ
          </div>
          <h2 className="text-[34px] font-semibold leading-[1.06] tracking-[-0.035em] md:text-[40px]">Questions people ask first</h2>
          <p className="mt-4 text-[15.5px] leading-relaxed text-mute">
            Stuck on a wrong network or a pending transaction? See{" "}
            <Link to="/docs#faq" className="link font-medium text-fg">
              common problems
            </Link>{" "}
            in the docs.
          </p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {FAQS.map((f, i) => (
            <div key={f.q}>
              <button onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center justify-between gap-6 py-5 text-left text-[17px] font-medium tracking-[-0.015em]" aria-expanded={open === i}>
                {f.q}
                {open === i ? <Minus className="size-4 shrink-0 text-mute" /> : <Plus className="size-4 shrink-0 text-mute" />}
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="pb-6 text-[15.5px] leading-relaxed text-mute">{f.a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- band */

function Band() {
  const { address, openWallet } = useApp();
  return (
    <section className="relative overflow-hidden bg-brand text-white">
      <PlusField color="#ffffff" idle="rgba(255,255,255,0.2)" fade={false} />
      <div className={cx(wrap, "relative flex flex-col items-center py-20 text-center md:py-28")}>
        <h2 className="sr-only">NetPositive</h2>
        <LedBoard text={["NET POSITIVE", "BUY USDC", "YOUR WALLET", "KEEP REWARDS"]} color="#ffffff" hot="#00e07f" maxCell={12} interval={3000} className="w-full max-w-[860px]" />
        <p className="mt-9 max-w-[520px] text-[18px] leading-relaxed text-white/75">Fill your first order with the card already in your pocket. The USDC lands in your own wallet.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {address ? (
            <Button size="lg" variant="white" to="/trade" icon={<ArrowRight className="size-4" />}>
              Open the app
            </Button>
          ) : (
            <Button size="lg" variant="white" onClick={openWallet} icon={<ArrowRight className="size-4" />}>
              Connect wallet
            </Button>
          )}
          <Button size="lg" to="/docs" className="!bg-transparent text-white ring-1 ring-white/40 hover:!bg-white/10">
            Read the docs
          </Button>
        </div>
      </div>
    </section>
  );
}
