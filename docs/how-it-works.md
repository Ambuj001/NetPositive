# How NetPositive works

This describes the system as built on the `escrow-v2` branch: the contract `contracts/src/VoucherEscrowV2.sol`, deployed on Arc mainnet at `0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2`.

## The two people

- **Spender** (depositor): holds USDC, wants a gift voucher for a merchant.
- **Buyer** (fulfiller): has a card that earns well on that voucher, buys it, delivers the code and is paid in USDC.

Both sign in with their wallet and prove they are one person with World ID.

## A trade, step by step

| Step | Who | What happens | Where |
|---|---|---|---|
| 1. Create | Spender | Chooses the merchant, the rupee value and the USDC the buyer will receive. The server checks the pair against the live USD/INR rate and returns the fee and total, read from the contract. | Server |
| 2. Lock | Spender | Approves and deposits `amount + fee`. The order is now public. | Wallet transaction |
| 3. Accept | Buyer | Takes the order. | Server |
| 4. Ready | Spender | Signs a message naming this buyer. No gas. | Wallet signature |
| 5. Bind | Buyer | Sends that signature to the contract. From now on the escrow can only pay this buyer or refund the spender. **The buyer should not buy the voucher before this confirms.** | Wallet transaction |
| 6. Deliver | Buyer | Buys the voucher, marks it delivered on-chain, then submits the code, sealed so only the spender can open it. The spender's review window starts. | Wallet transaction, then server |
| 7. Release | Spender | Checks the voucher and releases the USDC to the buyer. | Wallet transaction |

The server never moves the money. After each wallet step it reads the contract and records what happened; if a step has not been sent it answers `409 wallet_action_required`.

## What the contract guarantees

- **Funds have two possible destinations:** the buyer the spender named, or the spender. No owner, arbiter or server key can send them anywhere else.
- **Terms are fixed at deposit.** The fee, the time windows and the dispute stake are copied into each escrow when it is funded. Later changes by the owner apply to new orders only.
- **Nothing can be stuck.** Every state has a way out that does not depend on the team (see timeouts).
- **Pausing stops new deposits only.** Every way out of an existing escrow keeps working while paused.
- **The code cannot be changed.** A new version would be a new contract at a new address; existing trades finish where they started.

## Fees

The fee is charged **on top** of the amount: for 100 USDC at 1%, the spender locks 101 and the buyer receives 100. The fee is kept only when the buyer is paid:

| Ending | Buyer receives | Spender gets back | Fee kept |
|---|---|---|---|
| Released or claimed | amount | nothing | all of it |
| Cancelled, expired, refunded | nothing | amount + fee | none |
| Arbiter splits a dispute | part of the amount | the rest, and the same share of the fee | in proportion |

Collected fees stay in the contract until `withdrawFees` sends them to the treasury and the dispute reserve.

## Timeouts

| Situation | What happens | Who can trigger it |
|---|---|---|
| Nobody takes the order before it expires | Full refund to the spender | Anyone |
| The spender changes their mind before a buyer is bound | Cancel, full refund | Spender |
| The bound buyer does not deliver in the fulfil window | Full refund to the spender | Anyone |
| The bound buyer steps away | Order is open again | Buyer |
| The spender neither releases nor disputes in the review window | The buyer is paid | Anyone |
| A dispute is never decided (30 days) | Full refund to the spender | Anyone |

"Anyone" in practice is the server's keeper wallet, which exists to pay the gas for these calls. If the server disappeared, either party could send them.

## Disputes

Only the spender can open a dispute, and only after the buyer marked the voucher delivered. Opening one:

1. locks a **dispute stake** from the spender (1 USDC at launch), and
2. freezes the escrow until it is decided.

Both sides can add a written response and screenshots. The arbiter then decides how much of the amount goes to the buyer:

- **Spender was right:** full refund, fee and stake returned.
- **Spender was wrong:** the buyer receives the amount **and the spender's stake**.
- **Split:** each side gets its share; the stake follows the same proportion.

The spender can also end a dispute by releasing, and the buyer by conceding; in both cases the stake is returned.

Server side, a ruling against the person who raised the dispute also bans their account. See [disputes.md](disputes.md).

## Voucher codes

Codes are sealed in the buyer's browser to the spender's vault key, so the server stores only ciphertext. See [vault.md](vault.md).

## Roles in the contract

| Role | Can do | Cannot do |
|---|---|---|
| Owner | Change the fee (up to 5%), time windows, order limits, dispute stake, arbiter, guardian and fee recipients, for **future** orders. Pause and unpause deposits. Recover tokens sent to the contract by mistake. | Touch any escrow. Change the code. |
| Arbiter | Split an escrow the spender has put in dispute. | Act on any escrow that is not disputed. |
| Guardian | Pause new deposits. | Unpause, or anything else. |
| Keeper (server) | Send the timeout calls anyone may send. | Nothing else; it has no role in the contract. |

## Known limits of the design

- **A buyer can mark an order delivered without delivering.** The spender must then dispute inside the review window (24 hours at launch) or the buyer is paid. A buyer-side bond would remove this; it is not built.
- **The arbiter is trusted to judge fairly** on disputed escrows. It cannot touch the rest.
- **Voucher validity is checked by the spender, not by the system.** There is no automated proof that a code works.
- **The contract is not audited.** The launch limits (250 USDC per order, 5,000 USDC in total) cap the exposure until it is.
