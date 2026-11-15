import { ChevronDown, ExternalLink, LoaderCircle, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiRequest } from "../lib/api";
import { ARC } from "../lib/chain";
import { ESCROW_STATUS, ST, judgeEscrow, untilText } from "../lib/onchain";
import type { ChainView } from "../lib/useEscrow";
import { sourceText } from "../lib/escrowRead";
import { cx } from "./ui";

const PHASE: Record<number, string> = { [ST.Funded]: "Open until", [ST.Delivered]: "Review window ends", [ST.Disputed]: "Dispute times out" };
const clock = (sec: number) => new Date(sec * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/**
 * "Don't trust us, check": this order's escrow as read from the contract on Arc, compared with what the NetPositive
 * server claims. One status line by default; how it was read, the raw on-chain record and the technical details sit
 * behind "How this was checked".
 *   green    read independently (browser or wallet node) and it matches the order
 *   neutral  read through NetPositive's server (not independent), still loading, simulated, or unreadable
 *   red      a real mismatch between the contract and the order
 * The contract address comes from this build (VITE_ESCROW_CONTRACT); the server's word for it is only used in development.
 */
export function OnchainProof({ req, view, onRefresh, className, details }: { req: ApiRequest; view: ChainView; onRefresh: () => void; className?: string; details?: ReactNode }) {
  const verdict = view.kind === "ok" ? judgeEscrow(req, view.escrow) : null;
  // A reading through NetPositive's server is shown, but never as a green "verified": it isn't an independent check.
  const independent = view.kind === "ok" && sourceText(view.source, ARC.name).independent;
  const tone: "good" | "bad" | "idle" = view.kind === "bad" || verdict?.tone === "bad" ? "bad" : verdict?.ok && independent ? "good" : "idle";
  const Icon = view.kind === "loading" ? LoaderCircle : tone === "good" ? ShieldCheck : tone === "bad" ? ShieldAlert : ShieldQuestion;
  const contract = view.kind === "ok" || view.kind === "error" ? view.contract : undefined;
  const e = view.kind === "ok" ? view.escrow : null;
  const holding = !!e && (e.status === ST.Funded || e.status === ST.Delivered || e.status === ST.Disputed);

  const title =
    view.kind === "loading"
      ? `Checking the contract on ${ARC.name}…`
      : view.kind === "mock"
        ? "Demo server: escrow is simulated"
        : view.kind === "bad"
          ? "Escrow can't be verified. Don't proceed"
          : view.kind === "error"
            ? "Couldn't read the escrow"
            : verdict!.title;
  // One short line under the status: where the reading came from (or why there is none).
  const sub =
    view.kind === "ok"
      ? independent
        ? `Checked by your ${view.source === "wallet" ? "wallet" : "browser"}, not by NetPositive.`
        : "Read through NetPositive's server, not independently."
      : view.kind === "bad"
        ? view.text
        : view.kind === "error"
          ? "Open the contract in the explorer to check by hand."
          : view.kind === "mock"
            ? "No deposit on-chain to check; no USDC has moved."
            : null;

  return (
    <div data-testid="onchain-proof" data-tone={tone} className={cx("hairline rounded-[22px] p-4 backdrop-blur-xl sm:p-5", tone === "bad" ? "bg-rose/[0.06] ring-1 ring-rose/30" : "bg-surface/70", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="label">On-chain escrow</div>
        {view.kind !== "loading" && view.kind !== "mock" && (
          <button onClick={onRefresh} className="grid size-6 shrink-0 place-items-center rounded-full text-mute hover:bg-fg/5 hover:text-fg" aria-label="Check again">
            <RefreshCw className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        <Icon className={cx("mt-0.5 size-4 shrink-0", view.kind === "loading" && "animate-spin", tone === "good" ? "text-pos-ink" : tone === "bad" ? "text-rose-ink" : "text-mute")} />
        <div className="min-w-0 flex-1">
          <div className={cx("text-[13.5px] font-medium", tone === "good" && "text-pos-ink", tone === "bad" && "text-rose-ink")}>{title}</div>
          {sub && <p className="mt-0.5 text-[12px] leading-relaxed text-mute">{sub}</p>}
        </div>
      </div>

      {view.kind !== "loading" && (
        <details className="group mt-3 border-t border-fg/[0.06] pt-2.5">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] text-mute select-none hover:text-fg">
            How this was checked <ChevronDown className="size-3.5 transition group-open:rotate-180" />
          </summary>
          <div className="mt-2.5 space-y-2.5 text-[12px]">
            {verdict && <p className="leading-relaxed text-mute">{verdict.detail}</p>}
            {view.kind === "error" && <p className="leading-relaxed text-mute">{view.text}</p>}
            {view.kind === "mock" && <p className="leading-relaxed text-mute">This development server runs with mock escrow, so there is no deposit on-chain to check.</p>}
            {view.kind === "ok" && <p className="leading-relaxed text-mute">{sourceText(view.source, ARC.name).detail}</p>}
            {e && e.status !== ST.None && (
              <dl className="space-y-1">
                <Fact k="On-chain state" v={ESCROW_STATUS[e.status] ?? `state ${e.status}`} />
                <Fact k="USDC buyer on-chain" v={e.fulfiller ?? "Nobody bound yet"} mono={!!e.fulfiller} />
                {holding && <Fact k={e.status === ST.Funded && e.fulfiller ? "Deliver by" : PHASE[e.status]} v={`${clock(e.deadline)} (${untilText(e.deadline, Date.now())})`} />}
                {e.block ? <Fact k="Read at block" v={String(e.block)} /> : null}
              </dl>
            )}
            {contract && (
              <a href={`${ARC.explorer}/address/${contract}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-mute hover:text-fg">
                VoucherEscrow {contract.slice(0, 8)}…{contract.slice(-4)} · {ARC.name} <ExternalLink className="size-3" />
              </a>
            )}
            {details}
          </div>
        </details>
      )}
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
