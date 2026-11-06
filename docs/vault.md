# Voucher vault

Voucher codes are the most valuable thing the backend touches. This design makes sure **the server can never read a code**, so a leaked database, a leaked server key or a rogue admin exposes nothing.

## The problem it fixes

Before: every voucher was encrypted with one server key (`VOUCHER_ENC_KEY`) and the server saw each code in plaintext. Leak the database and that one key and every voucher ever stored is readable. (`backend/scripts/vault-e2e.mjs` demonstrates this on the legacy path.)

## How it works, in one story

1. **Shivam** (the seller of crypto) opens the app once and signs a fixed message with his wallet. His browser turns that signature into a secret key and a matching public key. The **public** key goes to the server; the signature that proves it is his goes with it. The secret key is never stored anywhere: his wallet recreates it whenever he signs the same message again.
2. **Saad** (who bought the voucher) fetches Shivam's public key, checks Shivam's wallet really signed it (so a hacked server can't swap in its own key), and **locks the code in his own browser** so only Shivam's key can open it. The server receives and stores only the locked box.
3. The server hands the locked box to Shivam, whose browser unlocks it. The server only ever relays and stores ciphertext.
4. Shivam's **vault** is the list of all his locked boxes. He can also keep private notes ("used on shoes", "redeemed") that are encrypted with a second key only he has. The server stores those as opaque blobs.
5. **Disputes:** if `ADMIN_VAULT_PUBLIC_KEY` is set, Saad also locks the code to that key. Its private half is kept offline and used only to judge a dispute. Without it, the server (and admins) cannot see a code at all.

Crypto: X25519 key agreement + HKDF-SHA256 + AES-256-GCM (audited `@noble` libraries). Each box is padded so the code length is hidden, and is bound to the request, requester and fulfiller, so it cannot be copied onto another trade.

## Where things are

| Piece | Path |
|---|---|
| Crypto library (browser + Node, same file) | `backend/vault-sdk/index.js` |
| Server logic / routes | `backend/src/services/vault.js`, `backend/src/routes/vault.js` |
| Changed existing code | `submitCode` / `getVoucher` in `services/requests.js`; submit-code schema in `routes/requests.js`; config + `app.js` mount |
| Tests | `npm run vault:test` (library), `npm run vault:e2e` (whole backend, both modes, 23 checks each; uses the in-memory Firestore stand-in in `backend/test-support`, World ID in mock mode, no network or Firebase needed) |

## API

| Call | Who | What |
|---|---|---|
| `GET /vault/config` | anyone | `{mode, keyMessage, adminPublicKey}` |
| `PUT /vault/key` `{publicKey, signature}` | requester | register vault public key. The wallet must sign `keyBindingMessage(address, publicKey)`. It can never be replaced (stops a stolen login from planting a key). |
| `GET /vault/key/:address` | signed in | someone's public key + the binding signature (**verify it in the client**) |
| `POST /requests/:id/submit-code` `{sealed}` | fulfiller | the locked box. Legacy `{code, pin}` still works unless `VOUCHER_MODE=sealed`. |
| `GET /requests/:id/voucher` | requester | returns `{sealed, requester, fulfiller}` for sealed vouchers |
| `GET /vault` | requester | all my sealed vouchers + my encrypted notes |
| `PUT /vault/:requestId/state` `{blob}` | requester | save my encrypted note / redeemed flag |

`VOUCHER_MODE`: `both` (default, migration), `sealed` (recommended once the frontend is updated), `legacy`.

## What the frontend has to do

```js
import * as V from '<backend>/vault-sdk/index.js';

// Requester, once (after sign-in):
const cfg = await (await fetch('/vault/config')).json();
const sig1 = await wallet.signMessage({ message: cfg.keyMessage });
V.assertDeterministicSignature(sig1, await wallet.signMessage({ message: cfg.keyMessage })); // some wallets can't be used
const keys = V.deriveVaultKeys(sig1);               // keep in memory only; never store or send
const bind = await wallet.signMessage({ message: V.keyBindingMessage(address, keys.publicKeyHex) });
await api('PUT', '/vault/key', { publicKey: keys.publicKeyHex, signature: bind });

// Fulfiller, when submitting the voucher:
const k = (await api('GET', `/vault/key/${requester}`)).key;
// verify recoverMessageAddress({message: V.keyBindingMessage(k.address, k.publicKey), signature: k.signature}) === requester
const recipients = [k.publicKey, ...(cfg.adminPublicKey ? [cfg.adminPublicKey] : [])];
const sealed = V.seal({ code, pin }, recipients, V.voucherAad(requestId, requester, fulfiller));
await api('POST', `/requests/${requestId}/submit-code`, { sealed });

// Requester, to read it:
const { voucher } = await api('GET', `/requests/${requestId}/voucher`);
const { code, pin } = V.open(voucher.sealed, keys.privateKey, V.voucherAad(requestId, voucher.requester, voucher.fulfiller));
// notes: V.encryptState({redeemed:true}, keys.stateKey, V.stateAad(requestId, address)) -> PUT /vault/:id/state
```

## Honest limits

- **Protects against server/database compromise, not a malicious frontend.** If the website a user loads is replaced with a malicious one, it can steal the code in the browser. Serve the frontend from a trusted place.
- **The signed message is the key.** Anyone who can get a user to sign `KEY_MESSAGE` can derive their vault key. The message says to only sign it on NetPositive sites, but wallets don't bind signatures to a website.
- **Wallet support:** some wallets (smart-contract / passkey wallets) sign differently each time. `assertDeterministicSignature` catches this; those users need a recovery passphrase option, which is **not built yet**.
- **Losing the wallet loses the vault** (that is the point), unless a recovery option is added.
- **Disputes:** without `ADMIN_VAULT_PUBLIC_KEY` nobody but the requester can ever read a code. With it, whoever holds that private key can read every sealed voucher: keep it offline and split it if possible.
- The server cannot check that a sealed box actually contains a valid code, or that it was sealed for the right request (the requester's client rejects a mismatched one). Pair it with the extension check by the seller.
- Old (legacy) vouchers stay readable with `VOUCHER_ENC_KEY`; there is no migration yet.
- **No server-side duplicate-voucher detection** (it would need to see or fingerprint the code).
- The in-memory Firestore stand-in was used for tests; the vault collection has no composite-index requirements beyond the existing `requests` ones.
