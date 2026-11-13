# NetPositive web v2

Frontend for NetPositive: crypto holders pay for shops with gift vouchers, card holders fill those vouchers on their best reward route and get paid in USDC from escrow.

**Brand.** White surfaces, near-black type and one electric blue (`#0000FF`). Green (`#00C26E`) is reserved for "positive": gains, live signals and the corner pixel of the logo. The kit is live at `/brand` and lives in the repo:

| Asset | Where | What it does |
| --- | --- | --- |
| Logo | `Mark` / `Logo` in `src/components/ui.tsx`, SVGs in `public/brand` | 3×3 pixel grid: five pixels make the plus, the corner pixel is green. Pixels pop in; the green one hops on hover |
| LED type | `src/brand/led.ts`, `src/brand/LedBoard.tsx` | Our own 5×7 dot alphabet on a canvas board. Dots fly in, a sweep crosses, they scatter from the pointer and turn green where touched, and regroup to morph between texts |
| Plus field | `src/brand/PlusField.tsx` | Background grid of plus marks that turn and light up under the pointer, with a ripple |
| Pixel icons | `src/components/PixelIcon.tsx` | 7×7 glyphs in a ticked frame that light up dot by dot |
| Sticker | `Sticker` in `ui.tsx` | Tilted blue block under LED type, one per page |

All motion respects `prefers-reduced-motion` and pauses off screen. Tokens are in `src/index.css`; body type is Geist, numbers and code Geist Mono.

This is a standalone package. It is not part of the root npm workspace.

## Run the whole product locally (no keys needed)

```sh
cd backend && npm ci && npm run dev:mem      # :8080, in-memory DB, mock escrow, World ID dev bypass, 8 demo orders
cd apps/web-v2 && npm ci && npm run dev      # http://localhost:5173
```

Connect any EVM wallet, sign in (one free signature), and you're registered as a human (dev bypass). Real World ID: put
`WORLD_ID_RP_ID` and `WORLD_ID_SIGNING_KEY` in the shell and run `WORLD_ID=real npm run dev:mem`; with `WORLD_ID_ENV=staging`
scan the QR with the [World ID Simulator](https://simulator.worldcoin.org), not the World App (production needs `WORLD_ID_ENV=production`).

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
| `/dispute` | Your orders that can be disputed or are disputed. `/dispute/:id` is one order: raise a dispute (category, what happened, up to 4 screenshots, stake USDC), read it, add screenshots, reply once, see the team's decision. Talks to the backend dispute module (`docs/disputes.md`) |
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

**Wallets.** `src/lib/wallet.ts` connects any EVM wallet:

- **Detected extensions** via EIP-6963 (MetaMask, Rabby, Coinbase, OKX, Phantom, Zerion, Brave, Rainbow, Trust, and any other wallet that announces itself), plus older wallets that only inject `window.ethereum`.
- **Base Account** (passkey popup) and **Coinbase Wallet** (app or popup) without an extension.
- **WalletConnect** QR for mobile wallets; needs `VITE_WALLETCONNECT_PROJECT_ID` (free at https://cloud.reown.com). The session includes Arc Testnet.
- The last wallet reconnects silently after a reload (`eth_accounts`, never a popup). Disconnect forgets it.
- Escrow steps switch the wallet to Arc Testnet and add the network first if the wallet doesn't know it (`src/lib/arc.ts`, handles MetaMask, Rabby, OKX, Coinbase and WalletConnect error shapes).

**World ID.** Browsing needs only a wallet. Proof of Human is asked once, right after connecting and again whenever someone posts or accepts an order without it. The app takes app id, action, environment and the dev-bypass flag from `GET /world-id/config`, so a frontend/backend `.env` mismatch can't break it. If the server has no RP keys, the app says exactly what to add.

**Tested end to end** (Playwright, injected wallets with real secp256k1 signatures): connect with an EIP-6963 catalog wallet, an unknown EIP-6963 wallet and a legacy `window.ethereum` wallet; World ID; reload keeps the session; switch/add Arc; and a full two-wallet trade (post + lock → accept → Ready with vault key + EIP-712 permit → sealed code → reveal → settle).

Reward maths lives in `src/lib/engine.ts` and reproduces the Product Walkthrough V3 example (₹10,000 Lifestyle voucher at ₹90/USDT: seller locks 112.22 USDT, buyer receives 111.11 USDT + 1,650 Infinia points via SmartBuy 5X). Card rates are illustrative and must be refreshed from issuer terms before real recommendations.
