import { stakeNotice } from "../lib/disputeView";
import { usdcShort } from "../lib/terms";
import { useTerms } from "../lib/useTerms";
import { AlertTriangle, Check, Copy, Eye, EyeOff, LogOut, ShieldAlert, ShieldCheck, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Callout, Dialog, Spinner, cx } from "../components/ui";
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

/** A secondary action: a quiet text button for the "More actions" row under the primary button. */
export function QuietButton({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-mute ring-1 ring-line transition-colors duration-200 hover:bg-sunken hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&>svg]:size-3.5">
      {icon}
      {children}
    </button>
  );
}

/** The error of the step just tried, directly under its button. Cleared when the step is tried again. */
const Err = ({ text, className }: { text: string; className?: string }) =>
  text ? (
    <Callout tone="rose" role="alert" icon={<AlertTriangle />} className={cx("mt-3", className)}>
      {text}
    </Callout>
  ) : null;
const Hint = ({ children }: { children: ReactNode }) => <p className="mt-2 text-[12px] leading-relaxed text-mute">{children}</p>;
const Spin = () => <Spinner />;

/** Key/value rows inside a confirmation: what will happen, in numbers. */
function Facts({ rows }: { rows: [string, ReactNode, string?][] }) {
  return (
    <dl className="well divide-y divide-line px-3.5 text-[13px]">
      {rows.map(([k, v, title]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-mute">{k}</dt>
          <dd className="min-w-0 truncate text-right tabular" title={title}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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
    <div>
      <Button onClick={() => void go()} pending={busy || signingIn} icon={<Check className="size-4" />}>
        {busy || signingIn ? "Check your wallet…" : again ? "Sign Ready again" : "Press Ready"}
      </Button>
      <Err text={err} />
      <Hint>
        Free, no gas. Only the USDC buyer <span className="font-mono">{req.crypto_buyer ? short(req.crypto_buyer) : ""}</span> can use it, for a few minutes.
        {!token && " Your wallet asks twice the first time: sign in, then the permit."}
      </Hint>
    </div>
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
    <div>
      <Button onClick={() => void go()} pending={busy} icon={<ShieldCheck className="size-4" />}>
        {busy ? "Check your wallet…" : "Confirm on-chain"}
      </Button>
      <Err text={err} />
      <Hint>{busy ? "Waiting for the transaction to confirm. Keep this page open." : `One transaction on ${ARC.name}, a few cents of gas in USDC.`}</Hint>
    </div>
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

  const working = busy || signingIn;
  return (
    <>
      <QuietButton onClick={() => { setErr(""); setConfirming(true); }} disabled={signingIn} icon={<X />}>
        {withTx ? "Cancel and get my USDC back" : "Cancel this order"}
      </QuietButton>
      <Dialog
        open={confirming}
        onClose={() => { setErr(""); setConfirming(false); }}
        dismissible={!working}
        icon={<X />}
        title={withTx ? "Cancel and get your USDC back?" : "Cancel this order?"}
        description={withTx ? `Your wallet confirms one transaction on ${ARC.name}. The escrow then returns ${locked}, fee included, to your wallet. This works only while no USDC buyer is bound on-chain.` : "No USDC was deposited, so there is no transaction."}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setErr(""); setConfirming(false); }} disabled={working}>
              Keep the order
            </Button>
            <Button variant="dark" onClick={() => void go()} pending={working}>
              {working ? "Check your wallet…" : withTx ? "Yes, cancel and refund me" : "Yes, cancel"}
            </Button>
          </>
        }
      >
        {withTx && <Facts rows={[["Returned to you", locked], ["Order", <span className="font-mono text-[12px]">{req.id}</span>, req.id]]} />}
        {working && <p className="mt-3 text-[12.5px] text-mute">Confirm in your wallet, then wait for {ARC.name}. Keep this page open.</p>}
        <Err text={err} />
      </Dialog>
    </>
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
      ? { button: "Step away from this order", title: "Step away from this order?", icon: <LogOut />, yes: "Yes, step away", text: `You give up this order before delivering. The order goes back to the book for another USDC buyer (or back to the voucher buyer when it expires). You won't be paid ${amount}. Don't buy the voucher after this.` }
      : { button: "Give the money back", title: "Give the money back?", icon: <Undo2 />, yes: "Yes, refund the voucher buyer", text: `The escrow returns all the locked USDC to the voucher buyer and you are not paid ${amount}. Use this if the voucher didn't work or you can't deliver. It can't be undone.` };

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
    <>
      <QuietButton onClick={() => { setErr(""); setConfirming(true); }} icon={copy.icon}>
        {copy.button}
      </QuietButton>
      <Dialog
        open={confirming}
        onClose={() => { setErr(""); setConfirming(false); }}
        dismissible={!busy}
        icon={copy.icon}
        title={copy.title}
        description={`${copy.text} Your wallet confirms one transaction on ${ARC.name}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setErr(""); setConfirming(false); }} disabled={busy}>
              Not now
            </Button>
            <Button variant="dark" onClick={() => void go()} pending={busy}>
              {busy ? "Check your wallet…" : copy.yes}
            </Button>
          </>
        }
      >
        <Facts rows={[["You give up", amount], ["Order", <span className="font-mono text-[12px]">{req.id}</span>, req.id]]} />
        {busy && <p className="mt-3 text-[12.5px] text-mute">Confirm in your wallet, then wait for {ARC.name}. Keep this page open.</p>}
        <Err text={err} />
      </Dialog>
    </>
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

/**
 * Release. `quiet` when releasing isn't the step this state is waiting for (e.g. the voucher buyer may release early
 * while the USDC buyer is still delivering): then it is a text button in the "More actions" row.
 */
export function SettleActions({ req, token, signIn, signingIn, onUpdated, codeIn, quiet = false }: Common & { codeIn: boolean; quiet?: boolean }) {
  const [confirming, setConfirming] = useState(false);

  if (quiet) {
    return (
      <>
        <QuietButton onClick={() => (token ? setConfirming(true) : void signIn())} disabled={signingIn} icon={signingIn ? <Spin /> : <ShieldCheck className="size-3.5" />}>
          {signingIn ? "Check your wallet…" : token ? "Release the USDC now" : "Sign in to release"}
        </QuietButton>
        {token && <ConfirmSettle req={req} token={token} open={confirming} onClose={() => setConfirming(false)} onUpdated={onUpdated} codeIn={codeIn} />}
      </>
    );
  }

  if (!token) {
    return (
      <div>
        <Button onClick={() => void signIn()} pending={signingIn}>
          {signingIn ? "Check your wallet…" : "Sign in to release"}
        </Button>
        <Hint>A free signature that proves this wallet is the voucher buyer.</Hint>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {codeIn && <VoucherPeek req={req} token={token} />}
      <Button onClick={() => setConfirming(true)} icon={<ShieldCheck className="size-4" />}>
        Release the USDC
      </Button>
      <ConfirmSettle req={req} token={token} open={confirming} onClose={() => setConfirming(false)} onUpdated={onUpdated} codeIn={codeIn} />
    </div>
  );
}

/** Dispute, as a quiet text button that opens the form under the "More actions" row. */
export function DisputeAction({ req, token, signIn, signingIn, onUpdated }: Common) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QuietButton onClick={() => (token ? setOpen(true) : void signIn())} disabled={signingIn} icon={signingIn ? <Spin /> : <ShieldAlert />}>
        {signingIn ? "Check your wallet…" : token ? "Raise a dispute" : "Sign in to dispute"}
      </QuietButton>
      {token && <DisputeForm req={req} token={token} open={open} onCancel={() => setOpen(false)} onUpdated={onUpdated} />}
    </>
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

  // The sealed code, as a dark "LED" slip: hidden until asked for, revealed with a short fade.
  return (
    <div className="overflow-hidden rounded-xl bg-ink text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] tracking-[0.12em] text-white/50 uppercase">Voucher code</div>
          <div className="mt-0.5 text-[12.5px] text-white/70">Check the voucher before you release.</div>
        </div>
        {state.kind === "code" ? (
          <button onClick={() => setState({ kind: "hidden" })} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-white/80 ring-1 ring-white/20 transition-colors hover:bg-white/10 hover:text-white">
            <EyeOff className="size-3.5" /> Hide
          </button>
        ) : (
          <button onClick={() => void show()} disabled={state.kind === "loading"} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-white/90 disabled:opacity-60">
            {state.kind === "loading" ? <Spin /> : <Eye className="size-3.5" />} {state.kind === "loading" ? "Unlocking…" : "Show the code"}
          </button>
        )}
      </div>
      {state.kind === "loading" && <p className="np-fade-in border-t border-white/10 px-4 py-2.5 text-[12px] text-white/60">{state.text}</p>}
      {state.kind === "code" && (
        <dl className="np-fade-in led-bg space-y-2 border-t border-white/10 px-4 py-3.5 font-mono">
          <div className="flex items-start gap-3">
            <dt className="w-9 shrink-0 pt-0.5 text-[10.5px] tracking-[0.12em] text-white/45 uppercase">Code</dt>
            <dd className="min-w-0 flex-1 text-[15px] tracking-[0.06em] break-all whitespace-pre-wrap select-all">{state.code}</dd>
            <CopyCode text={state.code} label="Copy the code" />
          </div>
          {state.pin && (
            <div className="flex items-start gap-3">
              <dt className="w-9 shrink-0 pt-0.5 text-[10.5px] tracking-[0.12em] text-white/45 uppercase">PIN</dt>
              <dd className="min-w-0 flex-1 text-[15px] tracking-[0.06em] select-all">{state.pin}</dd>
              <CopyCode text={state.pin} label="Copy the PIN" />
            </div>
          )}
        </dl>
      )}
      {state.kind === "error" && (
        <p role="alert" className="np-fade-in border-t border-white/10 px-4 py-2.5 text-[12.5px] text-[#ff9b9e]">
          {state.message}
        </p>
      )}
    </div>
  );
}

function CopyCode({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="grid size-7 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
    >
      {ok ? <Check className="size-3.5 text-pos" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function DisputeForm({ req, token, open, onCancel, onUpdated }: { req: ApiRequest; token: string; open: boolean; onCancel: () => void; onUpdated: Common["onUpdated"] }) {
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
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      size="md"
      icon={<ShieldAlert />}
      title="What's wrong with the voucher?"
      description={`Your wallet freezes the escrow with a transaction. ${stakeNotice(terms?.disputeBond ?? null, usdcShort)} Raise it before the review window ends. To add screenshots, use the dispute page afterwards.`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="dark" onClick={() => void submit()} disabled={!ok} pending={busy}>
            {busy ? "Check your wallet…" : "Raise dispute"}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r.text} type="button" onClick={() => setReason(r.text)} disabled={busy} aria-pressed={reason === r.text} className={cx("h-8 rounded-full px-3 text-[12.5px] ring-1 transition-colors duration-200", reason === r.text ? "bg-brand-soft text-brand-ink ring-brand/40" : "text-mute ring-line-2 hover:bg-sunken hover:text-fg")}>
            {r.text}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-[12.5px] text-mute">Describe the problem</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={4} disabled={busy} placeholder="At least 5 characters" className="field resize-none px-3.5 py-2.5" />
      </label>
      <Err text={err} />
    </Dialog>
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
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      icon={<ShieldCheck />}
      title={`Release ${amount} to the USDC buyer?`}
      description={
        <>
          This pays the USDC buyer for the {inr(req.amountInr)} voucher. Your wallet asks you to confirm one transaction on {ARC.name}; the escrow then sends the locked USDC to them, and <strong className="font-medium text-fg">it can't be undone</strong>.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Not yet
          </Button>
          <Button onClick={() => void release()} disabled={!checked} pending={busy}>
            {busy ? "Releasing…" : `Release ${amount}`}
          </Button>
        </>
      }
    >
      {!codeIn && (
        <Callout tone="amber" icon={<AlertTriangle />} className="mb-3">
          The code hasn't arrived on NetPositive yet. Release only if you already have a working voucher.
        </Callout>
      )}
      <Facts
        rows={[
          ["Amount", <span className="font-semibold">{amount}</span>],
          ["Paid to the USDC buyer", <span className="font-mono text-[12px]">{buyer ? short(buyer) : "—"}</span>, buyer],
          ["Order", <span className="font-mono text-[12px]">{req.id}</span>, req.id],
        ]}
      />
      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line-2 transition-colors has-[:checked]:bg-brand-soft has-[:checked]:ring-brand/40">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[#0000ff]" />
        <span className="text-[13px] leading-relaxed">I've received the voucher and checked that it works.</span>
      </label>
      <p className="mt-2 text-[12px] text-mute">If it doesn't work, close this and raise a dispute instead.</p>
      <Err text={err} />
      {busy && <p className="mt-3 text-[12.5px] text-mute">Confirm in your wallet, then wait for {ARC.name}. This can take up to a minute. Keep this page open.</p>}
    </Dialog>
  );
}
