import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, Lock, Search, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AssistantBar } from "../components/AssistantBar";
import { Aurora, BrandMark, Button, cx } from "../components/ui";
import { BRANDS, brand, findBrand } from "../lib/data";
import { chatbot } from "../lib/chatbot";
import { inr, quote, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

const PRESETS = [2000, 5000, 10000];
const MEDIAN = 89.9;

export default function Spend() {
  const { balance, humanVerified, openWallet, postOrder, toast, myOrders } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [brandId, setBrandId] = useState("lifestyle");
  const [amount, setAmount] = useState(10000);
  const [rate, setRate] = useState(90);
  const [review, setReview] = useState(false);

  const cats = useMemo(() => ["All", ...Array.from(new Set(BRANDS.map((b) => b.category)))], []);
  const list = useMemo(
    () => BRANDS.filter((b) => (cat === "All" || b.category === cat) && (b.name + b.category).toLowerCase().includes(q.toLowerCase())),
    [q, cat],
  );
  const b = brand(brandId);
  const qt = quote(amount || 0, rate || 1);
  const short = qt.sellerLocks > balance;
  const mine = myOrders.filter((o) => o.role === "requester").slice(0, 3);

  const lock = () => {
    if (!humanVerified) {
      toast({ title: "Verify you're human first", body: "World ID is required once before you lock USDC.", tone: "iris" });
      openWallet();
      return;
    }
    const o = postOrder({ brandId, amount, rate }, qt.sellerLocks);
    setReview(false);
    toast({ title: "Request is live", body: `${usdt(qt.sellerLocks)} USDC locked in escrow · ${o.id}`, tone: "mint" });
    nav("/track");
  };

  return (
    <div className="relative pt-28 pb-10">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto grid max-w-6xl gap-5 px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <section className="hairline rounded-[24px] bg-ink-2/70 p-5 backdrop-blur-xl md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h1 className="text-[17px] font-semibold tracking-tight">Choose a voucher</h1>
                <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-mute">{BRANDS.length}</span>
              </div>
              <label className="flex h-9 items-center gap-2 rounded-full bg-white/[0.03] px-3.5 text-[13px] ring-1 ring-white/[0.07] focus-within:ring-mint/40">
                <Search className="size-3.5 text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brands" className="w-36 bg-transparent outline-none placeholder:text-dim" aria-label="Search brands" />
              </label>
            </div>

            <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto">
              {cats.map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={cx("shrink-0 rounded-full px-3 py-1 text-[12px] ring-1 transition", cat === c ? "bg-white text-ink ring-white" : "text-mute ring-white/10 hover:text-fg")}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {list.map((x) => {
                const on = x.id === brandId;
                return (
                  <button
                    key={x.id}
                    onClick={() => setBrandId(x.id)}
                    className={cx(
                      "group relative rounded-2xl p-4 text-left ring-1 transition",
                      on ? "bg-mint/[0.06] ring-mint/50" : "bg-white/[0.025] ring-white/[0.07] hover:bg-white/[0.05] hover:ring-white/15",
                    )}
                  >
                    {on ? (
                      <span className="absolute top-3.5 right-3.5 grid size-4 place-items-center rounded-full bg-mint text-ink">
                        <Check className="size-2.5" />
                      </span>
                    ) : (
                      <ArrowUpRight className="absolute top-4 right-4 size-3.5 text-dim transition group-hover:text-fg" />
                    )}
                    <BrandMark id={x.id} size={30} />
                    <div className="mt-4 truncate text-[14px] font-medium">{x.name}</div>
                    <div className="text-[11.5px] text-dim">{x.category}</div>
                  </button>
                );
              })}
            </div>
            {list.length === 0 && <div className="py-10 text-center text-[13px] text-mute">No brands match. Ask the assistant below.</div>}

            {mine.length > 0 && (
              <div className="mt-6 border-t border-white/[0.06] pt-4">
                <div className="mb-2 flex items-center justify-between text-[12px]">
                  <span className="text-dim">Your recent requests</span>
                  <Link to="/track" className="flex items-center gap-1 text-mute hover:text-fg">
                    Track all <ArrowUpRight className="size-3" />
                  </Link>
                </div>
                {mine.map((o) => (
                  <Link key={o.id} to="/track" className="flex items-center gap-3 rounded-xl px-2 py-2 text-[13px] transition hover:bg-white/[0.03]">
                    <BrandMark id={o.brandId} size={24} />
                    <span className="flex-1">
                      {brand(o.brandId).name} {inr(o.amount)}
                    </span>
                    <span className="font-mono text-[11px] text-dim">{o.id}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <AssistantBar
            role="seller"
            placeholder="What do you want to buy? e.g. Nike shoes"
            chips={[
              { label: "Nike shoes", ask: "Nike shoes" },
              { label: "Groceries", ask: "groceries" },
              { label: "How fees work", ask: "How do fees work?" },
            ]}
            intercept={async (t) => {
              if (/fee/i.test(t)) return "You pay a 1% fee, taken from the USDC you lock. The buyer pays nothing. If nobody fills your request in 30 minutes, your USDC comes back automatically.";
              const s = await chatbot.suggest(t);
              const tiles = (s.mode === "store_locked" ? [s.selected, ...(s.alternatives ?? [])] : s.tiles ?? []).filter(Boolean).filter((x) => x!.voucher_brand);
              if (!tiles.length) return null;
              return (
                <div>
                  <div>Stores that take vouchers{s.item ? ` for ${s.item}` : ""}:</div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {tiles.map((x) => {
                      const known = findBrand(x!.merchant_id);
                      return (
                        <button
                          key={x!.merchant_id}
                          disabled={!known}
                          onClick={() => known && setBrandId(known.id)}
                          className="flex items-center gap-2 rounded-xl bg-white/[0.04] py-1.5 pr-3 pl-1.5 text-[13px] ring-1 ring-white/10 transition enabled:hover:ring-mint/40 disabled:opacity-50"
                        >
                          <BrandMark id={x!.merchant_id} name={x!.name} size={22} /> {x!.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="hairline rounded-[24px] bg-ink-2/80 p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[22px] font-semibold tracking-tight">Spend USDC</h2>
              <span className="grid size-8 place-items-center rounded-full bg-[#2775ca] font-display text-[13px] font-bold text-white" aria-hidden>
                $
              </span>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
              <BrandMark id={brandId} size={38} />
              <div className="min-w-0">
                <div className="text-[14px] font-medium">{b.name} voucher</div>
                <div className="truncate font-mono text-[11px] text-dim">{b.domains[0]}</div>
              </div>
            </div>

            <div className="mt-5 text-[12.5px] text-mute">Voucher value</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-3xl text-mute">₹</span>
              <input
                type="number"
                value={amount || ""}
                onChange={(e) => setAmount(Math.max(0, Math.min(200000, parseInt(e.target.value || "0"))))}
                className="w-full min-w-0 bg-transparent font-display text-[44px] leading-none font-semibold tracking-tight outline-none tabular"
                aria-label="Voucher value in rupees"
              />
              <span className="text-[12px] text-dim">INR</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={cx("h-9 rounded-xl text-[12.5px] ring-1 transition tabular", amount === p ? "bg-mint/10 text-mint ring-mint/40" : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20")}
                >
                  {inr(p)}
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2.5 ring-1 ring-white/[0.07]">
              <span className="text-[12.5px] text-mute">Your rate</span>
              <span className="flex items-center gap-1 text-[14px] tabular">
                ₹
                <input type="number" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} className="w-14 bg-transparent text-right outline-none" aria-label="Rupees per USDC" />
                <span className="text-[11px] text-dim">/ USDC</span>
              </span>
            </div>
            <div className="mt-1.5 text-right font-mono text-[10.5px] text-dim">median ₹{MEDIAN}</div>

            <div className="mt-4 text-[12.5px] text-mute">You lock</div>
            <div className="mt-2 flex items-baseline gap-2">
              <motion.span key={qt.sellerLocks} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[40px] leading-none font-semibold tracking-tight text-mint tabular">
                {usdt(qt.sellerLocks)}
              </motion.span>
              <span className="text-[12px] text-dim">USDC</span>
            </div>

            <div className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-mute">Buyer receives</span>
                <span className="tabular">{usdt(qt.buyerReceives)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">Fee (1%)</span>
                <span className="tabular">{usdt(qt.fee)} USDC</span>
              </div>
            </div>

            <Button className="mt-5 w-full" size="lg" disabled={!amount || short || !rate} onClick={() => setReview(true)} icon={<ArrowRight className="size-4" />}>
              {short ? "Not enough USDC" : "Review & lock"}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[12px] text-dim">
              <ShieldCheck className="size-3.5 text-mint" /> Released only after the voucher checks out.
            </p>
          </div>
        </aside>
      </div>

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
              <div className="mt-5 flex items-center gap-3">
                <BrandMark id={brandId} size={44} />
                <div className="flex-1">
                  <div className="text-[15px] font-semibold">{b.name} voucher</div>
                  <div className="text-[12px] text-mute">₹{rate} / USDC</div>
                </div>
                <div className="font-display text-2xl font-semibold tabular">{inr(amount)}</div>
              </div>
              <div className="mt-5 space-y-2 rounded-2xl bg-white/[0.02] p-4 text-[13px] ring-1 ring-white/[0.06]">
                {[
                  ["You lock", `${usdt(qt.sellerLocks)} USDC`],
                  ["Buyer receives", `${usdt(qt.buyerReceives)} USDC`],
                  ["Fee (1%)", `${usdt(qt.fee)} USDC`],
                  ["Window", "30 min, then auto-refund"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-mute">{k}</span>
                    <span className="tabular">{v}</span>
                  </div>
                ))}
              </div>
              <Button className="mt-5 w-full" size="lg" onClick={lock} icon={<Lock className="size-4" />}>
                {humanVerified ? `Lock ${usdt(qt.sellerLocks)} USDC` : "Verify with World ID to lock"}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
