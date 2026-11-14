import { useCallback, useEffect, useRef, useState } from "react";
import { ARC } from "./chain";
import { escrowTarget, stepError } from "./escrowFlow";
import { readEscrow, type OnchainEscrow } from "./onchain";

/**
 * This order's escrow record, read from a public Arc node in the browser (not from the NetPositive server).
 *   mock   a development server with the mock escrow: there is nothing on-chain to read
 *   bad    the escrow can't be chosen safely (not configured, wrong contract, wrong chain): don't proceed
 *   error  the read itself failed; try again
 */
export type ChainView =
  | { kind: "loading" }
  | { kind: "mock" }
  | { kind: "bad"; text: string }
  | { kind: "error"; text: string; contract: string }
  | { kind: "ok"; escrow: OnchainEscrow; contract: string; at: number };

export function useEscrow(escrowId: string, opts: { watch?: unknown; pollMs?: number } = {}) {
  const [view, setView] = useState<ChainView>({ kind: "loading" });
  const run = useRef(0);

  const refresh = useCallback(
    async (quiet = false) => {
      const mine = ++run.current;
      if (!quiet) setView({ kind: "loading" });
      let next: ChainView;
      try {
        const target = await escrowTarget();
        if (target.mode === "mock") next = { kind: "mock" };
        else {
          try {
            next = { kind: "ok", escrow: await readEscrow(ARC.rpc, target.contract, escrowId), contract: target.contract, at: Date.now() };
          } catch (e) {
            next = { kind: "error", contract: target.contract, text: `Couldn't read the contract from this browser (${e instanceof Error ? e.message : "network error"}).` };
          }
        }
      } catch (e) {
        next = { kind: "bad", text: stepError(e, "Couldn't ask the server which escrow it uses.") };
      }
      // A quiet re-read that fails keeps the last good answer on screen rather than flashing an error.
      if (mine === run.current) setView((prev) => (quiet && next.kind === "error" && prev.kind === "ok" ? prev : next));
    },
    [escrowId],
  );

  // Read now, and again whenever the server's view of the order changes.
  useEffect(() => {
    void refresh();
  }, [refresh, opts.watch]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, opts.pollMs);
    return () => clearInterval(t);
  }, [refresh, opts.pollMs]);

  return { view, refresh };
}
