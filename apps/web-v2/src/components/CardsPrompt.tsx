import { AnimatePresence, motion } from "motion/react";
import { CreditCard, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, type Ref } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { shouldPromptForCards } from "../lib/cardsSync";
import { useApp } from "../lib/store";
import { Button } from "./ui";

/**
 * The first time someone is in the app with no saved cards, ask them to add some. They can close it; once they do (or
 * choose to add), it is not shown again, on any device (the choice is saved with their account).
 */
export function CardsPrompt() {
  const { token, address, cards, cardsLoaded, cardsPromptDismissed, dismissCardsPrompt, walletOpen } = useApp();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const show = shouldPromptForCards({ signedIn: !!token && !!address, loaded: cardsLoaded, count: cards.length, dismissed: cardsPromptDismissed, pathname, busy: walletOpen });
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissCardsPrompt();
    window.addEventListener("keydown", onKey);
    primary.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [show, dismissCardsPrompt]);

  return (
    <AnimatePresence>
      {show && (
        <CardsPromptDialog
          primaryRef={primary}
          onClose={dismissCardsPrompt}
          onAdd={() => {
            dismissCardsPrompt();
            nav("/cards?add=1");
          }}
        />
      )}
    </AnimatePresence>
  );
}

/** The pop-up itself (no logic), so it can be looked at on its own. */
export function CardsPromptDialog({ onAdd, onClose, primaryRef }: { onAdd: () => void; onClose: () => void; primaryRef?: Ref<HTMLButtonElement> }) {
  return (
    <motion.div className="fixed inset-0 z-[75] grid place-items-center bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal
        aria-labelledby="cards-prompt-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 24, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
        className="hairline relative w-full max-w-[460px] overflow-hidden rounded-[26px] bg-ink-2 p-7"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32" style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(245,181,68,0.14), transparent)" }} />
        <button type="button" onClick={onClose} className="absolute top-4 right-4 grid size-8 place-items-center rounded-full text-mute transition hover:bg-white/5 hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>

        <span className="relative grid size-12 place-items-center rounded-2xl bg-amber/10 text-amber ring-1 ring-amber/25">
          <CreditCard className="size-6" />
        </span>
        <h2 id="cards-prompt-title" className="relative mt-5 font-display text-2xl font-semibold tracking-tight">
          Add your cards
        </h2>
        <p className="relative mt-2 text-[14.5px] leading-relaxed text-mute">
          Tell us which credit cards you use. We rank them to find the best way to buy each voucher and show your real price per USDC.
        </p>
        <p className="relative mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-dim">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-mint" />
          We only keep the card name and its reward rates, never a card number. You can change them any time in My cards.
        </p>

        <div className="relative mt-6 flex flex-col gap-2.5 sm:flex-row-reverse">
          <Button ref={primaryRef} variant="amber" size="lg" className="w-full sm:flex-1" onClick={onAdd}>
            Add my cards
          </Button>
          <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={onClose}>
            Not now
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
