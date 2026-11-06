import { animate, motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import { clsx } from "clsx";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { findBrand, brand as getBrand } from "../lib/data";

export const cx = clsx;

/* ------------------------------------------------------------------ Logo */
export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx("group flex items-center gap-2.5", className)} aria-label="NetPositive home">
      <span className="relative grid size-8 place-items-center rounded-[10px] bg-gradient-to-b from-white/12 to-white/[0.02] ring-1 ring-white/12">
        {/* NetPositive mark: "N" with a plus, from the team's repo */}
        <svg viewBox="0 0 40 32" className="h-[15px] w-[19px]" fill="none" aria-hidden>
          <path d="M4 26V6h5l17 20h5V6" stroke="url(#np)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M23 6h13M31 1v10"
            stroke="#f5b544"
            strokeWidth="2.8"
            strokeLinecap="round"
            className="origin-[31px_6px] transition-transform duration-500 group-hover:rotate-90"
          />
          <defs>
            <linearGradient id="np" x1="0" x2="1">
              <stop offset="0" stopColor="#3ddc97" />
              <stop offset="1" stopColor="#b6f5d6" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      <span className="font-display text-[17px] font-semibold tracking-tight">
        Net<span className="text-mute">Positive</span>
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- Button */
type BtnProps = ComponentProps<"button"> & {
  variant?: "primary" | "ghost" | "outline" | "amber";
  size?: "sm" | "md" | "lg";
  to?: string;
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "md", className, children, to, icon, ...rest }: BtnProps) {
  const cls = cx(
    "group relative inline-flex select-none items-center justify-center gap-2 overflow-hidden rounded-full font-medium tracking-tight transition-all duration-300 disabled:pointer-events-none disabled:opacity-40",
    size === "sm" && "h-9 px-4 text-[13px]",
    size === "md" && "h-11 px-5 text-[14px]",
    size === "lg" && "h-13 px-7 text-[15px]",
    variant === "primary" &&
      "bg-mint text-ink shadow-[0_0_0_1px_rgba(61,220,151,0.5),0_8px_30px_-6px_rgba(61,220,151,0.55),inset_0_1px_0_rgba(255,255,255,0.5)] hover:shadow-[0_0_0_1px_rgba(61,220,151,0.8),0_10px_44px_-6px_rgba(61,220,151,0.8),inset_0_1px_0_rgba(255,255,255,0.6)] hover:brightness-110",
    variant === "amber" &&
      "bg-amber text-ink shadow-[0_0_0_1px_rgba(245,181,68,0.5),0_8px_30px_-6px_rgba(245,181,68,0.5),inset_0_1px_0_rgba(255,255,255,0.5)] hover:brightness-110",
    variant === "outline" && "bg-white/[0.03] text-fg ring-1 ring-white/12 hover:bg-white/[0.07] hover:ring-white/25",
    variant === "ghost" && "text-mute hover:bg-white/5 hover:text-fg",
    className,
  );
  const inner = (
    <>
      {(variant === "primary" || variant === "amber") && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      )}
      <span className="relative flex items-center gap-2">
        {children}
        {icon}
      </span>
    </>
  );
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  return (
    <button className={cls} {...rest}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------- Spotlight card */
export function Card({
  className,
  children,
  glow = "rgba(61,220,151,0.10)",
  ...rest
}: ComponentProps<"div"> & { glow?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -400, y: -400 });
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  };
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setPos({ x: -400, y: -400 })}
      className={cx("hairline relative overflow-hidden rounded-3xl bg-ink-2/80", className)}
      {...rest}
    >
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{ background: `radial-gradient(420px circle at ${pos.x}px ${pos.y}px, ${glow}, transparent 60%)` }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- Pill */
export function Pill({
  tone = "mute",
  children,
  className,
  dot,
}: {
  tone?: "mint" | "amber" | "iris" | "rose" | "mute";
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const t = {
    mint: "text-mint bg-mint/10 ring-mint/25",
    amber: "text-amber bg-amber/10 ring-amber/25",
    iris: "text-iris bg-iris/10 ring-iris/25",
    rose: "text-rose bg-rose/10 ring-rose/25",
    mute: "text-mute bg-white/[0.04] ring-white/10",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] ring-1", t, className)}>
      {dot && (
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60" />
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

/* ------------------------------------------------------- Persona chip */
export function Persona({ who }: { who: "seller" | "buyer" | "verifier" }) {
  const m = {
    seller: { label: "Spender", cls: "text-mint ring-mint/40" },
    buyer: { label: "Buyer", cls: "text-amber ring-amber/40" },
    verifier: { label: "Verification layer", cls: "text-iris ring-iris/40" },
  }[who];
  return <span className={cx("rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] ring-1", m.cls)}>{m.label}</span>;
}

/* -------------------------------------------------------- Brand mark */
export function BrandMark({ id, size = 40, className, name }: { id: string; size?: number; className?: string; name?: string }) {
  const known = findBrand(id);
  const b = known ?? { ...getBrand(id), color: "#5a6170", glyph: (name ?? id).slice(0, 1).toUpperCase() };
  // Only brands we know get a logo; unknown ids would otherwise inherit the fallback brand's.
  const logo = known?.logo;
  const [broken, setBroken] = useState<string | null>(null);

  if (logo && broken !== logo) {
    return (
      <span
        className={cx("relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-white/10", className)}
        style={{ width: size, height: size, padding: known.logoPad ? Math.round(size * 0.14) : 0 }}
        aria-hidden
      >
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(logo)}
          className="size-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      className={cx("relative grid shrink-0 place-items-center overflow-hidden rounded-xl font-display font-bold text-white ring-1 ring-white/10", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.44,
        background: `radial-gradient(120% 120% at 20% 0%, ${b.color}, ${b.color}55 55%, #0b0d12)`,
      }}
      aria-hidden
    >
      {b.glyph}
      <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
    </span>
  );
}

/* --------------------------------------------------- Animated number */
export function Counter({
  value,
  format = (n) => n.toFixed(0),
  className,
  duration = 1.4,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const prev = useRef(0);
  useEffect(() => {
    if (!inView || !ref.current) return;
    const ctrl = animate(prev.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    prev.current = value;
    return () => ctrl.stop();
  }, [inView, value, duration, format]);
  return (
    <span ref={ref} className={cx("tabular", className)}>
      {format(0)}
    </span>
  );
}

/* ------------------------------------------------------ Section head */
export function SectionHead({
  eyebrow,
  title,
  sub,
  center,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cx("max-w-2xl", center && "mx-auto text-center")}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className={cx("label mb-4 flex items-center gap-2", center && "justify-center")}
      >
        <span className="h-px w-6 bg-gradient-to-r from-transparent to-mint" />
        {eyebrow}
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.05, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="text-gradient font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-5xl"
      >
        {title}
      </motion.h2>
      {sub && (
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.12, duration: 0.7 }}
          className="mt-5 text-[16px] leading-relaxed text-mute"
        >
          {sub}
        </motion.p>
      )}
    </div>
  );
}

/* ---------------------------------------------------- Tilt container */
export function Tilt({ children, className, max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [max, -max]), { stiffness: 150, damping: 18 });
  const ry = useSpring(useTransform(x, [0, 1], [-max, max]), { stiffness: 150, damping: 18 });
  return (
    <motion.div
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width);
        y.set((e.clientY - r.top) / r.height);
      }}
      onMouseLeave={() => {
        x.set(0.5);
        y.set(0.5);
      }}
    >
      {children}
    </motion.div>
  );
}

/* ----------------------------------------------------- Key/value row */
export function Row({ k, v, strong, className }: { k: ReactNode; v: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-4 py-2.5 text-[13.5px]", className)}>
      <span className="text-mute">{k}</span>
      <span className={cx("tabular text-right", strong ? "font-semibold text-fg" : "text-fg/90")}>{v}</span>
    </div>
  );
}

/* ----------------------------------------------------- Ambient glows */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="absolute -top-[30%] left-1/2 h-[70vh] w-[90vw] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(61,220,151,0.22),transparent)] blur-2xl" />
      <div className="absolute -top-[10%] left-[65%] h-[45vh] w-[40vw] rounded-full bg-[radial-gradient(closest-side,rgba(245,181,68,0.13),transparent)] blur-2xl" />
      <div className="absolute top-[5%] left-[5%] h-[40vh] w-[35vw] rounded-full bg-[radial-gradient(closest-side,rgba(139,123,255,0.12),transparent)] blur-2xl" />
    </div>
  );
}
