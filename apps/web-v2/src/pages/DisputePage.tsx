import { ArrowLeft, ArrowUpRight, CircleAlert, ImagePlus, LoaderCircle, PenLine, ShieldAlert, ShieldCheck, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AppHead, AppPage, BrandMark, Button, Callout, EmptyState, Panel, Pill, Skeleton, Stepper, cx, enter } from "../components/ui";
import { motion } from "motion/react";
import { STATUS, api, brandIdFromApi, type ApiRequest } from "../lib/api";
import { brand } from "../lib/data";
import {
  CATEGORIES,
  MAX_SHOTS,
  REASON_MAX,
  REASON_MIN,
  SHOT_TYPES,
  categoryLabel,
  disputeApi,
  disputeError,
  prepareShot,
  type Bond,
  type Category,
  type DisputeRequest,
  type Evidence,
} from "../lib/dispute";
import { disputerOf, hasDispute, outcomeLine, roleIn, screenFor, stakeLine, stakeNotice } from "../lib/disputeView";
import { usdcShort } from "../lib/terms";
import { useTerms } from "../lib/useTerms";
import { inr, usdt } from "../lib/engine";
import { MOCK_NOTE, sendEscrowStep } from "../lib/escrowFlow";
import { useApp } from "../lib/store";

const SHOT_WARNING = "Screenshots can show the voucher code. Only the two of you and the team can see them, but crop anything you don't need.";
const field = "field px-3.5";

/** /dispute lists your orders that can be disputed or are disputed. /dispute/:id is one order. */
export default function DisputePage() {
  const { id } = useParams();
  return (
    <AppPage>
      {/* One dispute reads as a single column of text and forms, so it keeps a readable width inside the shared frame. */}
      {id ? (
        <OrderDispute id={id} />
      ) : (
        <DisputeList />
      )}
    </AppPage>
  );
}

/* ------------------------------------------------------------------ gate */

/** Needs a connected wallet and a signed-in session. Renders children once both are there. */
function SignedIn({ children }: { children: (token: string) => ReactNode }) {
  const { fullAddress, token, signIn, signingIn, openWallet } = useApp();
  if (!fullAddress)
    return (
      <Button variant="outline" onClick={openWallet} icon={<Wallet className="size-4" />}>
        Connect wallet
      </Button>
    );
  if (!token)
    return (
      <Button variant="outline" onClick={signIn} pending={signingIn} icon={<PenLine className="size-4" />}>
        {signingIn ? "Check your wallet…" : "Sign in"}
      </Button>
    );
  return <>{children(token)}</>;
}

function Notice({ children, tone = "rose" }: { children: ReactNode; tone?: "rose" | "mint" | "pos" }) {
  return (
    <Callout role="alert" tone={tone} icon={tone === "rose" ? <CircleAlert /> : <ShieldCheck />}>
      {children}
    </Callout>
  );
}

/* ------------------------------------------------------------------ list */

function DisputeList() {
  const listTerms = useTerms().terms;
  return (
    <>
      <AppHead
        title="Disputes"
        sub={
          <>
            Something wrong with a voucher code? As the voucher buyer you can freeze the escrow from your wallet, explain what happened and add screenshots. The arbiter then decides. {stakeNotice(listTerms ? listTerms.disputeBond : null, usdcShort)}{" "}
            <Link to="/docs#disputes" className="link text-fg">
              How disputes work
            </Link>
          </>
        }
      />
      <div className="mt-5">
        <SignedIn>{(token) => <Orders token={token} />}</SignedIn>
      </div>
    </>
  );
}

function Orders({ token }: { token: string }) {
  const { fullAddress } = useApp();
  const [rows, setRows] = useState<ApiRequest[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api
      .listMine(token)
      .then(({ asCryptoSpender, asCryptoBuyer }) => {
        if (!live) return;
        const byId = new Map<string, ApiRequest>();
        for (const r of [...asCryptoSpender, ...asCryptoBuyer]) byId.set(r.id, r);
        const rel = [...byId.values()].filter((r) => r.status === "code_submitted" || hasDispute(r as DisputeRequest));
        setRows(rel.sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? "")));
      })
      .catch((e) => live && setError(disputeError(e)));
    return () => {
      live = false;
    };
  }, [token]);

  if (error) return <Notice>{error}</Notice>;
  if (!rows)
    return (
      <div className="grid gap-3 lg:grid-cols-2" aria-busy="true" aria-label="Loading your orders">
        {[0, 1].map((i) => (
          <div key={i} className="panel flex items-center gap-3 p-4">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    );
  if (!rows.length)
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Nothing to dispute right now"
        body="An order shows up here once its voucher code has been submitted."
        action={
          <Button size="sm" variant="outline" to="/track" icon={<ArrowUpRight className="size-3.5" />}>
            See your orders
          </Button>
        }
      />
    );
  return (
    <motion.div {...enter} className="grid gap-3 lg:grid-cols-2">
      {rows.map((r) => {
        const b = brand(brandIdFromApi(r.brand));
        const st = STATUS[r.status];
        return (
          <Link key={r.id} to={`/dispute/${encodeURIComponent(r.id)}`} className="panel panel-hover flex items-center gap-3 p-4">
            <BrandMark id={brandIdFromApi(r.brand)} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold tabular">{b.name} {inr(r.amountInr)}</span>
              <span className="block truncate font-mono text-[11px] text-dim" title={r.id}>{r.id}</span>
            </span>
            <Pill tone={hasDispute(r as DisputeRequest) ? "rose" : (st.tone as "mint")}>{hasDispute(r as DisputeRequest) ? "Disputed" : roleIn(r as DisputeRequest, fullAddress) === "spender" ? "Can dispute" : "In review"}</Pill>
            <ArrowUpRight className="size-4 shrink-0 text-dim" />
          </Link>
        );
      })}
    </motion.div>
  );
}

/* --------------------------------------------------------------- one order */

function OrderDispute({ id }: { id: string }) {
  const { fullAddress } = useApp();
  const [req, setReq] = useState<DisputeRequest | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setReq((await api.get(id)).request as unknown as DisputeRequest);
      setError("");
    } catch (e) {
      setError(disputeError(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  // While a dispute is open, pick up the other person's reply and the team's decision.
  useEffect(() => {
    if (req?.status !== "disputed") return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [req?.status, load]);

  const b = req ? brand(brandIdFromApi(req.brand)) : null;
  const screen = req ? screenFor(req, fullAddress, Date.now()) : null;

  return (
    <>
      <Link to="/dispute" className="inline-flex h-8 items-center gap-1.5 text-[13px] text-mute transition-colors hover:text-fg">
        <ArrowLeft className="size-3.5" /> All disputes
      </Link>
      {error && <div className="mt-4"><Notice>{error}</Notice></div>}
      {!req && !error && (
        <div className="mt-3" aria-busy="true">
          <div className="flex items-center gap-4">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          </div>
          <Panel className="mt-5 space-y-3 sm:p-6">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-11 w-full" />
          </Panel>
        </div>
      )}
      {req && b && (
        <motion.div {...enter}>
          <div className="mt-3 flex items-center gap-4">
            <BrandMark id={brandIdFromApi(req.brand)} size={44} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] tabular md:text-[28px]">{b.name} {inr(req.amountInr)}</h1>
              <div className="truncate font-mono text-[11.5px] text-dim" title={req.id}>{req.id}</div>
            </div>
            <Pill tone={hasDispute(req) ? "rose" : "mute"}>{STATUS[req.status].label}</Pill>
          </div>

          <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
          <Panel className="sm:p-6">
            <SignedIn>
              {(token) =>
                screen?.kind === "raise" ? (
                  <RaiseForm req={req} token={token} onDone={load} />
                ) : screen?.kind === "view" ? (
                  <DisputeView req={req} token={token} onChanged={load} />
                ) : (
                  <p className="text-[14px] text-mute">{screen?.why}</p>
                )
              }
            </SignedIn>
          </Panel>
          <OrderSummary req={req} />
          </div>
        </motion.div>
      )}
    </>
  );
}

/** The order beside the dispute: what is at stake, straight from the order record. */
function OrderSummary({ req }: { req: DisputeRequest }) {
  return (
    <Panel as="aside" className="lg:sticky lg:top-24">
      <div className="label">The order</div>
      <dl className="mt-2 divide-y divide-line text-[13.5px]">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-mute">Voucher</dt>
          <dd className="tabular">{inr(req.amountInr)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-mute">USDC buyer is paid</dt>
          <dd className="font-semibold tabular">{usdt(Number(req.amountUsdc) || 0)} USDC</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-mute">Status</dt>
          <dd>{STATUS[req.status].label}</dd>
        </div>
      </dl>
      <Button size="sm" variant="outline" className="mt-3 w-full" to={`/track?id=${encodeURIComponent(req.id)}`} icon={<ArrowUpRight className="size-3.5" />}>
        Open the order page
      </Button>
      <Link to="/docs#disputes" className="mt-3 block text-center text-[12.5px] text-mute transition-colors hover:text-fg">
        How disputes work
      </Link>
    </Panel>
  );
}

/* ------------------------------------------------------------- raise form */

type Step = "idle" | "chain" | "submit" | "upload";
/** Shown if a server asks for a stake paid outside the escrow. The escrow takes its own stake; the app can't pay another. */
const STAKE_UNSUPPORTED = "This server asks for a dispute stake paid separately from the escrow. This app can only lock the stake the escrow contract itself takes, so the dispute can't be opened from here. Nothing was sent.";

function RaiseForm({ req, token, onDone }: { req: DisputeRequest; token: string; onDone: () => Promise<void> }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [terms, setTerms] = useState<Bond | null>(null);
  const [category, setCategory] = useState<Category | "">("");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [agree, setAgree] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const busy = step !== "idle";
  const stakeAsked = !!terms?.required;
  // This order's own stake when the server read it from the contract; otherwise the escrow's current stake.
  const escrowTerms = useTerms().terms;
  const stake = terms?.onchain && typeof terms.amountBaseUnits === "string" && /^\d+$/.test(terms.amountBaseUnits) ? BigInt(terms.amountBaseUnits) : (escrowTerms?.disputeBond ?? null);

  useEffect(() => {
    let live = true;
    disputeApi
      .bond(req.id, token)
      .then((r) => live && setTerms(r.bond))
      .catch((e) => live && setError(disputeError(e)));
    return () => {
      live = false;
    };
  }, [req.id, token]);

  async function pick(list: FileList | null) {
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list ?? [])) {
      if (files.length + ok.length >= MAX_SHOTS) {
        bad.push(`Only ${MAX_SHOTS} screenshots are allowed.`);
        break;
      }
      try {
        ok.push(await prepareShot(f));
      } catch (e) {
        bad.push(e instanceof Error ? e.message : `${f.name}: couldn't use this file.`);
      }
    }
    setFiles((all) => [...all, ...ok]);
    setProblems(bad);
  }

  async function submit() {
    if (!category || !terms || stakeAsked || busy) return;
    setError("");
    try {
      // The spender's wallet freezes the escrow; the server then records the reason. If the server call fails after
      // the transaction went through, pressing again skips the transaction (the escrow is read first).
      setStep("chain");
      const { mock } = await sendEscrowStep(walletRequest, "dispute", { req, from: fullAddress, wallet: walletName });
      setStep("submit");
      await disputeApi.open(req.id, token, { category, reason: reason.trim() });
      if (mock) setProblems([MOCK_NOTE]);
      setStep("upload");
      let failed = 0;
      for (const f of files) await disputeApi.uploadEvidence(req.id, token, f).catch(() => void failed++);
      if (failed) setProblems([`${failed} screenshot${failed > 1 ? "s" : ""} didn't upload. Add them again on the next screen.`]);
      await onDone();
    } catch (e) {
      setError(disputeError(e));
    } finally {
      setStep("idle");
    }
  }

  const ready = !!category && reason.trim().length >= REASON_MIN && agree && !!terms && !stakeAsked;
  const label = step === "chain" ? "Confirm the dispute in your wallet…" : step === "submit" ? "Submitting your dispute…" : step === "upload" ? "Uploading screenshots…" : "Raise dispute";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.02em]"><ShieldAlert className="size-5 text-rose-ink" /> Raise a dispute</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-mute">
          Your wallet sends one transaction that freezes the escrow, so nothing is paid out while it is open. The arbiter then decides how the escrow is split. If they agree with you, the other person gets a strike. If the dispute is found to be false, your account is banned.
        </p>
        <Callout tone="amber" className="mt-3">
          <span data-testid="dispute-stake">
            {stakeNotice(stake, usdcShort)}
            {stake !== null && stake > 0n ? " Your wallet may ask twice: once to approve the stake, then to open the dispute." : ""}
          </span>
        </Callout>
      </div>
      {stakeAsked && <Notice>{STAKE_UNSUPPORTED}</Notice>}

      <label className="block">
        <span className="mb-1.5 block text-[12.5px] text-mute">What's wrong?</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")} disabled={busy} className={cx(field, "h-11")}>
          <option value="" className="bg-surface">Choose…</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value} className="bg-surface">{c.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 flex justify-between text-[12.5px] text-mute"><span>Tell us what happened</span><span className="text-dim tabular">{reason.length}/{REASON_MAX}</span></span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={4} disabled={busy} placeholder="For example: the brand site says this code was already redeemed." className={cx(field, "resize-none py-2.5")} />
      </label>

      <div>
        <div className="mb-1.5 text-[12.5px] text-mute">Screenshots (optional, up to {MAX_SHOTS})</div>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f, i) => (
            <button key={i} type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} disabled={busy} className="inline-flex h-9 max-w-[220px] items-center gap-1.5 rounded-full bg-sunken pr-2.5 pl-3.5 text-[12.5px] transition-colors hover:bg-sunken-2" title={`Remove ${f.name}`}>
              <span className="truncate">{f.name}</span> <X className="size-3.5 shrink-0 text-mute" />
            </button>
          ))}
          {files.length < MAX_SHOTS && (
            <label className={cx("flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-[12.5px] text-mute ring-1 ring-line-2 transition-colors hover:bg-sunken hover:text-fg focus-within:ring-brand", busy && "pointer-events-none opacity-40")}>
              <ImagePlus className="size-4" /> Add
              <input type="file" accept={SHOT_TYPES.join(",")} multiple className="sr-only" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{SHOT_WARNING}</p>
        {problems.map((p) => <p key={p} className="mt-1 text-[12px] text-amber-ink">{p}</p>)}
      </div>

      <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[#0000ff]" />
        <span>I understand my account is banned if the team finds my dispute false.</span>
      </label>

      {busy && (
        <Stepper
          steps={(["chain", "submit", "upload"] as const).map((k, i, all) => ({
            key: k,
            label: k === "chain" ? "Freeze the escrow from your wallet" : k === "submit" ? "Send your reason" : "Upload screenshots",
            state: all.indexOf(step as (typeof all)[number]) > i ? "done" : step === k ? "now" : "todo",
          }))}
        />
      )}
      {error && <Notice>{error}</Notice>}
      <Button className="w-full" size="lg" variant="dark" disabled={!ready} pending={busy} onClick={() => void submit()}>
        {label}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ open dispute */

function DisputeView({ req, token, onChanged }: { req: DisputeRequest; token: string; onChanged: () => Promise<void> }) {
  const { fullAddress } = useApp();
  const d = req.dispute;
  const disputer = disputerOf(req);
  const iRaised = !!fullAddress && !!disputer && disputer.toLowerCase() === fullAddress.toLowerCase();
  const outcome = outcomeLine(req, fullAddress);
  const open = req.status === "disputed";
  const [shots, setShots] = useState<Evidence[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const mine = shots.filter((s) => s.by?.toLowerCase() === fullAddress?.toLowerCase()).length;

  const loadShots = useCallback(() => disputeApi.listEvidence(req.id, token).then(setShots).catch(() => undefined), [req.id, token]);
  useEffect(() => void loadShots(), [loadShots]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await onChanged();
    } catch (e) {
      setError(disputeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{iRaised ? "You raised this dispute" : "This order is disputed"}</h2>
        {d?.category && <p className="mt-1 text-[13px] text-mute">{categoryLabel(d.category)}</p>}
      </div>

      {(d?.reason || req.disputeReason) && <p className="well p-4 text-[14px] leading-relaxed whitespace-pre-wrap">{d?.reason ?? req.disputeReason}</p>}
      <p className="text-[12.5px] text-mute">{stakeLine(req, fullAddress)}</p>

      {outcome ? (
        <Notice tone={outcome.good ? "pos" : "rose"}>{outcome.text}{req.resolution?.note ? ` Note from the team: ${req.resolution.note}` : ""}</Notice>
      ) : (
        <Callout tone="amber" icon={<LoaderCircle className="animate-spin" />}>
          Waiting for the team to decide. Nothing moves until they do.
        </Callout>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] text-mute">Screenshots</span>
          {open && mine < MAX_SHOTS && (
            <>
              <button type="button" onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-[12.5px] text-brand-ink hover:underline disabled:opacity-40">
                <ImagePlus className="size-3.5" /> Add screenshot
              </button>
              <input
                ref={input}
                type="file"
                accept={SHOT_TYPES.join(",")}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void run(async () => { await disputeApi.uploadEvidence(req.id, token, await prepareShot(f)); await loadShots(); });
                }}
              />
            </>
          )}
        </div>
        {shots.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shots.map((s) => <Shot key={s.id} reqId={req.id} ev={s} token={token} mine={s.by?.toLowerCase() === fullAddress?.toLowerCase()} />)}
          </div>
        ) : (
          <p className="text-[12.5px] text-dim">None added yet.</p>
        )}
        {open && <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{SHOT_WARNING}</p>}
      </div>

      {d?.response?.text ? (
        <div>
          <div className="mb-1.5 text-[12.5px] text-mute">{iRaised ? "Their reply" : "Your reply"}</div>
          <p className="well p-4 text-[14px] leading-relaxed whitespace-pre-wrap">{d.response.text}</p>
        </div>
      ) : (
        open &&
        !iRaised &&
        roleIn(req, fullAddress) && (
          <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= REASON_MIN) void run(() => disputeApi.respond(req.id, token, text.trim())); }}>
            <label className="block text-[12.5px] text-mute">Your side (you can reply once)</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={REASON_MAX} rows={3} placeholder="Explain what happened from your side." className={cx(field, "resize-none py-2.5")} />
            <Button type="submit" size="sm" variant="outline" disabled={text.trim().length < REASON_MIN} pending={busy}>Send reply</Button>
          </form>
        )
      )}

      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function Shot({ reqId, ev, token, mine }: { reqId: string; ev: Evidence; token: string; mine: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    let made = "";
    disputeApi
      .evidenceUrl(reqId, ev.id, token)
      .then((u) => {
        made = u;
        if (live) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [reqId, ev.id, token]);
  return (
    <a href={url || undefined} target="_blank" rel="noreferrer" className="group relative block aspect-square overflow-hidden rounded-xl bg-sunken ring-1 ring-line" title={ev.note ?? "Open"}>
      {url ? <img src={url} alt="Screenshot" className="np-fade-in size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" /> : <span className="skeleton block size-full rounded-none" />}
      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[9.5px] tracking-wider text-white uppercase">{mine ? "you" : "them"}</span>
    </a>
  );
}
