# Voucher Route Card Research (India) — Buyer Side

Prepared 5 Nov 2026 for the Voucher Rail buyer engine.
Scope: cards and bank portals that give accelerated rewards when a buyer purchases brand gift vouchers.
Rule: the engine recommends only what the issuer's official terms allow. Every number must be re-checked against the official source before it is shown to a user.

**Source grades**
- **OFFICIAL** — read on the bank's own page or PDF.
- **SECONDARY** — reported by a review site that cites the bank; must be confirmed on the official page before going live.
- **PENDING** — not yet researched.

---

## 1. Channel summary

| Channel | Bank | What it does for vouchers | Status | Source |
|---|---|---|---|---|
| SmartBuy (GyFTR / Woohoo vouchers) | HDFC | Accelerated points on brand vouchers; voucher bonus capped at 3,000 RP/month for premium cards since 1 Jul 2026, inside the card's overall SmartBuy cap. InstaDeals excluded from accelerated points. | OFFICIAL (Infinia), SECONDARY (other cards) | [SmartBuy offer 15282](https://offers.smartbuy.hdfc.bank.in/offer_details/smartbuy/15282), [LFAL](https://livefromalounge.com/hdfc-bank-credit-cards-devalues-smartbuy-gift-vouchers-accelerated-rewards-with-new-monthly-cap-effective-today/) |
| GyFTR InstaDeals | HDFC partner | Instant discount (e.g. 7.5% Lifestyle) + 1X points. Cannot be combined with accelerated points. | OFFICIAL (calculator, 4 Nov 2026) | [GyFTR Lifestyle](https://www.gyftr.com/instantvouchers/lifestyle-gift-vouchers) |
| iShop | ICICI | 6X on vouchers and flights, 12X on hotels; per-card monthly bonus caps; separate ₹12,000/month cap on Amazon Pay, Amazon Shopping and Flipkart vouchers. | SECONDARY (data from Feb–Mar 2025 — stale) | [CardExpert](https://www.cardexpert.in/icici-bank-ishop/), [iShop](https://www.icicibank.com/ishoplogin) |
| Grab Deals | Axis | No voucher multiplier found. Magnus gift-card purchases earn nothing from 28 Aug 2026. | SECONDARY | [PickMyCard](https://www.pickmycard.in/blog/axis-bank-credit-card-devaluation-2026), [Magnus Burgundy T&C](https://campaign.axis.bank.in/generic/terms-and-conditions-magnus-burgundy.pdf) |
| Reward Multiplier | Amex India | **Ended 30 Sep 2026.** ShopWise e-vouchers still advertised at 5X on 200+ brands. | SECONDARY | [LFAL](https://livefromalounge.com/american-express-india-pulls-the-plug-on-reward-multiplier-effective-september-30-2026/), [Amex](https://www.americanexpress.com/in/benefits/rewards-program.html) |
| Aurum reward portal | SBI | No accelerated earning on buying vouchers; 4 RP per ₹100 standard. | OFFICIAL | [SBI Aurum T&C](https://www.sbicard.com/sbi-card-en/assets/docs/pdf/tandc-aurum-reward-portal.pdf) |

---

## 2. Card table (20 slots)

Reward value assumes the best official redemption (flights/hotels at ₹1 per point unless stated). Multipliers include base points.

| # | Card | Best voucher route | Voucher rate | Monthly voucher cap | Status |
|---|---|---|---|---|---|
| 1 | HDFC Infinia | SmartBuy brand vouchers 5X | ~16.5% (5 RP/₹150 × 5) | 3,000 bonus RP | OFFICIAL |
| 2 | HDFC Infinia Metal | SmartBuy 5X | ~16.5% | 3,000 bonus RP | OFFICIAL (same terms) |
| 3 | HDFC Diners Club Black Metal | SmartBuy | multiplier not confirmed | 3,000 bonus RP | SECONDARY |
| 4 | HDFC Diners Club Black | SmartBuy | multiplier not confirmed | 3,000 bonus RP | SECONDARY |
| 5 | HDFC BizBlack Metal | SmartBuy | multiplier not confirmed | 3,000 bonus RP | SECONDARY |
| 6 | HDFC Regalia Gold | SmartBuy | multiplier not confirmed | 3,000 bonus RP | SECONDARY |
| 7 | ICICI Emeralde Private Metal | iShop 6X | 18% | 18,000 bonus pts; Amazon/Flipkart vouchers ₹12,000 | SECONDARY (stale) |
| 8 | ICICI Times Black | iShop 6X | 12% | 15,000 bonus pts | SECONDARY (stale) |
| 9 | ICICI Emeralde | iShop 6X | 6% | 12,000 bonus pts | SECONDARY (stale) |
| 10 | ICICI Sapphiro | iShop 6X | 3% | 9,000 bonus pts | SECONDARY (stale) |
| 11 | ICICI Rubyx | iShop 6X | 3% | 9,000 bonus pts | SECONDARY (stale) |
| 12 | ICICI Coral | iShop 6X | 3% | 9,000 bonus pts | SECONDARY (stale) |
| 13 | Amazon Pay ICICI (cashback) | iShop co-brand | 4% | ₹1,100 cashback | SECONDARY (stale) |
| 14 | Axis Magnus | none | 0% on gift cards from 28 Aug 2026 | — | SECONDARY |
| 15 | Axis Magnus for Burgundy | none | 0% on gift cards from 28 Aug 2026 | — | SECONDARY (official PDF cited) |
| 16 | Amex Platinum Charge | ShopWise 5X | depends on MR redemption value | not confirmed | SECONDARY |
| 17 | SBI Aurum | none | 4 RP/₹100 base only, if vouchers earn at all | — | OFFICIAL |
| 18 | SBI Cashback | — | — | — | PENDING |
| 19 | Axis Ace / Flipkart Axis (cashback) | — | — | — | PENDING |
| 20 | HSBC Premier / IDFC First Wealth / Kotak (pick one) | — | — | — | PENDING |

Note: Amazon Pay ICICI's 5% (Prime) / 3% rate is for Amazon purchases. Its terms PDF has to be checked for whether gift cards and Amazon Pay balance loads earn. [Terms PDF](https://www.icicibank.com/content/dam/icicibank/india/managed-assets/revamp-page-images/docs/pdf/tc-for-amazon-pay-credit-card.pdf)

---

## 3. How the engine chooses (scenarios)

The engine works out, for a voucher request of brand B and amount A:

```
value = sum over transactions of floor(txn / spend_unit) × base_points × multiplier × point_value
        − fees, limited by remaining monthly caps
```

then ranks every (card × channel) the buyer holds, and shows why each loser lost.

| Scenario | Buyer holds | Request | Engine picks | Why the others lose |
|---|---|---|---|---|
| A. Bonus available | Infinia | Lifestyle ₹10,000 | SmartBuy 5X, 2 × ₹5,000 → 1,650 RP (₹1,650 travel, 16.5%) | InstaDeals 10.5%; direct 3.3% |
| B. Bonus used up | Infinia, 3,000 bonus RP already earned this month | Lifestyle ₹10,000 | InstaDeals 7.5% off + 1X (~10.5%) | 5X no longer pays extra after the cap |
| C. Two premium cards | Infinia + Emeralde Private Metal | Amazon Pay ₹10,000 | Compare SmartBuy 5X with iShop 6X (18%) inside the ₹12,000 iShop Amazon/Flipkart cap — only after both are re-verified | Whichever has less cap left or a lower point value |
| D. Excluded card | Axis Magnus only | any voucher | Tell the buyer this card earns nothing on gift cards; suggest the best card they hold that does | Magnus gift-card category earns 0 |
| E. Statement-credit user | Infinia, wants cash not travel | Lifestyle ₹10,000 | Show value at ₹0.30/RP = ₹495 (4.95%) | Travel value doesn't apply to their redemption choice |

Rules the engine always applies:
- Per-transaction rounding (points per ₹150 or ₹200 are rounded down on each voucher).
- Remaining monthly cap, reserved while an order is open.
- Exclusion lists (InstaDeals vs accelerated; Magnus gift-card category; wallet loads).
- Points posting delay (SmartBuy: up to 90 working days) shown as "expected", not "earned".
- Source link and "checked on" date shown with every number.

---

## 4. What this file deliberately leaves out

Ways of earning on vouchers where the issuer's terms say you shouldn't (merchant-code tricks, splitting to dodge caps, routing through wallets) are not included. The engine only recommends routes the bank officially offers, because users who rely on workarounds risk losing points or having their card closed.

---

## 5. Next research steps

1. Confirm rows 3–6 multipliers on the official SmartBuy page.
2. Re-check ICICI iShop (rows 7–13) on the official iShop terms; the data above is from early 2025.
3. Read the Axis Magnus (non-Burgundy) terms for the gift-card clause.
4. Research rows 18–20 from official bank terms.
5. Add the Europe card list once received.
