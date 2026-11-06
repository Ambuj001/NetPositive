import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Bot, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CustomOrder } from "../components/CustomOrder";
import { Aurora, cx } from "../components/ui";
import { isFinal } from "../lib/api";
import { useOrderBook } from "../lib/orderbook";
import { useApp } from "../lib/store";
import { BuyView } from "./Buy";
import { SpendChat } from "./Spend";

type Mode = "buy" | "sell";

/**
 * The Trade page. Two tabs:
 *  - Buy: fill someone's voucher request with your card and receive USDC (the order book and buy panel).
 *  - Pay with crypto: the assistant chat finds a store and posts a request; the side panel builds a custom order.
 * Tab is kept in the URL (?mode=sell), so links and the browser back button land on the right one.
 */
export default function TradeHub() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "sell" ? "sell" : "buy";
  const setMode = (m: Mode) => setParams(m === "sell" ? { mode: "sell" } : {}, { replace: true });
  const { fullAddress, myOrders } = useApp();
  const active = myOrders.filter((o) => !isFinal(o.status)).length;

  return (
    <div className="relative pt-28 pb-12">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-gradient font-display text-4xl font-semibold tracking-[-0.03em]">Trade</h1>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-mute">India · INR</span>
            <Link to="/track" className="flex h-10 items-center gap-2.5 rounded-full bg-white/[0.03] pr-1.5 pl-4 text-[13px] ring-1 ring-white/10 transition hover:bg-white/[0.06]">
              My orders <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/[0.07] px-2 font-mono text-[11px] text-mute">{active}</span>
            </Link>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-4">
          <div className="flex rounded-full bg-white/[0.03] p-1 ring-1 ring-white/[0.08]" role="tablist" aria-label="Trade mode">
            {(
              [
                ["buy", "Buy", <ArrowDownLeft key="i" className="size-3.5" />],
                ["sell", "Pay with crypto", <ArrowUpRight key="i" className="size-3.5" />],
              ] as const
            ).map(([m, label, icon]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cx("relative flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition", mode === m ? "text-ink" : "text-mute hover:text-fg")}
              >
                {mode === m && <motion.span layoutId="trade-mode" className={cx("absolute inset-0 rounded-full", m === "buy" ? "bg-amber" : "bg-mint")} transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                <span className="relative flex items-center gap-2">
                  {icon} {label}
                </span>
              </button>
            ))}
          </div>
          <span className="text-[13.5px] text-mute">{mode === "buy" ? "Buy USDC. Keep your card rewards." : "Choose a voucher. Pay with USDC."}</span>
        </div>

        <div className="mt-6">
          <AnimatePresence mode="wait">
            <motion.div key={mode} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
              {mode === "buy" ? <BuyView /> : <PayWithCrypto key={fullAddress} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function PayWithCrypto() {
  const { orders } = useOrderBook();
  const [chatOpen, setChatOpen] = useState(true);
  const [session, setSession] = useState(0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        {chatOpen ? (
          <SpendChat key={session} book={orders} onRestart={() => setSession((s) => s + 1)} onClose={() => setChatOpen(false)} />
        ) : (
          <button type="button" onClick={() => setChatOpen(true)} className="hairline flex w-full items-center gap-3 rounded-[24px] bg-ink-2/70 p-5 text-left backdrop-blur-xl transition hover:bg-ink-2">
            <span className="grid size-10 place-items-center rounded-2xl bg-mint/10 text-mint ring-1 ring-white/10">
              <Bot className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">NetPositive AI</span>
              <span className="block text-[12px] text-mute">Find a store and post a request</span>
            </span>
            <Sparkles className="size-4 text-mute" />
          </button>
        )}
      </div>
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <CustomOrder />
      </aside>
    </div>
  );
}
