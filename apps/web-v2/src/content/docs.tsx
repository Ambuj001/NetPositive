/**
 * The text of the /docs page. One entry per section; edit the words here.
 *
 * Source of truth for every fact: docs/how-it-works.md, docs/operations.md, docs/disputes.md, docs/vault.md and
 * contracts/deployments/arc-mainnet.json in the repository. Numbers that the contract owner can change (fee, limits,
 * stake, time windows) are never typed in here: they come in through `v` (see lib/displayTerms.ts), which holds the
 * live values from GET /escrow/terms, or the launch values while those are loading.
 */
import type { ReactNode } from "react";
import { A, Callout, CopyValue, Facts, H3, P, Steps, Table, Ul } from "../components/Prose";
import { CONTRACT_CONSTANTS, LIVE_DEPLOYMENT as LIVE, type DisplayTerms } from "../lib/displayTerms";

/**
 * What the page knows besides the escrow's numbers. `worldIdOn` is true only while the server confirms World ID is
 * required (GET /world-id/config); an administrator can switch it off, and the text must then not claim humans-only.
 */
export type DocContext = { worldIdOn: boolean };

export type DocSection = { id: string; group: string; title: string; summary: string; body: (v: DisplayTerms, ctx: DocContext) => ReactNode };

/** Roles read back from the contract on the day it was deployed (contracts/deployments/arc-mainnet.json). */
const ROLES_AT_LAUNCH = {
  owner: "0xb4A9260A1201642a3C952048BA7991ABE5cAbd7D",
  arbiter: "0x7072c0141E26b3a0516A78F943C10BdFe188EB4E",
  guardian: "0xfa818A745732a4806460E88628edaaAFa68eE84A",
};

const addressUrl = (a: string) => `${LIVE.explorer}/address/${a}`;
const CONTRACT_URL = addressUrl(LIVE.contract);
const days = `${CONTRACT_CONSTANTS.disputeTimeoutDays} days`;

export const DOC_SECTIONS: DocSection[] = [
  /* ------------------------------------------------------------ overview */
  {
    id: "overview",
    group: "Start here",
    title: "What NetPositive is",
    summary: "Two people, one escrow contract.",
    body: () => (
      <>
        <P>
          NetPositive lets one person spend USDC at a shop that only takes rupees, and lets another person get USDC by paying with a card. They meet through a gift voucher, and an escrow contract on Arc holds the USDC while the voucher changes hands.
        </P>
        <Table
          minWidth={480}
          head={["Who", "Has", "Wants", "Does"]}
          rows={[
            ["Spender", "USDC", "A gift voucher for a store", "Locks USDC in the escrow, checks the voucher, releases the USDC."],
            ["Buyer", "A card that earns rewards", "USDC in their own wallet", "Buys the voucher on their card, delivers the code, is paid in USDC."],
          ]}
        />
        <P>
          The buyer keeps the reward points from their card. The spender pays a fee on top of the amount (see <A to="/docs#fees">Fees</A>). The rate, in rupees per USDC, is set by the spender when they post the order.
        </P>
        <P>
          NetPositive is the website, a server that keeps the order book, and the escrow contract. The server never holds or moves the USDC: each person sends their own transactions from their own wallet.
        </P>
        <Callout tone="warn" title="Before you use it">
          This is real money on a new contract. The contract has not been audited, and for now its settings are controlled by a single owner wallet. Launch limits keep the amounts small. Read <A to="/docs#safety">Safety</A> before you lock anything.
        </Callout>
      </>
    ),
  },

  /* ----------------------------------------------------- getting started */
  {
    id: "getting-started",
    group: "Start here",
    title: "Getting started",
    summary: "Wallet, the Arc network, USDC and, when it is switched on, World ID.",
    body: (_v, { worldIdOn }) => (
      <>
        <H3>1. A wallet that can use Arc</H3>
        <P>
          You need an EVM wallet that lets you add a network. MetaMask, Rabby, Coinbase Wallet, OKX Wallet, Rainbow, Trust Wallet, Zerion and Brave Wallet work, and so does a phone wallet connected through WalletConnect. On a phone, open this site inside your wallet app's own browser.
        </P>
        <P>Phantom can sign in but cannot add Arc, so it cannot lock USDC or show a payout. Use another wallet to trade.</P>
        <P>
          The spender's wallet also has to produce the same signature every time it signs the same message, because that is how the voucher key is rebuilt (see <A to="/docs#vouchers">Voucher codes</A>). Ordinary wallets do. Some smart-contract and passkey wallets do not; the app tells you if yours cannot be used.
        </P>

        <H3>2. The Arc network</H3>
        <P>The escrow runs on Arc. The app asks your wallet to add Arc and switch to it the first time it is needed; you only approve the prompt. If you prefer to add it by hand:</P>
        <Facts
          rows={[
            ["Network name", "Arc"],
            ["Chain ID", String(LIVE.chainId)],
            ["RPC URL", <CopyValue value={LIVE.rpc} />],
            ["Currency", "USDC"],
            ["Explorer", <A to={LIVE.explorer}>{LIVE.explorer.replace("https://", "")}</A>],
          ]}
        />

        <H3>3. USDC on Arc</H3>
        <P>
          On Arc, gas is paid in USDC. There is no separate gas coin to buy, and most wallets show USDC as the main balance. Both people need some:
        </P>
        <Ul
          items={[
            <>
              <strong className="font-medium text-fg">Spender:</strong> the order amount, the fee, and a little extra for gas.
            </>,
            <>
              <strong className="font-medium text-fg">Buyer:</strong> a small amount for gas. The buyer sends two transactions per order.
            </>,
          ]}
        />
        <P>
          NetPositive does not sell or bridge USDC. Send it to your wallet address on the Arc network from an exchange or bridge that supports Arc. USDC on another network is not usable here until it is moved to Arc. Send a small test amount first.
        </P>

        {worldIdOn ? (
          <>
            <H3>4. World ID, once</H3>
            <P>
              Posting or accepting an order needs a World ID check, done in the World App. It proves you are one real person without telling NetPositive who you are, and it ties one person to one account. You can browse without it. It is asked for once, the first time you post or accept.
            </P>
            <P>The check is bound to the first wallet you use it with. A banned person cannot come back on a new wallet.</P>
          </>
        ) : (
          <>
            <H3>4. World ID, when it is switched on</H3>
            <P>
              An administrator can require a World ID check, done in the World App, before you post or accept an order. It proves you are one real person without telling NetPositive who you are, and it ties one person to one account. When it is on, it is asked for once, the first time you post or accept, and it is bound to the first wallet you use it with, so a banned person cannot come back on a new wallet.
            </P>
            <P>While it is switched off, any signed-in wallet can post and accept orders, and one person can use several wallets.</P>
          </>
        )}
      </>
    ),
  },

  /* ------------------------------------------------------------ spending */
  {
    id: "spending",
    group: "Using it",
    title: "Spending USDC",
    summary: "The spender's steps, and what each one costs.",
    body: (v) => (
      <>
        <P>You hold USDC and want a gift voucher. Each step below says whether your wallet sends a transaction, signs for free, or you only click.</P>
        <Steps
          steps={[
            { title: "Connect and sign in", kind: "sign", body: "Connect your wallet and sign the sign-in message. It costs nothing and moves nothing." },
            {
              title: "Create the order",
              kind: "click",
              body: (
                <>
                  Choose the store, the voucher value in rupees, and the rate. The server checks your rate against the live USD/INR rate and rejects one that is far off. It then shows the fee and the total, both read from the contract. Orders are from {v.min} to {v.max} USDC to the buyer.
                </>
              ),
            },
            {
              title: "Lock the USDC",
              kind: "tx",
              body: "Your wallet sends two transactions: one that approves the total, and one that deposits the amount plus the fee into the escrow. When the deposit confirms, the order is public.",
            },
            { title: "Wait for a buyer", kind: "wait", body: "Until a buyer is bound on-chain you can cancel from your wallet (a transaction) and get everything back, fee included." },
            {
              title: "Press Ready",
              kind: "sign",
              body: "When a buyer accepts, you sign a message that names that buyer. It is free. The first time, the app also asks you to sign your voucher key so the buyer can seal the code to you. A Ready signature expires after a while; if the buyer was slow, press Ready again.",
            },
            { title: "Wait for the voucher", kind: "wait", body: `The buyer binds themselves to your order, buys the voucher and delivers the code. Once bound, they have ${v.fulfil} to deliver.` },
            { title: "Open and check the code", kind: "sign", body: "Sign once to unlock your voucher key, then check the voucher at the store: right brand, right value, not already used." },
            {
              title: "Release, or dispute",
              kind: "tx",
              body: (
                <>
                  If the voucher is good, release the USDC to the buyer. If it is not, open a dispute (see <A to="/docs#disputes">Disputes</A>). Both are sent from your wallet.
                </>
              ),
            },
          ]}
        />
        <Callout tone="danger" title={`You have ${v.review} to check the voucher`}>
          The clock starts when the buyer marks the order delivered. If you neither release nor dispute in that time, the buyer is paid. A buyer can mark an order delivered without sending a working code, so do not leave a delivered order unchecked.
        </Callout>
      </>
    ),
  },

  /* -------------------------------------------------------------- buying */
  {
    id: "buying",
    group: "Using it",
    title: "Earning USDC as a buyer",
    summary: "The buyer's steps, and the one thing not to do early.",
    body: (v) => (
      <>
        <P>You have a card and want USDC in your own wallet. You pay for a voucher in rupees and are paid in USDC by the escrow.</P>
        <Callout tone="danger" title="Do not buy the voucher before your bind transaction confirms">
          Accepting an order on the site does not reserve the USDC for you. Only the on-chain bind does (step 4). Until it confirms, the spender can still cancel and take the USDC back, and you would be left holding a voucher. The order page tells you when it is safe to buy.
        </Callout>
        <Steps
          steps={[
            { title: "Connect and sign in", kind: "sign", body: "Connect your wallet and sign the sign-in message. Keep a little USDC on Arc for gas." },
            {
              title: "Pick an order and check it",
              kind: "click",
              body: "Open an order from the market. Its page reads the escrow straight from the contract through a public Arc node and compares it with what our server says. If the check does not pass, do not proceed.",
            },
            { title: "Accept", kind: "click", body: "Tells the spender you want this order. No wallet prompt. Nothing is bound yet." },
            {
              title: "Bind yourself to the order",
              kind: "tx",
              body: "When the spender has pressed Ready, send their signature to the contract from your wallet. Once this confirms, the escrow can only pay you or refund the spender.",
            },
            {
              title: "Buy the voucher",
              kind: "outside",
              body: `Pay with your card on the store or your bank's voucher portal, for exactly the brand and value in the order. You have ${v.fulfil} from the bind to deliver.`,
            },
            { title: "Mark delivered", kind: "tx", body: "Tell the contract the voucher is delivered. This starts the spender's review window." },
            { title: "Submit the code", kind: "click", body: "Paste the code and PIN. Your browser seals them so only the spender can open them, then sends the sealed box to the server." },
            {
              title: "Get paid",
              kind: "wait",
              body: `The USDC goes to your wallet when the spender releases it. If they do nothing for ${v.review} and do not dispute, you are paid anyway.`,
            },
          ]}
        />
        <P>
          If you miss the delivery deadline, the spender is refunded and you are not paid, even if you bought the voucher. The contract lets a bound buyer step away so the order reopens for someone else, but the site has no button for that yet; if you cannot complete an order, the deadline ends it.
        </P>
        <P>Buying costs you no fee. You pay only gas for the two transactions.</P>
      </>
    ),
  },

  /* ---------------------------------------------------------------- fees */
  {
    id: "fees",
    group: "The rules",
    title: "Fees",
    summary: "Charged on top, kept only when the buyer is paid.",
    body: (v) => (
      <>
        <P>
          The fee is {v.fee} and is charged on top of the amount, to the spender. For 100 USDC to the buyer, the spender locks {v.exampleTotal} USDC: 100 for the buyer and {v.exampleFee} as the fee. The buyer receives the full 100.
        </P>
        <P>The fee is kept only when the buyer is paid. If the order ends in a refund, the fee comes back with it.</P>
        <Table
          head={["How the order ends", "Buyer receives", "Spender gets back", "Fee kept"]}
          rows={[
            ["Released, or paid after the review window", "The amount", "Nothing", "All of it"],
            ["Cancelled, expired or refunded", "Nothing", "The amount and the fee", "None"],
            ["A dispute is split", "Part of the amount", "The rest, and the same share of the fee", "In proportion"],
          ]}
        />
        <P>
          The fee for an order is fixed when the USDC is locked. The contract owner can change the fee for future orders, up to a hard limit of {CONTRACT_CONSTANTS.maxFeePercent} written into the contract, but cannot change it for an order that is already funded.
        </P>
        <P>Each transaction also costs a small amount of gas, paid in USDC to the Arc network, not to NetPositive.</P>
      </>
    ),
  },

  /* --------------------------------------------------------- time limits */
  {
    id: "time-limits",
    group: "The rules",
    title: "Time limits",
    summary: "What happens when someone goes silent.",
    body: (v) => (
      <>
        <P>Every stage of an order has a way out that does not depend on the other person, or on us.</P>
        <Table
          minWidth={600}
          head={["Situation", "What happens", "Who can trigger it"]}
          rows={[
            [<>Nobody takes the order before it expires{v.orderOpen ? ` (${v.orderOpen} after it is locked)` : ""}</>, "Full refund to the spender", "Anyone"],
            ["The spender changes their mind before a buyer is bound", "Cancel, full refund", "Spender"],
            [`The bound buyer does not deliver within ${v.fulfil}`, "Full refund to the spender", "Anyone"],
            ["The bound buyer steps away (a contract call; the site has no button for it yet)", "The order is open again", "Buyer"],
            [`The spender neither releases nor disputes within ${v.review} of delivery`, "The buyer is paid", "Anyone"],
            [`A dispute is not decided within ${days}`, "Full refund to the spender", "Anyone"],
          ]}
        />
        <P>
          "Anyone" in practice is our server, which pays the gas for these calls. If the server were gone, either person could send the same call themselves (see the <A to="/docs#faq">FAQ</A>).
        </P>
        <P>The time windows are copied into each order when it is locked. A later change by the owner applies only to new orders. Your order's own deadlines are shown on its page.</P>
      </>
    ),
  },

  /* ------------------------------------------------------------ disputes */
  {
    id: "disputes",
    group: "The rules",
    title: "Disputes",
    summary: "Who can open one, the stake, and how it ends.",
    body: (v, { worldIdOn }) => (
      <>
        <P>
          Only the spender can open a dispute, and only after the buyer has marked the order delivered and before the review window ({v.review}) ends. It is a transaction from the spender's wallet.
        </P>
        <P>Opening a dispute does two things:</P>
        <Ul
          items={[
            v.hasStake ? (
              <>
                It locks a <strong className="font-medium text-fg">stake of {v.stake} USDC</strong> from the spender, in the same contract.
              </>
            ) : (
              <>Right now no stake is required to open one.</>
            ),
            <>It freezes the order. Nobody is paid until it is decided.</>,
          ]}
        />
        <P>Both people can add a written response and screenshots. A person acting as arbiter then decides how much of the amount goes to the buyer. There are three outcomes:</P>
        <Table
          head={["Decision", "The amount", "The fee", "The stake"]}
          rows={[
            ["The spender was right", "Refunded to the spender", "Refunded", "Returned to the spender"],
            ["The spender was wrong", "Paid to the buyer", "Kept", "Paid to the buyer"],
            ["Split", "Shared between them", "Kept in proportion", "Follows the same proportion"],
          ]}
        />
        <P>A dispute can also end without a ruling: the spender can release after all, or the buyer can concede with a call to the contract. In both cases the stake goes back to the spender.</P>
        <Callout tone="warn" title="A false dispute gets the account banned">
          If the arbiter rules that the spender was wrong, the spender loses the stake and their NetPositive account is banned.{" "}
          {worldIdOn
            ? "Because accounts are tied to World ID, a new wallet does not get around it."
            : "While World ID is switched on, accounts are tied to one person, so a new wallet does not get around it. While it is off, the ban applies to the wallet."}
        </Callout>
        <P>
          If the arbiter never decides, anyone can refund the spender after {days}. That fallback is in the contract and does not need us.
        </P>
        <P>
          The arbiter is a person on the team. You are trusting them to judge fairly. They can only split an order that the spender has put in dispute; they cannot touch any other order. Screenshots you upload can be seen by the two people in the order and by the arbiter. The written reason is part of the order's record, which anyone with the order's link can read, so do not put a voucher code in it.
        </P>
      </>
    ),
  },

  /* -------------------------------------------------------------- safety */
  {
    id: "safety",
    group: "Safety",
    title: "Safety and known limits",
    summary: "What the contract guarantees, what the team can do, and what is not solved.",
    body: (v) => (
      <>
        <H3>What the contract guarantees</H3>
        <Ul
          items={[
            <>
              <strong className="font-medium text-fg">Two destinations only.</strong> USDC in an order can go to the buyer the spender named, or back to the spender. No owner, arbiter or server key can send it anywhere else.
            </>,
            <>
              <strong className="font-medium text-fg">Terms are fixed when you lock.</strong> The fee, the time windows and the dispute stake are copied into the order. Later changes apply to new orders only.
            </>,
            <>
              <strong className="font-medium text-fg">Nothing can get stuck.</strong> Every stage has a way out that does not depend on the team.
            </>,
            <>
              <strong className="font-medium text-fg">Pausing stops new deposits only.</strong> Existing orders can still be completed, cancelled or refunded while paused.
            </>,
            <>
              <strong className="font-medium text-fg">The code cannot be changed.</strong> A new version would be a new contract at a new address. Orders finish on the contract they started on.
            </>,
          ]}
        />
        <P>These are properties of the contract's code as written and tested by the team. No outside auditor has confirmed them yet.</P>

        <H3>What the team can and cannot do</H3>
        <Table
          minWidth={620}
          head={["Role", "Can", "Cannot"]}
          rows={[
            [
              "Owner",
              `Change the fee (up to ${CONTRACT_CONSTANTS.maxFeePercent}), time windows, order limits, dispute stake, arbiter, guardian and fee recipients, for future orders. Pause and unpause new deposits. Recover tokens sent to the contract by mistake.`,
              "Touch any order. Change the code.",
            ],
            ["Arbiter", "Split an order the spender has put in dispute.", "Act on any order that is not disputed."],
            ["Guardian", "Pause new deposits.", "Unpause, or anything else."],
            ["Server (keeper)", "Send the timeout calls that anyone may send, and pay their gas.", "Anything else. It has no role in the contract."],
          ]}
        />
        <P>
          The owner is currently one wallet held by one person, not a multisig. At launch the arbiter and the address that receives the fees are one and the same wallet (a different one from the owner), so the person who judges disputes also collects fees. The team plans to move ownership to a multisig and separate these before raising the limits.
        </P>

        <H3>Administrators</H3>
        <P>An administrator is a wallet the NetPositive server lists as one. It has no role in the contract. In the app it has an admin page from which it can:</P>
        <Ul
          items={[
            <>Switch the World ID requirement on or off. On, every trader must prove they are one person with World ID. Off, any signed-in wallet can trade, and one person can use many wallets.</>,
            <>See how many orders are in each state, the open disputes, and the health of the server.</>,
            <>Decide disputes, through the server's admin API (the site has no button for it yet). The ruling is carried out by the arbiter, so it can only split an order the spender has put in dispute.</>,
          ]}
        />
        <P>
          It cannot move or redirect anyone's USDC: the contract only pays the buyer the spender named, or the spender. It cannot change the contract's fee, order limits, time windows or dispute stake, or pause deposits, from the app. Those are changed only from the owner wallet on the contract, as in the table above.
        </P>

        <H3>Launch limits</H3>
        <P>
          Because the contract is not audited, the amounts are capped: {v.min} to {v.max} USDC per order, and {v.cap} USDC locked across all orders at once.
          {v.locked !== null ? ` Right now ${v.locked} USDC is locked.` : ""} When the total is reached, new orders wait until open ones settle.
          {v.paused ? " New deposits are paused at the moment; existing orders are not affected." : ""}
        </P>

        <H3>Check your own escrow</H3>
        <P>You do not have to take the site's word for where the money is.</P>
        <Ul
          items={[
            <>Every order page has an on-chain check. It reads the order's record from the contract through a public Arc node, in your browser, and compares it with what our server says: the state, the bound buyer, the amount and the current deadline.</>,
            <>
              Each wallet step on the order page links to its transaction on the explorer. Open it and confirm it went to the escrow contract, <A to={CONTRACT_URL}>{LIVE.contract.slice(0, 10)}…{LIVE.contract.slice(-6)}</A>.
            </>,
            <>The order page shows the order's Escrow ID. Keep a copy while the order is open. It is what identifies your order inside the contract, and what you would need to act on it without this site.</>,
            <>On the explorer, the contract's page lists its USDC balance and its Deposited, Settled and Disputed events.</>,
          ]}
        />

        <H3>Known limits</H3>
        <Ul
          items={[
            <>
              <strong className="font-medium text-fg">The contract is not audited.</strong> It has tests, but no independent security review. Its source is not yet verified on the explorer. Only lock what you can afford to lose.
            </>,
            <>
              <strong className="font-medium text-fg">One owner wallet.</strong> If that wallet were lost or stolen, settings for new orders could be changed and the arbiter replaced. Existing orders that are not in dispute would still be safe.
            </>,
            <>
              <strong className="font-medium text-fg">A buyer can mark an order delivered without delivering.</strong> The spender must then dispute inside the review window ({v.review}), or the buyer is paid. There is no buyer deposit to discourage this yet.
            </>,
            <>
              <strong className="font-medium text-fg">The spender checks the voucher, not the system.</strong> Nothing proves automatically that a code works, has the right value, or has not been used.
            </>,
            <>
              <strong className="font-medium text-fg">The arbiter is trusted</strong> to judge disputed orders fairly.
            </>,
            <>
              <strong className="font-medium text-fg">The website itself is trusted.</strong> Sealing protects codes from our server and database, not from a fake copy of this site. Check the address bar.
            </>,
          ]}
        />
      </>
    ),
  },

  /* ------------------------------------------------------------ vouchers */
  {
    id: "vouchers",
    group: "Safety",
    title: "Voucher codes are sealed",
    summary: "Encrypted in the browser; the server stores a locked box.",
    body: () => (
      <>
        <P>A voucher code is as good as cash, so the server is built never to see one.</P>
        <Ul
          items={[
            <>The spender signs a fixed message with their wallet. Their browser turns that signature into a private key and a matching public key. Only the public key is sent to the server. The private key is not stored anywhere: the wallet rebuilds it whenever the same message is signed again.</>,
            <>The buyer's browser fetches the spender's public key, checks that the spender's wallet really signed it, and locks the code to it. The server receives and stores only the locked box.</>,
            <>The spender's browser unlocks the box. The box is tied to that one order and those two people, so it cannot be copied onto another order.</>,
          ]}
        />
        <P>The result: a leaked database or a leaked server key does not expose voucher codes.</P>
        <H3>What this does not protect against</H3>
        <Ul
          items={[
            <>A fake or tampered copy of this website could read a code in your browser. Only use the real site.</>,
            <>Anyone who gets you to sign the voucher-key message on another site can rebuild your key. Sign it only here.</>,
            <>If you lose access to the wallet, you lose access to codes sealed to it. There is no recovery option yet.</>,
            <>The server cannot check that a sealed box contains a working code. The spender has to check.</>,
            <>For disputes, the site can be set up so codes are also sealed to a separate key held by the team, which lets the arbiter read the code in question. Whoever holds that key could read sealed codes.</>,
          ]}
        />
      </>
    ),
  },

  /* ----------------------------------------------------------------- faq */
  {
    id: "faq",
    group: "Help",
    title: "Common problems",
    summary: "Wrong network, stuck transactions, and where your money is.",
    body: (v) => (
      <>
        <H3>My wallet says "wrong network"</H3>
        <P>
          Your wallet is on another chain. Use the "Switch to Arc" button in the banner or in the account panel. Each escrow step also switches by itself before it sends anything. If your wallet cannot add Arc (Phantom, for example), connect a different wallet.
        </P>

        <H3>My wallet shows "fee estimation unsuccessful"</H3>
        <P>
          Some wallets cannot work out fees on Arc by themselves. The app calculates the gas for each step and passes it to the wallet, which normally avoids this. If you still see it, check two things: that you are on Arc, and that you hold a little more USDC than the amount you are sending, because gas on Arc is paid in USDC. If both are fine, try MetaMask or Rabby.
        </P>
        <P>If the app itself says a transaction "would fail" and nothing was sent, read the reason it gives. The step may already be done, or a deadline may have passed. Reload the order page.</P>

        <H3>My transaction is pending</H3>
        <P>
          Do not send it again. Open the transaction from your wallet's activity list in the explorer and wait for it to confirm. The order page updates on its own once it does, because the server reads the contract after every wallet step. If the page still asks for the same step after the transaction has confirmed, reload it.
        </P>

        <H3>What if the NetPositive server is down?</H3>
        <P>
          Your USDC is in the contract, not on our server, and the contract keeps working. Either person can send the calls directly to the contract with their own wallet, using the order's Escrow ID:
        </P>
        <Table
          minWidth={560}
          head={["Who", "Call", "When"]}
          rows={[
            ["Spender", <code className="font-mono text-[13px]">cancel(id)</code>, "Before a buyer is bound"],
            ["Spender", <code className="font-mono text-[13px]">release(id)</code>, "After delivery, to pay the buyer"],
            ["Buyer", <code className="font-mono text-[13px]">claim(id)</code>, `After delivery, once the review window (${v.review}) has ended with no dispute`],
            ["Anyone", <code className="font-mono text-[13px]">refundExpired(id)</code>, "The order expired with no buyer, or the bound buyer missed the delivery deadline"],
            ["Anyone", <code className="font-mono text-[13px]">refundStaleDispute(id)</code>, `A dispute has been open for ${days}`],
          ]}
        />
        <P>
          Be honest with yourself about how practical this is today: the contract's source is not yet verified on the explorer, so the explorer may not offer a form for these calls, and you would need a tool that can call a contract by its function signature. Without the server the buyer also cannot deliver a sealed code through the site. The guarantee is that the money can always be moved out by the two people involved, not that it is convenient.
        </P>

        <H3>Where is my money?</H3>
        <Ul
          items={[
            <>
              <strong className="font-medium text-fg">Locked in an order:</strong> it is in the escrow contract. The order page shows the on-chain state and links every step to the explorer.
            </>,
            <>
              <strong className="font-medium text-fg">Released, refunded or cancelled:</strong> it was sent to your wallet address on Arc. Open your address on the <A to={LIVE.explorer}>explorer</A> from the account panel. If your wallet does not show it, make sure the wallet is on Arc; USDC on Arc is the network's main balance, and "Show USDC in wallet" in the account panel adds the token to the list.
            </>,
            <>
              <strong className="font-medium text-fg">In dispute:</strong> it stays in the contract until the arbiter decides, the dispute is withdrawn, or {days} pass.
            </>,
          ]}
        />

        <H3>I lost access to my wallet mid-order</H3>
        <P>
          Nobody else can act for you, including us. The timeouts still apply: an order nobody completes is refunded to the spender's address, and a delivered order nobody disputes is paid to the buyer's address.
        </P>
      </>
    ),
  },

  /* ------------------------------------------------------------ contract */
  {
    id: "contract",
    group: "Help",
    title: "Contract details",
    summary: "Network, addresses and current settings.",
    body: (v) => (
      <>
        <Facts
          rows={[
            ["Network", LIVE.network],
            ["Chain ID", String(LIVE.chainId)],
            ["Escrow contract", <CopyValue value={LIVE.contract} href={CONTRACT_URL} />],
            ["Contract name", "VoucherEscrowV2"],
            ["USDC token", <CopyValue value={LIVE.usdc} href={addressUrl(LIVE.usdc)} />],
            ["USDC decimals", "6"],
            ["Deployed", LIVE.deployedOn],
            ["Audit", "None yet"],
            ["Source on explorer", "Not yet verified"],
          ]}
        />
        <H3>Settings {v.live ? "right now" : "at launch"}</H3>
        <Facts
          rows={[
            ["Fee", `${v.fee}, on top of the amount`],
            ["Order size", `${v.min} to ${v.max} USDC`],
            ["Total locked at once", `${v.cap} USDC${v.locked !== null ? ` (${v.locked} locked now)` : ""}`],
            ["Dispute stake", v.hasStake ? `${v.stake} USDC` : "None"],
            ["Review window", v.review],
            ["Delivery window", v.fulfil],
            ...(v.orderOpen ? ([["Open order expires after", v.orderOpen]] as [ReactNode, ReactNode][]) : []),
            ["Undecided dispute refunds after", days],
            ...(v.live ? ([["New deposits", v.paused ? "Paused" : "Open"]] as [ReactNode, ReactNode][]) : []),
          ]}
        />
        <H3>Roles when it was deployed</H3>
        <P>These can be changed by the owner. The contract itself is the place to read the current ones.</P>
        <Facts
          rows={[
            ["Owner (single wallet)", <CopyValue value={ROLES_AT_LAUNCH.owner} href={addressUrl(ROLES_AT_LAUNCH.owner)} />],
            ["Arbiter, and fee recipient", <CopyValue value={ROLES_AT_LAUNCH.arbiter} href={addressUrl(ROLES_AT_LAUNCH.arbiter)} />],
            ["Guardian", <CopyValue value={ROLES_AT_LAUNCH.guardian} href={addressUrl(ROLES_AT_LAUNCH.guardian)} />],
          ]}
        />
      </>
    ),
  },
];

/** Friendly addresses that should land on a section: /docs/fees, /docs/timeouts, … */
export const DOC_ALIASES: Record<string, string> = {
  start: "getting-started",
  "get-started": "getting-started",
  wallets: "getting-started",
  spend: "spending",
  spender: "spending",
  buy: "buying",
  buyer: "buying",
  earning: "buying",
  fee: "fees",
  timeouts: "time-limits",
  limits: "time-limits",
  dispute: "disputes",
  security: "safety",
  trust: "safety",
  vault: "vouchers",
  help: "faq",
  troubleshooting: "faq",
  contracts: "contract",
  addresses: "contract",
};

export function resolveDocSection(slug: string | undefined): string | null {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s) return null;
  if (DOC_SECTIONS.some((d) => d.id === s)) return s;
  return DOC_ALIASES[s] ?? null;
}
