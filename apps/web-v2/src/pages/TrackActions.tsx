import { AnimatePresence, motion } from "motion/react";
import { Check, Eye, EyeOff, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx } from "../components/ui";
import { ApiError, api, type ApiRequest } from "../lib/api";
import { inr, usdt } from "../lib/engine";

/**
 * The spender's three actions on the tracker, shown inside the lifecycle step they belong to:
 *   Ready   (after a buyer accepts)   a free signature telling the buyer "I'm ready for the voucher code"
 *   Settle  (after the code is in)    confirm the voucher works; the escrow releases the USDC to the buyer on Arc
 *   Dispute (after the code is in)    the voucher doesn't work; an admin decides
 */

type WalletRequest = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

type Common = {
  req: ApiRequest;
  token: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
  /** The server answered with the new state of the order: show it right away. */
  onUpdated: (req: ApiRequest, notice: Notice) => void;
};
export type Notice = { tone: "mint" | "rose" | "amber"; text: string; tx?: string | null };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function messageOf(e: unknown, fallback: string) {
  if ((e as { code?: number })?.code === 4001) return "You declined the request in your wallet.";
  if (e instanceof ApiError) return e.message;
  return e instanceof Error && e.message ? e.message : fallback;
}

/* ------------------------------------------------------------------- Ready */

export function ReadyAction({ req, token, signIn, signingIn, onUpdated, viewer, walletRequest, expired }: Common & { viewer: string; walletRequest: WalletRequest; expired: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setErr("");
    setBusy(true);
    try {
      const t = token ?? (await signIn());
      if (!t) throw new Error("Sign in with your wallet first.");
      const { validUntil, typedData } = await api.readyPermit(req.id, t);
      let signature: unknown;
      try {
        signature = await walletRequest({ method: "eth_signTypedData_v4", params: [viewer, JSON.stringify(typedData)] });
      } catch (e) {
        throw new Error(messageOf(e, "The wallet couldn't sign the Ready permit."));
      }
      if (typeof signature !== "string") throw new Error("The wallet didn't return a signature.");
      const { request } = await api.ready(req.id, { validUntil, signature }, t);
      onUpdated(request, { tone: "mint", text: "Ready sent. The buyer can now hand over the voucher code." });
    } catch (e) {
      setErr(messageOf(e, "Couldn't send Ready"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-mint/[0.05] p-3.5 ring-1 ring-mint/20">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={go} disabled={busy || signingIn} icon={busy || signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}>
          {busy || signingIn ? "Check your wallet…" : expired ? "Ready again" : "Ready"}
        </Button>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-mute">
          A free signature, no gas. It tells <span className="font-mono">{req.crypto_buyer ? short(req.crypto_buyer) : "the buyer"}</span> you're ready to receive the voucher code, for the next 10 minutes.
          {!token && " The first time, your wallet asks twice: once to sign in, once for the permit."}
        </p>
      </div>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ Settle / Dispute */

const REASONS = ["The code was already redeemed", "The code is invalid", "Wrong brand or amount", "The balance is lower than ordered"];

export function SettleActions({ req, token, signIn, signingIn, onUpdated }: Common) {
  const [confirming, setConfirming] = useState(false);
  const [disputing, setDisputing] = useState(false);

  if (!token) {
    return (
      <div className="mt-3 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.07]">
        <Button size="sm" variant="outline" onClick={signIn} disabled={signingIn} icon={signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}>
          {signingIn ? "Check your wallet…" : "Sign in to settle or dispute"}
        </Button>
        <p className="mt-2 text-[12px] text-mute">Signing in is a free signature. It proves this wallet is the spender.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.07]">
      <VoucherPeek req={req} token={token} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { setDisputing(false); setConfirming(true); }} icon={<ShieldCheck className="size-3.5" />}>
          Settle transaction
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDisputing((v) => !v)} className={cx(disputing && "ring-rose/40")}>
          Raise a dispute
        </Button>
      </div>
      {disputing && <DisputeForm req={req} token={token} onCancel={() => setDisputing(false)} onUpdated={onUpdated} />}
      <ConfirmSettle req={req} token={token} open={confirming} onClose={() => setConfirming(false)} onUpdated={onUpdated} />
    </div>
  );
}

function VoucherPeek({ req, token }: { req: ApiRequest; token: string }) {
  const [state, setState] = useState<{ kind: "hidden" } | { kind: "loading" } | { kind: "code"; code: string; pin: string | null } | { kind: "sealed" } | { kind: "error"; message: string }>({ kind: "hidden" });

  async function show() {
    setState({ kind: "loading" });
    try {
      const { voucher } = await api.voucher(req.id, token);
      if (typeof voucher.code === "string") setState({ kind: "code", code: voucher.code, pin: voucher.pin ?? null });
      else setState({ kind: "sealed" });
    } catch (e) {
      setState({ kind: "error", message: messageOf(e, "Couldn't load the voucher") });
    }
  }

  return (
    <div className="text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 text-mute">
        Check the voucher before you settle.
        {state.kind === "code" ? (
          <button onClick={() => setState({ kind: "hidden" })} className="inline-flex items-center gap-1 text-fg/80 hover:text-fg">
            <EyeOff className="size-3.5" /> Hide
          </button>
        ) : (
          <button onClick={show} disabled={state.kind === "loading"} className="inline-flex items-center gap-1 text-mint hover:brightness-110 disabled:opacity-50">
            {state.kind === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} Show the code
          </button>
        )}
      </div>
      {state.kind === "code" && (
        <dl className="mt-2 space-y-1 rounded-xl bg-ink px-3 py-2 font-mono text-[12.5px] ring-1 ring-white/10">
          <div className="flex gap-3"><dt className="w-10 shrink-0 text-dim">Code</dt><dd className="min-w-0 break-all select-all text-fg">{state.code}</dd></div>
          {state.pin && <div className="flex gap-3"><dt className="w-10 shrink-0 text-dim">PIN</dt><dd className="select-all text-fg">{state.pin}</dd></div>}
        </dl>
      )}
      {state.kind === "sealed" && <p className="mt-1.5 text-[12px] text-amber">This voucher is sealed to your vault key, so it can't be shown on this page. Open it in your vault, then come back to settle.</p>}
      {state.kind === "error" && <p role="alert" className="mt-1.5 text-[12px] text-rose">{state.message}</p>}
    </div>
  );
}

function DisputeForm({ req, token, onCancel, onUpdated }: { req: ApiRequest; token: string; onCancel: () => void; onUpdated: Common["onUpdated"] }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = reason.trim().length >= 5;

  async function submit() {
    if (!ok || busy) return;
    setBusy(true);
    setErr("");
    try {
      const { request } = await api.dispute(req.id, reason.trim(), token);
      onUpdated(request, { tone: "rose", text: "Dispute raised. The USDC stays in escrow until an admin rules on it." });
    } catch (e) {
      setErr(messageOf(e, "Couldn't raise the dispute"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-rose/[0.05] p-3 ring-1 ring-rose/25">
      <div className="text-[12.5px] font-medium text-rose">What's wrong with the voucher?</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} className={cx("rounded-full px-2.5 py-1 text-[11.5px] ring-1 transition", reason === r ? "bg-rose/15 text-rose ring-rose/40" : "text-mute ring-white/10 hover:text-fg")}>
            {r}
          </button>
        ))}
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Describe the problem</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Describe the problem (at least 5 characters)"
          className="w-full resize-none rounded-lg bg-ink px-3 py-2 text-[13px] ring-1 ring-white/10 outline-none placeholder:text-dim focus:ring-rose/40"
        />
      </label>
      <p className="mt-1 text-[11.5px] text-mute">Your USDC stays locked while an admin reviews it. Raise a dispute before the review deadline.</p>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose">{err}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" variant="amber" onClick={submit} disabled={!ok || busy} icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}>
          {busy ? "Sending…" : "Raise dispute"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Settle confirmation */

function ConfirmSettle({ req, token, open, onClose, onUpdated }: { req: ApiRequest; token: string; open: boolean; onClose: () => void; onUpdated: Common["onUpdated"] }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const amount = `${usdt(Number(req.amountUsdc) || 0)} USDC`;
  const buyer = req.crypto_buyer ?? "";

  // every time the dialog opens it starts unticked
  useEffect(() => {
    if (open) {
      setChecked(false);
      setErr("");
    }
  }, [open]);

  async function release() {
    if (!checked || busy) return;
    setBusy(true);
    setErr("");
    try {
      const { request } = await api.confirm(req.id, token);
      onClose();
      onUpdated(request, { tone: "mint", text: `Settled. ${amount} was released to the buyer.`, tx: request.releaseTxHash });
    } catch (e) {
      setErr(messageOf(e, "The release failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} labelledBy="settle-title">
      <h2 id="settle-title" className="font-display text-[20px] font-semibold tracking-tight">
        Release {amount} to the buyer?
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
        This pays the buyer for the {inr(req.amountInr)} voucher. The escrow contract sends the locked USDC on Arc, and <strong className="font-medium text-fg">it can't be undone</strong>.
      </p>

      <dl className="mt-4 divide-y divide-white/[0.06] rounded-xl bg-white/[0.03] px-3.5 text-[13px] ring-1 ring-white/[0.07]">
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Amount</dt><dd className="font-semibold tabular">{amount}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Paid to the buyer</dt><dd className="min-w-0 break-all text-right font-mono text-[12px]" title={buyer}>{buyer ? `${short(buyer)}` : "—"}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Order</dt><dd className="font-mono text-[12px]">{req.id}</dd></div>
      </dl>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07] has-[:checked]:ring-mint/40">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[#3ddc97]" />
        <span className="text-[13px] leading-relaxed">I've received the voucher and checked that it works.</span>
      </label>
      <p className="mt-2 text-[12px] text-mute">If it doesn't work, close this and raise a dispute instead.</p>

      {err && <p role="alert" className="mt-3 rounded-lg bg-rose/10 px-3 py-2 text-[12.5px] text-rose ring-1 ring-rose/25">{err}</p>}
      {busy && <p className="mt-3 text-[12.5px] text-amber">Releasing on Arc. This can take up to a minute. Keep this page open.</p>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          Not yet
        </Button>
        <Button size="sm" onClick={release} disabled={!checked || busy} icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}>
          {busy ? "Releasing…" : `Release ${amount}`}
        </Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------- Modal */

function Modal({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const el = box.current;
    el?.querySelector<HTMLElement>("input,button:not([disabled])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),a[href]")];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 px-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} className="hairline relative w-full max-w-md rounded-[24px] bg-ink-2 p-6 shadow-2xl">
            <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 grid size-7 place-items-center rounded-full text-dim hover:bg-white/5 hover:text-fg">
              <X className="size-4" />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
