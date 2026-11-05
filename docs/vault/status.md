# Backend-2 status — 6 November 2026

This is an isolated development branch. No changes are merged into main. Other team backend/chatbot modules are not included.

Implemented locally:
- Client-encrypted vault, encrypted recovery exports, authenticated ciphertext API, recipient-only sharing.
- Circom/Groth16 record-commitment circuit and real local-EVM proof verification. Setup parameters are development-only.
- Voucher protocol with identity registry, attestor quorum snapshots, reserve caps, 10% holdback, duplicate-voucher protection and dispute/time-out paths. The fee is at most 1%, truncated to cents, with a 50/50 reserve/treasury split.
- Original Arc Studio application, preserved as a standalone module with its own older 30/70 escrow design. Its UI is not yet connected to the new multi-contract protocol.
- World ID v4 request/verification implementation; real credential verification needs the local RP signing key.

External work still pending:
- Public Arc deployment: Circle testnet wallet is funded, but Circle's experimental deployment estimator returned HTTP 400. No public contract deployment is claimed.
- Live issuer/zkTLS balance verification and provider configuration. No real voucher validity or fraud-detection result is claimed.
- New protocol API/indexer and full UI integration from the supplied specification.
- Card recommendations remain in the team's separate branch; they have not been duplicated or merged here.

The passing tests verify implemented behavior, not completion of these external integrations or a production audit. Root verification logs are local under ignored `var/`.
