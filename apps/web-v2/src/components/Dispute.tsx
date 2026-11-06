import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, CircleAlert, ImagePlus, LoaderCircle, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, cx } from "./ui";
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
  sameAddr,
  saveBond,
  savedBond,
  stakeBond,
  type Category,
  type DisputeRequest,
  type Evidence,
} from "../lib/dispute";
import { useApp } from "../lib/store";

const AFTER_CODE = ["releasing", "released", "refunding", "refunded"];
const SHOT_WARNING = "Screenshots can show the voucher code. Crop or cover anything that isn't needed.";

/** Everything dispute-related for one order card on Track. Renders nothing when there's nothing to do. */
export function DisputeSection({ id, status, onChanged }: { id: string; status: string; onChanged: () => void }) {
  const { token } = useApp();
  const [raising, setRaising] = useState(false);
  const [showLate, setShowLate] = useState(false);
  if (!token) return null;

  return (
    <>
      {status === "code_submitted" && (
        <div className="mt-3 border-t border-white/[0.06] pt-3.5">
          <button
            onClick={() => setRaising(true)}
            className="flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] text-rose ring-1 ring-rose/30 transition hover:bg-rose/10"
          >
            <ShieldAlert className="size-3.5" /> Raise a dispute
          </button>
        </div>
      )}
      {status === "disputed" && (
        <div className="mt-3 border-t border-white/[0.06] pt-3.5">
          <DisputeView id={id} token={token} live onChanged={onChanged} />
        </div>
      )}
      {AFTER_CODE.includes(status) && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <button onClick={() => setShowLate((v) => !v)} className="flex items-center gap-1.5 text-[12px] text-dim hover:text-fg" aria-expanded={showLate}>
            Dispute details <ChevronDown className={cx("size-3.5 transition", showLate && "rotate-180")} />
          </button>
          {showLate && <div className="mt-3"><DisputeView id={id} token={token} onChanged={onChanged} /></div>}
        </div>
      )}
      <RaiseDispute id={id} open={raising} onClose={() => setRaising(false)} onDone={onChanged} />
    </>
  );
}

/* ------------------------------------------------------------ shared bits */

const field = "w-full rounded-2xl bg-white/[0.03] px-3.5 text-[14px] text-fg ring-1 ring-white/10 outline-none transition placeholder:text-dim focus:ring-mint/40";

function ErrorBox({ children }: { children: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-2xl bg-rose/[0.07] px-3.5 py-3 text-[13px] text-rose ring-1 ring-rose/25">
      <CircleAlert className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Checks picked files (type, size, count) and returns the ones the server will take. */
async function takeFiles(list: FileList | null, already: number): Promise<{ ok: File[]; problems: string[] }> {
  const ok: File[] = [];
  const problems: string[] = [];
  for (const f of Array.from(list ?? [])) {
    if (already + ok.length >= MAX_SHOTS) {
      problems.push(`Only ${MAX_SHOTS} screenshots are allowed.`);
      break;
    }
    try {
      ok.push(await prepareShot(f));
    } catch (e) {
      problems.push(e instanceof Error ? e.message : `${f.name}: couldn't use this file.`);
    }
  }
  return { ok, problems };
}

/* ------------------------------------------------------------ raise form */

type Step = "idle" | "bond" | "switch" | "approve" | "deposit" | "submit" | "upload" | "done";
const STEP_TEXT: Record<Exclude<Step, "idle" | "done">, string> = {
  bond: "Getting the stake terms…",
  switch: "Switch your wallet to Arc Testnet…",
  approve: "Step 1 of 2 · Approve USDC in your wallet…",
  deposit: "Step 2 of 2 · Confirm the stake in your wallet…",
  submit: "Submitting your dispute…",
  upload: "Uploading screenshots…",
};

export function RaiseDispute({ id, open, onClose, onDone }: { id: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const { token, fullAddress, walletRequest, apiUser, openWallet, signIn, signingIn } = useApp();
  const [category, setCategory] = useState<Category | "">("");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [agree, setAgree] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [uploadFailed, setUploadFailed] = useState(0);
  const paid = open ? savedBond(id) : null;
  const busy = step !== "idle" && step !== "done";
  const banned = !!apiUser?.banned;
  const reasonLen = reason.trim().length;
  const valid = !!category && reasonLen >= REASON_MIN && reasonLen <= REASON_MAX && agree && !banned;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const pick = async (list: FileList | null) => {
    const { ok, problems } = await takeFiles(list, files.length);
    setFiles((f) => [...f, ...ok]);
    setFileProblems(problems);
  };

  const submit = async () => {
    if (!token || !category || !valid) return;
    if (!fullAddress) return setError("Connect your wallet first.");
    setError("");
    try {
      // A stake that's already paid (earlier attempt failed after the deposit) is reused, never paid again.
      let bondTxHash = savedBond(id);
      if (!bondTxHash) {
        setStep("bond");
        const { bond } = await disputeApi.bond(id, token);
        if (bond.required) {
          bondTxHash = await stakeBond(walletRequest, fullAddress, bond, {
            onStep: setStep,
            onDepositHash: (h) => saveBond(id, h),
          });
        }
      }
      setStep("submit");
      await disputeApi.open(id, token, { category, reason: reason.trim(), ...(bondTxHash ? { bondTxHash } : {}) });
      clearBond(id);

      let failed = 0;
      if (files.length) setStep("upload");
      for (const f of files) {
        try {
          await disputeApi.uploadEvidence(id, token, f);
        } catch {
          failed++;
        }
      }
      setUploadFailed(failed);
      setStep("done");
      onDone();
    } catch (e) {
      setError(disputeError(e));
      setStep("idle");
    }
  };

  const close = () => {
    if (busy) return;
    if (step === "done") {
      setCategory("");
      setReason("");
      setFiles([]);
      setAgree(false);
      setStep("idle");
    }
    onClose();
  };

  // Portal: the order card has backdrop-blur, which would trap a fixed overlay inside the card.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Raise a dispute"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="hairline max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[26px] bg-ink-2 p-5 sm:rounded-[26px] sm:p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold tracking-tight">Raise a dispute</h3>
              <button onClick={close} disabled={busy} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5 disabled:opacity-40" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            {step === "done" ? (
              <div className="mt-6 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-mint/10 text-mint ring-1 ring-mint/25">
                  <Check className="size-6" />
                </div>
                <p className="mt-4 text-[15px] font-medium">Dispute raised</p>
                <p className="mt-1 text-[13px] text-mute">The other side can now respond. The team will decide.</p>
                {uploadFailed > 0 && (
                  <p className="mt-3 text-[12.5px] text-amber">
                    {uploadFailed} screenshot{uploadFailed > 1 ? "s" : ""} didn't upload. You can add them from the dispute details on this order.
                  </p>
                )}
                <Button className="mt-5 w-full" onClick={close}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-[12.5px] text-mute">What's wrong?</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category | "")}
                    disabled={busy}
                    className={cx(field, "mt-1.5 h-12 appearance-none", !category && "text-dim")}
                  >
                    <option value="">Choose a reason…</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value} className="bg-ink-2 text-fg">
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="flex justify-between text-[12.5px] text-mute">
                    <span>Explain what happened</span>
                    <span className={cx("font-mono text-[11px]", reasonLen > REASON_MAX ? "text-rose" : "text-dim")}>
                      {reasonLen}/{REASON_MAX}
                    </span>
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={busy}
                    rows={4}
                    maxLength={REASON_MAX + 200}
                    placeholder="At least 5 characters. Say what you tried and what you saw."
                    className={cx(field, "mt-1.5 resize-y py-3")}
                  />
                </label>

                <div>
                  <div className="flex items-center justify-between text-[12.5px] text-mute">
                    <span>Screenshots (optional)</span>
                    <span className="font-mono text-[11px] text-dim">
                      {files.length}/{MAX_SHOTS}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-amber">{SHOT_WARNING}</p>
                  {files.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {files.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[12.5px] ring-1 ring-white/[0.07]">
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="shrink-0 font-mono text-[11px] text-dim">{Math.ceil(f.size / 1024)} KB</span>
                          <button onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} disabled={busy} className="text-mute hover:text-rose" aria-label={`Remove ${f.name}`}>
                            <X className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {files.length < MAX_SHOTS && <ShotButton disabled={busy} onPick={pick} className="mt-2" />}
                  {fileProblems.map((p, i) => (
                    <p key={i} className="mt-1.5 text-[12px] text-rose">
                      {p}
                    </p>
                  ))}
                </div>

                <div className="rounded-2xl bg-amber/[0.06] p-4 ring-1 ring-amber/25">
                  <div className="text-[13px] font-medium text-amber">1 USDC stake</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
                    You put 1 USDC at stake to raise a dispute. If the team finds you right, your stake comes back and the other side gets a strike. If you're wrong, your stake goes to
                    the other side and your account is banned.
                  </p>
                  <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[12.5px]">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={busy} className="mt-0.5 size-4 shrink-0 accent-mint" />
                    <span>I understand I lose my stake and get banned if my dispute is false</span>
                  </label>
                </div>

                {paid && !busy && (
                  <p className="text-[12.5px] text-mint">Your stake is already paid. You won't be charged again.</p>
                )}
                {banned && <ErrorBox>Your account is banned</ErrorBox>}
                {error && <ErrorBox>{error}</ErrorBox>}

                {busy && (
                  <div role="status" className="flex items-center gap-2.5 rounded-2xl bg-white/[0.03] px-3.5 py-3 text-[13px] ring-1 ring-white/[0.07]">
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-mint" /> {STEP_TEXT[step as keyof typeof STEP_TEXT]}
                  </div>
                )}

                {!fullAddress ? (
                  <Button className="w-full" size="lg" variant="outline" onClick={openWallet}>
                    Connect wallet to continue
                  </Button>
                ) : !token ? (
                  <Button className="w-full" size="lg" variant="outline" onClick={signIn} disabled={signingIn} icon={signingIn ? <LoaderCircle className="size-4 animate-spin" /> : undefined}>
                    {signingIn ? "Check your wallet…" : "Sign in to continue"}
                  </Button>
                ) : (
                  <Button className="w-full" size="lg" onClick={submit} disabled={!valid || busy} icon={busy ? <LoaderCircle className="size-4 animate-spin" /> : undefined}>
                    {busy ? "Working…" : error ? "Try again" : paid ? "Submit dispute" : "Stake 1 USDC & submit"}
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ShotButton({ onPick, disabled, className }: { onPick: (f: FileList | null) => void; disabled?: boolean; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={SHOT_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className={cx("flex h-10 items-center gap-2 rounded-full px-3.5 text-[12.5px] text-mute ring-1 ring-white/10 transition hover:text-fg disabled:opacity-40", className)}
      >
        <ImagePlus className="size-4" /> Add screenshot
      </button>
    </>
  );
}

/* ------------------------------------------------------------ dispute view */

const roleOf = (r: DisputeRequest, addr?: string | null, me?: string) =>
  sameAddr(addr, me) ? "You" : sameAddr(addr, r.requester) ? "The seller" : sameAddr(addr, r.fulfiller) ? "The buyer" : "A party";

function bondText(status?: string | null) {
  if (!status) return null;
  if (/return|refund/i.test(status)) return { text: "Stake returned", tone: "text-mint" };
  if (/forfeit|slash|lost/i.test(status)) return { text: "Stake forfeited to the other party", tone: "text-rose" };
  return { text: `Stake ${status.replace(/_/g, " ")}`, tone: "text-amber" };
}

export function DisputeView({ id, token, live, onChanged }: { id: string; token: string; live?: boolean; onChanged: () => void }) {
  const { fullAddress: me } = useApp();
  const [req, setReq] = useState<DisputeRequest | null>(null);
  const [shots, setShots] = useState<Evidence[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = (await disputeApi.get(id, token)).request;
      setReq(r);
      if (r.dispute || r.status === "disputed") setShots(await disputeApi.listEvidence(id, token).catch(() => []));
      setLoadError("");
    } catch (e) {
      setLoadError(disputeError(e));
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, live]);

  if (loading) return <div className="flex items-center gap-2 text-[12.5px] text-mute"><LoaderCircle className="size-3.5 animate-spin" /> Loading dispute…</div>;
  if (loadError && !req) {
    return (
      <div className="space-y-2">
        <ErrorBox>{loadError}</ErrorBox>
        <button onClick={load} className="flex items-center gap-1.5 text-[12.5px] text-mute hover:text-fg"><RefreshCw className="size-3.5" /> Retry</button>
      </div>
    );
  }
  if (!req) return null;

  const d = req.dispute;
  if (!d && req.status !== "disputed") return <p className="text-[12.5px] text-dim">There was no dispute on this order.</p>;

  const raiser = d?.raisedBy ?? req.disputedBy ?? null;
  const iRaised = sameAddr(raiser, me);
  const isParty = sameAddr(me, req.requester) || sameAddr(me, req.fulfiller);
  const responseText = typeof d?.response === "string" ? d.response : (d?.response?.text ?? "");
  const verdict = req.resolution?.verdict;
  const bond = bondText(d?.bond?.status);
  const open = req.status === "disputed";
  const reason = d?.reason ?? req.disputeReason ?? "";

  return (
    <div className="space-y-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-rose">Dispute</span>
        <span className="text-mute">
          Raised by <span className="text-fg">{roleOf(req, raiser, me).toLowerCase()}</span>
        </span>
        {bond && <span className={cx("text-[12px]", bond.tone)}>{bond.text}</span>}
      </div>

      {verdict && (
        <div className="rounded-2xl bg-mint/[0.06] px-4 py-3 ring-1 ring-mint/25">
          <div className="font-mono text-[10px] tracking-wider text-dim uppercase">Decision</div>
          <div className="mt-0.5 text-[14px] font-medium capitalize">{verdict.replace(/_/g, " ")}</div>
          {req.resolution?.note && <p className="mt-1 break-words text-mute">{req.resolution.note}</p>}
        </div>
      )}

      <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
        <div className="text-[12px] text-dim">{categoryLabel(d?.category)}</div>
        <p className="mt-1.5 break-words whitespace-pre-wrap">{reason || "No reason given."}</p>
      </div>

      <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
        <div className="text-[12px] text-dim">Response from the other party</div>
        <p className="mt-1.5 break-words whitespace-pre-wrap">{responseText || <span className="text-dim">No response yet.</span>}</p>
      </div>

      <Screenshots id={id} token={token} shots={shots} me={me} canAdd={open && isParty} onAdded={load} />

      {open && isParty && !iRaised && !responseText && <RespondBox id={id} token={token} onSent={() => { load(); onChanged(); }} />}
    </div>
  );
}

function RespondBox({ id, token, onSent }: { id: string; token: string; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = text.trim().length >= 1 && text.length <= REASON_MAX;
  return (
    <div className="space-y-2">
      <label className="block text-[12.5px] text-mute">Your response (you can send it once)</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={3} maxLength={REASON_MAX} placeholder="Tell your side of what happened." className={cx(field, "resize-y py-3")} />
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button
        size="sm"
        disabled={!ok || busy}
        icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await disputeApi.respond(id, token, text.trim());
            onSent();
          } catch (e) {
            setError(disputeError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Send response
      </Button>
    </div>
  );
}

function Screenshots({ id, token, shots, me, canAdd, onAdded }: { id: string; token: string; shots: Evidence[]; me: string; canAdd: boolean; onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const mine = shots.filter((s) => sameAddr(s.uploadedBy, me)).length;
  const left = MAX_SHOTS - mine;

  const add = async (list: FileList | null) => {
    setBusy(true);
    const { ok, problems: p } = await takeFiles(list, mine);
    let failed = 0;
    for (const f of ok) {
      try {
        await disputeApi.uploadEvidence(id, token, f);
      } catch (e) {
        failed++;
        p.push(disputeError(e));
        break;
      }
    }
    setProblems([...new Set(p)]);
    setBusy(false);
    if (ok.length > failed) onAdded();
  };

  if (!shots.length && !canAdd) return null;
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] text-dim">
        <span>Screenshots</span>
        {canAdd && <span className="font-mono text-[11px]">{mine}/{MAX_SHOTS} from you</span>}
      </div>
      {shots.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {shots.map((s) => (
            <Thumb key={s.id} id={id} token={token} s={s} me={me} />
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-dim">No screenshots yet.</p>
      )}
      {canAdd && left > 0 && (
        <>
          <p className="mt-2 text-[11.5px] text-amber">{SHOT_WARNING}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <ShotButton onPick={add} disabled={busy} />
            {busy && <LoaderCircle className="size-4 animate-spin text-mint" />}
          </div>
        </>
      )}
      {problems.map((p, i) => (
        <p key={i} className="mt-1.5 text-[12px] text-rose">
          {p}
        </p>
      ))}
    </div>
  );
}

function Thumb({ id, token, s, me }: { id: string; token: string; s: Evidence; me: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = "";
    disputeApi
      .evidenceUrl(id, s.id, token)
      .then((u) => {
        if (alive) setUrl((made = u));
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, s.id, token]);

  const who = s.uploadedBy ? (sameAddr(s.uploadedBy, me) ? "You" : "Other party") : "";
  return (
    <a
      href={url || undefined}
      target="_blank"
      rel="noreferrer"
      className="group relative block aspect-square overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-white/10"
      aria-label={`Open screenshot${who ? ` from ${who}` : ""}`}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-[11px] text-dim">{failed ? "Couldn't load" : <LoaderCircle className="size-4 animate-spin" />}</span>
      )}
      {who && <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90">{who}</span>}
    </a>
  );
}
