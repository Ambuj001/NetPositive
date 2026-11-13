import { animate, motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import { clsx } from "clsx";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { findBrand, brand as getBrand } from "../lib/data";

export const cx = clsx;

/* ------------------------------------------------------------------ Logo */

/** The mark: a black tile with a 5×5 LED grid; the lit cells draw the "+" of NetPositive. */
export function Mark({ className, lit = "#00c866" }: { className?: string; lit?: string }) {
  const on = new Set(["0-2", "1-2", "2-0", "2-1", "2-2", "2-3", "2-4", "3-2", "4-2"]);
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0c0d0f" />
      {Array.from({ length: 25 }, (_, i) => {
        const r = Math.floor(i / 5);
        const c = i % 5;
        const isOn = on.has(`${r}-${c}`);
        return <circle key={i} cx={6.4 + c * 4.8} cy={6.4 + r * 4.8} r={isOn ? 1.85 : 1.1} fill={isOn ? lit : "#2c2e33"} />;
      })}
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Link to="/" className={cx("group flex items-center gap-2.5", className)} aria-label="NetPositive home">
      <Mark className="size-8 transition-transform duration-500 group-hover:rotate-90" />
      {!compact && <span className="text-[17px] font-semibold tracking-[-0.03em]">NetPositive</span>}
    </Link>
  );
}

/* ---------------------------------------------------------------- Button */
type BtnProps = ComponentProps<"button"> & {
  variant?: "primary" | "volt" | "ghost" | "outline" | "amber";
  size?: "sm" | "md" | "lg";
  to?: string;
  href?: string;
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "md", className, children, to, href, icon, ...rest }: BtnProps) {
  const cls = cx(
    "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,box-shadow,transform,color] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
    size === "sm" && "h-9 px-4 text-[13.5px]",
    size === "md" && "h-11 px-5 text-[14.5px]",
    size === "lg" && "h-13 px-7 text-[15.5px]",
    variant === "primary" && "bg-fg text-white hover:bg-[#25272c]",
    variant === "volt" && "bg-mint text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)] hover:bg-mint-2",
    variant === "amber" && "bg-amber text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)] hover:brightness-95",
    variant === "outline" && "bg-surface text-fg ring-1 ring-line-2 hover:bg-sunken",
    variant === "ghost" && "text-mute hover:bg-sunken hover:text-fg",
    className,
  );
  const inner = (
    <>
      {children}
      {icon && <span className="transition-transform duration-200 group-hover:translate-x-0.5">{icon}</span>}
    </>
  );
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  if (href) {
    const external = /^https?:/.test(href);
    return (
      <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {inner}
      </a>
    );
  }
  return (
    <button className={cls} {...rest}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({ className, children, glow: _glow, ...rest }: ComponentProps<"div"> & { glow?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(12,13,15,0.04)]", className)} {...rest}>
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
    mint: "text-mint-ink bg-mint-soft ring-mint/30",
    amber: "text-amber-ink bg-amber/12 ring-amber/35",
    iris: "text-iris bg-iris/8 ring-iris/25",
    rose: "text-rose-ink bg-rose/8 ring-rose/25",
    mute: "text-mute bg-sunken ring-line",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] ring-1", t, className)}>
      {dot && (
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-50" />
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
    seller: { label: "Spender", cls: "text-mint-ink bg-mint-soft ring-mint/40" },
    buyer: { label: "Buyer", cls: "text-amber-ink bg-amber/12 ring-amber/40" },
    verifier: { label: "Verification layer", cls: "text-iris bg-iris/8 ring-iris/30" },
  }[who];
  return <span className={cx("rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] ring-1", m.cls)}>{m.label}</span>;
}

/* -------------------------------------------------------- Brand mark */
export function BrandMark({ id, size = 40, className, name }: { id: string; size?: number; className?: string; name?: string }) {
  const known = findBrand(id);
  const b = known ?? { ...getBrand(id), color: "#5f636b", glyph: (name ?? id).slice(0, 1).toUpperCase() };
  // Only brands we know get a logo; unknown ids would otherwise inherit the fallback brand's.
  const logo = known?.logo;
  const [broken, setBroken] = useState<string | null>(null);

  if (logo && broken !== logo) {
    return (
      <span
        className={cx("relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white ring-1 ring-line", className)}
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
      className={cx("relative grid shrink-0 place-items-center overflow-hidden rounded-xl font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.44, background: b.color }}
      aria-hidden
    >
      {b.glyph}
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
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={cx("max-w-2xl", center && "mx-auto text-center", className)}
    >
      <div className={cx("eyebrow mb-3 flex items-center gap-2", center && "justify-center")}>
        <span className="size-1.5 rounded-[2px] bg-mint" />
        {eyebrow}
      </div>
      <h2 className="text-[34px] font-semibold leading-[1.06] tracking-[-0.035em] md:text-[44px]">{title}</h2>
      {sub && <p className="mt-4 text-[16px] leading-relaxed text-mute">{sub}</p>}
    </motion.div>
  );
}

/* ---------------------------------------------------- Tilt container */
export function Tilt({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) {
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

/* ------------------------------------------- Page backdrop (was glows) */
/** Inside pages get a faint dot field at the top instead of the old coloured glows. */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden", className)}>
      <div className="dot-bg absolute inset-0 [mask-image:linear-gradient(to_bottom,#000,transparent_85%)] opacity-60" />
    </div>
  );
}

/* ------------------------------------------------ Page heading block */
export function PageHead({ eyebrow, title, sub, right }: { eyebrow: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
      <div className="max-w-2xl">
        <div className="eyebrow mb-2 flex items-center gap-2">
          <span className="size-1.5 rounded-[2px] bg-mint" />
          {eyebrow}
        </div>
        <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[42px]">{title}</h1>
        {sub && <p className="mt-3 text-[15.5px] leading-relaxed text-mute">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* --------------------------------------------- Dot-matrix ticker text */
/**
 * Big dot-matrix lettering (Doto) with an optional "boot" animation where characters scramble into place,
 * like a split-flap / LED board settling.
 */
export function DotText({ text, className, scramble = true }: { text: string; className?: string; scramble?: boolean }) {
  const [shown, setShown] = useState(text);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!scramble) {
      setShown(text);
      return;
    }
    if (!inView) return;
    const glyphs = "0123456789+%$₹#";
    let frame = 0;
    const total = 18;
    const id = window.setInterval(() => {
      frame++;
      setShown(
        text
          .split("")
          .map((ch, i) => (ch === " " || frame > total * (i + 1) / text.length + 4 ? ch : glyphs[(frame + i * 7) % glyphs.length]))
          .join(""),
      );
      if (frame > total + 6) {
        window.clearInterval(id);
        setShown(text);
      }
    }, 45);
    return () => window.clearInterval(id);
  }, [text, inView, scramble]);
  return (
    <span ref={ref} className={cx("font-dot font-black tracking-[0.02em]", className)} aria-label={text}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

/* ----------------------------------------------------- Tilted sticker */
export function Sticker({ children, className, tilt = -3 }: { children: ReactNode; className?: string; tilt?: number }) {
  return (
    <span
      className={cx("inline-block bg-mint px-[0.28em] pb-[0.06em] font-semibold text-ink shadow-[0.06em_0.06em_0_#0c0d0f]", className)}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ Marquee */
export function Marquee({ children, className, speed = 40 }: { children: ReactNode; className?: string; speed?: number }) {
  return (
    <div className={cx("relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)]", className)}>
      <div className="flex w-max animate-marquee hover:[animation-play-state:paused]" style={{ animationDuration: `${speed}s` }}>
        <div className="flex shrink-0 items-center">{children}</div>
        <div className="flex shrink-0 items-center" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
