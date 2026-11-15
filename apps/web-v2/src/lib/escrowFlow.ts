/**
 * Glue between the server and the wallet for the escrow steps people send themselves in V2.
 * Decides which contract to use (see `pickEscrow`), refuses to continue when the server is on another chain, and
 * skips the wallet only on a development server that runs the mock escrow.
 */
import { api, onchainStepText, type ApiRequest } from "./api";
import { WalletStepError } from "./arc";
import { EscrowConfigError, chainMismatch, pickEscrow, type EscrowTarget } from "./chain";
import { PendingTxError, escrowStep, type EscrowStep } from "./escrow";
import { serverErrorText } from "./terms";

type Rpc = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

/** Checks a server's stated chain and contract against this build. Throws a message for the person when they differ. */
export function targetFrom(server: { chainId?: unknown; contract?: string | null }): EscrowTarget {
  const target = pickEscrow(server.contract);
  if (target.mode === "chain") {
    const wrong = chainMismatch(server.chainId);
    if (wrong) throw new EscrowConfigError("mismatch", wrong);
  }
  return target;
}

/** The escrow this app should use right now, from `/health`. */
export async function escrowTarget(): Promise<EscrowTarget> {
  const h = await api.serverInfo();
  return targetFrom({ chainId: h.chainId, contract: h.escrowContract });
}

/**
 * Send one escrow transaction for an order from the connected wallet, unless the chain already shows it.
 * `mock: true` means a development server with the mock escrow: nothing was sent and nothing is on-chain.
 */
export async function sendEscrowStep(
  request: Rpc,
  step: EscrowStep,
  a: { req: Pick<ApiRequest, "escrowId">; from: string; wallet?: string; permit?: { validUntil: number; epoch?: number; signature: string } | null; hash?: string },
): Promise<{ tx: string | null; mock: boolean }> {
  const target = await escrowTarget();
  if (target.mode === "mock") return { tx: null, mock: true };
  const tx = await escrowStep(request, step, { from: a.from, escrow: target.contract, escrowId: a.req.escrowId, wallet: a.wallet, permit: a.permit, hash: a.hash });
  return { tx, mock: false };
}

/** One readable line for anything an escrow step can throw: wallet, chain, config or server. */
export function stepError(e: unknown, fallback: string): string {
  const code = (e as { code?: number })?.code;
  const text = (e as { message?: string })?.message ?? "";
  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(text)) return "You declined the request in your wallet. Nothing was sent.";
  const onchain = onchainStepText(e);
  if (onchain) return onchain;
  const server = serverErrorText(e);
  if (server) return server;
  if (e instanceof WalletStepError || e instanceof EscrowConfigError || e instanceof PendingTxError) return e.message;
  return e instanceof Error && e.message ? e.message.slice(0, 400) : fallback;
}

/** Shown wherever a development server's mock escrow stands in for the chain. */
export const MOCK_NOTE = "Demo server: the escrow is simulated, so nothing moved on-chain.";
