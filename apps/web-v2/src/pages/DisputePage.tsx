import { LoaderCircle, PenLine, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DisputeView, RaiseDispute } from "../components/Dispute";
import { Aurora, Button } from "../components/ui";
import { useApp } from "../lib/store";

/** /dispute/:id opens the raise form and the dispute view for one order. Also reachable from the order card on Track. */
export default function DisputePage() {
  const { id: routeId } = useParams();
  const nav = useNavigate();
  const { token, signIn, signingIn, fullAddress, openWallet } = useApp();
  const [draft, setDraft] = useState(routeId ?? "");
  const [raising, setRaising] = useState(false);
  const [version, setVersion] = useState(0);
  const id = routeId?.trim() ?? "";

  return (
    <div className="relative pt-28 pb-16">
      <Aurora className="h-[45vh] opacity-40" />
      <div className="relative mx-auto max-w-2xl px-6">
        <div className="label">Dispute</div>
        <h1 className="text-gradient mt-2 font-display text-4xl font-semibold tracking-[-0.03em]">Raise a dispute</h1>
        <p className="mt-2 text-[14px] text-mute">Something wrong with a voucher code? Stake 1 USDC and the team will decide. Open it from an order on Track, or enter an order id here.</p>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) nav(`/dispute/${encodeURIComponent(draft.trim())}`);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Order id"
            aria-label="Order id"
            className="h-12 min-w-0 flex-1 rounded-2xl bg-white/[0.03] px-4 font-mono text-[13.5px] ring-1 ring-white/10 outline-none placeholder:text-dim focus:ring-mint/40"
          />
          <Button type="submit" variant="outline" disabled={!draft.trim()}>
            Open
          </Button>
        </form>

        {id && (
          <div className="hairline mt-6 rounded-[22px] bg-ink-2/70 p-5 backdrop-blur-xl">
            <div className="font-mono text-[11.5px] text-dim">{id}</div>
            <div className="mt-3">
              <Button variant="outline" onClick={() => setRaising(true)} icon={<ShieldAlert className="size-4 text-rose" />}>
                Raise a dispute
              </Button>
            </div>

            <div className="mt-5 border-t border-white/[0.06] pt-4">
              {!fullAddress ? (
                <Button size="sm" variant="outline" onClick={openWallet}>
                  Connect wallet to see this order's dispute
                </Button>
              ) : !token ? (
                <Button size="sm" variant="outline" onClick={signIn} disabled={signingIn} icon={signingIn ? <LoaderCircle className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}>
                  {signingIn ? "Check your wallet…" : "Sign in to see this order's dispute"}
                </Button>
              ) : (
                <DisputeView key={`${id}:${version}`} id={id} token={token} live onChanged={() => setVersion((v) => v + 1)} />
              )}
            </div>
          </div>
        )}
      </div>
      {id && <RaiseDispute id={id} open={raising} onClose={() => setRaising(false)} onDone={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
