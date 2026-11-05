import { useState } from 'react'
import { VaultProvider } from '@/hooks/useVault'
import { Header, type Tab } from '@/components/Header'
import { EscrowView } from '@/components/EscrowView'
import { VaultView } from '@/components/VaultView'
import { ArchitectureView } from '@/components/ArchitectureView'
import { TrustView } from '@/components/TrustView'

export default function App() {
  const [tab, setTab] = useState<Tab>('escrow')
  return (
    <VaultProvider>
      <div className="min-h-dvh pb-24">
        <Header tab={tab} onTab={setTab} />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <div className="mb-6 max-w-2xl">
            <h1 className="display text-balance text-3xl font-bold sm:text-4xl">Voucher escrow for stablecoin sellers</h1>
            <p className="mt-2 text-pretty" style={{ color: 'var(--muted)' }}>
              Lock USDC for a voucher. Release happens only after an attested, client-encrypted delivery that you accept or leave uncontested. Testnet and synthetic data only.
            </p>
          </div>
          {tab === 'escrow' && <EscrowView />}
          {tab === 'vault' && <VaultView />}
          {tab === 'architecture' && <ArchitectureView />}
          {tab === 'trust' && <TrustView />}
        </main>
      </div>
    </VaultProvider>
  )
}
