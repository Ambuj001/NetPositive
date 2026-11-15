import { ArrowUpRight } from "lucide-react";
import type { ApiRequest } from "../lib/api";
import { PORTALS, PORTAL_ISSUERS, portalFor, type Portal } from "../lib/portals";
import { readRoute } from "../lib/route";
import { useApp } from "../lib/store";

const pill = "inline-flex items-center gap-2 rounded-full font-medium tracking-[-0.01em] transition-colors duration-200";
const primary = `${pill} h-11 px-5 text-[14.5px] bg-brand text-white hover:bg-brand-2`;
const outline = `${pill} h-9 px-4 text-[13px] bg-surface text-fg ring-1 ring-line-2 hover:bg-sunken`;

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
