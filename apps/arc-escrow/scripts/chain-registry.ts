import { ONCHAIN_CHAINS } from '../src/onchain-facts'

/** Portable replacement for Studio's internal registry package. No network or keys. */
export function getChain(id: string) {
  const chain = ONCHAIN_CHAINS.find((candidate) => candidate.name.replace(/\s+/g, '_') === id)
  if (!chain) throw new Error(`Unsupported chain "${id}" in this exported project`)
  return { ...chain, explorerUrl: chain.explorerBase }
}
