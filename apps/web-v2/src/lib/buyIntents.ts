import { useEffect, useState } from "react";
import { api, brandIdFromApi, type BuyIntent } from "./api";

/** Largest buy request the API accepts. It matches the largest voucher a spender can post. */
export const MAX_BUY_INR = 100_000;

export const validBuyAmount = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_BUY_INR;

/** The voucher name to show for an intent: the frontend brand id, or null when the buyer said "none". */
export const voucherOf = (i: BuyIntent) => (i.voucher ? brandIdFromApi(i.voucher) : null);

/**
 * Open buy requests for an amount, matched on amount and voucher (see GET /buy-intents): a request with a voucher fits
 * that store only, one without a voucher fits any store. Pass no `brand` to match on the amount alone.
 * Waits briefly while the amount is being typed, refreshes every `pollMs`, and never shows a stale answer.
 */
export function useMatchingBuyers(amount: number | null, brand: string | undefined, pollMs = 15000) {
  // Each answer is kept with the inputs it was fetched for, so after a store or amount change the old rows are never
  // shown under the new heading while the new answer is on its way.
  const key = `${amount}|${brand ?? ""}`;
  const [found, setFound] = useState<{ key: string; intents: BuyIntent[] }>({ key: "", intents: [] });

  useEffect(() => {
    if (amount === null || !validBuyAmount(amount)) return;
    let live = true;
    const load = () =>
      api
        .matchBuyIntents(amount, brand)
        .then((r) => live && setFound({ key, intents: r.intents }))
        .catch(() => live && setFound({ key, intents: [] })); // offline: just show no recommendations
    const first = setTimeout(load, 300);
    const poll = setInterval(load, pollMs);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [amount, brand, key, pollMs]);

  // `loaded` is true once the answer for the current amount and store has arrived, so "none found" can be told from "still asking".
  const loaded = amount !== null && validBuyAmount(amount) && found.key === key;
  return { intents: loaded ? found.intents : [], loaded };
}

/** "just now", "4m ago", "3h ago" */
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}
