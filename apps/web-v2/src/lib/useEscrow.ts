import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ARC } from "./chain";
import { escrowTarget, stepError } from "./escrowFlow";
import { allFailedText, parseServerEscrow, pollDelay, readFirst, sourceOrder, walletReader, type EscrowSource, type Reader } from "./escrowRead";
import { encodeGetEscrow, readEscrow, type OnchainEscrow } from "./onchain";

/**
 * This order's escrow record. Read from a public Arc node in the browser first, then through the connected wallet's
 * node, then through NetPositive's server (see `escrowRead.ts`). Which source answered is kept in `source`.
 *   mock   a development server with the mock escrow: there is nothing on-chain to read
 *   bad    the escrow can't be chosen safely (not configured, wrong contract, wrong chain): don't proceed
 *   error  every source failed; try again
 */
export type ChainView =
  | { kind: "loading" }
  | { kind: "mock" }
  | { kind: "bad"; text: string }
  | { kind: "error"; text: string; contract: string }
  | { kind: "ok"; escrow: OnchainEscrow; contract: string; at: number; source: EscrowSource; chainTime: number | null };

type Rpc = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

/**
 * `live`: keep re-reading in the background (every ~15 s, paused while the tab is hidden, backing off after failures).
 * `walletRequest` + `hasWallet`: allow the wallet's own node as the second source.
 * Call `refresh()` right after the person's own action instead of waiting for the next poll.
 */
export function useEscrow(escrowId: string, opts: { live?: boolean; walletRequest?: Rpc; hasWallet?: boolean } = {}) {
  const [view, setView] = useState<ChainView>({ kind: "loading" });
  const run = useRef(0);
  const failures = useRef(0);
  const rpcFailedAt = useRef<number | null>(null);
  const wallet = useRef<{ request?: Rpc; has: boolean }>({ has: false });
  wallet.current = { request: opts.walletRequest, has: !!opts.hasWallet && !!opts.walletRequest };

  const refresh = useCallback(
    async (quiet = false) => {
      const mine = ++run.current;
      if (!quiet) setView((prev) => (prev.kind === "ok" ? prev : { kind: "loading" }));
      let next: ChainView;
      try {
        const target = await escrowTarget();
        if (target.mode === "mock") next = { kind: "mock" };
        else {
          const readers: Record<EscrowSource, Reader> = {
            rpc: { source: "rpc", read: async () => ({ escrow: await readEscrow(ARC.rpc, target.contract, escrowId) }) },
            wallet: walletReader(wallet.current.request ?? (() => Promise.reject(new Error("no wallet connected"))), ARC.id, { to: target.contract, data: encodeGetEscrow(escrowId) }),
            server: { source: "server", read: async () => parseServerEscrow(await api.escrowState(escrowId)) },
          };
          const order = sourceOrder({ rpcFailedAt: rpcFailedAt.current, now: Date.now(), hasWallet: wallet.current.has });
          const res = await readFirst(order.map((s) => readers[s]));
          if (res.failed.some((f) => f.source === "rpc")) rpcFailedAt.current = Date.now();
          else if (res.ok && res.reading.source === "rpc") rpcFailedAt.current = null;
          next = res.ok
            ? { kind: "ok", escrow: res.reading.escrow, contract: target.contract, at: Date.now(), source: res.reading.source, chainTime: res.reading.chainTime }
            : { kind: "error", contract: target.contract, text: allFailedText(res.failed) };
        }
      } catch (e) {
        next = { kind: "bad", text: stepError(e, "Couldn't ask the server which escrow it uses.") };
      }
      failures.current = next.kind === "error" || next.kind === "bad" ? failures.current + 1 : 0;
      // A quiet re-read that fails keeps the last good answer on screen rather than flashing an error.
      if (mine === run.current) setView((prev) => (quiet && next.kind === "error" && prev.kind === "ok" ? prev : next));
    },
    [escrowId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Background reads: one at a time, ~15 s apart, longer after failures, none while the tab is hidden.
  useEffect(() => {
    if (!opts.live) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh(true);
        schedule();
      }, pollDelay(failures.current));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, opts.live]);

  return { view, refresh };
}
