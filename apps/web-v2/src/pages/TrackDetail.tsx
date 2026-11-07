import { motion } from "motion/react";
import { ArrowLeft, ArrowUpRight, Check, Clock, Copy, LoaderCircle, Minus, RefreshCw, Search, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BuyOnPortal } from "../components/BuyOnPortal";
import { PickRoute } from "../components/PickRoute";
import { Aurora, BrandMark, Button, Pill, Row, cx } from "../components/ui";
import { ApiError, api, brandIdFromApi, STATUS, type ApiRequest, type ReqStatus } from "../lib/api";
import { brand } from "../lib/data";
import { inr, usdt } from "../lib/engine";
import { buildStages, impliedRate, isSettled, nextStep, roleOf, sameAddr, type Role, type Stage, type StageKey, type Tone } from "../lib/lifecycle";
import { useApp } from "../lib/store";
import { ReadyAction, SettleActions, type Notice } from "./TrackActions";
import { SubmitCode, VaultSetup } from "./VoucherTransfer";

/**
 * /track?id=<order id>: one order, in detail, from the viewer's side.
 * The viewer's wallet decides the perspective: crypto spender (locked the USDC), crypto buyer (buys the voucher and
 * gets the USDC), or an outside observer. The order itself is public, so no sign-in is needed to look at it.
 */

const TONE: Record<Tone, string> = {
  mint: "text-mint bg-mint/10 ring-mint/25",
  amber: "text-amber bg-amber/10 ring-amber/25",
  iris: "text-iris bg-iris/10 ring-iris/25",
  rose: "text-rose bg-rose/10 ring-rose/25",
  mute: "text-mute bg-white/[0.04] ring-white/10",
};
const TONE_TEXT: Record<Tone, string> = { mint: "text-mint", amber: "text-amber", iris: "text-iris", rose: "text-rose", mute: "text-mute" };
const TONE_DOT: Record<Tone, string> = { mint: "bg-mint", amber: "bg-amber", iris: "bg-iris", rose: "bg-rose", mute: "bg-white/30" };

const POLL_MS = 8000;
const EXPLORER = "https://testnet.arcscan.app";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

type Load = { kind: "loading" } | { kind: "ready"; req: ApiRequest; at: number; stale: boolean } | { kind: "notfound" } | { kind: "offline" } | { kind: "error"; message: string };

export default function TrackDetail({ id }: { id: string }) {
  const { fullAddress, token, signIn, signingIn, openWallet, walletRequest } = useApp();
  const [load, setLoad] = useState<Load>(id ? { kind: "loading" } : { kind: "notfound" });
  const [refreshing, setRefreshing] = useState(false);
  const last = useRef<ApiRequest | null>(null);

  const fetchOrder = useCallback(
    async (manual = false) => {
      if (!id) return;
      if (manual) setRefreshing(true);
      try {
        const { request } = await api.get(id);
        last.current = request;
        setLoad({ kind: "ready", req: request, at: Date.now(), stale: false });
      } catch (e) {
        const err = e as ApiError;
        if (last.current) setLoad({ kind: "ready", req: last.current, at: Date.now(), stale: true }); // keep what we have, flag it
        else if (err.status === 404) setLoad({ kind: "notfound" });
        else if (err.code === "unreachable") setLoad({ kind: "offline" });
        else setLoad({ kind: "error", message: err.message || "Couldn't load this order" });
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  /** An action (Ready, Settle, Dispute) came back with the new state of the order: show it now, don't wait for the next poll. */
  const applyRequest = useCallback((request: ApiRequest) => {
    last.current = request;
    setLoad({ kind: "ready", req: request, at: Date.now(), stale: false });
  }, []);

  // Poll while the order is live and the tab is visible; stop once it has settled.
  const settled = load.kind === "ready" && isSettled(load.req.status);
  useEffect(() => {
    if (!id || settled) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") fetchOrder();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [id, settled, fetchOrder]);

  return (
    <div className="relative pt-28 pb-16">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-5xl px-6">
        <Link to="/track" className="inline-flex items-center gap-1.5 text-[12.5px] text-mute hover:text-fg">
          <ArrowLeft className="size-3.5" /> All orders
        </Link>

        {load.kind === "loading" && (
          <div className="mt-10 flex items-center gap-2 text-[13.5px] text-mute">
            <LoaderCircle className="size-4 animate-spin" /> Loading order {id}…
          </div>
        )}
        {load.kind === "notfound" && <Missing id={id} title={id ? "We couldn't find that order" : "Look up an order"} body={id ? `Nothing is saved on NetPositive under “${id}”. Check the ID and try again.` : "Paste an order ID to see where it stands."} />}
        {load.kind === "offline" && <Missing id={id} title="The NetPositive backend isn't reachable" body="Orders are read from the server, so there is nothing to show right now. Try again in a moment." retry={() => fetchOrder(true)} />}
        {load.kind === "error" && <Missing id={id} title="Couldn't load this order" body={load.message} retry={() => fetchOrder(true)} />}
        {load.kind === "ready" && (
          <Detail
            req={load.req}
            role={roleOf(load.req, fullAddress)}
            viewer={fullAddress}
            stale={load.stale}
            updatedAt={load.at}
            refreshing={refreshing}
            onRefresh={() => fetchOrder(true)}
            token={token}
            signIn={signIn}
            signingIn={signingIn}
            openWallet={openWallet}
            walletRequest={walletRequest}
            onApplied={applyRequest}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ states */

function Missing({ id, title, body, retry }: { id: string; title: string; body: string; retry?: () => void }) {
  return (
    <div className="hairline mt-8 rounded-[24px] bg-ink-2/60 px-6 py-12 text-center">
      <div className="text-[16px] font-medium">{title}</div>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-mute">{body}</p>
      <div className="mt-6 flex justify-center">
        <Lookup initial={id} />
      </div>
      {retry && (
        <button onClick={retry} className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-mute hover:text-fg">
          <RefreshCw className="size-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

function Lookup({ initial = "" }: { initial?: string }) {
  const nav = useNavigate();
  const [v, setV] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) nav(`/track?id=${encodeURIComponent(v.trim())}`);
      }}
      className="flex w-full max-w-md items-center gap-2"
    >
      <label className="flex h-10 flex-1 items-center gap-2 rounded-full bg-white/[0.04] px-4 ring-1 ring-white/10 focus-within:ring-mint/50">
        <Search className="size-3.5 text-dim" />
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Order ID" aria-label="Order ID" className="w-full bg-transparent font-mono text-[12.5px] outline-none placeholder:text-dim" />
      </label>
      <Button type="submit" size="sm" disabled={!v.trim()}>
        Track
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ detail */

type DetailProps = {
  req: ApiRequest;
  role: Role;
  viewer: string;
  stale: boolean;
  updatedAt: number;
  refreshing: boolean;
  onRefresh: () => void;
  token: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
  openWallet: () => void;
  walletRequest: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  onApplied: (req: ApiRequest) => void;
};

function Detail({ req, role, viewer, stale, updatedAt, refreshing, onRefresh, token, signIn, signingIn, openWallet, walletRequest, onApplied }: DetailProps) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const b = brand(brandIdFromApi(req.brand));
  const s = STATUS[req.status];
  const stages = buildStages(req, role, b.name);
  const next = nextStep(req, role, b.name);
  const live = !isSettled(req.status);
  const usdcAmount = Number(req.amountUsdc) || 0;

  // Buttons live inside the lifecycle step they belong to, and only for the spender.
  const common = { req, token, signIn, signingIn, onUpdated: (r: ApiRequest, n: Notice) => { onApplied(r); setNotice(n); } };
  const actions: Partial<Record<StageKey, ReactNode>> = {};
  if (role === "spender" && next.cta === "ready") actions.ready = <ReadyAction {...common} viewer={viewer} walletRequest={walletRequest} expired={!!req.ready} />;
  if (role === "spender" && next.cta === "settle") actions.outcome = <SettleActions {...common} />;
  if (role === "buyer" && req.status === "accepted") actions.code = <SubmitCode req={req} onUpdated={common.onUpdated} />;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {/* header */}
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <BrandMark id={brandIdFromApi(req.brand)} size={52} />
        <div className="min-w-0 flex-1">
          <div className="label">Order</div>
          <h1 className="text-gradient font-display text-[30px] leading-tight font-semibold tracking-[-0.03em]">
            {b.name} {inr(req.amountInr)}
          </h1>
          <div className="mt-1 flex items-center gap-2 font-mono text-[11.5px] text-dim">
            <span className="truncate">{req.id}</span>
            <CopyBtn text={req.id} label="Copy order ID" />
          </div>
        </div>
        <div className="text-right">
          <Pill tone={s.tone} dot={live}>
            {s.label}
          </Pill>
          <div className="mt-2 text-[12px] text-dim">
            {usdt(usdcAmount)} USDC · {inr(req.amountInr)}
          </div>
        </div>
      </div>

      {role === "observer" && <RoleBanner role={role} viewer={viewer} req={req} openWallet={openWallet} />}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}
          {role === "spender" && (req.status === "pending_funding" || req.status === "open" || req.status === "accepted") && <VaultSetup />}
          {role === "observer" && req.status === "open" ? (
            // Someone who could fill this order: choose how to buy it, then accept.
            <PickRoute req={req} onAccepted={onApplied} onRefresh={onRefresh} />
          ) : (
            <>
              <NextCard req={req} next={next} id={req.id} role={role} status={req.status} token={token} signIn={signIn} signingIn={signingIn} onChanged={onRefresh} />
              <Timeline stages={stages} viewer={viewer} actions={actions} />
            </>
          )}
        </div>
        <div className="space-y-5">
          {/* Someone looking at an open order is a possible buyer, so show the trade from the buyer's side. */}
          <Money req={req} role={role === "observer" && req.status === "open" ? "buyer" : role} brandName={b.name} />
          <Parties req={req} viewer={viewer} />
          <Technical req={req} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-dim">
        <span>
          {stale ? <span className="text-amber">Couldn't refresh just now. Showing the last known state. </span> : null}
          Updated {ago(new Date(updatedAt).toISOString())}
          {live ? ` · refreshes every ${POLL_MS / 1000}s` : " · this order is settled, so it no longer refreshes"}
        </span>
        <button onClick={onRefresh} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-mute ring-1 ring-white/10 hover:text-fg">
          <RefreshCw className={cx("size-3.5", refreshing && "animate-spin")} /> Refresh
        </button>
      </div>
    </motion.div>
  );
}

function RoleBanner({ role, viewer, req, openWallet }: { role: Role; viewer: string; req: ApiRequest; openWallet: () => void }) {
  const text: Record<Role, { tone: Tone; title: string; body: ReactNode }> = {
    spender: {
      tone: "mint",
      title: "You are the crypto spender",
      body: `You locked USDC to get this ${brand(brandIdFromApi(req.brand)).name} voucher. The buyer pays for the voucher and is paid in USDC once you confirm.`,
    },
    buyer: {
      tone: "iris",
      title: "You are the crypto buyer",
      body: "You buy the voucher with your card and hand over its code. You are paid in USDC once the spender confirms.",
    },
    observer: {
      tone: "mute",
      title: viewer ? "You're not part of this order" : "You're viewing this order as a guest",
      body: viewer ? "This is the public view. Only the spender and the buyer see the steps meant for them." : "Connect your wallet and this page will show the order from your side.",
    },
  };
  const t = text[role];
  return (
    <div className={cx("mt-6 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ring-1", TONE[t.tone])}>
      <Wallet className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{t.title}</div>
        <div className="text-[12.5px] text-fg/70">{t.body}</div>
      </div>
      {role === "observer" && !viewer && (
        <Button size="sm" variant="outline" onClick={openWallet}>
          Connect wallet
        </Button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- next step */

function NextCard({ req, next, id, role, status, token, signIn, signingIn, onChanged }: { req: ApiRequest; next: ReturnType<typeof nextStep>; id: string; role: Role; status: ReqStatus; token: string | null; signIn: () => Promise<string | null>; signingIn: boolean; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function cancel() {
    if (!token) return;
    setBusy(true);
    setErr("");
    try {
      await api.cancel(id, token);
      setConfirming(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("hairline rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl")}>
      <div className="label">{role === "observer" ? "Where it stands" : "What happens next for you"}</div>
      <div className={cx("mt-2 text-[17px] font-semibold tracking-tight", TONE_TEXT[next.tone])}>{next.title}</div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg/80">{next.body}</p>
      {(next.cta === "ready" || next.cta === "settle") && <p className="mt-3 text-[12.5px] text-mute">The {next.cta === "ready" ? "Ready" : "Settle and Dispute"} button{next.cta === "ready" ? "" : "s are"} in the lifecycle below.</p>}
      {next.cta !== "none" && next.cta !== "ready" && next.cta !== "settle" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {next.cta === "trade" && status === "accepted" && role === "buyer" ? (
            // Shown only once the spender is ready: buy the voucher on the bank's page.
            <BuyOnPortal req={req} />
          ) : next.cta === "trade" ? (
            <Button size="sm" to={`/trade/${id}`} icon={<ArrowUpRight className="size-3.5" />}>
              Open trade room
            </Button>
          ) : null}
          {next.cta === "fill" && (
            <Button size="sm" to="/buy" icon={<ArrowUpRight className="size-3.5" />}>
              Fill this order on Buy
            </Button>
          )}
          {next.cta === "cancel" &&
            (!token ? (
              <Button size="sm" variant="outline" onClick={signIn} disabled={signingIn} icon={signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}>
                {signingIn ? "Check your wallet…" : "Sign in to cancel this order"}
              </Button>
            ) : confirming ? (
              <>
                <Button size="sm" variant="amber" onClick={cancel} disabled={busy} icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />}>
                  {status === "open" ? "Yes, cancel and refund me" : "Yes, cancel"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  Keep the order
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)} icon={<X className="size-3.5" />}>
                {status === "open" ? "Cancel and get my USDC back" : "Cancel this order"}
              </Button>
            ))}
        </div>
      )}
      {err && <p className="mt-3 text-[12.5px] text-rose">{err}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- timeline */

function Timeline({ stages, viewer, actions }: { stages: Stage[]; viewer: string; actions: Partial<Record<StageKey, ReactNode>> }) {
  return (
    <div className="hairline rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
      <div className="label">Lifecycle</div>
      <ol className="mt-4">
        {stages.map((st, i) => (
          <StageRow key={st.key} st={st} viewer={viewer} last={i === stages.length - 1} action={actions[st.key]} />
        ))}
      </ol>
    </div>
  );
}

function StageRow({ st, viewer, last, action }: { st: Stage; viewer: string; last: boolean; action?: ReactNode }) {
  const done = st.state === "done";
  const cur = st.state === "current";
  const skipped = st.state === "skipped";
  const time = when(st.at);
  const mine = !!st.actor && sameAddr(st.actor, viewer);
  const settledTone = done ? st.tone : cur ? (st.tone === "mint" ? "amber" : st.tone) : "mute";

  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!last && <span className={cx("absolute top-7 bottom-0 left-[13px] w-px", done ? "bg-mint/40" : "bg-white/[0.09]")} aria-hidden />}
      <span
        className={cx(
          "relative mt-0.5 grid size-[27px] shrink-0 place-items-center rounded-full ring-1",
          done && "bg-mint/15 text-mint ring-mint/40",
          done && st.tone !== "mint" && TONE[st.tone],
          cur && cx(TONE[settledTone], "shadow-[0_0_0_4px_rgba(255,255,255,0.03)]"),
          st.state === "upcoming" && "bg-transparent text-dim ring-white/12",
          skipped && "bg-transparent text-dim/60 ring-white/[0.07]",
        )}
      >
        {done ? <Check className="size-3.5" /> : skipped ? <Minus className="size-3.5" /> : cur ? <span className={cx("size-2 animate-pulse rounded-full", TONE_DOT[settledTone])} /> : null}
      </span>
      <div className={cx("min-w-0 flex-1", skipped && "opacity-60")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className={cx("text-[14.5px] font-medium", st.state === "upcoming" || skipped ? "text-mute" : "text-fg")}>
            {st.title}
            {skipped && <span className="ml-2 font-mono text-[10px] tracking-wider text-dim uppercase">didn't happen</span>}
            {cur && <span className={cx("ml-2 font-mono text-[10px] tracking-wider uppercase", TONE_TEXT[settledTone])}>in progress</span>}
          </div>
          {time && <time className="font-mono text-[11px] text-dim" dateTime={st.at ?? undefined} title={st.at ?? undefined}>{time}</time>}
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{st.detail}</p>

        {st.facts.length > 0 && (
          <dl className="mt-2 space-y-1 rounded-xl bg-white/[0.03] px-3 py-2 text-[12.5px] ring-1 ring-white/[0.06]">
            {st.facts.map((f) => (
              <div key={f.label} className="flex gap-3">
                <dt className="w-20 shrink-0 text-dim">{f.label}</dt>
                <dd className="min-w-0 break-words text-fg/90">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {(st.actor || st.tx || st.deadline) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-dim">
            {st.actor && (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono">{short(st.actor)}</span>
                {mine && <span className="rounded-full bg-mint/10 px-1.5 py-px font-mono text-[9.5px] tracking-wider text-mint uppercase ring-1 ring-mint/25">you</span>}
              </span>
            )}
            {st.tx && !st.tx.startsWith("reconciled") && (
              <a href={`${EXPLORER}/tx/${st.tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-fg">
                tx {st.tx.slice(0, 8)}… <ArrowUpRight className="size-3" />
              </a>
            )}
            {st.deadline && (
              <span className="inline-flex items-center gap-1.5 text-amber">
                <Clock className="size-3" /> {st.deadline.label} <Countdown to={st.deadline.at} />
              </span>
            )}
          </div>
        )}
        {action}
      </div>
    </li>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const tone: Tone = notice.tone;
  return (
    <div role="status" className={cx("flex items-start gap-3 rounded-2xl px-4 py-3 text-[13.5px] ring-1", TONE[tone])}>
      <Check className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {notice.text}
        {notice.tx && !notice.tx.startsWith("reconciled") && (
          <a href={`${EXPLORER}/tx/${notice.tx}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-mono text-[12px] underline-offset-2 hover:underline">
            tx {notice.tx.slice(0, 8)}… <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>
      <button onClick={onClose} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-white/10">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ side panels */

const FUNDS: Record<Role, Partial<Record<ReqStatus, string>>> = {
  spender: { pending_funding: "Not deposited yet", open: "Locked in escrow", accepted: "Locked in escrow", code_submitted: "Locked until you confirm", disputed: "Frozen during the review", releasing: "Being paid to the buyer", released: "Paid to the buyer", refunding: "Coming back to you", refunded: "Returned to you", cancelled: "Never locked" },
  buyer: { open: "Locked in escrow", accepted: "Locked in escrow for you", code_submitted: "Yours once the spender confirms", disputed: "Frozen during the review", releasing: "On its way to you", released: "In your wallet", refunding: "Going back to the spender", refunded: "Went back to the spender", cancelled: "Never locked" },
  observer: { pending_funding: "Not deposited yet", open: "Locked in escrow", accepted: "Locked in escrow", code_submitted: "Locked in escrow", disputed: "Frozen during the review", releasing: "Being paid out", released: "Paid to the buyer", refunding: "Being returned", refunded: "Returned to the spender", cancelled: "Never locked" },
};

function Money({ req, role, brandName }: { req: ApiRequest; role: Role; brandName: string }) {
  const rate = impliedRate(req);
  const voucher = `${inr(req.amountInr)} ${brandName} voucher`;
  const amt = `${usdt(Number(req.amountUsdc) || 0)} USDC`;
  return (
    <div className="hairline rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
      <div className="label">{role === "observer" ? "The trade" : "Your side of the trade"}</div>
      <div className="mt-2 divide-y divide-white/[0.06]">
        {role === "buyer" ? (
          <>
            <Row k="You pay for" v={voucher} />
            <Row k="You receive" v={amt} strong />
          </>
        ) : role === "spender" ? (
          <>
            <Row k="You get" v={voucher} />
            <Row k="You locked" v={amt} strong />
          </>
        ) : (
          <>
            <Row k="Voucher" v={voucher} />
            <Row k="USDC in escrow" v={amt} strong />
          </>
        )}
        {rate && <Row k="Implied rate" v={`${inr(rate, 2)} / USDC`} />}
        <Row k="Where the USDC is" v={FUNDS[role][req.status] ?? "—"} />
      </div>
    </div>
  );
}

function Parties({ req, viewer }: { req: ApiRequest; viewer: string }) {
  const rows: { label: string; addr: string | null }[] = [
    { label: "Crypto spender", addr: req.crypto_spender },
    { label: "Crypto buyer", addr: req.crypto_buyer },
  ];
  return (
    <div className="hairline rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
      <div className="label">Who's involved</div>
      <div className="mt-2 divide-y divide-white/[0.06]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
            <span className="text-mute">{r.label}</span>
            {r.addr ? (
              <span className="flex items-center gap-2">
                {sameAddr(r.addr, viewer) && <span className="rounded-full bg-mint/10 px-1.5 py-px font-mono text-[9.5px] tracking-wider text-mint uppercase ring-1 ring-mint/25">you</span>}
                <a href={`${EXPLORER}/address/${r.addr}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-mint">
                  {short(r.addr)} <ArrowUpRight className="size-3" />
                </a>
                <CopyBtn text={r.addr} label={`Copy ${r.label} address`} />
              </span>
            ) : (
              <span className="text-[12.5px] text-dim">Nobody yet</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Technical({ req }: { req: ApiRequest }) {
  const txs = [
    ["Deposit", req.escrowTxHash],
    ["Release", req.releaseTxHash],
    ["Refund", req.refundTxHash],
  ].filter((t): t is [string, string] => !!t[1] && !t[1].startsWith("reconciled"));
  return (
    <details className="hairline group rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
      <summary className="label cursor-pointer list-none select-none">Technical details</summary>
      <div className="mt-3 space-y-2 text-[12px]">
        <Kv k="Order ID" v={req.id} />
        <Kv k="Escrow ID" v={req.escrowId} />
        <Kv k="Status code" v={req.status} />
        <Kv k="Created" v={when(req.createdAt) ?? "—"} />
        <Kv k="Last change" v={when(req.updatedAt) ?? "—"} />
        {txs.map(([k, h]) => (
          <div key={k} className="flex gap-3">
            <span className="w-20 shrink-0 text-dim">{k} tx</span>
            <a href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-fg/85 hover:text-mint">
              {h}
            </a>
          </div>
        ))}
        {req.lastError && <Kv k="Last error" v={req.lastError} />}
      </div>
    </details>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-dim">{k}</span>
      <span className="min-w-0 break-all font-mono text-fg/85">{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- bits */

function CopyBtn({ text, label }: { text: string; label: string }) {
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
          /* clipboard blocked: nothing to do */
        }
      }}
      className="grid size-6 shrink-0 place-items-center rounded-md text-dim hover:bg-white/5 hover:text-fg"
    >
      {ok ? <Check className="size-3.5 text-mint" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((Date.parse(to) - now) / 1000));
  if (s === 0) return <span className="font-mono">due now, status updates within a minute</span>;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return <span className="font-mono tabular">{`${h ? `${h}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`} left</span>;
}
