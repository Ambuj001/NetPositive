import { AnimatePresence, motion } from "motion/react";
import { Check, Eye, LoaderCircle, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { inr, quote, routesFor, usdt } from "../lib/engine";
import { BrandMark, cx } from "./ui";

/** Browser-extension popup chrome. */
export function ExtFrame({
  tab,
  site,
  children,
  className,
}: {
  tab: string;
  site?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("hairline relative overflow-hidden rounded-[22px] bg-[#0c0e13] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]", className)}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-md bg-mint/15">
            <span className="size-1.5 rounded-full bg-mint" />
          </span>
          <span className="font-mono text-[11.5px] text-fg/80">NetPositive</span>
        </div>
        <span className="max-w-[55%] truncate font-mono text-[11px] text-dim">{site ?? tab}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const Q = quote(10000, 90);

/* 1 · merchant detected */
export function ScreenDetect() {
  return (
    <ExtFrame tab="Detect" site="lifestylestores.com">
      <div className="flex items-center gap-3">
        <BrandMark id="lifestyle" size={36} />
        <div>
          <div className="text-[14px] font-semibold">Pay for this shop with crypto</div>
          <div className="text-[11.5px] text-mute">Merchant recognised from domain only</div>
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="relative mt-4 rounded-2xl bg-mint/[0.06] p-3.5 ring-1 ring-mint/40"
      >
        <div className="label !text-mint">Best for you</div>
        <div className="mt-1.5 flex items-center justify-between text-[13.5px]">
          <span>NetPositive voucher</span>
          <span className="font-semibold">1% fee</span>
        </div>
        <div className="mt-1 text-[12px] text-mute">₹10,000 Lifestyle voucher for {usdt(Q.sellerLocks)} USDT</div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-2.5 rounded-2xl bg-white/[0.02] p-3.5 opacity-60 ring-1 ring-white/[0.07]"
      >
        <div className="label">Not in your region</div>
        <div className="mt-1.5 flex items-center justify-between text-[13.5px]">
          <span className="text-mute">Crypto.com Visa (Obsidian, EU)</span>
          <span className="text-mute">4.5% back</span>
        </div>
        <div className="mt-1 text-[12px] text-dim">First US$5,000/month only. Needs US$500k staked.</div>
      </motion.div>
      <div className="mt-4 grid h-10 place-items-center rounded-full bg-white text-[13px] font-medium text-ink">Post voucher request</div>
    </ExtFrame>
  );
}

/* 2 · request + lock */
export function ScreenRequest() {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLocked(true), 900);
    return () => clearTimeout(t);
  }, []);
  return (
    <ExtFrame tab="Request">
      <div className="text-[14px] font-semibold">Your request</div>
      <div className="mt-2 divide-y divide-white/[0.05] text-[13px]">
        {[
          ["Voucher", "Lifestyle · ₹10,000"],
          ["Rate", "₹90 / USDT"],
          ["Buyer receives", `${usdt(Q.buyerReceives)} USDT`],
          ["Fee (1%)", `${usdt(Q.fee)} USDT`],
          ["You lock", `${usdt(Q.sellerLocks)} USDT`],
        ].map(([k, v], i) => (
          <div key={k} className="flex justify-between py-2">
            <span className="text-mute">{k}</span>
            <span className={cx("tabular", i === 4 && "font-semibold text-mint")}>{v}</span>
          </div>
        ))}
      </div>
      <div className={cx("mt-3 flex items-center gap-2.5 rounded-2xl p-3 ring-1 transition-all duration-700", locked ? "bg-mint/[0.08] ring-mint/40" : "bg-white/[0.02] ring-white/10")}>
        <span className={cx("grid size-8 place-items-center rounded-full transition", locked ? "bg-mint text-ink" : "bg-white/5 text-mute")}>
          {locked ? <Lock className="size-4" /> : <LoaderCircle className="size-4 animate-spin" />}
        </span>
        <div className="font-mono text-[10.5px] uppercase leading-snug tracking-[0.1em] text-mint">
          {locked ? "Locked in escrow · releases only after voucher check" : "Confirming in wallet…"}
        </div>
      </div>
    </ExtFrame>
  );
}

/* 3 · buyer route ranking */
export function ScreenRoutes() {
  const routes = routesFor(10000).filter((r) => r.cardId === "infinia");
  return (
    <ExtFrame tab="Buy USDT">
      <div className="text-[14px] font-semibold">Lifestyle ₹10,000 → {usdt(Q.buyerReceives)} USDT</div>
      <div className="mt-3 space-y-2">
        {routes.map((r, i) => (
          <motion.div
            key={r.channel.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12 * i }}
            className={cx("rounded-2xl p-3 ring-1", i === 0 ? "bg-amber/[0.07] ring-amber/50" : "bg-white/[0.02] ring-white/[0.07]")}
          >
            {i === 0 && <div className="label mb-1 !text-amber">Best from your cards</div>}
            <div className="flex items-center justify-between text-[13px]">
              <span className={i ? "text-mute" : ""}>Infinia · {r.channel.name.replace(" 5X", "")}{i === 0 ? " 5X" : ""}</span>
              <span className="font-semibold tabular">{r.pctTravel}%</span>
            </div>
            {i === 0 && <div className="mt-0.5 text-[12px] text-mute">{r.points.toLocaleString("en-IN")} points ≈ {inr(r.travelInr)} on travel</div>}
            {i === 1 && <div className="mt-0.5 text-[12px] text-dim">{r.channel.note}</div>}
          </motion.div>
        ))}
      </div>
      <div className="mt-3 text-[11.5px] leading-relaxed text-mute">
        Voucher bonus left this month: <span className="text-fg">3,000 of 3,000</span> points. This uses 1,320.
      </div>
      <div className="mt-3 grid h-10 place-items-center rounded-full bg-amber text-[13px] font-medium text-ink">Accept order</div>
    </ExtFrame>
  );
}

/* 4 · guided checkout */
export function ScreenGuide() {
  const steps = [
    <>Open SmartBuy → Gift Vouchers → Lifestyle</>,
    <>
      Choose the <b className="text-fg">accelerated rewards</b> tab, not InstaDeals
    </>,
    <>2 × ₹5,000 (largest denomination)</>,
    <>Pay with Infinia</>,
  ];
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x + 1) % 5), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <ExtFrame tab="Guide" site="smartbuy.hdfcbank.com">
      <div className="text-[14px] font-semibold">Buy it this way</div>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className={cx("flex gap-3 rounded-xl p-2.5 text-[12.5px] transition-all duration-500", i < n ? "bg-white/[0.03] text-mute" : i === n ? "bg-amber/[0.07] text-fg ring-1 ring-amber/30" : "text-dim")}>
            <span className={cx("grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-semibold", i < n ? "bg-mint text-ink" : "bg-white/[0.06] text-amber")}>
              {i < n ? <Check className="size-3" /> : i + 1}
            </span>
            <span className="leading-snug">{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 text-[11.5px] text-dim">Points post within 90 working days, per SmartBuy terms.</div>
    </ExtFrame>
  );
}

/* 5 · verification */
export function ScreenVerify({ auto = true }: { auto?: boolean }) {
  const checks = ["Code 1: live, ₹5,000 balance, not redeemed", "Code 2: live, ₹5,000 balance, not redeemed", "Brand matches: Lifestyle (in-store)", "Expiry: 6 months from issue"];
  const [n, setN] = useState(auto ? 0 : 4);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setN((x) => (x >= 6 ? 0 : x + 1)), 650);
    return () => clearInterval(t);
  }, [auto]);
  return (
    <ExtFrame tab="Verification">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">Voucher check</div>
        <span className="font-mono text-[10px] text-iris">issuer balance API</span>
      </div>
      <ul className="mt-3 space-y-2">
        {checks.map((c, i) => (
          <li key={c} className="flex items-center gap-2.5 text-[12.5px]">
            <span className={cx("grid size-5 place-items-center rounded-full transition-all duration-300", i < n ? "bg-mint/15 text-mint" : "bg-white/[0.04] text-dim")}>
              {i < n ? <Check className="size-3" /> : i === n ? <LoaderCircle className="size-3 animate-spin text-iris" /> : <span className="size-1 rounded-full bg-current" />}
            </span>
            <span className={i < n ? "text-fg/90" : "text-dim"}>{c}</span>
          </li>
        ))}
      </ul>
      <AnimatePresence>
        {n >= 4 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-xl bg-iris/[0.08] p-3 ring-1 ring-iris/30"
          >
            <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-iris">
              <ShieldCheck className="size-3.5" /> Signed result sent to escrow
            </div>
            <div className="mt-1.5 truncate font-mono text-[10px] text-dim">sig 0x9c1f…a4e2 · VR-24817 · ₹10,000 · PASS · 14:02:11</div>
          </motion.div>
        )}
      </AnimatePresence>
    </ExtFrame>
  );
}

/* 6 · seller reveal */
export function ScreenReveal() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <ExtFrame tab="Your vouchers">
      <div className="text-[14px] font-semibold">2 × Lifestyle ₹5,000</div>
      <div className="text-[11.5px] text-mute">Codes visible to you only.</div>
      <div className="mt-3 space-y-2">
        {["LFS-7Q2K-91XA-3M8D", "LFS-4HWE-22PL-0Z6R"].map((c) => (
          <div key={c} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.07]">
            <span className={cx("font-mono text-[12px] tracking-wider transition-all duration-700", show ? "text-fg blur-0" : "text-mute blur-[5px]")}>{c}</span>
            <Eye className="size-3.5 text-dim" />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-xl bg-mint/[0.06] px-3 py-2.5 ring-1 ring-mint/40 text-[12.5px]">
        <span className="text-mute">Re-checked just now</span>
        <span className="font-semibold text-mint">₹10,000 live</span>
      </div>
      <div className="mt-3 grid h-10 place-items-center rounded-full bg-mint text-[13px] font-medium text-ink">I&apos;ve received them</div>
      <div className="mt-2.5 text-[11px] leading-relaxed text-dim">USDT goes to the buyer the moment you confirm, or automatically 30 min after the re-check passes.</div>
    </ExtFrame>
  );
}
