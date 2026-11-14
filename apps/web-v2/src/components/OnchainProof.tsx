import { ExternalLink, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type ApiRequest } from "../lib/api";
import { ARC } from "../lib/arc";
import { judgeEscrow, readEscrow, type Verdict } from "../lib/onchain";
import { cx } from "./ui";

const RPC = ((import.meta.env.VITE_ARC_RPC_URL as string | undefined) ?? "").trim() || ARC.rpc;

type State = { kind: "loading" } | { kind: "demo" } | { kind: "error"; text: string; contract?: string } | { kind: "done"; verdict: Verdict; contract: string; at: number };

let healthOnce: ReturnType<typeof api.health> | null = null;

/**
 * "Don't trust us, check": reads this order's escrow from the contract on Arc through a public node, in the browser,
 * and compares it with what the NetPositive server claims. Shown to the buyer before they spend on a voucher.
 */
export function OnchainProof({ req, className }: { req: ApiRequest; className?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback(async () => {
    setState({ kind: "loading" });
    let contract: string | null | undefined;
    try {
      healthOnce ??= api.health();
      contract = (await healthOnce).escrowContract;
    } catch {
      healthOnce = null;
      setState({ kind: "error", text: "Couldn't ask the server which contract it uses." });
      return;
    }
    if (!contract) {
      setState({ kind: "demo" });
      return;
    }
    try {
      const chain = await readEscrow(RPC, contract, req.escrowId);
      setState({ kind: "done", verdict: judgeEscrow(req, chain), contract, at: Date.now() });
    } catch (e) {
      setState({ kind: "error", contract, text: `Couldn't read the contract from this browser (${e instanceof Error ? e.message : "network error"}). Open it in the explorer to check by hand.` });
    }
  }, [req]);

  useEffect(() => {
    void check();
    // Re-check whenever the server's view of the order changes.
  }, [check, req.status, req.updatedAt]);

  const tone = state.kind === "done" ? state.verdict.tone : state.kind === "error" ? "warn" : "idle";
  const Icon = state.kind === "loading" ? LoaderCircle : tone === "good" ? ShieldCheck : tone === "bad" ? ShieldAlert : ShieldQuestion;
  const contract = state.kind === "done" || state.kind === "error" ? state.contract : undefined;

  return (
    <div
      data-testid="onchain-proof"
      data-tone={tone}
      className={cx("rounded-2xl p-4 ring-1", tone === "good" ? "bg-pos/[0.06] ring-pos/30" : tone === "bad" ? "bg-rose/[0.06] ring-rose/30" : tone === "warn" ? "bg-amber/[0.08] ring-amber/35" : "bg-sunken ring-line", className)}
    >
      <div className="flex items-start gap-3">
        <Icon className={cx("mt-0.5 size-5 shrink-0", state.kind === "loading" && "animate-spin text-mute", tone === "good" && "text-pos-ink", tone === "bad" && "text-rose-ink", tone === "warn" && "text-amber-ink")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13.5px] font-medium">
              {state.kind === "loading" ? "Checking the contract on Arc…" : state.kind === "demo" ? "Demo server: escrow is simulated" : state.kind === "error" ? "Couldn't verify on-chain" : state.verdict.title}
            </div>
            {state.kind !== "loading" && state.kind !== "demo" && (
              <button onClick={() => void check()} className="grid size-6 shrink-0 place-items-center rounded-full text-mute hover:bg-fg/5 hover:text-fg" aria-label="Check again">
                <RefreshCw className="size-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
            {state.kind === "loading"
              ? "Reading the escrow record from a public Arc node, not from our server."
              : state.kind === "demo"
                ? "This server runs with mock escrow, so there is no deposit on-chain to check. On the live network this box shows the contract's own record."
                : state.kind === "error"
                  ? state.text
                  : state.verdict.detail}
          </p>
          {contract && (
            <a href={`${ARC.explorer}/address/${contract}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-mute hover:text-fg">
              VoucherEscrow {contract.slice(0, 8)}…{contract.slice(-4)} <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
