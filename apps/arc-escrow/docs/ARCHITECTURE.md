# NetPositive architecture

NetPositive is a reusable USDC voucher escrow for Arc Testnet. The buyer is the crypto seller: they lock
principal plus a 1% fee. The fulfiller delivers a client-encrypted voucher and receives the full principal.

```mermaid
flowchart LR
  subgraph BB[Buyer browser]
    BV[Private vault<br/>AES-256-GCM + PBKDF2]
    BK[Recipient private key<br/>ECDH P-256]
  end
  subgraph FB[Fulfiller browser]
    FE[Encrypt voucher to buyer key<br/>ECDH + HKDF + AES-256-GCM]
  end
  subgraph BE[Backend - ciphertext only]
    ST[Envelope store by digest<br/>buyer public keys]
    VS[Validator: EIP-712 signer]
    OV[Ownership proof verifier]
  end
  subgraph CH[Arc Testnet]
    NP[NetPositive escrow<br/>no admin / proxy / pause]
    US[USDC 0x3600...0000 - 6 decimals]
    AR[Immutable arbitrator]
  end
  BB -- "1 fund principal+fee, key hash" --> NP
  NP --- US
  BB -- "2 publish public key" --> ST
  FB -- "3 upload ciphertext" --> ST
  FB -- "4 request attestation" --> VS
  VS -- "reads order state" --> NP
  FB -- "5 submitDelivery(digest, attestation)" --> NP
  ST -- "6 ciphertext" --> BB
  BB -- "7 accept / dispute" --> NP
  AR -- "8 resolveDispute (before deadline)" --> NP
```

## Data boundaries

| Data | Browser | Backend | Chain |
| --- | --- | --- | --- |
| Voucher plaintext, PAN, CVV, PIN, OTP | yes (tab only) | never | never |
| Vault passphrase, vault plaintext, private keys | yes (tab only) | never | never |
| Ciphertext envelope | yes | stored by digest | digest only |
| Buyer public key | yes | stored | keccak256 commitment |
| EIP-712 attestation | yes | signed here | verified here |
| USDC, parties, deadlines | read | read | yes |

## Order lifecycle

```
createOrder -> Open --submitDelivery (valid attestation, before deadline)--> Delivered
Open --after delivery deadline, anyone--> Refunded (principal + fee to buyer)
Delivered --buyer accepts, or review period ends uncontested--> Released
Delivered --buyer disputes within review window--> Disputed
Disputed --arbitrator rules before dispute deadline--> ResolvedForBuyer | ResolvedForFulfiller
Disputed --anyone, after dispute deadline--> SplitFallback (50/50 principal, fee back to buyer)
```

Every settlement only credits an internal balance. Each account calls `withdraw(to)` for its own credit, so a
blocked recipient cannot stop anyone else.

## Delivery attestation (EIP-712)

Domain: `NetPositive`, version `1`, chain id, verifying contract.
Type: `DeliveryAttestation(bytes32 tradeId, bytes32 deliveryDigest, bytes32 buyerRecipient, uint64 expiry)`.
`buyerRecipient` is the keccak256 hash of the buyer's recipient public key, committed at order creation. The
`deliveryDigest` commits to the trade id, recipient hash, ephemeral key, IV and ciphertext. A Foundry test pins
the contract's digest to the digest the TypeScript signer produces.

## ZK record ownership

A Schnorr proof of knowledge (Fiat-Shamir, secp256k1) shows that you know the secret behind a vault record's
public commitment. It proves secret knowledge only. It never proves that a voucher is valid, funded or unspent.

## Components

- `contracts/NetPositive.sol`: escrow, attestation check, deadlines, pull payments.
- `server/`: ciphertext store, validator signer, ownership verifier. Start with `bun run server`.
- `src/`: React frontend, browser crypto (`src/lib/crypto.ts`), vault (`src/lib/vault.ts`).
- `scripts/arbitrate.ts`: arbitrator CLI for the testnet demo key.
- `scripts/e2e-local.ts`: full flow on a throwaway local chain.
