import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, Clock, LoaderCircle, PenLine, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Aurora, BrandMark, Button, cx } from "../components/ui";
import { api, brandIdFromApi, isFinal, STATUS, STEPS, stepIndex, type ApiRequest, type ReqStatus } from "../lib/api";
import { brand } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";
import { useApp } from "../lib/store";

/** One row on the tracker, from the backend (Firestore `requests/{id}`) or this session. */
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
  live: boolean;
};

const fromApi = (r: ApiRequest, role: Row["role"]): Row => ({
  id: r.id,
  brandId: brandIdFromApi(r.brand),
  amountInr: r.amountInr,
  amountUsdc: Number(r.amountUsdc) || 0,
  status: r.status,
  role,
  createdAt: r.createdAt,
  deadline: r.status === "accepted" ? r.fulfilDeadline : r.status === "code_submitted" ? r.reviewDeadline : null,
  deadlineLabel: r.status === "accepted" ? "Buyer must submit code in" : "Auto-release in",
  tx: r.releaseTxHash ?? r.refundTxHash ?? r.escrowTxHash,
  live: true,
});

type Tab = "requester" | "fulfiller";

export default function Track() {
  const { token, signIn, signingIn, myOrders, address } = useApp();
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
    if (live) return tab === "requester" ? live.asCryptoSpender.map((r) => fromApi(r, "requester")) : live.asCryptoBuyer.map((r) => fromApi(r, "fulfiller"));
    return myOrders
      .filter((o) => o.role === tab)
      .map((o) => ({
        id: o.id,
        brandId: o.brandId,
        amountInr: o.amount,
        amountUsdc: tab === "requester" ? quote(o.amount, o.rate).sellerLocks : quote(o.amount, o.rate).buyerReceives,
        status: o.status,
        role: o.role,
        createdAt: o.createdAt,
        deadline: null,
        deadlineLabel: "",
        tx: null,
        live: false,
      }));
  }, [live, myOrders, tab]);

  const counts = {
    requester: live ? live.asCryptoSpender.length : myOrders.filter((o) => o.role === "requester").length,
    fulfiller: live ? live.asCryptoBuyer.length : myOrders.filter((o) => o.role === "fulfiller").length,
  };
  const active = rows.filter((r) => !isFinal(r.status)).length;

  return (
    <div className="relative pt-28 pb-10">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="label">Track</div>
            <h1 className="text-gradient mt-2 font-display text-4xl font-semibold tracking-[-0.03em]">Your orders</h1>
            <p className="mt-2 text-[14px] text-mute">{active ? `${active} in progress.` : "Nothing in progress."} Status updates every 10 seconds.</p>
          </div>
          <div className="flex items-center gap-2">
            {token ? (
              <button onClick={load} className="flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] text-mute ring-1 ring-white/10 hover:text-fg">
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
          <div className="mt-5 rounded-2xl bg-amber/[0.06] px-4 py-3 text-[13px] text-amber ring-1 ring-amber/25">
            {state === "offline" ? "The NetPositive backend isn't reachable, so only orders from this session are shown." : err}
          </div>
        )}
        {!token && (
          <p className="mt-4 text-[12.5px] text-dim">Showing orders from this session. Sign in with your wallet to load every order saved on NetPositive.</p>
        )}

        <div className="mt-6 flex gap-6 border-b border-white/[0.07] text-[13.5px]">
          {(
            [
              ["requester", "Created by me"],
              ["fulfiller", "Filling"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cx("relative pb-3 transition", tab === k ? "text-fg" : "text-mute hover:text-fg")}>
              {l} <span className="ml-1 font-mono text-[11px] text-dim">{counts[k]}</span>
              {tab === k && <motion.span layoutId="tracktab" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-mint" />}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {rows.map((r, i) => (
            <OrderCard key={r.id} r={r} delay={i * 0.04} token={token} onChanged={load} />
          ))}
          {rows.length === 0 && (
            <div className="hairline rounded-[24px] bg-ink-2/60 px-6 py-14 text-center">
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
  const tone = { mint: "text-mint bg-mint/10 ring-mint/25", amber: "text-amber bg-amber/10 ring-amber/25", iris: "text-iris bg-iris/10 ring-iris/25", rose: "text-rose bg-rose/10 ring-rose/25", mute: "text-mute bg-white/[0.04] ring-white/10" }[s.tone];
  const canCancel = r.live && r.role === "requester" && (r.status === "pending_funding" || r.status === "open") && token;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} className="hairline rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-4">
        <BrandMark id={r.brandId} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">
              {b.name} {inr(r.amountInr)}
            </span>
            <span className={cx("rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", tone)}>{s.label}</span>
            {!r.live && <span className="rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider text-dim uppercase ring-1 ring-white/10">this session</span>}
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
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]">
                <div className={cx("h-full transition-all duration-700", done ? "w-full bg-mint" : now ? "w-1/2 bg-mint/70" : "w-0", r.status === "disputed" && now && "bg-rose")} />
              </div>
              <div className={cx("mt-1.5 flex items-center gap-1 text-[11px]", done || now ? "text-fg/85" : "text-dim")}>
                {done && <Check className="size-3 text-mint" />}
                {st.label}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-mute">
          <span>{s.note}</span>
          {r.deadline && (
            <span className="flex items-center gap-1.5 text-amber">
              <Clock className="size-3.5" /> {r.deadlineLabel} <Countdown to={r.deadline} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {r.tx && !r.tx.startsWith("reconciled") && (
            <a href={`https://testnet.arcscan.app/tx/${r.tx}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono text-[11px] text-dim hover:text-fg">
              {r.tx.slice(0, 8)}… <ArrowUpRight className="size-3" />
            </a>
          )}
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
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-mute ring-1 ring-white/10 hover:text-rose hover:ring-rose/30 disabled:opacity-50"
            >
              {busy ? <LoaderCircle className="size-3 animate-spin" /> : <X className="size-3" />} {r.status === "open" ? "Cancel & refund" : "Cancel"}
            </button>
          )}
          {!r.live && (
            <Link to={`/trade/${r.id}`} className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.05] px-3 text-[12px] ring-1 ring-white/10 hover:bg-white/10">
              Open trade <ArrowRight className="size-3" />
            </Link>
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
