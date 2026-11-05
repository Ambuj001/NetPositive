// UI fixtures, not a current issuer feed. See docs/frontend/README.md.
export const RESEARCH_SOURCE =
  'https://www.gyftr.com/instantvouchers/lifestyle-gift-vouchers'
export function rewardRoutes(amount: number, bonusAvailable = true) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000)
    throw new RangeError('Enter an amount between 1 and 100,000.')
  const base = Math.floor(amount / 150) * 5
  const paidWithDiscount = Math.round(amount * 0.925 * 100) / 100
  const routes = [
    {
      id: 'direct',
      name: 'Direct payment',
      detail: 'Infinia · base rewards',
      value: base,
    },
    {
      id: 'smartbuy',
      name: 'SmartBuy voucher',
      detail: bonusAvailable
        ? 'Infinia · 5× rewards'
        : 'Infinia · bonus cap used',
      value: base + (bonusAvailable ? Math.min(base * 4, 3000) : 0),
    },
    {
      id: 'instadeals',
      name: 'InstaDeals',
      detail: '7.5% off + base rewards',
      value:
        Math.round(
          (amount - paidWithDiscount + Math.floor(paidWithDiscount / 150) * 5) *
            100,
        ) / 100,
    },
  ]
  return routes.sort((a, b) => b.value - a.value)
}

export function voucherPreview(amount: number, mode: 'buy' | 'sell') {
  if (!Number.isFinite(amount) || amount < 250 || amount > 50000)
    throw new RangeError('Choose a value from ₹250 to ₹50,000.')
  // Illustrative 90 INR/USDC. Buyer of voucher = seller of crypto, who pays the 1% fee.
  const principal = Math.round((amount / 90) * 100) / 100
  const fee = mode === 'buy' ? Math.round(principal * 0.01 * 100) / 100 : 0
  return { principal, fee, total: Math.round((principal + fee) * 100) / 100 }
}
