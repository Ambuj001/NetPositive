import { AnimatePresence, animate, motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import { clsx } from "clsx";
import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { findBrand, brand as getBrand } from "../lib/data";

export const cx = clsx;

/* ------------------------------------------------------------------ Logo */

/**
 * The mark: a 3×3 pixel grid. Five pixels draw the plus; the corner pixel is the "positive" one, in green.
 * `tone="white"` is for blue or dark backgrounds.
 */
export function Mark({ className, tone = "blue", animate = false }: { className?: string; tone?: "blue" | "white" | "black"; animate?: boolean }) {
  const fill = tone === "white" ? "#ffffff" : tone === "black" ? "#0a0b0d" : "#0000ff";
  const cells: [number, number][] = [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
  return (
    <svg viewBox="0 0 32 32" className={cx("np-mark", animate && "np-mark-in", className)} aria-hidden>
      {cells.map(([c, r], i) => (
        <rect key={i} x={2 + c * 9.67} y={2 + r * 9.67} width={8.66} height={8.66} rx={1.4} fill={fill} style={{ animationDelay: `${i * 60}ms` }} />
      ))}
      <rect className="np-mark-pos" x={2 + 2 * 9.67} y={2} width={8.66} height={8.66} rx={1.4} fill="#00c26e" style={{ animationDelay: "360ms" }} />
    </svg>
  );
}

export function Logo({ className, compact, tone = "blue" }: { className?: string; compact?: boolean; tone?: "blue" | "white" }) {
  return (
    <Link to="/" className={cx("np-logo group flex items-center gap-2.5", className)} aria-label="NetPositive home">
      <Mark className="size-7" tone={tone} />
      {!compact && <span className={cx("text-[18px] font-semibold tracking-[-0.035em]", tone === "white" && "text-white")}>NetPositive</span>}
    </Link>
  );
}

/* ---------------------------------------------------------------- Button */
type BtnProps = ComponentProps<"button"> & {
  variant?: "primary" | "volt" | "dark" | "white" | "ghost" | "outline" | "amber";
  size?: "sm" | "md" | "lg";
  to?: string;
  href?: string;
  icon?: ReactNode;
  /** A step is running: the icon becomes a spinner, the button is disabled and says so to screen readers. */
  pending?: boolean;
};

export function Button({ variant = "primary", size = "md", className, children, to, href, icon, pending, disabled, ...rest }: BtnProps) {
  const cls = cx(
    "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,box-shadow,transform,color,opacity] duration-200 ease-out-np active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 aria-busy:opacity-70",
    size === "sm" && "h-9 px-4 text-[13.5px]",
    size === "md" && "h-11 px-5 text-[14.5px]",
    size === "lg" && "h-13 px-7 text-[15.5px]",
    (variant === "primary" || variant === "volt") && "bg-brand text-white hover:bg-brand-2",
    (variant === "dark" || variant === "amber") && "bg-fg text-white hover:bg-[#25272c]",
    variant === "white" && "bg-white text-brand hover:bg-white/90",
    variant === "outline" && "bg-surface text-fg ring-1 ring-line-2 hover:bg-sunken",
    variant === "ghost" && "text-mute hover:bg-sunken hover:text-fg",
    className,
  );
  const shownIcon = pending ? <Spinner /> : icon;
  const inner = (
    <>
      {/* A changed label fades in rather than snapping. */}
      <span key={typeof children === "string" ? children : undefined} className="np-fade-in inline-flex min-w-0 items-center gap-2">
        {children}
      </span>
      {shownIcon && <span className={cx("inline-flex shrink-0", !pending && "transition-transform duration-200 group-hover:translate-x-0.5")}>{shownIcon}</span>}
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
    <button className={cls} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({ className, children, glow: _glow, ...rest }: ComponentProps<"div"> & { glow?: string }) {
  return (
    <div className={cx("panel overflow-hidden", className)} {...rest}>
      <div className="relative h-full">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- Tones */

/**
 * The five tones every status, badge and notice maps to. "mint" and "iris" are historical names for the brand blue;
 * "pos" is the green kept for gains and live signals; amber means "waiting / take care"; rose means "stop / problem".
 */
export type Tone = "mint" | "iris" | "pos" | "amber" | "rose" | "mute";
export const TONE_PILL: Record<Tone, string> = {
  mint: "text-brand-ink bg-brand-soft ring-brand/25",
  iris: "text-brand-ink bg-brand-soft ring-brand/25",
  pos: "text-pos-ink bg-pos/10 ring-pos/30",
  amber: "text-amber-ink bg-amber/12 ring-amber/35",
  rose: "text-rose-ink bg-rose/8 ring-rose/25",
  mute: "text-mute bg-sunken ring-line",
};
export const TONE_DOT: Record<Tone, string> = { mint: "bg-brand", iris: "bg-brand", pos: "bg-pos", amber: "bg-amber", rose: "bg-rose", mute: "bg-dim" };

/** An order status's tone. A finished trade is a gain for the person paid, so "released" reads green. */
export function statusTone(status: string, fallback: Tone): Tone {
  return status === "released" ? "pos" : fallback;
}

/* ----------------------------------------------------------------- Pill */
export function Pill({
  tone = "mute",
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const t = TONE_PILL[tone];
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
    seller: { label: "Spender", cls: "text-brand-ink bg-brand-soft ring-brand/40" },
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
        <span className="size-1.5 rounded-[2px] bg-brand" />
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
          <span className="size-1.5 rounded-[2px] bg-brand" />
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
      className={cx("inline-block bg-brand px-[0.3em] pb-[0.04em] font-bold text-white", className)}
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

/* --------------------------------------------------------- in-app page frame */

/**
 * The frame every in-app page (Trade, Market, My cards, Orders, Disputes) uses, so they share one width, one top
 * offset under the nav and one rhythm: 24/32 px from the nav, 20 px between the head and the content.
 */
export const APP_WIDTH = "max-w-[1320px] 2xl:max-w-[1480px]";

export function AppPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative pt-5 pb-12 md:pt-7">
      <Aurora className="h-[220px] opacity-25" />
      <div className={cx("relative mx-auto w-full px-4 md:px-8", APP_WIDTH, className)}>{children}</div>
    </div>
  );
}

/** One compact page head: title (and an optional line under it) on the left, controls on the right. */
export function AppHead({ title, sub, right, children }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] md:text-[28px]">{title}</h1>
          {children}
        </div>
        {sub && <div className="mt-1 max-w-[72ch] text-[13.5px] leading-relaxed text-mute">{sub}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/* =================================================================== in-app primitives
 * Everything below is shared by the trade flow, the dashboards and every overlay, so they look and move as one app.
 * Type: page title 24/28, card title 17, body 13.5–14, meta 12, mono labels 10.5 uppercase.
 * Radii: pills for buttons and badges, 16 px cards, 12 px wells and inputs, 24 px dialogs.
 * Motion: EASE, 150–250 ms, opacity and a few pixels of travel; nothing blocks input; reduced motion turns it off.
 */

export const EASE = [0.16, 1, 0.3, 1] as const;
export const DUR = { fast: 0.15, base: 0.2, slow: 0.25 } as const;
/** Enter: fade up 6 px. Used for page sections, list items and swapped card content. */
export const enter = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: DUR.base, ease: EASE } } as const;

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx("size-3.5 animate-spin", className)} aria-hidden />;
}

/** A card. `pad` false when the content brings its own padding (tables, lists). */
export function Panel({ className, children, pad = true, as: As = "div", ...rest }: ComponentProps<"div"> & { pad?: boolean; as?: "div" | "section" | "aside" }) {
  return (
    <As className={cx("panel", pad && "p-4 sm:p-5", className)} {...rest}>
      {children}
    </As>
  );
}

/** The head row of a card: a title (or mono label) on the left, a small control on the right. */
export function PanelHead({ title, label, right, sub, className }: { title?: ReactNode; label?: ReactNode; right?: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        {title ? <h2 className="min-w-0 text-[17px] font-semibold tracking-[-0.02em]">{title}</h2> : <div className="label min-w-0">{label}</div>}
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
      {sub && <p className="mt-1 text-[13px] leading-relaxed text-mute">{sub}</p>}
    </div>
  );
}

/** A grey placeholder in the shape of content that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/** A notice inside a card or form. One look for every tone. */
export function Callout({ tone = "mute", icon, children, className, role }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; role?: string }) {
  const t = {
    mint: "bg-brand-soft text-brand-ink",
    iris: "bg-brand-soft text-brand-ink",
    pos: "bg-pos/10 text-pos-ink",
    amber: "bg-amber/12 text-amber-ink",
    rose: "bg-rose/8 text-rose-ink",
    mute: "bg-sunken text-mute",
  }[tone];
  return (
    <div role={role} className={cx("flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed", t, className)}>
      {icon && <span className="mt-[3px] flex shrink-0 [&>svg]:size-3.5">{icon}</span>}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

/** Nothing to show (yet): a title, one line and an optional action. Same size on every page. */
export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("panel flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon && <span className="mb-3 grid size-10 place-items-center rounded-full bg-sunken text-mute [&>svg]:size-[18px]">{icon}</span>}
      <div className="text-[15px] font-medium">{title}</div>
      {body && <div className="mt-1 max-w-md text-[13px] leading-relaxed text-mute">{body}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A pill-shaped segmented control (tabs that switch a view or a mode). */
export function Segmented<T extends string>({ value, options, onChange, label, id, size = "sm", className }: { value: T; options: readonly { value: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void; label: string; id: string; size?: "sm" | "md"; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-full bg-sunken p-1", className)} role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx("relative flex flex-1 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200", size === "sm" ? "h-8 px-3.5 text-[12.5px]" : "h-9 px-4 text-[13px]", on ? "text-fg" : "text-mute hover:text-fg")}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_2px_rgba(12,13,15,0.08),0_0_0_1px_rgba(12,13,15,0.06)]" transition={{ duration: DUR.slow, ease: EASE }} />}
            <span className="relative flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Animates its own height when what is inside changes, so a card grows or shrinks instead of jumping. */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div className={cx("overflow-hidden", className)} initial={false} animate={{ height: h }} transition={{ duration: DUR.slow, ease: EASE }}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

/** Content that is replaced as a whole (a new step, a new state): the old fades out, the new fades up. */
export function Swap({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={k} className={className} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: DUR.base, ease: EASE }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------- Stepper */

export type StepState = "done" | "now" | "todo";

/** Progress through a multi-step action (approve → deposit → publish, seal → mark → send). */
export function Stepper({ steps, className, compact }: { steps: { key: string; label: ReactNode; state: StepState }[]; className?: string; compact?: boolean }) {
  return (
    <ol className={cx(compact ? "space-y-1.5" : "space-y-2", className)}>
      {steps.map((s, i) => (
        <li key={s.key} className={cx("flex items-center gap-3 rounded-xl transition-colors duration-200", compact ? "" : "px-3 py-2.5", !compact && (s.state === "now" ? "bg-brand-soft" : "bg-sunken"))} aria-current={s.state === "now" ? "step" : undefined}>
          <span className={cx("relative grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium tabular transition-colors duration-200", s.state === "done" ? "bg-brand text-white" : s.state === "now" ? "bg-surface text-brand-ink ring-1 ring-brand/40" : "bg-surface text-dim ring-1 ring-line-2")}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={s.state} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: DUR.fast, ease: EASE }} className="grid place-items-center">
                {s.state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : s.state === "now" ? <LoaderCircle className="size-3.5 animate-spin" /> : i + 1}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className={cx("min-w-0 text-[13px] leading-snug", s.state === "todo" ? "text-mute" : "text-fg", s.state === "now" && "font-medium")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------------- Copy */

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cx("grid size-7 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-sunken hover:text-fg", className)}
    >
      {ok ? <Check className="size-3.5 text-brand-ink" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/* ----------------------------------------------------------------- Dialog */

/** Open dialogs, newest last. Only the top one answers Escape and Tab; the page stays locked while any is open. */
const dialogStack: string[] = [];
let savedOverflow = "";

/**
 * Every overlay in the app: centred card on wider screens, a sheet from the bottom on phones. Backdrop, radius, header
 * and close button, focus trap, Escape, scroll lock and enter/exit motion are the same everywhere. The body scrolls
 * inside the dialog, so nothing is cut off at phone height.
 * `dismissible` false while a step runs: then neither Escape, the backdrop nor the close button closes it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "sm",
  dismissible = true,
  bodyClassName,
  label,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md";
  dismissible?: boolean;
  bodyClassName?: string;
  /** Accessible name when the title is not plain text. */
  label?: string;
  testId?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const canClose = useRef(dismissible);
  canClose.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    dialogStack.push(id);
    if (dialogStack.length === 1) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    // Focus the first field, else the first button that isn't the close button, once the dialog is in the page.
    const t = requestAnimationFrame(() => {
      const el = box.current;
      if (!el || el.contains(document.activeElement)) return;
      const first = el.querySelector<HTMLElement>("[data-autofocus],input:not([disabled]),textarea:not([disabled]),select:not([disabled])") ?? el.querySelector<HTMLElement>("button:not([disabled]):not([data-close]),a[href]") ?? el;
      first.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return;
      const el = box.current;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (canClose.current) close.current();
      }
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener("keydown", onKey);
      const i = dialogStack.lastIndexOf(id);
      if (i >= 0) dialogStack.splice(i, 1);
      if (dialogStack.length === 0) document.body.style.overflow = savedOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, id]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-fg/30 backdrop-blur-[3px] sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.base, ease: EASE }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && canClose.current) close.current();
          }}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby={label ? undefined : `${id}-t`}
            aria-label={label}
            aria-describedby={description ? `${id}-d` : undefined}
            tabIndex={-1}
            data-testid={testId}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: DUR.slow, ease: EASE }}
            className={cx(
              "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface shadow-[0_40px_120px_-30px_rgba(12,13,15,0.45)] ring-1 ring-line outline-none sm:max-h-[min(88dvh,820px)] sm:rounded-3xl",
              size === "sm" ? "sm:max-w-[440px]" : "sm:max-w-[520px]",
            )}
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-1 sm:px-6 sm:pt-6">
              {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sunken text-fg [&>svg]:size-[18px]">{icon}</span>}
              <div className={cx("min-w-0 flex-1", icon && "pt-1")}>
                <h2 id={`${id}-t`} className="text-[18px] leading-snug font-semibold tracking-[-0.02em]">
                  {title}
                </h2>
                {description && (
                  <div id={`${id}-d`} className="mt-1 text-[13.5px] leading-relaxed text-mute">
                    {description}
                  </div>
                )}
              </div>
              <button type="button" data-close onClick={() => canClose.current && close.current()} disabled={!dismissible} className="-mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-full text-mute transition-colors hover:bg-sunken hover:text-fg disabled:opacity-30" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-5 sm:px-6 sm:pb-6", !footer && "pb-[max(20px,env(safe-area-inset-bottom))]", bodyClassName)}>{children}</div>
            {footer && <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-6">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
