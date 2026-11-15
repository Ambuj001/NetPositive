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
npm test           # node tests for the pure modules (test/*.test.ts)
npm run build      # output in apps/web-v2/dist
```

`npm run build` targets **Arc mainnet and the live escrow** by default: Vite loads `.env.production` (committed, no secrets), which sets `VITE_ARC_NETWORK=mainnet` and `VITE_ESCROW_CONTRACT=0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2`. `npm run dev` never reads that file and stays on `.env` / the defaults (testnet). To build for another network or contract, set both variables in the host's environment or in `.env.production.local`; those win. See `.env.example` for every variable.

## Pages

| Route | What it shows |
| --- | --- |
| `/trade` | The main page, two tabs (`?mode=sell` for the second). **Buy**: order book, assistant bar and buy panel. **Pay with crypto**: the assistant chat finds a store and posts a request, and the side panel builds a custom order (store, amount, rate). Both lock USDC through the same wallet, World ID and server steps (`src/lib/lockOrder.ts`). `/home`, `/buy` and `/spend` redirect here |
| `/track` | Your orders. `/track?id=<order>` is one order from your side, and it runs the whole trade against the VoucherEscrowV2 contract: the spender signs Ready, releases, cancels or disputes; the buyer confirms on-chain (`accept`), then marks delivered and sends the sealed code. Each of those is a transaction from that person's own wallet (`src/lib/escrow.ts`, `src/lib/escrowFlow.ts`); the server only checks the chain afterwards |
| `/dispute` | Your orders that can be disputed or are disputed. `/dispute/:id` is one order: the spender raises a dispute (a wallet transaction that freezes the escrow and locks the order's dispute stake, then category, what happened, up to 4 screenshots; the screen shows the stake and that it comes back unless the dispute is decided against them), both sides read it, add screenshots, reply once, see the team's decision. Talks to the backend dispute module (`docs/disputes.md`) |
| `/` | Landing: seller ⇄ escrow ⇄ buyer hero, animated trade flow, six-step walkthrough, route calculator, trust model, comparison |
| `/sell` | Redirects to `/trade?mode=sell` (the old page faked a lock and was removed) |
| `/market` | Buyer: order book ranked by the buyer's real price per USDT after card rewards |
| `/cards` | Buyer's card portfolio (issuer, variant, caps; no card numbers) |
| `/trade/:id` | Redirects to `/track?id=:id` (the old walkthrough "trade room" simulated verification and release and was removed) |

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

Free-text questions go to `/chat`, which needs `OPENROUTER_API_KEY` in `chatbot/.env`. Without the key the guided steps still work and the assistant says AI answers are off. If the server isn't running, the chat shows how to start it and a Retry button. The user id sent to the API is the connected wallet address, and every call carries the backend sign-in token (`Authorization: Bearer <JWT>`), so the assistant asks people to sign in first. Set `VITE_CHATBOT_URL` to point at another host. Under `npm run dev` it defaults to `http://127.0.0.1:8787`; a production build has no default, so without the variable the assistant is switched off with a short note and nothing is sent to localhost.

## Stack

React 19, TypeScript, Vite, Tailwind CSS v4, Motion, React Router, Lucide icons. Fonts are self-hosted through Fontsource.

## Integration boundary

**Wallets.** `src/lib/wallet.ts` connects any EVM wallet:

- **Detected extensions** via EIP-6963 (MetaMask, Rabby, Coinbase, OKX, Phantom, Zerion, Brave, Rainbow, Trust, and any other wallet that announces itself), plus older wallets that only inject `window.ethereum`.
- **Base Account** (passkey popup) and **Coinbase Wallet** (app or popup) without an extension.
- **WalletConnect** (QR on desktop, wallet apps on phones); needs `VITE_WALLETCONNECT_PROJECT_ID` (free at https://cloud.reown.com; add the site's origin to the project's allowed domains). The session asks for the configured Arc network only, with its RPC (`walletConnectOptions` in `src/lib/walletLinks.ts`). Without the id the WalletConnect rows are hidden; a hint shows under `npm run dev` only.
- **Phones.** A phone browser has no injected wallet, so the picker offers "Open in wallet app" links (MetaMask, OKX, Trust, Coinbase) that reopen the page inside that wallet's browser, plus Base Account, Coinbase and WalletConnect when configured. Inside a wallet's browser the wallet is detected like an extension.
- Switching account in the wallet drops the previous account's sign-in at once (the token is kept per address). On another network the app shows a banner with a switch button, and the next transaction switches back by itself.
- The last wallet reconnects silently after a reload (`eth_accounts`, never a popup). Disconnect forgets it.
- Escrow steps switch the wallet to the configured Arc network (`VITE_ARC_NETWORK`, see `src/lib/chain.ts`) and add it first if the wallet doesn't know it (`src/lib/arc.ts`, handles MetaMask, Rabby, OKX, Coinbase and WalletConnect error shapes).

**World ID.** Browsing needs only a wallet. Proof of Human is asked once, right after connecting and again whenever someone posts or accepts an order without it. The app takes app id, action, environment and the dev-bypass flag from `GET /world-id/config`, so a frontend/backend `.env` mismatch can't break it. If the server has no RP keys, the app says exactly what to add.

**Network and escrow config.** One module, `src/lib/chain.ts`, driven by build-time env: `VITE_ARC_NETWORK=mainnet|testnet` (default testnet), `VITE_ESCROW_CONTRACT` (the VoucherEscrowV2 address this build trusts; required in a production build) and optional `VITE_ARC_RPC_URL`. If the wallet, the backend's `/health.chainId` or the backend's contract address disagrees with the build, the app says so and stops. A backend running the mock escrow is only accepted under `npm run dev`; a production build reports "escrow is not configured" instead. Nothing in a production build claims funds are locked, delivered or released unless the server or the chain said so; sample orders exist only under `npm run dev` and are labelled as demo data. `vercel.json` rewrites every path to `index.html` so deep links work.

**On-chain features.**

- *Check the escrow yourself* (`src/lib/onchain.ts`, `components/OnchainProof.tsx`): the order page reads the order's escrow record (`getEscrow`: state, amount, buyer bound on-chain, phase deadline) straight from the VoucherEscrowV2 contract through a public Arc node and compare it with what the server says. A missing deposit, a wrong amount or a different depositor shows "Don't proceed". Set `VITE_ARC_RPC_URL` to use another node.
- *Sign-In with Ethereum* (EIP-4361) for the sign-in signature.
- *Transactions carry their own gas and fees* (`src/lib/txgas.ts`, the single `send` in `src/lib/escrow.ts`): before the wallet is asked, the app calls `eth_estimateGas` (a revert becomes a readable message and nothing is sent), sets `gas` to the estimate × 1.2 and EIP-1559 fees (`maxFeePerGas = 2 × base fee + tip`; base fee from the latest block or `eth_gasPrice`, tip from `eth_maxPriorityFeePerGas` or 1 gwei). Reads go to the wallet's node first and to the configured Arc RPC if it refuses; only if both fail is the transaction sent without the fields. This is what lets wallets whose own estimator doesn't cover Arc (OKX: "Network fee estimation unsuccessful") enable Confirm. The USDC balance check uses that real maximum fee, since Arc charges gas in USDC.
- *Fee and limits from the server* (`src/lib/terms.ts`, `useTerms.ts`): `GET /escrow/terms` supplies the fee (`feeBps`), the order limits, the launch cap, the dispute stake and whether new orders are paused. Amounts outside the limits, a paused escrow or a full cap are reported before any wallet prompt. While the terms are loading or unreachable the fee falls back to 1% and is labelled "estimated"; the server's own numbers are always shown before the wallet prompt. The order rate comes from the rates API; if it is down the app says so instead of pricing with a made-up number.
- *Safer wallet steps* (`src/lib/arc.ts`): before any prompt the app checks the USDC balance on Arc (and points to the faucet), reuses an approval left from an earlier attempt, and switches to Arc before signing the Ready permit (wallets refuse typed data for another chain). Wallets that can't add networks (Phantom) are labelled in the picker and get a plain explanation.
- *Show USDC in wallet* (EIP-747 `wallet_watchAsset`) in the account sheet.

**End-to-end scripts** (`e2e/`, Playwright, injected wallets with real secp256k1 signatures). These were written for the previous escrow, where the server moved the funds. They have not been updated or re-run for escrow V2 (the buyer's on-chain confirm, mark-delivered, wallet-sent release/cancel/dispute, and the removal of `/sell` and the `/trade/:id` walkthrough), so treat them as out of date until they are. What they covered: connect with an EIP-6963 catalog wallet, an unknown EIP-6963 wallet and a legacy `window.ethereum` wallet; World ID; reload keeps the session; switch/add Arc; and a full two-wallet trade (post + lock → accept → Ready with vault key + EIP-712 permit → sealed code → reveal → settle). `e2e/errors.mjs` covers what people see when things fail: a stale session, a server error before the World App step, unusable server settings, and a wallet that can't add Arc.

Reward maths lives in `src/lib/engine.ts` and reproduces the Product Walkthrough V3 example (₹10,000 Lifestyle voucher at ₹90/USDT: seller locks 112.22 USDT, buyer receives 111.11 USDT + 1,650 Infinia points via SmartBuy 5X). Card rates are illustrative and must be refreshed from issuer terms before real recommendations. Until someone saves a card, the built-in example cards are shown and labelled as examples (My cards, Market, the route picker and the landing calculator).
