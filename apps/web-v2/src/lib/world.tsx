import { IDKitErrorCodes, IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type ApiUser } from "./api";
import { useApp } from "./store";
import { walletMessage } from "./wallet";
import { cx } from "../components/ui";

/**
 * Proof of Human, once, bound to the signed-in wallet.
 * Passport and Selfie Check are the wrong check here: the product needs a
 * stable nullifier so a banned person cannot come back on a new wallet.
 */

const APP_ID = readAppId();
const ACTION = ((import.meta.env.VITE_WORLD_ID_ACTION as string | undefined) ?? "").trim() || "netpositive-account";
const RP_ID = ((import.meta.env.VITE_WORLD_ID_RP_ID as string | undefined) ?? "").trim();
const ENVIRONMENT = readEnv();

export type WorldOutcome = "cancelled" | "rejected" | "unavailable" | "ineligible";
export type WorldPhase = "idle" | "signing" | "world";

export type WorldNotice = {
  outcome: WorldOutcome;
  title: string;
  detail: string;
};

type WorldCtx = {
  /** Opens Proof of Human. Resolves true only after the server accepts the proof. */
  verifyHuman: () => Promise<boolean>;
  phase: WorldPhase;
  notice: WorldNotice | null;
  clearNotice: () => void;
};

const Ctx = createContext<WorldCtx | null>(null);

type RpSignatureResponse = {
  sig?: string;
  signature?: string;
  nonce?: string;
  created_at?: number;
  expires_at?: number;
  rp_id?: string;
};

const CANCELLED: WorldNotice = {
  outcome: "cancelled",
  title: "Verification cancelled",
  detail: "You closed World ID before it finished. You can keep browsing. Posting or accepting an order stays locked until Proof of Human succeeds.",
};

const INELIGIBLE: WorldNotice = {
  outcome: "ineligible",
  title: "This person already has an account",
  detail: "This World ID is linked to another wallet. One human, one account, so a banned trader can't start over. This wallet can browse, but it can't post or accept.",
};

function readAppId(): `app_${string}` {
  const id = ((import.meta.env.VITE_WORLD_ID_APP_ID as string | undefined) ?? "").trim() || "app_ee3eaaf80b272b3dff6854c30744dd65";
  return (id.startsWith("app_") ? id : "app_invalid") as `app_${string}`;
}

function readEnv(): "production" | "staging" | "sandbox" {
  const value = ((import.meta.env.VITE_WORLD_ID_ENV as string | undefined) ?? "").trim();
  if (value === "production" || value === "sandbox" || value === "staging") return value;
  return "staging";
}

function isWalletReject(error: unknown) {
  const e = error as { code?: number; message?: string };
  return e?.code === 4001 || /reject|denied|cancel/i.test(e?.message ?? "");
}

function toNotice(error: unknown): WorldNotice {
  if (!(error instanceof ApiError)) {
    return { outcome: "rejected", title: "Couldn't verify", detail: "World ID didn't finish. You can try again, or keep browsing." };
  }
  if (error.code === "user_rejected") {
    return {
      outcome: "cancelled",
      title: "Sign-in cancelled",
      detail: "You declined the wallet signature. Nothing was checked. You can keep browsing. Posting and accepting stay locked.",
    };
  }
  if (error.code === "world_id_already_used") return INELIGIBLE;
  if (error.code === "wallet_already_verified") {
    return {
      outcome: "ineligible",
      title: "Wallet already linked",
      detail: "This wallet is linked to a different World ID. One human, one account.",
    };
  }
  if (error.code === "not_configured" || error.code === "unreachable" || error.status === 404) {
    return { outcome: "unavailable", title: "World ID isn't ready", detail: error.message };
  }
  return { outcome: "rejected", title: "Proof rejected", detail: error.message };
}

function mapIdKit(code: IDKitErrorCodes, prior: WorldNotice | null): WorldNotice {
  if (prior) return prior;
  switch (code) {
    case IDKitErrorCodes.Cancelled:
    case IDKitErrorCodes.UserRejected:
      return CANCELLED;
    case IDKitErrorCodes.CredentialUnavailable:
    case IDKitErrorCodes.WorldId3NotAvailable:
    case IDKitErrorCodes.WorldId4NotAvailable:
      return {
        outcome: "unavailable",
        title: "Proof of Human unavailable",
        detail: "This World ID doesn't have Proof of Human, the one credential this step needs. You can keep browsing. This wallet can't post or accept yet.",
      };
    case IDKitErrorCodes.ConnectionFailed:
    case IDKitErrorCodes.Timeout:
      return {
        outcome: "unavailable",
        title: "World App didn't connect",
        detail: "The check didn't finish. Open World App and try again, or keep browsing without posting or accepting.",
      };
    case IDKitErrorCodes.VerificationRejected:
    case IDKitErrorCodes.InclusionProofFailed:
    case IDKitErrorCodes.MaxVerificationsReached:
      return {
        outcome: "rejected",
        title: "Proof rejected",
        detail: "World ID rejected this proof. You can try again. Until it succeeds, this wallet can't post or accept an order.",
      };
    default:
      return prior ?? { outcome: "rejected", title: "Verification didn't finish", detail: "World ID returned an error. You can try again, or keep browsing. Posting and accepting stay locked." };
  }
}

export function WorldIdProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;

  const [phase, setPhase] = useState<WorldPhase>("idle");
  const [notice, setNotice] = useState<WorldNotice | null>(null);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<RpContext | null>(null);

  const tokenRef = useRef<string | null>(null);
  const requestRef = useRef<RpContext | null>(null);
  const pendingRef = useRef<((ok: boolean) => void) | null>(null);
  const noticeRef = useRef<WorldNotice | null>(null);
  const succeededRef = useRef(false);
  const runRef = useRef(false);
  tokenRef.current = app.token;

  const clearNotice = useCallback(() => {
    noticeRef.current = null;
    setNotice(null);
  }, []);

  const preset = useMemo(() => proofOfHuman({ signal: app.fullAddress || undefined }), [app.fullAddress]);

  const ensureSession = useCallback(async () => {
    const { fullAddress, token, signMessage, applySession } = appRef.current;
    if (token) return { token, already: appRef.current.humanVerified };
    const { message } = await api<{ message: string }>("/auth/nonce", { body: { address: fullAddress } });
    let signature: string;
    try {
      signature = await signMessage(message);
    } catch (error) {
      if (isWalletReject(error)) {
        throw new ApiError(400, "user_rejected", "You declined the wallet signature.");
      }
      throw new ApiError(400, "wallet_sign_failed", walletMessage(error));
    }
    const res = await api<{ token: string; user: ApiUser }>("/auth/verify", { body: { address: fullAddress, signature } });
    const verified = !!res.user.worldIdNullifier;
    tokenRef.current = res.token;
    applySession(fullAddress, res.token, verified);
    return { token: res.token, already: verified };
  }, []);

  const fetchSignature = useCallback(async (token: string) => {
    if (!APP_ID.startsWith("app_") || APP_ID === "app_invalid") {
      throw new ApiError(0, "not_configured", "Set VITE_WORLD_ID_APP_ID to the app id from the Developer Portal.");
    }
    let body: RpSignatureResponse;
    try {
      body = await api<RpSignatureResponse>("/world-id/rp-signature", { token, body: { action: ACTION } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "not_configured", "The server can't sign a World ID request yet. Proof of Human stays locked until that route exists. You can keep browsing.");
      }
      throw error;
    }
    const rpId = (body.rp_id || RP_ID).trim();
    const signature = body.sig || body.signature || "";
    const createdAt = Number(body.created_at);
    const expiresAt = Number(body.expires_at);
    if (!rpId) {
      throw new ApiError(0, "not_configured", "Add VITE_WORLD_ID_RP_ID from the Developer Portal. The server also needs the RP signing key before Proof of Human can start.");
    }
    if (!signature || !body.nonce || !Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) {
      throw new ApiError(502, "bad_signature", "The server didn't return a usable World ID request signature.");
    }
    return { rp_id: rpId, nonce: body.nonce, created_at: createdAt, expires_at: expiresAt, signature } satisfies RpContext;
  }, []);

  const verifyHuman = useCallback(async () => {
    if (runRef.current) return false;
    const current = appRef.current;
    if (!current.fullAddress) {
      current.openWallet();
      return false;
    }
    if (current.humanVerified) return true;

    runRef.current = true;
    succeededRef.current = false;
    noticeRef.current = null;
    setNotice(null);
    setPhase("signing");
    try {
      const session = await ensureSession();
      tokenRef.current = session.token;
      if (session.already) return true;
      const rp = await fetchSignature(session.token);
      requestRef.current = rp;
      setRequest(rp);
      setPhase("world");
      appRef.current.closeWallet();
      setOpen(true);
      return await new Promise<boolean>((resolve) => {
        pendingRef.current = resolve;
      });
    } catch (error) {
      const next = toNotice(error);
      noticeRef.current = next;
      setNotice(next);
      return false;
    } finally {
      runRef.current = false;
      setPhase("idle");
    }
  }, [ensureSession, fetchSignature]);

  const handleVerify = useCallback(async (result: IDKitResult) => {
    const token = tokenRef.current;
    const address = appRef.current.fullAddress;
    const rpId = requestRef.current?.rp_id;
    if (!token || !address || !rpId) {
      const next = toNotice(new ApiError(401, "unauthorized", "Sign in again, then retry World ID."));
      noticeRef.current = next;
      throw new Error(next.detail);
    }
    try {
      const res = await api<{ verified?: boolean; user?: ApiUser }>("/world-id/verify", {
        token,
        body: { rp_id: rpId, idkitResponse: result },
      });
      const verified = !!res.user?.worldIdNullifier || res.verified === true;
      if (!verified) throw new ApiError(400, "world_id_invalid", "World ID did not accept this proof.");
      appRef.current.applySession(address, token, true);
      succeededRef.current = true;
    } catch (error) {
      const next = toNotice(error);
      noticeRef.current = next;
      throw new Error(next.detail);
    }
  }, []);

  const onSuccess = useCallback(() => {
    succeededRef.current = true;
  }, []);

  const onError = useCallback((code: IDKitErrorCodes) => {
    noticeRef.current = mapIdKit(code, noticeRef.current);
  }, []);

  const onOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen || !pendingRef.current) return;
    const resolve = pendingRef.current;
    pendingRef.current = null;
    if (succeededRef.current) {
      succeededRef.current = false;
      noticeRef.current = null;
      setNotice(null);
      appRef.current.toast({
        title: "Verified human",
        body: "Proof of Human is bound to this wallet. You can post and accept orders.",
        tone: "iris",
      });
      resolve(true);
      return;
    }
    const next = noticeRef.current ?? CANCELLED;
    noticeRef.current = next;
    setNotice(next);
    resolve(false);
  }, []);

  const value = useMemo<WorldCtx>(() => ({ verifyHuman, phase, notice, clearNotice }), [verifyHuman, phase, notice, clearNotice]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {request && (
        <IDKitRequestWidget
          key={request.nonce}
          open={open}
          onOpenChange={onOpenChange}
          app_id={APP_ID}
          action={ACTION}
          action_description="Prove you are one unique person. NetPositive binds this proof to your wallet so a banned account cannot come back."
          rp_context={request}
          allow_legacy_proofs
          environment={ENVIRONMENT}
          preset={preset}
          handleVerify={handleVerify}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}
    </Ctx.Provider>
  );
}

export function useWorldId() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorldId outside provider");
  return ctx;
}

export function WorldIdNotice({ className }: { className?: string }) {
  const { notice, clearNotice } = useWorldId();
  if (!notice) return null;
  const tone = notice.outcome === "cancelled" || notice.outcome === "ineligible" ? "ring-amber/30" : "ring-rose/30";
  return (
    <div className={cx("glass rounded-2xl p-4 ring-1", tone, className)} role="status">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium">{notice.title}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{notice.detail}</p>
        </div>
        <button onClick={clearNotice} className="grid size-7 shrink-0 place-items-center rounded-full text-mute hover:bg-white/5 hover:text-fg" aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
