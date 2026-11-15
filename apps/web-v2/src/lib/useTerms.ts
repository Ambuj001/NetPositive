import { useEffect, useState } from "react";
import { api } from "./api";
import { DEFAULT_FEE_BPS, type EscrowTerms } from "./terms";

/**
 * The escrow's current terms from the server. While they are loading, or when the server can't be reached,
 * `terms` is null, `feeBps` falls back to the default and `estimated` is true so screens can say so.
 */
export function useTerms(refreshMs = 60_000) {
  const [terms, setTerms] = useState<EscrowTerms | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .terms()
        .then((t) => live && setTerms(t))
        .catch(() => undefined)
        .finally(() => live && setLoading(false));
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), refreshMs);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [refreshMs]);
  return { terms, loading, feeBps: terms?.feeBps ?? DEFAULT_FEE_BPS, estimated: !terms };
}
