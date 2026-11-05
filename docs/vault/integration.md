# Integration boundary

This branch intentionally excludes other team modules. The vault API accepts encrypted envelopes only; never connect a plaintext voucher-code endpoint to it. World ID configuration belongs in ignored server environment files.

The newer protocol is `contracts/src/VoucherEscrow.sol`; the standalone Studio application uses `apps/arc-escrow/contracts/NetPositive.sol`. Their ABIs, states and fee allocation differ. Do not connect either frontend to the other's contract address without an explicit adapter and end-to-end validation.

The supplied build specification is preserved in `apps/arc-escrow/docs/planning/agent-build-prompt.md`. Public issuer proof providers and real World credential verification remain prerequisites for claims about voucher validity and human identity.
