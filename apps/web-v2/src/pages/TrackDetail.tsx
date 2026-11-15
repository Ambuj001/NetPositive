import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Check, ChevronDown, CircleCheck, Clock, Minus, RefreshCw, Search, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BuyOnPortal } from "../components/BuyOnPortal";
import { OnchainProof } from "../components/OnchainProof";
import { PickRoute } from "../components/PickRoute";
import { AppPage, AutoHeight, BrandMark, Button, Callout, CopyButton, DUR, EASE, EmptyState, Panel, PanelHead, Pill, Row, Skeleton, Spinner, Swap, TONE_DOT, TONE_PILL, cx, enter, statusTone } from "../components/ui";
import { ApiError, api, brandIdFromApi, STATUS, type ApiRequest } from "../lib/api";
import { ARC } from "../lib/chain";
import { brand } from "../lib/data";
import { inr, usdt } from "../lib/engine";
import { buildStages, impliedRate, isSettled, roleOf, sameAddr, type Role, type Stage, type Tone } from "../lib/lifecycle";
import { ledgerFromRequest } from "../lib/orderbook";
import { deadlineLine, deadlineShort, deadlineUrgency, orderView, type ChainInput, type Deadline, type OrderView } from "../lib/orderView";
import { useApp } from "../lib/store";
import { useEscrow, type ChainView } from "../lib/useEscrow";
import { BindAction, BuyerExit, CancelAction, DisputeAction, ReadyAction, SettleActions, type Notice } from "./TrackActions";
import { SubmitCode, VaultSetup } from "./VoucherTransfer";

/**
 * /track?id=<order id>: one order, from the viewer's side. The connected wallet decides the perspective: voucher buyer
 * (locked the USDC), USDC buyer (buys the voucher, is paid in USDC), or someone else (read-only).
 * What to show and offer comes from `orderView`, the same function the order list uses.
 */

const TONE: Record<Tone, string> = TONE_PILL;

/** The server is asked every 10 s while the tab is visible, and again whenever the window regains focus. */
const POLL_MS = 10_000;
const EXPLORER = ARC.explorer;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : null);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

type Load = { kind: "loading" } | { kind: "ready"; req: ApiRequest; at: number; stale: boolean } | { kind: "notfound" } | { kind: "offline" } | { kind: "error"; message: string };

export default function TrackDetail({ id }: { id: string }) {
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
        if (last.current) setLoad({ kind: "ready", req: last.current, at: Date.now(), stale: true });
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
    void fetchOrder();
  }, [fetchOrder]);

  /** An action came back with the new state of the order: show it now, don't wait for the next poll. */
  const applyRequest = useCallback((request: ApiRequest) => {
    last.current = request;
    setLoad({ kind: "ready", req: request, at: Date.now(), stale: false });
  }, []);

  // Poll while the order is live and the tab is visible; refetch on focus; stop once it has settled.
  const settled = load.kind === "ready" && isSettled(load.req.status);
  useEffect(() => {
    if (!id || settled) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void fetchOrder();
    }, POLL_MS);
    const onFocus = () => void fetchOrder();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [id, settled, fetchOrder]);

  return (
    <AppPage>
        <Link to="/track" className="inline-flex h-8 items-center gap-1.5 rounded-full text-[13px] text-mute transition-colors hover:text-fg">
          <ArrowLeft className="size-3.5" /> All orders
        </Link>
        {load.kind === "loading" && <DetailSkeleton id={id} />}
        {load.kind === "notfound" && <Missing id={id} title={id ? "We couldn't find that order" : "Look up an order"} body={id ? `Nothing is saved on NetPositive under “${id}”. Check the ID and try again.` : "Paste an order ID to see where it stands."} />}
        {load.kind === "offline" && <Missing id={id} title="The NetPositive backend isn't reachable" body="Orders are read from the server, so there is nothing to show right now. Try again in a moment." retry={() => void fetchOrder(true)} />}
        {load.kind === "error" && <Missing id={id} title="Couldn't load this order" body={load.message} retry={() => void fetchOrder(true)} />}
        {load.kind === "ready" && <Detail req={load.req} stale={load.stale} updatedAt={load.at} refreshing={refreshing} refetch={fetchOrder} onApplied={applyRequest} />}
    </AppPage>
  );
}

/* ------------------------------------------------------------------ states */

/** The page's shape while the order loads, so nothing jumps when it arrives. */
function DetailSkeleton({ id }: { id: string }) {
  return (
    <div className="mt-4" aria-busy="true" aria-label={`Loading order ${id}`}>
      <div className="flex items-center gap-4">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-56 max-w-full" />
          <Skeleton className="h-3.5 w-40" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-5">
        <div className="space-y-4">
          <Panel className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-11 w-44 rounded-full" />
          </Panel>
          <Panel className="space-y-3">
            <Skeleton className="h-3 w-20" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </Panel>
        </div>
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Panel key={i} className="space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}

function Missing({ id, title, body, retry }: { id: string; title: string; body: string; retry?: () => void }) {
  return (
    <motion.div {...enter} className="mt-6">
      <EmptyState
        icon={<Search />}
        title={title}
        body={body}
        action={
          <div className="flex w-full flex-col items-center gap-3">
            <Lookup initial={id} />
            {retry && (
              <Button size="sm" variant="ghost" onClick={retry} icon={<RefreshCw className="size-3.5" />}>
                Try again
              </Button>
            )}
          </div>
        }
      />
    </motion.div>
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
      <label className="field flex h-9 flex-1 items-center gap-2 rounded-full px-3.5">
        <Search className="size-3.5 shrink-0 text-dim" />
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Order ID" aria-label="Order ID" className="w-full min-w-0 bg-transparent font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-dim" />
      </label>
      <Button type="submit" size="sm" disabled={!v.trim()}>
        Track
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ detail */

const chainInput = (c: ChainView): ChainInput => (c.kind === "ok" ? { kind: "ok", escrow: c.escrow } : c.kind === "mock" ? { kind: "mock" } : { kind: "unknown" });

function Detail({ req, stale, updatedAt, refreshing, refetch, onApplied }: { req: ApiRequest; stale: boolean; updatedAt: number; refreshing: boolean; refetch: (manual?: boolean) => Promise<void>; onApplied: (r: ApiRequest) => void }) {
  const app = useApp();
  const { fullAddress, token, walletRequest, onArc, openWallet } = app;
  const role = roleOf(req, fullAddress);
  const [notice, setNotice] = useState<Notice | null>(null);
  const b = brand(brandIdFromApi(req.brand));
  const s = STATUS[req.status];
  const live = !isSettled(req.status);

  const { view: chain, refresh: refreshChain } = useEscrow(req.escrowId, { live, walletRequest, hasWallet: !!fullAddress });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const v = orderView({ req, role, chain: chainInput(chain), now, signedIn: !!token, viewer: fullAddress || null, brandName: b.name });
  const stages = buildStages(req, role, b.name, now);

  // After any action: refetch both now, and once more shortly after (the server's keeper and sweeps lag a little).
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAll = useCallback(() => {
    void refetch();
    void refreshChain(true);
    if (later.current) clearTimeout(later.current);
    later.current = setTimeout(() => {
      void refetch();
      void refreshChain(true);
    }, 6000);
  }, [refetch, refreshChain]);
  useEffect(() => () => {
    if (later.current) clearTimeout(later.current);
  }, []);

  const onUpdated = useCallback(
    (r: ApiRequest, n: Notice) => {
      onApplied(r);
      setNotice(n);
      refreshAll();
    },
    [onApplied, refreshAll],
  );
  const onChainDone = useCallback(
    (n: Notice) => {
      setNotice(n);
      refreshAll();
    },
    [refreshAll],
  );

  // A success notice fades after a while, so it never sits above a newer, contradicting state.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12_000);
    return () => clearTimeout(t);
  }, [notice]);

  const chainFailed = chain.kind === "error" || chain.kind === "bad";

  return (
    <motion.div {...enter}>
      {/* header */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
        <BrandMark id={brandIdFromApi(req.brand)} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] tabular md:text-[28px]">
            {b.name} {inr(req.amountInr)}
          </h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11.5px] text-dim">
            <span className="truncate" title={req.id}>
              {req.id}
            </span>
            <CopyButton text={req.id} label="Copy order ID" className="size-6" />
          </div>
        </div>
        <div className="flex basis-full flex-wrap items-center gap-x-2.5 gap-y-1.5 sm:basis-auto sm:flex-col sm:items-end">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={req.status} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: DUR.fast, ease: EASE }}>
              <Pill tone={statusTone(req.status, s.tone)} dot={live}>
                {s.label}
              </Pill>
            </motion.span>
          </AnimatePresence>
          <span className="text-[12px] text-mute">{role === "spender" ? "You are the voucher buyer" : role === "buyer" ? "You are the USDC buyer" : "Not your order"}</span>
        </div>
      </div>

      {/* Phone: primary card, then amounts and the escrow, then history. Desktop: history under the primary card. */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-5">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <AnimatePresence initial={false}>{notice && !chainFailed && <NoticeBar key={notice.text} notice={notice} onClose={() => setNotice(null)} />}</AnimatePresence>
          <NowCard req={req} role={role} v={v} chain={chain} blocked={live && chainFailed} retryChain={() => void refreshChain()} onArc={onArc} hasWallet={!!fullAddress} openWallet={openWallet} onUpdated={onUpdated} onChainDone={onChainDone} refetch={() => void refetch(true)} />
          {role === "observer" && v.actions.includes("fill") && <PickRoute req={req} onAccepted={onApplied} onRefresh={() => void refetch(true)} />}
        </div>
        <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Money req={req} role={role === "observer" && req.status === "open" ? "buyer" : role} brandName={b.name} />
          <OnchainProof req={req} view={chain} onRefresh={() => void refreshChain()} details={<Technical req={req} />} />
          <Parties req={req} viewer={fullAddress} />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <Timeline stages={stages} viewer={fullAddress} />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[12px] text-mute">
        <span className="flex items-center gap-2">
          <span className={cx("size-1.5 shrink-0 rounded-full", stale ? "bg-amber" : live ? "bg-pos" : "bg-dim")} aria-hidden />
          <span>
            {stale ? <span className="text-amber-ink">Couldn't reach the server just now. Showing the last known state. </span> : null}
            Updated {ago(updatedAt, now)}
            {live ? ` · refreshes every ${POLL_MS / 1000} s` : " · settled, no longer refreshes"}
          </span>
        </span>
        <Button size="sm" variant="outline" onClick={() => { void refetch(true); void refreshChain(true); }} icon={<RefreshCw className={cx("size-3.5", refreshing && "animate-spin")} />}>
          Refresh
        </Button>
      </div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- now card */

/** Steps that are the point of the current state; everything else is a quiet "More actions" button. */
function NowCard({ req, role, v, chain, blocked, retryChain, onArc, hasWallet, openWallet, onUpdated, onChainDone, refetch }: { req: ApiRequest; role: Role; v: OrderView; chain: ChainView; blocked: boolean; retryChain: () => void; onArc: boolean; hasWallet: boolean; openWallet: () => void; onUpdated: (r: ApiRequest, n: Notice) => void; onChainDone: (n: Notice) => void; refetch: () => void }) {
  const { fullAddress, token, signIn, signingIn, walletRequest } = useApp();
  const A = new Set(v.actions);
  const common = { req, token, signIn, signingIn, onUpdated };
  const locked = `${usdt(ledgerFromRequest(req).sellerLocks)} USDC`;
  const codeIn = req.status === "code_submitted" || req.status === "disputed";
  const walletSteps = v.actions.some((a) => a !== "fill" && a !== "openDispute" && a !== "buyVoucher" && a !== "cancelNoTx");
  const label = v.stop ? "Stop" : v.actor === "you" ? "Your move" : role === "observer" ? "Where it stands" : v.actor === "nobody" || v.actor === "automatic" ? "Status" : `Waiting on the ${v.actor}`;
  // Release is the main step only when it is the viewer's move (or during a dispute, where it ends it); otherwise it is an early option.
  const releaseMain = A.has("release") && v.actor === "you";
  const hasMain = A.has("ready") || A.has("bind") || A.has("buyVoucher") || A.has("deliver") || releaseMain || A.has("openDispute");
  const hasMore = A.has("cancel") || A.has("cancelNoTx") || A.has("unassign") || A.has("concede") || A.has("dispute") || (A.has("release") && !releaseMain);
  // The observer's "this is read-only" line is shown in the card; every other note is a detail.
  const lead = role === "observer" ? (v.notes[0]?.text ?? null) : null;
  const details = role === "observer" ? v.notes.slice(1) : v.notes;
  const showVault = role === "spender" && (req.status === "pending_funding" || req.status === "open" || req.status === "accepted") && !A.has("ready");

  // Which primary step is on screen. When it changes (Ready → confirm → deliver → release), the step block cross-fades.
  // When the order moves on and the card is scrolled out of view above (e.g. after accepting from further down the
  // page), bring it back into view so the next step is what the person sees.
  const cardRef = useRef<HTMLDivElement>(null);
  const firstHeadline = useRef(v.headline);
  useEffect(() => {
    if (firstHeadline.current === v.headline) return;
    firstHeadline.current = "";
    const el = cardRef.current;
    if (el && el.getBoundingClientRect().top < 72) el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, [v.headline]);
  const mainKey = ["ready", "bind", "buyVoucher", "deliver", "release", "openDispute"].filter((k) => (k === "release" ? releaseMain : A.has(k as never))).join("+") || "none";
  const settled = isSettled(req.status);

  return (
    <Panel ref={cardRef} pad={false} className={cx("scroll-mt-24 overflow-hidden", v.actor === "you" && !v.stop && !settled && "border-brand/30 shadow-[0_1px_2px_rgba(12,13,15,0.04),0_0_0_3px_rgba(0,0,255,0.05)]")} data-testid="now-card">
      <AutoHeight>
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className={cx("label flex items-center gap-2", v.actor === "you" && !v.stop && "text-brand-ink")}>
              {v.actor === "you" && !v.stop && !settled && (
                <span className="relative flex size-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-50" />
                  <span className="relative size-1.5 rounded-full bg-brand" />
                </span>
              )}
              {label}
            </div>
            {v.deadline && <LiveDeadline d={v.deadline} role={role} />}
          </div>
          <Swap k={v.headline}>
            <div className={cx("mt-2 text-[20px] leading-snug font-semibold tracking-[-0.02em]", v.stop ? "text-rose-ink" : "text-fg")}>{label === "Your move" ? cap(v.headline.replace(/^Your move: /, "")) : v.headline}</div>
            <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-mute">{v.body}</p>
          </Swap>

          {settled && <Finished req={req} role={role} />}

          {/* The one caution for this state. A failed escrow read or a mismatch replaces it. */}
          {blocked ? (
            <Callout role="alert" tone={chain.kind === "bad" ? "rose" : "amber"} icon={<AlertTriangle />} className="mt-4">
              {/* The per-source reasons for a failed read are under "How this was checked" in the on-chain card. */}
              <strong className="font-medium">{chain.kind === "bad" ? "The escrow can't be verified." : "The escrow couldn't be read from any source."}</strong> {chain.kind === "bad" ? chain.text : ""}{" "}
              {role === "buyer" ? "Don't buy the voucher until this page can read the escrow." : "On-chain steps are hidden until it can be read."}{" "}
              <button onClick={retryChain} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                <RefreshCw className="size-3" /> Try again
              </button>
            </Callout>
          ) : v.stop ? (
            <Callout role="alert" tone="rose" icon={<AlertTriangle />} className="mt-4">
              Don't buy the voucher and don't send any transaction for this order. Nothing has moved. Contact NetPositive support with the order ID.
            </Callout>
          ) : v.caution ? (
            <Callout tone="amber" icon={<AlertTriangle />} className="mt-4 font-medium">
              {v.caution}
            </Callout>
          ) : null}

          {lead && <p className="mt-3 text-[13px] leading-relaxed text-mute">{lead}</p>}
          {role === "observer" && !hasWallet && (
            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={openWallet}>
                Connect wallet
              </Button>
            </div>
          )}

          {/* Session and wallet checks before any action: quiet lines, not warnings. */}
          {role !== "observer" && v.needsSignIn && !(releaseMain && !token) && (
            <p className="mt-3 text-[13px] leading-relaxed text-mute">
              Connected as <span className="font-mono text-[12px]" title={fullAddress}>{short(fullAddress)}</span> but not signed in with this wallet.{" "}
              <button onClick={() => void signIn()} disabled={signingIn} className="font-medium text-fg underline underline-offset-2 hover:text-brand-ink disabled:opacity-50">
                {signingIn ? "Check your wallet…" : "Sign in (free signature)"}
              </button>
            </p>
          )}
          {role !== "observer" && walletSteps && hasWallet && !onArc && chain.kind !== "mock" && <p className="mt-3 text-[12.5px] text-mute">Your wallet is on another network. It asks to switch to {ARC.name} first; nothing is sent before that.</p>}

          {hasMain && (
            <Swap k={mainKey} className="mt-5">
              <div className="space-y-5">
                {A.has("ready") && <ReadyAction {...common} viewer={fullAddress} walletRequest={walletRequest} again={v.ready !== "none"} />}
                {A.has("bind") && <BindAction req={req} onDone={onChainDone} />}
                {A.has("buyVoucher") && (
                  <div>
                    <StepTitle n={1}>Buy the voucher with your card</StepTitle>
                    <BuyOnPortal req={req} />
                  </div>
                )}
                {A.has("deliver") && (
                  <div className={cx(A.has("buyVoucher") && "border-t border-line pt-5")}>
                    {A.has("buyVoucher") && <StepTitle n={2}>Submit its code</StepTitle>}
                    <SubmitCode req={req} onUpdated={onUpdated} deliveredOnChain={v.deliveredOnChain} />
                  </div>
                )}
                {releaseMain && <SettleActions {...common} codeIn={codeIn} />}
                {A.has("openDispute") && (
                  <Button variant="outline" to={`/dispute/${encodeURIComponent(req.id)}`} icon={<ArrowUpRight className="size-4" />}>
                    Open the dispute page
                  </Button>
                )}
              </div>
            </Swap>
          )}
          {chain.kind === "loading" && role !== "observer" && !settled && (
            <p className="mt-4 flex items-center gap-2 text-[12.5px] text-mute">
              <Spinner /> Reading the escrow on {ARC.name}…
            </p>
          )}

          {hasMore && (
            <div className={cx("flex flex-wrap items-center gap-2", hasMain ? "mt-5 border-t border-line pt-4" : "mt-5")}>
              <span className="mr-1 text-[12px] text-dim">More actions</span>
              {A.has("release") && !releaseMain && <SettleActions {...common} codeIn={codeIn} quiet />}
              {A.has("dispute") && <DisputeAction {...common} />}
              {A.has("cancel") && <CancelAction {...common} withTx locked={locked} />}
              {A.has("cancelNoTx") && <CancelAction {...common} withTx={false} locked={locked} />}
              {A.has("unassign") && <BuyerExit req={req} kind="unassign" onDone={onChainDone} />}
              {A.has("concede") && <BuyerExit req={req} kind="concede" onDone={onChainDone} />}
            </div>
          )}
          {showVault && <VaultSetup />}

          {(v.deadline || details.length > 0 || v.serverBehind) && (
            <details className="group mt-5 border-t border-line pt-3">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[12.5px] text-mute select-none hover:text-fg">
                Details <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <ul className="np-fade-in mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-mute">
                {v.deadline && <DeadlineDetail d={v.deadline} role={role} />}
                {details.map((n) => (
                  <li key={n.text}>{n.text}</li>
                ))}
                {v.serverBehind && (
                  <li>
                    <button onClick={refetch} className="inline-flex items-center gap-1.5 text-[12px] text-mute underline underline-offset-2 hover:text-fg">
                      <RefreshCw className="size-3" /> Check the server again
                    </button>
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      </AutoHeight>
    </Panel>
  );
}

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5 text-[13.5px] font-medium">
      <span className="grid size-5 place-items-center rounded-full bg-fg font-mono text-[10.5px] text-white">{n}</span>
      {children}
    </div>
  );
}

/**
 * A settled order: a calm closing block with what moved and the transaction that moved it. Facts only from the order
 * itself (its amounts and recorded transaction hashes).
 */
function Finished({ req, role }: { req: ApiRequest; role: Role }) {
  const ledger = ledgerFromRequest(req);
  const released = req.status === "released";
  const refunded = req.status === "refunded";
  const tx = released ? req.releaseTxHash : req.refundTxHash;
  const realTx = tx && !tx.startsWith("reconciled") ? tx : null;
  const rows: [string, string][] = released
    ? [
        [role === "buyer" ? "You were paid" : "Paid to the USDC buyer", `${usdt(ledger.buyerReceives)} USDC`],
        ["Voucher", inr(req.amountInr)],
        ...(ledger.fee > 0 ? ([["Fee", `${usdt(ledger.fee)} USDC`]] as [string, string][]) : []),
      ]
    : refunded || realTx
      ? [
          [role === "spender" ? "Returned to you" : "Returned to the voucher buyer", `${usdt(ledger.sellerLocks)} USDC`],
          ["Voucher", inr(req.amountInr)],
        ]
      : [["Voucher", inr(req.amountInr)]];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.slow, ease: EASE }} className="mt-5 overflow-hidden rounded-xl ring-1 ring-line" data-testid="finished">
      <div className={cx("flex items-center gap-3 px-4 py-3.5", released ? "bg-pos/10" : "bg-sunken")}>
        <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: DUR.slow, ease: EASE, delay: 0.05 }} className={cx("grid size-9 shrink-0 place-items-center rounded-full text-white", released ? "bg-pos" : "bg-fg")}>
          {released ? <CircleCheck className="size-5" /> : <Undo2 className="size-[18px]" />}
        </motion.span>
        <div className="min-w-0">
          <div className={cx("text-[14px] font-medium", released ? "text-pos-ink" : "text-fg")}>{released ? "Trade complete" : refunded ? "Refunded" : "Order closed"}</div>
          <div className="text-[12.5px] text-mute">{when(req.updatedAt) ?? "Settled"}</div>
        </div>
      </div>
      <dl className="divide-y divide-line px-4">
        {rows.map(([k, val], i) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
            <dt className="text-mute">{k}</dt>
            <dd className={cx("tabular", i === 0 ? "text-[15px] font-semibold" : "text-fg")}>{val}</dd>
          </div>
        ))}
      </dl>
      {realTx && (
        <a href={`${EXPLORER}/tx/${realTx}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12.5px] text-mute transition-colors hover:bg-sunken hover:text-fg">
          <span>
            {released ? "Release" : "Refund"} transaction on {ARC.name}
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[12px]" title={realTx}>
            {realTx.slice(0, 10)}… <ArrowUpRight className="size-3.5" />
          </span>
        </a>
      )}
    </motion.div>
  );
}

function useTick(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "Closes in 2 d 23 h": quiet until the last 15 minutes, amber then, red once passed. */
function LiveDeadline({ d, role }: { d: Deadline; role: Role }) {
  const now = useTick();
  const u = deadlineUrgency(d, now);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[12px] tabular", u === "over" ? "font-medium text-rose-ink" : u === "soon" ? "font-medium text-amber-ink" : "text-mute")} title={deadlineLine(d, role, now)}>
      <Clock className="size-3.5" /> {deadlineShort(d, role, now)}
    </span>
  );
}

/** The full deadline sentence with its exact time, for the Details disclosure. */
function DeadlineDetail({ d, role }: { d: Deadline; role: Role }) {
  const now = useTick();
  return (
    <li>
      {deadlineLine(d, role, now)}{" "}
      <span className="text-dim">
        ({new Date(d.at * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        {d.source === "server" ? ", NetPositive's clock" : ", on-chain"})
      </span>
    </li>
  );
}

/* ---------------------------------------------------------------- timeline */

function Timeline({ stages, viewer }: { stages: Stage[]; viewer: string }) {
  return (
    <details open className="panel group p-4 sm:p-5">
      <summary className="label flex w-fit cursor-pointer list-none items-center gap-1 select-none hover:text-fg">
        History <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <ol className="mt-4">
        {stages.map((st, i) => (
          <StageRow key={st.key} st={st} viewer={viewer} last={i === stages.length - 1} />
        ))}
      </ol>
    </details>
  );
}

/**
 * One compact row. Only what happened (or is really under way: a dispute, a payout being sent) is drawn in colour
 * with its detail; the next step and anything after it is grey, titled only, and never shown as "in progress".
 */
function StageRow({ st, viewer, last }: { st: Stage; viewer: string; last: boolean }) {
  const done = st.state === "done";
  const skipped = st.state === "skipped";
  // `buildStages` marks the first step still ahead as "current"; unless it has its own tone, nothing has happened yet.
  const active = st.state === "current" && st.tone !== "mint";
  const next = st.state === "current" && !active;
  const future = st.state === "upcoming" || next;
  const time = when(st.at);
  const mine = !!st.actor && sameAddr(st.actor, viewer);

  return (
    <li className="relative flex gap-3 pb-3.5 last:pb-0">
      {!last && <span className={cx("absolute top-6 bottom-0 left-[9.5px] w-px transition-colors duration-200", done ? "bg-brand/40" : "bg-line")} aria-hidden />}
      <span
        className={cx(
          "relative mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ring-1 transition-colors duration-200",
          done && "bg-brand text-white ring-brand",
          done && st.tone !== "mint" && TONE[st.tone],
          active && TONE[st.tone],
          future && "bg-surface text-dim ring-line-2",
          skipped && "bg-surface text-dim/60 ring-line",
        )}
      >
        {done ? <Check className="size-3" /> : skipped ? <Minus className="size-3" /> : active ? <span className={cx("size-1.5 rounded-full", TONE_DOT[st.tone])} /> : null}
      </span>
      <div className={cx("min-w-0 flex-1", skipped && "opacity-60")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className={cx("text-[13.5px] font-medium", future || skipped ? "text-mute" : "text-fg")}>
            {st.title}
            {next && <span className="ml-2 font-mono text-[9.5px] tracking-wider text-dim uppercase">next</span>}
            {skipped && <span className="ml-2 font-mono text-[9.5px] tracking-wider text-dim uppercase">didn't happen</span>}
          </div>
          {time && <time className="text-[11.5px] text-dim tabular" dateTime={st.at ?? undefined}>{time}</time>}
        </div>
        {!future && <p className="mt-0.5 text-[12.5px] leading-relaxed text-mute">{st.detail}</p>}
        {!future && st.facts.length > 0 && (
          <dl className="mt-1 space-y-0.5 text-[12px]">
            {st.facts.map((f) => (
              <div key={f.label} className="flex gap-2">
                <dt className="shrink-0 text-dim">{f.label}:</dt>
                <dd className="min-w-0 break-words text-fg/85">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {!future && (st.actor || st.tx) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim">
            {st.actor && (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono">{short(st.actor)}</span>
                {mine && <YouTag />}
              </span>
            )}
            {st.tx && !st.tx.startsWith("reconciled") && (
              <a href={`${EXPLORER}/tx/${st.tx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-fg">
                tx {st.tx.slice(0, 8)}… <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -4, height: 0 }}
      transition={{ duration: DUR.slow, ease: EASE }}
      className="overflow-hidden"
    >
    <div className={cx("flex items-start gap-3 rounded-2xl px-4 py-3 text-[13.5px] ring-1", TONE[notice.tone])}>
      <Check className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {notice.text}
        {notice.tx && !notice.tx.startsWith("reconciled") && (
          <a href={`${EXPLORER}/tx/${notice.tx}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-mono text-[12px] underline-offset-2 hover:underline">
            tx {notice.tx.slice(0, 8)}… <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>
      <button onClick={onClose} aria-label="Dismiss" className="-mt-0.5 -mr-1 grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-fg/5">
        <X className="size-3.5" />
      </button>
    </div>
    </motion.div>
  );
}

function YouTag() {
  return <span className="rounded-full bg-brand-soft px-1.5 py-px font-mono text-[9.5px] tracking-wider text-brand-ink uppercase ring-1 ring-brand/25">you</span>;
}

/* ------------------------------------------------------------ side panels */

function Money({ req, role, brandName }: { req: ApiRequest; role: Role; brandName: string }) {
  const rate = impliedRate(req);
  const voucher = `${inr(req.amountInr)} ${brandName} voucher`;
  const ledger = ledgerFromRequest(req);
  const amt = `${usdt(ledger.buyerReceives)} USDC`;
  const total = `${usdt(ledger.sellerLocks)} USDC`;
  const fee = ledger.fee > 0 ? `${usdt(ledger.fee)} USDC` : null;
  return (
    <Panel>
      <PanelHead label={role === "observer" ? "The trade" : "Your side of the trade"} />
      <div className="mt-2 divide-y divide-line">
        {role === "buyer" ? (
          <>
            <Row k="You buy" v={voucher} />
            <Row k="You are paid" v={amt} strong />
            {fee && <Row k="Fee (paid by the voucher buyer)" v={fee} />}
          </>
        ) : role === "spender" ? (
          <>
            <Row k="You get" v={voucher} />
            <Row k={req.status === "pending_funding" ? "You lock" : "You locked"} v={total} strong />
            <Row k="USDC buyer is paid" v={amt} />
            {fee && <Row k="Fee" v={fee} />}
          </>
        ) : (
          <>
            <Row k="Voucher" v={voucher} />
            <Row k="Voucher buyer locks" v={total} />
            <Row k="USDC buyer is paid" v={amt} strong />
            {fee && <Row k="Fee" v={fee} />}
          </>
        )}
        {rate && <Row k="Implied rate" v={`${inr(rate, 2)} / USDC`} />}
      </div>
    </Panel>
  );
}

function Parties({ req, viewer }: { req: ApiRequest; viewer: string }) {
  const rows: { label: string; addr: string | null }[] = [
    { label: "Voucher buyer", addr: req.crypto_spender },
    { label: "USDC buyer", addr: req.crypto_buyer },
  ];
  return (
    <Panel>
      <PanelHead label="Who's involved" />
      <div className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex min-h-11 items-center justify-between gap-3 py-1.5 text-[13.5px]">
            <span className="shrink-0 text-mute">{r.label}</span>
            {r.addr ? (
              <span className="flex min-w-0 items-center gap-1.5">
                {sameAddr(r.addr, viewer) && <YouTag />}
                <a href={`${EXPLORER}/address/${r.addr}`} target="_blank" rel="noreferrer" title={r.addr} className="inline-flex min-w-0 items-center gap-1 font-mono text-[12px] transition-colors hover:text-brand-ink">
                  <span className="truncate">{short(r.addr)}</span> <ArrowUpRight className="size-3 shrink-0" />
                </a>
                <CopyButton text={r.addr} label={`Copy ${r.label} address`} />
              </span>
            ) : (
              <span className="text-[12.5px] text-dim">Nobody yet</span>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Order and transaction references, inside the on-chain card's "How this was checked". */
function Technical({ req }: { req: ApiRequest }) {
  const txs = [
    ["Deposit", req.escrowTxHash],
    ["Release", req.releaseTxHash],
    ["Refund", req.refundTxHash],
  ].filter((t): t is [string, string] => !!t[1] && !t[1].startsWith("reconciled"));
  return (
    <div className="space-y-1.5 border-t border-line pt-2.5">
      <Kv k="Order ID" v={req.id} />
      <Kv k="Escrow ID" v={req.escrowId} />
      <Kv k="Network" v={`${ARC.name} (chain ${ARC.id})`} />
      <Kv k="Status code" v={req.status} />
      <Kv k="Created" v={when(req.createdAt) ?? "—"} />
      <Kv k="Last change" v={when(req.updatedAt) ?? "—"} />
      {txs.map(([k, h]) => (
        <div key={k} className="flex gap-3">
          <span className="w-20 shrink-0 text-dim">{k} tx</span>
          <a href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer" title={h} className="min-w-0 truncate font-mono text-fg/85 hover:text-brand-ink">
            {h}
          </a>
        </div>
      ))}
      {req.lastError && <Kv k="Last error" v={req.lastError} />}
    </div>
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
