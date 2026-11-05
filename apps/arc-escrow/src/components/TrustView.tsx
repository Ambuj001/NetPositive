import { Info } from 'lucide-react'

const CROPS: { title: string; blurb: string; assume: string[] }[] = [
  {
    title: 'Censorship resistance',
    blurb: 'No admin, owner, proxy or pause. Timeouts let anyone refund, release or finalize.',
    assume: [
      'The USDC issuer can blocklist or freeze addresses and the escrow itself. This contract cannot prevent that.',
      'A single validator must be online to attest deliveries. If it is not, orders time out and refund.',
      'The arbitrator may be offline. The disclosed 50/50 principal fallback then applies.',
      'Arc Testnet validators and RPC providers are assumed not to censor transactions.',
    ],
  },
  {
    title: 'Open source',
    blurb: 'Contract, tests, backend and frontend are readable and runnable.',
    assume: [
      'You can rebuild the bytecode with Foundry and compare it to the deployed code.',
      'Deployed constructor arguments (validator, arbitrator, revenue recipient, periods) are public and immutable.',
    ],
  },
  {
    title: 'Privacy',
    blurb: 'Voucher plaintext, PAN, CVV, PIN and OTP never reach the backend or the chain.',
    assume: [
      'Wallet addresses, amounts, timing and the ciphertext digest are public onchain metadata.',
      'The backend sees ciphertext size, timing and IP addresses, and could withhold ciphertext.',
      'A compromised browser, extension or device reads plaintext. Encryption cannot defend a hostile endpoint.',
      'A weak vault passphrase can be guessed offline against a stolen vault or recovery file.',
      'Ownership proofs reveal nothing about the secret but also prove nothing about a voucher.',
    ],
  },
  {
    title: 'Security',
    blurb: 'Funds move only by contract rules; settlement uses pull payments.',
    assume: [
      'This code is unaudited demo software for Arc Testnet. Use synthetic data and test funds only.',
      'The validator attests delivery of an opaque ciphertext, not that a voucher is valid or unspent.',
      'The issuer can freeze or redeem a voucher at any time; the review window and arbitrator are the only recourse.',
      'A colluding validator and fulfiller could attest garbage ciphertext; the buyer review and dispute path covers it.',
      'The arbitrator can only choose buyer or fulfiller on a disputed order, and is paid a capped amount from the dispute reserve.',
    ],
  },
]

const DISCLOSURES = [
  'Fee: 1% of principal, paid by the buyer, earned only when an order is released. Earned fee splits 30% to the dispute reserve and 70% to revenue.',
  'Release needs a valid validator attestation plus buyer acceptance, or an uncontested review period.',
  'Undelivered orders can be refunded by anyone after the delivery deadline, with principal and fee returned to the buyer.',
  'Disputes have fixed deadlines. If the arbitrator does not rule in time, anyone may finalize a 50/50 split of principal (an odd unit goes to the buyer) and the fee returns to the buyer.',
  'The dispute reserve pays the arbitrator a capped amount per ruled case. It is not an insurance fund.',
  'There is a 10,000 USDC per-order cap as a guard for unaudited code.',
]

const NOT_CLAIMED = [
  'Unbreakable security. No system is.',
  'Resistance to issuer freezes, blocklists or voucher cancellation by the merchant.',
  'A production audit. Automated and AI-assisted reviews were run; they are not a substitute for a professional audit.',
  'That a voucher is real, funded or unredeemed. Neither the attestation nor the ownership proof says so.',
]

export function TrustView() {
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="display text-xl font-semibold">Disclosed behavior</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">{DISCLOSURES.map((d) => <li key={d}>{d}</li>)}</ul>
      </section>
      <section className="card space-y-3" style={{ borderColor: 'rgba(186,43,76,0.25)' }}>
        <h2 className="display text-xl font-semibold flex items-center gap-2"><Info size={18} /> What NetPositive does not claim</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">{NOT_CLAIMED.map((d) => <li key={d}>{d}</li>)}</ul>
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        {CROPS.map((c) => (
          <section key={c.title} className="card space-y-2">
            <h3 className="display text-lg font-semibold">{c.title}</h3>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{c.blurb}</p>
            <div className="label">Assumptions</div>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">{c.assume.map((a) => <li key={a}>{a}</li>)}</ul>
          </section>
        ))}
      </div>
    </div>
  )
}
