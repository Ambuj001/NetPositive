import { ArrowLeft, ArrowUpRight, CircleAlert, ImagePlus, LoaderCircle, PenLine, ShieldAlert, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Aurora, BrandMark, Button, Pill, cx } from "../components/ui";
import { STATUS, api, brandIdFromApi, type ApiRequest } from "../lib/api";
import { brand } from "../lib/data";
import {
  CATEGORIES,
  MAX_SHOTS,
  REASON_MAX,
  REASON_MIN,
  SHOT_TYPES,
  categoryLabel,
  clearBond,
  disputeApi,
  disputeError,
  prepareShot,
  saveBond,
  savedBond,
  stakeBond,
  type Bond,
  type Category,
  type DisputeRequest,
  type Evidence,
} from "../lib/dispute";
import { disputerOf, hasDispute, outcomeLine, roleIn, screenFor, stakeLine } from "../lib/disputeView";
import { inr } from "../lib/engine";
import { useApp } from "../lib/store";

const SHOT_WARNING = "Screenshots can show the voucher code. Only the two of you and the team can see them, but crop anything you don't need.";
const field = "w-full rounded-2xl bg-white/[0.03] px-3.5 text-[14px] text-fg ring-1 ring-white/10 outline-none transition placeholder:text-dim focus:ring-mint/40";

/** /dispute lists your orders that can be disputed or are disputed. /dispute/:id is one order. */
export default function DisputePage() {
  const { id } = useParams();
  return (
    <div className="relative pt-28 pb-16">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-2xl px-6">
        {id ? <OrderDispute id={id} /> : <DisputeList />}
      </div>
    </div>
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
      <Button variant="outline" onClick={signIn} disabled={signingIn} icon={signingIn ? <LoaderCircle className="size-4 animate-spin" /> : <PenLine className="size-4" />}>
        {signingIn ? "Check your wallet…" : "Sign in"}
      </Button>
    );
  return <>{children(token)}</>;
}

function Notice({ children, tone = "rose" }: { children: ReactNode; tone?: "rose" | "mint" }) {
  return (
    <div role="alert" className={cx("flex items-start gap-2 rounded-2xl px-3.5 py-3 text-[13px] ring-1", tone === "rose" ? "bg-rose/[0.07] text-rose ring-rose/25" : "bg-mint/[0.07] text-mint ring-mint/25")}>
      <CircleAlert className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ list */

function DisputeList() {
  return (
    <>
      <div className="label">Disputes</div>
      <h1 className="text-gradient mt-2 font-display text-4xl font-semibold tracking-[-0.03em]">Disputes</h1>
      <p className="mt-2 text-[14px] text-mute">Something wrong with a voucher code? Stake USDC, explain what happened, add screenshots, and the team decides.</p>
      <div className="mt-6">
        <SignedIn>{(token) => <Orders token={token} />}</SignedIn>
      </div>
    </>
  );
}

function Orders({ token }: { token: string }) {
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
  if (!rows) return <div className="flex items-center gap-2 text-[13px] text-mute"><LoaderCircle className="size-4 animate-spin" /> Loading your orders…</div>;
  if (!rows.length)
    return (
      <div className="hairline rounded-[22px] bg-ink-2/70 p-6 text-[14px] text-mute backdrop-blur-xl">
        Nothing to dispute right now. An order shows up here once its voucher code has been submitted. <Link to="/track" className="text-mint hover:underline">See your orders</Link>
      </div>
    );
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const b = brand(brandIdFromApi(r.brand));
        const st = STATUS[r.status];
        return (
          <Link key={r.id} to={`/dispute/${encodeURIComponent(r.id)}`} className="hairline flex items-center gap-3 rounded-[22px] bg-ink-2/70 p-4 backdrop-blur-xl transition hover:bg-ink-2">
            <BrandMark id={brandIdFromApi(r.brand)} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-medium">{b.name} {inr(r.amountInr)}</span>
              <span className="block truncate font-mono text-[11px] text-dim">{r.id}</span>
            </span>
            <Pill tone={hasDispute(r as DisputeRequest) ? "rose" : (st.tone as "mint")}>{hasDispute(r as DisputeRequest) ? "Disputed" : "Can dispute"}</Pill>
            <ArrowUpRight className="size-4 text-dim" />
          </Link>
        );
      })}
    </div>
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
      <Link to="/dispute" className="inline-flex items-center gap-1.5 text-[12.5px] text-mute hover:text-fg">
        <ArrowLeft className="size-3.5" /> All disputes
      </Link>
      {error && <div className="mt-4"><Notice>{error}</Notice></div>}
      {!req && !error && <div className="mt-6 flex items-center gap-2 text-[13px] text-mute"><LoaderCircle className="size-4 animate-spin" /> Loading…</div>}
      {req && b && (
        <>
          <div className="mt-5 flex items-center gap-3">
            <BrandMark id={brandIdFromApi(req.brand)} size={48} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-2xl font-semibold tracking-tight">{b.name} {inr(req.amountInr)}</h1>
              <div className="truncate font-mono text-[11px] text-dim">{req.id}</div>
            </div>
            <Pill tone={hasDispute(req) ? "rose" : "mute"}>{STATUS[req.status].label}</Pill>
          </div>

          <div className="hairline mt-6 rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
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
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------- raise form */

type Step = "idle" | "stake" | "submit" | "upload";
const STAKE_TEXT = { switch: "Switch your wallet to Arc Testnet…", approve: "Step 1 of 2 · approve USDC in your wallet…", deposit: "Step 2 of 2 · confirm the stake in your wallet…" } as const;

function RaiseForm({ req, token, onDone }: { req: DisputeRequest; token: string; onDone: () => Promise<void> }) {
  const { fullAddress, walletRequest } = useApp();
  const [terms, setTerms] = useState<Bond | null>(null);
  const [category, setCategory] = useState<Category | "">("");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [agree, setAgree] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [stakeStep, setStakeStep] = useState<keyof typeof STAKE_TEXT>("switch");
  const [error, setError] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const busy = step !== "idle";
  const paid = savedBond(req.id);
  const stake = terms?.required ? `${terms.amountUsdc} USDC` : null;

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
    if (!category || !terms || busy) return;
    setError("");
    try {
      let txHash = terms.required ? savedBond(req.id) ?? undefined : undefined;
      if (terms.required && !txHash) {
        setStep("stake");
        txHash = await stakeBond(walletRequest, fullAddress, terms, { onStep: (s) => setStakeStep(s), onDepositHash: (h) => saveBond(req.id, h) });
      }
      setStep("submit");
      await disputeApi.open(req.id, token, { category, reason: reason.trim(), ...(txHash ? { bondTxHash: txHash } : {}) });
      clearBond(req.id);
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

  const ready = !!category && reason.trim().length >= REASON_MIN && agree && !!terms;
  const label = step === "stake" ? STAKE_TEXT[stakeStep] : step === "submit" ? "Submitting your dispute…" : step === "upload" ? "Uploading screenshots…" : paid ? "Raise dispute (stake already paid)" : stake ? `Stake ${stake} and raise dispute` : "Raise dispute";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight"><ShieldAlert className="size-5 text-rose" /> Raise a dispute</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
          {stake ? `You stake ${stake}. ` : ""}If the team agrees with you, the stake comes back and the other person gets a strike. If not, the stake goes to the other person and your account is banned.
        </p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-[12.5px] text-mute">What's wrong?</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category | "")} disabled={busy} className={cx(field, "h-12")}>
          <option value="" className="bg-ink-2">Choose…</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value} className="bg-ink-2">{c.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 flex justify-between text-[12.5px] text-mute"><span>Tell us what happened</span><span className="tabular text-dim">{reason.length}/{REASON_MAX}</span></span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={4} disabled={busy} placeholder="For example: the brand site says this code was already redeemed." className={cx(field, "resize-none py-3")} />
      </label>

      <div>
        <div className="mb-1.5 text-[12.5px] text-mute">Screenshots (optional, up to {MAX_SHOTS})</div>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f, i) => (
            <button key={i} type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} disabled={busy} className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] ring-1 ring-white/10 hover:bg-white/[0.09]" title="Remove">
              {f.name.slice(0, 22)} ✕
            </button>
          ))}
          {files.length < MAX_SHOTS && (
            <label className={cx("flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-[12.5px] text-mute ring-1 ring-white/12 hover:text-fg", busy && "pointer-events-none opacity-40")}>
              <ImagePlus className="size-4" /> Add
              <input type="file" accept={SHOT_TYPES.join(",")} multiple className="sr-only" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{SHOT_WARNING}</p>
        {problems.map((p) => <p key={p} className="mt-1 text-[12px] text-amber">{p}</p>)}
      </div>

      <label className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-mute">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[#3ddc97]" />
        <span>I understand I lose my stake and my account is banned if the team finds my dispute false.</span>
      </label>

      {error && <Notice>{error}</Notice>}
      <Button className="w-full" size="lg" disabled={!ready || busy} onClick={() => void submit()} icon={busy ? <LoaderCircle className="size-4 animate-spin" /> : undefined}>
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
        <h2 className="font-display text-xl font-semibold tracking-tight">{iRaised ? "You raised this dispute" : "This order is disputed"}</h2>
        {d?.category && <p className="mt-1 text-[13px] text-mute">{categoryLabel(d.category)}</p>}
      </div>

      {(d?.reason || req.disputeReason) && <p className="whitespace-pre-wrap rounded-2xl bg-white/[0.03] p-3.5 text-[14px] leading-relaxed ring-1 ring-white/[0.07]">{d?.reason ?? req.disputeReason}</p>}
      <p className="text-[12.5px] text-mute">{stakeLine(req, fullAddress)}</p>

      {outcome ? (
        <Notice tone={outcome.good ? "mint" : "rose"}>{outcome.text}{req.resolution?.note ? ` Note from the team: ${req.resolution.note}` : ""}</Notice>
      ) : (
        <p className="text-[13px] text-amber">Waiting for the team to decide. Nothing moves until they do.</p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] text-mute">Screenshots</span>
          {open && mine < MAX_SHOTS && (
            <>
              <button type="button" onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-[12.5px] text-mint hover:underline disabled:opacity-40">
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
          <p className="whitespace-pre-wrap rounded-2xl bg-white/[0.03] p-3.5 text-[14px] leading-relaxed ring-1 ring-white/[0.07]">{d.response.text}</p>
        </div>
      ) : (
        open &&
        !iRaised &&
        roleIn(req, fullAddress) && (
          <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= REASON_MIN) void run(() => disputeApi.respond(req.id, token, text.trim())); }}>
            <label className="block text-[12.5px] text-mute">Your side (you can reply once)</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={REASON_MAX} rows={3} placeholder="Explain what happened from your side." className={cx(field, "resize-none py-3")} />
            <Button type="submit" size="sm" variant="outline" disabled={busy || text.trim().length < REASON_MIN}>Send reply</Button>
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
    <a href={url || undefined} target="_blank" rel="noreferrer" className="group relative block aspect-square overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-white/10" title={ev.note ?? "Open"}>
      {url ? <img src={url} alt="Screenshot" className="size-full object-cover transition group-hover:scale-105" /> : <span className="grid size-full place-items-center"><LoaderCircle className="size-4 animate-spin text-dim" /></span>}
      <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9.5px] text-white/80">{mine ? "you" : "them"}</span>
    </a>
  );
}
