import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandMark, Callout, Pill, SectionHead, Segmented, cx } from "./ui";
import { LAUNCH_TERMS } from "../lib/displayTerms";
import { useTerms } from "../lib/useTerms";
import {
  HEADLINE_ORDER_INR,
  ORDER_BOOK_STORES,
  SAMPLE_ORDERS_INR,
  bestByStore,
  effectiveCost,
  fmtInr,
  fmtPct,
  fmtPts,
  fmtUsdc,
  headlineReward,
  pctDigits,
  type Reference,
  type RewardValue,
} from "../lib/rewards";

/** Ease-out used for every number and bar here. */
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * A number that counts to its value: from 0 the first time `start` is true, then from the last value on every change.
 * The final value is always in the DOM for screen readers (sr-only) and reserves the width, so nothing shifts while it runs.
 * With reduced motion it shows the final value at once.
 */
function Num({ value, format, start, duration = 0.5, className }: { value: number; format: (n: number) => string; start: boolean; duration?: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const fmt = useRef(format);
  fmt.current = format;

  useLayoutEffect(() => {
    if (ref.current && shown.current === null) ref.current.textContent = reduce ? fmt.current(value) : fmt.current(0);
    // Only the first paint: later updates are the effect's job.
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || !start) {
      if (reduce) {
        el.textContent = fmt.current(value);
        shown.current = value;
      }
      return;
    }
    const from = shown.current ?? 0;
    if (from === value) {
      el.textContent = fmt.current(value);
      return;
    }
    const ctrl = animate(from, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => {
        el.textContent = fmt.current(v);
        shown.current = v;
      },
      onComplete: () => {
        el.textContent = fmt.current(value);
        shown.current = value;
      },
    });
    return () => ctrl.stop();
  }, [value, start, reduce, duration]);

  const final = format(value);
  return (
    <span className={cx("tabular inline-grid", className)}>
      <span className="sr-only">{final}</span>
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
        {final}
      </span>
      <span aria-hidden ref={ref} className="col-start-1 row-start-1 justify-self-end whitespace-nowrap" />
    </span>
  );
}

type Props = {
  /** The ₹/USDC reference (live, or a labelled snapshot). Null: rupee-per-USDC figures are hidden. */
  reference: Reference | null;
  loading: boolean;
};

export function RewardsSection({ reference, loading }: Props) {
  const [value, setValue] = useState<RewardValue>("travel");
  const [store, setStore] = useState(ORDER_BOOK_STORES[0].id);
  const [amount, setAmount] = useState<number>(10_000);
  const sectionRef = useRef<HTMLElement>(null);
  const seen = useInView(sectionRef, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const { terms } = useTerms();
  const maxUsdc = Number((terms ?? LAUNCH_TERMS).max) / 1_000_000;

  const head = useMemo(() => headlineReward(value), [value]);
  const travelHead = useMemo(() => headlineReward("travel"), []);
  const cashHead = useMemo(() => headlineReward("cash"), []);
  const perStore = useMemo(() => bestByStore(HEADLINE_ORDER_INR, value), [value]);
  const atAmount = useMemo(() => bestByStore(amount, value).find((s) => s.id === store) ?? null, [amount, value, store]);
  const pick = atAmount?.best ?? null;
  const storeName = ORDER_BOOK_STORES.find((s) => s.id === store)?.name ?? "";
  const eff = useMemo(() => (pick && reference ? effectiveCost(amount, reference.rate, pick.rewardInr) : null), [pick, reference, amount]);
  const ratio = eff ? eff.effectivePerUsdc / eff.orderPerUsdc : 1;
  const headDigits = head ? pctDigits(head.ratePct) : 1;

  if (!head) return null; // nothing sourced in the data: say nothing rather than a 0%

  const valueOptions = [
    { value: "travel" as const, label: `Travel · ${fmtInr(travelHead?.pointValueInr ?? 1, (travelHead?.pointValueInr ?? 1) % 1 ? 2 : 0)}/pt` },
    { value: "cash" as const, label: `Statement credit · ${fmtInr(cashHead?.pointValueInr ?? 0.3, 2)}/pt` },
  ];

  return (
    <section ref={sectionRef} id="rewards" aria-labelledby="rewards-title" className="scroll-mt-24 border-t border-line py-20 md:py-28">
      <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8">
        <SectionHead
          eyebrow="Rewards"
          title={<span id="rewards-title">Your card pays you back. Your USDC costs less.</span>}
          sub="You buy the voucher on your own card, so the card's rewards stay with you. This is the most our card engine finds for the stores in the order book today, and what it does to your price per USDC."
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
          {/* -------------------------------------------------- headline + stores */}
          <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 sm:p-7 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="eyebrow !text-[13px]">Best reward in our engine</span>
              <Segmented id="reward-value" label="Value points as" value={value} options={valueOptions} onChange={setValue} className="w-full sm:w-auto" />
            </div>

            <p className="mt-8 font-mono text-[12px] font-medium tracking-[0.14em] text-mute uppercase">Up to</p>
            <p className="mt-1 leading-none text-brand">
              <Num value={head.ratePct} start={seen} duration={0.6} format={(n) => fmtPct(n, headDigits)} className="font-dot text-[76px] font-black tracking-[0.01em] sm:text-[104px] md:text-[128px]" />
            </p>
            <p className="mt-4 max-w-[460px] text-[15px] leading-relaxed text-mute">
              back on a {fmtInr(HEADLINE_ORDER_INR)} voucher with the best card in our engine for these stores, valued at {fmtInr(head.pointValueInr, head.pointValueInr % 1 ? 2 : 0)} a point
              {value === "travel" ? " on flights and hotels" : " as statement credit"}.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Pill tone={head.basis === "sourced" ? "pos" : "amber"}>{head.basis === "sourced" ? "Source: issuer's own terms" : "Assumed base rate"}</Pill>
              {head.capPts !== null && <Pill tone="mute">Bonus capped at {fmtPts(head.capPts)} pts/month</Pill>}
            </div>

            <div className="mt-8 text-[13px] font-medium text-fg" id="reward-store-label">
              Best rate by store
            </div>
            <div role="radiogroup" aria-labelledby="reward-store-label" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              {perStore.map((s) => {
                const on = s.id === store;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setStore(s.id)}
                    className={cx(
                      "flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left ring-1 transition-colors duration-200",
                      on ? "bg-brand-soft ring-brand/40" : "bg-surface ring-line hover:bg-sunken",
                    )}
                  >
                    <BrandMark id={s.id} size={22} name={s.name} className="!rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{s.name}</span>
                      <span className={cx("tabular block text-[12px]", on ? "text-brand-ink" : "text-mute")}>{s.best ? `up to ${fmtPct(s.best.ratePct)}` : "no sourced rate"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {perStore.some((s) => !s.storeSpecific) && (
              <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
                The same for every store: our card data is per card route, not per store. Check the store's voucher is sold on your card's voucher portal before you buy.
              </p>
            )}
          </div>

          {/* ----------------------------------------------------- effective rate */}
          <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 sm:p-7 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[15px] font-medium">
                <BrandMark id={store} size={22} name={storeName} className="!rounded-md" />
                {storeName} voucher
              </span>
              <Segmented id="reward-amount" label="Order size" value={String(amount)} options={SAMPLE_ORDERS_INR.map((a) => ({ value: String(a), label: fmtInr(a) }))} onChange={(v) => setAmount(Number(v))} className="w-full sm:w-auto" />
            </div>

            <div className="mt-4 flex items-center gap-2 text-[12.5px] text-mute">
              <span className={cx("size-1.5 shrink-0 rounded-full", reference?.kind.startsWith("live") ? "bg-pos" : "bg-dim")} />
              {loading && !reference ? "Connecting to the rates feed…" : reference ? reference.label : "Live rate unavailable, so prices per USDC are hidden."}
            </div>

            {pick && (
              <>
                {/* The drop: order price per USDC → effective cost after rewards */}
                <div className="mt-6 space-y-5">
                  <div>
                    <div className="flex items-baseline justify-between gap-3 text-[13px] text-mute">
                      <span>Order price per USDC</span>
                      {eff ? <Num value={eff.orderPerUsdc} start={seen} format={(n) => fmtInr(n, 2)} className="text-[20px] font-semibold text-fg" /> : <span className="text-fg">—</span>}
                    </div>
                    <div className="mt-2 h-3 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full w-full rounded-full bg-fg/80" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between gap-3 text-[13px] text-mute">
                      <span>Your cost per USDC after rewards</span>
                      {eff ? <Num value={eff.effectivePerUsdc} start={seen} format={(n) => fmtInr(n, 2)} className="text-[20px] font-semibold text-brand" /> : <span className="text-fg">—</span>}
                    </div>
                    <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-pos/20" aria-hidden>
                      <motion.div
                        className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-brand"
                        initial={{ scaleX: 1 }}
                        animate={{ scaleX: seen ? ratio : 1 }}
                        transition={{ duration: reduce ? 0 : 0.6, ease: EASE_OUT }}
                      />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-pos-ink">
                        You save <Num value={pick.ratePct} start={seen} format={(n) => fmtPct(n, pctDigits(pick.ratePct))} className="font-semibold" />
                      </span>
                      {eff && (
                        <span className="text-pos-ink">
                          <Num value={eff.savingPerUsdc} start={seen} format={(n) => fmtInr(n, 2)} className="font-semibold" /> per USDC
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* How it adds up */}
                <div className="mt-6 rounded-xl bg-sunken p-4">
                  <div className="text-[12px] font-medium tracking-[0.08em] text-dim uppercase">How it adds up</div>
                  <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[14px] leading-snug">
                    <Step k="You pay" v={<Num value={amount} start={seen} format={(n) => fmtInr(Math.round(n))} className="font-semibold" />} sub="with your card" />
                    <Arrow />
                    <Step k="You earn" v={<Num value={pick.rewardInr} start={seen} format={(n) => fmtInr(n, pick.rewardInr % 1 ? 2 : 0)} className="font-semibold text-pos-ink" />} sub="in rewards" />
                    {eff && (
                      <>
                        <Arrow />
                        <Step k="You receive" v={<Num value={eff.usdc} start={seen} format={fmtUsdc} className="font-semibold" />} sub="USDC" />
                        <Arrow />
                        <Step k="Effective" v={<Num value={eff.effectivePerUsdc} start={seen} format={(n) => fmtInr(n, 2)} className="font-semibold text-brand" />} sub={`per USDC vs ${fmtInr(reference!.rate, 2)} reference`} />
                      </>
                    )}
                  </ol>
                </div>

                <div className="mt-3 space-y-2">
                  {pick.capped && (
                    <Callout tone="amber">
                      The monthly bonus cap limits this order: {fmtInr(pick.rewardInr, pick.rewardInr % 1 ? 2 : 0)} ({fmtPct(pick.ratePct)}) instead of {fmtInr(pick.uncappedRewardInr, pick.uncappedRewardInr % 1 ? 2 : 0)}, assuming none of this month's bonus is used yet.
                    </Callout>
                  )}
                  {eff && eff.usdc > maxUsdc && (
                    <Callout tone="mute">
                      {fmtUsdc(eff.usdc)} USDC is above the current limit of {fmtUsdc(maxUsdc)} USDC per order, so this would be filled as more than one order.
                    </Callout>
                  )}
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
                  Assumes the order is priced at the reference rate; voucher buyers set their own. The fee is paid by the voucher buyer on top, so you receive the full USDC amount.
                  {pick.note ? ` ${pick.note}` : ""}
                </p>
              </>
            )}
          </div>
        </div>

        {/* The qualifier */}
        <div className="mt-4 flex flex-col gap-4 rounded-2xl bg-sunken p-5 md:flex-row md:items-center md:justify-between md:p-6">
          <p className="max-w-[760px] text-[13.5px] leading-relaxed text-mute">
            <span className="font-medium text-fg">"Up to" means the best case.</span> Rewards are paid by the card issuer as points or cashback, valued here at the issuer's published redemption rate. Monthly caps and exclusions apply, rates change, and your own card may earn less or nothing on gift vouchers. NetPositive does not pay or guarantee any reward. Rates come from our card research of November 2026.
          </p>
          <div className="flex shrink-0 flex-col gap-2 text-[14px] font-medium sm:flex-row sm:gap-5 md:flex-col md:gap-2">
            <Link to="/cards" className="group inline-flex items-center gap-1.5 text-brand-ink">
              See what your own cards earn <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link to="/docs" className="group inline-flex items-center gap-1 text-fg">
              How it works in the docs <ChevronRight className="size-4 text-dim transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ k, v, sub }: { k: string; v: ReactNode; sub: string }) {
  return (
    <li className="flex flex-col">
      <span className="text-[11.5px] text-mute">{k}</span>
      <span>
        {v} <span className="text-[12.5px] text-mute">{sub}</span>
      </span>
    </li>
  );
}

const Arrow = () => (
  <li aria-hidden className="px-0.5 text-dim">
    →
  </li>
);
