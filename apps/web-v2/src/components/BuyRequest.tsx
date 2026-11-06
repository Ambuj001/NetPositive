import { HandCoins } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type BuyIntent } from "../lib/api";
import { ago, MAX_BUY_INR, useMatchingBuyers, validBuyAmount, voucherOf } from "../lib/buyIntents";
import { brand } from "../lib/data";
import { inr } from "../lib/engine";
import { readSession } from "../lib/session";
import { useApp } from "../lib/store";
import { shortAddr } from "../lib/wallet";
import { useWorldId } from "../lib/world";
import { BrandMark, Button, cx } from "./ui";

/* --------------------------------------------------------------------------------------------- buy side */

/**
 * Buy tab, under the amount: lets someone who wants USDC put the chosen amount on the record. It saves a
 * "buy request" (amount, their wallet, the voucher they picked or none) that spenders see as a recommendation in the
 * Pay with crypto tab. Posting is a click, never automatic, because it signs them in and publishes their wallet.
 */
/**
 * `onRestore` is called once with the saved request when it is first loaded, so the page can show its amount and voucher in the
 * form. Without it, a reload would reset the form and "Update" would quietly replace the saved voucher with "none".
 */
export function BuyRequestCard({ amount, voucher, onRestore }: { amount: number; voucher: string; onRestore?: (intent: BuyIntent) => void }) {
  const { fullAddress, token, signIn, humanVerified, openWallet, toast } = useApp();
  const { verifyHuman } = useWorldId();
  const [mine, setMine] = useState<BuyIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const apiVoucher = voucher === "none" ? null : voucher;
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const restoredFor = useRef<string | null>(null);

  // What is already on record for this wallet. Only possible once they are signed in.
  useEffect(() => {
    setError("");
    if (!token) return setMine(null);
    let live = true;
    api
      .myBuyIntent(token)
      .then((r) => {
        if (!live) return;
        setMine(r.intent);
        if (r.intent && restoredFor.current !== fullAddress) {
          restoredFor.current = fullAddress;
          restoreRef.current?.(r.intent);
        }
      })
      .catch(() => live && setMine(null));
    return () => {
      live = false;
    };
  }, [token, fullAddress]);

  const post = useCallback(async () => {
    if (busy) return;
    if (!fullAddress) return openWallet();
    setError("");
    setBusy(true);
    try {
      let auth = token;
      if (!humanVerified) {
        // Registering as a human signs the wallet in first when there is no session, so don't also sign in here:
        // the wallet would be asked to sign twice. The session it just stored holds the token.
        if (!(await verifyHuman())) return;
        auth = readSession(fullAddress)?.token ?? null;
      } else if (!auth) {
        auth = await signIn();
      }
      if (!auth) return;
      const { intent } = await api.postBuyIntent({ amountInr: amount, voucher: apiVoucher }, auth);
      setMine(intent);
      toast({ title: "Buy request posted", body: `${inr(intent.amountInr)} · ${voucherOf(intent) ? brand(voucherOf(intent)!).name : "any voucher"}. Spenders can see it now.`, tone: "mint" });
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't post your buy request.");
    } finally {
      setBusy(false);
    }
  }, [busy, fullAddress, openWallet, token, signIn, humanVerified, verifyHuman, amount, apiVoucher, toast]);

  const withdraw = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.withdrawBuyIntent(token);
      setMine(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't withdraw it.");
    } finally {
      setBusy(false);
    }
  };

  const mineVoucher = mine ? voucherOf(mine) : null;
  const same = !!mine && mine.amountInr === amount && (mine.voucher ?? null) === apiVoucher;
  const tooBig = amount > MAX_BUY_INR;

  if (!mine && !(amount > 0)) return null;

  return (
    <div className="mt-5 rounded-2xl bg-white/[0.03] p-3.5 ring-1 ring-white/[0.07]" data-testid="buy-request">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-mint/10 text-mint ring-1 ring-white/10">
          <HandCoins className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
          {mine ? (
            <>
              <div className="font-medium text-fg">Your buy request is live</div>
              <div className="text-mute">
                {inr(mine.amountInr)} · {mineVoucher ? `${brand(mineVoucher).name} voucher` : "any voucher"} · posted {ago(mine.createdAt)}
              </div>
              <div className="text-dim">Spenders looking for this amount are shown your request.</div>
            </>
          ) : (
            <>
              <div className="font-medium text-fg">Want {inr(amount)}? Let spenders find you</div>
              <div className="text-mute">
                Post a buy request for {inr(amount)} with {apiVoucher ? `your ${brand(apiVoucher).name} voucher` : "no voucher"}. It's shown to people who want to spend crypto at that size.
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(!mine || !same) && (
          <Button size="sm" disabled={busy || !validBuyAmount(amount)} onClick={() => void post()}>
            {busy ? "Working…" : mine ? `Update to ${inr(amount)}${apiVoucher ? ` · ${brand(apiVoucher).name}` : ""}` : fullAddress ? "Post buy request" : "Connect to post"}
          </Button>
        )}
        {mine && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void withdraw()}>
            Withdraw
          </Button>
        )}
      </div>
      {tooBig && !mine && <p className="mt-2 text-[11.5px] text-amber">Buy requests go up to {inr(MAX_BUY_INR)}.</p>}
      {error && <p className="mt-2 text-[12px] leading-relaxed text-rose">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- spend side */

/** The matching buy requests as rows. Shared by the custom-order panel and the chat. */
export function BuyerList({ intents, amount, place, className }: { intents: BuyIntent[]; amount: number; place?: string; className?: string }) {
  if (!intents.length) return null;
  return (
    <div className={cx("rounded-2xl bg-mint/[0.05] p-3.5 ring-1 ring-mint/25", className)} data-testid="buyer-recommendations">
      <div className="flex items-center gap-2 text-[12.5px] font-medium">
        <HandCoins className="size-4 text-mint" />
        Recommended · {intents.length === 1 ? "a buyer wants" : `${intents.length} buyers want`} {inr(amount)}
        {place ? ` ${place}` : ""}
      </div>
      <ul className="mt-2.5 space-y-2">
        {intents.map((i) => {
          const v = voucherOf(i);
          return (
            <li key={i.id} className="flex items-center gap-3 rounded-xl bg-ink-2/70 px-3 py-2 ring-1 ring-white/[0.06]" data-testid="buyer-row">
              {v ? <BrandMark id={v} size={26} /> : <span className="grid size-[26px] place-items-center rounded-full bg-white/[0.07] font-mono text-[9px] text-mute">ANY</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px]">{shortAddr(i.crypto_buyer)}</span>
                <span className="block text-[11px] text-dim">
                  {v ? `Has a ${brand(v).name} voucher` : "Any voucher"} · {ago(i.createdAt)}
                </span>
              </span>
              <span className="text-[12.5px] tabular">{inr(i.amountInr)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[11.5px] text-mute">Lock your USDC at this size and they can fill your order.</p>
    </div>
  );
}

/** Pay with crypto panel: buy requests (from Firestore) that follow the store and amount currently chosen. */
export function RecommendedBuyers({ amount, brandId, brandName, className }: { amount: number; brandId: string; brandName: string; className?: string }) {
  const { fullAddress } = useApp();
  const { intents, loaded } = useMatchingBuyers(amount, brandId, fullAddress);
  if (loaded && !intents.length) {
    return (
      <p className={cx("rounded-2xl bg-white/[0.03] px-3.5 py-3 text-[12px] leading-relaxed text-mute ring-1 ring-white/[0.06]", className)} data-testid="no-buyers">
        No buyers are waiting for {inr(amount)} {brandName} yet. Buyers who post a request at this size show up here.
      </p>
    );
  }
  return <BuyerList intents={intents} amount={amount} place={brandName} className={className} />;
}
