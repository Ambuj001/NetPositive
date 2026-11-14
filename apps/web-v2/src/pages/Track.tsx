import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, Clock, LoaderCircle, PenLine, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Aurora, BrandMark, Button, cx } from "../components/ui";
import { api, brandIdFromApi, isFinal, STATUS, STEPS, stepIndex, type ApiRequest, type ReqStatus } from "../lib/api";
import { ARC } from "../lib/chain";
import { brand } from "../lib/data";
import { inr, usdt } from "../lib/engine";
import { useApp } from "../lib/store";
import TrackDetail from "./TrackDetail";

/** One row on the tracker, from the backend (Firestore `requests/{id}`). */
type Row = {
  id: string;
  brandId: string;
  amountInr: number;
  amountUsdc: number;
  status: ReqStatus;
  role: "requester" | "fulfiller";
  createdAt: string | null;
  deadline: string | null;
  deadlineLabel: string;
  tx: string | null;
};

const fromApi = (r: ApiRequest, role: Row["role"]): Row => ({
  id: r.id,
  brandId: brandIdFromApi(r.brand),
  amountInr: r.amountInr,
  // The spender sees what left their wallet (amount + fee); the buyer sees what they are paid.
  amountUsdc: role === "requester" && r.totalUsdcBaseUnits && /^\d+$/.test(r.totalUsdcBaseUnits) ? Number(r.totalUsdcBaseUnits) / 1e6 : Number(r.amountUsdc) || 0,
  status: r.status,
  role,
  createdAt: r.createdAt,
  deadline: r.status === "accepted" ? r.fulfilDeadline : r.status === "code_submitted" ? r.reviewDeadline : null,
  deadlineLabel: r.status === "accepted" ? "Buyer must submit code in" : "Review window ends in",
  tx: r.releaseTxHash ?? r.refundTxHash ?? r.escrowTxHash,
});

type Tab = "requester" | "fulfiller";

/** `/track` lists your orders. `/track?id=<order id>` opens one order in detail, from your side of it. */
export default function Track() {
  const [params] = useSearchParams();
  const id = params.get("id");
  if (id !== null) return <TrackDetail key={id} id={id.trim()} />;
  return <TrackList />;
}

function TrackList() {
  const { token, signIn, signingIn, address } = useApp();
  const [tab, setTab] = useState<Tab>("requester");
  const [live, setLive] = useState<{ asCryptoSpender: ApiRequest[]; asCryptoBuyer: ApiRequest[] } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "offline" | "error">("idle");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setState("loading");
    try {
      setLive(await api.listMine(token));
      setState("idle");
    } catch (e) {
      const code = (e as { code?: string }).code;
      setState(code === "offline" || code === "unreachable" ? "offline" : "error");
      setErr(e instanceof Error ? e.message : "Couldn't load orders");
    }
  }, [token]);

  // Poll so status changes in Firestore show up without a reload.
  useEffect(() => {
    load();
    if (!token) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, token]);

  const rows: Row[] = useMemo(() => {
    // Orders come from the server only. Nothing is kept or invented on this device.
    if (!live) return [];
    return tab === "requester" ? live.asCryptoSpender.map((r) => fromApi(r, "requester")) : live.asCryptoBuyer.map((r) => fromApi(r, "fulfiller"));
  }, [live, tab]);

  const counts = {
    requester: live ? live.asCryptoSpender.length : 0,
    fulfiller: live ? live.asCryptoBuyer.length : 0,
  };
  const active = rows.filter((r) => !isFinal(r.status)).length;

  return (
    <div className="relative pt-10 md:pt-14 pb-10">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-[1200px] px-5 md:px-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="label">Track</div>
            <h1 className="text-gradient mt-2 font-display text-4xl font-semibold tracking-[-0.03em]">Your orders</h1>
            {active > 0 && <p className="mt-2 text-[14px] text-mute">{active} in progress.</p>}
          </div>
          <div className="flex items-center gap-2">
            {token ? (
              <button onClick={load} className="flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] text-mute ring-1 ring-fg/10 hover:text-fg">
                <RefreshCw className={cx("size-3.5", state === "loading" && "animate-spin")} /> Refresh
              </button>
            ) : (
              <Button size="sm" variant="outline" onClick={signIn} disabled={signingIn || !address} icon={signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}>
                {signingIn ? "Check your wallet…" : "Sign in to load saved orders"}
              </Button>
            )}
          </div>
        </div>

        {(state === "offline" || state === "error") && (
          <div className="mt-5 rounded-2xl bg-amber/[0.06] px-4 py-3 text-[13px] text-amber-ink ring-1 ring-amber/25">
            {state === "offline" ? "The NetPositive backend isn't reachable, so your orders can't be shown right now. Nothing is lost: they are stored on the server and the escrow." : err}
          </div>
        )}
        {!token && (
          <p className="mt-4 text-[12.5px] text-dim">Sign in with your wallet to load your orders. To look at one order without signing in, open its link or use its ID.</p>
        )}

        <div className="mt-6 flex gap-6 border-b border-fg/[0.07] text-[13.5px]">
          {(
            [
              ["requester", "Created by me"],
              ["fulfiller", "Filling"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cx("relative pb-3 transition", tab === k ? "text-fg" : "text-mute hover:text-fg")}>
              {l} <span className="ml-1 font-mono text-[11px] text-dim">{counts[k]}</span>
              {tab === k && <motion.span layoutId="tracktab" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {rows.map((r, i) => (
            <OrderCard key={r.id} r={r} delay={i * 0.04} token={token} onChanged={load} />
          ))}
          {rows.length === 0 && (
            <div className="hairline rounded-[24px] bg-surface/60 px-6 py-14 text-center">
              <div className="text-[15px] font-medium">{tab === "requester" ? "No orders yet" : "You're not filling any orders"}</div>
              <p className="mt-1 text-[13px] text-mute">{tab === "requester" ? "Create a voucher request and it will show up here." : "Accept an order on Buy and it will show up here."}</p>
              <Button className="mt-5" size="sm" to={tab === "requester" ? "/spend" : "/buy"} icon={<ArrowRight className="size-3.5" />}>
                {tab === "requester" ? "Spend USDC" : "Buy USDC"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderCard({ r, delay, token, onChanged }: { r: Row; delay: number; token: string | null; onChanged: () => void }) {
  const b = brand(r.brandId);
  const s = STATUS[r.status];
  const idx = stepIndex(r.status);
  const off = r.status === "cancelled" || r.status === "refunded" || r.status === "refunding";
  const [busy, setBusy] = useState(false);
  const tone = { mint: "text-brand-ink bg-brand/10 ring-brand/25", amber: "text-amber-ink bg-amber/10 ring-amber/25", iris: "text-iris bg-iris/10 ring-iris/25", rose: "text-rose-ink bg-rose/10 ring-rose/25", mute: "text-mute bg-fg/[0.04] ring-fg/10" }[s.tone];
  // An order with no deposit can be cancelled right here. A funded one needs a wallet transaction, so that lives on its page.
  const canCancel = r.role === "requester" && r.status === "pending_funding" && token;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="hairline rounded-[22px] bg-surface/70 p-5 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-4">
        <BrandMark id={r.brandId} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">
              {b.name} {inr(r.amountInr)}
            </span>
            <span className={cx("rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", tone)}>{s.label}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-dim">
            {r.id}
            {r.createdAt && ` · ${new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11.5px] text-mute">{r.role === "requester" ? "Locked" : "You receive"}</div>
          <div className="text-[15px] font-semibold tabular">{usdt(r.amountUsdc)} USDC</div>
        </div>
      </div>

      {/* progress */}
      <div className="mt-5 grid grid-cols-5 gap-2">
        {STEPS.map((st, i) => {
          const done = !off && (i < idx || r.status === "released");
          const now = !off && !done && i <= idx + 0.5 && i >= idx;
          return (
            <div key={st.key}>
              <div className="h-1 overflow-hidden rounded-full bg-fg/[0.07]">
                <div className={cx("h-full transition-all duration-700", done ? "w-full bg-brand" : now ? "w-1/2 bg-brand/70" : "w-0", r.status === "disputed" && now && "bg-rose")} />
              </div>
              <div className={cx("mt-1.5 flex items-center gap-1 text-[11px]", done || now ? "text-fg/85" : "text-dim")}>
                {done && <Check className="size-3 text-brand-ink" />}
                {st.label}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-fg/[0.06] pt-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-mute">
          <span>{s.note}</span>
          {r.deadline && (
            <span className="flex items-center gap-1.5 text-amber-ink">
              <Clock className="size-3.5" /> {r.deadlineLabel} <Countdown to={r.deadline} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {r.tx && !r.tx.startsWith("reconciled") && (
            <a href={`${ARC.explorer}/tx/${r.tx}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[11px] text-dim hover:text-fg">
              {r.tx.slice(0, 8)}… <ArrowUpRight className="size-3" />
            </a>
          )}
          <Link to={`/track?id=${encodeURIComponent(r.id)}`} className="flex h-8 items-center gap-1.5 rounded-full bg-fg/[0.05] px-3 text-[12px] ring-1 ring-fg/10 hover:bg-fg/10">
            {r.role === "requester" && r.status === "open" ? "Details · cancel" : "Details"} <ArrowRight className="size-3" />
          </Link>
          {canCancel && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.cancel(r.id, token!);
                  onChanged();
                } finally {
                  setBusy(false);
                }
              }}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-mute ring-1 ring-fg/10 hover:text-rose-ink hover:ring-rose/30 disabled:opacity-50"
            >
              {busy ? <LoaderCircle className="size-3 animate-spin" /> : <X className="size-3" />} Cancel
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((Date.parse(to) - now) / 1000));
  return <span className="font-mono tabular">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}
