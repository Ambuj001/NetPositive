import {Dialog as ProtectionDialog} from '../components/disputes/DisputeDialog';
import {DisputePreview} from '../components/disputes/DisputePreview';
import '../components/disputes/disputes.css';
import '../components/disputes/surface.css';
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  CircleHelp,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  FingerprintPattern,
  KeyRound,
  LoaderCircle,
  Lock,
  Pause,
  Play,
  Radar,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Aurora, BrandMark, Button, Card, Pill, Row, cx } from "../components/ui";
import { brand } from "../lib/data";
import { effectivePrice, inr, quote, routesFor, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

type Role = "seller" | "buyer";

const STAGES = [
  { k: "Locked in escrow", who: "Seller", icon: Lock },
  { k: "Accepted by a verified human", who: "Buyer", icon: FingerprintPattern },
  { k: "Vouchers bought on best route", who: "Buyer", icon: CreditCard },
  { k: "Codes verified live", who: "Verifier", icon: ScanLine },
  { k: "Delivered to seller", who: "Seller", icon: KeyRound },
  { k: "USDC released", who: "Contract", icon: Unlock },
];

const ACTOR: Record<number, Role | "verifier" | null> = { 0: "buyer", 1: "buyer", 2: "buyer", 3: "verifier", 4: "seller", 5: null };

const DEMO_CODES = ["LFS-7Q2K-91XA-3M8D", "LFS-4HWE-22PL-0Z6R", "LFS-9TBC-55MN-1K3Q", "LFS-2RJD-08VX-6P4S", "LFS-6YGF-73QW-8L2T"];
const DEMO_PINS = ["482913", "907126", "315840", "628457", "174093"];

/** One gift voucher as the buyer types it in: redeem code, PIN and expiry (MM/YY). */
type Voucher = { code: string; pin: string; expiry: string };
const blankVouchers = (n: number): Voucher[] => Array.from({ length: n }, () => ({ code: "", pin: "", expiry: "" }));
/** Demo expiry: 12 months from today, as MM/YY. */
const demoExpiry = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
};
const demoVouchers = (n: number): Voucher[] => DEMO_CODES.slice(0, n).map((code, i) => ({ code, pin: DEMO_PINS[i], expiry: demoExpiry() }));
/** Formats typed digits as MM/YY. */
const formatExpiry = (raw: string) => {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
/** True when MM/YY is a real month that hasn't passed yet. */
const expiryOk = (e: string) => {
  const m = /^(\d{2})\/(\d{2})$/.exec(e);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
};
const voucherOk = (v: Voucher) => v.code.trim().length >= 6 && /^\d{4,8}$/.test(v.pin) && expiryOk(v.expiry);

/** Index used for the buyer's own "Custom" route in step 1. */
const CUSTOM = -1;

export default function Trade() {
  const { id = "VR-24817" } = useParams();
  const { orders, humanVerified, verifyHuman, toast } = useApp();
  const order = orders.find((o) => o.id === id) ?? orders[0];
  const b = brand(order.brandId);
  const q = quote(order.amount, order.rate);
  const routes = useMemo(() => routesFor(order.amount), [order.amount]);
  const nCodes = Math.max(1, Math.ceil(order.amount / 5000));
  const denom = Math.round(order.amount / nCodes);

  const [stage, setStage] = useState(0);
  const [role, setRole] = useState<Role>("buyer");
  const [auto, setAuto] = useState(false);
  const [route, setRoute] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [vouchers, setVouchers] = useState<Voucher[]>(() => blankVouchers(nCodes));
  const setVoucher = (i: number, patch: Partial<Voucher>) => setVouchers((all) => all.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const [custom, setCustom] = useState({ card: "", portal: "", rewardPct: "" });
  const customPct = Math.min(Math.max(Number(custom.rewardPct) || 0, 0), 50);
  const customOk = custom.card.trim().length >= 2 && custom.portal.trim().length >= 2;
  /** The route the buyer picked, ranked or custom, in one shape for steps 1 and 2. */
  const sel =
    route === CUSTOM
      ? { cardLabel: custom.card.trim() || "Your card", channelName: custom.portal.trim() || "Your store", channelId: "custom", note: "" }
      : { cardLabel: routes[route].cardLabel, channelName: routes[route].channel.name, channelId: routes[route].channel.id, note: routes[route].channel.note };
  const [encrypting, setEncrypting] = useState(false);
  const [vn, setVn] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [recheck, setRecheck] = useState<"idle" | "busy" | "ok">("idle");
  const [dispute, setDispute] = useState(false);
  const [log, setLog] = useState<{ t: string; e: string; tone: string }[]>([
    { t: "14:00:02", e: `OrderLocked(${order.id}, ${usdt(q.sellerLocks)} USDC)`, tone: "mint" },
  ]);
  const [clock, setClock] = useState(30 * 60);

  const push = (e: string, tone = "mint") => {
    const d = new Date();
    setLog((l) => [{ t: d.toTimeString().slice(0, 8), e, tone }, ...l].slice(0, 8));
  };

  // Countdown for auto-release
  useEffect(() => {
    if (stage !== 4) return;
    const t = setInterval(() => setClock((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [stage]);

  /* ---------- actions ---------- */
  const accept = () => {
    const go = () => {
      setStage(1);
      push(`Accepted(${order.id}, buyer, nullifier 0x2d…be)`, "fg");
      toast({ title: "Order accepted", body: `Buy via ${sel.cardLabel} · ${sel.channelName}`, tone: "amber" });
    };
    if (humanVerified) return go();
    setVerifying(true);
    setTimeout(() => {
      verifyHuman();
      setVerifying(false);
      go();
    }, 1400);
  };
  const bought = () => {
    setStage(2);
    push(`VoucherPurchased(${order.id}, ${nCodes} × ${inr(denom)})`, "amber");
  };
  const submitCodes = () => {
    setEncrypting(true);
    setTimeout(() => {
      setEncrypting(false);
      setStage(3);
      push("CodesSubmitted(enc → verifier key)", "iris");
    }, 1500);
  };
  const confirm = () => {
    setStage(5);
    push(`Released(${usdt(q.buyerReceives)} → buyer)`, "mint");
    push(`FeeSplit(reserve ${usdt(q.reserveShare)}, platform ${usdt(q.platformShare)})`, "fg");
    toast({ title: `${usdt(q.buyerReceives)} USDC sent to buyer`, body: "Trade settled on-chain", tone: "mint" });
  };
  const reset = () => {
    setStage(0);
    setRole("buyer");
    setAuto(false);
    setChecks([false, false, false, false]);
    setVouchers(blankVouchers(nCodes));
    setVn(0);
    setRevealed(false);
    setRecheck("idle");
    setClock(30 * 60);
    setLog([{ t: "14:00:02", e: `OrderLocked(${order.id}, ${usdt(q.sellerLocks)} USDC)`, tone: "mint" }]);
  };

  // Verifier runs by itself
  useEffect(() => {
    if (stage !== 3) return;
    setVn(0);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      setVn(n);
      if (n === nCodes + 2) {
        clearInterval(t);
        setTimeout(() => {
          push(`VerifierPass(sig 0x9c1f…a4e2, ${inr(order.amount)})`, "iris");
          setStage(4);
          setRole("seller");
        }, 900);
      }
    }, 700);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Reveal → re-check
  useEffect(() => {
    if (!revealed || recheck !== "idle") return;
    setRecheck("busy");
    const t = setTimeout(() => {
      setRecheck("ok");
      push("Recheck(PASS, live balance)", "iris");
    }, 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  // Autoplay
  useEffect(() => {
    if (!auto) return;
    const T: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, f: () => void) => T.push(setTimeout(f, ms));
    if (stage === 0) {
      setRole("buyer");
      at(1600, accept);
    } else if (stage === 1) {
      [0, 1, 2, 3].forEach((i) => at(600 + i * 550, () => setChecks((c) => c.map((v, j) => (j === i ? true : v)))));
      at(3200, bought);
    } else if (stage === 2) {
      at(700, () => setVouchers(demoVouchers(nCodes)));
      at(1700, submitCodes);
    } else if (stage === 4) {
      at(1200, () => setRevealed(true));
      at(3800, confirm);
    } else if (stage === 5) {
      at(400, () => setAuto(false));
    }
    return () => T.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, stage]);

  const actor = ACTOR[stage];
  const mine = actor === role || actor === "verifier" || actor === null;

  return (
    <div className="relative pt-28">
      <Aurora className="h-[55vh] opacity-50" />
      <div className="relative mx-auto max-w-6xl px-6">
        {/* Header */}
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <BrandMark id={order.brandId} size={56} />
            <div>
              <div className="flex items-center gap-2 font-mono text-[11.5px] text-dim">
                <Link to="/market" className="hover:text-fg">
                  Market
                </Link>
                / {order.id}
              </div>
              <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.03em] md:text-4xl">
                {b.name} {inr(order.amount)} <span className="text-mute">→</span> {usdt(q.buyerReceives)} USDC
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RoleSwitch role={role} setRole={setRole} />
            <button
              onClick={() => (stage === 5 ? reset() : setAuto((a) => !a))}
              className={cx(
                "flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-medium ring-1 transition",
                auto ? "bg-mint/10 text-mint ring-mint/40" : "text-fg ring-white/12 hover:bg-white/5",
              )}
            >
              {stage === 5 ? <RotateCcw className="size-3.5" /> : auto ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {stage === 5 ? "Replay" : auto ? "Pause demo" : "Autoplay demo"}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-8 flex gap-1.5">
          {STAGES.map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div
                className={cx("h-full", i === 3 ? "bg-iris" : i === 1 || i === 2 ? "bg-amber" : "bg-mint")}
                initial={false}
                animate={{ width: i < stage || stage === 5 ? "100%" : i === stage ? "45%" : "0%" }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr_300px]">
          {/* Timeline */}
          <Card className="p-5 lg:self-start">
            <div className="label mb-4">Trade timeline</div>
            <ol className="relative space-y-1">
              {STAGES.map((s, i) => {
                const done = i < stage || stage === 5;
                const on = i === stage && stage !== 5;
                const Icon = s.icon;
                return (
                  <li key={s.k} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < STAGES.length - 1 && <span className={cx("absolute top-8 left-[15px] h-[calc(100%-24px)] w-px", done ? "bg-mint/50" : "bg-white/[0.08]")} />}
                    <span
                      className={cx(
                        "relative grid size-8 shrink-0 place-items-center rounded-full ring-1 transition-all duration-500",
                        done ? "bg-mint text-ink ring-mint" : on ? "bg-white/[0.06] text-fg ring-white/30" : "text-dim ring-white/10",
                      )}
                    >
                      {on && <span className="absolute inset-0 animate-pulse-ring rounded-full ring-1 ring-white/40" />}
                      {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                    </span>
                    <div className="pt-1">
                      <div className={cx("text-[13px] leading-snug", done || on ? "text-fg" : "text-dim")}>{s.k}</div>
                      <div className="font-mono text-[10.5px] text-dim">{s.who}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Action panel */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${stage}-${mine ? role : "wait"}`}
                initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                {!mine ? (
                  <Waiting actor={actor as Role} stage={stage} onSwitch={() => setRole(actor as Role)} clock={clock} />
                ) : stage === 0 ? (
                  <Panel tone="amber" title="Pick how to buy it" sub={`Ranked from cards saved on your device for a ${inr(order.amount)} ${b.name} voucher.`}>
                    <div className="space-y-2">
                      {routes.slice(0, 4).map((r, i) => (
                        <button
                          key={r.cardId + r.channel.id}
                          onClick={() => setRoute(i)}
                          className={cx(
                            "flex w-full items-center gap-4 rounded-2xl p-4 text-left ring-1 transition",
                            route === i ? "bg-amber/[0.07] ring-amber/50" : "bg-white/[0.02] ring-white/[0.07] hover:ring-white/15",
                          )}
                        >
                          <span className={cx("grid size-5 place-items-center rounded-full ring-1", route === i ? "bg-amber ring-amber" : "ring-white/20")}>
                            {route === i && <span className="size-2 rounded-full bg-ink" />}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 text-[14px] font-medium">
                              {r.cardLabel} · {r.channel.name}
                              {i === 0 && <Pill tone="amber">best</Pill>}
                            </div>
                            <div className="mt-0.5 text-[12px] text-mute">
                              {r.points.toLocaleString("en-IN")} pts{r.discountInr ? ` + ${inr(r.discountInr)} off` : ""} · {r.txns} × {inr(r.channel.denomination > order.amount ? order.amount : r.channel.denomination)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[16px] font-semibold tabular">{r.pctTravel.toFixed(1)}%</div>
                            <div className="font-mono text-[10.5px] text-dim">₹{effectivePrice(order.amount, r.travelInr, q.buyerReceives).toFixed(2)}/USDC</div>
                          </div>
                        </button>
                      ))}

                      {/* Custom: the buyer's own card and store, for cards not in the ranked list */}
                      <div className={cx("rounded-2xl ring-1 transition", route === CUSTOM ? "bg-amber/[0.07] ring-amber/50" : "bg-white/[0.02] ring-white/[0.07] hover:ring-white/15")}>
                        <button onClick={() => setRoute(CUSTOM)} aria-expanded={route === CUSTOM} className="flex w-full items-center gap-4 p-4 text-left">
                          <span className={cx("grid size-5 place-items-center rounded-full ring-1", route === CUSTOM ? "bg-amber ring-amber" : "ring-white/20")}>
                            {route === CUSTOM && <span className="size-2 rounded-full bg-ink" />}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 text-[14px] font-medium">
                              Custom <Pill tone="mute">your own route</Pill>
                            </div>
                            <div className="mt-0.5 text-[12px] text-mute">Use any card and store you like to buy the voucher and order the USDC.</div>
                          </div>
                          {route === CUSTOM && customPct > 0 && (
                            <div className="text-right">
                              <div className="text-[16px] font-semibold tabular">{customPct.toFixed(1)}%</div>
                              <div className="font-mono text-[10.5px] text-dim">₹{effectivePrice(order.amount, (order.amount * customPct) / 100, q.buyerReceives).toFixed(2)}/USDC</div>
                            </div>
                          )}
                        </button>
                        <AnimatePresence initial={false}>
                          {route === CUSTOM && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className="grid gap-2 px-4 pb-4 sm:grid-cols-[1fr_1fr_120px]">
                                {(
                                  [
                                    ["card", "Card", "e.g. SBI Cashback", "text"],
                                    ["portal", "Where you'll buy", "e.g. amazon.in, Gyftr", "text"],
                                    ["rewardPct", "Reward % (optional)", "e.g. 5", "decimal"],
                                  ] as const
                                ).map(([key, label, ph, mode]) => (
                                  <label key={key} className="block">
                                    <span className="mb-1 block text-[11.5px] text-mute">{label}</span>
                                    <input
                                      value={custom[key]}
                                      onChange={(e) => setCustom((c) => ({ ...c, [key]: key === "rewardPct" ? e.target.value.replace(/[^\d.]/g, "").slice(0, 5) : e.target.value.slice(0, 60) }))}
                                      placeholder={ph}
                                      inputMode={mode}
                                      className="h-10 w-full rounded-xl bg-white/[0.04] px-3 text-[13.5px] ring-1 ring-white/10 outline-none placeholder:text-dim focus:ring-amber/45"
                                      aria-label={label}
                                    />
                                  </label>
                                ))}
                              </div>
                              <p className="px-4 pb-4 text-[11.5px] text-dim">
                                You get the same {usdt(q.buyerReceives)} USDC. Buy {nCodes} × {inr(denom)} {b.name} vouchers; the verifier checks the codes, not the route.
                              </p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className={cx("flex flex-1 items-center gap-2 text-[12.5px]", humanVerified ? "text-mint" : "text-mute")}>
                        {humanVerified ? <BadgeCheck className="size-4" /> : <FingerprintPattern className="size-4 text-iris" />}
                        {humanVerified ? "Verified human via World ID" : "World ID check runs once on accept"}
                      </div>
                      <Button variant="amber" size="lg" onClick={accept} disabled={verifying || (route === CUSTOM && !customOk)}>
                        {verifying ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" /> Verifying in World App…
                          </>
                        ) : (
                          "Accept order"
                        )}
                      </Button>
                    </div>
                  </Panel>
                ) : stage === 1 ? (
                  <Panel
                    tone="amber"
                    title="Buy it this way"
                    sub={`${sel.cardLabel} · ${sel.channelName}. You check out ${sel.channelId === "custom" ? "on that store" : "on the bank portal"} yourself.`}
                    right={<span className="font-mono text-[11px] text-dim">{sel.channelId === "custom" ? sel.channelName : "smartbuy.hdfcbank.com"}</span>}
                  >
                    <ol className="space-y-2">
                      {(sel.channelId === "custom"
                        ? [
                            `Open ${sel.channelName} → Gift Vouchers → ${b.name}`,
                            `Pick a ${b.name} gift voucher (e-voucher with code and PIN)`,
                            `${nCodes} × ${inr(denom)} (largest denomination)`,
                            `Pay with ${sel.cardLabel}`,
                          ]
                        : [
                            `Open SmartBuy → Gift Vouchers → ${b.name}`,
                            sel.channelId === "smartbuy" ? "Choose the accelerated rewards tab, not InstaDeals" : `Choose ${sel.channelName} (${sel.note})`,
                            `${nCodes} × ${inr(denom)} (largest denomination)`,
                            `Pay with ${sel.cardLabel}`,
                          ]
                      ).map((s, i) => (
                        <li key={s}>
                          <button
                            onClick={() => setChecks((c) => c.map((v, j) => (j === i ? !v : v)))}
                            className={cx("flex w-full items-center gap-3 rounded-2xl p-4 text-left text-[14px] ring-1 transition", checks[i] ? "bg-white/[0.02] text-mute ring-white/[0.05]" : "ring-white/[0.08] hover:ring-amber/40")}
                          >
                            <motion.span
                              animate={{ scale: checks[i] ? [1, 1.25, 1] : 1 }}
                              className={cx("grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11px]", checks[i] ? "bg-mint text-ink" : "bg-white/[0.06] text-amber")}
                            >
                              {checks[i] ? <Check className="size-3.5" /> : i + 1}
                            </motion.span>
                            <span className={cx(checks[i] && "line-through decoration-white/20")}>{s}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-[12px] text-dim">{sel.channelId === "custom" ? "Rewards depend on your card and that store's terms." : "Points post within 90 working days, per SmartBuy terms."}</span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          icon={<ArrowUpRight className="size-3.5" />}
                          onClick={() => toast({ title: `Opening ${sel.channelId === "custom" ? sel.channelName : "SmartBuy"}`, body: "Demo: portal link opens in a new tab", tone: "amber" })}
                        >
                          Open {sel.channelId === "custom" ? sel.channelName : "SmartBuy"}
                        </Button>
                        <Button variant="amber" disabled={!checks.every(Boolean)} onClick={bought}>
                          I've bought them
                        </Button>
                      </div>
                    </div>
                  </Panel>
                ) : stage === 2 ? (
                  <Panel tone="amber" title="Paste your voucher codes" sub="Redeem code, PIN and expiry for each voucher. They're encrypted on this device to the verifier's key. The seller only sees them after they pass.">
                    <div className="mb-2 hidden grid-cols-[28px_minmax(0,1fr)_84px_76px] gap-2 px-2 font-mono text-[10px] tracking-[0.12em] text-dim uppercase sm:grid">
                      <span />
                      <span className="pl-3">
                        Redeem code <span className="normal-case tracking-normal">· {inr(denom)} each</span>
                      </span>
                      <span className="pl-3">PIN</span>
                      <span className="pl-3">Expiry</span>
                    </div>
                    <div className="space-y-2.5">
                      {vouchers.map((v, i) => {
                        const expBad = v.expiry.length === 5 && !expiryOk(v.expiry);
                        const field = "h-10 w-full min-w-0 rounded-xl bg-white/[0.04] px-3 font-mono text-[13px] tracking-wide ring-1 outline-none placeholder:text-dim focus:ring-amber/45";
                        return (
                          <div key={i} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-2xl bg-white/[0.02] p-2 ring-1 ring-white/[0.08] sm:grid-cols-[28px_minmax(0,1fr)_84px_76px]">
                            <span className="pl-1 font-mono text-[11px] text-dim">#{i + 1}</span>
                            {encrypting ? (
                              <Scramble className="h-10 sm:col-span-3" />
                            ) : (
                              <>
                                <input
                                  value={v.code}
                                  onChange={(e) => setVoucher(i, { code: e.target.value.toUpperCase().slice(0, 40) })}
                                  placeholder="XXXX-XXXX-XXXX-XXXX"
                                  className={cx(field, "ring-white/10")}
                                  aria-label={`Voucher ${i + 1} redeem code`}
                                />
                                <input
                                  value={v.pin}
                                  onChange={(e) => setVoucher(i, { pin: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                                  placeholder="PIN"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  className={cx(field, "col-start-2 ring-white/10 sm:col-start-auto")}
                                  aria-label={`Voucher ${i + 1} PIN`}
                                />
                                <input
                                  value={v.expiry}
                                  onChange={(e) => setVoucher(i, { expiry: formatExpiry(e.target.value) })}
                                  placeholder="MM/YY"
                                  inputMode="numeric"
                                  className={cx(field, "col-start-2 sm:col-start-auto", expBad ? "ring-rose/60" : "ring-white/10")}
                                  aria-label={`Voucher ${i + 1} expiry`}
                                  aria-invalid={expBad}
                                  title={expBad ? "Expiry must be a future month (MM/YY)" : undefined}
                                />
                              </>
                            )}
                            <span className="col-start-2 w-fit rounded-lg bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] text-mute sm:hidden">{inr(denom)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <button onClick={() => setVouchers(demoVouchers(nCodes))} className="text-left text-[12.5px] text-mute underline decoration-white/20 underline-offset-4 hover:text-fg">
                        Fill demo codes
                      </button>
                      <Button variant="amber" disabled={!vouchers.every(voucherOk) || encrypting} onClick={submitCodes} icon={encrypting ? <LoaderCircle className="size-4 animate-spin" /> : <Lock className="size-4" />}>
                        {encrypting ? "Encrypting…" : "Encrypt & send to verifier"}
                      </Button>
                    </div>
                  </Panel>
                ) : stage === 3 ? (
                  <VerifierPanel n={vn} nCodes={nCodes} denom={denom} brandName={b.name} merchantPortal={!!b.merchantPortal} orderId={order.id} amount={order.amount} expiry={[...new Set(vouchers.map((v) => v.expiry))].join(", ")} />
                ) : stage === 4 ? (
                  <Panel tone="mint" title={`${nCodes} × ${b.name} ${inr(denom)}`} sub="Codes visible to you only. Re-checked against the issuer the moment you open them.">
                    <div className="space-y-2">
                      {(vouchers.every(voucherOk) ? vouchers : demoVouchers(nCodes)).map((v, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3.5 ring-1 ring-white/[0.08]">
                          <div className={cx("min-w-0 transition-all duration-700", revealed ? "blur-0" : "select-none blur-[6px]")}>
                            <div className="truncate font-mono text-[15px] tracking-[0.12em]">{v.code}</div>
                            <div className="mt-1 font-mono text-[11.5px] text-mute">
                              PIN <span className="text-fg/85">{v.pin}</span> · Exp <span className="text-fg/85">{v.expiry}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              if (revealed) {
                                navigator.clipboard?.writeText(`${v.code} PIN ${v.pin} EXP ${v.expiry}`);
                                toast({ title: "Code copied", tone: "mint" });
                              } else setRevealed(true);
                            }}
                            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-mute ring-1 ring-white/10 hover:text-fg"
                          >
                            {revealed ? "Copy" : (
                              <>
                                <Eye className="size-3.5" /> Reveal
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div
                      className={cx(
                        "mt-3 flex items-center justify-between rounded-2xl px-4 py-3 text-[13px] ring-1 transition",
                        recheck === "ok" ? "bg-mint/[0.07] ring-mint/40" : "bg-white/[0.02] ring-white/[0.08]",
                      )}
                    >
                      <span className="flex items-center gap-2 text-mute">
                        {recheck === "busy" ? <LoaderCircle className="size-4 animate-spin text-iris" /> : recheck === "ok" ? <ShieldCheck className="size-4 text-mint" /> : <EyeOff className="size-4" />}
                        {recheck === "busy" ? "Re-checking balance…" : recheck === "ok" ? "Re-checked just now" : "Reveal to run the second check"}
                      </span>
                      {recheck === "ok" && <span className="font-semibold text-mint">{inr(order.amount)} live</span>}
                    </div>
                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-dim">
                        <Clock className="size-3.5" /> auto-release in {fmt(clock)}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setDispute(true)}>
                          Problem?
                        </Button>
                        <Button disabled={recheck !== "ok"} onClick={confirm}>
                          I've received them
                        </Button>
                      </div>
                    </div>
                  </Panel>
                ) : (
                  <Settled q={q} role={role} onDispute={() => setDispute(true)} onReplay={reset} brandName={b.name} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Escrow ledger */}
          <div className="space-y-4 lg:self-start">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="label">Escrow</span>
                <Pill tone={stage === 5 ? "mute" : "mint"} dot={stage !== 5}>
                  {stage === 5 ? "settled" : stage >= 3 ? "verifying" : "locked"}
                </Pill>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <motion.span key={stage === 5 ? "z" : "l"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-display text-3xl font-semibold tracking-tight tabular">
                  {stage === 5 ? "0.00" : usdt(q.sellerLocks)}
                </motion.span>
                <span className="text-[13px] text-mute">USDC held</span>
              </div>
              <div className="mt-3 divide-y divide-white/[0.06]">
                <Row k="Buyer gets" v={usdt(q.buyerReceives)} />
                <Row k="Dispute reserve" v={usdt(q.reserveShare)} />
                <Row k="Platform" v={usdt(q.platformShare)} />
                <Row k="Rate" v={`₹${order.rate}`} />
              </div>
              <div className="mt-3 truncate font-mono text-[10.5px] text-dim">contract 0xE5c7…41aB · Base Sepolia</div>
            </Card>
            <Card className="p-5">
              <div className="label mb-3">Contract events</div>
              <ul className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {log.map((l) => (
                    <motion.li key={l.t + l.e} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5">
                      <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", { mint: "bg-mint", amber: "bg-amber", iris: "bg-iris", fg: "bg-fg" }[l.tone])} />
                      <div className="min-w-0">
                        <div className="break-words font-mono text-[11px] leading-snug text-fg/85">{l.e}</div>
                        <div className="font-mono text-[10px] text-dim">{l.t}</div>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Card>
          </div>
        </div>
      </div>
      <DisputeModal open={dispute} onClose={() => setDispute(false)} q={q} brandName={b.name} />
    </div>
  );
}

/* ----------------------------------------------------------- pieces */
function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function RoleSwitch({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  return (
    <div className="flex rounded-full bg-white/[0.03] p-1 ring-1 ring-white/[0.08]">
      {(["seller", "buyer"] as Role[]).map((r) => (
        <button key={r} onClick={() => setRole(r)} className={cx("relative h-8 rounded-full px-4 text-[12.5px] font-medium transition", role === r ? "text-ink" : "text-mute hover:text-fg")}>
          {role === r && <motion.span layoutId="role" className={cx("absolute inset-0 rounded-full", r === "seller" ? "bg-mint" : "bg-amber")} transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
          <span className="relative">View as {r === "seller" ? "Seller" : "Buyer"}</span>
        </button>
      ))}
    </div>
  );
}

function Panel({ title, sub, children, tone, right }: { title: string; sub?: string; children: ReactNode; tone: "mint" | "amber" | "iris"; right?: ReactNode }) {
  const g = { mint: "rgba(61,220,151,0.10)", amber: "rgba(245,181,68,0.10)", iris: "rgba(139,123,255,0.12)" }[tone];
  return (
    <Card glow={g} className="p-6 md:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
          {sub && <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="mt-6">{children}</div>
    </Card>
  );
}

function Waiting({ actor, stage, onSwitch, clock }: { actor: Role; stage: number; onSwitch: () => void; clock: number }) {
  const msg: Record<number, [string, string]> = {
    0: ["Waiting for a buyer", "Your USDC is locked in escrow and visible to verified buyers. If nobody fills it in 30 minutes, it comes back to you automatically."],
    1: ["The buyer is buying your vouchers", "They're checking out on SmartBuy with their own card. Your USDC stays locked the whole time."],
    2: ["The buyer is submitting codes", "Codes go encrypted to the verifier first. You'll see them only after they pass."],
    4: ["The seller is checking the codes", `USDC is released when they confirm, or automatically in ${fmt(clock)}.`],
  };
  const [t, s] = msg[stage] ?? ["Waiting", ""];
  const tone = actor === "buyer" ? "amber" : "mint";
  return (
    <Card className="p-8 text-center md:p-12">
      <div className="relative mx-auto grid size-28 place-items-center">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx("absolute inset-0 animate-pulse-ring rounded-full ring-1", tone === "amber" ? "ring-amber/50" : "ring-mint/50")} style={{ animationDelay: `${i * 0.8}s` }} />
        ))}
        <span className={cx("grid size-14 place-items-center rounded-full", tone === "amber" ? "bg-amber/15 text-amber" : "bg-mint/15 text-mint")}>
          {stage === 0 ? <Radar className="size-6" /> : <ShoppingBag className="size-6" />}
        </span>
      </div>
      <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">{t}</h2>
      <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-mute">{s}</p>
      <button onClick={onSwitch} className="mt-6 text-[13px] text-mute underline decoration-white/20 underline-offset-4 hover:text-fg">
        Switch to {actor === "buyer" ? "buyer" : "seller"} view
      </button>
    </Card>
  );
}

function VerifierPanel({
  n,
  nCodes,
  denom,
  brandName,
  merchantPortal,
  orderId,
  amount,
  expiry,
}: {
  n: number;
  nCodes: number;
  denom: number;
  brandName: string;
  merchantPortal: boolean;
  orderId: string;
  amount: number;
  expiry: string;
}) {
  const items = [
    ...Array.from({ length: nCodes }, (_, i) => `Code ${i + 1}: live, ${inr(denom)} balance, not redeemed`),
    `Brand matches: ${brandName} (in-store)`,
    `PIN matches each code · expiry ${expiry || "valid"}`,
  ];
  const done = n >= items.length;
  return (
    <Card glow="rgba(139,123,255,0.14)" className="p-6 md:p-7">
      <div className="flex items-start justify-between">
        <div>
          <Pill tone="iris">Verification layer</Pill>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">Checking the codes live</h2>
          <p className="mt-1.5 text-[14px] text-mute">{merchantPortal ? `Querying ${brandName}'s own portal for high-value vouchers.` : "Querying the issuer's balance-check page."}</p>
        </div>
        <div className="relative hidden size-20 overflow-hidden rounded-2xl bg-iris/[0.06] ring-1 ring-iris/30 sm:block">
          <div className="dot-bg absolute inset-0 opacity-60" />
          {!done && <div className="absolute inset-x-0 top-0 h-1/2 animate-scan bg-gradient-to-b from-transparent via-iris/40 to-transparent" />}
          <div className="absolute inset-0 grid place-items-center text-iris">{done ? <ShieldCheck className="size-7" /> : <ScanLine className="size-7" />}</div>
        </div>
      </div>
      <ul className="mt-6 space-y-2">
        {items.map((c, i) => (
          <motion.li
            key={c}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cx("flex items-center gap-3 rounded-xl px-4 py-3 text-[13.5px] ring-1 transition-all duration-300", i < n ? "ring-mint/20 bg-mint/[0.04]" : i === n ? "ring-iris/40 bg-iris/[0.05]" : "ring-white/[0.05]")}
          >
            <span className={cx("grid size-5 place-items-center rounded-full", i < n ? "bg-mint text-ink" : "text-iris")}>
              {i < n ? <Check className="size-3" /> : i === n ? <LoaderCircle className="size-4 animate-spin" /> : <span className="size-1.5 rounded-full bg-white/20" />}
            </span>
            <span className={i <= n ? "text-fg/90" : "text-dim"}>{c}</span>
          </motion.li>
        ))}
      </ul>
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-iris/[0.08] p-4 ring-1 ring-iris/30">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-iris">
              <ShieldCheck className="size-4" /> Signed result sent to escrow
            </div>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-mute">{`{ order: "${orderId}", amount: ${amount}, status: "PASS",
  time: 1793887331, sig: "0x9c1f…a4e2" }`}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function Settled({ q, role, onDispute, onReplay, brandName }: { q: ReturnType<typeof quote>; role: Role; onDispute: () => void; onReplay: () => void; brandName: string }) {
  const bars = [
    { k: "Buyer", v: q.buyerReceives, c: "bg-mint" },
    { k: "Dispute reserve", v: q.reserveShare, c: "bg-iris" },
    { k: "Platform", v: q.platformShare, c: "bg-fg" },
  ];
  return (
    <Card glow="rgba(61,220,151,0.14)" className="overflow-hidden p-6 text-center md:p-10">
      <Burst />
      <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 14 }} className="relative mx-auto grid size-20 place-items-center rounded-full bg-mint text-ink shadow-[0_0_60px_-5px_rgba(61,220,151,0.8)]">
        <Check className="size-9" strokeWidth={2.5} />
      </motion.div>
      <h2 className="relative mt-6 font-display text-3xl font-semibold tracking-tight">{role === "buyer" ? `${usdt(q.buyerReceives)} USDC is yours` : `Enjoy ${brandName} on Saturday`}</h2>
      <p className="relative mx-auto mt-2 max-w-md text-[14px] text-mute">
        {role === "buyer" ? "Plus 1,650 reward points from HDFC, posting within 90 working days." : "Codes are live and yours. The escrow paid the buyer and split the 1% fee."}
      </p>
      <div className="relative mx-auto mt-8 max-w-md text-left">
        <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
          {bars.map((b, i) => (
            <motion.div key={b.k} className={cx("h-full", b.c)} initial={{ width: 0 }} animate={{ width: `${Math.max(1.4, (b.v / q.sellerLocks) * 100)}%` }} transition={{ delay: 0.3 + i * 0.15, duration: 0.8 }} />
          ))}
        </div>
        <div className="mt-4 space-y-1.5">
          {bars.map((b) => (
            <div key={b.k} className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-mute">
                <span className={cx("size-2 rounded-full", b.c)} /> {b.k}
              </span>
              <span className="tabular">{usdt(b.v)} USDC</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-8 flex flex-col justify-center gap-2 sm:flex-row">
        <Button variant="outline" onClick={onReplay} icon={<RotateCcw className="size-3.5" />}>
          Replay trade
        </Button>
        {role === "seller" && (
          <Button variant="ghost" onClick={onDispute} icon={<CircleHelp className="size-3.5" />}>
            Voucher didn't work?
          </Button>
        )}
      </div>
    </Card>
  );
}

function Burst() {
  const parts = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        a: (i / 28) * Math.PI * 2,
        d: 90 + Math.random() * 120,
        c: ["#3ddc97", "#f5b544", "#8b7bff", "#ffffff"][i % 4],
        s: 3 + Math.random() * 4,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute top-[76px] left-1/2 md:top-[100px]">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: p.s, height: p.s, background: p.c }}
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: Math.cos(p.a) * p.d, y: Math.sin(p.a) * p.d, opacity: 0 }}
          transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        />
      ))}
    </div>
  );
}

function Scramble({ className }: { className?: string }) {
  const [s, setS] = useState("");
  useEffect(() => {
    const chars = "0123456789abcdef";
    const t = setInterval(() => setS(Array.from({ length: 22 }, () => chars[Math.floor(Math.random() * 16)]).join("")), 60);
    return () => clearInterval(t);
  }, []);
  return <span className={cx("font-mono text-[13px] text-iris", className)}>0x{s}</span>;
}

function DisputeModal({open,onClose}:{open:boolean;onClose:()=>void;q:ReturnType<typeof quote>;brandName:string}){if(!open)return null;return <div className="dispute-surface"><ProtectionDialog title="Dispute design preview" close={onClose}><DisputePreview/></ProtectionDialog></div>;}
