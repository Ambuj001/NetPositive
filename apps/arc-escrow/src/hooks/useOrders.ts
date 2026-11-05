import { useCallback, useEffect, useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { getAbiItem, type Address, type Hex } from 'viem'
import { netPositiveAbi } from '@/abi/netPositiveAbi'
import { CHAIN_ID, DEPLOY_BLOCK, NP_ADDRESS, OrderState, toOrder, type Order } from '@/lib/netpositive'

const orderCreated = getAbiItem({ abi: netPositiveAbi, name: 'OrderCreated' })
const START_SPAN = 10_000n
const MIN_SPAN = 250n
const FALLBACK_LOOKBACK = 20_000n

export interface ScanState {
  status: 'idle' | 'scanning' | 'error'
  head?: bigint
  at?: bigint
  message?: string
}

const loadIds = (key: string): Hex[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as Hex[]
  } catch {
    return []
  }
}

/**
 * Orders for the connected wallet. Scans OrderCreated logs forward from the deployment block in bounded
 * chunks (never from genesis), shrinking the chunk when the RPC refuses a range, and remembers progress.
 */
export function useOrders(account: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const [orders, setOrders] = useState<Order[]>([])
  const [scan, setScan] = useState<ScanState>({ status: 'idle' })
  const running = useRef(false)

  const idsKey = NP_ADDRESS && account ? `np.ids.${NP_ADDRESS}.${account}`.toLowerCase() : undefined
  const cursorKey = idsKey ? `${idsKey}.cursor` : undefined

  const loadOrders = useCallback(
    async (ids: Hex[]) => {
      const contract = NP_ADDRESS
      if (!client || !contract) return
      const rows = await Promise.all(
        ids.map(async (id) => {
          const raw = await client.readContract({
            address: contract,
            abi: netPositiveAbi,
            functionName: 'getOrder',
            args: [id],
          })
          return toOrder(id, raw)
        }),
      )
      setOrders(rows.filter((o) => o.state !== OrderState.None).sort((a, b) => b.deliveryDeadline - a.deliveryDeadline))
    },
    [client],
  )

  const refresh = useCallback(async () => {
    if (!client || !NP_ADDRESS || !account || !idsKey || !cursorKey || running.current) return
    running.current = true
    try {
      const ids = new Set(loadIds(idsKey))
      const head = await client.getBlockNumber()
      const stored = localStorage.getItem(cursorKey)
      let from = stored ? BigInt(stored) + 1n : (DEPLOY_BLOCK ?? (head > FALLBACK_LOOKBACK ? head - FALLBACK_LOOKBACK : 0n))
      let span = START_SPAN
      setScan({ status: 'scanning', head, at: from })
      while (from <= head) {
        const to = from + span - 1n > head ? head : from + span - 1n
        try {
          const [asBuyer, asFulfiller] = await Promise.all([
            client.getLogs({ address: NP_ADDRESS, event: orderCreated, args: { buyer: account }, fromBlock: from, toBlock: to }),
            client.getLogs({ address: NP_ADDRESS, event: orderCreated, args: { fulfiller: account }, fromBlock: from, toBlock: to }),
          ])
          for (const log of [...asBuyer, ...asFulfiller]) if (log.args.tradeId) ids.add(log.args.tradeId)
          localStorage.setItem(cursorKey, to.toString())
          from = to + 1n
          setScan({ status: 'scanning', head, at: to })
        } catch (error) {
          if (span <= MIN_SPAN) throw error
          span = span / 2n
        }
      }
      localStorage.setItem(idsKey, JSON.stringify([...ids]))
      await loadOrders([...ids])
      setScan({ status: 'idle', head, at: head })
    } catch (error) {
      setScan({ status: 'error', message: error instanceof Error ? error.message.split('\n')[0] : 'Scan failed' })
    } finally {
      running.current = false
    }
  }, [account, client, cursorKey, idsKey, loadOrders])

  /** Adds a trade ID (after creating an order, or from a manual lookup) without waiting for a log scan. */
  const track = useCallback(
    async (tradeId: Hex) => {
      if (!idsKey) return
      const ids = new Set(loadIds(idsKey))
      ids.add(tradeId)
      localStorage.setItem(idsKey, JSON.stringify([...ids]))
      await loadOrders([...ids])
    },
    [idsKey, loadOrders],
  )

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0)
    const id = setInterval(() => void refresh(), 20_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [refresh])

  return { orders, scan, refresh, track }
}
