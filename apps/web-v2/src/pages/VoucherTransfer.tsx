import { LoaderCircle, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import { ApiError, api, type ApiRequest } from "../lib/api";
import { useApp } from "../lib/store";
import { registerVault, sealVoucher } from "../lib/vault";
import { useWorldId } from "../lib/world";
import type { Notice } from "./TrackActions";

function messageOf(e: unknown, fallback: string) {
  if ((e as { code?: number })?.code === 4001) return "You declined the request in your wallet.";
  if (e instanceof ApiError) {
    if (e.code === "requester_vault_key_missing") return "The spender hasn't set up their vault yet. Ask them to open this order and unlock it. The code stays on this page.";
    if (e.code === "world_id_required") return "Verify with World ID before sending the code.";
    if (e.code === "fulfil_window_expired") return "The fulfil window has expired, so this code can't be submitted.";
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Spender, once per wallet: publish the public key the buyer will seal the code to. */
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
      toast({ title: "Vault ready", body: "The buyer can now seal the voucher code to your wallet.", tone: "mint" });
    } catch (e) {
      setHint("");
      setPhase("needed");
      setErr(messageOf(e, "Couldn't set up the vault"));
    } finally {
      working.current = false;
    }
  }

  return (
    <div className="rounded-[22px] bg-mint/[0.05] p-4 ring-1 ring-mint/25">
      <div className="text-[14px] font-medium text-mint">Unlock your voucher vault</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
        The buyer seals the voucher code to your wallet before it is sent. Your wallet signs a message, and that signature becomes the key. It stays in this browser. The server only keeps the public key.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void setup()} disabled={phase === "working" || signingIn} icon={phase === "working" || signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}>
          {phase === "working" || signingIn ? "Check your wallet…" : token ? "Set up vault" : "Sign in and set up vault"}
        </Button>
        {hint && <p className="min-w-0 flex-1 text-[12px] text-amber">{hint}</p>}
      </div>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose">{err}</p>}
    </div>
  );
}

/** Buyer, during the fulfil window: seal the code to the spender and submit it. */
export function SubmitCode({ req, onUpdated }: { req: ApiRequest; onUpdated: (request: ApiRequest, notice: Notice) => void }) {
  const { fullAddress, token, signIn, signingIn, humanVerified } = useApp();
  const { verifyHuman, phase: worldPhase } = useWorldId();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [vaultMissing, setVaultMissing] = useState(false);

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
    if (!codeOk || !pinOk || busy) return;
    setBusy(true);
    setErr("");
    try {
      if (!fullAddress || fullAddress.toLowerCase() !== (req.crypto_buyer ?? "").toLowerCase()) {
        throw new Error("Connect the wallet that accepted this order.");
      }
      const t = token ?? (await signIn());
      if (!t) throw new Error("Sign in with your wallet first.");
      if (!humanVerified) {
        const ok = await verifyHuman();
        if (!ok) return;
      }
      const sealed = await sealVoucher({
        requestId: req.id,
        spender: req.crypto_spender,
        buyer: req.crypto_buyer ?? fullAddress,
        code,
        pin: pin.trim() ? pin.trim() : null,
        token: t,
      });
      const body = sealed.legacy ? { code: code.trim(), ...(pin.trim() ? { pin: pin.trim() } : {}) } : { sealed: sealed.sealed };
      const { request } = await api.submitCode(req.id, body, t);
      setCode("");
      setPin("");
      onUpdated(request, {
        tone: "mint",
        text: sealed.legacy
          ? "Code submitted. The server stored it encrypted with its own key."
          : "Code sealed and sent. Only the spender's vault key can open it.",
      });
    } catch (e) {
      const text = messageOf(e, "Couldn't send the code");
      if (e instanceof ApiError && (e.status === 404 || e.code === "requester_vault_key_missing")) setVaultMissing(true);
      setErr(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-amber/[0.05] p-3.5 ring-1 ring-amber/25">
      <div className="text-[13px] font-medium text-amber">Seal the voucher code</div>
      <p className="mt-1 text-[12px] leading-relaxed text-mute">
        The code is encrypted on this device to the spender's vault key, then sent. The server stores the locked box and cannot read it.
      </p>
      {vaultMissing && (
        <p className="mt-2 text-[12px] text-amber">The spender hasn't set up their vault yet. The code stays in this box until they do. Ask them to open this order.</p>
      )}
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
          className="mt-1.5 w-full resize-none rounded-xl bg-ink px-3 py-2 font-mono text-[13px] tracking-wide ring-1 ring-white/10 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-dim focus:ring-amber/40"
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
          className="mt-1.5 h-10 w-full rounded-xl bg-ink px-3 font-mono text-[13px] tracking-wide ring-1 ring-white/10 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-dim focus:ring-amber/40"
        />
      </label>
      {err && <p role="alert" className="mt-2 text-[12.5px] text-rose">{err}</p>}
      <div className="mt-3">
        <Button size="sm" variant="amber" onClick={() => void send()} disabled={!codeOk || !pinOk || busy || worldBusy || signingIn} icon={busy || worldBusy || signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}>
          {busy ? "Sealing and sending…" : worldBusy || signingIn ? "Check your wallet…" : "Seal and send"}
        </Button>
      </div>
    </div>
  );
}
