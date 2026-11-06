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
| `/trade` | The main page, two tabs (`?mode=sell` for the second). **Buy**: order book, assistant bar and buy panel. **Pay with crypto**: the assistant chat finds a store and posts a request, and the side panel builds a custom order (store, amount, rate). Both lock USDC through the same wallet, World ID and server steps (`src/lib/lockOrder.ts`). `/home`, `/buy` and `/spend` redirect here |
| `/track` | Your orders, with Ready, Settle and Dispute actions |
| `/` | Landing: seller ⇄ escrow ⇄ buyer hero, animated trade flow, six-step walkthrough, route calculator, trust model, comparison |
| `/sell` | Seller: pick voucher brand, amount and rate, lock USDT in escrow |
| `/market` | Buyer: order book ranked by the buyer's real price per USDT after card rewards |
| `/cards` | Buyer's card portfolio (issuer, variant, caps; no card numbers) |
| `/trade/:id` | Live trade room with "View as Seller / View as Buyer", autoplay demo, verification, release and dispute |

## AI assistant (`/home`)

The assistant talks to the chatbot API from the `ai-chatbot` branch (`chatbot/server.py`). Start it before using `/home`:

```sh
git checkout ai-chatbot -- chatbot   # or use a separate worktree
cd chatbot && python3 server.py      # http://127.0.0.1:8787
```

| Option | Steps | API calls |
| --- | --- | --- |
| Spend USDC (seller) | what to buy → pick a store → amount → review → lock USDC in escrow | `/merchants/suggest`, `/request/draft` |
| Buy USDC (buyer) | add your cards → pick an open request → ranked card + channel routes with bank-portal links → accept | `/portfolio`, `/portfolio/add`, `/request/fulfil` |

Free-text questions go to `/chat`, which needs `OPENROUTER_API_KEY` in `chatbot/.env`. Without the key the guided steps still work and the assistant says AI answers are off. If the server isn't running, the chat shows how to start it and a Retry button. The user id sent to the API is the connected wallet address. Set `VITE_CHATBOT_URL` to point at another host.

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
