# Card × MCC Reward Matrix

Prepared 5 Nov 2026 for the Voucher Rail recommendation agent. Machine-readable version: `card-mcc-reward-matrix.csv` (one row per card × MCC group, with cap notes and sources).

## How to read a cell

| Mark | Meaning | Agent behaviour |
|---|---|---|
| `16.67` | Reward % confirmed for this category (official or review site) | Use, with cap from CSV |
| `3.33*` | Card's base rate; the bank lists no special rule for this category | Use, but label "base rate, not category-confirmed" |
| `0✗` | Category excluded — earns no reward (often also carries a fee) | Never recommend this card for this MCC |
| `?` | Unknown | Don't show a %; say "not confirmed" |

% = points per spend unit × best official point value (HDFC Infinia/DCB ₹1 on travel; ICICI premium ₹1 on iShop travel/vouchers; SBI ₹0.25; Axis EDGE ₹0.20; Amex MR ₹0.50). Cashback cards are face value.

## MCC groups

| Code | Category | MCCs |
|---|---|---|
| GEN | Other offline retail | 5310, 5399, 5699, 5732 etc. |
| ONLINE | General online retail | 5964, 5999, 5691 (online) |
| GROC | Grocery | 5411 |
| DEPT | Department stores | 5311 |
| DINE | Dining, food delivery | 5812, 5814 |
| MOVIE | Movies | 7832 |
| FUEL | Fuel | 5541, 5542, 5983, 5172 |
| UTIL | Utilities | 4900 |
| TEL | Telecom, cable | 4814, 4899 |
| INS | Insurance | 6300 |
| RENT | Rent | 6513 |
| WALLET | Wallet load | 6540, 6541 |
| EDU | Education | 8211, 8220, 8241, 8244, 8249, 8299 |
| GOVT | Government, tax | 9311, 9399, 9222 |
| GAME | Online gaming | 5816, 7993, 7994 |
| JEWEL | Jewellery, gold | 5944 |
| RAIL | Rail | 4112 |
| AIR | Airlines | 3000–3350, 4511 (direct; portal rate shown where higher) |
| HOTEL | Hotels | 3501–3999, 7011 (direct; portal rate shown where higher) |
| GVP | Gift voucher via bank portal (SmartBuy, iShop, ShopWise) | portal merchant's MCC |
| GVD | Gift card bought from merchant or aggregator | 5947, 5999, 5311 (varies) |

Note: a portal-bought voucher carries the portal's MCC, not the brand's. The agent should record the MCC that appears on the user's statement after the first purchase.

## Matrix (%)

| Bank | Card | GEN | ONLINE | GROC | DEPT | DINE | MOVIE | FUEL | UTIL | TEL | INS | RENT | WALLET | EDU | GOVT | GAME | JEWEL | RAIL | AIR | HOTEL | GVP | GVD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HDFC | Infinia / Infinia Metal | 3.33* | 3.33* | 3.33 | 3.33* | 3.33* | 3.33* | 0✗ | 3.33 | 3.33 | 3.33 | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 3.33* | 3.33* | 16.67 | 33.33 | 16.67 | 3.33* |
| HDFC | Diners Club Black Metal | 3.33* | 3.33* | 3.33 | 3.33* | 6.67 | 3.33* | 0✗ | 3.33 | 3.33 | 3.33 | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 3.33* | 3.33* | 16.5 | 33 | 10 | 3.33* |
| HDFC | Regalia Gold | 1.25* | 1.25 | 1.25 | 1.25* | 1.25* | 1.25* | 0✗ | 1.25 | 1.25 | 1.25 | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 1.25* | 1.25* | 6.25 | 12.5 | ? | 1.25* |
| HDFC | Millennia | 1* | 1 | 1* | 1* | 1* | 1* | 0✗ | 1* | 1* | 1* | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 1* | 1* | 1* | 1* | 1 | 1* |
| HDFC | Tata Neu Infinity | 1.5* | 1.5 | 1.5* | 1.5* | 1.5* | 1.5* | 0✗ | 1.5* | 1.5* | 1.5 | 0✗ | 0✗ | 1.5* | 0✗ | 0✗ | 1.5* | 1.5* | 1.5* | 1.5* | 5 | 1.5* |
| ICICI | Emeralde Private Metal | 3* | 3* | 3 | 3* | 3* | 3* | 0✗ | 3 | 3* | 3 | 0✗ | 0✗ | 3 | 0✗ | 0✗ | 3* | 3* | 18 | 36 | 18 | 3* |
| ICICI | Times Black | 0.8* | 0.8* | 0.8* | 0.8* | 0.8* | 0.8* | 0✗ | 0.8 | 0.8* | 0.8 | 0✗ | 0✗ | 0.8 | 0.8 | 0✗ | 0.8* | 0.8* | 12 | 24 | 12 | 0.8* |
| ICICI | Sapphiro | 0.5* | 0.5* | 0.5 | 0.5* | 0.5* | 0.5* | 0✗ | 0.25 | 0.5* | 0.25 | 0✗ | 0✗ | 0.5* | 0.5* | 0✗ | 0.5* | 0.5 | 3 | 6 | 3 | 0.5* |
| ICICI | Rubyx | 0.5* | 0.5* | 0.5 | 0.5* | 0.5* | 0.5* | 0✗ | 0.25 | 0.5* | 0.25 | 0✗ | 0✗ | 0.5* | 0.25 | 0✗ | 0.5* | 0.5 | 3 | 6 | 3 | 0.5* |
| ICICI | Amazon Pay ICICI | 1* | 1 | 1* | 1* | 1* | 1* | 0✗ | 0✗ | 0✗ | 1* | 0✗ | ? | 0✗ | 0✗ | 0✗ | 0✗ | 1* | 1* | 1* | 4 | ? |
| SBI | Cashback SBI | 1 | 5 | 1* | 1* | 1* | 1* | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 1* | 1* | 1* | 5 |
| SBI | SimplyCLICK | 0.25* | 1.25 | 0.25* | 0.25* | 0.25* | 0.25* | 0✗ | 0.25* | 0.25* | 0.25* | 0✗ | 0✗ | 0.25* | 0.25* | 0.25* | 0.25* | 0.25* | 0.25* | 0.25* | 0.25* | 0.25* |
| SBI | ELITE | 0.5* | 0.5* | 2.5 | 2.5 | 2.5 | 0.5* | 0✗ | 0.5* | 0.5* | 0.5* | 0✗ | 0✗ | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* |
| SBI | PRIME | 0.5* | 0.5* | 2.5 | 2.5 | 2.5 | 2.5 | 0✗ | 0.5* | 0.5* | 0.5* | 0✗ | 0✗ | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* |
| SBI | AURUM | 1* | 1* | 1* | 1* | 1* | 1* | 0✗ | 1* | 1* | 1* | 0✗ | 0✗ | 1* | 0✗ | 0✗ | 1* | 1* | 1* | 1* | 1 | 1* |
| Axis | Magnus | 1.2 | 1.2* | 1.2* | 1.2* | 1.2* | 1.2* | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 1.2* | 0✗ | 1.2* | 0✗ | 1.2* | 1.2* | 1.2* | 0✗ | 0✗ |
| Axis | Atlas | 2* | 2* | 2* | 2* | 2* | 2* | 0✗ | 2* | 2* | 2* | 0✗ | 0✗ | 2* | 2* | 2* | 2* | 2* | 5 | 5 | 2* | 2* |
| Axis | Select | 2 | 1* | 1* | 1* | 1* | 1* | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 0✗ | 1* | 0✗ | 1* | 0✗ | 1* | 1* | 1* | 0✗ | 0✗ |
| Axis | Flipkart Axis | 1* | 1 | 1* | 1* | 1* | 1* | 0✗ | 1* | 1* | 1* | 0✗ | 0✗ | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* |
| Axis | Airtel Axis | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1 | 1 | 1* | 0✗ | 0✗ | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* |
| Kotak | White Reserve | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? |
| Kotak | Solitaire | 3* | 3* | 3* | 3* | 3* | 3* | 0✗ | 0✗ | 3* | 0✗ | 0✗ | 0✗ | 0✗ | 3* | 3* | 3* | 3* | 10 | 10 | 3* | 3* |
| Kotak | Zen Signature | 0.83* | 1.67 | 0.83* | 0.83* | 0.83* | 0.83* | 0✗ | 0.83* | 0.83* | 0.83* | 0✗ | 0✗ | 0.83* | 0.83* | 0✗ | 0.83* | 0.83* | 0.83* | 0.83* | 0.83* | 0.83* |
| Kotak | Cashback+ Prime | 0.5* | 0.5* | 5 | 0.5* | 5 | 5 | 3 | 0.5* | 0.5* | 0.5* | 0✗ | 0✗ | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* | 0.5* |
| Kotak | 811 #DreamDifferent | 0.2* | 0.4 | 0.2* | 0.2* | 0.2* | 0.2* | 0✗ | 0.2* | 0.2* | 0.2* | 0.2* | 0.2* | 0.2* | 0.2* | 0.2* | 0.2* | 0✗ | 0.2* | 0.2* | 0.2* | 0.2* |
| Amex | Gold Charge | 1* | 1* | 1* | 1* | 1* | 1* | 1* | ? | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 5 | 1* |
| Amex | Platinum Travel | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* |
| Amex | Membership Rewards (MRCC) | 1* | 1* | 1* | 1* | 1* | 1* | 0✗ | 0✗ | 1* | 0✗ | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* |
| Amex | SmartEarn | 1* | 1 | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* | 1* |
| Amex | Platinum Charge | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* | 1.25* |

## Category rates that live in the notes (CSV `cap_or_note`)

Some cards pay more at named merchants, not whole MCCs. The matrix shows the MCC rate; the CSV note gives the merchant rate:

- HDFC Millennia: 5% at 10 partner brands (cap 1,000 CashPoints/month).
- HDFC Regalia Gold: 6.25% at partner brands.
- HDFC Tata Neu Infinity: 5% at Tata brands.
- ICICI Amazon Pay: 5% Amazon (Prime) / 3% non-Prime; 2% Amazon Pay partners.
- SBI SimplyCLICK: 2.5% at partner brands.
- Axis Flipkart: 5% Flipkart/Myntra/Cleartrip; 4% preferred merchants.
- Axis Airtel: 25% Airtel bills, 10% other utilities inside Airtel Thanks.
- Axis Magnus: 3.5% on spend above ₹1.5 lakh in a month.
- Amex SmartEarn: 10X at named partners (cap 500 points/month), 5X Amazon (cap 250/month).

## Coverage

630 cells across 30 cards and 21 MCC groups:
- 86 confirmed (17 from official bank documents, 69 from review sites)
- 124 confirmed exclusions (0%)
- 394 base rate assumed (no category rule found)
- 26 unknown

The assumed-base cells are the main gap. For the strongest recommendations, confirm these first: gift-card treatment (GVD) on every card, fuel and wallet on Axis/Kotak co-brands, and HDFC Regalia Gold's SmartBuy voucher multiplier.

## Sources

Same sources as `card-rewards-dataset-india.md`: HDFC MITC (31 Oct 2026) and SmartBuy offer 15282; Axis MITC; SBI Key Fact Statement and Aurum portal T&C; CardAdvisor bank pages (Sep–Nov 2026); Finology (ICICI 2026 changes); CardExpert (ICICI iShop); LiveFromALounge (HDFC voucher cap, Amex Reward Multiplier).
