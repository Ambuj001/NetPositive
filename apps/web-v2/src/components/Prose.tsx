import { ArrowUpRight, Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./ui";

/**
 * Building blocks for long-form pages (docs, terms, privacy). Same type scale and colour tokens as the rest of the
 * site; nothing here is a new visual language.
 */

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[15.5px] leading-[1.7] text-fg/80", className)}>{children}</p>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="pt-3 text-[18px] font-semibold tracking-[-0.02em]">{children}</h3>;
}

export function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15.5px] leading-[1.65] text-fg/80">
          <span className="mt-[10px] size-1.5 shrink-0 rounded-[2px] bg-brand" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** A link inside prose: router link for in-app paths, new tab for everything else. */
export function A({ to, children }: { to: string; children: ReactNode }) {
  if (to.startsWith("/"))
    return (
      <Link to={to} className="link font-medium text-fg">
        {children}
      </Link>
    );
  return (
    <a href={to} target="_blank" rel="noopener noreferrer" className="link inline-flex items-baseline gap-0.5 font-medium text-fg">
      {children}
      <ArrowUpRight className="size-3 translate-y-[1px] opacity-60" />
    </a>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger"; title?: ReactNode; children: ReactNode }) {
  const t = {
    info: "bg-sunken ring-line",
    warn: "bg-amber/10 ring-amber/35",
    danger: "bg-rose/[0.06] ring-rose/30",
  }[tone];
  const head = { info: "text-fg", warn: "text-amber-ink", danger: "text-rose-ink" }[tone];
  return (
    <div role="note" className={cx("rounded-2xl p-4 ring-1 md:p-5", t)}>
      {title && <div className={cx("mb-1 text-[15px] font-semibold", head)}>{title}</div>}
      <div className="text-[15px] leading-[1.65] text-fg/80">{children}</div>
    </div>
  );
}

/**
 * A table from tablet width up. On a phone each row becomes a small card with the column names as labels, so
 * nothing has to be scrolled sideways. `minWidth` only matters between those two (a narrow tablet column).
 */
export function Table({ head, rows, minWidth = 520 }: { head: ReactNode[]; rows: ReactNode[][]; minWidth?: number }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface sm:block">
        <table className="w-full border-collapse text-left text-[14.5px]" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-line text-[11.5px] font-medium tracking-[0.08em] text-dim uppercase">
              {head.map((h, i) => (
                <th key={i} scope="col" className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line align-top last:border-0">
                {r.map((c, j) => (
                  <td key={j} className={cx("px-4 py-3.5 leading-[1.55]", j === 0 ? "font-medium text-fg" : "text-fg/80")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface sm:hidden">
        {rows.map((r, i) => (
          <li key={i} className="px-4 py-3.5">
            <div className="text-[15px] font-medium leading-[1.5] text-fg">
              <span className="sr-only">{head[0]}: </span>
              {r[0]}
            </div>
            <dl className="mt-2 space-y-1.5">
              {r.slice(1).map((c, j) => (
                <div key={j} className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 text-[14px] leading-[1.5]">
                  <dt className="text-mute">{head[j + 1]}</dt>
                  <dd className="text-fg/85">{c}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export type StepKind = "tx" | "sign" | "click" | "outside" | "wait";
const KIND: Record<StepKind, { label: string; cls: string }> = {
  tx: { label: "Wallet transaction · costs gas", cls: "text-brand-ink bg-brand-soft ring-brand/30" },
  sign: { label: "Free signature · no gas", cls: "text-pos-ink bg-pos/10 ring-pos/30" },
  click: { label: "Just a click", cls: "text-mute bg-sunken ring-line" },
  outside: { label: "Outside the app", cls: "text-amber-ink bg-amber/12 ring-amber/35" },
  wait: { label: "Nothing to do", cls: "text-mute bg-sunken ring-line" },
};

export function Kind({ kind }: { kind: StepKind }) {
  const k = KIND[kind];
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1", k.cls)}>{k.label}</span>;
}

export type Step = { title: string; kind: StepKind; body: ReactNode };

export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-4 rounded-2xl border border-line bg-surface p-4 md:p-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken font-mono text-[13px] text-mute">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[16px] font-medium tracking-[-0.015em]">{s.title}</span>
              <Kind kind={s.kind} />
            </div>
            <div className="mt-1.5 text-[15px] leading-[1.65] text-fg/80">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A long value (address, hash) that wraps instead of overflowing, with a copy button. */
export function CopyValue({ value, href }: { value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-start gap-2">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="link min-w-0 font-mono text-[13px] break-all text-fg">
          {value}
        </a>
      ) : (
        <span className="min-w-0 font-mono text-[13px] break-all text-fg">{value}</span>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard blocked */
          }
        }}
        className="grid size-6 shrink-0 place-items-center rounded-full text-mute ring-1 ring-line transition hover:text-fg"
        aria-label={`Copy ${value}`}
      >
        {copied ? <Check className="size-3 text-brand-ink" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
}

/** Label/value rows that stack on a phone. */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {rows.map(([k, v], i) => (
        <div key={i} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[200px_1fr] sm:gap-4">
          <dt className="text-[13.5px] text-mute">{k}</dt>
          <dd className="min-w-0 text-[14.5px] text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
