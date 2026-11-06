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

**Wallet connection is real.** `src/lib/wallet.ts` lists these wallets: Base, MetaMask, Coinbase Wallet, Rainbow, Rabby, Trust Wallet, Phantom, Brave Wallet and WalletConnect, plus any other extension found via EIP-6963.

- Installed extensions open their own approval popup (`eth_requestAccounts`).
- **Base** opens the Base Account passkey popup (`@base-org/account`), no extension needed.
- **Coinbase Wallet** uses the extension if installed, otherwise the Coinbase popup (`@coinbase/wallet-sdk`).
- **WalletConnect** shows a QR code for mobile wallets. It needs a free project ID from https://cloud.reown.com in `.env` as `VITE_WALLETCONNECT_PROJECT_ID` (see `.env.example`). Without it the option is shown as "Setup".
- Wallets that aren't installed link to their download page.

The app shows the approved address and network and follows account and network changes. It never signs messages or sends transactions.

Everything after connection is a UI prototype: World ID, the USDT escrow balance, voucher verification and contract events are simulated in the browser with demo data (`src/lib/store.tsx`, `src/lib/data.ts`). No funds move.

Reward maths lives in `src/lib/engine.ts` and reproduces the Product Walkthrough V3 example (₹10,000 Lifestyle voucher at ₹90/USDT: seller locks 112.22 USDT, buyer receives 111.11 USDT + 1,650 Infinia points via SmartBuy 5X). Card rates are illustrative and must be refreshed from issuer terms before real recommendations.
