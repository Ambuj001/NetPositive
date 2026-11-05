import { describe, expect, test } from 'bun:test'
import { getChain } from './chain-registry'

describe('exported deployment chain registry', () => {
  test('resolves Arc Testnet using the included onchain facts', () => {
    const chain = getChain('Arc_Testnet')
    expect(chain.chainId).toBe(5042002)
    expect(chain.explorerUrl).toBe('https://explorer.testnet.arc.io')
    expect(chain.nativeCurrency.symbol).toBe('USDC')
    expect(chain.usdc?.decimals).toBe(6)
  })
  test('keeps testnet and mainnet distinct and rejects unregistered names', () => {
    expect(getChain('Arc').chainId).toBe(5042)
    expect(getChain('Base_Sepolia').chainId).toBe(84532)
    expect(() => getChain('arc-testnet')).toThrow('Unsupported chain')
    expect(() => getChain('Unknown')).toThrow('Unsupported chain')
  })
})
