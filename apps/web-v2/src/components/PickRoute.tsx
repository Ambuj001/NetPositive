import { BadgeCheck, FingerprintPattern, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api, brandIdFromApi, type ApiRequest } from "../lib/api";
import { brand } from "../lib/data";
import { effectivePrice, inr, routesFor } from "../lib/engine";
import { ledgerFromRequest } from "../lib/orderbook";
import { saveRoute } from "../lib/route";
import { useApp } from "../lib/store";
import { useWorldId } from "../lib/world";
import { Button, Card, Pill, cx } from "./ui";

/**
 * "Pick how to buy it": the buyer ranks their saved cards for this voucher, picks a route and accepts the order.
 * Accepting is the real thing: it needs a connected wallet, a sign-in and World ID, then calls the backend, which locks
 * the order to this buyer. The page then reloads into the buyer's view of the order.
 */
export function PickRoute({ req, onAccepted, onRefresh }: { req: ApiRequest; onAccepted: (r: ApiRequest) => void; onRefresh: () => void }) {
  const { fullAddress, humanVerified, openWallet, token, signIn, toast, cards } = useApp();
  const { verifyHuman, phase } = useWorldId();
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
        const ok = await verifyHuman();
        if (!ok) return;
      }
      const { request } = await api.accept(req.id, auth);
      saveRoute(req.id, { cardId: chosen.cardId, cardLabel: chosen.cardLabel, channelId: chosen.channel.id, channelName: chosen.channel.name, issuer: cards.find((c) => c.id === chosen.cardId)?.issuer });
      toast({ title: "Order accepted", body: `Buy via ${chosen.cardLabel} · ${chosen.channel.name}`, tone: "amber" });
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
    <Card glow="rgba(245,181,68,0.10)" className="p-6 md:p-7">
      <h2 className="font-display text-2xl font-semibold tracking-tight">Pick how to buy it</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-mute">
        Ranked from cards saved on your device for a {inr(req.amountInr)} {b.name} voucher.
      </p>

      <div className="mt-6">
        {routes.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.03] p-4 text-[13.5px] text-mute ring-1 ring-white/[0.07]">
            You have no saved cards yet. <Link to="/cards" className="text-amber hover:underline">Add a card</Link> to see how to buy this voucher.
          </div>
        ) : (
          <div className="space-y-2">
            {routes.slice(0, 4).map((r, i) => (
              <button
                key={r.cardId + r.channel.id}
                type="button"
                onClick={() => setPick(i)}
                disabled={busy}
                className={cx("flex w-full items-center gap-4 rounded-2xl p-4 text-left ring-1 transition", pick === i ? "bg-amber/[0.07] ring-amber/50" : "bg-white/[0.02] ring-white/[0.07] hover:ring-white/15")}
              >
                <span className={cx("grid size-5 place-items-center rounded-full ring-1", pick === i ? "bg-amber ring-amber" : "ring-white/20")}>{pick === i && <span className="size-2 rounded-full bg-ink" />}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-medium">
                    {r.cardLabel} · {r.channel.name}
                    {i === 0 && <Pill tone="amber">best</Pill>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-mute">
                    {r.points.toLocaleString("en-IN")} pts{r.discountInr ? ` + ${inr(r.discountInr)} off` : ""} · {r.txns} × {inr(r.channel.denomination > req.amountInr ? req.amountInr : r.channel.denomination)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[16px] font-semibold tabular">{r.pctTravel.toFixed(1)}%</div>
                  <div className="font-mono text-[10.5px] text-dim">₹{effectivePrice(req.amountInr, r.travelInr, buyerReceives).toFixed(2)}/USDC</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className={cx("flex flex-1 items-center gap-2 text-[12.5px]", humanVerified ? "text-mint" : "text-mute")}>
          {humanVerified ? <BadgeCheck className="size-4" /> : <FingerprintPattern className="size-4 text-iris" />}
          {humanVerified ? "Verified human · Proof of Human" : "Proof of Human runs once, the first time you accept"}
        </div>
        <Button variant="amber" size="lg" onClick={() => void accept()} disabled={busy || phase !== "idle" || (!!fullAddress && !chosen)}>
          {phase === "world" ? (
            <>
              <LoaderCircle className="size-4 animate-spin" /> Waiting for World App…
            </>
          ) : phase === "signing" ? (
            <>
              <LoaderCircle className="size-4 animate-spin" /> Starting World ID…
            </>
          ) : busy ? (
            <>
              <LoaderCircle className="size-4 animate-spin" /> Accepting…
            </>
          ) : !fullAddress ? (
            "Connect wallet"
          ) : (
            "Accept order"
          )}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[12.5px] leading-relaxed text-rose">
          {error}
        </p>
      )}
    </Card>
  );
}
