import { ArrowUpRight } from "lucide-react";
import type { ApiRequest } from "../lib/api";
import { PORTALS, PORTAL_ISSUERS, portalFor, type Portal } from "../lib/portals";
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
 * The buyer's next move once the spender is ready: open their bank's voucher page and buy the voucher with the card they chose.
 * The bank comes from the route they picked when accepting (kept in this browser). If it isn't there, they pick their bank.
 */
export function BuyOnPortal({ req }: { req: ApiRequest }) {
  const { cards } = useApp();
  const route = readRoute(req.id);
  const issuer = route?.issuer ?? cards.find((c) => c.id === route?.cardId)?.issuer ?? null;
  const portal = portalFor(issuer);

  if (!route || !portal) {
    return (
      <div className="flex flex-wrap gap-2">
        {PORTAL_ISSUERS.map((i) => (
          <Out key={i} portal={PORTALS[i]} className={outline}>
            {i}
          </Out>
        ))}
      </div>
    );
  }

  return (
    <Out portal={portal} className={primary}>
      Open link
    </Out>
  );
}
