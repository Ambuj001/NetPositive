import { LoaderCircle, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import { ApiError, api, onchainStepText, type ApiRequest } from "../lib/api";
import { ARC } from "../lib/chain";
import { recordAfterTx } from "../lib/afterTx";
import { MOCK_NOTE, sendEscrowStep, stepError } from "../lib/escrowFlow";
import { useApp } from "../lib/store";
import { registerVault, sealVoucher } from "../lib/vault";
import { useWorldId } from "../lib/world";
import type { Notice } from "./TrackActions";

function messageOf(e: unknown, fallback: string) {
  if (e instanceof ApiError && !onchainStepText(e)) {
    if (e.code === "requester_vault_key_missing") return "The voucher buyer hasn't set up their vault yet. Ask them to open this order and unlock it. The code stays on this page.";
    if (e.code === "world_id_required") return "Verify with World ID before sending the code.";
    if (e.code === "fulfil_window_expired") return "The fulfil window has expired, so this code can't be submitted.";
    return e.message;
  }
  // Wallet, chain and "the chain doesn't show this step yet" errors.
  return stepError(e, fallback);
}

/** Voucher buyer, once per wallet: publish the public key the buyer will seal the code to. */
export function VaultSetup() {
  const { fullAddress, token, signIn, signingIn, signMessage, toast } = useApp();
  const [phase, setPhase] = useState<"checking" | "needed" | "ready" | "working">("checking");
  const [hint, setHint] = useState("");
  const [err, setErr] = useState("");
  const working = useRef(false);

  useEffect(() => {
    if (working.current) return;
    if (!fullAddress || !token) {
      setPhase("needed");
      return;
    }
    let cancel = false;
    api
      .getVaultKey(fullAddress, token)
      .then(() => {
        if (!cancel) setPhase("ready");
      })
      .catch((e: unknown) => {
        if (cancel || working.current) return;
        if (e instanceof ApiError && e.status === 404) setPhase("needed");
        else {
          setPhase("needed");
          setErr(messageOf(e, "Couldn't check your vault"));
        }
      });
    return () => {
      cancel = true;
    };
  }, [fullAddress, token]);

  if (phase === "checking" || phase === "ready") return null;

  async function setup() {
    setErr("");
    working.current = true;
    setPhase("working");
    try {
      const t = token ?? (await signIn());
      if (!t || !fullAddress) throw new Error("Sign in with your wallet first.");
      setHint("Checking your wallet…");
      await registerVault(fullAddress, t, signMessage, setHint);
      setHint("");
      setPhase("ready");
      toast({ title: "Vault ready", body: "The USDC buyer can now seal the voucher code to your wallet.", tone: "mint" });
    } catch (e) {
      setHint("");
      setPhase("needed");
      setErr(messageOf(e, "Couldn't set up the vault"));
    } finally {
      working.current = false;
    }
  }

  return (
    <div className="rounded-[22px] bg-brand/[0.05] p-4 ring-1 ring-brand/25">
      <div className="text-[14px] font-medium text-brand-ink">Unlock your voucher vault</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
        The USDC buyer seals the voucher code to your wallet before it is sent. Your wallet signs a message, and that signature becomes the key. It stays in this browser. The server only keeps the public key.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void setup()} disabled={phase === "working" || signingIn} icon={phase === "working" || signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}>
          {phase === "working" || signingIn ? "Check your wallet…" : token ? "Set up vault" : "Sign in and set up vault"}
        </Button>
        {hint && <p className="min-w-0 flex-1 text-[12px] text-amber-ink">{hint}</p>}
      </div>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose-ink">{err}</p>}
    </div>
  );
}

/**
 * USDC buyer, once bound on-chain: one guided step that (1) seals the code to the voucher buyer's vault key on this
 * device, (2) marks the voucher delivered on-chain from this wallet (skipped when the chain already shows it), and
 * (3) sends the sealed code to the server. Safe to press again at any point: the code stays in the box, the chain is
 * read before the transaction, and a server call that fails after the transaction is retried without paying again.
 */
type DeliverStage = "seal" | "chain" | "send";
const STAGES: { key: DeliverStage; label: string }[] = [
  { key: "seal", label: "Seal the code on this device" },
  { key: "chain", label: "Mark delivered on-chain (one transaction)" },
  { key: "send", label: "Send the sealed code" },
];

export function SubmitCode({ req, onUpdated, deliveredOnChain = false }: { req: ApiRequest; onUpdated: (request: ApiRequest, notice: Notice) => void; deliveredOnChain?: boolean }) {
  const { fullAddress, token, signIn, signingIn, humanVerified, walletRequest, walletName } = useApp();
  const { ensureHuman, withHuman, phase: worldPhase } = useWorldId();
  const [stage, setStage] = useState<DeliverStage | null>(null);
  const [chainDone, setChainDone] = useState(deliveredOnChain);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [err, setErr] = useState("");
  const [vaultMissing, setVaultMissing] = useState(false);

  useEffect(() => {
    if (deliveredOnChain) setChainDone(true);
  }, [deliveredOnChain]);

  useEffect(() => {
    if (!token || !req.crypto_spender) return;
    let cancel = false;
    api
      .getVaultKey(req.crypto_spender, token)
      .then(() => {
        if (!cancel) setVaultMissing(false);
      })
      .catch((e: unknown) => {
        if (!cancel && e instanceof ApiError && e.status === 404) setVaultMissing(true);
      });
    return () => {
      cancel = true;
    };
  }, [token, req.crypto_spender]);

  const codeOk = code.trim().length >= 4 && code.trim().length <= 400;
  const pinOk = pin.trim().length <= 32;
  const worldBusy = worldPhase !== "idle";

  async function send() {
    if (!codeOk || !pinOk || lock.current) return;
    lock.current = true;
    setBusy(true);
    setErr("");
    let tx: string | null = null;
    let onChain = chainDone;
    try {
      if (!fullAddress || fullAddress.toLowerCase() !== (req.crypto_buyer ?? "").toLowerCase()) {
        throw new Error("Connect the wallet that accepted this order. Nothing was sent.");
      }
      const t = token ?? (await signIn());
      if (!t) throw new Error("Sign in with this wallet first. Nothing was sent.");
      if (!humanVerified) {
        const ok = await ensureHuman();
        if (!ok) return;
      }
      setStage("seal");
      const sealed = await sealVoucher({
        requestId: req.id,
        spender: req.crypto_spender,
        buyer: req.crypto_buyer ?? fullAddress,
        code,
        pin: pin.trim() ? pin.trim() : null,
        token: t,
      });
      const body = sealed.legacy ? { code: code.trim(), ...(pin.trim() ? { pin: pin.trim() } : {}) } : { sealed: sealed.sealed };
      // On-chain first: the server refuses the code until the escrow shows it as delivered. Already delivered → skipped.
      setStage("chain");
      const step = await sendEscrowStep(walletRequest, "markDelivered", { req, from: fullAddress, wallet: walletName });
      tx = step.tx;
      onChain = !step.mock;
      setChainDone(true);
      setStage("send");
      // If World ID was switched on since this page loaded, the server answers world_id_required: verify, then send again.
      const submitted = await recordAfterTx(() => withHuman(() => api.submitCode(req.id, body, t)), { what: "delivery", tx, chainDone: onChain });
      if (!submitted) throw new ApiError(403, "world_id_required", "Verify with World ID before sending the code.");
      const { request } = submitted;
      setCode("");
      setPin("");
      onUpdated(request, {
        tone: step.mock ? "amber" : "mint",
        text: `${sealed.legacy ? "Code submitted. The server stored it encrypted with its own key." : "Code sealed and sent. Only the voucher buyer's vault key can open it."} ${step.mock ? MOCK_NOTE : "The escrow shows it as delivered, so the voucher buyer's review window has started."}`,
        tx,
      });
    } catch (e) {
      const text = messageOf(e, "Couldn't send the code");
      if (e instanceof ApiError && (e.status === 404 || e.code === "requester_vault_key_missing")) setVaultMissing(true);
      setErr(`${text}${onChain ? " The voucher is already marked delivered on-chain; the code is still in the box, so press the button again to send it." : ""}`);
    } finally {
      lock.current = false;
      setBusy(false);
      setStage(null);
    }
  }

  const stateOf = (k: DeliverStage) => {
    const order: DeliverStage[] = ["seal", "chain", "send"];
    if (k === "chain" && chainDone) return "done";
    if (!stage) return "todo";
    const i = order.indexOf(stage);
    const j = order.indexOf(k);
    return j < i ? "done" : j === i ? "now" : "todo";
  };

  return (
    <div className="rounded-2xl bg-amber/[0.05] p-3.5 ring-1 ring-amber/25">
      <div className="text-[13px] font-medium text-amber-ink">Submit the voucher code</div>
      <p className="mt-1 text-[12px] leading-relaxed text-mute">
        Paste the code once you've bought the voucher. It is encrypted on this device to the voucher buyer's vault key, so NetPositive can't read it. {chainDone ? "The voucher is already marked delivered on-chain, so this only sends the code." : `Your wallet confirms one transaction on ${ARC.name} that marks it delivered and starts the voucher buyer's review window.`}
      </p>
      <ol className="mt-2.5 grid gap-1 text-[12px] sm:grid-cols-3">
        {STAGES.map((st, i) => {
          const s = stateOf(st.key);
          return (
            <li key={st.key} className={s === "done" ? "text-brand-ink" : s === "now" ? "text-amber-ink" : "text-dim"}>
              {s === "done" ? "✓" : s === "now" ? "…" : `${i + 1}.`} {st.label}
            </li>
          );
        })}
      </ol>
      {vaultMissing && <p className="mt-2 text-[12px] text-amber-ink">The voucher buyer hasn't set up their vault yet. The code stays in this box until they do. Ask them to open this order.</p>}
      <label className="mt-3 block">
        <span className="label">Voucher code</span>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={2}
          maxLength={400}
          disabled={busy}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste the code from the voucher"
          aria-label="Voucher code"
          className="mt-1.5 w-full resize-none rounded-xl bg-canvas px-3 py-2 font-mono text-[13px] tracking-wide ring-1 ring-fg/10 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-dim focus:ring-amber/40"
        />
      </label>
      <label className="mt-2 block">
        <span className="label">PIN, if the voucher has one</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          maxLength={32}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          placeholder="Optional"
          aria-label="Voucher PIN"
          className="mt-1.5 h-10 w-full rounded-xl bg-canvas px-3 font-mono text-[13px] tracking-wide ring-1 ring-fg/10 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-dim focus:ring-amber/40"
        />
      </label>
      {err && <p role="alert" className="mt-2 text-[12.5px] leading-relaxed text-rose-ink">{err}</p>}
      <div className="mt-3">
        <Button size="sm" variant="amber" onClick={() => void send()} disabled={!codeOk || !pinOk || busy || worldBusy || signingIn} icon={busy || worldBusy || signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}>
          {busy ? (stage === "chain" ? "Confirm in your wallet…" : stage === "send" ? "Sending the sealed code…" : "Sealing…") : worldBusy || signingIn ? "Check your wallet…" : chainDone ? "Seal and send the code" : "Seal, mark delivered and send"}
        </Button>
      </div>
    </div>
  );
}
