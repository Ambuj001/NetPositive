import { useCallback, useEffect, useRef, useState } from 'react'

type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}
export type WalletOption = {
  info: { uuid: string; name: string; icon?: string }
  provider: Provider
}
declare global {
  interface Window {
    ethereum?: Provider
  }
}
export const ARC = {
  chainId: '0x4cef52',
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.arc.io'],
  blockExplorerUrls: ['https://explorer.testnet.arc.io'],
}
export function walletMessage(error: unknown) {
  const code = (error as { code?: number })?.code
  if (code === 4001)
    return 'Connection cancelled. You can try again whenever you’re ready.'
  if (code === -32002) return 'A request is already open. Check your wallet.'
  return 'Couldn’t connect. Please open your wallet and try again.'
}
export function useWallet() {
  const [wallets, setWallets] = useState<WalletOption[]>([])
  const [selected, setSelected] = useState<WalletOption | null>(null)
  const [address, setAddress] = useState('')
  const [chainId, setChainId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const announce = (event: Event) => {
      const wallet = (event as CustomEvent<WalletOption>).detail
      if (!wallet?.info?.uuid || !wallet.provider?.request) return
      setWallets((prev) => [
        ...prev.filter(
          (w) => w.info.uuid !== wallet.info.uuid && w.info.uuid !== 'injected',
        ),
        wallet,
      ])
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    if (window.ethereum) {
      const provider = window.ethereum
      setWallets((prev) =>
        prev.length
          ? prev
          : [{ info: { uuid: 'injected', name: 'Browser wallet' }, provider }],
      )
    }
    return () =>
      window.removeEventListener('eip6963:announceProvider', announce)
  }, [])
  useEffect(() => {
    const p = selected?.provider
    if (!p) return
    const accountsChanged = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : ''
      setAddress(
        typeof first === 'string' && /^0x[a-fA-F0-9]{40}$/.test(first)
          ? first
          : '',
      )
    }
    const chainChanged = (chain: unknown) => {
      if (typeof chain === 'string') setChainId(chain)
    }
    const disconnected = () => {
      generation.current++
      setAddress('')
      setChainId('')
      setSelected(null)
      setBusy(false)
    }
    p.on?.('accountsChanged', accountsChanged)
    p.on?.('chainChanged', chainChanged)
    p.on?.('disconnect', disconnected)
    return () => {
      p.removeListener?.('accountsChanged', accountsChanged)
      p.removeListener?.('chainChanged', chainChanged)
      p.removeListener?.('disconnect', disconnected)
    }
  }, [selected])
  const connect = useCallback(async (wallet: WalletOption) => {
    const attempt = ++generation.current
    setBusy(true)
    setError('')
    try {
      const accounts = await wallet.provider.request({
        method: 'eth_requestAccounts',
      })
      const first = Array.isArray(accounts) ? accounts[0] : undefined
      if (typeof first !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(first))
        throw new Error('Invalid account')
      const chain = await wallet.provider.request({ method: 'eth_chainId' })
      if (attempt !== generation.current) return
      setSelected(wallet)
      setAddress(first)
      setChainId(typeof chain === 'string' ? chain : '')
    } catch (e) {
      if (attempt === generation.current) setError(walletMessage(e))
    } finally {
      if (attempt === generation.current) setBusy(false)
    }
  }, [])
  const switchNetwork = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      try {
        await selected.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARC.chainId }],
        })
      } catch (e) {
        if ((e as { code?: number })?.code !== 4902) throw e
        await selected.provider.request({
          method: 'wallet_addEthereumChain',
          params: [ARC],
        })
        await selected.provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARC.chainId }],
        })
      }
      const chain = await selected.provider.request({ method: 'eth_chainId' })
      setChainId(typeof chain === 'string' ? chain : '')
    } catch (e) {
      setError(walletMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const disconnect = () => {
    generation.current++
    setSelected(null)
    setAddress('')
    setChainId('')
    setError('')
    setBusy(false)
  }
  return {
    wallets,
    address,
    chainId,
    busy,
    error,
    connect,
    disconnect,
    switchNetwork,
    onArc: chainId.toLowerCase() === ARC.chainId,
    signMessage: async (message: string): Promise<string> => {
      if (!selected || !address) throw new Error('Connect your wallet first')
      const encoded = '0x' + Array.from(new TextEncoder().encode(message)).map(b => b.toString(16).padStart(2, '0')).join('')
      const signature = await selected.provider.request({ method: 'personal_sign', params: [encoded, address] })
      if (typeof signature !== 'string') throw new Error('Signature cancelled')
      return signature
    },
  }
}
