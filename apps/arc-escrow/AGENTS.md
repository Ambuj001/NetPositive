# NetPositive

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Reusable USDC voucher escrow on Arc Testnet. Buyer (crypto seller) locks principal + 1% fee; fulfiller receives full principal after a validator-attested, client-encrypted delivery that the buyer accepts or leaves uncontested. Private gift-card vault, ZK ownership proof (knowledge of a secret only), backend that only sees ciphertext.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

## NetPositive notes

- Contract: `contracts/NetPositive.sol`. Tests in `contracts/test/` (unit, fuzz, invariant, TS parity). NOT YET DEPLOYED; deploy only on explicit request.
- Constructor args (testnet demo roles, keys in `.env` as NP_*_PRIVATE_KEY, never print them): validator 0xaf86612d8381b33C47677AEd52E6Ba977eCb023F, arbitrator 0xFd49c337FeF58752006732964453AB4D165b20c0, revenueRecipient 0x1BDe6b31c1C3a20bf5F60cDbdDf1A65f29d6951C, reviewPeriod 3600, arbitrationPeriod 86400.
- After deploy: append VITE_NETPOSITIVE_ADDRESS and VITE_NETPOSITIVE_DEPLOY_BLOCK to `.env`, restart vite and `bun run server`.
- Backend `server/` (`bun run server`, :3001, proxied at /api): ciphertext store, validator signer, ownership verifier. Never add a field that accepts plaintext.
- Shared crypto/format code in `src/shared` and `src/lib`; `server/` and `*.test.ts` are typechecked by `bun run typecheck:server` (Bun types), not by `bun run check`.
- If the contract changes: `forge build && bun run abi:export`, then update the parity digest if the EIP-712 type changes.
- Do not claim unbreakable security, issuer-freeze resistance, or production audits.
