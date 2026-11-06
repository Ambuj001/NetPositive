# NetPositive web v2

Dark-theme frontend for NetPositive: crypto holders pay for shops with gift vouchers, card holders fill those vouchers on their best reward route and get paid in USDT from escrow.

This is a standalone package. It is not part of the root npm workspace, so it does not change `apps/web` or the existing CI.

## Run

Requires Node 22.12+.

```sh
cd apps/web-v2
npm ci
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # output in apps/web-v2/dist
```

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Landing: seller ⇄ escrow ⇄ buyer hero, animated trade flow, six-step walkthrough, route calculator, trust model, comparison |
| `/sell` | Seller: pick voucher brand, amount and rate, lock USDT in escrow |
| `/market` | Buyer: order book ranked by the buyer's real price per USDT after card rewards |
| `/cards` | Buyer's card portfolio (issuer, variant, caps; no card numbers) |
| `/trade/:id` | Live trade room with "View as Seller / View as Buyer", autoplay demo, verification, release and dispute |

## Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Motion, React Router, Lucide icons. Fonts are self-hosted through Fontsource.

## Integration boundary

**Wallet connection is real.** `src/lib/wallet.ts` discovers installed browser wallets with EIP-6963 (MetaMask, Rabby, Coinbase Wallet, etc.), falls back to `window.ethereum`, and asks the chosen wallet for permission with `eth_requestAccounts`. The app shows the approved address and current network and follows account and network changes made in the extension. Disconnect also calls `wallet_revokePermissions` where supported. The app never signs messages or sends transactions.

Everything after connection is a UI prototype: World ID, the USDT escrow balance, voucher verification and contract events are simulated in the browser with demo data (`src/lib/store.tsx`, `src/lib/data.ts`). No funds move.

Reward maths lives in `src/lib/engine.ts` and reproduces the Product Walkthrough V3 example (₹10,000 Lifestyle voucher at ₹90/USDT: seller locks 112.22 USDT, buyer receives 111.11 USDT + 1,650 Infinia points via SmartBuy 5X). Card rates are illustrative and must be refreshed from issuer terms before real recommendations.
