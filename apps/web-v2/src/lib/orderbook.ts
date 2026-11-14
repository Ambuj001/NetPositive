import { useCallback, useEffect, useState } from "react";
import { api, brandIdFromApi, type ApiRequest } from "./api";
import type { Order } from "./data";
import { DEMO_ORDERS } from "./demoOrders";
import { round2 } from "./engine";
import { initiatorOf } from "./suggestions";
import { shortAddr } from "./wallet";

/** "demo" exists only under `vite dev`. In a production build an unreachable server is "offline" and the book is empty. */
export type Source = "loading" | "live" | "demo" | "offline";

/** Firestore request → order-book row. Rate is the INR per USDC implied by the request. */
export function toOrder(r: ApiRequest): Order {
  const usdc = Number(r.amountUsdc) || 0;
  const created = r.createdAt ? Date.parse(r.createdAt) : Date.now();
  return {
    id: r.id,
    brandId: brandIdFromApi(r.brand),
    amount: r.amountInr,
    rate: usdc ? Math.round((r.amountInr / usdc) * 100) / 100 : 0,
    seller: shortAddr(r.crypto_spender),
    spender: r.crypto_spender || undefined,
    initiator: initiatorOf(r),
    sellerTrades: 0,
    city: "",
    postedMin: Math.max(0, Math.round((Date.now() - created) / 60000)),
    expiresMin: 30,
  };
}

const base = (v: string | undefined) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) / 1e6 : null);

/**
 * Ledger taken from the stored request. `amountUsdc` is what the buyer receives; the fee and the total come from the
 * server (`feeUsdcBaseUnits`, `totalUsdcBaseUnits`). Orders from before escrow V2 have no fee fields, so their fee
 * shows as zero rather than a guess.
 */
export function ledgerFromRequest(r: ApiRequest) {
  const buyerReceives = base(r.amountUsdcBaseUnits) ?? (Number(r.amountUsdc) || 0);
  const fee = base(r.feeUsdcBaseUnits) ?? 0;
  const sellerLocks = base(r.totalUsdcBaseUnits) ?? round2(buyerReceives + fee);
  const rate = buyerReceives ? Math.round((r.amountInr / buyerReceives) * 100) / 100 : 0;
  return { buyerReceives, fee, sellerLocks, sellerEffective: sellerLocks ? round2(r.amountInr / sellerLocks) : 0, rate };
}

/**
 * Open requests from the backend (`GET /requests`). When the server can't be reached the book is empty and says so.
 * Only under `vite dev` do labelled sample orders stand in, so the pages can be worked on without a backend.
 */
export function useOrderBook(pollMs = 15000) {
  const [live, setLive] = useState<Order[] | null>(null);
  const [source, setSource] = useState<Source>("loading");

  const load = useCallback(async () => {
    try {
      const { requests } = await api.listOpen(50);
      setLive(requests.map(toOrder));
      setSource("live");
    } catch {
      setLive(null);
      setSource(import.meta.env.DEV ? "demo" : "offline");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  const orders = source === "live" && live ? live : source === "demo" && import.meta.env.DEV ? DEMO_ORDERS : [];
  return { orders, source, reload: load };
}
