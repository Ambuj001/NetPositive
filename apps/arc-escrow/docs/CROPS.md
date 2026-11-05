# CROPS threat assumptions

CROPS: Censorship resistance, Open source, Privacy, Security. This lists what NetPositive assumes, per property.
NetPositive is unaudited demo software for Arc Testnet. Use synthetic data and test funds only.

## Censorship resistance

What the design does:
- No owner, admin, proxy, pause, upgrade or seizure path. Validator and arbitrator are immutable.
- Timeouts are permissionless: anyone can refund an undelivered order, release after an uncontested review, or
  finalize the 50/50 fallback after the dispute deadline.
- Pull payments: one blocked recipient cannot stop another settlement, and a recipient can redirect `withdraw(to)`.

What you must assume:
- The USDC issuer can blocklist or freeze addresses, including the escrow. The contract cannot prevent this.
- The single validator is online to attest deliveries. If not, orders expire and refund.
- The arbitrator may be offline. The disclosed 50/50 principal fallback then applies, including for honest deliveries.
- Arc Testnet validators and RPC providers do not censor transactions.
- Issuers or merchants can cancel or redeem a voucher at any time. No on-chain mechanism resists that.

## Open source

- Contract, tests, backend, frontend and docs are in the repository and runnable.
- Deployed constructor arguments are public: validator, arbitrator, revenue recipient, review and arbitration periods.
- Assumed: reviewers rebuild with Foundry (solc 0.8.28, cancun, optimizer 200) and compare deployed bytecode.

## Privacy

What the design does:
- Voucher plaintext, PAN, CVV, PIN, OTP, vault passphrases and user keys never go to the backend or the chain.
- Vouchers are encrypted in the fulfiller's browser to the buyer's recipient key. Only a digest is committed onchain.
- The backend accepts only a strict ciphertext envelope schema and rejects unknown fields.
- Vault at rest: AES-256-GCM under a PBKDF2-SHA256 key (600,000 iterations). Recovery export is encrypted under a
  separate passphrase.

What you must assume:
- Wallet addresses, amounts, timing and digests are public onchain metadata.
- The backend sees ciphertext sizes, timing and IP addresses, and could withhold ciphertext.
- A compromised browser, extension or device exposes plaintext. Encryption does not protect a hostile endpoint.
- A weak passphrase can be guessed offline against a stolen vault or recovery file. There is no reset.
- The backend cannot verify that uploaded bytes are really ciphertext, only that they match the envelope format.
- Ownership proofs leak nothing about the secret, and prove nothing about the voucher.

## Security

What the design does:
- Escrow accounting invariant: USDC balance >= escrowed + withdrawable + dispute reserve, fuzzed and invariant-tested.
- EIP-712 attestations bind trade id, delivery digest, buyer recipient, expiry, chain id and contract.
- Deadlines are fixed when set. Arbitrator and fallback windows never overlap.
- Per-order cap of 10,000 USDC as a guard for unaudited code.

What you must assume:
- The validator honestly attests delivery. It attests an opaque ciphertext was delivered to the committed recipient,
  not that the voucher is valid. A colluding validator and fulfiller can attest garbage; buyer review and dispute are the defense.
- The arbitrator can only choose buyer or fulfiller on a disputed order and receives a capped payment from the reserve.
- Browser crypto (WebCrypto) and viem/noble libraries are correct.
- Automated and AI-assisted reviews were run. This is not a professional audit and no production audit is claimed.
