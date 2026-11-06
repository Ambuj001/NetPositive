import { useState } from "react";
import { ApiError, api } from "./api";
import { lockUsdc, mockTxHash } from "./escrow";
import { useApp } from "./store";
import { useWorldId } from "./world";
import type { Order } from "./data";

/**
 * Create an order, lock the USDC in escrow and publish it. One implementation shared by the assistant chat and the
 * custom-order panel, so both go through the same sign-in, World ID, wallet and server steps.
 *
 * Steps: sign in -> World ID (once) -> POST /requests -> approve + deposit from the wallet -> POST /requests/:id/fund.
 * If the deposit already went through but publishing failed, `held` remembers it so the next try only publishes.
 */
export type LockPhase = "create" | "lock" | "publish";

export type LockArgs = {
  /** Brand id the backend knows (amazon, flipkart, myntra, blinkit, ...). */
  brandApi: string;
  /** Brand id used by the UI (for the local fallback order). */
  brandId: string;
  amountInr: number;
  /** INR per USDC, shown on the order. */
  rate: number;
  /** USDC to lock (buyer receives + fee). */
  usdcLock: number;
};

export type LockResult =
  | { kind: "live"; id: string }
  | { kind: "local"; order: Order };

/** Decimal string with up to 6 places and no trailing zeros, as the order API expects. */
export function amountUsdc(n: number) {
  const trimmed = n.toFixed(6).replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

export function useLockOrder() {
  const { fullAddress, humanVerified, openWallet, token, signIn, postOrder, toast, walletRequest } = useApp();
  const { verifyHuman } = useWorldId();
  const [phase, setPhase] = useState<LockPhase | null>(null);
  const [error, setError] = useState("");
  const [held, setHeld] = useState<{ id: string; txHash: string; auth: string } | null>(null);

  const reset = () => setError("");

  /** Resolves to the outcome, or null if the user was sent to connect/verify or something failed (see `error`). */
  async function run(a: LockArgs): Promise<LockResult | null> {
    if (phase) return null;

    // The deposit already went through earlier; only publishing is left.
    if (held) {
      setError("");
      setPhase("publish");
      try {
        const funded = await api.fund(held.id, held.txHash, held.auth);
        setHeld(null);
        setPhase(null);
        return { kind: "live", id: funded.request.id };
      } catch (e) {
        setPhase(null);
        setError(e instanceof Error ? e.message : "Couldn't publish the order.");
        return null;
      }
    }

    if (!fullAddress) {
      openWallet();
      return null;
    }
    setError("");
    setPhase("create");
    let createdId = "";
    let deposited = false;
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
      const created = await api.create({ brand: a.brandApi, amountInr: a.amountInr, amountUsdc: amountUsdc(a.usdcLock) }, auth);
      createdId = created.request.id;
      setPhase("lock");
      const txHash = created.escrowContract
        ? await lockUsdc(walletRequest, {
            from: fullAddress,
            escrow: created.escrowContract,
            escrowId: created.request.escrowId,
            amountBaseUnits: created.request.amountUsdcBaseUnits,
          })
        : mockTxHash();
      deposited = Boolean(created.escrowContract);
      if (deposited) setHeld({ id: createdId, txHash, auth });
      setPhase("publish");
      const funded = await api.fund(createdId, txHash, auth);
      setHeld(null);
      setPhase(null);
      return { kind: "live", id: funded.request.id };
    } catch (e) {
      if (createdId && !deposited && auth) await api.cancel(createdId, auth).catch(() => undefined);
      if (e instanceof ApiError && e.code === "unreachable") {
        const local = postOrder({ brandId: a.brandId, amount: a.amountInr, rate: a.rate }, a.usdcLock);
        setPhase(null);
        toast({ title: "Saved on this device", body: "The order book server didn't answer, so nothing was locked on Arc.", tone: "amber" });
        return { kind: "local", order: local };
      }
      setPhase(null);
      const message = e instanceof Error ? e.message : "Couldn't post the order.";
      setError(deposited ? `${message} The USDC deposit already went through, so this order was left in place.` : message);
      return null;
    }
  }

  return { run, reset, phase, error, held };
}
