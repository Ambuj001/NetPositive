import { animate, AnimatePresence, motion } from "motion/react";
import { BadgeCheck, Check, Lock, ScanLine, Sparkles, Store } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/**
 * Hero "rail": Seller ⇄ Escrow ⇄ Buyer.
 * Loops through one trade using the walkthrough numbers:
 * Seller 120 USDC → locks 112.22 → keeps 7.78 and gets ₹10,000 vouchers,
 * Buyer gets 111.11 USDC + 1,650 card points.
 */

type Phase = 0 | 1 | 2 | 3 | 4;
const DURATIONS: Record<Phase, number> = { 0: 1600, 1: 2200, 2: 2400, 3: 2200, 4: 2600 };

const STATE: Record<Phase, { rUsdt: number; rVouch: number; escrow: number; pUsdt: number; pPts: number; status: string }> = {
  0: { rUsdt: 120, rVouch: 0, escrow: 0, pUsdt: 0, pPts: 0, status: "waiting for order" },
  1: { rUsdt: 7.78, rVouch: 0, escrow: 112.22, pUsdt: 0, pPts: 0, status: "locked · order live" },
  2: { rUsdt: 7.78, rVouch: 0, escrow: 112.22, pUsdt: 0, pPts: 0, status: "checking vouchers" },
  3: { rUsdt: 7.78, rVouch: 10000, escrow: 0, pUsdt: 111.11, pPts: 1650, status: "released" },
  4: { rUsdt: 7.78, rVouch: 10000, escrow: 0, pUsdt: 111.11, pPts: 1650, status: "settled" },
};

export function HeroRail({ className }: { className?: string }) {
  const [phase, setPhase] = useState<Phase>(0);
  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => ((p + 1) % 5) as Phase), DURATIONS[phase]);
    return () => clearTimeout(t);
  }, [phase]);

  const s = STATE[phase];
  const sellerOn = phase === 1 || phase === 3;
  const buyerOn = phase === 2 || phase === 3;

  return (
    <div className={cx("relative mx-auto w-full max-w-5xl", className)}>
      <div className="grid items-center gap-0 md:grid-cols-[minmax(0,1fr)_minmax(40px,0.42fr)_auto_minmax(40px,0.42fr)_minmax(0,1fr)]">
        {/* Seller */}
        <PersonaCard
          tone="mint"
          active={sellerOn}
          eyebrow="Crypto holder"
          name="Seller"
          city="sells USDC"
          avatar={<Avatar letter="S" tone="mint" />}
          stats={[
            { k: "USDC", v: <Tween value={s.rUsdt} format={(n) => n.toFixed(2)} /> },
            { k: "Vouchers", v: <Tween value={s.rVouch} format={(n) => "₹" + Math.round(n).toLocaleString("en-IN")} /> },
          ]}
          footer={
            <>
              <Store className="size-3.5 shrink-0 text-mint/80" />
              {phase >= 3 ? "Got live Lifestyle codes, shops Saturday" : "Has USDC, wants a Lifestyle voucher"}
            </>
          }
        />

        <Rail side="left" tone="mint" lit={phase === 1 || phase === 3} flow={phase === 1 ? "in" : phase === 3 ? "out" : null} flowColor={phase === 3 ? "#8b7bff" : "#3ddc97"} />

        {/* Escrow diamond */}
        <div className="relative mx-auto my-2 grid size-[168px] place-items-center md:my-0">
          <motion.div
            animate={{ boxShadow: s.escrow > 0 ? "0 0 70px -10px rgba(61,220,151,0.55)" : "0 0 40px -16px rgba(255,255,255,0.15)" }}
            transition={{ duration: 0.8 }}
            className="absolute inset-[22px] rotate-45 rounded-[26px] bg-gradient-to-br from-white/[0.09] to-white/[0.015] ring-1 ring-white/15 backdrop-blur-xl"
          >
            <div className="absolute inset-[7px] rounded-[20px] ring-1 ring-white/[0.06]" />
            {s.escrow > 0 && <span className="absolute inset-0 animate-pulse-ring rounded-[26px] ring-1 ring-mint/50" />}
          </motion.div>
          <div className="relative flex flex-col items-center text-center">
            <span className={cx("grid size-7 place-items-center rounded-full ring-1 transition-colors duration-500", s.escrow > 0 ? "bg-mint/15 text-mint ring-mint/40" : "bg-white/[0.06] text-mute ring-white/15")}>
              {phase === 2 ? <ScanLine className="size-3.5 text-iris" /> : phase >= 3 ? <Check className="size-3.5" /> : <Lock className="size-3.5" />}
            </span>
            <span className="mt-2 font-mono text-[9.5px] tracking-[0.22em] text-mute uppercase">Escrow</span>
            <span className="font-display text-[26px] leading-tight font-semibold tracking-tight text-fg tabular">
              <Tween value={s.escrow} format={(n) => n.toFixed(2)} />
            </span>
            <span className="font-mono text-[9.5px] tracking-wider text-dim">USDC on Base</span>
          </div>
          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap">
            <AnimatePresence mode="wait">
              <motion.span
                key={s.status}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className={cx("font-mono text-[10px] tracking-[0.14em] uppercase", phase === 2 ? "text-iris" : phase >= 3 ? "text-mint" : "text-mute")}
              >
                {s.status}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        <Rail side="right" tone="amber" lit={buyerOn} flow={phase === 2 ? "in" : phase === 3 ? "out" : null} flowColor={phase === 2 ? "#f5b544" : "#3ddc97"} />

        {/* Buyer */}
        <PersonaCard
          tone="amber"
          active={buyerOn}
          eyebrow="Card holder"
          name="Buyer"
          city="buys USDC"
          avatar={<Avatar letter="B" tone="amber" verified />}
          stats={[
            { k: "USDC", v: <Tween value={s.pUsdt} format={(n) => n.toFixed(2)} /> },
            { k: "Card points", v: <Tween value={s.pPts} format={(n) => "+" + Math.round(n).toLocaleString("en-IN")} /> },
          ]}
          footer={
            <>
              <Sparkles className="size-3.5 shrink-0 text-amber/80" />
              {phase === 2 ? "Buying on SmartBuy 5X with Infinia…" : "Pays on HDFC Infinia, keeps 100% of rewards"}
            </>
          }
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PersonaCard({
  tone,
  active,
  eyebrow,
  name,
  city,
  avatar,
  stats,
  footer,
}: {
  tone: "mint" | "amber";
  active: boolean;
  eyebrow: string;
  name: string;
  city: string;
  avatar: ReactNode;
  stats: { k: string; v: ReactNode }[];
  footer: ReactNode;
}) {
  const c = tone === "mint" ? { text: "text-mint", ring: "ring-mint/45", glow: "rgba(61,220,151,0.35)" } : { text: "text-amber", ring: "ring-amber/55", glow: "rgba(245,181,68,0.35)" };
  return (
    <motion.div
      animate={{ y: active ? -4 : 0, boxShadow: active ? `0 24px 70px -18px ${c.glow}, 0 0 0 1px ${c.glow}` : "0 24px 60px -24px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0)" }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className={cx(
        "relative w-full overflow-hidden rounded-[22px] bg-gradient-to-b from-white/[0.075] to-white/[0.02] p-4 text-left ring-1 backdrop-blur-xl transition-[--tw-ring-color] duration-500 md:max-w-[320px]",
        active ? c.ring : "ring-white/10",
        tone === "amber" && "md:justify-self-end",
      )}
    >
      <div className={cx("pointer-events-none absolute inset-x-0 top-0 h-24 opacity-0 transition-opacity duration-700", active && "opacity-100")} style={{ background: `radial-gradient(80% 100% at 30% 0%, ${c.glow.replace("0.35", "0.14")}, transparent)` }} />
      <div className="relative flex items-center gap-3">
        {avatar}
        <div className="min-w-0">
          <div className={cx("font-mono text-[9.5px] font-semibold tracking-[0.2em] uppercase", c.text)}>{eyebrow}</div>
          <div className="mt-0.5 truncate text-[14.5px]">
            <span className="font-semibold text-fg">{name}</span>
            <span className="text-mute"> · {city}</span>
          </div>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-2">
        {stats.map((st) => (
          <div key={st.k} className="rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/[0.06]">
            <div className="text-[11px] text-mute">{st.k}</div>
            <div className="mt-0.5 text-[16px] font-semibold tracking-tight text-fg tabular">{st.v}</div>
          </div>
        ))}
      </div>
      <div className="relative mt-3.5 flex min-h-[32px] items-center gap-2 text-[11.5px] leading-snug text-mute">{footer}</div>
    </motion.div>
  );
}

function Avatar({ letter, tone, verified }: { letter: string; tone: "mint" | "amber"; verified?: boolean }) {
  return (
    <span className="relative shrink-0">
      <span
        className={cx(
          "grid size-10 place-items-center rounded-full text-[14px] font-bold text-white ring-1 ring-white/20",
          tone === "mint" ? "bg-gradient-to-br from-[#2fd39a] to-[#0d6b4c]" : "bg-gradient-to-br from-[#d9925a] to-[#7a4424]",
        )}
      >
        {letter}
      </span>
      {verified && (
        <span className="absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full bg-ink ring-1 ring-white/10" title="World ID verified">
          <BadgeCheck className="size-3.5 text-iris" />
        </span>
      )}
    </span>
  );
}

/** Rail track with ties; a glowing token runs along it during transfers. */
function Rail({
  side,
  tone,
  lit,
  flow,
  flowColor,
}: {
  side: "left" | "right";
  tone: "mint" | "amber";
  lit: boolean;
  flow: "in" | "out" | null;
  flowColor: string;
}) {
  const col = tone === "mint" ? "61,220,151" : "245,181,68";
  // "in" moves toward the escrow (center), "out" moves away from it
  const towardRight = (side === "left" && flow === "in") || (side === "right" && flow === "out");
  const ties = (a: number) => `repeating-linear-gradient(90deg, rgba(${lit ? col : "255,255,255"},${a}) 0 1.5px, transparent 1.5px 9px)`;
  const tiesV = (a: number) => `repeating-linear-gradient(180deg, rgba(${lit ? col : "255,255,255"},${a}) 0 1.5px, transparent 1.5px 9px)`;
  const rail = lit ? `rgba(${col},0.75)` : "rgba(255,255,255,0.16)";

  return (
    <>
      {/* desktop: horizontal */}
      <div className="relative hidden h-[14px] md:block [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="absolute inset-0 transition-all duration-700" style={{ background: ties(lit ? 0.45 : 0.14) }} />
        <div className="absolute inset-x-0 top-0 h-px transition-colors duration-700" style={{ background: rail }} />
        <div className="absolute inset-x-0 bottom-0 h-px transition-colors duration-700" style={{ background: rail }} />
        {flow && (
          <motion.span
            key={`${side}-${flow}-${flowColor}`}
            className="absolute top-1/2 h-[6px] w-10 -translate-y-1/2 rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, ${flowColor})`, boxShadow: `0 0 16px 2px ${flowColor}`, scaleX: towardRight ? 1 : -1 }}
            initial={{ left: towardRight ? "-15%" : "100%" }}
            animate={{ left: towardRight ? "100%" : "-15%" }}
            transition={{ duration: 1.1, ease: [0.45, 0, 0.2, 1], repeat: 1 }}
          />
        )}
      </div>
      {/* mobile: vertical */}
      <div className="relative mx-auto h-12 w-[14px] md:hidden">
        <div className="absolute inset-0" style={{ background: tiesV(lit ? 0.45 : 0.14) }} />
        <div className="absolute inset-y-0 left-0 w-px" style={{ background: rail }} />
        <div className="absolute inset-y-0 right-0 w-px" style={{ background: rail }} />
      </div>
    </>
  );
}

/** Tweens displayed text whenever `value` changes. */
function Tween({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(value);
  const fmt = useRef(format);
  fmt.current = format;
  useEffect(() => {
    const ctrl = animate(from.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = fmt.current(v);
      },
    });
    from.current = value;
    return () => ctrl.stop();
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}
