import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Bot, Sparkles } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CustomOrder } from "../components/CustomOrder";
import { AppPage, AppHead, Button, Segmented, enter } from "../components/ui";
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
            <span className="hidden text-[12.5px] text-mute sm:inline">India · INR</span>
            <Button size="sm" variant="outline" to="/track" icon={<ArrowUpRight className="size-3.5 text-mute" />}>
              My orders
            </Button>
          </>
        }
      >
        <Segmented
          id="trade-mode"
          label="Trade mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "buy", label: "Buy USDC", icon: <ArrowDownLeft className="size-3.5" /> },
            { value: "sell", label: "Pay with USDC", icon: <ArrowUpRight className="size-3.5" /> },
          ]}
        />
      </AppHead>

      <div className="mt-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={mode} {...enter}>
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
          <button type="button" onClick={() => setChatOpen(true)} className="panel panel-hover flex w-full items-center gap-3 p-4 text-left">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-white">
              <Bot className="size-[18px]" />
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
