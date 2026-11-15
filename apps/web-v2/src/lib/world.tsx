import { IDKitErrorCodes, IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type ApiUser } from "./api";
import { useApp } from "./store";
import { walletMessage } from "./wallet";
import { cx } from "../components/ui";

/**
 * Proof of Human, once, bound to the signed-in wallet.
 * Passport and Selfie Check are the wrong check here: the product needs a
 * stable nullifier so a banned person cannot come back on a new wallet.
 */

/** Values the app falls back to when the server's /world-id/config can't be read. The server is the source of truth. */
const ENV_DEFAULTS = {
  app_id: readAppId(),
  action: ((import.meta.env.VITE_WORLD_ID_ACTION as string | undefined) ?? "").trim() || "netpositive-account",
  rp_id: ((import.meta.env.VITE_WORLD_ID_RP_ID as string | undefined) ?? "").trim(),
  environment: readEnv(),
};

export type WorldConfig = {
  app_id: `app_${string}`;
  action: string;
  rp_id: string;
  environment: "production" | "staging" | "sandbox";
  /** Server has the RP id and signing key. */
  ready: boolean;
  /** Server runs WORLD_ID_DEV_BYPASS (local only): no World App step. */
  bypass: boolean;
  /** Why the server's World ID settings can't work, in plain words. */
  problem: string | null;
  /** Loaded from the server (false = fallback values). */
  fromServer: boolean;
  /**
   * Whether trading needs a World ID right now. An administrator can switch it off on the server; the app then skips
   * the World ID step. Missing from the server's answer (older server) or unknown (server unreachable) counts as true.
   */
  required: boolean;
};

let configPromise: Promise<WorldConfig> | null = null;
/** One fetch per page load. Keeps the app's app_id / action / environment identical to what the server will check. */
export function loadWorldConfig(): Promise<WorldConfig> {
  configPromise ??= api<{ required?: boolean; app_id?: string; rp_id?: string | null; action?: string; environment?: string; ready?: boolean; bypass?: boolean; problem?: string | null }>("/world-id/config")
    .then((c) => ({
      app_id: (c.app_id?.startsWith("app_") ? c.app_id : ENV_DEFAULTS.app_id) as `app_${string}`,
      action: c.action || ENV_DEFAULTS.action,
      rp_id: c.rp_id || ENV_DEFAULTS.rp_id,
      environment: c.environment === "production" || c.environment === "sandbox" || c.environment === "staging" ? c.environment : ENV_DEFAULTS.environment,
      ready: !!c.ready,
      bypass: !!c.bypass,
      problem: typeof c.problem === "string" ? c.problem : null,
      fromServer: true,
      required: c.required !== false,
    }))
    .catch(() => {
      configPromise = null; // try again next time
      return { ...ENV_DEFAULTS, ready: false, bypass: LOCAL_BYPASS, problem: null, fromServer: false, required: true };
    });
  return configPromise;
}

export type WorldOutcome = "cancelled" | "rejected" | "unavailable" | "ineligible";
export type WorldPhase = "idle" | "signing" | "world";

export type WorldNotice = {
  outcome: WorldOutcome;
  title: string;
  detail: string;
};

type WorldCtx = {
  /** Server-side World ID settings, once loaded. */
  config: WorldConfig | null;
  /**
   * False only when the server has said World ID is switched off. While the settings load, or when the server can't be
   * read, it is true, so the app behaves as it always has.
   */
  required: boolean;
  /** Reads /world-id/config again. Keeps the last answer from the server when the server can't be reached. */
  refreshConfig: () => Promise<WorldConfig>;
  /** Opens Proof of Human. Resolves true only after the server accepts the proof. */
  verifyHuman: () => Promise<boolean>;
  /**
   * The World ID step before posting, funding, accepting or delivering. Resolves true straight away when the wallet is
   * verified or when the server has World ID switched off (read fresh, so an administrator's change applies at once);
   * otherwise runs `verifyHuman`. Does not sign in when it skips the step.
   */
  ensureHuman: () => Promise<boolean>;
  /**
   * Runs a server call. If the server answers 403 `world_id_required` (an administrator switched World ID on since the
   * page loaded), runs the normal verify flow and tries the call once more. Resolves null when verification didn't finish.
   */
  withHuman: <T>(run: () => Promise<T>) => Promise<T | null>;
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

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** "Already linked" tells the person exactly which wallet holds their World ID and which one they are using now. */
function alreadyLinked(error: ApiError, connected?: string): WorldNotice {
  const d = (error.details ?? {}) as { linkedWallet?: string };
  const linked = typeof d.linkedWallet === "string" ? d.linkedWallet : null;
  const here = connected ? shortAddr(connected) : null;
  return {
    outcome: "ineligible",
    title: "This person already has an account",
    detail: linked
      ? `This World ID is already linked to ${shortAddr(linked)}${here ? `, and you're connected as ${here}` : ""}. It's one person, one account: switch to ${shortAddr(linked)}, or use a different World ID. This wallet can browse, but it can't post or accept.`
      : "This World ID is already linked to another wallet. It's one person, one account. This wallet can browse, but it can't post or accept.",
  };
}

/**
 * LOCAL DEVELOPMENT ONLY. With VITE_WORLD_ID_BYPASS=true the app skips the World ID widget and asks the backend to register the
 * wallet directly (the backend must also run WORLD_ID_DEV_BYPASS=true). `import.meta.env.DEV` is false in a production build,
 * so this can never be switched on in a deployed app.
 */
const LOCAL_BYPASS = import.meta.env.DEV && (import.meta.env.VITE_WORLD_ID_BYPASS as string | undefined) === "true";

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

/** Where in the flow something failed. The same server error means different things before and after the World App step. */
type Stage = "signin" | "request" | "proof";

const STAGE_TITLE: Record<Stage, string> = {
  signin: "Couldn't sign in",
  request: "Couldn't start World ID",
  proof: "Couldn't finish verification",
};

function toNotice(error: unknown, connected?: string, stage: Stage = "proof"): WorldNotice {
  if (!(error instanceof ApiError)) {
    const text = error instanceof Error && error.message ? ` (${error.message.slice(0, 140)})` : "";
    return { outcome: "rejected", title: STAGE_TITLE[stage], detail: `Something failed in this browser before the server was asked${text}. You can try again, or keep browsing.` };
  }
  const d = (error.details ?? {}) as { ref?: string; code?: string | null };
  switch (error.code) {
    case "user_rejected":
      return { outcome: "cancelled", title: "Sign-in cancelled", detail: "You declined the wallet signature. Nothing was checked. You can keep browsing. Posting and accepting stay locked." };
    case "wallet_sign_failed":
      return { outcome: "rejected", title: "Your wallet couldn't sign in", detail: error.message };
    case "world_id_already_used":
      return alreadyLinked(error, connected);
    case "wallet_already_verified":
      return { outcome: "ineligible", title: "Wallet already linked", detail: "This wallet is linked to a different World ID. One human, one account." };
    case "not_configured":
      return { outcome: "unavailable", title: "World ID isn't set up on the server", detail: error.message };
    case "unreachable":
      return { outcome: "unavailable", title: "Can't reach the NetPositive server", detail: error.message };
    case "world_id_unreachable":
      return { outcome: "unavailable", title: "World's verifier didn't answer", detail: `${error.message} Your proof wasn't rejected; nothing was linked. Try again.` };
    case "world_id_rejected":
      return {
        outcome: "rejected",
        title: "World didn't accept this proof",
        detail: `${error.message}${d.code ? ` (${d.code})` : ""}. In test mode, use the World ID Simulator and pick an Orb-verified identity.`,
      };
    case "world_id_credential":
      return { outcome: "unavailable", title: "Proof of Human needed", detail: "That identity isn't Orb-verified. In the simulator, choose an Orb-verified identity; in World App, verify at an Orb first." };
    case "world_id_signal":
      return { outcome: "rejected", title: "Proof was made for another wallet", detail: "The wallet changed while World ID was open. Keep the same wallet connected and try again." };
    case "world_id_environment":
    case "world_id_action":
    case "world_id_rp":
    case "world_id_action_mismatch":
      return { outcome: "unavailable", title: "App and server settings don't match", detail: `${error.message}. Reload the page so the app picks up the server's World ID settings, then try again.` };
    case "world_id_store_failed":
      return { outcome: "rejected", title: "Couldn't save the verification", detail: error.message };
    case "validation_error":
      return { outcome: "rejected", title: "Unexpected proof format", detail: `The server couldn't read the result from World${Array.isArray(error.details) && error.details[0]?.path ? ` (${error.details[0].path})` : ""}. Update the app and server to the same version.` };
    case "banned":
      return { outcome: "ineligible", title: "This account is banned", detail: "It can browse, but it can't post or accept orders." };
  }
  if (error.status === 401) return { outcome: "cancelled", title: "Sign-in expired", detail: "Your session ended. Press Verify again and sign the message in your wallet." };
  if (error.status === 404) return { outcome: "unavailable", title: "World ID isn't set up on the server", detail: "This server version has no World ID route. Update the backend." };
  if (error.status >= 500)
    return {
      outcome: "unavailable",
      title: STAGE_TITLE[stage],
      detail:
        stage === "proof"
          ? `The server failed after World answered${d.ref ? ` (ref ${d.ref})` : ""}. Your proof wasn't judged; nothing was linked. Try again, and if it repeats, the server log has the cause${d.ref ? ` under that ref` : ""}.`
          : `The server failed before the World App step${d.ref ? ` (ref ${d.ref})` : ""}. This isn't about your proof. Check the server log${d.ref ? " for that ref" : ""}.`,
    };
  return { outcome: "rejected", title: STAGE_TITLE[stage], detail: `${error.message} (${error.code})` };
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
  const [config, setConfig] = useState<WorldConfig | null>(null);
  const configRef = useRef<WorldConfig | null>(null);
  useEffect(() => {
    let live = true;
    void loadWorldConfig().then((c) => {
      if (!live) return;
      configRef.current = c;
      setConfig(c);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Asks the server again. A failed read keeps the last answer the server gave, so a network blip doesn't flip the setting. */
  const refreshConfig = useCallback(async () => {
    configPromise = null;
    const c = await loadWorldConfig();
    const prev = configRef.current;
    const next = !c.fromServer && prev?.fromServer ? prev : c;
    configRef.current = next;
    setConfig(next);
    return next;
  }, []);

  // An administrator can switch the requirement on or off while the app is open: read it again when the tab comes back
  // into view, and every few minutes while it is visible.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void refreshConfig();
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(onVisible, 120_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [refreshConfig]);

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

  const ensureSession = useCallback(async (fresh = false) => {
    const { fullAddress, token, signMessage, applySession } = appRef.current;
    if (token && !fresh) return { token, already: appRef.current.humanVerified };
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

  const fetchSignature = useCallback(async (token: string, cfg: WorldConfig) => {
    if (!cfg.app_id.startsWith("app_") || cfg.app_id === "app_invalid") {
      throw new ApiError(0, "not_configured", "Set WORLD_ID_APP_ID to the app id from the World Developer Portal.");
    }
    if (cfg.fromServer && !cfg.ready) {
      if (cfg.problem) throw new ApiError(503, "not_configured", cfg.problem);
      throw new ApiError(
        503,
        "not_configured",
        "The server has no World ID keys yet. Add WORLD_ID_RP_ID and WORLD_ID_SIGNING_KEY to backend/.env (World Developer Portal → your app → World ID 4.0), or for local testing set WORLD_ID_DEV_BYPASS=true and restart the backend.",
      );
    }
    let body: RpSignatureResponse;
    try {
      body = await api<RpSignatureResponse>("/world-id/rp-signature", { token, body: { action: cfg.action } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw new ApiError(404, "not_configured", "The server can't sign a World ID request yet. Proof of Human stays locked until that route exists. You can keep browsing.");
      }
      throw error;
    }
    const rpId = (body.rp_id || cfg.rp_id).trim();
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
    let stage: Stage = "signin";
    try {
      let session = await ensureSession();
      tokenRef.current = session.token;
      if (session.already) return true;
      stage = "request";
      // Settings are re-read on every attempt so a server that was just fixed works without a page reload.
      const cfg = await refreshConfig();
      // A saved session can be stale (expired, or the server was restarted). Sign in again once instead of failing.
      const withSession = async <T,>(run: (token: string) => Promise<T>): Promise<T> => {
        try {
          return await run(session.token);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 401) throw e;
          stage = "signin";
          session = await ensureSession(true);
          tokenRef.current = session.token;
          stage = "request";
          return run(session.token);
        }
      };
      if (cfg.bypass) {
        await withSession((t) => api("/world-id/verify", { token: t, body: {} }));
        appRef.current.applySession(appRef.current.fullAddress, session.token, true);
        appRef.current.toast({ title: "Registered (dev bypass)", body: "World ID was skipped for local testing. This wallet counts as a verified human.", tone: "amber" });
        return true;
      }
      const rp = await withSession((t) => fetchSignature(t, cfg));
      requestRef.current = rp;
      setRequest(rp);
      setPhase("world");
      appRef.current.closeWallet();
      setOpen(true);
      return await new Promise<boolean>((resolve) => {
        pendingRef.current = resolve;
      });
    } catch (error) {
      const next = toNotice(error, appRef.current.fullAddress, stage);
      noticeRef.current = next;
      setNotice(next);
      return false;
    } finally {
      runRef.current = false;
      setPhase("idle");
    }
  }, [ensureSession, fetchSignature, refreshConfig]);

  const ensureHuman = useCallback(async () => {
    if (appRef.current.humanVerified) return true;
    const cfg = await refreshConfig();
    if (!cfg.required) return true;
    return verifyHuman();
  }, [refreshConfig, verifyHuman]);

  const withHuman = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T | null> => {
      try {
        return await run();
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "world_id_required") throw error;
        // The server needs World ID after all: remember that, then the usual verify flow, then one more try.
        const cfg = await refreshConfig();
        if (!cfg.required) {
          const forced = { ...cfg, required: true };
          configRef.current = forced;
          setConfig(forced);
        }
        if (!(await verifyHuman())) return null;
        return run();
      }
    },
    [refreshConfig, verifyHuman],
  );

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
      const next = toNotice(error, address);
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

  const required = config?.required !== false;
  const value = useMemo<WorldCtx>(
    () => ({ config, required, refreshConfig, verifyHuman, ensureHuman, withHuman, phase, notice, clearNotice }),
    [config, required, refreshConfig, verifyHuman, ensureHuman, withHuman, phase, notice, clearNotice],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {request && (
        <IDKitRequestWidget
          key={request.nonce}
          open={open}
          onOpenChange={onOpenChange}
          app_id={config?.app_id ?? ENV_DEFAULTS.app_id}
          action={config?.action ?? ENV_DEFAULTS.action}
          action_description="Prove you are one unique person. NetPositive binds this proof to your wallet so a banned account cannot come back."
          rp_context={request}
          allow_legacy_proofs
          environment={config?.environment ?? ENV_DEFAULTS.environment}
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

/**
 * For copy that describes the product (landing, docs, privacy): true only once the server has confirmed World ID is
 * required. While unknown or switched off, pages phrase the check as something that applies "when it is switched on",
 * so they never claim humans-only while it is off.
 */
export function useWorldIdOn() {
  const { config } = useWorldId();
  return !!config?.fromServer && config.required;
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
        <button onClick={clearNotice} className="grid size-7 shrink-0 place-items-center rounded-full text-mute hover:bg-fg/5 hover:text-fg" aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
