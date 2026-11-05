# Project brief: NetPositive (ETHGlobal Mumbai)

Updated 5 Nov 2026.

## Core model
A P2P voucher-for-crypto marketplace. The crypto SELLER wants to spend at a merchant and posts a voucher request with USDT locked in escrow. The crypto BUYER buys that merchant's brand voucher on the best reward route for their own card (e.g. HDFC Infinia via SmartBuy/GyFTR, 5X) and hands it over through the verification layer. The buyer keeps 100% of their card rewards (we only predict them; we pay no cashback). The seller pays a 1% fee, part of which funds a dispute reserve.

## Must solve before launch
- Voucher terms: e.g. Amazon Pay gift cards "cannot be reloaded, resold, transferred for value or redeemed for cash".
- The voucher provider keeps a copy of the code; re-check before release + dispute reserve reduce but don't remove this risk.
- Automated balance checks need issuer/merchant permission or an API.
- Tax: crypto trades paid in kind may need TDS under Section 194S; confirm with a CA.

## Working rules
- Card questions: fetch the latest official issuer circular / offer T&Cs before answering. Check caps, exclusions, minimum spend, stacking, expiry, fees. Show source link, effective date and date checked.
- Rank by net value after caps and fees; keep instant discount separate from future rewards.
- Never collect card numbers, CVV, PIN or OTP.

## Event rules (checked 5 Nov 2026)
- Submission deadline: Sat 7 Nov 2026, 09:00 IST. Max 3 partner prizes.
- Classic track: no prior project-specific code, designs or assets. Disclose AI use; include planning artifacts if spec-driven.
- Demo video 2–4 minutes (EF CROPS needs 3 minutes or less).

## Verified reward facts (re-check before reuse)
- HDFC Infinia: 5 RP per ₹150; ₹1/RP on flights/hotels, up to ₹0.30 as statement credit.
- SmartBuy offer 15282: Infinia brand vouchers 5X, voucher bonus cap 3,000 RP/month; hotels 10X. Points post within 90 working days.
- GyFTR Lifestyle ₹5,000 with Infinia: 5X route ₹825 (16.5%) vs InstaDeals ₹525 vs direct ₹165.

## Open questions
- Which three partner prizes to enter (candidates: World IDKit, Arc conditional escrow, EF CROPS).
- Europe card list.
