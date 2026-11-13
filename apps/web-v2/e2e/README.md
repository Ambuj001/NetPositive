# End-to-end checks (Playwright)

Injected test wallets sign with real secp256k1 keys (viem), against the local demo backend.

```sh
cd backend && npm run dev:mem            # terminal 1
cd apps/web-v2 && npm run dev            # terminal 2
cd apps/web-v2/e2e && mkdir -p shots
node wallets.mjs rabby                   # EIP-6963 wallet from the catalog
node wallets.mjs other                   # unknown EIP-6963 wallet
node wallets.mjs legacy                  # wallet that only injects window.ethereum
node trade.mjs                           # full two-wallet trade: post+lock, accept, Ready, sealed code, reveal, settle
```

Needs `npm i -D playwright` (or a global Playwright) and `npx playwright install chromium` once.
