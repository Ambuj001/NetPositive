const INK = '#122d45'
const MUTED = '#6b6580'

function Box(props: { x: number; y: number; w: number; h: number; title: string; lines: string[]; tone?: 'browser' | 'server' | 'chain' | 'party' }) {
  const fill = props.tone === 'chain' ? '#122d45' : props.tone === 'server' ? '#eef3fb' : props.tone === 'party' ? '#fff7e8' : '#ffffff'
  const text = props.tone === 'chain' ? '#ffffff' : INK
  const sub = props.tone === 'chain' ? '#cbdbf2' : MUTED
  return (
    <g>
      <rect x={props.x} y={props.y} width={props.w} height={props.h} rx={18} fill={fill} stroke="rgba(18,45,69,0.25)" />
      <text x={props.x + 16} y={props.y + 28} fontFamily="Space Grotesk, sans-serif" fontWeight={600} fontSize={15} fill={text}>
        {props.title}
      </text>
      {props.lines.map((l, i) => (
        <text key={l} x={props.x + 16} y={props.y + 52 + i * 19} fontFamily="DM Sans, sans-serif" fontSize={12} fill={sub}>
          {l}
        </text>
      ))}
    </g>
  )
}

function Step({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill="#122d45" />
      <text x={x} y={y + 4} textAnchor="middle" fontFamily="DM Sans, sans-serif" fontWeight={700} fontSize={11} fill="#fff">
        {n}
      </text>
    </g>
  )
}

const FLOW = [
  'Buyer creates a recipient key in the browser vault and funds principal plus 1% fee. Only the key hash goes onchain.',
  'Buyer publishes the public key. The backend accepts it only if its hash matches the onchain commitment.',
  'Fulfiller encrypts the voucher to that key in the browser (ECDH P-256, HKDF, AES-256-GCM) and uploads ciphertext only.',
  'Validator service checks onchain order state and the envelope, then signs an EIP-712 delivery attestation.',
  'Fulfiller submits the digest and attestation. The contract verifies signer, trade, recipient, expiry, chain and contract.',
  'Buyer fetches the ciphertext, checks it against the onchain digest, and decrypts locally.',
  'Buyer accepts, or disputes within the review window. Silence past the window lets anyone release.',
  'Arbitrator rules before the fixed deadline. If it does not, anyone can finalize the disclosed 50/50 principal split.',
]

export function ArchitectureView() {
  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="display text-xl font-semibold">Architecture</h2>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Plaintext vouchers exist only inside the buyer and fulfiller browsers. The backend handles ciphertext, public keys and proofs. The chain holds USDC, digests and commitments.
        </p>
        <div className="overflow-x-auto">
          <svg viewBox="0 0 900 520" role="img" aria-labelledby="arch-title arch-desc" className="min-w-[720px] w-full">
            <title id="arch-title">NetPositive architecture</title>
            <desc id="arch-desc">Buyer and fulfiller browsers, a backend that sees only ciphertext, and the NetPositive contract on Arc Testnet with USDC.</desc>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={INK} />
              </marker>
            </defs>

            <Box x={20} y={40} w={250} h={150} title="Buyer browser" lines={['Private vault (AES-256-GCM)', 'Recipient private key', 'Decrypts delivery locally', 'Never leaves this tab']} />
            <Box x={20} y={330} w={250} h={150} title="Fulfiller browser" lines={['Voucher plaintext (synthetic)', 'Encrypts to buyer key', 'Uploads ciphertext only', 'Submits attestation tx']} />
            <Box x={330} y={185} w={240} h={150} tone="server" title="Backend" lines={['Ciphertext store (by digest)', 'Buyer public keys', 'Validator: EIP-712 signer', 'Ownership proof verifier', 'No plaintext. No user keys.']} />
            <Box x={630} y={40} w={250} h={190} tone="chain" title="NetPositive (Arc Testnet)" lines={['Escrow: principal + 1% fee', 'Verifies EIP-712 attestation', 'Review + dispute deadlines', 'Pull-payment withdrawals', 'USDC 0x3600...0000 (6 dp)', 'No admin, proxy or pause']} />
            <Box x={630} y={330} w={250} h={100} tone="party" title="Immutable arbitrator" lines={['Rules before the deadline', 'Else disclosed 50/50 fallback']} />

            <g stroke={INK} strokeWidth={1.6} fill="none" markerEnd="url(#arr)">
              <path d="M270,85 H630" />
              <path d="M270,150 L330,225" />
              <path d="M270,400 L330,310" />
              <path d="M330,330 L270,430" strokeDasharray="5 4" />
              <path d="M270,460 H600 V190 H630" />
              <path d="M330,265 L270,165" strokeDasharray="5 4" />
              <path d="M270,120 H630" />
              <path d="M755,330 V230" />
              <path d="M570,215 L630,175" strokeDasharray="5 4" />
            </g>
            <Step x={450} y={85} n={1} />
            <Step x={300} y={188} n={2} />
            <Step x={300} y={355} n={3} />
            <Step x={300} y={385} n={4} />
            <Step x={440} y={460} n={5} />
            <Step x={300} y={215} n={6} />
            <Step x={450} y={120} n={7} />
            <Step x={755} y={280} n={8} />
            <text x={600} y={250} fontFamily="DM Sans, sans-serif" fontSize={11} fill={MUTED} textAnchor="end">reads order state</text>
          </svg>
        </div>
      </section>
      <section className="card">
        <h3 className="display text-lg font-semibold">Flow, step by step</h3>
        <ol className="mt-3 space-y-2 text-sm">
          {FLOW.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
