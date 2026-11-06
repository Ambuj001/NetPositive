/** Contracts match backend on the testing/backend integration branches. */
export const API_URL = (
  (import.meta.env?.VITE_API_URL as string | undefined) || '/api'
).replace(/\/$/, '')
export type AccountUser = {
  address: string
  worldIdNullifier?: string | null
  banned?: boolean
  reputation?: { completed: number; disputes: number; strikes: number }
}
export type RemoteOrder = {
  id: string
  brand: string
  amountInr: number
  amountUsdc: string
  status: string
  disputeReason?: string
  disputedAt?: string
  resolution?: { note?: string; outcome: string }
  createdAt?: string
}

export async function api<T>(
  path: string,
  token = '',
  body?: unknown,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(API_URL + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
  } catch {
    throw new Error('Connection unavailable. Try again in a moment.')
  }
  const value = await response.json().catch(() => null)
  if (!response.ok || !value)
    throw new Error(
      value?.message ||
        'Account service is unavailable. Try again in a moment.',
    )
  return value as T
}

export async function authenticate(
  address: string,
  sign: (message: string) => Promise<string>,
) {
  const health = await api<{ ok: boolean; worldIdMock: boolean }>('/health')
  if (!health.ok) throw new Error('Account service is unavailable.')
  const { message } = await api<{ message: string }>('/auth/nonce', '', {
    address,
  })
  // This service uses a fixed sign-in message, never a transaction or arbitrary payload.
  if (
    !/^Sign in to NetPositive\n\nAddress: 0x[a-fA-F0-9]{40}\nNonce: [a-f0-9]+\nIssued At: [^\n]+\n\nThis request will not trigger a transaction or cost any gas\.$/.test(
      message,
    ) ||
    !message.includes(`Address: ${address}`)
  ) {
    throw new Error('The sign-in request could not be validated.')
  }
  const signature = await sign(message)
  const session = await api<{ token: string; user: AccountUser }>(
    '/auth/verify',
    '',
    { address, signature },
  )
  if (session.user.address.toLowerCase() !== address.toLowerCase())
    throw new Error('Wallet changed. Sign in again.')
  return { ...session, worldIdMock: health.worldIdMock }
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback
  } catch {
    return fallback
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
