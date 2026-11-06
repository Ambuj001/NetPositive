import { useCallback, useEffect, useRef, useState } from 'react'
import { orderApi, toOrder } from './order-api'
import { useApp } from './store'
import type { Order } from './data'
export function useOrderBook() {
  const { orders: preview, fullAddress } = useApp()
  const [live, setLive] = useState<Order[] | null>(null)
  const [source, setSource] = useState<'loading' | 'live' | 'preview'>(
    'loading',
  )
  const [error, setError] = useState('')
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const gen = ++generation.current
    try {
      const result = await orderApi.listOpen()
      if (gen !== generation.current) return
      setLive(result.requests.filter((r) => r.status === 'open').map(toOrder))
      setSource('live')
      setError('')
    } catch (e) {
      if (gen !== generation.current) return
      setLive(null)
      setSource('preview')
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void reload()
    const timer = setInterval(() => void reload(), 15000)
    return () => {
      clearInterval(timer)
      generation.current++
    }
  }, [reload])
  return {
    orders: (source === 'live' && live ? live : preview).filter(
      (o) => o.seller.toLowerCase() !== fullAddress,
    ),
    source,
    error,
    reload,
  }
}

/** The same requester/fulfiller split and ten-second refresh as backend-_ui's Track page. */
export function useMyRequests() {
  const { token, fullAddress } = useApp()
  const [result, setResult] = useState<{
    owner: string
    asRequester: import('./order-api').ApiRequest[]
    asFulfiller: import('./order-api').ApiRequest[]
  } | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const gen = ++generation.current
    if (!token) return
    try {
      const rows = await orderApi.mine(token)
      if (gen === generation.current) {
        setResult({ owner: fullAddress, ...rows })
        setError('')
      }
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message)
    }
  }, [token, fullAddress])
  useEffect(() => {
    setResult(null)
    setError('')
    if (!token) return
    void reload()
    const timer = setInterval(() => void reload(), 10000)
    return () => {
      generation.current++
      clearInterval(timer)
    }
  }, [reload, token])
  return {
    rows: result?.owner === fullAddress ? result : null,
    error: token ? error : '',
    reload,
  }
}
