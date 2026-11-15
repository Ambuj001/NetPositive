import { ArrowUpRight, CircleAlert, ExternalLink, FingerprintPattern, PenLine, RefreshCw, ShieldOff, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppHead, AppPage, BrandMark, Button, Callout, Dialog, Pill, Row, Skeleton, cx, enter } from "../components/ui";
import { motion } from "motion/react";
import { adminApi, useIsAdmin, type AdminOverview } from "../lib/admin";
import { FINISHED_STATUSES, LIVE_STATUSES, WORLD_ID_STATE_LINE, capUsage, changedLine, explorerFor, networkName, orderTotals, rateCheckLine, shortAddress, switchConfirm } from "../lib/adminView";
import { ApiError, STATUS, brandIdFromApi } from "../lib/api";
import { brand } from "../lib/data";
import { categoryLabel } from "../lib/dispute";
import { displayTerms } from "../lib/displayTerms";
import { useApp } from "../lib/store";
import { parseTerms } from "../lib/terms";
import { usePageTitle } from "../lib/usePageTitle";
import { useWorldId } from "../lib/world";

const REFRESH_MS = 30_000;
const box = "panel p-4 sm:p-5";
const count = (n: number) => n.toLocaleString("en-US");

/**
 * /admin: the World ID switch, the escrow's settings, order counts, open disputes and the server's health.
 * Shown only to administrator wallets; the server checks the wallet on every admin route, so this page hides, never guards.
 */
export default function AdminPage() {
  usePageTitle("Admin", "Administrator dashboard.");
  return (
    <AppPage>
      <AdminGate>{(token) => <Dashboard token={token} />}</AdminGate>
    </AppPage>
  );
}

/* ------------------------------------------------------------------ gate */

function AdminGate({ children }: { children: (token: string) => ReactNode }) {
  const { fullAddress, token, signIn, signingIn, openWallet } = useApp();
  const { admin, checked } = useIsAdmin();
  const head = <AppHead title="Administration" />;
  if (!fullAddress || !token)
    return (
      <>
        {head}
        <p className="mt-3 text-[13.5px] text-mute">Connect an administrator wallet and sign in to see this page.</p>
        <div className="mt-5">
          {!fullAddress ? (
            <Button variant="outline" onClick={openWallet} icon={<Wallet className="size-4" />}>
              Connect wallet
            </Button>
          ) : (
            <Button variant="outline" onClick={signIn} pending={signingIn} icon={<PenLine className="size-4" />}>
              {signingIn ? "Check your wallet…" : "Sign in"}
            </Button>
          )}
        </div>
      </>
    );
  if (!checked)
    return (
      <>
        {head}
        <Loading>Checking this wallet…</Loading>
      </>
    );
  if (!admin) return <NotAdmin />;
  return <>{children(token)}</>;
}

function NotAdmin() {
  return (
    <>
      <AppHead title="Administration" />
      <div className={cx(box, "mt-5 flex max-w-2xl items-start gap-3")} data-testid="admin-denied">
        <ShieldOff className="mt-0.5 size-5 shrink-0 text-mute" />
        <div className="min-w-0 text-[14px] leading-relaxed text-mute">
          <div className="font-medium text-fg">This page is for administrators</div>
          The connected wallet isn't one of them. <Link to="/trade" className="link text-fg">Back to trading</Link>
        </div>
      </div>
    </>
  );
}

/** The dashboard's shape while it loads. */
function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label={typeof children === "string" ? children : undefined}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cx(box, "space-y-3", i === 0 && "lg:col-span-2")}>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function Notice({ children, tone = "rose" }: { children: ReactNode; tone?: "rose" | "amber" }) {
  return (
    <Callout role="alert" tone={tone} icon={<CircleAlert />}>
      {children}
    </Callout>
  );
}

function Section({ title, sub, children, id, className }: { title: string; sub?: ReactNode; children: ReactNode; id: string; className?: string }) {
  return (
    <section aria-labelledby={`${id}-title`} className={cx(box, "flex flex-col", className)}>
      <h2 id={`${id}-title`} className="text-[17px] font-semibold tracking-[-0.02em]">
        {title}
      </h2>
      {sub && <p className="mt-1 text-[13px] leading-relaxed text-mute">{sub}</p>}
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

/** Long values (addresses, lists) wrap instead of pushing the page sideways on a phone. */
function Val({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span className={cx("min-w-0 break-all text-right", mono && "font-mono text-[12px]")}>{children}</span>;
}

/* ------------------------------------------------------------- dashboard */

function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      setData(await adminApi.overview(token));
      setError("");
      setAt(Date.now());
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setError(e instanceof Error ? e.message : "Couldn't load the overview.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const tick = () => document.visibilityState === "visible" && void load();
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  if (denied) return <NotAdmin />;

  return (
    <>
      <AppHead
        title="Administration"
        sub="Access control, the escrow's settings, orders, disputes and the server's health. Refreshes every 30 seconds while this tab is open."
        right={
          <>
            {at && <span className="text-[12px] text-mute tabular">Updated {new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} icon={<RefreshCw className={cx("size-3.5", loading && "animate-spin")} />}>
              Refresh
            </Button>
          </>
        }
      />
      {error && (
        <div className="mt-5">
          <Notice>{error}</Notice>
        </div>
      )}
      {!data && !error && <Loading>Loading the overview…</Loading>}
      {data && (
        <motion.div {...enter} className="mt-5 grid items-start gap-4 lg:grid-cols-2">
          <WorldIdSection data={data} token={token} onChanged={(settings) => setData((d) => (d ? { ...d, settings } : d))} />
          <ContractSection data={data} />
          <HealthSection data={data} />
          <OrdersSection data={data} />
          <DisputesSection data={data} />
        </motion.div>
      )}
    </>
  );
}

/* ------------------------------------------------- 1. World ID requirement */

function WorldIdSection({ data, token, onChanged }: { data: AdminOverview; token: string; onChanged: (s: AdminOverview["settings"]) => void }) {
  const { refreshConfig } = useWorldId();
  const on = data.settings.worldIdRequired;
  const [asking, setAsking] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const confirm = asking === null ? null : switchConfirm(asking);
  // Keeps the dialog's words while it closes, so they don't blank out during the exit fade.
  const lastConfirm = useRef(confirm);
  if (confirm) lastConfirm.current = confirm;
  const shown = confirm ?? lastConfirm.current;
  const w = data.worldId;

  async function apply(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const { settings } = await adminApi.setWorldIdRequired(next, token);
      onChanged(settings);
      setAsking(null);
      // This browser picks up the new setting at once; others do on their next read of /world-id/config.
      void refreshConfig();
    } catch (e) {
      // 409 world_id_not_ready carries the server's reason in its message.
      setError(e instanceof Error ? e.message : "Couldn't change the setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section id="world-id" title="Access control: World ID requirement" className="lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Require World ID"
            disabled={saving}
            onClick={() => {
              setError("");
              setAsking(!on);
            }}
            className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50", on ? "bg-brand" : "bg-sunken-2 ring-1 ring-line-2")}
            data-testid="world-id-switch"
          >
            <span className={cx("absolute top-1 size-5 rounded-full bg-white shadow transition-[left] duration-200 ease-out-np", on ? "left-6" : "left-1")} />
          </button>
          <div className="min-w-0">
            <div className="text-[15px] font-medium">World ID is {on ? "required" : "off"}</div>
            <div className="text-[12.5px] text-mute">{changedLine(data.settings)}</div>
          </div>
        </div>
        <Pill tone={on ? "mint" : "amber"}>{on ? "On" : "Off"}</Pill>
      </div>

      <ul className="mt-4 space-y-1.5 text-[13px] leading-relaxed">
        <li className={on ? "text-fg" : "text-mute"}>{WORLD_ID_STATE_LINE.on}</li>
        <li className={!on ? "text-fg" : "text-mute"}>{WORLD_ID_STATE_LINE.off}</li>
      </ul>

      <Dialog
        open={!!confirm}
        onClose={() => setAsking(null)}
        dismissible={!saving}
        icon={<FingerprintPattern />}
        title={shown?.title ?? ""}
        description={shown?.body}
        testId="world-id-confirm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="dark" onClick={() => void apply(asking!)} pending={saving}>
              {shown?.cta}
            </Button>
          </>
        }
      >
        {error && <Notice>{error}</Notice>}
      </Dialog>
      {error && !confirm && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="font-medium">World ID on the server</span>
          <Pill tone={w.ready ? "mint" : "amber"}>{w.ready ? "Ready" : "Not ready"}</Pill>
          <Pill>{w.environment}</Pill>
          {w.mock && <Pill tone="amber">Mock proofs</Pill>}
          {w.bypass && <Pill tone="amber">Dev bypass</Pill>}
        </div>
        {w.problem && <p className="mt-2 text-[13px] leading-relaxed text-amber-ink">{w.problem}</p>}
        <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
          To enable World ID, set the app id, RP id and signing key on the server (WORLD_ID_APP_ID, WORLD_ID_RP_ID, WORLD_ID_SIGNING_KEY), then switch it on here.
        </p>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- 2. escrow contract */

function ContractSection({ data }: { data: AdminOverview }) {
  const terms = useMemo(() => parseTerms(data.terms), [data.terms]);
  const v = displayTerms(terms);
  const explorer = terms ? explorerFor(terms.chainId) : null;
  const cap = terms ? capUsage(terms.locked, terms.cap) : null;
  return (
    <Section
      id="contract"
      title="Escrow contract"
      sub={
        <>
          These are changed from the owner wallet on the contract, not here. <Link to="/docs#safety" className="link text-fg">What the owner can change</Link>
        </>
      }
    >
      {!terms ? (
        <Notice tone="amber">The server couldn't read the contract's terms just now.</Notice>
      ) : (
        <>
          <div className="divide-y divide-line">
            <Row k="Network" v={networkName(terms.chainId)} />
            <Row
              k="Contract"
              v={
                terms.contract ? (
                  explorer ? (
                    <a href={`${explorer}/address/${terms.contract}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] hover:underline">
                      {shortAddress(terms.contract)} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <Val mono>{terms.contract}</Val>
                  )
                ) : (
                  "Simulated escrow (no contract)"
                )
              }
            />
            <Row k="Fee" v={v.fee} />
            <Row k="Order limits" v={`${v.min} to ${v.max} USDC`} />
            <Row k="Dispute stake" v={v.hasStake ? `${v.stake} USDC` : "None"} />
            <Row k="Review window" v={v.review} />
            <Row k="Fulfil window" v={v.fulfil} />
            {v.orderOpen && <Row k="Open orders wait" v={v.orderOpen} />}
            <Row k="New deposits" v={terms.paused ? <Pill tone="rose">Paused</Pill> : <Pill tone="mint">Open</Pill>} />
          </div>
          {cap && (
            <div className="mt-4">
              <div className="flex flex-wrap justify-between gap-x-3 text-[13px]">
                <span className="text-mute">Launch cap used</span>
                <span className="tabular">{cap.text}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={cap.pct} aria-label="Launch cap used">
                <div className={cx("h-full rounded-full", cap.full ? "bg-rose" : cap.pct >= 80 ? "bg-amber" : "bg-brand")} style={{ width: `${cap.pct}%` }} />
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------- 3. orders */

function OrdersSection({ data }: { data: AdminOverview }) {
  const t = orderTotals(data.orders);
  const group = (title: string, total: number, list: readonly (keyof typeof STATUS)[]) => (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{title}</span>
        <span className="font-semibold tabular">{count(total)}</span>
      </div>
      <div className="mt-1 divide-y divide-line">
        {list.map((s) => (
          <Row key={s} k={STATUS[s].label} v={count(t.count(s))} className="py-2" />
        ))}
      </div>
    </div>
  );
  return (
    <Section id="orders" title="Orders" sub={`${count(t.total)} order${t.total === 1 ? "" : "s"} in all.`}>
      <div className="grid gap-6 sm:grid-cols-2">
        {group("In progress", t.live, LIVE_STATUSES)}
        {group("Finished", t.finished, FINISHED_STATUSES)}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ 4. disputes */

function DisputesSection({ data }: { data: AdminOverview }) {
  const list = data.disputes;
  return (
    <Section id="disputes" title="Open disputes" sub={list.length ? `${count(list.length)} waiting for a ruling.` : undefined}>
      {!list.length ? (
        <p className="text-[13.5px] text-mute">No open disputes.</p>
      ) : (
        <div className="space-y-2">
          {list.map((d) => {
            const id = brandIdFromApi(d.brand);
            const at = d.disputedAt ? Date.parse(d.disputedAt) : NaN;
            return (
              <Link key={d.id} to={`/dispute/${encodeURIComponent(d.id)}`} className="flex items-center gap-3 rounded-xl p-3 ring-1 ring-line transition-colors hover:bg-sunken">
                <BrandMark id={id} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {brand(id).name} · {d.amountUsdc} USDC
                  </span>
                  <span className="block truncate text-[12px] text-mute">
                    {categoryLabel(d.category)}
                    {Number.isFinite(at) ? ` · ${new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </span>
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-dim" />
              </Link>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------- 5. server health */

function HealthSection({ data }: { data: AdminOverview }) {
  const { keeper, server } = data;
  const explorer = explorerFor(server.chainId);
  return (
    <Section id="health" title="Server health">
      {keeper?.low && (
        <div className="mb-3">
          <Notice tone="amber">The keeper's gas balance is low ({keeper.gasUsdc ?? "?"} USDC). Top up with USDC on Arc so timeouts keep being sent.</Notice>
        </div>
      )}
      <div className="divide-y divide-line">
        <Row
          k="Keeper"
          v={
            keeper ? (
              explorer ? (
                <a href={`${explorer}/address/${keeper.address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] hover:underline">
                  {shortAddress(keeper.address)} <ExternalLink className="size-3" />
                </a>
              ) : (
                <Val mono>{keeper.address}</Val>
              )
            ) : (
              "Not running (mock escrow or no keeper key)"
            )
          }
        />
        {keeper && <Row k="Keeper gas" v={keeper.gasUsdc === null ? "Couldn't read" : `${keeper.gasUsdc} USDC`} />}
        <Row k="Arbiter key" v={data.arbiterKeyOnServer ? "On the server" : "Not on the server: rulings are sent from the arbiter wallet"} />
        <Row k="Escrow mode" v={server.escrowMode} />
        <Row k="Voucher mode" v={server.voucherMode} />
        <Row k="Rate check" v={rateCheckLine(server.rateCheckPct)} />
        <Row k="Environment" v={server.env} />
        <div className="flex items-start justify-between gap-4 py-2.5 text-[13.5px]">
          <span className="shrink-0 text-mute">Administrators</span>
          <span className="flex min-w-0 flex-col items-end gap-0.5">
            {server.admins.length ? server.admins.map((a) => <Val key={a} mono>{a}</Val>) : <span className="text-mute">None</span>}
          </span>
        </div>
      </div>
    </Section>
  );
}
