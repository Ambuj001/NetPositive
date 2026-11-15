import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Clock, Inbox, PenLine, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppHead, AppPage, BrandMark, Button, Callout, DUR, EASE, EmptyState, Pill, Skeleton, Spinner, cx, statusTone } from "../components/ui";
import { api, brandIdFromApi, isFinal, STATUS, type ApiRequest } from "../lib/api";
import { brand } from "../lib/data";
import { inr, usdt } from "../lib/engine";
import { recordAfterTx } from "../lib/afterTx";
import { stepError } from "../lib/escrowFlow";
import { ledgerFromRequest } from "../lib/orderbook";
import { deadlineLine, deadlineShort, deadlineUrgency, orderView, type Role } from "../lib/orderView";
import { useApp } from "../lib/store";
import TrackDetail from "./TrackDetail";

type Tab = "spender" | "buyer";
const POLL_MS = 10_000;


/** `/track` lists your orders. `/track?id=<order id>` opens one order in detail, from your side of it. */
export default function Track() {
  const [params] = useSearchParams();
  const id = params.get("id");
  if (id !== null) return <TrackDetail key={id} id={id.trim()} />;
  return <TrackList />;
}

function TrackList() {
  const { token, signIn, signingIn, address } = useApp();
  const [tab, setTab] = useState<Tab>("spender");
  const [live, setLive] = useState<{ asCryptoSpender: ApiRequest[]; asCryptoBuyer: ApiRequest[] } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "offline" | "error">("idle");
  const [err, setErr] = useState("");
  const [at, setAt] = useState<number | null>(null);
  const picked = useRef(false);

  const load = useCallback(async () => {
    if (!token) return;
    setState("loading");
    try {
      const next = await api.listMine(token);
      setLive(next);
      setAt(Date.now());
      setState("idle");
      // Open on the tab that has something to do, the first time.
      if (!picked.current) {
        picked.current = true;
        if (next.asCryptoSpender.length === 0 && next.asCryptoBuyer.length > 0) setTab("buyer");
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      setState(code === "offline" || code === "unreachable" ? "offline" : "error");
      setErr(e instanceof Error ? e.message : "Couldn't load orders");
    }
  }, [token]);

  // Every 10 s while the tab is visible, and right away when the window regains focus.
  useEffect(() => {
    void load();
    if (!token) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, token]);

  const rows = useMemo(() => {
    if (!live) return [];
    const list = tab === "spender" ? live.asCryptoSpender : live.asCryptoBuyer;
    // Live orders first, newest first within each group.
    return [...list].sort((a, b) => Number(isFinal(a.status)) - Number(isFinal(b.status)) || Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
  }, [live, tab]);

  const counts = { spender: live?.asCryptoSpender.length ?? 0, buyer: live?.asCryptoBuyer.length ?? 0 };
  const yourMove = live ? [...live.asCryptoSpender.map((r) => ({ r, role: "spender" as Role })), ...live.asCryptoBuyer.map((r) => ({ r, role: "buyer" as Role }))].filter(({ r, role }) => !isFinal(r.status) && orderView({ req: r, role, chain: { kind: "server-only" }, now: Date.now(), signedIn: true }).actor === "you").length : 0;

  return (
    <AppPage>
        <AppHead
          title="Your orders"
          sub={live ? (yourMove > 0 ? `${yourMove} need${yourMove === 1 ? "s" : ""} your move.` : "Nothing needs your move right now.") : "Orders you created or are filling."}
          right={
            token ? (
              <Button size="sm" variant="outline" onClick={() => void load()} icon={<RefreshCw className={cx("size-3.5 text-mute", state === "loading" && "animate-spin")} />}>
                <span className="tabular">{at ? `Updated ${new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Refresh"}</span>
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void signIn()} disabled={!address} pending={signingIn} icon={<PenLine className="size-3.5" />}>
                {signingIn ? "Check your wallet…" : "Sign in to load your orders"}
              </Button>
            )
          }
        />

        {(state === "offline" || state === "error") && (
          <Callout tone="amber" className="mt-4">
            {state === "offline" ? "The NetPositive backend isn't reachable, so your orders can't be shown right now. Nothing is lost: they are stored on the server and the escrow." : err}
          </Callout>
        )}
        {!token && <p className="mt-3 text-[13px] text-mute">{address ? "Sign in with this wallet to load your orders." : "Connect your wallet and sign in to load your orders."} To look at one order without signing in, open its link.</p>}

        <div className="scrollbar-none mt-5 flex gap-6 overflow-x-auto border-b border-line text-[13.5px]" role="tablist" aria-label="Your role">
          {(
            [
              ["spender", "Vouchers I'm buying with USDC"],
              ["buyer", "Vouchers I'm delivering for USDC"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("relative shrink-0 pb-3 whitespace-nowrap transition-colors duration-200", tab === k ? "text-fg" : "text-mute hover:text-fg")}>
              {l} <span className="ml-1 rounded-full bg-sunken px-1.5 py-px font-mono text-[11px] text-mute tabular">{counts[k]}</span>
              {tab === k && <motion.span layoutId="track-tab" transition={{ duration: DUR.slow, ease: EASE }} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
            </button>
          ))}
        </div>

        {token && !live && state !== "offline" && state !== "error" ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading your orders">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="panel space-y-3 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3.5 w-1/2" />
                <div className="flex justify-end">
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE }} className="mt-4 grid gap-3 lg:grid-cols-2">
            <AnimatePresence initial={false}>
              {rows.map((r) => (
                <motion.div key={r.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE }} className="flex">
                  <OrderCard r={r} role={tab} token={token} onChanged={() => void load()} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
        {rows.length === 0 && token && live && (
          <EmptyState
            icon={<Inbox />}
            title={tab === "spender" ? "No orders yet" : "You're not delivering any vouchers"}
            body={tab === "spender" ? "Create a voucher order and it shows up here." : "Take an order on Buy USDC and it shows up here."}
            action={
              <Button size="sm" to={tab === "spender" ? "/spend" : "/buy"} icon={<ArrowRight className="size-3.5" />}>
                {tab === "spender" ? "Pay with USDC" : "Buy USDC"}
              </Button>
            }
          />
        )}
    </AppPage>
  );
}

function OrderCard({ r, role, token, onChanged }: { r: ApiRequest; role: Role; token: string | null; onChanged: () => void }) {
  const b = brand(brandIdFromApi(r.brand));
  const s = STATUS[r.status];
  const [now, setNow] = useState(Date.now());
  const v = orderView({ req: r, role, chain: { kind: "server-only" }, now, signedIn: !!token, brandName: b.name });
  const ledger = ledgerFromRequest(r);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const final = isFinal(r.status);
  const urgency = v.deadline ? deadlineUrgency(v.deadline, now) : "calm";

  useEffect(() => {
    if (!v.deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [v.deadline]);

  return (
    <div className={cx("panel panel-hover flex w-full flex-col p-4 sm:p-5", v.actor === "you" && !final && "border-brand/30")}>
      <div className="flex items-start gap-3">
        <BrandMark id={brandIdFromApi(r.brand)} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold tabular">
              {b.name} {inr(r.amountInr)}
            </span>
            <Pill tone={statusTone(r.status, s.tone)} className="shrink-0">
              {s.label}
            </Pill>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-dim" title={r.id}>
            {r.id}
            {r.createdAt && ` · ${new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
          </div>
        </div>
      </div>

      {/* One headline, the amounts, one deadline line, one button. */}
      <div className={cx("mt-4 text-[14px] font-medium", v.actor === "you" && !final ? "text-brand-ink" : final ? "text-mute" : "text-fg")}>{v.headline}</div>
      <div className="mt-1 text-[12.5px] text-mute tabular">
        {role === "spender" ? (
          <>You lock <span className="font-medium text-fg">{usdt(ledger.sellerLocks)} USDC</span></>
        ) : (
          <>You are paid <span className="font-medium text-fg">{usdt(ledger.buyerReceives)} USDC</span></>
        )}
        {ledger.fee > 0 && <span className="text-dim"> · fee {usdt(ledger.fee)}</span>}
      </div>
      {v.deadline && !final && (
        <div title={deadlineLine(v.deadline, role, now)} className={cx("mt-1 flex items-center gap-1.5 text-[12.5px] tabular", urgency === "over" ? "text-rose-ink" : urgency === "soon" ? "text-amber-ink" : "text-mute")}>
          <Clock className="size-3 shrink-0" /> {deadlineShort(v.deadline, role, now)}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
        {v.actions.includes("cancelNoTx") && token && (
          <button
            disabled={busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setErr("");
              try {
                await recordAfterTx(() => api.cancel(r.id, token), { what: "cancel", tx: null, chainDone: false });
                onChanged();
              } catch (e) {
                setErr(stepError(e, "Couldn't cancel"));
              } finally {
                setBusy(false);
              }
            }}
            className="mr-auto flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-mute ring-1 ring-line transition-colors hover:bg-sunken hover:text-fg disabled:opacity-50"
          >
            {busy ? <Spinner /> : <X className="size-3.5" />} Cancel
          </button>
        )}
        <Button size="sm" variant={v.actor === "you" && !final ? "primary" : "outline"} to={`/track?id=${encodeURIComponent(r.id)}`} icon={<ArrowRight className="size-3.5" />}>
          {v.actor === "you" && !final ? "Open and act" : "Open"}
        </Button>
      </div>
      {err && <Callout role="alert" tone="rose" className="mt-3">{err}</Callout>}
    </div>
  );
}
