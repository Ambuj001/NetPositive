import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, CreditCard, ShoppingBag, Sparkles, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Aurora, BrandMark, Button, cx } from "../components/ui";
import { STATUS, isFinal } from "../lib/api";
import { brand } from "../lib/data";
import { SpendChat } from "./Spend";
import { inr } from "../lib/engine";
import { useOrderBook } from "../lib/orderbook";
import { useApp } from "../lib/store";

export default function Home() {
  const { address, openWallet, myOrders } = useApp();
  const { orders } = useOrderBook();
  const [chatOpen, setChatOpen] = useState(false);
  const [session, setSession] = useState(0);
  if (!address) return <NotConnected onConnect={openWallet} />;

  const openCount = orders.filter((o) => o.seller !== "you").length;
  const active = myOrders.filter((o) => !isFinal(o.status));
  const openChat = () => {
    setChatOpen(true);
    setSession((s) => s + 1);
  };

  return (
    <div className="relative min-h-dvh pt-28 pb-10">
      <Aurora className="h-[55vh] opacity-60" />
      <div className="relative mx-auto max-w-6xl px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="label flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-mint" /> {address}
          </div>
          <h1 className="text-gradient mt-3 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">{chatOpen ? "Spend USDC" : "What do you want to do?"}</h1>
        </motion.div>

        <div className={cx("mt-8 grid grid-cols-1 gap-4", chatOpen ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "md:grid-cols-2")}>
          <div className={chatOpen ? "grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-1 lg:content-start lg:gap-4" : "contents"}>
            <Box
              n={1}
              onClick={openChat}
              active={chatOpen}
              compact={chatOpen}
              tone="mint"
              icon={<ShoppingBag className="size-5" />}
              title="Spend USDC"
              body="Shop at any Indian store. Tell the assistant what you want, it finds the voucher and locks your USDC in escrow."
              points={["Any brand, any amount", "1% fee, nothing else"]}
              cta={
                <>
                  <Sparkles className="size-4" /> Start with the AI assistant
                </>
              }
            />
            <Box
              n={2}
              to="/buy"
              compact={chatOpen}
              tone="amber"
              icon={<CreditCard className="size-5" />}
              title="Buy USDC"
              body="Fill a voucher request with your card and get USDC below market. Your card rewards stay yours."
              points={[`${openCount} open orders`, "No platform fee"]}
              cta="See orders"
            />
          </div>

          <AnimatePresence mode="wait">
            {chatOpen && (
              <motion.div
                key={session}
                className="min-w-0"
                initial={{ opacity: 0, y: 20, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <SpendChat book={orders} onRestart={() => setSession((s) => s + 1)} onClose={() => setChatOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {active.length > 0 && (
          <div className="hairline mt-6 rounded-[24px] bg-ink-2/60 p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="label">In progress</span>
              <Link to="/track" className="text-[12.5px] text-mute hover:text-fg">
                View all
              </Link>
            </div>
            <div className="space-y-1">
              {active.slice(0, 3).map((o) => (
                <Link key={o.id} to="/track" className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.03]">
                  <BrandMark id={o.brandId} size={28} />
                  <span className="flex-1 text-[13.5px]">
                    {brand(o.brandId).name} {inr(o.amount)}
                  </span>
                  <span className="text-[12px] text-mute">{STATUS[o.status].label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Box({
  n,
  to,
  onClick,
  active = false,
  compact = false,
  tone,
  icon,
  title,
  body,
  points,
  cta,
}: {
  n: number;
  to?: string;
  onClick?: () => void;
  active?: boolean;
  compact?: boolean;
  tone: "mint" | "amber";
  icon: ReactNode;
  title: string;
  body: string;
  points: string[];
  cta: ReactNode;
}) {
  const c = {
    mint: { text: "text-mint", ring: "ring-mint/50", bg: "bg-mint/10", glow: "rgba(61,220,151,0.16)", btn: "bg-mint" },
    amber: { text: "text-amber", ring: "ring-amber/55", bg: "bg-amber/10", glow: "rgba(245,181,68,0.16)", btn: "bg-amber" },
  }[tone];
  const className = cx(
    "group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[26px] bg-gradient-to-b from-white/[0.06] to-white/[0.015] text-left ring-1 backdrop-blur-xl transition",
    active ? c.ring : "ring-white/10 hover:ring-white/20",
    compact ? "p-4" : "p-7",
  );
  const inner = (
    <>
      <div className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full blur-3xl transition-opacity duration-500 group-hover:opacity-100" style={{ background: c.glow, opacity: active ? 1 : 0.5 }} />
      <div className="relative flex items-center gap-3">
        <span className={cx("grid place-items-center rounded-2xl ring-1 ring-white/10", c.bg, c.text, compact ? "size-10" : "size-12")}>{icon}</span>
        <span className="font-mono text-[11px] text-dim">0{n}</span>
        {active && <span className={cx("ml-auto rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", c.text, c.ring)}>open</span>}
      </div>
      <div className={cx("relative font-display font-semibold tracking-tight", compact ? "mt-3 text-[18px]" : "mt-7 text-[28px]")}>{title}</div>
      {!compact && (
        <>
          <p className="relative mt-2.5 flex-1 text-[14.5px] leading-relaxed text-mute">{body}</p>
          <ul className="relative mt-5 space-y-2">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-2 text-[13px] text-fg/85">
                <Check className={cx("size-4", c.text)} /> {p}
              </li>
            ))}
          </ul>
          <span className={cx("relative mt-7 inline-flex h-11 w-fit items-center gap-2 rounded-full px-5 text-[14px] font-medium text-ink transition group-hover:brightness-110", c.btn)}>
            {cta} <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </span>
        </>
      )}
    </>
  );
  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * 0.06 }} whileHover={{ y: -4 }} className="min-w-0">
      {to ? (
        <Link to={to} className={className}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-pressed={active} className={className} style={{ boxShadow: active ? `0 30px 80px -30px ${c.glow.replace("0.16", "0.6")}` : undefined }}>
          {inner}
        </button>
      )}
    </motion.div>
  );
}

function NotConnected({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="relative grid min-h-dvh place-items-center px-6 pt-24">
      <Aurora className="opacity-60" />
      <div className="hairline relative w-full max-w-md rounded-[28px] bg-ink-2/80 p-8 text-center backdrop-blur-xl">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-mint/10 text-mint ring-1 ring-mint/25">
          <Wallet className="size-6" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight">Connect your wallet</h1>
        <p className="mt-2 text-[14px] text-mute">Your wallet is your account. Connect to spend, buy or track USDC orders.</p>
        <Button className="mt-6 w-full" size="lg" onClick={onConnect} icon={<ArrowRight className="size-4" />}>
          Connect wallet
        </Button>
      </div>
    </div>
  );
}
