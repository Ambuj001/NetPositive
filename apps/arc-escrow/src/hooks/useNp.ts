import { useCallback, useEffect, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { toast } from 'sonner'
import type { Abi, Address, ContractFunctionArgs, ContractFunctionName, Hash } from 'viem'
import { CHAIN_ID, describeError } from '@/lib/netpositive'

export const useNow = (intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export type TxPhase = 'idle' | 'wallet' | 'confirming'

/** Runs a contract write: switches chain if needed, waits for the real receipt, and reports honest phases. */
export function useSend() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [lastHash, setLastHash] = useState<Hash | undefined>()

  const send = useCallback(
    async <const A extends Abi, F extends ContractFunctionName<A, 'nonpayable' | 'payable'>>(params: {
      address: Address
      abi: A
      functionName: F
      args: ContractFunctionArgs<A, 'nonpayable' | 'payable', F>
    }): Promise<boolean> => {
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        setPhase('wallet')
        const hash = await writeContractAsync({ ...params, chainId: CHAIN_ID } as Parameters<typeof writeContractAsync>[0])
        setLastHash(hash)
        setPhase('confirming')
        const receipt = await client?.waitForTransactionReceipt({ hash })
        if (receipt?.status === 'reverted') throw new Error('Transaction reverted')
        return true
      } catch (error) {
        const msg = describeError(error)
        if (msg !== 'Cancelled in wallet.') toast.error(msg)
        return false
      } finally {
        setPhase('idle')
      }
    },
    [chainId, client, switchChainAsync, writeContractAsync],
  )

  return { send, phase, busy: phase !== 'idle', lastHash }
}
