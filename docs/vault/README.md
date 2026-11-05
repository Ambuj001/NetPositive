# Private vault and voucher escrow

Working development MVP. Client encryption, a ciphertext relay, encrypted recovery,
a real Circom/Groth16 record-commitment proof and immutable EVM contracts are
implemented. Local tests and a synthetic HTTP-to-chain demo exercise them together.
These contracts and circuits have not had an independent security audit.

## Run it

Node 22.23+ and Circom 2.2.2 are used in this checkout. SQLite is experimental in
Node 22. The API deliberately has no plaintext encryption key or custody wallet.

```sh
npm ci
npm run zk:build
npm run typecheck
npm run typecheck:vault
npm run test:vault
npm run test:contracts
npm test
npm run build
```

Start each service in its own terminal from the repository root:

```sh
npm run dev:vault
npm run dev
npx --no-install hardhat node --hostname 127.0.0.1
```

Then deploy and exercise the **local development chain**, which uses synthetic
tokens and public development accounts:

```sh
npm run deploy:local
npm run demo:vault
```

The website is at `http://127.0.0.1:5173`. Open **Vault**, choose a unique recovery
passphrase, and add a synthetic gift card or payment-card portfolio entry. Closing
the vault, hiding the tab, changing wallets or five idle minutes locks it. Export
a backup before clearing browser storage. A fresh browser profile can restore that
backup without this API. The master key and plaintext exist in browser memory while
unlocked; JavaScript cannot guarantee physical memory erasure or resist a compromised
device, malicious extension, XSS or malicious replacement frontend.

## Data boundaries

| Data | Location | Access |
|---|---|---|
| Voucher code, optional gift-voucher redemption PIN, value, brand | AES-256-GCM ciphertext off chain | User's recovery key; explicitly shared voucher recipients |
| Payment-card issuer, variant, network, last four digits | Same encrypted vault | User only; SDK refuses sharing this record type |
| Full PAN, credit/debit CVV, card PIN, OTP, wallet seed/private key | Outside the product schema | Not collected by this implementation |
| Master vault key | Browser memory; encrypted inside recovery backup | User's unique passphrase |
| Opaque records | Local encrypted backup and optionally SQLite relay | Relay cannot decrypt; user can self-host another relay |
| Record proof | Created locally; public proof sent directly to registry | Anyone can verify; private secret/salt do not enter the relay |
| Commitment, reduced ciphertext digest, wallet, nullifier, timestamp | Public EVM state/events/calldata | Public and linkable to the submitting wallet |
| World proof | IDKit → our backend → pinned World verifier | Not persisted or logged; normalized action nullifier and expiry persist privately |

All encrypted record payloads are padded to 4096 bytes before encryption. AES-GCM
uses a fresh 96-bit IV; per-record AES keys and proof secrets are separated with
HKDF-SHA256. The encrypted backup uses PBKDF2-SHA256 with 600,000 iterations, random
128-bit salt, independent 96-bit IV and authenticated format label. This is a
password-hardening measure, not protection for a weak passphrase. Backups expose
their approximate aggregate size. A record envelope includes an opaque random UUID;
its type, brand, amount and code are inside encryption.

The API accepts only a bounded ciphertext envelope and strict allowlisted request
shapes. It cannot inspect arbitrary malicious ciphertext or certify that a user
has not encrypted prohibited data with another client. Provider-backed tokenization
and usable payment credentials are **not implemented**. This is not a PCI-certified
PAN vault. PCI SSC prohibits retaining card verification values for card-on-file
use after authorization, even if encrypted. [PCI SSC FAQ](https://www.pcisecuritystandards.org/faqs/1280/)

## Proof statement and deployment scope

`circuits/vault.circom` proves knowledge of a nonzero `secret` and private `salt`:

```text
commitment = Poseidon(secret, salt, digest, owner, scope)
nullifier  = Poseidon(secret, scope)
digest     = SHA256(canonical encrypted envelope) mod BN254_scalar_field
scope      = keccak256(abi.encode("NetPositive:Vault:v1", chainId, registry)) mod field
publicSignals = [commitment, nullifier, digest, owner, scope]
```

The circuit constrains the owner to 160 bits. `VaultRegistry.anchor` checks caller,
deployment scope, proof and nullifier before recording an immutable anchor. No
administrator can replace an anchor or change its verifier. Generating a new proof
does not bypass a consumed nullifier. The commitment is randomized, preventing a
dictionary attack on a low-entropy voucher code from a simple public code hash.

This is a **knowledge proof for a record commitment**. It does not prove issuer
ownership, voucher value, correctness of encryption, remaining balance, authenticity,
single redemption, legal payment-card ownership, World ID, or an eligible rewards
rate. The SHA/HKDF/encryption binding is performed by the client; those algorithms
are not inside this circuit. A malicious prover can commit arbitrary data. Registry
anchors are separate from escrow; escrow records a commitment reference without
requiring that the registry has approved voucher validity.

`zk:build` creates real development parameters, WASM, proving key and Solidity
verifier and verifies the generated key. **Its local trusted setup is unsuitable
for real assets.** A production release requires a reviewed circuit, independently
contributed/audited ceremony and verified artifact distribution. Never copy these
development parameters into a real asset deployment. The Arc deploy script deploys
only escrow; it refuses to deploy this development registry by design.

The local CLI can create a proof from an exported encrypted backup. Supply a JSON
object containing `passphrase` via private standard input, never as a command-line
argument, browser upload, API request, Git file or chat message:

```sh
node --experimental-strip-types scripts/prove-record.ts BACKUP.json RECORD_ID OWNER_ADDRESS REGISTRY_SCOPE
```

Its output contains only proof/public signals and Solidity arguments. The owner and
scope must match the selected deployed registry. Local tests use the same browser
SDK derivation, create the proof, submit it on an EVM and reject mutated signals,
another owner, another registry, zero secret and replay. A measured local anchor
uses about 316,000 gas; this is not a dollar fee quote or an Arc throughput claim.

## Sharing and settlement

Recipient keys use WebCrypto P-256 ECDH and HKDF, with a fresh ephemeral key per
share and AES-GCM authenticated trade/wallet context. The recipient signs its public
key using its wallet; the sender **must verify** that signature before encrypting.
The relay stores an immutable signed public key and recipient-only shared ciphertext.
The SDK and demo implement this; a production key-rotation and recipient private-key
recovery workflow is not yet implemented. Losing that recipient key loses access
to its shares; a decrypted voucher can instead be saved in the recipient's own vault.
Sharing cannot revoke plaintext already seen by a recipient.

`VoucherEscrow.sol` settles principal and fee through pull-payment credits:

| Event | Rule |
|---|---|
| Funding | Voucher buyer / crypto seller locks principal + floor(principal/100) |
| Delivery | Named fulfiller submits an unexpired EIP-712 validator signature binding trade, encrypted payload digest and buyer |
| Acceptance | Buyer accepts after attested delivery; fulfiller gets full principal |
| No buyer response | Anyone releases after the uncontested review window |
| No valid attested delivery | Anyone refunds all principal + fee after delivery expiry |
| Dispute | Either trade participant disputes before review expiry |
| Ruling | Immutable arbitrator pays fulfiller or refunds buyer, only to fixed participants |
| Arbitrator unavailable | After seven days anyone triggers a fixed 50/50 principal split; fee is charged proportionally on the fulfiller portion |
| Reserve compensation | Arbitrator may award the buyer from the existing reserve, once at disputed settlement, at most min(principal, 25 USDC, reserve available) |
| Withdrawal | Each account withdraws its own credit; a failed transfer leaves its credit intact |

The validator is trusted to attest delivery/check results honestly; no issuer
voucher-verification API is connected. A malicious buyer can redeem then dispute;
a malicious fulfiller can sell an invalid voucher; neither ZK nor a timeout solves
off-chain truth. Arbitration and the 50/50 unavailable-arbitrator fallback are explicit
MVP tradeoffs, susceptible to strategic disputes, and must be accepted in trade
terms before a live market. The reserve is limited, not insurance or a guaranteed
refund. Validator/arbitrator must be different and cannot participate in their own
contract's trades. Their collusion and compromised keys remain trust risks.

For 100 USDC principal, the buyer funds 101. Fulfiller receives 100; reserve receives
0.30; revenue receives 0.70. Merchant/credit-card issuer fees and card rewards are
outside this contract. Rewards eligibility still requires current issuer terms;
there is no promise that voucher purchases, crypto funding or cash equivalents earn
points. Partial fallback and smallest-unit fee/reserve splits round down on chain.

## World ID

The World app is `app_c219e412146071d3ba7c8a1d8faedc10`, RP is
`rp_e75d127dcc7506da`, and action is `netpositive-trader-v1`. The official IDKit
4.6.0 widget requests **Proof of Human only**, disables legacy proofs and binds the
proof signal to the signed-in lowercased wallet. One credential is proportionate
to the marketplace's anti-Sybil goal; no passport, selfie score or biometric record
is collected by NetPositive. [Official integration guide](https://docs.world.org/world-id/idkit/integrate)

Set the public IDs and private RP signing key in the ignored
`apps/vault-api/.env` using `.env.example`. Do not paste the signing key into
chat or commit it. The API generates signed RP context and verifies results at
the fixed `https://developer.world.org/api/v4/verify/{rp_id}` endpoint. It pins
action, nonce, signal, credential, expiry and environment; requires explicit
upstream `success: true`; and consumes the nonce transactionally. Numeric canonical
nullifiers prevent equivalent hex strings bypassing uniqueness. Production refuses
staging. API tests use injected synthetic verifier responses; they are **not**
evidence of a successful real World credential check.

The backend remembers a banned nullifier for this action. This blocks re-enrollment
through this backend under the same credential/action. It is not global identity,
KYC, proof that no other credential exists or a ban at the immutable escrow level.
Vault access and direct contract exits are independent of trader verification.
The existing trade modal is still a draft preview, not a World-gated live order API.

## CROPS

**C — Censorship resistance.** The relay can refuse requests or disappear. The user
can decrypt an exported backup using local code or self-host the app/API; ciphertext
does not require a server-held key. Contracts have no admin upgrade/pause/seize
function. Refund/release/dispute fallback functions accept direct calls without our
domain, relay, cron job or World ID service. A user still needs chain access and gas.
RPCs can censor, the chain can halt, and **Circle can block/freeze USDC**, including
the escrow address. An application cannot remove issuer or validator-set authority.
There is no decentralized ciphertext availability guarantee in this MVP. Losing
every backup/replica or the recovery passphrase is permanent loss.

**O — Open source.** Original code is MIT, with SPDX/third-party license exceptions
in the root license. snarkjs CLI integrations are GPL-3.0-or-later. Research
attachments are not relicensed. Anyone can build and run this stack independently.

**P — Privacy.** No analytics trackers are included. Client vault secrets never enter
AI prompts, reward recommendations, logs, attestation messages or chain calldata.
The relay and hosting provider see IP/timing/address, ciphertext counts and wallet
relationships for shares. World sees its protocol request and signal; the backend
sees an action nullifier. RPCs see addresses and requests; on-chain accounts and
settlement amounts remain public. This is not anonymous/shielded payment settlement.
Production hosting/access logs and wallet/RPC privacy require separate configuration.

**S — Security.** A wallet signature grants only a short-lived hashed bearer session,
not decryption. Records are append-only, owner-scoped and size/quota bounded; auth
nonces are single-use; production origin and World configuration fail closed.
Rate limiting is per process/IP. CSP and production TLS are provided in deployment
templates. SQLite WAL/FULL sync reduces ordinary crash risk, not disk/hardware loss.
Backups and independent copies are required. There is no independent audit, formal
verification, audited production ceremony, issuer verification connector, certified
payment-card tokenization or production key-management/incident response yet.

## Deployment, capacity and integration

The verified deployment in this work is **local only**. `deployments/local.json`
is ignored and belongs to the currently running development node. A public Arc
deployment needs a testnet-funded signer and distinct immutable role addresses.
`npm run deploy:arc` accepts only Arc Testnet (5042002), deploys escrow only, waits
for a receipt and checks deployed code. It uses the six-decimal USDC interface
`0x3600000000000000000000000000000000000000`; native gas uses 18 decimals, not six.
[Arc addresses](https://docs.arc.io/arc/references/contract-addresses)

For the prize, use the [created Arc Studio project](https://studio.arc.io/app/d1bf97e6-f4b7-495d-bdc7-e2f213c52033).
Studio generated work and this branch are separate until their exports are compared
and integrated. Show the real Studio history and disclose that this local vault
was started separately; ask the Arc team whether this satisfies its starting-point
rule rather than claiming automatic qualification. [Current Arc requirements](https://ethglobal.com/events/mumbai/prizes/arc)

Production host templates are not included yet. A production host requires: static frontend,
same-origin `/vault-api` proxy, TLS, non-root process and persistent private volume.
They require your chosen domain/server. This is **not a public deployment**.
Store World keys in a host secret store and inject them as environment variables;
never place them in `VITE_*`, an image layer or public asset. SQLite backup must use
its backup API or a stopped service, not a live copy of only the `.sqlite` file.

This is a bounded single-writer MVP: maximum 500 immutable records and 500 shares
per owner, 20KB request limit, short sessions, no order-matching or liquidity pool
engine. No throughput, failover SLA or million-user claim has been measured. At scale,
move the same constraints/transactions to PostgreSQL, put ciphertext in replicated
object stores, add distributed rate limits, independent backup recovery drills,
queues for attestations and load tests. Do not replace the client-side crypto with
server decryption during that migration. Users can keep independent encrypted
exports today; automated geographically independent replication is not implemented.

The team branch `backend-integration` has an Express/Firestore request API with
server-held voucher encryption and a different escrow interface. It has not been
merged or overwritten. Replace its `submit-code`/plaintext `/voucher` endpoints
with these recipient-encrypted envelopes and use an adapter for the actual escrow
ABI. Do not run both encryption designs and claim end-to-end privacy. See
[integration contract](integration.md) for the explicit boundary.

## Submission evidence

For EF, demonstrate encrypt → export → disable API → restore/decrypt in a fresh
profile, then direct permissionless contract expiry. Show what breaks when RPC or
USDC issuer access is unavailable. Keep the video within three minutes and use the
CROPS section above. [EF requirements](https://ethglobal.com/events/mumbai/prizes/ethereum-foundation)

For World, record a real/simulator success plus cancellation, wrong environment,
replayed nullifier and banned-nullifier refusal. Fill the feedback note with measured
time to first real success; do not use the synthetic API test duration as that metric.
[World requirements](https://ethglobal.com/events/mumbai/prizes/world)

Official sources checked 6 November 2026. Prize status is not implied by installing
a dependency or creating a portal project. See [status](status.md) for current evidence.
