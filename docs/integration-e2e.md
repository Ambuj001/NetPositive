# Integration branch (`integration-e2e`)

Built from `backend-integration` (World ID v4, voucher vault, private-transfer contracts) plus the parts of `testing` that make an end-to-end test possible. `backend-integration` and `testing` were not modified.

## What was brought in from `testing` (by file, not by `git merge`)
`testing` and `backend-integration` have no common history after a force-push, so a merge would conflict in every shared file and re-import old commits that contained real secrets. Instead:

- `chatbot/` (recommendation engine, merchant/request flow, MCC matrix, tests)
- `backend/scripts/integration-sim.js`, `real-firestore-check.mjs`, `chain-e2e.mjs`, `firestore-ping.mjs`
- `backend/extension/` popup edits (expected-amount field)
- `docs/open-items.md`, the MCC matrix source under `data/research/`
- Not taken: `testing`'s World ID rewrite (`routes/recovery.js`, `services/humans.js`, `world-mock.mjs`, `tools/world-test`).

Adapted for this branch: the scripts use World ID v4 proofs via `backend/test-support/world-v4-mock.mjs`; the body-size check follows the 256 KB limit; a 413 handler was added to `app.js`; the simulation gained a vault section.

## Run everything (offline, no network or Firebase needed)
```
cd chatbot && python -m unittest discover -s tests          # 80 chatbot tests
cd backend
npm run smoke:mem        # existing backend lifecycle, in-memory Firestore
npm run vault:test       # sealed-box library
npm run vault:e2e        # vault through the backend, both modes
npm run sim              # chatbot -> request -> escrow(mock) -> accept -> code -> confirm, plaintext AND vault paths
npm run chain:e2e        # dry run (mock escrow); a real Arc run needs OPERATOR_PK + CONFIRM_CHAIN_TX
cd backend/extension && npm test
cd contracts/private-transfer && npm test
```

## What the end-to-end run covers and does not
Covers: chatbot suggestions and request drafts, request creation and funding rules, accept, code submission (plaintext and sealed), seller-only access, confirm/release, security checks, secrets hygiene, the chatbot/backend brand contract.
Does not cover: real World ID, real Firestore indexes/rules (use `real-firestore-check.mjs` with a service account), real Woohoo checks, the mailbox contract from the backend (not wired), the frontend.
