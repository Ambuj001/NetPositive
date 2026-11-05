# NetPositive

Payment and rewards optimisation research for credit, debit and crypto cards, including direct payment and voucher routes.

## Frontend preview

The first frontend is in `apps/web` on the `frontend` branch. See [setup and implementation details](docs/frontend/README.md).

```sh
npm ci
npm run dev
```

Requires Node 22.12+ and npm 10+. Run `npm test` and `npm run build` to check it. Wallet access uses Arc Testnet; voucher exchanges remain previews.

## Research archive

See [the research index](data/research/2026-11-05/README.md) for six original attachments, searchable PDF extracts and a source manifest with SHA-256 hashes.

The archive includes an India card dataset, an MCC/reward matrix, voucher-route research, two product walkthroughs and a global 20-programme crypto-card comparison. These are research inputs, not implemented product capabilities or production-verified reward rules.

## Verification requirements

Keep source grades, dates, exclusions, caps and regional eligibility attached to each claim. Refresh issuer terms before recommendations. Do not infer that a reward on retail purchases applies to crypto funding or gift vouchers.

The supplied MCC matrix is a PDF export, not a valid source CSV. Its text extraction has overlapping columns. The walkthrough PDFs are image-heavy and their text extracts are incomplete. Preserve and consult the originals.

## Product planning

[Latest pitch and architecture visuals](docs/product/README.md) are included as planning references, separate from the research archive.

## Isolated backend work

Branch `backend-2` contains the private vault, Arc Studio export and voucher protocol. It has no integration merges from `ai-chatbot` or `backend-integration`. See [backend status](docs/vault/status.md) and [vault setup](docs/vault/README.md).

Modules: `@netpositive/api` (`apps/vault-api`), `@netpositive/vault` (`packages/vault`), and standalone `@netpositive/arc-escrow` (`apps/arc-escrow`, Bun). The existing web application is `@netpositive/web`.
