/**
 * Where a buyer goes to buy the gift voucher with their card: each bank's own voucher/rewards page.
 * These are the links supplied by the product owner (same list as chatbot/data/portals.json). They are landing pages only,
 * no per-brand deep links are known. SBI has no link on file. Keep this in step with chatbot/data/portals.json.
 */
export type Portal = { name: string; url: string; note: string };

export const PORTALS: Record<string, Portal> = {
  HDFC: {
    name: "HDFC GyFTR Instant Vouchers",
    url: "https://www.gyftr.com/instantvouchers",
    note: "For the accelerated 5X rewards, use the accelerated rewards tab inside HDFC SmartBuy.",
  },
  ICICI: { name: "ICICI iShop Rewards", url: "https://www.ishoprewards.com/shopping-vouchers", note: "" },
  Axis: { name: "Axis EDGE Rewards (GyFTR)", url: "https://www.gyftr.com/edgerewards", note: "" },
  Amex: { name: "Amex Rewards Gift Cards", url: "https://global.americanexpress.com/rewards/gift-cards", note: "" },
  Kotak: { name: "Kotak GyFTR Instant Vouchers", url: "https://www.gyftr.com/kotak-instantvouchers/", note: "" },
};

/** Offered next to every bank as something to compare with. No CRED reward data is held, so no reward is claimed. */
export const CRED: Portal = { name: "CRED", url: "https://cred.club", note: "Compare here too. We hold no CRED reward rates." };

const BY_LOWER = new Map(Object.entries(PORTALS).map(([issuer, p]) => [issuer.toLowerCase(), p]));

/** The voucher page for a card issuer (case-insensitive), or null when there is none on file. */
export const portalFor = (issuer?: string | null): Portal | null => (issuer ? BY_LOWER.get(issuer.trim().toLowerCase()) ?? null : null);

/** The issuers that have a link, in a stable order, for "pick your bank". */
export const PORTAL_ISSUERS = Object.keys(PORTALS);
