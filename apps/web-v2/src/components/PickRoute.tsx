import { BadgeCheck, FingerprintPattern } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, brandIdFromApi, type ApiRequest } from "../lib/api";
import { brand } from "../lib/data";
import { effectivePrice, inr, routesFor } from "../lib/engine";
import { ledgerFromRequest } from "../lib/orderbook";
import { saveRoute } from "../lib/route";
import { useApp } from "../lib/store";
import { useWorldId } from "../lib/world";
import { Button, Callout, Panel, Pill, cx } from "./ui";

/**
 * "Pick how to buy it": the buyer ranks their saved cards for this voucher, picks a route and accepts the order.
 * Accepting needs a connected wallet, a sign-in and World ID (unless the server has it switched off), then calls the backend, which reserves the order for this
 * buyer. It does not bind them on-chain yet: that is the buyer's own `accept` transaction, after the spender's Ready
 * (see AcceptOnchain). The page reloads into the buyer's view, which says not to buy the voucher before then.
 */
export function PickRoute({ req, onAccepted, onRefresh }: { req: ApiRequest; onAccepted: (r: ApiRequest) => void; onRefresh: () => void }) {
  const { fullAddress, humanVerified, openWallet, token, signIn, toast, cards, cardsAreExamples } = useApp();
  const { ensureHuman, withHuman, required, phase } = useWorldId();
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const b = brand(brandIdFromApi(req.brand));
  const { buyerReceives } = ledgerFromRequest(req);
  const routes = useMemo(() => routesFor(req.amountInr, cards), [req.amountInr, cards]);
  const chosen = routes[pick];

  async function accept() {
    if (!fullAddress) return openWallet();
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    try {
      const auth = token ?? (await signIn());
      if (!auth) return;
      if (!humanVerified) {
        const ok = await ensureHuman();
        if (!ok) return;
      }
      const accepted = await withHuman(() => api.accept(req.id, auth));
      if (!accepted) return;
      const { request } = accepted;
      saveRoute(req.id, { cardId: chosen.cardId, cardLabel: chosen.cardLabel, channelId: chosen.channel.id, channelName: chosen.channel.name, issuer: cards.find((c) => c.id === chosen.cardId)?.issuer });
      toast({ title: "Order accepted", body: "Don't buy the voucher yet. Wait for the voucher buyer's Ready, then confirm the order from your wallet.", tone: "amber" });
      onAccepted(request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't accept this order.");
      // Someone else may have taken it a moment ago: show what the order looks like now.
      if (e instanceof ApiError && e.status === 409) onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="sm:p-6">
      <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Pick how to buy it</h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-mute">
        {cardsAreExamples ? "Ranked from example cards (you haven't saved any yet)" : "Ranked from your saved cards"} for a {inr(req.amountInr)} {b.name} voucher.
      </p>
      {cardsAreExamples && (
        <Callout tone="amber" className="mt-3">
          Example cards only: these may not be cards you hold. <Link to="/cards" className="underline">Add your cards</Link> to rank your real options.
        </Callout>
      )}

      <div className="mt-5">
        {routes.length === 0 ? (
          <div className="well p-4 text-[13.5px] text-mute">
            You have no saved cards yet. <Link to="/cards" className="link text-fg">Add a card</Link> to see how to buy this voucher.
          </div>
        ) : (
          <div className="space-y-2" role="radiogroup" aria-label="How to buy it">
            {routes.slice(0, 4).map((r, i) => (
              <button
                key={r.cardId + r.channel.id}
                type="button"
                onClick={() => setPick(i)}
                disabled={busy}
                role="radio"
                aria-checked={pick === i}
                className={cx("flex w-full items-center gap-4 rounded-xl p-3.5 text-left ring-1 transition-colors duration-200", pick === i ? "bg-brand-soft ring-brand/40" : "ring-line hover:bg-sunken hover:ring-line-2")}
              >
                <span className={cx("grid size-5 shrink-0 place-items-center rounded-full ring-1 transition-colors", pick === i ? "bg-brand ring-brand" : "bg-surface ring-line-2")}>{pick === i && <span className="size-2 rounded-full bg-white" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                    <span className="min-w-0 truncate">
                      {r.cardLabel} · {r.channel.name}
                    </span>
                    {i === 0 && <Pill tone="pos">best</Pill>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-mute tabular">
                    {r.points.toLocaleString("en-IN")} pts{r.discountInr ? ` + ${inr(r.discountInr)} off` : ""} · {r.txns} × {inr(r.channel.denomination > req.amountInr ? req.amountInr : r.channel.denomination)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[16px] font-semibold tabular">{r.pctTravel.toFixed(1)}%</div>
                  <div className="font-mono text-[11px] text-dim tabular">₹{effectivePrice(req.amountInr, r.travelInr, buyerReceives).toFixed(2)}/USDC</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
        {required ? (
          <div className={cx("flex flex-1 items-center gap-2 text-[13px]", humanVerified ? "text-brand-ink" : "text-mute")}>
            {humanVerified ? <BadgeCheck className="size-4" /> : <FingerprintPattern className="size-4 text-brand-ink" />}
            {humanVerified ? "Verified human · Proof of Human" : "Proof of Human runs once, the first time you accept"}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Button onClick={() => void accept()} disabled={!!fullAddress && !chosen} pending={busy || phase !== "idle"} className="sm:min-w-[170px]">
          {phase === "world" ? "Waiting for World App…" : phase === "signing" ? "Starting World ID…" : busy ? "Accepting…" : !fullAddress ? "Connect wallet" : "Accept order"}
        </Button>
      </div>
      {error && (
        <Callout role="alert" tone="rose" className="mt-3">
          {error}
        </Callout>
      )}
    </Panel>
  );
}
