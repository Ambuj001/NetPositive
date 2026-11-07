import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Aurora, BrandMark, cx } from "../components/ui";
import { BRANDS, brand, type Order } from "../lib/data";
import { bestReward, inr, quote, round2, usdt } from "../lib/engine";
import { useOrderBook, type Source } from "../lib/orderbook";
import { useApp } from "../lib/store";

type Sort = "rate" | "amount" | "newest";
const SORTS: { id: Sort; label: string }[] = [
  { id: "rate", label: "Best effective rate" },
  { id: "amount", label: "Largest amount" },
  { id: "newest", label: "Newest" },
];

export default function Market() {
  const { orders, source, reload } = useOrderBook();
  const { cards, acceptOrder } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<Sort>("rate");

  const cats = useMemo(() => ["All", ...Array.from(new Set(BRANDS.map((b) => b.category)))], []);

  /** Each open order with what the buyer receives and their net INR/USDC after the best card reward (cash value). */
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = orders
      .filter((o) => o.seller !== "you")
      .filter((o) => {
        const b = brand(o.brandId);
        return (cat === "All" || b.category === cat) && (!needle || b.name.toLowerCase().includes(needle) || o.seller.toLowerCase().includes(needle));
      })
      .map((o) => {
        const receive = quote(o.amount, o.rate).buyerReceives;
        const { route, rewardInr } = bestReward(o.amount, cards, "cash");
        return { o, receive, route, net: receive > 0 ? round2((o.amount - rewardInr) / receive) : null };
      });
    return list.sort((a, b) =>
      sort === "rate"
        ? (a.net ?? Infinity) - (b.net ?? Infinity)
        : sort === "amount"
          ? b.o.amount - a.o.amount
          : a.o.postedMin - b.o.postedMin,
    );
  }, [orders, cards, q, cat, sort]);

  const open = (o: Order) => {
    acceptOrder(o);
    nav(`/trade/${o.id}`);
  };

  return (
    <div className="relative pt-32 pb-14">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="label">Marketplace</div>
            <h1 className="text-gradient mt-3 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Find your next match.</h1>
            <p className="mt-3 text-[15px] text-mute">Voucher requests, ranked by your estimated cash-value rate.</p>
          </div>
          <SourceTag source={source} onRetry={reload} />
        </motion.div>

        {/* search + sort */}
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <label className="flex h-12 flex-1 items-center gap-3 rounded-2xl bg-white/[0.03] px-4 ring-1 ring-white/10 transition focus-within:ring-mint/45">
            <Search className="size-4 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vouchers or spenders" className="w-full bg-transparent text-[14px] outline-none placeholder:text-dim" aria-label="Search vouchers or spenders" />
          </label>
          <label className="relative flex h-12 items-center gap-2.5 rounded-2xl bg-white/[0.03] pr-10 pl-4 text-[13.5px] ring-1 ring-white/10 transition focus-within:ring-mint/45">
            <SlidersHorizontal className="size-4 text-dim" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="appearance-none bg-transparent outline-none" aria-label="Sort orders">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id} className="bg-ink-2">
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 size-4 text-dim" />
          </label>
        </div>

        {/* categories */}
        <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={cx("h-9 shrink-0 rounded-full px-4 text-[12.5px] ring-1 transition", cat === c ? "bg-mint/10 text-mint ring-mint/40" : "text-mute ring-white/[0.08] hover:text-fg hover:ring-white/20")}
            >
              {c}
            </button>
          ))}
        </div>

        {/* order table */}
        <div className="hairline mt-6 overflow-hidden rounded-[24px] bg-ink-2/70 backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.015] text-left text-[11.5px] text-dim">
                  <th className="px-6 py-4 font-normal">Voucher</th>
                  <th className="px-4 py-4 font-normal">Value</th>
                  <th className="px-4 py-4 font-normal">You receive</th>
                  <th className="px-4 py-4 font-normal">Net rate</th>
                  <th className="w-14 px-6 py-4" />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows.map(({ o, receive, route, net }) => (
                    <motion.tr
                      key={o.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => open(o)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(o))}
                      tabIndex={0}
                      aria-label={`Open ${brand(o.brandId).name} ${inr(o.amount)} order`}
                      className="group cursor-pointer border-b border-white/[0.05] transition outline-none last:border-0 hover:bg-white/[0.03] focus-visible:bg-white/[0.04]"
                    >
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-3.5">
                          <BrandMark id={o.brandId} size={38} />
                          <span>
                            <span className="block font-medium">{brand(o.brandId).name}</span>
                            <span className="block font-mono text-[11px] text-dim">{o.seller}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-4 tabular">{inr(o.amount)}</td>
                      <td className="px-4 py-4 tabular">
                        {usdt(receive)} <span className="text-[10px] text-dim">USDC</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="block font-medium text-mint tabular">{net === null ? "—" : `₹${net.toFixed(2)}`}</span>
                        <span className="block text-[11px] text-dim">{route ? `${route.cardLabel} · ${route.channel.name}` : "Add a card to rank"}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <ArrowUpRight className="ml-auto size-4 text-dim transition group-hover:text-mint" />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <div className="py-14 text-center text-[13.5px] text-mute">{source === "loading" ? "Loading orders…" : "No vouchers match your search."}</div>}
        </div>
      </div>
    </div>
  );
}

function SourceTag({ source, onRetry }: { source: Source; onRetry: () => void }) {
  if (source === "live")
    return (
      <span className="flex w-fit items-center gap-1.5 rounded-full bg-mint/10 px-3 py-1.5 font-mono text-[10.5px] tracking-wider text-mint uppercase ring-1 ring-mint/25">
        <span className="size-1.5 animate-pulse rounded-full bg-mint" /> Live order book
      </span>
    );
  if (source === "demo")
    return (
      <button
        onClick={onRetry}
        title="Backend not reachable. Showing sample orders. Click to retry."
        className="flex w-fit items-center gap-1.5 rounded-full bg-amber/10 px-3 py-1.5 font-mono text-[10.5px] tracking-wider text-amber uppercase ring-1 ring-amber/25 transition hover:bg-amber/15"
      >
        Sample order book <RefreshCw className="size-3" />
      </button>
    );
  return null;
}
