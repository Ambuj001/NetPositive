import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AppHead, AppPage, BrandMark, Skeleton, cx } from "../components/ui";
import { SourceTag } from "./Buy";
import { BRANDS, brand, type Order } from "../lib/data";
import { bestReward, inr, quote, round2, usdt } from "../lib/engine";
import { useOrderBook } from "../lib/orderbook";
import { useApp } from "../lib/store";

type Sort = "rate" | "amount" | "newest";
const SORTS: { id: Sort; label: string }[] = [
  { id: "rate", label: "Best effective rate" },
  { id: "amount", label: "Largest amount" },
  { id: "newest", label: "Newest" },
];

export default function Market() {
  const { orders, source, reload } = useOrderBook();
  const { cards, cardsAreExamples, toast } = useApp();
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

  // Opens the order's own page, where a buyer picks a route and accepts. Sample rows (development only) lead nowhere.
  const open = (o: Order) => {
    if (o.demo) return toast({ title: "Demo order", body: "This is sample data shown because no backend is running. There is nothing to open.", tone: "amber" });
    nav(`/track?id=${encodeURIComponent(o.id)}`);
  };

  return (
    <AppPage>
        <AppHead
          title="Market"
          sub={
            <>
              Voucher orders, ranked by what they are worth on your cards.
              {cardsAreExamples && (
                <span className="text-amber-ink">
                  {" "}Worked out from example cards, not yours. <Link to="/cards" className="underline">Add your cards</Link> for real numbers.
                </span>
              )}
            </>
          }
          right={<SourceTag source={source} onRetry={reload} long />}
        />

        {/* search + sort */}
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <label className="field flex h-11 flex-1 items-center gap-3 rounded-full px-4 sm:max-w-md">
            <Search className="size-4 shrink-0 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vouchers or wallets" className="w-full bg-transparent text-[14px] outline-none placeholder:text-dim" aria-label="Search vouchers or wallets" />
          </label>
          <label className="field relative flex h-11 items-center gap-2.5 rounded-full pr-10 pl-4 text-[13.5px] sm:w-auto">
            <SlidersHorizontal className="size-4 text-dim" />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="appearance-none bg-transparent outline-none" aria-label="Sort orders">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id} className="bg-surface">
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
              className={cx("h-9 shrink-0 rounded-full px-4 text-[12.5px] ring-1 transition-colors duration-200", cat === c ? "bg-brand-soft text-brand-ink ring-brand/40" : "text-mute ring-line-2 hover:bg-sunken hover:text-fg")}
            >
              {c}
            </button>
          ))}
        </div>

        {/* order table */}
        <div className="panel mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-sunken text-left text-[12px] text-mute">
                  <th className="px-5 py-2.5 font-normal">Voucher</th>
                  <th className="px-4 py-2.5 font-normal">Value</th>
                  <th className="px-4 py-2.5 font-normal">You receive</th>
                  <th className="px-4 py-2.5 font-normal">Net rate</th>
                  <th className="w-14 px-5 py-2.5" />
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
                      transition={{ duration: 0.2 }}
                      onClick={() => open(o)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(o))}
                      tabIndex={0}
                      aria-label={`Open ${brand(o.brandId).name} ${inr(o.amount)} order`}
                      className="group cursor-pointer border-b border-line outline-none transition-colors last:border-0 hover:bg-sunken focus-visible:bg-sunken"
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-3">
                          <BrandMark id={o.brandId} size={32} />
                          <span className="min-w-0">
                            <span className="block font-medium">{brand(o.brandId).name}</span>
                            <span className="block truncate font-mono text-[11px] text-dim" title={o.spender}>{o.seller}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular">{inr(o.amount)}</td>
                      <td className="px-4 py-3 tabular">
                        {usdt(receive)} <span className="text-[10px] text-dim">USDC</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-medium text-brand-ink tabular">{net === null ? "—" : `₹${net.toFixed(2)}`}</span>
                        <span className="block text-[11px] text-dim">{route ? `${route.cardLabel} · ${route.channel.name}` : "Add a card to rank"}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ArrowUpRight className="ml-auto size-4 text-dim transition group-hover:text-brand-ink" />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {rows.length === 0 && source === "loading" && (
            <div aria-hidden className="divide-y divide-line">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                  <Skeleton className="size-8 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="hidden h-3.5 w-16 sm:block" />
                  <Skeleton className="hidden h-3.5 w-20 sm:block" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          )}
          {rows.length === 0 && source !== "loading" && <div className="py-10 text-center text-[13.5px] text-mute">{source === "offline" ? "The order book can't be reached right now, so there is nothing to show." : "No vouchers match your search."}</div>}
        </div>
    </AppPage>
  );
}
