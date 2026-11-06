export type VoucherDetails = { code: string; pin: string; expiry: string }
export const formatExpiry = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}
export function expiryOk(expiry: string, now = new Date()) {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry)
  if (!match) return false
  const month = Number(match[1]),
    year = 2000 + Number(match[2])
  return (
    month >= 1 &&
    month <= 12 &&
    (year > now.getFullYear() ||
      (year === now.getFullYear() && month >= now.getMonth() + 1))
  )
}
export const voucherOk = (v: VoucherDetails) =>
  v.code.trim().length >= 6 &&
  v.code.trim().length <= 128 &&
  /^\d{4,8}$/.test(v.pin) &&
  expiryOk(v.expiry)
/** Largest denomination first; the final voucher carries the remainder. */
export function denominations(amount: number, max = 5000) {
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isFinite(max) ||
    max <= 0
  )
    return []
  return Array.from({ length: Math.ceil(amount / max) }, (_, i) =>
    Math.min(max, amount - i * max),
  )
}
export function safeUrl(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.href
      : undefined
  } catch {
    return undefined
  }
}
