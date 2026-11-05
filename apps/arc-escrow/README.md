# NetPositive

A reusable USDC voucher escrow for Arc Testnet. The buyer (the crypto seller) locks principal plus a 1% fee.
The fulfiller delivers a client-encrypted voucher and receives the full principal after an attested delivery that the
buyer accepts or leaves uncontested. Includes a private gift-card vault with an encrypted recovery export.
Testnet and synthetic data only. Unaudited.

Built with [Arc Studio](https://studio.arc.io)

## What it does

- Escrow with a 1% buyer-paid fee, earned on release and split 30% dispute reserve / 70% revenue.
- Refund of undelivered orders by anyone after the delivery deadline.
- Disputes with fixed deadlines, an immutable arbitrator, and a disclosed 50/50 principal fallback.
- Pull-payment withdrawals, so one blocked recipient cannot stop another settlement.
- Private vault: AES-256-GCM encryption in the browser, encrypted recovery export.
- Architecture diagram and CROPS threat assumptions inside the app and in `docs/`.

It does not claim unbreakable security, resistance to USDC issuer freezes, or a production audit.

## Tech stack

Solidity 0.8.28 + Foundry, OpenZeppelin 5.6, React + Vite + TypeScript + Tailwind, wagmi + viem + ConnectKit,
Bun backend, WebCrypto in the browser.

## Development

Prerequisites: Bun, Foundry.

```bash
bun install
bun run server     # backend on :3001 (proxied at /api)
bun run dev        # frontend on :5173
```

Environment variables (see `.env.example`):

- `VITE_NETPOSITIVE_ADDRESS`: deployed contract address (public).
- `VITE_NETPOSITIVE_DEPLOY_BLOCK`: block of deployment; order scans start here (public).
- `VITE_NETPOSITIVE_VALIDATOR`: validator address, only used when no validator key is loaded (public, optional).
- `NP_VALIDATOR_PRIVATE_KEY`: testnet key the backend uses to sign delivery attestations. Secret.
- `NP_ARBITRATOR_PRIVATE_KEY`: testnet key used by `bun run arbitrate`. Secret.
- `NP_TREASURY_PRIVATE_KEY`: testnet key for the revenue recipient. Secret.
- `RPC_URL_Arc_Testnet`: optional RPC override for the backend and scripts.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio, optional elsewhere.
- `PORT`: backend port, default 3001.

### Tests

```bash
bun run contracts:test        # Foundry: unit, fuzz, invariant, TS/Solidity EIP-712 parity
bun run test:ts               # crypto, vault recovery, ownership proof, backend
bun run typecheck:server      # types for backend and tests
bun run scripts/e2e-local.ts  # full flow on a throwaway local chain (needs anvil)
bun run check                 # lint + typecheck for the frontend
```

### Deploy to Arc Testnet

Constructor: `(validator, arbitrator, revenueRecipient, reviewPeriod, arbitrationPeriod)`. All values are immutable.
After deploying, add the address and deployment block to `.env`, then restart the dev server.

### Arbitrate a dispute (testnet demo)

```bash
bun run arbitrate <tradeId> fulfiller   # or: buyer
```

## Docs

- `docs/ARCHITECTURE.md`
- `docs/CROPS.md`
