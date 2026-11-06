export type DisputeTrade = {
  id: string; brand: string; principalUsdc: string; voucherBuyer: string; voucherSeller: string;
  sharedAt: string; acceptedAt: string | null; revealedAt: string | null;
  acceptanceDeadline: string; disputeDeadline: string | null;
  state: 'awaiting_acceptance' | 'review_window' | 'under_review' | 'replacement_requested' | 'resolved' | 'expired';
  escrowFrozen: boolean; openedAt?: string; reviewDueAt?: string;
  bond?: { amountUsdc: string; state: 'required' | 'pending' | 'locked' | 'returned' | 'forfeited'; txHash?: string };
  resolution?: { outcome: 'valid_claim' | 'invalid_claim' | 'replacement_accepted'; note: string; buyerReputationEffect: string; sellerReputationEffect: string };
}
export const DISPUTE_POLICY = { acceptanceSeconds: 300, reviewSeconds: 600, maximumSeconds: 900, merchantReviewHours: 72, bondBps: 100, fixedCutoff: true, noAcceptance: 'cancel_refund', validClaimBond: 'return', falseClaimBond: 'forfeit', acceptedReplacement: 'clear_ban_retain_rating_penalty' } as const
export function remaining(deadline: string | null, now: number) { const t = deadline ? Date.parse(deadline) : NaN; return Number.isFinite(t) ? Math.max(0, Math.ceil((t-now)/1000)) : null }
export function clock(seconds: number | null) { return seconds === null ? '—' : `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}` }
/** Exact 1% bond in six-decimal USDC, rounded upward to avoid undercollateralization. */
export function disputeBond(principal: string) {
 if(!/^\d+(\.\d{1,6})?$/.test(principal)) throw new Error('Invalid USDC principal.')
 const [whole,fraction='']=principal.split('.'); const units=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
 if(units<=0n)throw new Error('Invalid USDC principal.'); const bond=(units+99n)/100n;
 return `${bond/1000000n}.${(bond%1000000n).toString().padStart(6,'0')}`
}
export function canDispute(t: DisputeTrade,address:string,now:number) {
 const shared=Date.parse(t.sharedAt), accepted=t.acceptedAt?Date.parse(t.acceptedAt):NaN, revealed=t.revealedAt?Date.parse(t.revealedAt):NaN, deadline=t.disputeDeadline?Date.parse(t.disputeDeadline):NaN;
 return t.voucherBuyer.toLowerCase()===address.toLowerCase() && t.state==='review_window' && Number.isFinite(accepted) && accepted>=shared && accepted<=shared+300000 && accepted<=revealed && Number.isFinite(shared)&&Number.isFinite(revealed)&&Number.isFinite(deadline)&&revealed<=now&&now<deadline&&deadline<=shared+900000;
}
