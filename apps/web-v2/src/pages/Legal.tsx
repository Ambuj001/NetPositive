import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { A, Callout, P, Table, Ul } from "../components/Prose";
import { Aurora, PageHead, cx } from "../components/ui";
import { CONTRACT_CONSTANTS, LIVE_DEPLOYMENT as LIVE, displayTerms } from "../lib/displayTerms";
import { usePageTitle } from "../lib/usePageTitle";
import { useTerms } from "../lib/useTerms";

/**
 * Terms and Privacy, as plain-language summaries of what the product does today. They were written from the code
 * and the docs in the repository, not drafted by a lawyer, and each page says so at the top.
 * Privacy facts were checked against backend/src (routes, services, middleware/security.js) on 15 Nov 2026.
 */

const wrap = "mx-auto w-full max-w-[1200px] px-5 md:px-8";
const UPDATED = "15 November 2026";

function Page({ eyebrow, title, sub, children }: { eyebrow: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="relative pt-12 pb-10 md:pt-16">
      <Aurora />
      <div className={cx(wrap, "relative")}>
        <PageHead eyebrow={eyebrow} title={title} sub={sub} />
        <div className="mt-10 max-w-[760px] space-y-10">
          <Callout tone="warn" title="This is a summary, not a legal document">
            It describes in plain language how NetPositive works today. It was not drafted or reviewed by a lawyer, it is not a contract, and it does not replace the laws that apply where you live. Last updated {UPDATED}.
          </Callout>
          {children}
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[22px] font-semibold tracking-[-0.025em]">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

const b = (text: string) => <strong className="font-medium text-fg">{text}</strong>;

/* ---------------------------------------------------------------- terms */

export function Terms() {
  usePageTitle("Terms summary", "A plain-language summary of how NetPositive handles funds, fees, disputes and risk. Not a legal document.");
  const { terms } = useTerms();
  const v = useMemo(() => displayTerms(terms), [terms]);
  const now = v.live ? "currently" : "at launch";
  return (
    <Page eyebrow="Terms" title="Terms, in plain language" sub="What you are agreeing to in practice when you use NetPositive: what it does with your funds, what it charges, and which risks are yours.">
      <Block title="What NetPositive is">
        <P>
          A website, a server that keeps an order book, and an escrow contract on {LIVE.network}. A spender locks USDC in the contract; a buyer buys a gift voucher with their own card and delivers the code; the contract pays the buyer. The full description is in the <A to="/docs">docs</A>.
        </P>
        <P>NetPositive is not a bank, an exchange, a broker or a voucher seller. It does not sell USDC or vouchers. The two people in an order trade with each other.</P>
      </Block>

      <Block title="Who holds your funds">
        <Ul
          items={[
            <>Your USDC is held by the escrow contract, not by the team and not by the server. You send every transaction from your own wallet.</>,
            <>USDC in an order can only go to the buyer the spender named, or back to the spender. No key held by the team can send it anywhere else.</>,
            <>The team cannot reverse a transaction, recover a lost wallet, or return USDC sent to a wrong address.</>,
          ]}
        />
      </Block>

      <Block title="What it costs">
        <P>
          The spender pays a fee of {v.fee} ({now}) on top of the amount. It is kept only when the buyer is paid, and returned in full on a cancel, expiry or refund. The buyer pays no fee. Everyone pays their own network gas, in USDC. The fee and time windows of an order are fixed when it is locked. Details: <A to="/docs#fees">Fees</A>.
        </P>
      </Block>

      <Block title="Rules you accept by trading">
        <Ul
          items={[
            <>{b("One person, one account.")} Posting and accepting orders requires a World ID check.</>,
            <>
              {b("Deadlines are enforced by the contract.")} A buyer who misses the delivery window ({v.fulfil} {now}) is not paid. A spender who neither releases nor disputes within the review window ({v.review} {now}) pays the buyer. See <A to="/docs#time-limits">Time limits</A>.
            </>,
            <>
              {b("Disputes are decided by an arbiter")} who is a person on the team.{" "}
              {v.hasStake ? `Opening one locks a stake of ${v.stake} USDC (${now}), which goes to the buyer if the spender is judged wrong.` : "No stake is required to open one at the moment."} An account judged to have raised a false dispute is banned. An undecided dispute refunds the spender after {CONTRACT_CONSTANTS.disputeTimeoutDays} days. See <A to="/docs#disputes">Disputes</A>.
            </>,
            <>{b("Vouchers are between the two of you.")} The spender is responsible for checking the voucher in time. The buyer is responsible for buying the right brand and value, and for following the rules of their card issuer and of the store. Voucher and card reward terms belong to those companies, not to NetPositive.</>,
            <>{b("Be honest.")} Do not deliver codes that are used, invalid or not yours to give, and do not dispute a voucher that works.</>,
          ]}
        />
      </Block>

      <Block title="Risks that are yours">
        <Ul
          items={[
            <>{b("The contract has not been audited.")} A bug could cause a loss that nobody can undo. Launch limits ({v.min} to {v.max} USDC per order, {v.cap} USDC in total, {now}) exist to keep that exposure small.</>,
            <>{b("One owner wallet")} controls the contract's settings for future orders and can pause new deposits. It cannot touch an existing order.</>,
            <>{b("Nothing checks a voucher automatically.")} A buyer can mark an order delivered without delivering a working code; the spender's protection is to dispute in time.</>,
            <>{b("Card reward figures in the app are estimates.")} Many are assumed base rates, and issuers change their terms. Check with your issuer.</>,
            <>{b("Rates move.")} The live rates shown are reference prices from public markets, not an offer.</>,
            <>{b("Tax and local law are yours to handle.")} Whether and how you may trade crypto for vouchers depends on where you live. Nothing here is financial, tax or legal advice.</>,
          ]}
        />
        <P>
          The longer list is in <A to="/docs#safety">Safety and known limits</A>.
        </P>
      </Block>

      <Block title="Changes and availability">
        <P>
          The site and server are provided as they are and may be changed, paused or taken offline. If that happens, funds already in the contract can still be moved out by the two people in the order, as described in the <A to="/docs#faq">docs</A>. A new version of the contract would be a new address; orders finish on the contract they started on.
        </P>
        <P>When the way the product works changes, this summary and the docs are updated to match.</P>
      </Block>

      <p className="text-[14px] text-mute">
        See also the{" "}
        <Link to="/privacy" className="link font-medium text-fg">
          privacy summary
        </Link>
        .
      </p>
    </Page>
  );
}

/* -------------------------------------------------------------- privacy */

export function Privacy() {
  usePageTitle("Privacy summary", "What NetPositive stores about you, what is public on the blockchain, and what it never sees. Not a legal document.");
  return (
    <Page eyebrow="Privacy" title="Privacy, in plain language" sub="What the product stores, where, who else is involved, and what it never sees.">
      <Block title="The short version">
        <Ul
          items={[
            <>There is no email, name, phone number or password. Your account is your wallet address.</>,
            <>The site has no advertising or analytics trackers.</>,
            <>The server never sees your wallet's keys, your card number, or a readable voucher code.</>,
            <>Anything you do on the blockchain is public and permanent. That is how blockchains work, and nobody can delete it.</>,
          ]}
        />
      </Block>

      <Block title="What the server stores">
        <Table
          minWidth={560}
          head={["What", "Why", "Who can read it"]}
          rows={[
            ["Your wallet address, and whether the account is verified or banned", "It is your account", "The server; your address appears on your orders"],
            ["A World ID identifier (a one-way code that is unique to you for this app)", "To allow one account per person and make bans stick", "The server. It does not reveal who you are"],
            ["Your orders: store, rupee value, USDC amount, both wallet addresses, status, transaction hashes, deadlines", "To run the order book and show each order's history", "Anyone with the order's link"],
            ["Voucher codes, as sealed boxes only", "To hand the code from the buyer to the spender", "Only the spender's browser can open them (see below)"],
            ["Your voucher public key, and your own encrypted notes on vouchers", "So buyers can seal codes to you; so your notes follow your wallet", "The public key: signed-in users. The notes: only you"],
            ["Dispute text: the reason and each side's response", "So the arbiter can decide", "The reason is part of the order record, readable by anyone with the link"],
            ["Dispute screenshots", "Evidence for the arbiter", "The two people in the order and the arbiter"],
            ["Saved cards: issuer, card type and reward rates. Never card numbers", "To rank orders by what they are worth to you", "You"],
            ["A standing wish to buy, if you set one (amount and store)", "To match you with new orders", "Anyone: open requests are listed publicly with your wallet address"],
            ["Request logs: time, address of the page requested, result, your IP address and wallet address", "To trace problems and limit abuse. No message contents, tokens or voucher data are logged", "Whoever operates the server and its hosting"],
          ]}
        />
        <P>The database is Google Firestore, so this data sits on Google's servers. Screenshots may show a voucher code; upload them knowing the arbiter will see them.</P>
        <P>There is no fixed deletion schedule and no self-service way to delete an account yet. Records of orders are kept so that disputes and bans can be checked later.</P>
      </Block>

      <Block title="Voucher codes">
        <P>
          Codes are encrypted in the buyer's browser so that only the spender's key can open them. The server stores the locked box and cannot read it. For disputes, the site can be set up so codes are also sealed to a separate key held by the team; whoever holds that key could read sealed codes. More in <A to="/docs#vouchers">Voucher codes are sealed</A>.
        </P>
      </Block>

      <Block title="What is public on the blockchain">
        <P>
          Deposits, releases, refunds and disputes are transactions on {LIVE.network}. Each shows the wallet addresses involved, the amount and the time, to anyone, forever. A person who knows your wallet address can see your NetPositive activity and anything else that wallet has done. Voucher codes are never put on-chain.
        </P>
      </Block>

      <Block title="What stays in your browser">
        <Ul
          items={[
            <>Your sign-in token, until you close the tab or it expires.</>,
            <>Which wallet you last connected, so the site can reconnect.</>,
            <>Your saved cards and the card route you picked for an order.</>,
            <>That you dismissed the announcement strip.</>,
          ]}
        />
        <P>These are kept in your browser's storage, not in cookies, and are not used to track you across sites. Clearing site data removes them.</P>
      </Block>

      <Block title="Other services involved">
        <Ul
          items={[
            <>{b("Your wallet,")} and WalletConnect if you connect a phone wallet through it. They see your address and the requests the site makes to your wallet.</>,
            <>{b("World ID")} (the World App) carries out the one-person check. NetPositive receives a proof and the one-way identifier, not your identity.</>,
            <>{b("Arc network nodes.")} Your browser and wallet talk to public Arc nodes to read the contract and send transactions. Like any web server, a node can see your IP address.</>,
            <>{b("The assistant,")} where it is switched on. What you type to it is sent to our assistant server and from there to an AI model provider to produce the answer. Do not type voucher codes or secrets into it.</>,
            <>{b("Stores and card issuers.")} Buying a voucher happens on their sites under their own privacy terms.</>,
          ]}
        />
      </Block>

      <Block title="What is never collected">
        <P>Private keys or seed phrases, card numbers, bank details, government ID, and readable voucher codes. If a page claiming to be NetPositive asks for any of these, it is not NetPositive.</P>
      </Block>

      <p className="text-[14px] text-mute">
        See also the{" "}
        <Link to="/terms" className="link font-medium text-fg">
          terms summary
        </Link>
        .
      </p>
    </Page>
  );
}
