import { AnimatePresence, motion } from "motion/react";
import { stakeNotice } from "../lib/disputeView";
import { usdcShort } from "../lib/terms";
import { useTerms } from "../lib/useTerms";
import { Check, Eye, EyeOff, LoaderCircle, LogOut, ShieldCheck, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx } from "../components/ui";
import { api, type ApiRequest, type DisputeCategory } from "../lib/api";
import { inr, usdt } from "../lib/engine";
import { useApp } from "../lib/store";
import { readSealedVoucher, registerVault, unlockVault } from "../lib/vault";
import { ARC, switchToArc } from "../lib/arc";
import { recordAfterTx } from "../lib/afterTx";
import { MOCK_NOTE, escrowTarget, sendEscrowStep, stepError } from "../lib/escrowFlow";

/**
 * Wallet actions on the order page. In escrow V2 each person sends their own transaction and the server only checks
 * the chain afterwards. Which of these appear is decided by `orderView` (lib/orderView.ts).
 *   voucher buyer  Ready (free signature), Cancel, Release, Dispute
 *   USDC buyer     Confirm on-chain (bind), Deliver (see VoucherTransfer), Step away, Give the money back
 * Every button is disabled while its step runs, and every step is safe to press again: the escrow is read through the
 * wallet first and a transaction that already went through is not sent twice. After a confirmed transaction the
 * server call is retried (`recordAfterTx`), and if it still fails the person is told nothing more is owed.
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
export type Notice = { tone: "mint" | "rose" | "amber" | "iris"; text: string; tx?: string | null };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const messageOf = stepError;

/** A busy flag that also refuses a second click that lands before React re-renders the disabled button. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, run };
}

/** The Ready permit must be for this network and this escrow. Anything else is refused before the wallet is asked to sign. */
function permitProblem(typedData: unknown, contract: string | null): string | null {
  const domain = (typedData as { domain?: { chainId?: unknown; verifyingContract?: unknown } } | null)?.domain;
  const chainId = Number(domain?.chainId);
  if (Number.isFinite(chainId) && chainId !== ARC.id) return `The server sent a Ready permit for chain ${chainId}, but this app is set up for ${ARC.name} (chain ${ARC.id}). Nothing was signed.`;
  const to = typeof domain?.verifyingContract === "string" ? domain.verifyingContract.toLowerCase() : null;
  if (contract && to && to !== contract.toLowerCase()) return `The server sent a Ready permit for a different contract (${to}) than this app's escrow. Nothing was signed.`;
  return null;
}

export function ActionBox({ tone = "mute", children }: { tone?: "mint" | "amber" | "rose" | "mute"; children: ReactNode }) {
  return <div className={cx("rounded-2xl p-3.5 ring-1", tone === "mint" ? "bg-brand/[0.05] ring-brand/20" : tone === "amber" ? "bg-amber/[0.06] ring-amber/25" : tone === "rose" ? "bg-rose/[0.05] ring-rose/25" : "bg-fg/[0.03] ring-fg/[0.07]")}>{children}</div>;
}

const Err = ({ text }: { text: string }) => (text ? <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-rose-ink">{text}</p> : null);
const Spin = () => <LoaderCircle className="size-3.5 animate-spin" />;

/* ------------------------------------------------------------------- Ready */

export function ReadyAction({ req, token, signIn, signingIn, onUpdated, viewer, walletRequest, again }: Common & { viewer: string; walletRequest: WalletRequest; again: boolean }) {
  const { busy, run } = useBusy();
  const [err, setErr] = useState("");
  const { signMessage, walletName } = useApp();

  const go = () =>
    run(async () => {
      setErr("");
      try {
        const t = token ?? (await signIn());
        if (!t) throw new Error("Sign in with this wallet first. Nothing was signed.");
        // "Ready" means "I can receive the code": publish this wallet's vault key first if it isn't published yet.
        await registerVault(viewer, t, signMessage);
        const target = await escrowTarget();
        const { validUntil, typedData } = await api.readyPermit(req.id, t);
        const wrong = permitProblem(typedData, target.mode === "chain" ? target.contract : null);
        if (wrong) throw new Error(wrong);
        // Most wallets refuse to sign typed data for a chain other than the one they are on, so move to Arc first.
        await switchToArc(walletRequest, walletName);
        let signature: unknown;
        try {
          signature = await walletRequest({ method: "eth_signTypedData_v4", params: [viewer, JSON.stringify(typedData)] });
        } catch (e) {
          throw new Error(messageOf(e, "The wallet couldn't sign the Ready permit."));
        }
        if (typeof signature !== "string") throw new Error("The wallet didn't return a signature. Nothing was sent.");
        const { request } = await api.ready(req.id, { validUntil, signature }, t);
        onUpdated(request, { tone: "mint", text: "Ready sent. The USDC buyer can now confirm the order from their wallet, buy your voucher and hand over the code." });
      } catch (e) {
        setErr(messageOf(e, "Couldn't send Ready"));
      }
    });

  return (
    <ActionBox tone="mint">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void go()} disabled={busy || signingIn} icon={busy || signingIn ? <Spin /> : <Check className="size-3.5" />}>
          {busy || signingIn ? "Check your wallet…" : again ? "Sign Ready again" : "Press Ready"}
        </Button>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-mute">
          A free signature, no gas. It lets the USDC buyer <span className="font-mono">{req.crypto_buyer ? short(req.crypto_buyer) : ""}</span>, and only them, bind to your order on-chain. It is valid for a few minutes; if it expires before they use it, sign again.
          {!token && " The first time, your wallet asks twice: once to sign in, once for the permit."}
        </p>
      </div>
      <Err text={err} />
    </ActionBox>
  );
}

/* ------------------------------------------------------- USDC buyer: bind */

/** The USDC buyer's `accept` transaction with the voucher buyer's Ready permit. The voucher must not be bought before this confirms. */
export function BindAction({ req, onDone }: { req: ApiRequest; onDone: (n: Notice) => void }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const { busy, run } = useBusy();
  const [err, setErr] = useState("");
  const permit = req.ready ?? null;

  const go = () =>
    run(async () => {
      setErr("");
      try {
        if (!permit) throw new Error("The voucher buyer hasn't pressed Ready. Nothing was sent.");
        const { tx, mock } = await sendEscrowStep(walletRequest, "accept", { req, from: fullAddress, wallet: walletName, permit });
        onDone({ tone: "mint", text: mock ? `Confirmed. ${MOCK_NOTE}` : "You're confirmed on-chain. The USDC is bound to you: buy the voucher now and submit its code.", tx });
      } catch (e) {
        setErr(messageOf(e, "Couldn't confirm the order on-chain"));
      }
    });

  return (
    <ActionBox tone="amber">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="amber" onClick={() => void go()} disabled={busy} icon={busy ? <Spin /> : <ShieldCheck className="size-3.5" />}>
          {busy ? "Check your wallet…" : "Confirm on-chain"}
        </Button>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-mute">One transaction on {ARC.name} (a few cents of gas, paid in USDC). It binds the locked USDC to you, so the voucher buyer can no longer cancel.</p>
      </div>
      {busy && <p className="mt-2 text-[12px] text-mute">Waiting for the transaction to confirm. Keep this page open.</p>}
      <Err text={err} />
    </ActionBox>
  );
}

/* ---------------------------------------------------- voucher buyer: cancel */

/**
 * Cancel. With a deposit, the voucher buyer's wallet sends `cancel` first and the USDC comes straight back; the server
 * is told afterwards. Without a deposit there is no transaction.
 */
export function CancelAction({ req, token, signIn, signingIn, withTx, locked, onUpdated }: Common & { withTx: boolean; locked: string }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useBusy();
  const [err, setErr] = useState("");

  const go = () =>
    run(async () => {
      setErr("");
      try {
        const t = token ?? (await signIn());
        if (!t) throw new Error("Sign in with this wallet first. Nothing was sent.");
        const { tx, mock } = withTx ? await sendEscrowStep(walletRequest, "cancel", { req, from: fullAddress, wallet: walletName }) : { tx: null, mock: false };
        const { request } = await recordAfterTx(() => api.cancel(req.id, t), { what: "cancel", tx, chainDone: withTx && !mock });
        setConfirming(false);
        onUpdated(request, { tone: mock ? "amber" : "mint", text: mock ? `Order cancelled. ${MOCK_NOTE}` : withTx ? `Order cancelled. The escrow returned ${locked} to your wallet.` : "Order cancelled. Nothing was locked.", tx });
      } catch (e) {
        setErr(messageOf(e, "Couldn't cancel"));
      }
    });

  return (
    <div>
      {!confirming ? (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={signingIn} icon={<X className="size-3.5" />}>
          {withTx ? "Cancel and get my USDC back" : "Cancel this order"}
        </Button>
      ) : (
        <ActionBox tone="amber">
          <p className="text-[12.5px] leading-relaxed">{withTx ? `Your wallet confirms one transaction on ${ARC.name}. The escrow then returns ${locked}, fee included, to your wallet. This works only while no USDC buyer is bound on-chain.` : "No USDC was deposited, so there is no transaction."}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="amber" onClick={() => void go()} disabled={busy || signingIn} icon={busy || signingIn ? <Spin /> : <X className="size-3.5" />}>
              {busy || signingIn ? "Check your wallet…" : withTx ? "Yes, cancel and refund me" : "Yes, cancel"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep the order
            </Button>
          </div>
        </ActionBox>
      )}
      <Err text={err} />
    </div>
  );
}

/* ------------------------------------- USDC buyer: step away / give it back */

/**
 * `unassign` (step away, before delivery) or `concede` (give the money back, after delivery or during a dispute).
 * Both are wallet-only: the server notices on its next sweep, so the page just refreshes.
 */
export function BuyerExit({ req, kind, onDone }: { req: ApiRequest; kind: "unassign" | "concede"; onDone: (n: Notice) => void }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useBusy();
  const [err, setErr] = useState("");
  const amount = `${usdt(Number(req.amountUsdc) || 0)} USDC`;
  const copy =
    kind === "unassign"
      ? { button: "Step away from this order", icon: <LogOut className="size-3.5" />, yes: "Yes, step away", text: `You give up this order before delivering. The order goes back to the book for another USDC buyer (or back to the voucher buyer when it expires). You won't be paid ${amount}. Don't buy the voucher after this.` }
      : { button: "Give the money back", icon: <Undo2 className="size-3.5" />, yes: "Yes, refund the voucher buyer", text: `The escrow returns all the locked USDC to the voucher buyer and you are not paid ${amount}. Use this if the voucher didn't work or you can't deliver. It can't be undone.` };

  const go = () =>
    run(async () => {
      setErr("");
      try {
        const { tx, mock } = await sendEscrowStep(walletRequest, kind, { req, from: fullAddress, wallet: walletName });
        setConfirming(false);
        onDone({ tone: "amber", text: mock ? `Done. ${MOCK_NOTE}` : kind === "unassign" ? "You stepped away from this order on-chain. The order page updates within a minute or two." : "The USDC was returned to the voucher buyer on-chain. The order page updates within a minute or two.", tx });
      } catch (e) {
        setErr(messageOf(e, kind === "unassign" ? "Couldn't step away" : "Couldn't give the money back"));
      }
    });

  return (
    <div>
      {!confirming ? (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} icon={copy.icon}>
          {copy.button}
        </Button>
      ) : (
        <ActionBox tone="rose">
          <p className="text-[12.5px] leading-relaxed">{copy.text} Your wallet confirms one transaction on {ARC.name}.</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="amber" onClick={() => void go()} disabled={busy} icon={busy ? <Spin /> : undefined}>
              {busy ? "Check your wallet…" : copy.yes}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Not now
            </Button>
          </div>
        </ActionBox>
      )}
      <Err text={err} />
    </div>
  );
}

/* ------------------------------------------------------------ Release / Dispute */

/** Quick reasons, with the category the backend files each under. Anything typed by hand is "other". */
const REASONS: { text: string; category: DisputeCategory }[] = [
  { text: "The code was already redeemed", category: "already_redeemed" },
  { text: "The code is invalid", category: "invalid_code" },
  { text: "Wrong brand or amount", category: "wrong_brand" },
  { text: "The balance is lower than ordered", category: "wrong_amount" },
];

export function SettleActions({ req, token, signIn, signingIn, onUpdated, canDispute, codeIn }: Common & { canDispute: boolean; codeIn: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [disputing, setDisputing] = useState(false);

  if (!token) {
    return (
      <ActionBox>
        <Button size="sm" variant="outline" onClick={() => void signIn()} disabled={signingIn} icon={signingIn ? <Spin /> : undefined}>
          {signingIn ? "Check your wallet…" : canDispute ? "Sign in to release or dispute" : "Sign in to release"}
        </Button>
        <p className="mt-2 text-[12px] text-mute">Signing in is a free signature. It proves this wallet is the voucher buyer.</p>
      </ActionBox>
    );
  }

  return (
    <div className="space-y-3">
      {codeIn && <VoucherPeek req={req} token={token} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { setDisputing(false); setConfirming(true); }} icon={<ShieldCheck className="size-3.5" />}>
          Release the USDC
        </Button>
        {canDispute && (
          <Button size="sm" variant="outline" onClick={() => setDisputing((v) => !v)} className={cx(disputing && "ring-rose/40")}>
            Raise a dispute
          </Button>
        )}
      </div>
      {disputing && <DisputeForm req={req} token={token} onCancel={() => setDisputing(false)} onUpdated={onUpdated} />}
      <ConfirmSettle req={req} token={token} open={confirming} onClose={() => setConfirming(false)} onUpdated={onUpdated} codeIn={codeIn} />
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
      if (!voucher.sealed || !voucher.requester || !voucher.fulfiller) throw new Error("The voucher is missing its sealed envelope.");
      if (!fullAddress) throw new Error("Connect the voucher buyer's wallet to unlock this code.");
      setState({ kind: "loading", text: "Sign in your wallet to unlock the code. The key never leaves this browser." });
      const keys = await unlockVault(fullAddress, token, signMessage);
      const opened = await readSealedVoucher({ requestId: voucher.requestId, requester: voucher.requester, fulfiller: voucher.fulfiller, sealed: voucher.sealed }, keys);
      setState({ kind: "code", code: opened.code, pin: opened.pin });
    } catch (e) {
      setState({ kind: "error", message: messageOf(e, "Couldn't load the voucher") });
    }
  }

  return (
    <ActionBox>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-mute">
        Check the voucher before you release. A sealed code opens only with your vault key.
        {state.kind === "code" ? (
          <button onClick={() => setState({ kind: "hidden" })} className="inline-flex items-center gap-1 text-fg/80 hover:text-fg">
            <EyeOff className="size-3.5" /> Hide
          </button>
        ) : (
          <button onClick={() => void show()} disabled={state.kind === "loading"} className="inline-flex items-center gap-1 text-brand-ink hover:brightness-110 disabled:opacity-50">
            {state.kind === "loading" ? <Spin /> : <Eye className="size-3.5" />} {state.kind === "loading" ? "Unlocking…" : "Show the code"}
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
    </ActionBox>
  );
}

function DisputeForm({ req, token, onCancel, onUpdated }: { req: ApiRequest; token: string; onCancel: () => void; onUpdated: Common["onUpdated"] }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [reason, setReason] = useState("");
  const { busy, run } = useBusy();
  const [err, setErr] = useState("");
  const { terms } = useTerms();
  const ok = reason.trim().length >= 5;

  const submit = () =>
    run(async () => {
      if (!ok) return;
      setErr("");
      try {
        const text = reason.trim();
        const category = REASONS.find((r) => r.text === text)?.category ?? "other";
        // The wallet freezes the escrow first; the server then records why. A dispute already open on-chain is not sent twice.
        const { tx, mock } = await sendEscrowStep(walletRequest, "dispute", { req, from: fullAddress, wallet: walletName });
        const { request } = await recordAfterTx(() => api.dispute(req.id, { category, reason: text }, token), { what: "dispute", tx, chainDone: !mock });
        onUpdated(request, { tone: "rose", text: mock ? `Dispute recorded. ${MOCK_NOTE}` : "Dispute raised. The USDC stays frozen in escrow until the arbiter rules on it.", tx });
      } catch (e) {
        setErr(messageOf(e, "Couldn't raise the dispute"));
      }
    });

  return (
    <ActionBox tone="rose">
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
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} placeholder="Describe the problem (at least 5 characters)" className="w-full resize-none rounded-lg bg-canvas px-3 py-2 text-[13px] ring-1 ring-fg/10 outline-none placeholder:text-dim focus:ring-rose/40" />
      </label>
      <p className="mt-1 text-[11.5px] text-mute">Your wallet freezes the escrow with a transaction. {stakeNotice(terms?.disputeBond ?? null, usdcShort)} Raise it before the review window ends. To add screenshots, use the dispute page afterwards.</p>
      <Err text={err} />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" variant="amber" onClick={() => void submit()} disabled={!ok || busy} icon={busy ? <Spin /> : undefined}>
          {busy ? "Check your wallet…" : "Raise dispute"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </ActionBox>
  );
}

/* --------------------------------------------------------- Release confirmation */

function ConfirmSettle({ req, token, open, onClose, onUpdated, codeIn }: { req: ApiRequest; token: string; open: boolean; onClose: () => void; onUpdated: Common["onUpdated"]; codeIn: boolean }) {
  const { fullAddress, walletRequest, walletName } = useApp();
  const [checked, setChecked] = useState(false);
  const { busy, run } = useBusy();
  const [err, setErr] = useState("");
  const amount = `${usdt(Number(req.amountUsdc) || 0)} USDC`;
  const buyer = req.crypto_buyer ?? "";

  useEffect(() => {
    if (open) {
      setChecked(false);
      setErr("");
    }
  }, [open]);

  const release = () =>
    run(async () => {
      if (!checked) return;
      setErr("");
      try {
        // The wallet tells the escrow to pay the USDC buyer; the server then checks the chain and records it.
        // A release that already went through (an earlier try, a closed tab) is not sent again.
        const { tx, mock } = await sendEscrowStep(walletRequest, "release", { req, from: fullAddress, wallet: walletName });
        const { request } = await recordAfterTx(() => api.confirm(req.id, token), { what: "release", tx, chainDone: !mock });
        onClose();
        onUpdated(request, mock ? { tone: "amber", text: `Released on the demo server. ${MOCK_NOTE}` } : { tone: "mint", text: `Released. ${amount} was paid to the USDC buyer.`, tx: tx ?? request.releaseTxHash });
      } catch (e) {
        setErr(messageOf(e, "The release failed"));
      }
    });

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} labelledBy="settle-title">
      <h2 id="settle-title" className="font-display text-[20px] font-semibold tracking-tight">
        Release {amount} to the USDC buyer?
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-mute">
        This pays the USDC buyer for the {inr(req.amountInr)} voucher. Your wallet asks you to confirm one transaction on {ARC.name}; the escrow then sends the locked USDC to them, and <strong className="font-medium text-fg">it can't be undone</strong>.
      </p>
      {!codeIn && <p className="mt-2 rounded-lg bg-amber/10 px-3 py-2 text-[12.5px] text-amber-ink ring-1 ring-amber/25">The code hasn't arrived on NetPositive yet. Release only if you already have a working voucher.</p>}
      <dl className="mt-4 divide-y divide-fg/[0.06] rounded-xl bg-fg/[0.03] px-3.5 text-[13px] ring-1 ring-fg/[0.07]">
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Amount</dt><dd className="font-semibold tabular">{amount}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-mute">Paid to the USDC buyer</dt><dd className="min-w-0 break-all text-right font-mono text-[12px]" title={buyer}>{buyer ? short(buyer) : "—"}</dd></div>
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
        <Button size="sm" onClick={() => void release()} disabled={!checked || busy} icon={busy ? <Spin /> : undefined}>
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
          <motion.div ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} className="hairline relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[24px] bg-surface p-6 shadow-2xl">
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
