# Card Rewards Dataset — India Top 5 Issuers + Amex + International

Prepared 5 Nov 2026 for the Voucher Rail agent.
Purpose: the numbers the agent shows a buyer when it picks the card and route for a voucher. Every row carries a source grade; the agent must re-check the official page before displaying a number to a user.

**Source grades**
- **OFFICIAL** — bank MITC / terms PDF / product page read directly.
- **SECONDARY** — card-review site dated Oct–Nov 2026 citing bank terms. Use for the build; confirm on the official page before going live.
- **PENDING** — not found yet.

**How % is computed:** `points per spend unit ÷ spend unit × best official point value`. Example: Infinia 5 RP per ₹150 × ₹1 = 3.33%. "Cashback" cards are already in %.

---

## 1. MCC reference (what the agent matches against)

MCCs are set by the network and acquirer; banks state many as "best effort". A voucher bought on a bank portal is coded by the portal's merchant, not the brand, so the agent records the MCC seen on the user's statement after the first purchase.

| Category | MCCs | Typical treatment in India (2026) |
|---|---|---|
| Wallet / stored value load | 6540, 6541 | No rewards on all five banks; fees above thresholds (section 4) |
| Rent | 6513 | No rewards (HDFC since 1 Jan 2023); fee 1% (HDFC, Axis) or ₹199 (SBI) |
| Fuel | 5541, 5542, 5983, 5172 | Mostly no rewards; surcharge waiver only; Axis 1% fee ≥ ₹50k/cycle |
| Utilities | 4900 | Capped or excluded; HDFC 2,000 RP/month cap; fees above thresholds |
| Telecom / cable | 4814, 4899 | HDFC 2,000 RP/month cap; Axis treats as utility |
| Insurance | 6300 | HDFC caps: Infinia 10,000 / DCB 5,000 / others 2,000 RP per month |
| Education | 8211, 8220, 8241, 8244, 8249, 8299 | 1% fee via third-party apps (HDFC, SBI, Axis); HDFC: no points via apps |
| Government / tax | 9311, 9399, 9222 | No rewards on most cards |
| Online skill gaming | 5816 (+ 7993, 7994 at SBI) | No rewards; fees: HDFC 1% > ₹10k/month, Axis 1% ≥ ₹10k/cycle, ICICI 2% all |
| Jewellery / gold | 5944 | Excluded on SBI Cashback, Flipkart SBI, Axis premium (gold), Amazon Pay ICICI |
| Gift cards / vouchers | 5947, 5999, 5311 (varies by portal) | Earn only via official accelerated portals; Axis premium cards earn 0 from 28 Aug 2026; Flipkart SBI excludes vouchers |
| Grocery / departmental | 5411, 5311 | HDFC cap 2,000 / 1,000 RP per month; SBI ELITE/PRIME 5X–10X |
| Dining | 5812, 5814 | SBI ELITE/PRIME accelerated; HDFC DCB 2X weekends |
| Airlines / hotels / rail / bus | 4511, 7011, 4112, 4131 | Travel portals give the highest multipliers |

---

## 2. Card table — 25 cards (5 issuers × 5)

Columns: base %, best category %, voucher route, caps, key exclusions, fee, grade.

### HDFC Bank

| Card | Base | Accelerated categories | Voucher route | Caps | Exclusions | Annual fee | Grade |
|---|---|---|---|---|---|---|---|
| Infinia / Infinia Metal | 3.33% (5 RP/₹150 @ ₹1) | SmartBuy hotels 10X (33.3%), flights 5X (16.7%) | SmartBuy brand vouchers 5X (16.7%) | Voucher bonus 3,000 RP/month (from 1 Jul 2026); grocery 2,000, utilities 2,000, telecom 2,000, insurance 10,000 RP/month | Rent, fuel, govt, wallet, EMI, gaming, education via apps | ₹12,500 + GST | OFFICIAL (SmartBuy 15282, MITC 31 Oct 2026) |
| Diners Club Black Metal | 3.33% (5 RP/₹150 @ ₹1) | SmartBuy hotels/partners 10X (33%), flights/Myntra 5X (16.5%), weekend dining 2X | SmartBuy vouchers 3X (~10%) | Voucher bonus 3,000 RP/month; insurance 5,000 RP/month | As above + fuel | ₹10,000 + GST | SECONDARY (cardadvisor) + OFFICIAL caps |
| Regalia Gold | 1.25% (5 RP/₹200 @ ₹0.50) | Partner brands 25 RP/₹200 (6.25%); SmartBuy hotels 10X (12.5%), flights 5X (6.25%) | SmartBuy (multiplier not confirmed) | SmartBuy 4,000 RP/month; voucher bonus 3,000 RP/month; redemptions 50,000 RP/month | As Infinia | ₹2,500 + GST | SECONDARY (base revised 15 May 2026) |
| Millennia | 1% CashPoints | 5% on 10 partner brands | Partner brands via PayZapp/SmartBuy drop to 1% | 5% tier 1,000 CP/month; 1% tier 1,000 CP/month | Fuel, rent, EMI, wallet, govt | ₹1,000 + GST | OFFICIAL T&C (20 Jul 2026) + SECONDARY |
| Tata Neu Infinity | 1.5% NeuCoins | 5% on Tata brands (+ up to 5% NeuPass) | Tata brand vouchers inside Tata Neu | Insurance via Neu 2,000 NeuCoins/month; non-Neu UPI 0.5% capped 500/month | Wallet, rent, fuel | ₹1,499 + GST | SECONDARY |

### ICICI Bank

| Card | Base | Accelerated categories | Voucher route | Caps | Exclusions | Annual fee | Grade |
|---|---|---|---|---|---|---|---|
| Emeralde Private Metal | ~3% at ₹1/pt (6 RP/₹200); 1.2% as statement | iShop hotels 12X (36%), flights/vouchers 6X (18%) | iShop 6X vouchers (18%) | iShop bonus 18,000 pts; Amazon/Flipkart vouchers ₹12,000/month; education/grocery/utilities/insurance 1,000 pts per cycle (2026) | Rent, fuel, tax, govt | ₹12,499 | SECONDARY (iShop data early 2025 — stale) |
| Times Black | ~0.8% domestic @ ₹0.40; ~1% intl | iShop 6X vouchers (12% per iShop table) | iShop 6X | iShop bonus 15,000 pts; shared 5,000 RP/cycle on utility, insurance, education, govt | Fuel, rent, EMI | ₹20,000 | SECONDARY |
| Sapphiro | ~0.5% domestic; ~1% intl | iShop 6X (3%) | iShop 6X | iShop bonus 9,000 pts; utility ₹80k, insurance ₹80k, grocery ₹40k per cycle; transport ₹20k/month (Feb 2026) | Fuel, rent, wallet | ₹3,500 | SECONDARY |
| Rubyx | ~0.5% domestic; ~1% intl | iShop 6X (3%) | iShop 6X | Same as Sapphiro | Fuel, rent, wallet | ₹2,000 | SECONDARY |
| Amazon Pay ICICI | 1% | 5% Amazon (Prime), 3% non-Prime, 2% Amazon Pay partners | iShop co-brand 4% (cap ₹1,100) | — | Fuel, rent, EMI, education, tax, intl, gold/silver; utilities outside Amazon since 11 Oct 2025 | Lifetime free | SECONDARY; gift-card treatment PENDING ([terms PDF](https://www.icicibank.com/content/dam/icicibank/india/managed-assets/revamp-page-images/docs/pdf/tc-for-amazon-pay-credit-card.pdf)) |

### SBI Card

| Card | Base | Accelerated categories | Voucher route | Caps | Exclusions | Annual fee | Grade |
|---|---|---|---|---|---|---|---|
| Cashback SBI | 1% offline | 5% on any online merchant | Online voucher purchase — check exclusion list before use | 5% leg ₹2,000/month (₹40k spend); 1% leg ₹2,000/month; ₹48,000/year | Utility, insurance, fuel, rent, wallet, education, jewellery, railways, EMI, gaming, toll, govt (Apr 2026) | ₹999 | SECONDARY |
| SimplyCLICK | 0.25% | 10X (2.5%) partner brands; 5X (1.25%) other online | — | none listed | none listed | ₹499 | SECONDARY |
| ELITE | 0.5% (2 RP/₹100 @ ₹0.25) | 5X (2.5%) dining, grocery, departmental | — | none listed | Metro, Reliance Market, Walmart excluded from grocery rate | ₹4,999 | SECONDARY |
| PRIME | 0.5% | 10X (2.5%) dining, grocery, departmental, movies | — | none listed | Same as ELITE | ₹2,999 | SECONDARY |
| AURUM | ~1% (4 RP/₹100 @ ₹0.25) | none | Aurum portal: no accelerated voucher earn | none listed | Fuel, rent, govt, wallet (6540/6541), gaming (5816, 7993, 7994) | ₹9,999 | OFFICIAL (portal T&C) |

Note: Flipkart SBI (1%; 7.5% Myntra; 5% Flipkart/Cleartrip; ₹4,000 per quarter per tier) excludes voucher purchases.

### Axis Bank

| Card | Base | Accelerated categories | Voucher route | Caps | Exclusions | Annual fee | Grade |
|---|---|---|---|---|---|---|---|
| Magnus | 12 EDGE/₹200 (~1.2–2.4% at ₹0.20–0.40) | 35 EDGE/₹200 above ₹1.5L monthly spend | **None — gift cards earn 0 from 28 Aug 2026** | 5,00,000 pts/year; 1,00,000 to Group A | Rent, wallet, utilities, govt, EMI (Sep 2023); insurance, gold, fuel (Apr 2024); gift cards (Aug 2026) | ₹12,500 + GST | OFFICIAL (MITC) |
| Atlas | 2 EDGE Miles/₹100 | 5 Miles/₹100 travel (up to ₹2L/month) | — | 1,50,000 Miles/year; 30,000 Group A | Not stated | ₹5,000 + GST | SECONDARY (applications paused) |
| Select | 10 EDGE/₹200 (~1% @ ₹0.20) | 20/₹200 (~2%) retail on first ₹20k/month | **None — gift cards earn 0 from 28 Aug 2026** | 20/₹200 only first ₹20k/month | Same list as Magnus | ₹3,000 + GST | OFFICIAL (MITC exclusions) |
| Flipkart Axis | 1% | 5% Flipkart, Myntra, Cleartrip; 4% preferred merchants | — | not stated | PENDING | ₹500 | SECONDARY |
| Airtel Axis | 1% | 25% Airtel bills in Airtel Thanks; 10% other Thanks utilities | — | 25% capped at 2× base earned in cycle (12 Apr 2026) | Active Airtel connection required | ₹500 | SECONDARY |

Note: Axis ACE (5% Google Pay bills, 4% Swiggy/Zomato/Ola, 1.5% other) is closed to new applicants.

### Kotak Mahindra Bank

| Card | Base | Accelerated categories | Voucher route | Caps | Exclusions | Annual fee | Grade |
|---|---|---|---|---|---|---|---|
| White Reserve | ~1.6–2.5% via milestones | not published | — | not published | not published | ₹12,500 | SECONDARY (incomplete) |
| Solitaire (invite) | 3 Air Miles/₹100 | 10/₹100 Kotak Unbox flights & hotels | — | 1,00,000 miles/cycle accelerated | Rent, wallet, fuel, utilities, insurance, education, EMI, intl | Nil while member | SECONDARY |
| Zen Signature | ~0.83% (5/₹150 @ ₹0.25) | 10/₹150 shopping (~1.67%) | — | 6,500 pts per cycle | Wallet, fuel, rent, gaming, EMI | ₹1,500 | SECONDARY |
| Cashback+ Prime | 0.5% | 5% online grocery, food delivery, entertainment, auto dealers; 3% fuel | — | 750 pts (₹750) per cycle across accelerated | Rent, wallet, utility, education, transport (from waiver) | ₹750 | SECONDARY |
| 811 #DreamDifferent | 2 pts/₹100 online, 1 offline (~0.4%) | — | — | — | Fuel, railway | Nil | SECONDARY |

---

## 3. American Express India

Reward Multiplier brand links closed 30 Sep 2026. ShopWise e-vouchers still advertised at 5X.

| Card | Base | Accelerated | Milestones | Exclusions | Fee | Status |
|---|---|---|---|---|---|---|
| Gold Charge | 1 MR/₹50 (~1% @ ₹0.50) | ShopWise e-vouchers 5X (~5%) | 1,000 MR monthly for six ₹1,000+ transactions | Utilities (conflicting info) | ₹4,500 + GST | Applications paused |
| Platinum Travel | 1 MR/₹50 | — | From 10 Sep 2026: 10,000 MR at ₹4L; ₹20,000 Taj voucher at ₹7L | — | ₹5,000 + GST | Applications paused |
| MRCC | 1 MR/₹50 | — | 1,000 MR for four ₹1,500+ txns; 1,000 MR at ₹20k/month | Fuel, insurance, utilities | ₹4,500 + GST | Applications paused |
| SmartEarn | 1 MR/₹50 | 10X Flipkart, Uber, Myntra etc. (500/month); 10X EaseMyTrip, Zomato (500/month); 5X Amazon (250/month) | ₹500 voucher at ₹1.2L, ₹1.8L, ₹2.4L | — | ₹495 | Applications paused |
| Platinum Charge | 1 MR/₹40 | — | Welcome up to ₹60,000 | not specified | ₹66,000 + GST | Applications paused |

Grade: SECONDARY ([cardadvisor](https://cardadvisor.in/banks/american-express-credit-cards), [LFAL](https://livefromalounge.com/american-express-india-pulls-the-plug-on-reward-multiplier-effective-september-30-2026/)).

---

## 4. Wallet top-up structure

### Bank fees on loading wallets by credit card

| Bank | Fee | Threshold | MCC | Effective | Grade |
|---|---|---|---|---|---|
| HDFC | 1% of month's wallet loads, max ₹4,999/month | > ₹10,000 per calendar month (PayZapp excluded) | 6540 | 1 Jul 2025 | OFFICIAL |
| ICICI | 1% | > ₹5,000 per month (Amazon Pay, Paytm, MobiKwik, Freecharge, OlaMoney) | — | 15 Jan 2026 | SECONDARY |
| SBI | 1% of each load | each load > ₹1,000 | 6540, 6541 | 1 Nov 2025 | OFFICIAL |
| Axis | 1% | cumulative ≥ ₹10,000 per statement cycle | 6540 | 20 Dec 2024 | OFFICIAL |
| Kotak | — | — | — | — | PENDING |

All five banks give **no rewards** on wallet loads.

### Regulatory limits (RBI PPI rules)

| Wallet type | Limit | Status |
|---|---|---|
| Full-KYC PPI | ₹2,00,000 outstanding balance | In force (RBI notification 12094); 2026 draft keeps ₹2 lakh with equal monthly debit cap, P2P ₹25,000/month |
| Small (min-KYC) PPI | ₹10,000 balance | 2026 draft |
| Gift PPI (e.g. Amazon Pay gift card) | ₹10 to ₹10,000 per card, not reloadable, monthly redemption caps set by issuer | Amazon Pay terms (Pine Labs) |

The 2026 PPI direction was a draft (comments closed 22 May 2026); confirm whether it has been finalised.

---

## 5. International cards (gift-card relevant)

US cards from UpgradedPoints (8 Aug 2026). Amex US terms exclude "purchases of gift cards" from eligible purchases.

| Card | Country | Where gift cards can earn | Rate | Cap | Fee | Gift-card caveat |
|---|---|---|---|---|---|---|
| Chase Ink Business Cash | US | Office supply stores | 5% | $25,000/yr combined | $0 | No exclusion stated |
| U.S. Bank Cash+ | US | Chosen 5% categories | 5% | $2,000/quarter | $0 | None stated |
| Huntington Voice Business | US | Rotating category incl. office supply | 4% | $7,000/quarter | $0 | None stated |
| Costco Anywhere Visa (Citi) | US | Costco in-store gift cards | 2% | — | $0 + Costco membership | Explicitly earns |
| Amex Gold / Blue Cash Preferred / Everyday | US | Supermarkets | 4x / 6% / 3% | $25k / $6k / $6k per year | $325 / $95 / $0 | **Gift cards excluded** by Amex terms |
| Crypto.com Visa Private/Obsidian | EEA | Any eligible merchant (card terms prohibit buying crypto) | 4.5% (token) | First US$5,000/month, then 1% | US$500k stake | Verified 4 Nov 2026 |
| Revolut (RevPoints) | France, Poland (terms differ by country) | — | — | — | — | PENDING |

Europe list: waiting for the user's card list.

---

## 6. Agent rules

1. Rank only (card × official channel) pairs the user holds; never suggest an excluded MCC route.
2. Subtract each card's remaining monthly/cycle cap before showing %; reserve the cap while an order is open.
3. Apply per-transaction rounding (floor of spend ÷ unit).
4. Show "expected" until points post (SmartBuy: up to 90 working days).
5. Show source link + "checked on" date next to every number; block the number if the source is older than 30 days.
6. For wallet routes, add the bank fee and zero reward before ranking.

## 7. Open items

- Kotak wallet fee; Kotak White Reserve details.
- Confirm SECONDARY rows on official pages (priority: ICICI iShop 2026 terms, HDFC DCB/Regalia Gold voucher multipliers, Amazon Pay ICICI gift-card treatment).
- Europe card list.

## Sources

- HDFC MITC (31 Oct 2026): https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/cards/credit-cards/personal-mitc/mitc-in-english.pdf
- HDFC SmartBuy offer 15282: https://offers.smartbuy.hdfc.bank.in/offer_details/smartbuy/15282
- HDFC Millennia T&C: https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/cards/credit-cards/millennia-credit-card/pdf/millennia-tnc-20th-jul26.pdf
- Axis MITC: https://www.axis.bank.in/docs/default-source/default-document-library/mitc-credit-cards.pdf
- SBI Key Fact Statement: https://www.sbicard.com/sbi-card-en/assets/docs/pdf/key-fact-statement.pdf
- SBI Aurum portal T&C: https://www.sbicard.com/sbi-card-en/assets/docs/pdf/tandc-aurum-reward-portal.pdf
- CardAdvisor HDFC / ICICI / SBI / Kotak / Amex pages and Axis ladder (Sep–Nov 2026)
- Finology, ICICI 2026 changes: https://select.finology.in/articles/credit-card/icici-bank-credit-card-changes-2026
- CardExpert, ICICI iShop: https://www.cardexpert.in/icici-bank-ishop/
- LiveFromALounge, HDFC voucher cap and Amex Reward Multiplier
- RBI PPI notification 12094; Business Today on 2026 draft
- Pine Labs Amazon Pay gift card terms
- UpgradedPoints, best cards for gift cards (8 Aug 2026)
