import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Bot, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CustomOrder } from "../components/CustomOrder";
import { AppPage, AppHead, cx } from "../components/ui";
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
  const { fullAddress } = useApp();

  return (
    <AppPage>
      <AppHead
        title="Trade"
        sub={mode === "buy" ? "Buy USDC by filling a voucher order with your card. Your card rewards stay yours." : "Choose a voucher and pay for it with USDC. A USDC buyer buys it for you."}
        right={
          <>
            <span className="text-[12.5px] text-mute">India · INR</span>
            <Link to="/track" className="flex h-9 items-center gap-2 rounded-full bg-fg/[0.03] px-3.5 text-[12.5px] ring-1 ring-fg/10 transition hover:bg-fg/[0.06]">
              My orders <ArrowUpRight className="size-3.5 text-mute" />
            </Link>
          </>
        }
      >
        <div className="flex rounded-full bg-fg/[0.03] p-1 ring-1 ring-fg/[0.08]" role="tablist" aria-label="Trade mode">
          {(
            [
              ["buy", "Buy USDC", <ArrowDownLeft key="i" className="size-3.5" />],
              ["sell", "Pay with USDC", <ArrowUpRight key="i" className="size-3.5" />],
            ] as const
          ).map(([m, label, icon]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cx("relative flex h-8 items-center gap-2 rounded-full px-3.5 text-[12.5px] font-medium transition", mode === m ? "text-white" : "text-mute hover:text-fg")}
            >
              {mode === m && <motion.span layoutId="trade-mode" className="absolute inset-0 rounded-full bg-fg" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
              <span className="relative flex items-center gap-2">
                {icon} {label}
              </span>
            </button>
          ))}
        </div>
      </AppHead>

      <div className="mt-5">
        <AnimatePresence mode="wait">
          <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            {mode === "buy" ? <BuyView /> : <PayWithCrypto key={fullAddress} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </AppPage>
  );
}

function PayWithCrypto() {
  const { orders } = useOrderBook();
  const [chatOpen, setChatOpen] = useState(true);
  const [session, setSession] = useState(0);

  // The order form is the primary action, so it takes the wide column; the assistant sits beside it on wide screens
  // and below it on narrow ones.
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <CustomOrder />
      </div>
      <aside className="min-w-0 lg:sticky lg:top-24">
        {chatOpen ? (
          <SpendChat key={session} book={orders} onRestart={() => setSession((s) => s + 1)} onClose={() => setChatOpen(false)} />
        ) : (
          <button type="button" onClick={() => setChatOpen(true)} className="hairline flex w-full items-center gap-3 rounded-[22px] bg-surface/70 p-4 text-left backdrop-blur-xl transition hover:bg-surface">
            <span className="grid size-10 place-items-center rounded-2xl bg-brand/10 text-brand-ink ring-1 ring-fg/10">
              <Bot className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">NetPositive AI</span>
              <span className="block text-[12px] text-mute">Find a store and post a request</span>
            </span>
            <Sparkles className="size-4 text-mute" />
          </button>
        )}
      </aside>
    </div>
  );
}
