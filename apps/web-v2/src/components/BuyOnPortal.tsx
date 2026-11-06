import { ArrowUpRight } from "lucide-react";
import { brandIdFromApi, type ApiRequest } from "../lib/api";
import { brand } from "../lib/data";
import { inr } from "../lib/engine";
import { CRED, PORTALS, PORTAL_ISSUERS, portalFor, type Portal } from "../lib/portals";
import { readRoute } from "../lib/route";
import { useApp } from "../lib/store";

const pill = "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium tracking-tight transition";
const primary = `${pill} bg-mint text-ink shadow-[0_0_0_1px_rgba(61,220,151,0.5),0_8px_30px_-6px_rgba(61,220,151,0.55)] hover:brightness-110`;
const outline = `${pill} bg-white/[0.03] text-fg ring-1 ring-white/12 hover:bg-white/[0.07] hover:ring-white/25`;

function Out({ portal, className, children }: { portal: Portal; className: string; children: string }) {
  return (
    <a href={portal.url} target="_blank" rel="noopener noreferrer" className={className}>
      {children} <ArrowUpRight className="size-3.5" />
    </a>
  );
}

/**
 * The buyer's next move once they have accepted: go to their bank's voucher page and buy the voucher with the card they chose.
 * The bank comes from the route they picked when accepting (kept in this browser). If it isn't there, they pick their bank.
 */
export function BuyOnPortal({ req }: { req: ApiRequest }) {
  const { cards } = useApp();
  const route = readRoute(req.id);
  const issuer = route?.issuer ?? cards.find((c) => c.id === route?.cardId)?.issuer ?? null;
  const portal = portalFor(issuer);
  const what = `${inr(req.amountInr)} ${brand(brandIdFromApi(req.brand)).name} voucher`;

  if (!route) {
    return (
      <div className="w-full">
        <p className="text-[12.5px] text-mute">Pick the bank whose card you'll pay with. Buy the {what} there, then come back here to submit the code.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PORTAL_ISSUERS.map((i) => (
            <Out key={i} portal={PORTALS[i]} className={outline}>
              {i}
            </Out>
          ))}
          <Out portal={CRED} className={outline}>
            CRED
          </Out>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <p className="text-[12.5px] text-mute">
        Your route: <span className="text-fg/90">{route.cardLabel} · {route.channelName}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {portal ? (
          <Out portal={portal} className={primary}>
            {`Open ${portal.name}`}
          </Out>
        ) : (
          <span className="text-[12.5px] text-amber">No bank voucher page is on file for {issuer ?? "this card"}. Use CRED below, or your bank's own rewards site.</span>
        )}
        <Out portal={CRED} className={outline}>
          Compare on CRED
        </Out>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-dim">
        Buy the {what} there, then come back here to submit the code.{portal?.note ? ` ${portal.note}` : ""}
      </p>
    </div>
  );
}
