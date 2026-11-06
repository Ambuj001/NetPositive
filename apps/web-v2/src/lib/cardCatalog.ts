import type { Card } from "./engine";
import { CATALOG_DATA, MAX_VOUCHER_DENOMINATION, type RawCard, type RawRoute } from "./cardCatalog.data.ts";

/**
 * The cards a person can pick from: the list supplied by the product owner (chatbot/data/cards.json), searchable by name,
 * bank and alias. Picking one saves a reward profile built from the researched voucher routes for that card.
 *
 * Rates are only filled in where the research marks a route verified. Anything else is saved with 0% and says so on the card,
 * rather than inventing a number: the research warns most of the other figures are unverified or stale.
 */

/** Assumed value of one point (₹): the same assumption the chatbot uses. */
const TRAVEL_VALUE = 1;
const STATEMENT_VALUE = 0.3;

export const LABEL = { verified: "Verified rates", excluded: "No gift-card rewards", unconfirmed: "Rates not confirmed" } as const;

export type CatalogCard = {
  id: string;
  /** The card's full name as listed, for display and search, e.g. "HDFC Infinia". */
  title: string;
  issuer: string;
  aliases: string[];
  /** The profile that is saved when this card is picked. */
  profile: Card;
  /** True when its reward rates come from verified research. */
  verified: boolean;
};

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "HDFC Infinia" -> "Infinia"; "Amazon Pay ICICI" -> "Amazon Pay". The bank is shown separately on a card. */
export function shortName(name: string, issuer: string): string {
  const bank = new RegExp(`(^|\\s)${issuer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "gi");
  const rest = name.replace(bank, " ").replace(/\s+/g, " ").trim();
  return rest || name;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Build the reward profile saved for a catalog card. */
export function profileFor(raw: RawCard): { profile: Card; verified: boolean } {
  const usable = raw.routes.filter((r) => r.verified && (r.kind === "points" || r.kind === "flat_pct"));
  const first = usable[0];
  const base = { id: raw.id, issuer: raw.issuer, name: clip(shortName(raw.name, raw.issuer), 80), gradient: "", bonusUsed: 0 };

  if (first) {
    const flat = first.kind === "flat_pct";
    const channels = usable.map((r: RawRoute) => ({
      id: r.id,
      name: clip(r.channel, 80),
      multiplier: r.mult ?? 1,
      ...(r.discount_pct ? { instantDiscount: r.discount_pct / 100 } : {}),
      denomination: MAX_VOUCHER_DENOMINATION,
      note: clip(r.note ?? "", 200),
    }));
    return {
      verified: true,
      profile: {
        ...base,
        last: LABEL.verified,
        // A flat cashback of X% is X points per ₹100, each worth ₹1.
        pointsPer: flat ? first.reward_pct ?? 0 : first.base_pts ?? 0,
        spendUnit: flat ? 100 : first.unit ?? 100,
        travelValue: flat ? 1 : TRAVEL_VALUE,
        statementValue: flat ? 1 : STATEMENT_VALUE,
        bonusCap: Math.max(0, ...usable.map((r) => r.bonus_cap_pts ?? 0)),
        channels,
      },
    };
  }

  const excluded = raw.routes.find((r) => r.kind === "excluded");
  return {
    verified: false,
    profile: {
      ...base,
      last: excluded ? LABEL.excluded : LABEL.unconfirmed,
      pointsPer: 0,
      spendUnit: 100,
      travelValue: TRAVEL_VALUE,
      statementValue: STATEMENT_VALUE,
      bonusCap: 0,
      channels: [
        {
          id: "direct",
          name: "Direct",
          multiplier: 1,
          denomination: MAX_VOUCHER_DENOMINATION,
          note: clip(excluded?.note || "Reward rate for gift vouchers isn't confirmed yet, so none is assumed.", 200),
        },
      ],
    },
  };
}

export const CATALOG: CatalogCard[] = CATALOG_DATA.map((raw) => {
  const { profile, verified } = profileFor(raw);
  return { id: raw.id, title: raw.name, issuer: raw.issuer, aliases: raw.aliases, profile, verified };
});

/** The example cards the app used to offer, and the catalog card each one is. So picking it again isn't a duplicate. */
const LEGACY_IDS: Record<string, string> = { infinia: "hdfc_infinia", magnus: "axis_magnus_burgundy", sbi: "sbi_cashback", atlas: "axis_atlas", "amazon-icici": "icici_amazon_pay" };

/** True if this catalog card is already among the saved card ids (under its own id or an old example id). */
export function isSaved(catalogId: string, savedIds: Iterable<string>): boolean {
  for (const id of savedIds) if (id === catalogId || LEGACY_IDS[id] === catalogId) return true;
  return false;
}

/**
 * Search the catalog. Every word typed must appear somewhere in the card's name, bank or aliases, in any order and any
 * letter case. Closer matches (the name starts with what was typed) come first, otherwise the list's own order is kept.
 */
export function searchCatalog(query: string, catalog: CatalogCard[] = CATALOG): CatalogCard[] {
  const q = words(query);
  if (!q) return catalog;
  const tokens = q.split(" ");
  const scored: { c: CatalogCard; score: number; i: number }[] = [];
  catalog.forEach((c, i) => {
    const title = words(c.title);
    const hay = ` ${title} ${words(c.issuer)} ${c.aliases.map(words).join(" ")} `;
    if (!tokens.every((t) => hay.includes(t))) return;
    const score = title === q ? 0 : title.startsWith(q) ? 1 : tokens.every((t) => hay.includes(` ${t}`)) ? 2 : 3;
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((x) => x.c);
}
