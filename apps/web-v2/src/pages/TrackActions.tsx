import { AnimatePresence, motion } from "motion/react";
import { Check, Eye, EyeOff, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx } from "../components/ui";
import { api, type ApiRequest, type DisputeCategory } from "../lib/api";
import { inr, usdt } from "../lib/engine";
import { useApp } from "../lib/store";
import { readSealedVoucher, registerVault, unlockVault } from "../lib/vault";
import { ARC, switchToArc } from "../lib/arc";
import { MOCK_NOTE, escrowTarget, sendEscrowStep, stepError } from "../lib/escrowFlow";

/**
 * Wallet actions on the tracker, shown inside the lifecycle step they belong to. In escrow V2 each person sends
 * their own transaction and the server only checks the chain afterwards.
 *   Ready    spender, after a buyer accepts    a free signature (the escrow's Assign permit) naming the buyer
 *   Confirm  buyer, after Ready                `accept` with that permit: binds the buyer on-chain. Buy the voucher only after this.
 *   Settle   spender, after the code is in     `release`: pays the buyer
 *   Dispute  spender, after the code is in     `dispute`: freezes the escrow until the arbiter rules
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

/** Wallet, chain, config and server errors as one readable line (see `stepError`). */
const messageOf = stepError;

/** The Ready permit must be for this network and this escrow. Anything else is refused before the wallet is asked to sign. */
function permitProblem(typedData: unknown, contract: string | null): string | null {
  const domain = (typedData as { domain?: { chainId?: unknown; verifyingContract?: unknown } } | null)?.domain;
  const chainId = Number(domain?.chainId);
  if (Number.isFinite(chainId) && chainId !== ARC.id) return `The server sent a Ready permit for chain ${chainId}, but this app is set up for ${ARC.name} (chain ${ARC.id}). Nothing was signed.`;
  const to = typeof domain?.verifyingContract === "string" ? domain.verifyingContract.toLowerCase() : null;
  if (contract && to && to !== contract.toLowerCase()) return `The server sent a Ready permit for a different contract (${to}) than this app's escrow. Nothing was signed.`;
  return null;
}

/* ------------------------------------------------------------------- Ready */

export function ReadyAction({ req, token, signIn, signingIn, onUpdated, viewer, walletRequest, expired }: Common & { viewer: string; walletRequest: WalletRequest; expired: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { signMessage, walletName } = useApp();

  async function go() {
    setErr("");
    setBusy(true);
    try {
      const t = token ?? (await signIn());
      if (!t) throw new Error("Sign in with your wallet first.");
      // "Ready" means "I can receive the code": publish this wallet's vault key first if it isn't published yet.
      await registerVault(viewer, t, signMessage);
      const target = await escrowTarget();
      const { validUntil, typedData } = await api.readyPermit(req.id, t);
      const wrong = permitProblem(typedData, target.mode === "chain" ? target.contract : null);
      if (wrong) throw new Error(wrong);
      // The permit is typed data for a contract on Arc. Most wallets refuse to sign typed data for a chain other than
      // the one they are on ("chainId must match the active chain"), so move to Arc first.
      await switchToArc(walletRequest, walletName);
      let signature: unknown;
      try {
        signature = await walletRequest({ method: "eth_signTypedData_v4", params: [viewer, JSON.stringify(typedData)] });
      } catch (e) {
        throw new Error(messageOf(e, "The wallet couldn't sign the Ready permit."));
      }
      if (typeof signature !== "string") throw new Error("The wallet didn't return a signature.");
      const { request } = await api.ready(req.id, { validUntil, signature }, t);
      onUpdated(request, { tone: "mint", text: "Ready sent. The buyer can now confirm the order from their wallet, buy the voucher and hand over the code." });
    } catch (e) {
      setErr(messageOf(e, "Couldn't send Ready"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-brand/[0.05] p-3.5 ring-1 ring-brand/20">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={go} disabled={busy || signingIn} icon={busy || signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}>
          {busy || signingIn ? "Check your wallet…" : expired ? "Ready again" : "Ready"}
        </Button>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-mute">
          A free signature, no gas. It lets <span className="font-mono">{req.crypto_buyer ? short(req.crypto_buyer) : "the buyer"}</span>, and only them, bind to your order on-chain. It is valid for a few minutes; if it expires before they use it, sign again.
          {!token && " The first time, your wallet asks twice: once to sign in, once for the permit."}
        </p>
      </div>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose-ink">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------- Buyer: confirm on-chain */

/**
 * The buyer's `accept` transaction, sent with the spender's Ready permit. It binds this wallet to the order in the
 * escrow. Shown while the escrow has no buyer bound. The voucher must not be bought before this confirms.
 */
export function AcceptOnchain({ req, onDone }: { req: ApiRequest; onDone: () => void }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const permit = req.ready ?? null;
  const expired = !!permit && permit.validUntil * 1000 <= now;
  const warn = "Don't buy the voucher yet.";

  async function go() {
    if (busy || !permit) return;
    setBusy(true);
    setErr("");
    try {
      await sendEscrowStep(walletRequest, "accept", { req, from: fullAddress, wallet: walletName, permit });
      onDone();
    } catch (e) {
      setErr(messageOf(e, "Couldn't confirm the order on-chain"));
    } finally {
      setBusy(false);
    }
  }

  if (!permit || expired) {
    return (
      <div className="mt-3 rounded-2xl bg-amber/[0.06] p-3.5 text-[12.5px] leading-relaxed text-amber-ink ring-1 ring-amber/25">
        <strong className="font-medium">{warn}</strong> {permit ? "The spender's Ready permit expired before it was used. Ask them to press Ready again." : "The spender hasn't pressed Ready. Until they do and you confirm the order from your wallet, the USDC is not bound to you."}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl bg-amber/[0.06] p-3.5 ring-1 ring-amber/25">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="amber" onClick={() => void go()} disabled={busy} icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}>
          {busy ? "Check your wallet…" : "Confirm the order on-chain"}
        </Button>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-mute">
          One transaction from your wallet on {ARC.name} (a few cents of gas). It binds the locked USDC to you, so the spender can no longer cancel.
        </p>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-amber-ink">
        <strong className="font-medium">{warn}</strong> Wait until this transaction has gone through and this page says you're confirmed.
      </p>
      {busy && <p className="mt-2 text-[12px] text-mute">Waiting for the transaction to confirm. Keep this page open.</p>}
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose-ink">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ Settle / Dispute */

/** Quick reasons on the tracker, with the category the backend files each under. Anything typed by hand is "other". */
const REASONS: { text: string; category: DisputeCategory }[] = [
  { text: "The code was already redeemed", category: "already_redeemed" },
  { text: "The code is invalid", category: "invalid_code" },
  { text: "Wrong brand or amount", category: "wrong_brand" },
  { text: "The balance is lower than ordered", category: "wrong_amount" },
];

export function SettleActions({ req, token, signIn, signingIn, onUpdated }: Common) {
  const [confirming, setConfirming] = useState(false);
  const [disputing, setDisputing] = useState(false);

  if (!token) {
    return (
      <div className="mt-3 rounded-2xl bg-fg/[0.03] p-3.5 ring-1 ring-fg/[0.07]">
        <Button size="sm" variant="outline" onClick={signIn} disabled={signingIn} icon={signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}>
          {signingIn ? "Check your wallet…" : "Sign in to settle or dispute"}
        </Button>
        <p className="mt-2 text-[12px] text-mute">Signing in is a free signature. It proves this wallet is the spender.</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-fg/[0.03] p-3.5 ring-1 ring-fg/[0.07]">
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
  const { fullAddress, signMessage } = useApp();
  const [state, setState] = useState<{ kind: "hidden" } | { kind: "loading"; text: string } | { kind: "code"; code: string; pin: string | null } | { kind: "error"; message: string }>({ kind: "hidden" });

  async function show() {
    setState({ kind: "loading", text: "Fetching the sealed voucher…" });
    try {
      const { voucher } = await api.voucher(req.id, token);
      if (typeof voucher.code === "string") {
        setState({ kind: "code", code: voucher.code, pin: voucher.pin ?? null });
        return;
      }
      if (!voucher.sealed || !voucher.requester || !voucher.fulfiller) {
        throw new Error("The voucher is missing its sealed envelope.");
      }
      if (!fullAddress) throw new Error("Connect the spender wallet to unlock this code.");
      setState({ kind: "loading", text: "Sign in your wallet to unlock the code. The key never leaves this browser." });
      const keys = await unlockVault(fullAddress, token, signMessage);
      const opened = await readSealedVoucher(
        { requestId: voucher.requestId, requester: voucher.requester, fulfiller: voucher.fulfiller, sealed: voucher.sealed },
        keys,
      );
      setState({ kind: "code", code: opened.code, pin: opened.pin });
    } catch (e) {
      setState({ kind: "error", message: messageOf(e, "Couldn't load the voucher") });
    }
  }

  return (
    <div className="text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2 text-mute">
        Check the voucher before you settle. A sealed code opens only with your vault key.
        {state.kind === "code" ? (
          <button onClick={() => setState({ kind: "hidden" })} className="inline-flex items-center gap-1 text-fg/80 hover:text-fg">
            <EyeOff className="size-3.5" /> Hide
          </button>
        ) : (
          <button onClick={show} disabled={state.kind === "loading"} className="inline-flex items-center gap-1 text-brand-ink hover:brightness-110 disabled:opacity-50">
            {state.kind === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} {state.kind === "loading" ? "Unlocking…" : "Show the code"}
          </button>
        )}
      </div>
      {state.kind === "loading" && <p className="mt-1.5 text-[12px] text-amber-ink">{state.text}</p>}
      {state.kind === "code" && (
        <dl className="mt-2 space-y-1 rounded-xl bg-canvas px-3 py-2 font-mono text-[12.5px] ring-1 ring-fg/10">
          <div className="flex gap-3"><dt className="w-10 shrink-0 text-dim">Code</dt><dd className="min-w-0 break-all whitespace-pre-wrap select-all text-fg">{state.code}</dd></div>
          {state.pin && <div className="flex gap-3"><dt className="w-10 shrink-0 text-dim">PIN</dt><dd className="select-all text-fg">{state.pin}</dd></div>}
        </dl>
      )}
      {state.kind === "error" && <p role="alert" className="mt-1.5 text-[12px] text-rose-ink">{state.message}</p>}
    </div>
  );
}

function DisputeForm({ req, token, onCancel, onUpdated }: { req: ApiRequest; token: string; onCancel: () => void; onUpdated: Common["onUpdated"] }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = reason.trim().length >= 5;

  async function submit() {
    if (!ok || busy) return;
    setBusy(true);
    setErr("");
    try {
      const text = reason.trim();
      const category = REASONS.find((r) => r.text === text)?.category ?? "other";
      // The spender's wallet freezes the escrow first; the server then records why. Pressing again after a failure is
      // safe: the escrow is read first and an already-open dispute is not sent twice.
      const { mock } = await sendEscrowStep(walletRequest, "dispute", { req, from: fullAddress, wallet: walletName });
      const { request } = await api.dispute(req.id, { category, reason: text }, token);
      onUpdated(request, { tone: "rose", text: mock ? `Dispute recorded. ${MOCK_NOTE}` : "Dispute raised. The USDC stays frozen in escrow until the arbiter rules on it." });
    } catch (e) {
      setErr(messageOf(e, "Couldn't raise the dispute"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-rose/[0.05] p-3 ring-1 ring-rose/25">
      <div className="text-[12.5px] font-medium text-rose-ink">What's wrong with the voucher?</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r.text} type="button" onClick={() => setReason(r.text)} className={cx("rounded-full px-2.5 py-1 text-[11.5px] ring-1 transition", reason === r.text ? "bg-rose/15 text-rose-ink ring-rose/40" : "text-mute ring-fg/10 hover:text-fg")}>
            {r.text}
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
          className="w-full resize-none rounded-lg bg-canvas px-3 py-2 text-[13px] ring-1 ring-fg/10 outline-none placeholder:text-dim focus:ring-rose/40"
        />
      </label>
      <p className="mt-1 text-[11.5px] text-mute">Your wallet sends one transaction that freezes the escrow; no stake is needed. Raise it before the review window ends. To add screenshots, use the dispute page afterwards.</p>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose-ink">{err}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" variant="amber" onClick={submit} disabled={!ok || busy} icon={busy ? <LoaderCircle className="size-3.5 animate-spin" /> : undefined}>
          {busy ? "Check your wallet…" : "Raise dispute"}
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
  const { fullAddress, walletRequest, walletName } = useApp();
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
      // The spender's own wallet tells the escrow to pay the buyer; the server then checks the chain and records it.
      // If the release already went through (an earlier try, a closed tab), it is not sent again.
      const { tx, mock } = await sendEscrowStep(walletRequest, "release", { req, from: fullAddress, wallet: walletName });
      const { request } = await api.confirm(req.id, token);
      onClose();
      onUpdated(request, mock ? { tone: "amber", text: `Settled on the demo server. ${MOCK_NOTE}` } : { tone: "mint", text: `Settled. ${amount} was released to the buyer.`, tx: tx ?? request.releaseTxHash });
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
        This pays the buyer for the {inr(req.amountInr)} voucher. Your wallet asks you to confirm one transaction on {ARC.name}; the escrow contract then sends the locked USDC to the buyer, and <strong className="font-medium text-fg">it can't be undone</strong>.
      </p>

      <dl className="mt-4 divide-y divide-fg/[0.06] rounded-xl bg-fg/[0.03] px-3.5 text-[13px] ring-1 ring-fg/[0.07]">
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Amount</dt><dd className="font-semibold tabular">{amount}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Paid to the buyer</dt><dd className="min-w-0 break-all text-right font-mono text-[12px]" title={buyer}>{buyer ? `${short(buyer)}` : "—"}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Order</dt><dd className="font-mono text-[12px]">{req.id}</dd></div>
      </dl>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-fg/[0.03] p-3 ring-1 ring-fg/[0.07] has-[:checked]:ring-brand/40">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[#0000ff]" />
        <span className="text-[13px] leading-relaxed">I've received the voucher and checked that it works.</span>
      </label>
      <p className="mt-2 text-[12px] text-mute">If it doesn't work, close this and raise a dispute instead.</p>

      {err && <p role="alert" className="mt-3 rounded-lg bg-rose/10 px-3 py-2 text-[12.5px] text-rose-ink ring-1 ring-rose/25">{err}</p>}
      {busy && <p className="mt-3 text-[12.5px] text-amber-ink">Confirm in your wallet, then wait for {ARC.name}. This can take up to a minute. Keep this page open.</p>}

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
          <motion.div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} className="hairline relative w-full max-w-md rounded-[24px] bg-surface p-6 shadow-2xl">
            <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 grid size-7 place-items-center rounded-full text-dim hover:bg-fg/5 hover:text-fg">
              <X className="size-4" />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
