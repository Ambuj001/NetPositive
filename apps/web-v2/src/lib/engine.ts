/**
 * NetPositive pricing + reward route engine (client-side mock).
 * Numbers reproduce the Product Walkthrough V3 example:
 * ₹10,000 Lifestyle voucher at ₹90/USDT → buyer gets 111.11 USDT, seller locks 112.22 USDT.
 */

export const FEE_RATE = 0.01;

export function quote(voucherInr: number, rateInrPerUsdt: number) {
  const buyerReceives = round2(voucherInr / rateInrPerUsdt);
  const fee = round2(buyerReceives * FEE_RATE);
  const sellerLocks = round2(buyerReceives + fee);
  return {
    buyerReceives,
    fee,
    sellerLocks,
    reserveShare: round2(fee / 2 + 0.005),
    platformShare: round2(fee - round2(fee / 2 + 0.005)),
    sellerEffective: round2(voucherInr / sellerLocks),
  };
}

export type Channel = {
  id: string;
  name: string;
  /** reward multiplier on base points */
  multiplier: number;
  /** instant discount on voucher price, 0..1 */
  instantDiscount?: number;
  /** largest denomination this channel sells for the brand */
  denomination: number;
  note: string;
};

export type Card = {
  id: string;
  issuer: string;
  name: string;
  last: string; // purely cosmetic label, never a real card number
  gradient: string;
  /** points per ₹spendUnit */
  pointsPer: number;
  spendUnit: number;
  /** ₹ value per point on best redemption (travel) */
  travelValue: number;
  /** ₹ value per point as statement credit */
  statementValue: number;
  /** monthly cap on bonus (accelerated) points */
  bonusCap: number;
  bonusUsed: number;
  channels: Channel[];
};

export const CARDS: Card[] = [
  {
    id: "infinia",
    issuer: "HDFC",
    name: "Infinia",
    last: "Metal",
    gradient: "from-[#1b1d24] via-[#2b2f3a] to-[#0d0e12]",
    pointsPer: 5,
    spendUnit: 150,
    travelValue: 1,
    statementValue: 0.3,
    bonusCap: 3000,
    bonusUsed: 0,
    channels: [
      { id: "smartbuy", name: "SmartBuy 5X", multiplier: 5, denomination: 5000, note: "Accelerated rewards tab" },
      { id: "instadeals", name: "InstaDeals", multiplier: 1, instantDiscount: 0.072, denomination: 5000, note: "7.5% off + 1X points" },
      { id: "direct", name: "Direct", multiplier: 1, denomination: 10000, note: "Merchant checkout" },
    ],
  },
  {
    id: "magnus",
    issuer: "Axis",
    name: "Magnus Burgundy",
    last: "Burgundy",
    gradient: "from-[#3a0f1c] via-[#5b1a2c] to-[#1a070d]",
    pointsPer: 12,
    spendUnit: 200,
    travelValue: 0.5,
    statementValue: 0.2,
    bonusCap: 2500,
    bonusUsed: 600,
    channels: [
      { id: "grab", name: "Grab Deals 5X", multiplier: 5, denomination: 5000, note: "Axis Grab Deals portal" },
      { id: "direct", name: "Direct", multiplier: 1, denomination: 10000, note: "Merchant checkout" },
    ],
  },
  {
    id: "sbi",
    issuer: "SBI",
    name: "Cashback",
    last: "Cashback",
    gradient: "from-[#0c2340] via-[#123865] to-[#071322]",
    pointsPer: 5,
    spendUnit: 100,
    travelValue: 1,
    statementValue: 1,
    bonusCap: 0,
    bonusUsed: 0,
    channels: [{ id: "gyftr", name: "GyFTR", multiplier: 1, denomination: 5000, note: "5% online cashback" }],
  },
];

export type Route = {
  cardId: string;
  cardLabel: string;
  channel: Channel;
  points: number;
  bonusPoints: number;
  discountInr: number;
  travelInr: number;
  statementInr: number;
  pctTravel: number;
  pctStatement: number;
  txns: number;
  capLeftAfter: number;
};

export function routesFor(voucherInr: number, cards: Card[] = CARDS): Route[] {
  const out: Route[] = [];
  for (const c of cards) {
    for (const ch of c.channels) {
      const txns = Math.max(1, Math.ceil(voucherInr / ch.denomination));
      const perTxn = voucherInr / txns;
      // per-transaction rounding: points accrue per full spend unit
      const basePerTxn = Math.floor(perTxn / c.spendUnit) * c.pointsPer;
      const base = basePerTxn * txns;
      const capLeft = Math.max(0, c.bonusCap - c.bonusUsed);
      const rawBonus = base * (ch.multiplier - 1);
      const bonus = c.bonusCap ? Math.min(rawBonus, capLeft) : rawBonus;
      const points = base + bonus;
      const discountInr = Math.round(voucherInr * (ch.instantDiscount ?? 0));
      const travelInr = points * c.travelValue + discountInr;
      const statementInr = points * c.statementValue + discountInr;
      out.push({
        cardId: c.id,
        cardLabel: `${c.name}`,
        channel: ch,
        points,
        bonusPoints: bonus,
        discountInr,
        travelInr,
        statementInr,
        pctTravel: round2((travelInr / voucherInr) * 100),
        pctStatement: round2((statementInr / voucherInr) * 100),
        txns,
        capLeftAfter: capLeft - bonus,
      });
    }
  }
  return out.sort((a, b) => b.pctTravel - a.pctTravel);
}

export function effectivePrice(voucherInr: number, rewardInr: number, usdt: number) {
  return round2((voucherInr - rewardInr) / usdt);
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const inr = (n: number, frac = 0) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: frac, maximumFractionDigits: frac });

export const usdt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
