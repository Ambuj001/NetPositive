import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, BadgeCheck, Clock, CreditCard, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Aurora, BrandMark, Button, Card, Counter, Pill, cx } from "../components/ui";
import { brand } from "../lib/data";
import { CARDS, effectivePrice, inr, quote, routesFor, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

const CATS = ["All", "Fashion", "Everything", "Electronics", "Travel", "Jewellery", "Food", "Beauty"];
type Sort = "saving" | "size" | "new";

export default function Market() {
  const { orders } = useApp();
  const nav = useNavigate();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("saving");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    const enriched = orders.map((o) => {
      const qt = quote(o.amount, o.rate);
      const best = routesFor(o.amount)[0];
      const eff = effectivePrice(o.amount, best.travelInr, qt.buyerReceives);
      return { o, qt, best, eff, b: brand(o.brandId) };
    });
    return enriched
      .filter((r) => (cat === "All" || r.b.category === cat) && (r.b.name + r.o.seller).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (sort === "saving" ? b.best.pctTravel - a.best.pctTravel || a.eff - b.eff : sort === "size" ? b.o.amount - a.o.amount : a.o.postedMin - b.o.postedMin));
  }, [orders, cat, q, sort]);

  const totalUsdt = rows.reduce((s, r) => s + r.qt.sellerLocks, 0);
  const infinia = CARDS[0];

  return (
    <div className="relative pt-32">
      <Aurora className="h-[50vh] opacity-50" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <Pill tone="amber">Buyer · wants crypto</Pill>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Buy USDC below market</h1>
            <p className="mt-3 max-w-xl text-[15.5px] text-mute">
              Every request is already locked in escrow. We rank each one against the cards saved on your device, so you see your real price per USDC.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06]">
            {[
              { k: "In escrow", v: <Counter value={totalUsdt} format={(n) => `${Math.round(n).toLocaleString("en-US")}`} />, s: "USDC" },
              { k: "Open orders", v: <Counter value={rows.length} />, s: "live" },
              { k: "Median fill", v: "4m 12s", s: "" },
            ].map((x) => (
              <div key={x.k} className="bg-ink-2 px-5 py-4">
                <div className="label">{x.k}</div>
                <div className="mt-1 font-display text-xl font-semibold tabular">
                  {x.v} <span className="text-[11px] font-normal text-dim">{x.s}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-dim" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search brand or seller"
                  className="h-11 w-full rounded-full bg-white/[0.03] pr-4 pl-11 text-[14px] ring-1 ring-white/[0.07] outline-none placeholder:text-dim focus:ring-amber/40"
                />
              </div>
              <div className="flex rounded-full bg-white/[0.03] p-1 ring-1 ring-white/[0.07]">
                {(
                  [
                    ["saving", "Best for me"],
                    ["size", "Largest"],
                    ["new", "Newest"],
                  ] as [Sort, string][]
                ).map(([k, l]) => (
                  <button key={k} onClick={() => setSort(k)} className={cx("relative h-9 rounded-full px-4 text-[12.5px] transition", sort === k ? "text-ink" : "text-mute hover:text-fg")}>
                    {sort === k && <motion.span layoutId="sort" className="absolute inset-0 rounded-full bg-amber" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                    <span className="relative">{l}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1">
              {CATS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={cx("shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] ring-1 transition", cat === c ? "bg-white text-ink ring-white" : "text-mute ring-white/10 hover:text-fg")}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="mt-6 hidden grid-cols-[1.6fr_1fr_1fr_1fr_120px] gap-4 px-5 pb-2 md:grid">
              {["Voucher", "You receive", "Best route", "Your price", ""].map((h) => (
                <span key={h} className="label">
                  {h}
                </span>
              ))}
            </div>
            <motion.div layout className="space-y-2">
              <AnimatePresence initial={false}>
                {rows.map(({ o, qt, best, eff, b }, i) => {
                  const secs = Math.max(0, o.expiresMin * 60 - tick);
                  return (
                    <motion.div
                      key={o.id}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      onClick={() => nav(`/trade/${o.id}`)}
                      className="group hairline relative grid cursor-pointer grid-cols-2 items-center gap-4 rounded-2xl bg-ink-2/70 p-4 transition hover:bg-white/[0.035] md:grid-cols-[1.6fr_1fr_1fr_1fr_120px] md:px-5"
                    >
                      <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                        <BrandMark id={o.brandId} size={42} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold">{b.name}</span>
                            <span className="font-display text-[15px] font-semibold tabular text-fg/80">{inr(o.amount)}</span>
                            {o.seller === "you" && <Pill tone="mint">yours</Pill>}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-dim">
                            <ShieldCheck className="size-3 text-mint" />
                            <span className="font-mono">{o.seller}</span>· {o.sellerTrades} trades · ₹{o.rate}/USDC
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="label md:hidden">You receive</div>
                        <div className="text-[15px] font-semibold tabular">{usdt(qt.buyerReceives)} <span className="text-[11px] text-dim">USDC</span></div>
                      </div>
                      <div>
                        <div className="label md:hidden">Best route</div>
                        <div className="flex items-center gap-1.5 text-[13px]">
                          <CreditCard className="size-3.5 text-amber" />
                          <span className="truncate text-mute">{best.channel.name}</span>
                        </div>
                        <div className="text-[13px] font-semibold text-amber tabular">+{best.pctTravel.toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="label md:hidden">Your price</div>
                        <div className="font-display text-[18px] font-semibold tabular">₹{eff.toFixed(2)}</div>
                        <div className="flex items-center gap-1 font-mono text-[10.5px] text-dim">
                          <Clock className="size-3" /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
                        </div>
                      </div>
                      <div className="col-span-2 md:col-span-1 md:text-right">
                        <span className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-white/[0.05] px-4 text-[13px] font-medium ring-1 ring-white/10 transition group-hover:bg-amber group-hover:text-ink group-hover:ring-amber md:w-auto">
                          Fill <ArrowRight className="size-3.5" />
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {rows.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-mute">No orders match. Try another category.</div>}
            </motion.div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
            <Card glow="rgba(245,181,68,0.1)" className="p-5">
              <div className="flex items-center justify-between">
                <span className="label">Ranking with</span>
                <Link to="/cards" className="flex items-center gap-1 text-[12px] text-mute hover:text-fg">
                  Manage <ArrowUpRight className="size-3" />
                </Link>
              </div>
              <div className={cx("relative mt-4 aspect-[1.586] overflow-hidden rounded-2xl bg-gradient-to-br p-4 ring-1 ring-white/10", infinia.gradient)}>
                <div className="absolute -top-10 -right-10 size-40 rounded-full bg-white/5 blur-2xl" />
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-white/50">
                  <span>{infinia.issuer}</span>
                  <span>Metal</span>
                </div>
                <div className="absolute bottom-4 left-4">
                  <div className="font-display text-xl font-semibold">{infinia.name}</div>
                  <div className="font-mono text-[10px] text-white/40">no card number stored</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-[12px]">
                  <span className="text-mute">SmartBuy bonus left</span>
                  <span className="tabular">3,000 / 3,000</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div className="h-full rounded-full bg-amber" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
                </div>
                <p className="mt-3 text-[11.5px] leading-relaxed text-dim">Resets on the 1st. Orders above ~₹22,500 hit the cap and drop to base rate.</p>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                <BadgeCheck className="size-4 text-mint" /> Why it's safe to fill
              </div>
              <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-mute">
                <li>Seller's USDC is already in escrow before you see the order.</li>
                <li>You only spend on your card after accepting, and the contract holds the USDC for you.</li>
                <li>Payout follows the verifier's signed pass, or 30 min after it automatically.</li>
              </ul>
            </Card>
            <Button variant="outline" className="w-full" to="/trade/VR-24817">
              Watch the demo trade
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
}
