import { AnimatePresence, motion } from "motion/react";
import { CreditCard, FingerprintPattern, Lock, ScanLine, User } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./ui";

type Edge = { id: string; d: string; color: string; label: string; lx: number; ly: number; dashed?: boolean };

const W = 800;
const H = 440;

const NODES = {
  seller: { x: 110, y: 140 },
  escrow: { x: 400, y: 140 },
  buyer: { x: 690, y: 140 },
  verifier: { x: 400, y: 340 },
  portal: { x: 690, y: 340 },
};

const EDGES: Record<string, Edge> = {
  lock: { id: "lock", d: "M150 128 L360 128", color: "#3ddc97", label: "lock 112.22 USDT", lx: 255, ly: 112 },
  accept: { id: "accept", d: "M650 128 L440 128", color: "#eef1f5", label: "World ID · accept", lx: 545, ly: 112 },
  pay: { id: "pay", d: "M690 182 L690 300", color: "#f5b544", label: "₹10,000 on card", lx: 742, ly: 245, dashed: true },
  codes: { id: "codes", d: "M650 340 L440 340", color: "#8b7bff", label: "encrypted codes", lx: 545, ly: 326 },
  pass: { id: "pass", d: "M400 300 L400 182", color: "#8b7bff", label: "signed pass", lx: 350, ly: 245 },
  reveal: { id: "reveal", d: "M360 154 L150 154", color: "#8b7bff", label: "codes → seller", lx: 255, ly: 176 },
  release: { id: "release", d: "M440 154 L650 154", color: "#3ddc97", label: "111.11 USDT → buyer", lx: 545, ly: 176 },
};

const STEPS: { title: string; edges: string[]; active: (keyof typeof NODES)[] }[] = [
  { title: "Seller locks 112.22 USDT in escrow", edges: ["lock"], active: ["seller", "escrow"] },
  { title: "Buyer proves they're human and accepts", edges: ["accept"], active: ["buyer", "escrow"] },
  { title: "Buyer buys the voucher on SmartBuy 5X", edges: ["pay"], active: ["buyer", "portal"] },
  { title: "Codes go encrypted to the verifier", edges: ["codes"], active: ["portal", "verifier"] },
  { title: "Live balance check → signed pass", edges: ["pass"], active: ["verifier", "escrow"] },
  { title: "Seller gets codes · Buyer gets USDT", edges: ["reveal", "release"], active: ["seller", "escrow", "buyer"] },
];

export function FlowDiagram({ className }: { className?: string }) {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => clearInterval(t);
  }, [paused]);
  const cur = STEPS[step];
  const done = new Set(STEPS.slice(0, step).flatMap((s) => s.edges));

  return (
    <div className={cx("relative", className)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative w-full" style={{ aspectRatio: `${W}/${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden>
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {Object.values(EDGES).map((e) => {
            const on = cur.edges.includes(e.id);
            const was = done.has(e.id);
            return (
              <g key={e.id}>
                <path d={e.d} stroke="rgba(255,255,255,0.07)" strokeWidth="1.5" fill="none" />
                <path
                  d={e.d}
                  stroke={e.color}
                  strokeWidth={on ? 2 : 1.2}
                  fill="none"
                  strokeLinecap="round"
                  className={on ? "flow-line" : undefined}
                  style={{ opacity: on ? 1 : was ? 0.28 : 0, transition: "opacity .5s" }}
                  strokeDasharray={!on && e.dashed ? "5 6" : undefined}
                />
                {on && (
                  <circle key={`${e.id}-${step}`} r="5" fill={e.color} filter="url(#glow)">
                    <animateMotion dur="1.3s" repeatCount="indefinite" path={e.d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" />
                  </circle>
                )}
                <text
                  x={e.lx}
                  y={e.ly}
                  textAnchor="middle"
                  className="font-mono max-sm:hidden"
                  fontSize="11"
                  fill={on ? e.color : "rgba(255,255,255,0.25)"}
                  style={{ transition: "fill .4s", letterSpacing: "0.02em" }}
                >
                  {e.label}
                </text>
              </g>
            );
          })}
        </svg>

        <Node at={NODES.seller} on={cur.active.includes("seller")} tone="mint" icon={<User className="size-5" />} title="Seller" sub="has USDT" />
        <Node at={NODES.escrow} on={cur.active.includes("escrow")} tone="mint" icon={<Lock className="size-5" />} title="Escrow" sub="holds the USDT" big />
        <Node at={NODES.buyer} on={cur.active.includes("buyer")} tone="amber" icon={<FingerprintPattern className="size-5" />} title="Buyer" sub="has a card" />
        <Node at={NODES.verifier} on={cur.active.includes("verifier")} tone="iris" icon={<ScanLine className="size-5" />} title="Verifier" sub="checks balance" />
        <Node at={NODES.portal} on={cur.active.includes("portal")} tone="amber" icon={<CreditCard className="size-5" />} title="SmartBuy" sub="5X rewards" />
      </div>

      <div className="mt-2 flex flex-col items-center gap-4">
        <div className="relative h-6 w-full overflow-hidden text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="text-[14px] text-fg/90"
            >
              <span className="mr-2 font-mono text-[12px] text-mint">0{step + 1}</span>
              {cur.title}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}`}
              className="relative h-1 w-8 overflow-hidden rounded-full bg-white/10"
            >
              {i < step && <span className="absolute inset-0 bg-mint/60" />}
              {i === step && (
                <motion.span
                  key={`${step}-${paused}`}
                  className="absolute inset-y-0 left-0 bg-mint"
                  initial={{ width: paused ? "100%" : "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: paused ? 0 : 2.6, ease: "linear" }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Node({
  at,
  on,
  tone,
  icon,
  title,
  sub,
  big,
}: {
  at: { x: number; y: number };
  on: boolean;
  tone: "mint" | "amber" | "iris";
  icon: ReactNode;
  title: string;
  sub: string;
  big?: boolean;
}) {
  const c = { mint: "#3ddc97", amber: "#f5b544", iris: "#8b7bff" }[tone];
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(at.x / W) * 100}%`, top: `${(at.y / H) * 100}%` }}>
      <motion.div
        animate={{ scale: on ? 1.06 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="relative flex flex-col items-center"
      >
        {on && (
          <span className="absolute top-0 left-1/2 -translate-x-1/2 rounded-2xl" style={{ width: big ? 72 : 56, height: big ? 72 : 56 }}>
            <span className="absolute inset-0 animate-pulse-ring rounded-2xl" style={{ boxShadow: `0 0 0 1.5px ${c}` }} />
          </span>
        )}
        <div
          className={cx("relative grid place-items-center rounded-2xl ring-1 backdrop-blur transition-all duration-500", big ? "size-[72px]" : "size-14")}
          style={{
            background: on ? `radial-gradient(100% 100% at 50% 0%, ${c}33, #0b0d12)` : "#0b0d12",
            color: on ? c : "#5a6170",
            boxShadow: on ? `0 0 40px -6px ${c}88, inset 0 1px 0 rgba(255,255,255,0.1)` : "inset 0 1px 0 rgba(255,255,255,0.06)",
            borderColor: "transparent",
            ["--tw-ring-color" as string]: on ? `${c}66` : "rgba(255,255,255,0.08)",
          }}
        >
          {icon}
        </div>
        <div className="mt-2 whitespace-nowrap text-center">
          <div className={cx("text-[12.5px] font-semibold transition-colors", on ? "text-fg" : "text-mute")}>{title}</div>
          <div className="hidden font-mono text-[10px] text-dim sm:block">{sub}</div>
        </div>
      </motion.div>
    </div>
  );
}
