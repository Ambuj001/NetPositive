# Private code transfer module (`KeyRegistry` + `CodeMailbox`)

How the fulfiller (Saad) hands a voucher code and PIN to the requester (Shivam) privately, with a timestamp nobody can fake.

> Status: tested on an in-process EVM and **deployed to Arc testnet** (chain 5042002, 6 Nov 2026). Not audited. Not yet wired into the backend or frontend.
>
> | Contract | Address |
> |---|---|
> | `KeyRegistry` | `0x00f8924768D9b8019E6ba2878E8F55d321b98312` |
> | `CodeMailbox` | `0xA8243e92A89de7F62D3023EB68EEB4f4e40e88B1` |
> | Escrow it reads (existing `VoucherEscrow`) | `0x96456Edda0DEAd356EB8c97c2865FEBb693E0888` |
>
> Deployed from the escrow operator wallet by `scripts/deploy.mjs`; full details in `deployments/arc-testnet.json`. Verified on-chain: the registry's bytecode equals the compiled bytecode, the mailbox points at the right escrow and registry, and its EIP-712 digest equals what wallets sign. **Live test on Arc passed 12/12** (`scripts/live-e2e.mjs`, 6 Nov 2026): key registered, 0.10 USDC deposited in the real escrow, gasless Ready permit signed, sealed code delivered on-chain, event read back through the RPC and decrypted, a second delivery and a foreign wallet both refused, escrow refunded. Example delivery tx `0xb82cff3c1fd8f826785b8cb9812ba799bea0488d6c21064a45fc94a8c67ce77f` (about 150k gas). Net cost of the test was about 0.014 testnet USDC.

## What goes where

| Thing | Where | Who can read it |
|---|---|---|
| Voucher code + PIN | Only inside a sealed box (X25519 + HKDF + AES-256-GCM, see `backend/vault-sdk`) | Only the requester's wallet-derived key |
| Sealed box (ciphertext) | `Delivered` event on-chain (and its hash in storage) | Public, but unreadable without the key |
| Requester's encryption public key | `KeyRegistry` | Public by design |
| "I am ready, this fulfiller may deliver until T" | EIP-712 signature by the requester (gasless), checked by the mailbox | Public once used |
| Delivery time | `block.timestamp`, stored per escrow | Public, cannot be faked |

The mailbox never sees a code. The server never needs to.

## The flow (one trade)

1. **Once:** the requester derives a key pair from a wallet signature (`deriveVaultKeys`) and calls `KeyRegistry.setKey(publicKey)`.
2. The requester deposits USDC into the existing `VoucherEscrow` (id = `keccak256(requestId)`, as the backend already does).
3. A fulfiller accepts. The requester signs the **Ready** permit for that fulfiller (`Ready(escrowId, fulfiller, validUntil)`, EIP-712, domain `NetPositiveCodeMailbox` v1). This is the "Ready" button.
4. The fulfiller buys the voucher, then in the browser: reads the requester's key from `KeyRegistry`, seals `{code, pin}` with `seal(...)` (AAD = `voucherAad(requestId, requester, fulfiller)`), and calls `CodeMailbox.deliver(escrowId, keyId, ciphertext, validUntil, readySig)`.
5. The mailbox checks, in order: no earlier delivery, permit not expired, ciphertext 1..4096 bytes, escrow is **Funded** and read the **depositor** from it, permit signed by that depositor for `msg.sender` (EOA or ERC-1271 wallet), and the ciphertext names the depositor's **current** key. Then it stores `{fulfiller, recipient, deliveredAt, keyId, ciphertextHash}` and emits `Delivered(..., ciphertext)`.
6. The requester (and the backend indexer) read the event. The requester decrypts locally with `open(...)`. The review clock starts from `deliveredAt`.
7. Release/refund stay with the escrow operator exactly as today. The mailbox is the evidence layer, not the money layer.

## Contract summary

- `KeyRegistry`: `setKey(bytes32)`, `keyOf(address)`, `currentKeyId(address)`, `keyId(bytes32)`. Anyone can set only their own key (it is `msg.sender`). Rotation allowed.
- `CodeMailbox(escrow, registry)`: `deliver(...)`, `deliveries(escrowId)`, `matches(escrowId, ciphertext)`, `readyDigest(...)`. One delivery per escrow id. No admin, no upgrade, holds no funds.
- It uses a single read of the deployed escrow: `escrows(bytes32) -> (depositor, amount, status)`. It does not change or depend on any other escrow function.

## Run the tests

```
cd contracts
npm install
npm test        # compiles with solc-js (no Foundry needed), then runs 18 tests on an in-process EVM
```

The tests run against **the real `VoucherEscrow` source** (with a mock USDC token), the real sealed-box SDK and real EIP-712 signatures. Execution gas of `deliver` is about 109k for a ~460 byte ciphertext. Bytecode is compiled with `evmVersion: paris`.

Mutation check done by hand: deliberately removing each of the funded check, expiry check, permit check, one-delivery rule, key-id check and fulfiller binding makes the tests fail (6 of 6 caught).

## What this does NOT do (read before relying on it)

- **It cannot tell whether the voucher is valid, funded or the right brand.** It proves who delivered which ciphertext and when, not that the ciphertext contains a working code. Validity needs the extension check, zkTLS, or issuer-side delivery.
- **The ciphertext is public forever.** It is encrypted to the requester's key, and the code is short-lived, but the sender, recipient, time and size are public. X25519 is not quantum-resistant.
- **One delivery per escrow.** A mistaken delivery cannot be replaced (by design: no swapping after the fact). A wrong delivery goes through the dispute path.
- **Wallet-derived keys.** Wallets that sign the key message differently each time cannot derive a stable key (`assertDeterministicSignature` detects this); they need a recovery passphrase, not built.
- **A malicious frontend can steal the plaintext in the browser.** This protects against server/database compromise and tampering, not a replaced website.
- **The escrow is unchanged.** It still lets its operator release to any address; the mailbox does not gate it. Choose release rules in the backend.
- Live test: `node scripts/live-e2e.mjs` is read-only by default; the real run needs `OPERATOR_PK` and `CONFIRM_LIVE=<CodeMailbox address>`. The public Arc RPC rejects bursts of requests ("Request exceeds defined limit"), so clients and indexers need request spacing and retries (the script does this).
- Redeploying: `node scripts/deploy.mjs` is read-only by default; a real deploy needs `DEPLOYER_PK` and `CONFIRM_DEPLOY=<escrow address>`.

## Still to do (outside this module)

- Backend: an event indexer, a `ready`/`delivered` request state, deadlines (Ready 10 min, redeem 10 min from `deliveredAt`), dispute rules.
- Frontend: key setup, the Ready signature, sealing and `deliver` call, the vault view.
- `backend/package.json` needs `@noble/curves`, `@noble/hashes`, `@noble/ciphers` as direct dependencies (the `voucher-vault` branch already adds them).
