import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CircleAlert, CreditCard, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AssistantBar } from "../components/AssistantBar";
import { BrandMark, Button, cx } from "../components/ui";
import { brand } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";
import { useOrderBook, type Source } from "../lib/orderbook";
import { useApp } from "../lib/store";
import type { Order } from "../lib/data";

const PRESETS = [5000, 10000, 25000];

/** Whole vouchers only: pick orders (best rate first) whose total stays within the spend. */
export function matchOrders(orders: Order[], spend: number, maxRate?: number) {
  const pool = orders.filter((o) => o.seller !== "you" && (!maxRate || o.rate <= maxRate)).sort((a, b) => a.rate - b.rate || b.amount - a.amount);
  // Prefer an exact single match, then fill greedily.
  const exact = pool.find((o) => o.amount === spend);
  if (exact) return [exact];
  const picked: Order[] = [];
  let left = spend;
  for (const o of pool) {
    if (o.amount <= left) {
      picked.push(o);
      left -= o.amount;
    }
  }
  return picked;
}

/** The buy side: order book, assistant bar and the buy panel. Shown in the Buy tab of the Trade page. */
export function BuyView() {
  const { orders, source, reload } = useOrderBook();
  const { acceptOrder } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [spend, setSpend] = useState(10000);
  const [limit, setLimit] = useState(90);
  const [review, setReview] = useState(false);

  const open = useMemo(() => orders.filter((o) => o.seller !== "you"), [orders]);
  const rows = useMemo(() => open.filter((o) => brand(o.brandId).name.toLowerCase().includes(q.toLowerCase())), [open, q]);
  const featured = useMemo(() => {
    const seen = new Set<string>();
    return open.filter((o) => (seen.has(o.brandId) ? false : (seen.add(o.brandId), true))).slice(0, 4);
  }, [open]);

  const matched = useMemo(() => matchOrders(open, spend, tab === "limit" ? limit : undefined), [open, spend, tab, limit]);
  const matchedInr = matched.reduce((s, o) => s + o.amount, 0);
  const receive = matched.reduce((s, o) => s + quote(o.amount, o.rate).buyerReceives, 0);

  const go = (o: Order) => {
    acceptOrder(o);
    nav(`/trade/${o.id}`);
  };

  return (
    <div className="relative">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------------------------------------------- order book */}
        <div className="min-w-0 space-y-4">
          <section className="hairline rounded-[24px] bg-ink-2/70 p-5 backdrop-blur-xl md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h1 className="text-[17px] font-semibold tracking-tight">Available orders</h1>
                <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-mute">{open.length}</span>
                <SourceTag source={source} onRetry={reload} />
              </div>
              <label className="flex h-9 items-center gap-2 rounded-full bg-white/[0.03] px-3.5 text-[13px] ring-1 ring-white/[0.07] focus-within:ring-mint/40">
                <Search className="size-3.5 text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vouchers" className="w-36 bg-transparent outline-none placeholder:text-dim" aria-label="Search vouchers" />
              </label>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {featured.map((o) => {
                const b = brand(o.brandId);
                return (
                  <button
                    key={o.brandId}
                    onClick={() => setQ(b.name)}
                    className="group relative rounded-2xl bg-white/[0.025] p-4 text-left ring-1 ring-white/[0.07] transition hover:bg-white/[0.05] hover:ring-white/15"
                  >
                    <ArrowUpRight className="absolute top-4 right-4 size-3.5 text-dim transition group-hover:text-fg" />
                    <BrandMark id={o.brandId} size={30} />
                    <div className="mt-4 text-[14px] font-medium">{b.name}</div>
                    <div className="text-[11.5px] text-dim">{b.category}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11.5px] text-dim">
                    <th className="pb-3 font-normal">Voucher</th>
                    <th className="pb-3 text-right font-normal">Value</th>
                    <th className="pb-3 text-right font-normal">You receive</th>
                    <th className="pb-3 text-right font-normal">Rate / USDC</th>
                    <th className="w-10 pb-3" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {rows.map((o) => {
                      const b = brand(o.brandId);
                      const isMatch = matched.some((m) => m.id === o.id);
                      return (
                        <motion.tr
                          key={o.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => go(o)}
                          className={cx("group cursor-pointer border-b border-white/[0.05] transition last:border-0 hover:bg-white/[0.03]", isMatch && "bg-mint/[0.035]")}
                        >
                          <td className="py-3.5">
                            <span className="flex items-center gap-3">
                              <BrandMark id={o.brandId} size={30} />
                              <span className="font-medium">{b.name}</span>
                              {isMatch && <span className="rounded-full bg-mint/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-mint uppercase">match</span>}
                            </span>
                          </td>
                          <td className="py-3.5 text-right text-mute tabular">{inr(o.amount)}</td>
                          <td className="py-3.5 text-right tabular">
                            <span className="font-medium">{usdt(quote(o.amount, o.rate).buyerReceives)}</span> <span className="text-[10px] text-dim">USDC</span>
                          </td>
                          <td className="py-3.5 text-right text-mute tabular">₹{o.rate.toFixed(2)}</td>
                          <td className="py-3.5 text-right">
                            <ArrowUpRight className="ml-auto size-3.5 text-dim transition group-hover:text-mint" />
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
              {rows.length === 0 && <div className="py-10 text-center text-[13px] text-mute">{open.length ? "No vouchers match your search." : "No open orders right now."}</div>}
            </div>
            <p className="mt-4 text-[11.5px] text-dim">Whole vouchers. No partial fills.</p>
          </section>

          <AssistantBar
            role="buyer"
            placeholder="Find an order, or ask about your cards…"
            chips={[
              { label: "Buy ₹10,000", ask: "buy 10000" },
              { label: "Compare my cards", on: () => nav("/cards") },
              { label: "How fees work", ask: "How do fees work?" },
            ]}
            intercept={(t) => {
              const m = t.match(/(?:buy|spend)?\s*₹?\s*([\d,]+)\s*(k)?/i);
              if (/^(buy|spend)\b/i.test(t) && m) {
                const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
                if (n > 0) {
                  setTab("market");
                  setSpend(n);
                  return `Set your spend to ${inr(n)}. ${matchOrders(open, n).length} whole order(s) match.`;
                }
              }
              if (/fee/i.test(t)) return "Buying is free. The seller pays a 1% fee from the USDC they lock. You pay only the voucher price on your own card, and any card rewards stay yours.";
              return null;
            }}
          />
        </div>

        {/* ---------------------------------------------------- buy panel */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="hairline rounded-[24px] bg-ink-2/80 p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[22px] font-semibold tracking-tight">Buy USDC</h2>
              <span className="grid size-8 place-items-center rounded-full bg-[#2775ca] font-display text-[13px] font-bold text-white" aria-hidden>
                $
              </span>
            </div>

            <div className="mt-5 flex gap-6 border-b border-white/[0.07] text-[13px]">
              {(["market", "limit"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cx("relative pb-3 capitalize transition", tab === t ? "text-fg" : "text-mute hover:text-fg")}>
                  {t}
                  {tab === t && <motion.span layoutId="buytab" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-mint" />}
                </button>
              ))}
            </div>

            <div className="mt-5 text-[12.5px] text-mute">You spend</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-3xl text-mute">₹</span>
              <input
                type="number"
                value={spend || ""}
                onChange={(e) => setSpend(Math.max(0, Math.min(500000, parseInt(e.target.value || "0"))))}
                className="w-full min-w-0 bg-transparent font-display text-[44px] leading-none font-semibold tracking-tight outline-none tabular"
                aria-label="Amount to spend in rupees"
              />
              <span className="text-[12px] text-dim">INR</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setSpend(p)}
                  className={cx("h-9 rounded-xl text-[12.5px] ring-1 transition tabular", spend === p ? "bg-mint/10 text-mint ring-mint/40" : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20")}
                >
                  {inr(p)}
                </button>
              ))}
            </div>

            {tab === "limit" && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2.5 ring-1 ring-white/[0.07]">
                <span className="text-[12.5px] text-mute">Max rate</span>
                <span className="flex items-center gap-1 text-[14px] tabular">
                  ₹
                  <input
                    type="number"
                    step="0.1"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value) || 0)}
                    className="w-16 bg-transparent text-right outline-none"
                    aria-label="Maximum rupees per USDC"
                  />
                  <span className="text-[11px] text-dim">/ USDC</span>
                </span>
              </div>
            )}

            <div className="relative my-5 h-px bg-white/[0.07]">
              <span className="absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink-2 text-dim ring-1 ring-white/10">
                <ArrowDownLeft className="size-3.5" />
              </span>
            </div>

            <div className="text-[12.5px] text-mute">Estimated receive</div>
            <div className="mt-2 flex items-baseline gap-2">
              <motion.span key={receive.toFixed(2)} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[40px] leading-none font-semibold tracking-tight text-mint tabular">
                {usdt(receive)}
              </motion.span>
              <span className="text-[12px] text-dim">USDC</span>
            </div>

            <div className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-mute">Matched orders</span>
                <span className="tabular">{matched.length}</span>
              </div>
              {matched.length > 0 && matchedInr !== spend && (
                <div className="flex justify-between">
                  <span className="text-mute">Whole-voucher total</span>
                  <span className="text-amber tabular">{inr(matchedInr)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-mute">Platform fee</span>
                <span className="tabular">0%</span>
              </div>
            </div>

            <Button className="mt-5 w-full" size="lg" disabled={!matched.length} onClick={() => setReview(true)} icon={<ArrowRight className="size-4" />}>
              Review buy order
            </Button>
            <p className="mt-3 text-center text-[12px] text-dim">{matched.length ? "Your card rewards stay yours." : tab === "limit" ? "No orders at or below your max rate." : "No whole orders fit this amount."}</p>

            <Link to="/cards" className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[13px] text-mute transition hover:text-fg">
              <span className="flex items-center gap-2.5">
                <CreditCard className="size-4" /> My cards
              </span>
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </aside>
      </div>

      <ReviewModal
        open={review}
        onClose={() => setReview(false)}
        matched={matched}
        receive={receive}
        onAccept={() => {
          matched.forEach(acceptOrder);
          nav(`/trade/${matched[0].id}`);
        }}
      />
    </div>
  );
}

function SourceTag({ source, onRetry }: { source: Source; onRetry: () => void }) {
  if (source === "live")
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-mint/10 px-2 py-0.5 font-mono text-[9.5px] tracking-wider text-mint uppercase ring-1 ring-mint/25">
        <span className="size-1.5 animate-pulse rounded-full bg-mint" /> live
      </span>
    );
  if (source === "demo")
    return (
      <button
        onClick={onRetry}
        title="Backend not reachable. Showing demo orders. Click to retry."
        className="flex items-center gap-1.5 rounded-full bg-amber/10 px-2 py-0.5 font-mono text-[9.5px] tracking-wider text-amber uppercase ring-1 ring-amber/25"
      >
        demo <RefreshCw className="size-2.5" />
      </button>
    );
  return null;
}

function ReviewModal({ open, onClose, matched, receive, onAccept }: { open: boolean; onClose: () => void; matched: Order[]; receive: number; onAccept: () => void }) {
  const total = matched.reduce((s, o) => s + o.amount, 0);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Review buy order"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="hairline w-full max-w-[440px] rounded-[26px] bg-ink-2 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold tracking-tight">Review buy order</h3>
              <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 space-y-2">
              {matched.map((o) => {
                const b = brand(o.brandId);
                return (
                  <div key={o.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                    <BrandMark id={o.brandId} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium">
                        {b.name} {inr(o.amount)}
                      </div>
                      <div className="font-mono text-[11px] text-dim">
                        {o.id} · ₹{o.rate.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right text-[13px] font-medium tabular">{usdt(quote(o.amount, o.rate).buyerReceives)} USDC</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 space-y-2 rounded-2xl bg-white/[0.02] p-4 text-[13px] ring-1 ring-white/[0.06]">
              <div className="flex justify-between">
                <span className="text-mute">You pay on your card</span>
                <span className="tabular">{inr(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">You receive</span>
                <span className="font-semibold text-mint tabular">{usdc(receive)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">Platform fee</span>
                <span>0%</span>
              </div>
            </div>
            {matched.length > 1 && (
              <p className="mt-3 flex items-start gap-2 text-[12px] text-mute">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber" /> You'll fill these one at a time. Start with the first; the rest stay in your list on Track.
              </p>
            )}
            <Button className="mt-5 w-full" size="lg" onClick={onAccept} icon={<ArrowRight className="size-4" />}>
              Accept {matched.length > 1 ? "first order" : "order"} & start
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const usdc = (n: number) => `${usdt(n)} USDC`;
