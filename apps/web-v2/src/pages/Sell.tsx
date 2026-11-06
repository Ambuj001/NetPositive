import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Globe, LoaderCircle, Lock, Search, ShieldCheck, Sparkles, Timer, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Aurora, BrandMark, Button, Card, Pill, Row, cx } from "../components/ui";
import { BRANDS, brand } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

const PRESETS = [2000, 5000, 10000, 25000];
const MEDIAN = 89.9;

export default function Sell() {
  const { address, humanVerified, openWallet, balance, postOrder, toast } = useApp();
  const nav = useNavigate();
  const [brandId, setBrandId] = useState("lifestyle");
  const [amount, setAmount] = useState(10000);
  const [rate, setRate] = useState(90);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "approve" | "lock" | "done">("idle");
  const [posted, setPosted] = useState<string | null>(null);

  const b = brand(brandId);
  const q = quote(amount || 0, rate || 1);
  const short = q.sellerLocks > balance;
  const filtered = useMemo(
    () => BRANDS.filter((x) => (x.name + x.category).toLowerCase().includes(query.toLowerCase())),
    [query],
  );
  const rateDelta = ((rate - MEDIAN) / MEDIAN) * 100;

  const lock = () => {
    if (!address) return openWallet();
    if (!humanVerified) return openWallet();
    setPhase("approve");
    setTimeout(() => setPhase("lock"), 1300);
    setTimeout(() => {
      const o = postOrder({ brandId, amount, rate }, q.sellerLocks);
      setPosted(o.id);
      setPhase("done");
      toast({ title: "Request is live", body: `${usdt(q.sellerLocks)} USDT locked in escrow · ${o.id}`, tone: "mint" });
    }, 2900);
  };

  const cta = !address ? "Connect wallet" : !humanVerified ? "Verify with World ID" : short ? "Not enough USDT" : `Lock ${usdt(q.sellerLocks)} USDT`;

  return (
    <div className="relative pt-32">
      <Aurora className="h-[60vh] opacity-60" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Pill tone="mint">Seller · has crypto</Pill>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Pay for any shop with crypto</h1>
            <p className="mt-3 max-w-xl text-[15.5px] text-mute">Choose a voucher, set your rate, lock USDT. A verified buyer fills it with their card and you get live, checked codes.</p>
          </div>
          <DetectedSite brandId={brandId} />
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* LEFT: form */}
          <div className="space-y-6">
            <Card className="p-6 md:p-7">
              <StepTitle n={1} title="Voucher brand" />
              <div className="relative mt-5">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-dim" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search hundreds of brands, or type any brand"
                  className="h-12 w-full rounded-2xl bg-white/[0.03] pr-4 pl-11 text-[14px] ring-1 ring-white/[0.07] outline-none transition placeholder:text-dim focus:ring-mint/40"
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {filtered.map((x) => {
                  const on = x.id === brandId;
                  return (
                    <button
                      key={x.id}
                      onClick={() => setBrandId(x.id)}
                      className={cx(
                        "relative flex flex-col items-start gap-3 rounded-2xl p-3 text-left ring-1 transition-all duration-300",
                        on ? "bg-mint/[0.06] ring-mint/50" : "bg-white/[0.02] ring-white/[0.06] hover:bg-white/[0.05] hover:ring-white/15",
                      )}
                    >
                      <BrandMark id={x.id} size={32} />
                      <div>
                        <div className="text-[13px] font-medium leading-tight">{x.name}</div>
                        <div className="text-[11px] text-dim">{x.category}</div>
                      </div>
                      {on && (
                        <motion.span layoutId="brand-check" className="absolute top-2.5 right-2.5 grid size-4 place-items-center rounded-full bg-mint text-ink">
                          <Check className="size-2.5" />
                        </motion.span>
                      )}
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-4 text-[13px] text-mute">
                    No match. Custom brand <span className="text-fg">"{query}"</span> will be posted for buyers to fill.
                  </div>
                )}
              </div>
              {b.merchantPortal && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-iris/[0.06] p-3 text-[12.5px] text-mute ring-1 ring-iris/20">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-iris" />
                  High-value brand. Codes are verified on {b.name}'s own portal, not the issuer page.
                </div>
              )}
            </Card>

            <Card className="p-6 md:p-7">
              <StepTitle n={2} title="Amount" />
              <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/[0.03] p-2 pl-5 ring-1 ring-white/[0.07] focus-within:ring-mint/40">
                <span className="font-display text-3xl text-mute">₹</span>
                <input
                  type="number"
                  value={amount || ""}
                  onChange={(e) => setAmount(Math.max(0, Math.min(200000, parseInt(e.target.value || "0"))))}
                  className="h-14 w-full bg-transparent font-display text-3xl font-semibold tracking-tight outline-none tabular"
                  aria-label="Voucher amount in rupees"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setAmount(p)}
                    className={cx("rounded-full px-3.5 py-1.5 text-[12.5px] ring-1 transition", amount === p ? "bg-white text-ink ring-white" : "text-mute ring-white/10 hover:text-fg hover:ring-white/25")}
                  >
                    {inr(p)}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-6 md:p-7">
              <div className="flex items-center justify-between">
                <StepTitle n={3} title="Your rate" />
                <span className="font-mono text-[11px] text-dim">median live: ₹{MEDIAN}</span>
              </div>
              <div className="mt-6 flex items-center gap-4">
                <button onClick={() => setRate((r) => Math.round((r - 0.1) * 10) / 10)} className="grid size-11 place-items-center rounded-full text-xl ring-1 ring-white/10 hover:bg-white/5" aria-label="Lower rate">
                  −
                </button>
                <div className="flex-1 text-center">
                  <div className="font-display text-5xl font-semibold tracking-tight tabular">₹{rate.toFixed(1)}</div>
                  <div className="mt-1 text-[12px] text-mute">per USDT</div>
                </div>
                <button onClick={() => setRate((r) => Math.round((r + 0.1) * 10) / 10)} className="grid size-11 place-items-center rounded-full text-xl ring-1 ring-white/10 hover:bg-white/5" aria-label="Raise rate">
                  +
                </button>
              </div>
              <div className="relative mt-6 h-1.5 rounded-full bg-gradient-to-r from-rose/50 via-mint/60 to-amber/50">
                <motion.span
                  className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.15)]"
                  animate={{ left: `${Math.min(100, Math.max(0, ((rate - 87) / 6) * 100))}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              </div>
              <div className="mt-3 flex justify-between font-mono text-[10.5px] text-dim">
                <span>slow fill</span>
                <span className={cx(Math.abs(rateDelta) < 0.6 ? "text-mint" : rateDelta > 0 ? "text-amber" : "text-rose")}>
                  {Math.abs(rateDelta) < 0.6 ? "fills in ~4 min" : rateDelta > 0 ? "fills fast · costs you more" : "below market · may not fill"}
                </span>
                <span>instant</span>
              </div>
            </Card>
          </div>

          {/* RIGHT: receipt */}
          <div className="lg:sticky lg:top-28 lg:self-start">
            <div className="hairline relative overflow-hidden rounded-[28px] bg-ink-2">
              <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(70%_100%_at_50%_0%,rgba(61,220,151,0.2),transparent)]" />
              <div className="relative p-6">
                <div className="flex items-center justify-between">
                  <span className="label">Your request</span>
                  <span className="flex items-center gap-1.5 font-mono text-[11px] text-dim">
                    <Timer className="size-3.5" /> 30 min window
                  </span>
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <BrandMark id={brandId} size={48} />
                  <div>
                    <div className="text-[17px] font-semibold">{b.name}</div>
                    <div className="font-display text-2xl font-semibold tracking-tight tabular">{inr(amount || 0)}</div>
                  </div>
                </div>
                <div className="mt-5 divide-y divide-white/[0.06]">
                  <Row k="Rate" v={`₹${rate.toFixed(1)} / USDT`} />
                  <Row k="Buyer receives" v={`${usdt(q.buyerReceives)} USDT`} />
                  <Row k="Fee (1%)" v={`${usdt(q.fee)} USDT`} />
                  <Row k="Your effective rate" v={`₹${q.sellerEffective.toFixed(2)}`} />
                </div>
              </div>
              <div className="relative border-t border-dashed border-white/10 p-6">
                <span className="absolute -top-3 -left-3 size-6 rounded-full bg-ink" />
                <span className="absolute -top-3 -right-3 size-6 rounded-full bg-ink" />
                <div className="flex items-baseline justify-between">
                  <span className="text-[14px] text-mute">You lock</span>
                  <span className="font-display text-3xl font-semibold tracking-tight text-mint tabular">
                    {usdt(q.sellerLocks)} <span className="text-sm text-mute">USDT</span>
                  </span>
                </div>
                <div className="mt-1 text-right font-mono text-[11px] text-dim">balance {usdt(balance)} USDT</div>

                <AnimatePresence mode="wait">
                  {phase === "done" && posted ? (
                    <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-3">
                      <div className="flex items-center gap-3 rounded-2xl bg-mint/[0.08] p-3.5 ring-1 ring-mint/30">
                        <span className="grid size-9 place-items-center rounded-full bg-mint text-ink">
                          <Check className="size-4" />
                        </span>
                        <div>
                          <div className="text-[14px] font-medium">Live in the order book</div>
                          <div className="font-mono text-[11px] text-mute">{posted} · tx 0x4be1…77d0</div>
                        </div>
                      </div>
                      <Button className="w-full" onClick={() => nav(`/trade/${posted}`)} icon={<ArrowRight className="size-4" />}>
                        Follow the trade
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div key="cta" className="mt-5">
                      {phase !== "idle" ? (
                        <div className="space-y-2">
                          {[
                            ["approve", "Approve USDT spend"],
                            ["lock", "Lock in escrow contract"],
                          ].map(([k, label]) => {
                            const doneStep = k === "approve" && phase === "lock";
                            const on = phase === k;
                            return (
                              <div key={k} className={cx("flex items-center gap-3 rounded-xl p-3 ring-1 transition", on ? "ring-mint/40 bg-mint/[0.05]" : "ring-white/[0.06]")}>
                                <span className={cx("grid size-6 place-items-center rounded-full", doneStep ? "bg-mint text-ink" : on ? "text-mint" : "text-dim")}>
                                  {doneStep ? <Check className="size-3.5" /> : on ? <LoaderCircle className="size-4 animate-spin" /> : <Lock className="size-3.5" />}
                                </span>
                                <span className={cx("text-[13.5px]", on || doneStep ? "text-fg" : "text-dim")}>{label}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <Button className="w-full" size="lg" disabled={!!address && humanVerified && (short || !amount)} onClick={lock} icon={address && humanVerified ? <Lock className="size-4" /> : undefined}>
                          {cta}
                        </Button>
                      )}
                      <div className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-dim">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-mint" />
                        Released only after a signed voucher check. If nobody fills it in 30 min, the USDT returns to you automatically.
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-6 place-items-center rounded-full bg-white/[0.06] font-mono text-[11px] text-mint ring-1 ring-white/10">{n}</span>
      <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function DetectedSite({ brandId }: { brandId: string }) {
  const b = brand(brandId);
  return (
    <div className="glass flex w-full max-w-sm items-center gap-3 rounded-2xl p-3 md:w-auto">
      <span className="grid size-9 place-items-center rounded-xl bg-white/[0.05] text-mute">
        <Globe className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] text-fg/80">{b.domains[0]}</div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-mute">
          <Sparkles className="size-3 text-mint" /> Extension: NetPositive voucher is best here
        </div>
      </div>
      <div className="hidden items-center gap-1 rounded-lg bg-white/[0.03] px-2 py-1 text-[10.5px] text-dim ring-1 ring-white/[0.06] sm:flex" title="Crypto.com Visa is not available in your region">
        <TriangleAlert className="size-3 text-amber" /> card n/a
      </div>
    </div>
  );
}
