import { useEffect, useState } from "react";
import { API_URL } from "./api";

/** Shape of GET /rates (backend/src/rates/service.js getSummary). Every block can carry `error` instead of numbers. */
export type RatesSummary = {
  amountInr: number;
  forex: { usdInr?: number; realtime?: number; used?: unknown[]; stale?: boolean; error?: string };
  assets: Record<
    "USDT" | "USDC",
    {
      p2p: {
        buy: { price?: number; best?: number; used?: unknown[]; stale?: boolean; error?: string };
        sell: { price?: number; best?: number; used?: unknown[]; stale?: boolean; error?: string };
        premiumBps: { buy: number | null; sell: number | null };
      };
      spot: { mid?: number; buy?: number; sell?: number; used?: unknown[]; premiumBps?: number | null; stale?: boolean; error?: string };
    }
  >;
  observedAt: string;
};

let shared: { at: number; data: RatesSummary | null; inflight: Promise<RatesSummary | null> | null } = { at: 0, data: null, inflight: null };

async function fetchRates(): Promise<RatesSummary | null> {
  if (shared.data && Date.now() - shared.at < 30_000) return shared.data;
  shared.inflight ??= fetch(`${API_URL}/rates`, { signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? (r.json() as Promise<RatesSummary>) : null))
    .catch(() => null)
    .then((d) => {
      if (d) shared = { at: Date.now(), data: d, inflight: null };
      else shared.inflight = null;
      return d ?? shared.data;
    });
  return shared.inflight;
}

/** Live USD/INR + USDT/USDC P2P and spot prices from the backend's /rates API. Null until the first answer (or if it's down). */
export function useRates(refreshMs = 60_000) {
  const [data, setData] = useState<RatesSummary | null>(shared.data);
  const [loading, setLoading] = useState(!shared.data);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetchRates().then((d) => {
        if (!live) return;
        setData(d);
        setLoading(false);
      });
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [refreshMs]);
  return { data, loading };
}

export const inr = (n: number | undefined | null, digits = 2) =>
  typeof n === "number" && Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : "—";

export const bps = (n: number | null | undefined) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${(n / 100).toFixed(2)}%` : "—");

/**
 * The "market" rate for a new order: the live USDT P2P buy price for ₹10k (what a card holder would otherwise pay
 * for a dollar), rounded to 2 places. `rate` is null while the feed is loading or down: the app then says the rate
 * is unavailable instead of pricing an order with a made-up number.
 */
export function useMarketRate() {
  const { data, loading } = useRates();
  const live = data?.assets?.USDT?.p2p?.buy?.price;
  const rate = typeof live === "number" && live > 0 ? Math.round(live * 100) / 100 : null;
  return { rate, loading: loading && rate === null };
}
