import { useCallback, useEffect, useState } from "react";
import { api, brandIdFromApi, type ApiRequest } from "./api";
import type { Order } from "./data";
import { FEE_RATE, round2 } from "./engine";
import { initiatorOf } from "./suggestions";
import { shortAddr } from "./wallet";
import { useApp } from "./store";

export type Source = "loading" | "live" | "demo";

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
    initiator: initiatorOf(r),
    sellerTrades: 0,
    city: "",
    postedMin: Math.max(0, Math.round((Date.now() - created) / 60000)),
    expiresMin: 30,
  };
}

/** Ledger taken from the stored request, not the demo ₹90 example. `amountUsdc` is the locked amount. */
export function ledgerFromRequest(r: ApiRequest) {
  const sellerLocks = Number(r.amountUsdc) || 0;
  const buyerReceives = round2(sellerLocks / (1 + FEE_RATE));
  const fee = round2(Math.max(0, sellerLocks - buyerReceives));
  const reserveShare = round2(fee / 2);
  const platformShare = round2(fee - reserveShare);
  const rate = buyerReceives ? Math.round((r.amountInr / buyerReceives) * 100) / 100 : 0;
  return { buyerReceives, fee, sellerLocks, reserveShare, platformShare, sellerEffective: rate, rate };
}

/** Open requests from the backend (`GET /requests`), falling back to demo orders when it's offline. */
export function useOrderBook(pollMs = 15000) {
  const { orders: demo } = useApp();
  const [live, setLive] = useState<Order[] | null>(null);
  const [source, setSource] = useState<Source>("loading");

  const load = useCallback(async () => {
    try {
      const { requests } = await api.listOpen(50);
      setLive(requests.map(toOrder));
      setSource("live");
    } catch {
      setLive(null);
      setSource("demo");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { orders: source === "live" && live ? live : demo, source, reload: load };
}
