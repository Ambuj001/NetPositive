import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AssistantBar } from "../components/AssistantBar";
import { BuyRequestCard } from "../components/BuyRequest";
import { BrandMark, Pill, Segmented, Skeleton, cx } from "../components/ui";
import { brand } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";
import { brandIdFromApi } from "../lib/api";
import { sameAddr } from "../lib/lifecycle";
import { useOrderBook, type Source } from "../lib/orderbook";
import { useApp } from "../lib/store";
import { feePercent } from "../lib/terms";
import { useTerms } from "../lib/useTerms";
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
  const { fullAddress, toast } = useApp();
  const { feeBps, estimated: feeEstimated } = useTerms();
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
  // Sample rows (development only, no backend) lead nowhere: there is no order behind them.
  const go = (o: Order) => (o.demo ? toast({ title: "Demo order", body: "This is sample data shown because no backend is running. There is nothing to open.", tone: "amber" }) : nav(`/track?id=${encodeURIComponent(o.id)}`));

  return (
    <div className="relative">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------------------------------------------------- order book */}
        <div className="min-w-0 space-y-4">
          <section className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Available orders</h2>
                <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] text-mute tabular">{open.length}</span>
                <SourceTag source={source} onRetry={reload} />
              </div>
              <label className="field flex h-9 w-full items-center gap-2 rounded-full px-3.5 text-[13px] sm:w-56">
                <Search className="size-3.5 shrink-0 text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store or wallet" className="w-full min-w-0 bg-transparent outline-none placeholder:text-dim" aria-label="Search orders by store or wallet" />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {featured.map((o) => {
                const b = brand(o.brandId);
                return (
                  <button
                    key={o.brandId}
                    onClick={() => setQ(b.name)}
                    className="group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-line transition-colors duration-200 hover:bg-sunken hover:ring-line-2"
                  >
                    <BrandMark id={o.brandId} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{b.name}</span>
                      <span className="block truncate text-[11px] text-dim">{b.category}</span>
                    </span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-dim transition group-hover:text-fg" />
                  </button>
                );
              })}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-mute">
                    <th className="pb-2.5 font-normal">Store · from voucher buyer</th>
                    <th className="pb-2.5 text-right font-normal">Value</th>
                    <th className="pb-2.5 text-right font-normal">You receive</th>
                    <th className="pb-2.5 text-right font-normal">Rate / USDC</th>
                    <th className="w-10 pb-2.5" />
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
                          transition={{ duration: 0.2 }}
                          onClick={() => go(o)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go(o))}
                          tabIndex={0}
                          aria-label={`Open ${b.name} ${inr(o.amount)} order`}
                          className={cx("group cursor-pointer border-b border-line outline-none transition-colors last:border-0 hover:bg-sunken focus-visible:bg-sunken", isMatch && "bg-brand-soft/60")}
                        >
                          <td className="py-3">
                            <span className="flex items-center gap-3">
                              <BrandMark id={o.brandId} size={32} />
                              <span className="min-w-0">
                                <span className="flex items-center gap-2">
                                  <span className="font-medium">{b.name}</span>
                                  {isMine(o) ? <Pill className="px-2 py-0.5 text-[9.5px]">yours</Pill> : isMatch && <Pill tone="mint" className="px-2 py-0.5 text-[9.5px]">match</Pill>}
                                </span>
                                <span className="block truncate font-mono text-[11px] text-dim" title={o.spender}>
                                  from {o.seller}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="py-3 text-right text-mute tabular">{inr(o.amount)}</td>
                          <td className="py-3 text-right tabular">
                            <span className="font-medium">{usdt(quote(o.amount, o.rate).buyerReceives)}</span> <span className="text-[10px] text-dim">USDC</span>
                          </td>
                          <td className="py-3 text-right text-mute tabular">₹{o.rate.toFixed(2)}</td>
                          <td className="py-3 text-right">
                            <ArrowUpRight className="ml-auto size-3.5 text-dim transition group-hover:text-brand-ink" />
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
              {rows.length === 0 && source === "loading" && <RowSkeletons />}
              {rows.length === 0 && source !== "loading" && <div className="py-10 text-center text-[13px] text-mute">{open.length ? "No orders match your search." : source === "offline" ? "The order book can't be reached right now." : "No open orders right now."}</div>}
            </div>
            <p className="mt-3 text-[12px] text-dim">Whole vouchers. No partial fills.</p>
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
              if (/fee/i.test(t)) return `Buying is free. The voucher buyer pays a ${feePercent(feeBps)} fee${feeEstimated ? " (estimated; the server couldn't be asked just now)" : ""} on top of the USDC they lock. You pay only the voucher price on your own card, and any card rewards stay yours.`;
              return null;
            }}
          />
        </div>

        {/* ---------------------------------------------------- buy panel */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Buy USDC</h2>
              <Segmented
                id="buy-type"
                label="Order type"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "market", label: "Market" },
                  { value: "limit", label: "Limit" },
                ]}
              />
            </div>

            <div className="mt-5 text-[12.5px] text-mute">You spend</div>
            <div className="mt-1.5 flex items-baseline gap-2" aria-live="polite">
              <span className="font-display text-[22px] text-mute">₹</span>
              <span className="w-full min-w-0 font-display text-[36px] leading-none font-semibold tracking-tight tabular" aria-label={`Amount to spend: ${spend} rupees`}>
                {spend.toLocaleString("en-IN")}
              </span>
              <span className="text-[12px] text-dim">INR</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Amount to spend">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={spend === p}
                  onClick={() => setSpend(p)}
                  className={cx("h-9 rounded-full text-[13px] ring-1 transition-colors duration-200 tabular", spend === p ? "bg-brand-soft text-brand-ink ring-brand/40" : "text-mute ring-line-2 hover:bg-sunken hover:text-fg")}
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
                        "flex h-9 items-center gap-2 rounded-full pr-3 pl-1.5 text-[12.5px] ring-1 transition-colors duration-200",
                        id === "none" && "pl-3",
                        on ? "bg-brand-soft text-brand-ink ring-brand/40" : "text-mute ring-line-2 hover:bg-sunken hover:text-fg",
                        !on && id !== "none" && n === 0 && "opacity-50",
                      )}
                    >
                      {id !== "none" && <BrandMark id={id} size={22} className="rounded-full" />}
                      {id === "none" ? "None" : brand(id).name}
                      {id !== "none" && <span className="font-mono text-[10.5px] text-dim tabular">{n}</span>}
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
              <label className="field mt-4 flex h-11 items-center justify-between px-3.5">
                <span className="text-[13px] text-mute">Max rate</span>
                <span className="flex items-center gap-1 text-[14px] tabular">
                  ₹
                  <input
                    type="number"
                    step="0.1"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value) || 0)}
                    className="w-20 bg-transparent text-right font-medium outline-none"
                    aria-label="Maximum rupees per USDC"
                  />
                  <span className="text-[11.5px] text-dim">/ USDC</span>
                </span>
              </label>
            )}

          </div>
        </aside>
      </div>
    </div>
  );
}

/** Where the order book came from. "Live" is a green signal; demo and unreachable are buttons that retry. */
export function SourceTag({ source, onRetry, long }: { source: Source; onRetry: () => void; long?: boolean }) {
  const base = "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium tracking-[0.1em] uppercase ring-1";
  if (source === "live")
    return (
      <span className={cx(base, "bg-pos/10 text-pos-ink ring-pos/30")}>
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-pos opacity-60" />
          <span className="relative size-1.5 rounded-full bg-pos" />
        </span>
        {long ? "Live order book" : "live"}
      </span>
    );
  if (source === "demo")
    return (
      <button onClick={onRetry} title="Backend not reachable. These are made-up sample orders, shown in development only. Click to retry." className={cx(base, "bg-amber/12 text-amber-ink ring-amber/35 transition-colors hover:bg-amber/20")}>
        {long ? "Demo data · not real orders" : "demo data · not real"} <RefreshCw className="size-3" />
      </button>
    );
  if (source === "offline")
    return (
      <button onClick={onRetry} title="The order book server didn't answer. Click to retry." className={cx(base, "bg-rose/8 text-rose-ink ring-rose/25 transition-colors hover:bg-rose/15")}>
        {long ? "Order book unreachable" : "unreachable"} <RefreshCw className="size-3" />
      </button>
    );
  return null;
}

function RowSkeletons() {
  return (
    <div aria-hidden className="divide-y divide-line">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-8 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}
