import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AssistantBar } from "../components/AssistantBar";
import { BuyRequestCard } from "../components/BuyRequest";
import { BrandMark, cx } from "../components/ui";
import { brand } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";
import { brandIdFromApi } from "../lib/api";
import { sameAddr } from "../lib/lifecycle";
import { useOrderBook, type Source } from "../lib/orderbook";
import { useApp } from "../lib/store";
import type { Order } from "../lib/data";

/** The only amounts a buyer can pick. There is no free-typed amount. */
const PRESETS = [250, 500, 1000];
const DEFAULT_SPEND = 500;
/** Vouchers a buyer can say they hold. Shown in this order, after "None". */
const VOUCHER_BRANDS = ["amazon", "myntra", "blinkit", "flipkart"];

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
  const { fullAddress } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"market" | "limit">("market");
  const [spend, setSpend] = useState(DEFAULT_SPEND);
  const [limit, setLimit] = useState(90);
  /** Brand of the one voucher the buyer holds and wants to use. "none" means no voucher: match any brand. */
  const [voucher, setVoucher] = useState<string>("none");

  const open = useMemo(() => orders.filter((o) => o.seller !== "you"), [orders]);
  const voucherOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const o of open) count.set(o.brandId, (count.get(o.brandId) ?? 0) + 1);
    return VOUCHER_BRANDS.map((id) => ({ id, n: count.get(id) ?? 0 }));
  }, [open]);
  const pool = useMemo(() => (voucher === "none" ? open : open.filter((o) => o.brandId === voucher)), [open, voucher]);
  const rows = useMemo(() => open.filter((o) => `${brand(o.brandId).name} ${o.seller} ${o.spender ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [open, q]);
  const featured = useMemo(() => {
    const seen = new Set<string>();
    return open.filter((o) => (seen.has(o.brandId) ? false : (seen.add(o.brandId), true))).slice(0, 4);
  }, [open]);

  const matched = useMemo(() => matchOrders(pool, spend, tab === "limit" ? limit : undefined), [pool, spend, tab, limit]);

  const isMine = (o: Order) => sameAddr(o.spender, fullAddress);
  // Every order opens on Track. For your own it is your order; for someone else's you choose how to buy it and accept.
  const go = (o: Order) => nav(`/track?id=${encodeURIComponent(o.id)}`);

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
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store or wallet" className="w-40 bg-transparent outline-none placeholder:text-dim" aria-label="Search orders by store or wallet" />
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
                    <th className="pb-3 font-normal">Store · from wallet</th>
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
                              <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                  <span className="font-medium">{b.name}</span>
                                  {isMine(o) ? (
                                    <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-mute uppercase">yours</span>
                                  ) : (
                                    isMatch && <span className="rounded-full bg-mint/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-mint uppercase">match</span>
                                  )}
                                </span>
                                <span className="block font-mono text-[11px] text-dim" title={o.spender}>
                                  from {o.seller}
                                </span>
                              </span>
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
              {rows.length === 0 && <div className="py-10 text-center text-[13px] text-mute">{open.length ? "No orders match your search." : "No open orders right now."}</div>}
            </div>
            <p className="mt-4 text-[11.5px] text-dim">Whole vouchers. No partial fills.</p>
          </section>

          <AssistantBar
            role="buyer"
            placeholder="Find an order, or ask about your cards…"
            chips={[
              { label: "Buy ₹500", ask: "buy 500" },
              { label: "Compare my cards", on: () => nav("/cards") },
              { label: "How fees work", ask: "How do fees work?" },
            ]}
            intercept={(t) => {
              const m = t.match(/(?:buy|spend)?\s*₹?\s*([\d,]+)\s*(k)?/i);
              if (/^(buy|spend)\b/i.test(t) && m) {
                const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
                if (n > 0) {
                  if (!PRESETS.includes(n)) return `You can buy ${PRESETS.map(inr).join(", ")}. Pick one of those.`;
                  setTab("market");
                  setSpend(n);
                  return `Set your spend to ${inr(n)}. ${matchOrders(pool, n).length} whole order(s) match.`;
                }
              }
              if (/fee/i.test(t)) return "Buying is free. The spender pays a 1% fee from the USDC they lock. You pay only the voucher price on your own card, and any card rewards stay yours.";
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
            <div className="mt-2 flex items-baseline gap-2" aria-live="polite">
              <span className="font-display text-3xl text-mute">₹</span>
              <span className="w-full min-w-0 font-display text-[44px] leading-none font-semibold tracking-tight tabular" aria-label={`Amount to spend: ${spend} rupees`}>
                {spend.toLocaleString("en-IN")}
              </span>
              <span className="text-[12px] text-dim">INR</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Amount to spend">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={spend === p}
                  onClick={() => setSpend(p)}
                  className={cx("h-10 rounded-xl text-[13px] ring-1 transition tabular", spend === p ? "bg-mint/10 text-mint ring-mint/40" : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20")}
                >
                  {inr(p)}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <div className="text-[12.5px] text-mute">Voucher you hold (pick one)</div>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Voucher you hold">
                {[{ id: "none", n: open.length }, ...voucherOptions].map(({ id, n }) => {
                  const on = voucher === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setVoucher(id)}
                      title={id !== "none" && n === 0 ? "No open orders for this voucher right now" : undefined}
                      className={cx(
                        "flex h-9 items-center gap-2 rounded-xl px-3 text-[12.5px] ring-1 transition",
                        on ? "bg-mint/10 text-mint ring-mint/40" : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20",
                        !on && id !== "none" && n === 0 && "opacity-50",
                      )}
                    >
                      {id !== "none" && <BrandMark id={id} size={18} />}
                      {id === "none" ? "None" : brand(id).name}
                      {id !== "none" && <span className="font-mono text-[10px] text-dim">{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The chosen amount and voucher can be put on record as a buy request (saved in Firestore) that spenders are shown. */}
            <BuyRequestCard
              amount={spend}
              voucher={voucher}
              onRestore={(i) => {
                // Show the saved request in the form, unless they have already started changing it. Only amounts on offer fit the form.
                setSpend((s) => (s === DEFAULT_SPEND && PRESETS.includes(i.amountInr) ? i.amountInr : s));
                setVoucher((v) => (v === "none" ? (i.voucher ? brandIdFromApi(i.voucher) : "none") : v));
              }}
            />

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

          </div>
        </aside>
      </div>
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
