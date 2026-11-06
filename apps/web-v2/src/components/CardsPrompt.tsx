import { AnimatePresence, motion } from "motion/react";
import { CreditCard, ShieldCheck, X } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { shouldPromptForCards } from "../lib/cardsSync";
import type { Card } from "../lib/engine";
import { useApp } from "../lib/store";
import { CardPicker } from "./CardPicker";
import { Button } from "./ui";

/**
 * The first time someone is in the app with no saved cards, ask them to add some. They search the card list, tick the ones
 * they have and add them: those go straight into My cards and are saved to their account. They can close it instead; once
 * they do (or add cards), it is not shown again, on any device (the choice is saved with their account).
 */
export function CardsPrompt() {
  const { token, address, cards, setCards, cardsLoaded, cardsPromptDismissed, dismissCardsPrompt, walletOpen, toast } = useApp();
  const { pathname } = useLocation();
  const show = shouldPromptForCards({ signedIn: !!token && !!address, loaded: cardsLoaded, count: cards.length, dismissed: cardsPromptDismissed, pathname, busy: walletOpen });

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissCardsPrompt();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, dismissCardsPrompt]);

  const add = (picked: Card[]) => {
    const fresh = picked.filter((c) => !cards.some((x) => x.id === c.id));
    if (!fresh.length) return;
    setCards([...cards, ...fresh]);
    dismissCardsPrompt();
    toast({ title: `${fresh.length} card${fresh.length > 1 ? "s" : ""} added to My cards`, body: "Saved to your account. Change them any time in My cards.", tone: "amber" });
  };

  return <AnimatePresence>{show && <CardsPromptDialog saved={cards} onAdd={add} onClose={dismissCardsPrompt} />}</AnimatePresence>;
}

/** The pop-up itself (no store access), so it can be looked at on its own. */
export function CardsPromptDialog({ saved, onAdd, onClose }: { saved: Card[]; onAdd: (cards: Card[]) => void; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal
        aria-labelledby="cards-prompt-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 24, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
        className="hairline relative my-auto w-full max-w-[520px] overflow-hidden rounded-[26px] bg-ink-2 p-6 sm:p-7"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32" style={{ background: "radial-gradient(60% 100% at 50% 0%, rgba(245,181,68,0.14), transparent)" }} />
        <button type="button" onClick={onClose} className="absolute top-4 right-4 grid size-8 place-items-center rounded-full text-mute transition hover:bg-white/5 hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>

        <div className="relative flex items-center gap-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber/10 text-amber ring-1 ring-amber/25">
            <CreditCard className="size-5" />
          </span>
          <h2 id="cards-prompt-title" className="font-display text-2xl font-semibold tracking-tight">
            Add your cards
          </h2>
        </div>
        <p className="relative mt-3 text-[14px] leading-relaxed text-mute">Search the list and tick the cards you have. We use them to find the best way to buy each voucher and your real price per USDC.</p>
        <p className="relative mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-dim">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-mint" />
          Only the card name and reward rates are saved, never a card number.
        </p>

        <div className="relative mt-5">
          <CardPicker
            saved={saved}
            onAdd={onAdd}
            autoFocus
            secondary={
              <Button variant="ghost" size="md" onClick={onClose}>
                Not now
              </Button>
            }
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
