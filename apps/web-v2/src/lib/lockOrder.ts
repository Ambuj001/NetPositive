import { useState } from "react";
import { api } from "./api";
import { PendingTxError, lockTerms, lockUsdc, mockTxHash, usdcExact, type Terms } from "./escrow";
import { escrowTarget, stepError, targetFrom } from "./escrowFlow";
import { useApp } from "./store";
import { useWorldId } from "./world";

/**
 * Create an order, lock the USDC in escrow and publish it. One implementation shared by the assistant chat and the
 * custom-order panel, so both go through the same sign-in, World ID, wallet and server steps.
 *
 * Steps: sign in -> World ID (once) -> POST /requests (the server answers with fee and total) -> check those against
 * what was on screen -> approve + deposit from the wallet -> POST /requests/:id/fund.
 * If the deposit was sent but publishing didn't finish, `held` remembers it so the next try only publishes.
 * Nothing here ever pretends: with no server, or no escrow configured, it stops with an error.
 */
export type LockPhase = "create" | "lock" | "publish";

export type LockArgs = {
  /** Brand id the backend knows (amazon, flipkart, myntra, blinkit, ...). */
  brandApi: string;
  amountInr: number;
  /** USDC the buyer receives, as shown on screen. This is what the order asks the server for. */
  usdcReceives: number;
  /** USDC the screen said will be locked (buyer receives + fee). Checked against the server's total. */
  usdcTotal: number;
};

/** `mock` is true only on a development server with the mock escrow: the order exists, but no USDC moved. */
export type LockResult = { id: string; mock: boolean; total: string };

/** The server's own numbers for this order, as text, shown before the wallet prompt. */
export type ServerTerms = { receives: string; fee: string; total: string };

/** Decimal string with up to 6 places and no trailing zeros, as the order API expects. */
export function amountUsdc(n: number) {
  const trimmed = n.toFixed(6).replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

type Held = { id: string; txHash: string; auth: string; total: string };

export function useLockOrder() {
  const { fullAddress, humanVerified, openWallet, token, signIn, walletRequest, walletName } = useApp();
  const { verifyHuman } = useWorldId();
  const [phase, setPhase] = useState<LockPhase | null>(null);
  const [error, setError] = useState("");
  const [held, setHeld] = useState<Held | null>(null);
  const [terms, setTerms] = useState<ServerTerms | null>(null);

  const reset = () => {
    setError("");
    if (!held) setTerms(null);
  };

  /** The deposit was sent earlier; only publishing is left. If it failed on-chain after all, say so and let go of it. */
  async function publishHeld(h: Held): Promise<LockResult | null> {
    setError("");
    setPhase("publish");
    try {
      const receipt = (await walletRequest({ method: "eth_getTransactionReceipt", params: [h.txHash] }).catch(() => undefined)) as { status?: string } | null | undefined;
      if (receipt && receipt.status === "0x0") {
        await api.cancel(h.id, h.auth).catch(() => undefined);
        setHeld(null);
        setTerms(null);
        setPhase(null);
        setError("The deposit transaction failed on-chain, so nothing was locked. Start the order again.");
        return null;
      }
      if (receipt === null) {
        setPhase(null);
        setError("The deposit is still pending in your wallet. Wait for it to confirm, then publish.");
        return null;
      }
      const funded = await api.fund(h.id, h.txHash, h.auth);
      setHeld(null);
      setPhase(null);
      return { id: funded.request.id, mock: false, total: h.total };
    } catch (e) {
      setPhase(null);
      setError(stepError(e, "Couldn't publish the order."));
      return null;
    }
  }

  /** Resolves to the outcome, or null if the user was sent to connect/verify or something failed (see `error`). */
  async function run(a: LockArgs): Promise<LockResult | null> {
    if (phase) return null;
    if (held) return publishHeld(held);

    if (!fullAddress) {
      openWallet();
      return null;
    }
    setError("");
    setTerms(null);
    setPhase("create");
    let createdId = "";
    let sentHash = "";
    let confirmed = false;
    let total = "";
    let auth = token;
    try {
      if (!auth) auth = await signIn();
      if (!auth) {
        setPhase(null);
        return null;
      }
      if (!humanVerified) {
        const ok = await verifyHuman();
        if (!ok) {
          setPhase(null);
          return null;
        }
      }
      // Ask the server how its escrow is set up before creating anything: wrong chain, wrong contract or (in a
      // production build) no escrow at all stops here.
      await escrowTarget();
      const shown = { receives: amountUsdc(a.usdcReceives), total: amountUsdc(a.usdcTotal) };
      // `amountUsdc` is what the buyer receives. The server adds the fee and tells us the total.
      const created = await api.create({ brand: a.brandApi, amountInr: a.amountInr, amountUsdc: shown.receives }, auth);
      createdId = created.request.id;
      const target = targetFrom({ chainId: created.escrow?.chainId, contract: created.escrow?.contract ?? created.escrowContract });

      if (target.mode === "mock") {
        // Development only: a mock server records the order without a chain. `targetFrom` already throws for this in
        // a production build, and the placeholder hash is compiled out of one, so a build can never fake a lock.
        const placeholder = import.meta.env.DEV ? mockTxHash() : "";
        if (!placeholder) throw new Error("Escrow is not configured on the server. Nothing was locked.");
        setPhase("publish");
        const funded = await api.fund(createdId, placeholder, auth);
        setPhase(null);
        return { id: funded.request.id, mock: true, total: shown.total };
      }

      const escrow = created.escrow;
      if (!escrow || escrow.version !== 2) throw new Error("The server didn't describe a version 2 escrow for this order, so the app stopped before asking your wallet. Nothing was locked.");
      if (!created.request.escrowRef) throw new Error("The server didn't send the escrow reference for this order. Nothing was locked.");
      const t: Terms = lockTerms(shown, created.request);
      total = usdcExact(t.total);
      setTerms({ receives: usdcExact(t.amount), fee: usdcExact(t.fee), total });

      setPhase("lock");
      const txHash = await lockUsdc(walletRequest, {
        from: fullAddress,
        escrow: target.contract,
        escrowRef: created.request.escrowRef,
        escrowId: created.request.escrowId,
        token: escrow.token,
        amount: t.amount,
        total: t.total,
        ttlSeconds: escrow.ttlSeconds,
        wallet: walletName,
        onDepositHash: (h) => {
          sentHash = h;
        },
      });
      confirmed = true;
      setHeld({ id: createdId, txHash, auth, total });
      setPhase("publish");
      const funded = await api.fund(createdId, txHash, auth);
      setHeld(null);
      setPhase(null);
      return { id: funded.request.id, mock: false, total };
    } catch (e) {
      setPhase(null);
      const message = stepError(e, "Couldn't post the order.");
      if (confirmed) {
        setError(`${message} The USDC deposit already went through, so this order was left in place. Press Publish to finish.`);
      } else if (sentHash && e instanceof PendingTxError && auth) {
        // Sent but not confirmed yet: keep the order and the hash, so the deposit is never orphaned or paid twice.
        setHeld({ id: createdId, txHash: sentHash, auth, total });
        setError("Your deposit was sent but hasn't confirmed yet. Keep this window open, wait for your wallet to show it confirmed, then press Publish.");
      } else {
        if (createdId && auth) await api.cancel(createdId, auth).catch(() => undefined);
        setTerms(null);
        setError(message);
      }
      return null;
    }
  }

  return { run, reset, phase, error, held, terms };
}
