import { AnimatePresence, motion, useScroll, useTransform } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Cpu,
  FileCheck,
  FingerprintPattern,
  KeyRound,
  Lock,
  Scale,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { FlowDiagram } from "../components/FlowDiagram";
import { HeroRail } from "../components/HeroRail";
import { ScreenDetect, ScreenGuide, ScreenRequest, ScreenReveal, ScreenRoutes, ScreenVerify } from "../components/Screens";
import { Aurora, Button, Card, Counter, Persona, Pill, SectionHead, Tilt, cx } from "../components/ui";
import { FEED } from "../lib/data";
import { CARDS, effectivePrice, inr, quote, routesFor, usdt } from "../lib/engine";

const ease = [0.16, 1, 0.3, 1] as const;

export default function Landing() {
  return (
    <>
      <Hero />
      <Ticker />
      <TwoPeople />
      <Walkthrough />
      <Calculator />
      <Trust />
      <Compare />
      <Limits />
      <FinalCta />
    </>
  );
}

/* ================================================================ HERO */
function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  const words = ["Spend", "crypto", "anywhere."];
  return (
    <section ref={ref} className="relative overflow-hidden pt-32 pb-16 md:pt-36">
      <Aurora />
      <div className="grid-bg absolute inset-0" />
      <motion.div style={{ y, opacity: fade }} className="relative mx-auto max-w-6xl px-6 text-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="flex justify-center">
          <a href="#how" className="group flex items-center gap-2 rounded-full bg-white/[0.04] py-1 pl-1 pr-3 text-[12.5px] text-mute ring-1 ring-white/10 transition hover:ring-white/20">
            <Pill tone="mint" dot>
              Live demo
            </Pill>
            Escrow on Base · World ID · signed voucher checks
            <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
          </a>
        </motion.div>

        <h1 className="mx-auto mt-7 max-w-5xl font-display text-[clamp(44px,7.6vw,92px)] font-semibold leading-[0.95] tracking-[-0.045em]">
          <span className="block">
            {words.map((w, i) => (
              <motion.span
                key={w}
                className="text-gradient inline-block pr-[0.22em]"
                initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.9, ease }}
              >
                {w}
              </motion.span>
            ))}
          </span>
          <motion.span
            className="text-mint-gradient block pb-2"
            initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.4, duration: 0.9, ease }}
          >
            Keep every reward.
          </motion.span>
        </h1>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 1, ease }}
        className="relative mt-12 px-6"
      >
        <HeroRail />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 60, scale: 0.96 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 1.2, ease }}
        className="relative mx-auto mt-28 max-w-5xl px-4"
      >
        <div className="absolute inset-x-10 -top-10 h-40 rounded-full bg-mint/20 blur-[90px]" />
        <div className="hairline relative overflow-hidden rounded-[28px] bg-ink-2/80 p-2 shadow-[0_50px_140px_-30px_rgba(0,0,0,1)] backdrop-blur-xl">
          <div className="flex items-center justify-between rounded-t-[22px] border-b border-white/[0.05] px-4 py-3">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-white/10" />
              <span className="size-2.5 rounded-full bg-white/10" />
              <span className="size-2.5 rounded-full bg-white/10" />
            </div>
            <span className="font-mono text-[11px] text-dim">trade VR-24817 · Lifestyle ₹10,000 @ ₹90</span>
            <Pill tone="mint" dot className="!py-0.5">
              live
            </Pill>
          </div>
          <div className="dot-bg rounded-b-[22px] px-2 pt-6 pb-6 md:px-8">
            <FlowDiagram />
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ============================================================== TICKER */
function Ticker() {
  const items = [...FEED, ...FEED];
  return (
    <div className="relative overflow-hidden border-y border-line bg-ink-2/40 py-4 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
      <div className="flex w-max animate-marquee gap-10 hover:[animation-play-state:paused]">
        {items.map((t, i) => (
          <span key={i} className="flex items-center gap-3 whitespace-nowrap font-mono text-[12px] text-mute">
            <span className={cx("size-1.5 rounded-full", t.includes("settled") ? "bg-mint" : t.includes("verif") || t.includes("check") ? "bg-iris" : "bg-amber")} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* =========================================================== TWO PEOPLE */
function TwoPeople() {
  const q = quote(10000, 90);
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-32">
      <SectionHead
        eyebrow="One trade, two winners"
        title={
          <>
            The seller wants to shop.
            <br />
            The buyer wants USDT.
          </>
        }
        sub="The seller holds crypto but Lifestyle only takes rupees. The buyer has a premium card with unused reward caps. NetPositive turns the voucher into the bridge between them."
      />

      <div className="mt-14 grid gap-4 md:grid-cols-2">
        {(
          [
            {
              who: "seller" as const,
              name: "Seller",
              tag: "Seller of crypto",
              blurb: "Holds 120 USDT. Wants ₹10,000 of clothes at Lifestyle this weekend, without cashing out through an exchange.",
              gives: `${usdt(q.sellerLocks)} USDT`,
              gets: "₹10,000 Lifestyle vouchers",
              price: "₹89.11",
              priceNote: "per USDT, all-in",
              saving: "Pays 1%. Nothing else.",
              glow: "rgba(61,220,151,0.14)",
            },
            {
              who: "buyer" as const,
              name: "Buyer",
              tag: "Buyer of crypto",
              blurb: "Holds HDFC Infinia. Wants about 110 USDT. Hasn't used the SmartBuy voucher bonus this month.",
              gives: "₹10,000 on their card",
              gets: `${usdt(q.buyerReceives)} USDT + 1,650 pts`,
              price: "₹75.15",
              priceNote: "per USDT, travel value",
              saving: "16.5% saved",
              glow: "rgba(245,181,68,0.14)",
            },
          ]
        ).map((p, idx) => (
          <motion.div
            key={p.who}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: idx * 0.1, duration: 0.8, ease }}
          >
            <Card glow={p.glow} className="p-7">
              <div className="flex items-center justify-between">
                <Persona who={p.who} />
                <span className="label">{p.tag}</span>
              </div>
              <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">{p.name}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-mute">{p.blurb}</p>
              <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06]">
                {[
                  ["Gives", p.gives],
                  ["Gets", p.gets],
                ].map(([k, v]) => (
                  <div key={k} className="bg-ink-2 p-4">
                    <div className="label">{k}</div>
                    <div className="mt-1.5 text-[14.5px] font-medium">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex items-end justify-between">
                <div>
                  <div className={cx("font-display text-5xl font-semibold tracking-tight tabular", p.who === "seller" ? "text-mint" : "text-amber")}>
                    <Counter value={parseFloat(p.price.slice(1))} format={(n) => `₹${n.toFixed(2)}`} />
                  </div>
                  <div className="mt-1 text-[12.5px] text-dim">{p.priceNote}</div>
                </div>
                <span className={cx("rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1", p.who === "seller" ? "text-mint ring-mint/30" : "text-amber ring-amber/30")}>
                  {p.saving}
                </span>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
      <p className="mt-5 max-w-3xl text-[12px] leading-relaxed text-dim">
        Example rate ₹90 per USDT, set by the two users. Card numbers from Infinia terms and SmartBuy offer as checked 4 Nov 2026: 5 points per ₹150, brand vouchers 5X, voucher bonus capped at 3,000 points a month, ₹1 per point on flights and hotels, up to ₹0.30 as statement credit.
      </p>
    </section>
  );
}

/* ========================================================== WALKTHROUGH */
const STEPS: { who: "seller" | "buyer" | "verifier"; title: string; body: string; tech: string[]; screen: () => ReactNode }[] = [
  {
    who: "seller",
    title: "The extension spots the merchant",
    body: "The seller opens Lifestyle's site. The extension recognises the merchant and compares every way to pay with crypto, including prepaid crypto cards with their real limits. Not in their region, so the NetPositive voucher route wins.",
    tech: ["Content script reads the domain only", "Crypto card catalogue with caps, staking, countries", "Merchant → voucher brand map"],
    screen: () => <ScreenDetect />,
  },
  {
    who: "seller",
    title: "Seller locks USDT and the request goes live",
    body: "The seller picks one of hundreds of suggested vouchers or types any brand and amount. Their USDT moves into escrow, so buyers know the crypto is really there.",
    tech: ["Escrow holds USDT against order ID (brand, amount, rate, deadline)", "Order appears in the buyer order book", "World ID on first use"],
    screen: () => <ScreenRequest />,
  },
  {
    who: "buyer",
    title: "The buyer's extension ranks every way to buy it",
    body: "The buyer sees the seller's request with the answer already worked out from their saved cards: which card, which channel, and how much monthly cap they have left.",
    tech: ["Card portfolio stored on device only, no card numbers", "Base rate × channel multiplier, minus caps and rounding", "Channel rates refreshed from official pages"],
    screen: () => <ScreenRoutes />,
  },
  {
    who: "buyer",
    title: "Buyer pays on the recommended route",
    body: "The extension walks the buyer through the exact route so the 5X multiplier applies. They check out on SmartBuy themselves. The reward is between them and HDFC. We never touch it.",
    tech: ["Guided steps on the bank portal", "Local record of caps used updates after purchase"],
    screen: () => <ScreenGuide />,
  },
  {
    who: "verifier",
    title: "Codes are checked live before the seller sees them",
    body: "The buyer pastes the codes. They travel encrypted to the verification layer, which checks balance and status on the issuer's page, or the merchant's own portal for jewellers and large vouchers. Only a pass moves the trade.",
    tech: ["Codes encrypted on device to the verifier key", "Verifier signs order ID, amount, status, time", "Escrow accepts only a signed pass · stretch: zkTLS proof"],
    screen: () => <ScreenVerify />,
  },
  {
    who: "seller",
    title: "Seller gets the codes, escrow pays the buyer",
    body: "Codes open only for the seller. The verifier re-checks the balance right before release, because the buyer also saw the codes. Then 111.11 USDT goes to the buyer and the 1.11 USDT fee is split.",
    tech: ["Codes re-encrypted to the seller's key", "Second check right before release", "0.56 USDT → dispute reserve · 0.55 USDT platform"],
    screen: () => <ScreenReveal />,
  },
];

function Walkthrough() {
  const [active, setActive] = useState(0);
  return (
    <section id="how" className="relative mx-auto max-w-6xl scroll-mt-24 px-6 pt-36">
      <SectionHead
        eyebrow="How it works"
        title="Six steps. Screen by screen."
        sub="One browser extension for both sides. The seller's crypto never leaves the contract until a verified voucher is in their hands."
      />
      <div className="mt-16 grid gap-10 md:grid-cols-[minmax(0,420px)_1fr] md:gap-20">
        <div className="hidden md:block">
          <div className="sticky top-28">
            <div className="relative">
              <div
                className="absolute -inset-10 rounded-full blur-[80px] transition-colors duration-700"
                style={{ background: STEPS[active].who === "buyer" ? "rgba(245,181,68,0.16)" : STEPS[active].who === "verifier" ? "rgba(139,123,255,0.18)" : "rgba(61,220,151,0.16)" }}
              />
              <Tilt max={5}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, y: 20, scale: 0.97, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -16, scale: 0.98, filter: "blur(6px)" }}
                    transition={{ duration: 0.45, ease }}
                    className="relative"
                  >
                    {STEPS[active].screen()}
                  </motion.div>
                </AnimatePresence>
              </Tilt>
            </div>
            <div className="mt-6 flex items-center gap-2">
              {STEPS.map((s, i) => (
                <span
                  key={i}
                  className={cx(
                    "h-1 flex-1 rounded-full transition-all duration-500",
                    i <= active ? (s.who === "buyer" ? "bg-amber" : s.who === "verifier" ? "bg-iris" : "bg-mint") : "bg-white/10",
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          {STEPS.map((s, i) => (
            <motion.div
              key={i}
              onViewportEnter={() => setActive(i)}
              viewport={{ amount: 0.6, margin: "-15% 0px -25% 0px" }}
              className="flex min-h-[64vh] flex-col justify-center py-10"
            >
              <div className={cx("transition-opacity duration-500", active === i ? "opacity-100" : "md:opacity-30")}>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[13px] text-dim">0{i + 1}</span>
                  <Persona who={s.who} />
                </div>
                <h3 className="mt-4 font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] md:text-[34px]">{s.title}</h3>
                <p className="mt-4 max-w-lg text-[15.5px] leading-relaxed text-mute">{s.body}</p>
                <div className="mt-6 flex max-w-lg flex-wrap gap-2">
                  {s.tech.map((t) => (
                    <span key={t} className="rounded-lg bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-mute ring-1 ring-white/[0.07]">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-8 md:hidden">{s.screen()}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================== CALCULATOR */
function Calculator() {
  const [amount, setAmount] = useState(10000);
  const [rate, setRate] = useState(90);
  const [cardIds, setCardIds] = useState<string[]>(["infinia"]);
  const [value, setValue] = useState<"travel" | "statement">("travel");

  const q = quote(amount, rate);
  const routes = useMemo(() => routesFor(amount, CARDS.filter((c) => cardIds.includes(c.id))), [amount, cardIds]);
  const sorted = [...routes].sort((a, b) => (value === "travel" ? b.pctTravel - a.pctTravel : b.pctStatement - a.pctStatement));
  const best = sorted[0];
  const reward = best ? (value === "travel" ? best.travelInr : best.statementInr) : 0;
  const eff = effectivePrice(amount, reward, q.buyerReceives);
  const max = Math.max(...sorted.map((r) => (value === "travel" ? r.pctTravel : r.pctStatement)), 1);

  const toggle = (id: string) => setCardIds((c) => (c.includes(id) ? (c.length > 1 ? c.filter((x) => x !== id) : c) : [...c, id]));

  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-36">
      <SectionHead
        eyebrow="Route engine"
        title={
          <>
            Your card is a <span className="text-amber">discount</span> on USDT.
          </>
        }
        sub="Pick a voucher size and your cards. The engine applies base rate × channel multiplier, monthly caps, per-transaction rounding and denominations, then ranks every route."
      />

      <Card className="mt-14 p-2" glow="rgba(245,181,68,0.08)">
        <div className="grid gap-2 lg:grid-cols-[1fr_1.15fr]">
          <div className="rounded-[20px] bg-white/[0.02] p-6 md:p-8">
            <Slider label="Voucher value" value={amount} min={1000} max={50000} step={500} onChange={setAmount} display={inr(amount)} />
            <div className="mt-8">
              <Slider label="Rate set in order" value={rate} min={85} max={95} step={0.1} onChange={(v) => setRate(Math.round(v * 10) / 10)} display={`₹${rate.toFixed(1)} / USDT`} />
            </div>
            <div className="mt-8">
              <div className="label mb-3">Cards in your portfolio</div>
              <div className="grid grid-cols-3 gap-2">
                {CARDS.map((c) => {
                  const on = cardIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className={cx(
                        "relative overflow-hidden rounded-xl bg-gradient-to-br p-3 text-left ring-1 transition-all duration-300",
                        c.gradient,
                        on ? "ring-amber/60 shadow-[0_0_30px_-10px_rgba(245,181,68,0.6)]" : "opacity-45 ring-white/10 hover:opacity-80",
                      )}
                    >
                      <div className="font-mono text-[9.5px] uppercase tracking-widest text-white/50">{c.issuer}</div>
                      <div className="mt-4 text-[12.5px] font-medium leading-tight">{c.name}</div>
                      <span className={cx("absolute top-2.5 right-2.5 grid size-4 place-items-center rounded-full transition", on ? "bg-amber text-ink" : "bg-white/10")}>
                        {on && <Check className="size-2.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-8">
              <div className="label mb-3">Value points as</div>
              <div className="relative grid grid-cols-2 rounded-full bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
                {(["travel", "statement"] as const).map((v) => (
                  <button key={v} onClick={() => setValue(v)} className={cx("relative z-10 h-9 rounded-full text-[13px] capitalize transition", value === v ? "text-ink" : "text-mute")}>
                    {value === v && <motion.span layoutId="valtog" className="absolute inset-0 -z-10 rounded-full bg-amber" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                    {v === "travel" ? "Flights & hotels" : "Statement credit"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col rounded-[20px] p-6 md:p-8">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="label">Buyer receives</div>
                <div className="mt-2 font-display text-4xl font-semibold tracking-tight tabular">
                  {usdt(q.buyerReceives)} <span className="text-base text-mute">USDT</span>
                </div>
              </div>
              <div>
                <div className="label">Effective price</div>
                <div className="mt-2 font-display text-4xl font-semibold tracking-tight text-amber tabular">₹{eff.toFixed(2)}</div>
                <div className="mt-1 text-[12px] text-dim">vs ₹{rate.toFixed(1)} order rate</div>
              </div>
            </div>
            <div className="mt-8 flex-1 space-y-2.5">
              <div className="label mb-1">Ranked routes</div>
              <AnimatePresence initial={false}>
                {sorted.slice(0, 5).map((r, i) => {
                  const pct = value === "travel" ? r.pctTravel : r.pctStatement;
                  return (
                    <motion.div
                      layout
                      key={r.cardId + r.channel.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      className={cx("relative overflow-hidden rounded-xl px-4 py-3 ring-1", i === 0 ? "ring-amber/40" : "ring-white/[0.06]")}
                    >
                      <motion.div
                        className={cx("absolute inset-y-0 left-0", i === 0 ? "bg-amber/[0.13]" : "bg-white/[0.035]")}
                        animate={{ width: `${(pct / max) * 100}%` }}
                        transition={{ type: "spring", stiffness: 120, damping: 20 }}
                      />
                      <div className="relative flex items-center justify-between text-[13.5px]">
                        <span className="flex items-center gap-2">
                          {i === 0 && <BadgeCheck className="size-4 text-amber" />}
                          <span className={i === 0 ? "font-medium" : "text-mute"}>
                            {r.cardLabel} · {r.channel.name}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-3">
                          <span className="hidden font-mono text-[11px] text-dim sm:inline">{r.points.toLocaleString("en-IN")} pts</span>
                          <span className={cx("font-semibold tabular", i === 0 && "text-amber")}>{pct.toFixed(2)}%</span>
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-white/[0.06] text-center">
              {[
                ["Seller locks", `${usdt(q.sellerLocks)}`],
                ["Fee (1%)", `${usdt(q.fee)}`],
                ["Buyer saves", inr(Math.round(reward))],
              ].map(([k, v]) => (
                <div key={k} className="bg-ink-2 px-2 py-3">
                  <div className="label !text-[9.5px]">{k}</div>
                  <div className="mt-1 text-[14px] font-semibold tabular">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  display: string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="font-display text-2xl font-semibold tracking-tight tabular">{display}</span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ ["--p" as string]: `${p}%` }}
      />
    </label>
  );
}

/* ================================================================ TRUST */
function Trust() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-36">
      <SectionHead
        eyebrow="Trust model"
        title="Nobody, including us, can take the crypto in between."
        sub="Every layer exists to remove one way a P2P trade goes wrong."
      />
      <div className="mt-14 grid auto-rows-[minmax(220px,auto)] gap-4 md:grid-cols-6">
        <Bento className="md:col-span-4" icon={<Lock />} tone="mint" title="USDT escrow contract" body="Seller's USDT is locked against an order ID with brand, amount, rate and deadline. It moves only on a signed pass from the verifier, or back to the seller on timeout.">
          <EscrowViz />
        </Bento>
        <Bento className="md:col-span-2" icon={<FingerprintPattern />} tone="iris" title="One human, one account" body="World ID on first use. Banned scammers can't spin up a new account.">
          <div className="mt-6 flex justify-center">
            <div className="relative grid size-24 place-items-center">
              <span className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-iris/40" />
              <span className="absolute inset-3 rounded-full border border-iris/20" />
              <span className="grid size-12 place-items-center rounded-full bg-white">
                <span className="grid size-7 place-items-center rounded-full border-[3px] border-ink">
                  <span className="size-2 rounded-full bg-ink" />
                </span>
              </span>
            </div>
          </div>
        </Bento>
        <Bento className="md:col-span-2" icon={<FileCheck />} tone="iris" title="Signed voucher checks" body="Balance and status are read from the issuer or merchant portal, signed, and checked twice: before reveal and right before release." />
        <Bento className="md:col-span-2" icon={<Smartphone />} tone="amber" title="Cards stay on device" body="Issuer, variant and caps used. Never a card number. The route engine runs locally." />
        <Bento className="md:col-span-2" icon={<KeyRound />} tone="mint" title="Codes for one key only" body="Encrypted on the buyer's device to the verifier key, re-encrypted to the seller's key, deleted after the trade." />
        <Bento className="md:col-span-3" icon={<Scale />} tone="rose" title="Dispute reserve" body="Half of every fee funds a reserve. If a voucher was spent before the seller's first use, the verifier pulls its history and refunds them from the reserve." />
        <Bento className="md:col-span-3" icon={<Cpu />} tone="iris" title="Stretch: zkTLS proofs" body="Replace our signature with a zkTLS proof of the issuer's balance page, so the escrow doesn't have to trust the verifier at all." />
      </div>
    </section>
  );
}

function Bento({
  className,
  icon,
  title,
  body,
  tone,
  children,
}: {
  className?: string;
  icon: ReactNode;
  title: string;
  body: string;
  tone: "mint" | "amber" | "iris" | "rose";
  children?: ReactNode;
}) {
  const c = { mint: "text-mint bg-mint/10 ring-mint/20", amber: "text-amber bg-amber/10 ring-amber/20", iris: "text-iris bg-iris/10 ring-iris/20", rose: "text-rose bg-rose/10 ring-rose/20" }[tone];
  const g = { mint: "rgba(61,220,151,0.12)", amber: "rgba(245,181,68,0.12)", iris: "rgba(139,123,255,0.14)", rose: "rgba(255,107,122,0.12)" }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease }}
      className={className}
    >
      <Card glow={g} className="h-full p-7">
        <span className={cx("grid size-10 place-items-center rounded-xl ring-1 [&>svg]:size-5", c)}>{icon}</span>
        <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 max-w-md text-[14px] leading-relaxed text-mute">{body}</p>
        {children}
      </Card>
    </motion.div>
  );
}

function EscrowViz() {
  const states = [
    { k: "Locked", c: "bg-mint", t: "112.22 USDT" },
    { k: "Accepted", c: "bg-fg", t: "buyer.eth" },
    { k: "Verified", c: "bg-iris", t: "sig 0x9c1f…" },
    { k: "Released", c: "bg-mint", t: "111.11 → buyer" },
  ];
  return (
    <div className="mt-7 flex items-center gap-2 overflow-x-auto scrollbar-none">
      {states.map((s, i) => (
        <motion.div
          key={s.k}
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 + i * 0.15 }}
          className="flex items-center gap-2"
        >
          <div className="min-w-[128px] rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
            <div className="flex items-center gap-1.5">
              <span className={cx("size-1.5 rounded-full", s.c)} />
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-mute">{s.k}</span>
            </div>
            <div className="mt-1.5 font-mono text-[11.5px] text-fg/80">{s.t}</div>
          </div>
          {i < states.length - 1 && <ArrowRight className="size-3.5 shrink-0 text-dim" />}
        </motion.div>
      ))}
    </div>
  );
}

/* ============================================================== COMPARE */
function Compare() {
  const cols = ["NetPositive", "P2P on exchange", "Crypto debit card"];
  const rows: [string, (boolean | string)[]][] = [
    ["Rupees between strangers", ["Never", "Every trade", "No"]],
    ["Bank freeze risk", ["Lower", "High", "Low"]],
    ["Card rewards for the buyer", [true, false, false]],
    ["Crypto held in escrow", [true, "Platform-held", false]],
    ["Verified-human counterparties", [true, "KYC only", "—"]],
    ["Fee", ["1% seller", "0–1% + spread", "1–3% + FX"]],
    ["Works in India", [true, true, "Limited"]],
  ];
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-36">
      <SectionHead eyebrow="Why this rail" title="Better for both sides than what exists today." />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, ease }}
        className="hairline mt-12 overflow-x-auto rounded-3xl bg-ink-2/60"
      >
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line">
              <th className="p-5 font-normal text-mute" />
              {cols.map((c, i) => (
                <th key={c} className={cx("p-5 font-medium", i === 0 ? "bg-mint/[0.05] text-mint" : "text-mute")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, vals]) => (
              <tr key={k} className="border-b border-line last:border-0">
                <td className="p-5 text-mute">{k}</td>
                {vals.map((v, i) => (
                  <td key={i} className={cx("p-5", i === 0 && "bg-mint/[0.05]")}>
                    {v === true ? <Check className={cx("size-4", i === 0 ? "text-mint" : "text-fg/70")} /> : v === false ? <X className="size-4 text-dim" /> : <span className={i === 0 ? "font-medium text-fg" : "text-mute"}>{v}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </section>
  );
}

/* =============================================================== LIMITS */
function Limits() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-28">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="flex flex-col gap-6 rounded-3xl border border-dashed border-amber/30 bg-amber/[0.03] p-7 md:flex-row md:items-center md:p-9"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber/10 text-amber ring-1 ring-amber/20">
          <TriangleAlert className="size-5" />
        </span>
        <div className="flex-1">
          <div className="label !text-amber">Limits we say out loud</div>
          <p className="mt-2 text-[15.5px] leading-relaxed text-fg/90">
            Escrow, World ID and live checks cut fraud and repeat offenders. A voucher can still be spent by the person who bought it in the seconds between check and use, which is why we re-check right before release and keep a dispute reserve.
          </p>
        </div>
      </motion.div>
    </section>
  );
}

/* ============================================================ FINAL CTA */
function FinalCta() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-36">
      <div className="hairline relative overflow-hidden rounded-[36px] bg-ink-2 px-6 py-20 text-center md:py-28">
        <Aurora className="opacity-80" />
        <div className="grid-bg absolute inset-0 opacity-60" />
        <div className="relative">
          <div className="mx-auto mb-8 flex w-fit items-center gap-3 rounded-full bg-white/[0.04] p-1.5 pr-4 ring-1 ring-white/10">
            <ShieldCheck className="ml-1.5 size-4 text-mint" />
            <span className="text-[13px] text-mute">Try the full trade as seller and buyer</span>
          </div>
          <h2 className="text-gradient mx-auto max-w-3xl font-display text-5xl font-semibold leading-[1] tracking-[-0.04em] md:text-7xl">Your crypto, at the checkout.</h2>
          <p className="mx-auto mt-6 max-w-lg text-[16px] text-mute">Post a voucher request in under a minute, or fill one and earn USDT on rewards you were leaving on the table.</p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" to="/trade/VR-24817" icon={<ArrowUpRight className="size-4" />}>
              Watch a live trade
            </Button>
            <Button size="lg" variant="outline" to="/market">
              Open the market
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
