/**
 * After a wallet transaction has confirmed, the NetPositive server is told about it. That call must never turn into
 * "pay again": if the server can't be reached, or its node hasn't seen the transaction yet (409), it is retried a few
 * times, and if it still fails the person is told the money already moved and that pressing the button again is safe
 * (every step reads the chain first and skips a transaction that already went through).
 * Pure apart from the timer, so node tests can import it.
 */

/** The transaction went through; only recording it on the server failed. */
export class RecordAfterTxError extends Error {
  tx: string | null;
  constructor(what: string, tx: string | null, reason: string) {
    super(`Your ${what} went through on-chain${tx ? ` (tx ${tx.slice(0, 10)}…)` : ""}, so there is nothing more to pay. NetPositive's server couldn't record it yet (${reason}). Press the button again in a moment: the app sees the transaction on-chain and won't send it twice.`);
    this.tx = tx;
  }
}

type ErrLike = { status?: number; code?: string; message?: string };

/** Worth trying again: the server is unreachable, overloaded, or its node is behind the wallet's. */
export function retryable(e: unknown): boolean {
  const x = e as ErrLike | null;
  if (!x || typeof x !== "object") return false;
  if (x.code === "unreachable" || x.code === "rate_limited") return true;
  if (x.code === "wallet_action_required" || x.code === "not_delivered_onchain" || x.code === "not_assigned_onchain") return true;
  return typeof x.status === "number" && (x.status === 0 || x.status === 429 || x.status >= 500);
}

/**
 * Run `call` up to `tries` times, waiting `waitMs` (growing) between tries, while the error is retryable.
 * When it gives up after a confirmed transaction (`tx` set or `chainDone`), throws `RecordAfterTxError`.
 */
export async function recordAfterTx<T>(
  call: () => Promise<T>,
  opts: { what: string; tx: string | null; chainDone: boolean; tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const tries = opts.tries ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await call();
    } catch (e) {
      last = e;
      if (!retryable(e) || i === tries - 1) break;
      await sleep((opts.waitMs ?? 2500) * (i + 1));
    }
  }
  if (opts.chainDone && retryable(last)) {
    const reason = (last as ErrLike)?.code === "unreachable" ? "it isn't reachable" : ((last as ErrLike)?.message ?? "no answer").slice(0, 160);
    throw new RecordAfterTxError(opts.what, opts.tx, reason);
  }
  throw last;
}
