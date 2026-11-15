# NetPositive

A voucher-for-crypto rail. Someone who wants to spend USDC at a merchant (the **spender**) locks it in an escrow contract. Someone with a rewarding card (the **buyer**) buys that merchant's gift voucher, delivers the code, and receives the USDC. The buyer keeps their card rewards; the spender pays a fee on top of the amount.

**Status (15 Nov 2026):** the escrow contract is live on Arc mainnet with launch limits. It has not been audited. The web app and backend are built against it; see [docs/open-items.md](docs/open-items.md) for what is not finished.

| | |
|---|---|
| Network | Arc mainnet, chain 5042 |
| Escrow contract | [`0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2`](https://explorer.arc.io/address/0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2) |
| Token | USDC `0x3600000000000000000000000000000000000000` (6 decimals) |
| Launch limits | 1 to 250 USDC per order, 5,000 USDC locked in total |
| Fee | 1% on top of the amount, half to the dispute reserve |

## How it works

1. The spender creates an order and deposits `amount + fee` into the escrow from their own wallet.
2. A buyer accepts. The spender signs a "Ready" message (no gas) naming that buyer; the buyer uses it to bind themselves to the order on-chain. From then on the money can only go to that buyer or back to the spender.
3. The buyer buys the voucher, marks it delivered on-chain and submits the code (sealed to the spender).
4. The spender checks the voucher and releases the USDC. If the spender does nothing, the buyer is paid when the review window ends. If the voucher is bad, the spender opens a dispute and an arbiter decides.

No key held by the team can pay an escrow to an address of its choosing. Details: [docs/how-it-works.md](docs/how-it-works.md).

## Repository

| Path | What it is | Check it |
|---|---|---|
| `contracts/` | `VoucherEscrowV2.sol`, tests, deploy script, deployment records (Foundry) | `forge test` |
| `backend/` | Express + Firestore API: orders, sign-in, World ID, sealed vouchers, disputes, live rates | `npm run smoke:mem`, `npm run chain:v2:local` |
| `apps/web-v2/` | The web app (Vite, React, TypeScript) | `npm run typecheck && npm test && npm run build` |
| `chatbot/` | Card and route assistant (Python, standard library) | `python -m unittest discover -s tests` |
| `tools/deploy/` | Local page that deploys the contract from a browser wallet | `node tools/deploy/test.mjs` |
| `data/research/` | Card reward datasets and source archive | |
| `docs/` | How it works, operations, disputes, vault, open items | |

Requires Node 22.12+, and Foundry for the contract and local-chain tests. Clone with submodules: `git clone --recurse-submodules`, or run `git submodule update --init --recursive` afterwards.

## Run it locally

```sh
# backend with an in-memory database and a mock escrow (no chain, no USDC moves)
cd backend && npm ci && npm run dev:mem

# web app, in another terminal
cd apps/web-v2 && npm ci && npm run dev
```

A development build of the web app talks to the local backend and labels demo data as demo. A production build targets Arc mainnet and the contract above, and refuses to send a transaction to any other address.

## Documentation

- [How it works](docs/how-it-works.md): the trade, the contract's rules, fees, timeouts, disputes.
- [Operations](docs/operations.md): hosting, environment, keys, the owner's and arbiter's jobs, what to watch.
- [Disputes](docs/disputes.md) and [voucher vault](docs/vault.md).
- [Open items](docs/open-items.md): known gaps and decisions still to make.
- [Card data](docs/cards.md) and the [research index](data/research/2026-11-05/README.md).

## Card reward data

Keep source grades, dates, exclusions, caps and regional eligibility attached to each claim. Refresh issuer terms before recommendations. About 62% of the reward matrix rows are assumed base rates, not confirmed per merchant; the app labels sample cards as examples.

## AI usage disclosure

Research datasets, planning documents and a large part of the code were prepared with Claude (Anthropic) and reviewed by the team.
