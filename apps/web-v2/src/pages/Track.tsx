import { ArrowRight, Clock, LoaderCircle, PenLine, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppHead, AppPage, BrandMark, Button, cx } from "../components/ui";
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

const TONE = { mint: "text-brand-ink bg-brand/10 ring-brand/25", amber: "text-amber-ink bg-amber/10 ring-amber/25", iris: "text-iris bg-iris/10 ring-iris/25", rose: "text-rose-ink bg-rose/10 ring-rose/25", mute: "text-mute bg-fg/[0.04] ring-fg/10" } as const;

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
              <button onClick={() => void load()} className="flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] text-mute ring-1 ring-fg/10 hover:text-fg">
                <RefreshCw className={cx("size-3.5", state === "loading" && "animate-spin")} /> {at ? `Updated ${new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Refresh"}
              </button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void signIn()} disabled={signingIn || !address} icon={signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}>
                {signingIn ? "Check your wallet…" : "Sign in to load your orders"}
              </Button>
            )
          }
        />

        {(state === "offline" || state === "error") && (
          <div className="mt-4 rounded-2xl bg-amber/[0.06] px-4 py-3 text-[13px] text-amber-ink ring-1 ring-amber/25">
            {state === "offline" ? "The NetPositive backend isn't reachable, so your orders can't be shown right now. Nothing is lost: they are stored on the server and the escrow." : err}
          </div>
        )}
        {!token && <p className="mt-3 text-[12.5px] text-dim">{address ? "Sign in with this wallet to load your orders." : "Connect your wallet and sign in to load your orders."} To look at one order without signing in, open its link.</p>}

        <div className="mt-5 flex gap-6 border-b border-fg/[0.07] text-[13.5px]">
          {(
            [
              ["spender", "Vouchers I'm buying with USDC"],
              ["buyer", "Vouchers I'm delivering for USDC"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cx("relative pb-2.5 transition", tab === k ? "text-fg" : "text-mute hover:text-fg")}>
              {l} <span className="ml-1 font-mono text-[11px] text-dim">{counts[k]}</span>
              {tab === k && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {rows.map((r) => (
            <OrderCard key={r.id} r={r} role={tab} token={token} onChanged={() => void load()} />
          ))}
        </div>
        {rows.length === 0 && token && (
          <div className="hairline mt-1 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-surface/60 px-5 py-4">
            <div>
              <div className="text-[14px] font-medium">{tab === "spender" ? "No orders yet" : "You're not delivering any vouchers"}</div>
              <p className="text-[12.5px] text-mute">{tab === "spender" ? "Create a voucher order and it shows up here." : "Take an order on Buy USDC and it shows up here."}</p>
            </div>
            <Button size="sm" to={tab === "spender" ? "/spend" : "/buy"} icon={<ArrowRight className="size-3.5" />}>
              {tab === "spender" ? "Pay with USDC" : "Buy USDC"}
            </Button>
          </div>
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
    <div className={cx("hairline flex flex-col rounded-[18px] bg-surface/70 p-4", final && "opacity-80")}>
      <div className="flex items-center gap-3">
        <BrandMark id={brandIdFromApi(r.brand)} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14.5px] font-semibold">
              {b.name} {inr(r.amountInr)}
            </span>
            <span className={cx("rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", TONE[s.tone])}>{s.label}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-dim">
            {r.id}
            {r.createdAt && ` · ${new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
          </div>
        </div>
      </div>

      {/* One headline, the amounts, one deadline line, one button. */}
      <div className={cx("mt-3 text-[13.5px] font-medium", v.actor === "you" && !final ? "text-brand-ink" : "text-fg")}>{v.headline}</div>
      <div className="mt-1 text-[12px] text-mute tabular">
        {role === "spender" ? (
          <>You lock <span className="font-medium text-fg">{usdt(ledger.sellerLocks)} USDC</span></>
        ) : (
          <>You are paid <span className="font-medium text-fg">{usdt(ledger.buyerReceives)} USDC</span></>
        )}
        {ledger.fee > 0 && <span className="text-dim"> · fee {usdt(ledger.fee)}</span>}
      </div>
      {v.deadline && !final && (
        <div title={deadlineLine(v.deadline, role, now)} className={cx("mt-1 flex items-center gap-1.5 text-[12px]", urgency === "over" ? "text-rose-ink" : urgency === "soon" ? "text-amber-ink" : "text-mute")}>
          <Clock className="size-3 shrink-0" /> {deadlineShort(v.deadline, role, now)}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-3">
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
            className="mr-auto flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-mute hover:bg-sunken hover:text-fg disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="size-3 animate-spin" /> : <X className="size-3" />} Cancel
          </button>
        )}
        <Link to={`/track?id=${encodeURIComponent(r.id)}`} className={cx("flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] ring-1", v.actor === "you" && !final ? "bg-brand text-white ring-brand" : "bg-fg/[0.05] ring-fg/10 hover:bg-fg/10")}>
          {v.actor === "you" && !final ? "Open and act" : "Open"} <ArrowRight className="size-3" />
        </Link>
      </div>
      {err && <p role="alert" className="mt-2 text-[12px] text-rose-ink">{err}</p>}
    </div>
  );
}
