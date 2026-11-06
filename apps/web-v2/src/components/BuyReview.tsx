import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CircleAlert, X } from "lucide-react";
import { BrandMark, Button } from "./ui";
import { brand, type Order } from "../lib/data";
import { inr, quote, usdt } from "../lib/engine";

/** Review dialog for a buy order made of whole matched vouchers. */
export function ReviewModal({ open, onClose, matched, receive, onAccept }: { open: boolean; onClose: () => void; matched: Order[]; receive: number; onAccept: () => void }) {
  const total = matched.reduce((s, o) => s + o.amount, 0);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Review buy order"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="hairline w-full max-w-[440px] rounded-[26px] bg-ink-2 p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold tracking-tight">Review buy order</h3>
              <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 space-y-2">
              {matched.map((o) => {
                const b = brand(o.brandId);
                return (
                  <div key={o.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07]">
                    <BrandMark id={o.brandId} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium">
                        {b.name} {inr(o.amount)}
                      </div>
                      <div className="font-mono text-[11px] text-dim">
                        {o.id} · ₹{o.rate.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right text-[13px] font-medium tabular">{usdt(quote(o.amount, o.rate).buyerReceives)} USDC</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 space-y-2 rounded-2xl bg-white/[0.02] p-4 text-[13px] ring-1 ring-white/[0.06]">
              <div className="flex justify-between">
                <span className="text-mute">You pay on your card</span>
                <span className="tabular">{inr(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">You receive</span>
                <span className="font-semibold text-mint tabular">{usdc(receive)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">Platform fee</span>
                <span>0%</span>
              </div>
            </div>
            {matched.length > 1 && (
              <p className="mt-3 flex items-start gap-2 text-[12px] text-mute">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber" /> You'll fill these one at a time. Start with the first; the rest stay in your list on Track.
              </p>
            )}
            <Button className="mt-5 w-full" size="lg" onClick={onAccept} icon={<ArrowRight className="size-4" />}>
              Accept {matched.length > 1 ? "first order" : "order"} & start
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const usdc = (n: number) => `${usdt(n)} USDC`;
