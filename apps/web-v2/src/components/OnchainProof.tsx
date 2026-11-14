import { ExternalLink, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { ApiRequest } from "../lib/api";
import { ARC } from "../lib/chain";
import { ESCROW_STATUS, ST, judgeEscrow, untilText } from "../lib/onchain";
import type { ChainView } from "../lib/useEscrow";
import { cx } from "./ui";

const PHASE: Record<number, string> = { [ST.Funded]: "Open until", [ST.Delivered]: "Review window ends", [ST.Disputed]: "Dispute times out" };
const clock = (sec: number) => new Date(sec * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/**
 * "Don't trust us, check": this order's escrow as read from the contract on Arc through a public node, in the browser,
 * compared with what the NetPositive server claims. Shown to the buyer before they spend on a voucher.
 * The contract address comes from this build (VITE_ESCROW_CONTRACT); the server's word for it is only used in development.
 */
export function OnchainProof({ req, view, onRefresh, className }: { req: ApiRequest; view: ChainView; onRefresh: () => void; className?: string }) {
  const verdict = view.kind === "ok" ? judgeEscrow(req, view.escrow) : null;
  const tone = verdict ? verdict.tone : view.kind === "bad" ? "bad" : view.kind === "error" ? "warn" : "idle";
  const Icon = view.kind === "loading" ? LoaderCircle : tone === "good" ? ShieldCheck : tone === "bad" ? ShieldAlert : ShieldQuestion;
  const contract = view.kind === "ok" || view.kind === "error" ? view.contract : undefined;
  const e = view.kind === "ok" ? view.escrow : null;
  const holding = !!e && (e.status === ST.Funded || e.status === ST.Delivered || e.status === ST.Disputed);

  return (
    <div
      data-testid="onchain-proof"
      data-tone={tone}
      className={cx("rounded-2xl p-4 ring-1", tone === "good" ? "bg-pos/[0.06] ring-pos/30" : tone === "bad" ? "bg-rose/[0.06] ring-rose/30" : tone === "warn" ? "bg-amber/[0.08] ring-amber/35" : "bg-sunken ring-line", className)}
    >
      <div className="flex items-start gap-3">
        <Icon className={cx("mt-0.5 size-5 shrink-0", view.kind === "loading" && "animate-spin text-mute", tone === "good" && "text-pos-ink", tone === "bad" && "text-rose-ink", tone === "warn" && "text-amber-ink")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13.5px] font-medium">
              {view.kind === "loading"
                ? `Checking the contract on ${ARC.name}…`
                : view.kind === "mock"
                  ? "Demo server: escrow is simulated"
                  : view.kind === "bad"
                    ? "Escrow can't be verified. Don't proceed"
                    : view.kind === "error"
                      ? "Couldn't verify on-chain"
                      : verdict!.title}
            </div>
            {view.kind !== "loading" && view.kind !== "mock" && (
              <button onClick={onRefresh} className="grid size-6 shrink-0 place-items-center rounded-full text-mute hover:bg-fg/5 hover:text-fg" aria-label="Check again">
                <RefreshCw className="size-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
            {view.kind === "loading"
              ? `Reading the escrow record from a public ${ARC.name} node, not from our server.`
              : view.kind === "mock"
                ? "This development server runs with mock escrow, so there is no deposit on-chain to check and no USDC has moved."
                : view.kind === "bad"
                  ? view.text
                  : view.kind === "error"
                    ? `${view.text} Open the contract in the explorer to check by hand.`
                    : verdict!.detail}
          </p>
          {e && e.status !== ST.None && (
            <dl className="mt-2 space-y-1 text-[12px]">
              <Fact k="On-chain state" v={ESCROW_STATUS[e.status] ?? `state ${e.status}`} />
              <Fact k="Buyer on-chain" v={e.fulfiller ?? "Nobody bound yet"} mono={!!e.fulfiller} />
              {holding && <Fact k={e.status === ST.Funded && e.fulfiller ? "Deliver by" : PHASE[e.status]} v={`${clock(e.deadline)} (${untilText(e.deadline, Date.now())})`} />}
            </dl>
          )}
          {contract && (
            <a href={`${ARC.explorer}/address/${contract}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-mute hover:text-fg">
              VoucherEscrow {contract.slice(0, 8)}…{contract.slice(-4)} · {ARC.name} <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-dim">{k}</dt>
      <dd className={cx("min-w-0 break-all text-fg/85", mono && "font-mono text-[11px]")}>{v}</dd>
    </div>
  );
}
