import { CreditCard, ShieldCheck } from "lucide-react";
import { useLocation } from "react-router-dom";
import { shouldPromptForCards } from "../lib/cardsSync";
import type { Card } from "../lib/engine";
import { useApp } from "../lib/store";
import { CardPicker } from "./CardPicker";
import { Button, Dialog } from "./ui";

/**
 * The first time someone is in the app with no saved cards, ask them to add some. They search the card list, tick the ones
 * they have and add them: those go straight into My cards and are saved to their account. They can close it instead; once
 * they do (or add cards), it is not shown again, on any device (the choice is saved with their account).
 */
export function CardsPrompt() {
  const { token, address, cards, setCards, cardsLoaded, cardsPromptDismissed, dismissCardsPrompt, walletOpen, toast } = useApp();
  const { pathname } = useLocation();
  const show = shouldPromptForCards({ signedIn: !!token && !!address, loaded: cardsLoaded, count: cards.length, dismissed: cardsPromptDismissed, pathname, busy: walletOpen });

  const add = (picked: Card[]) => {
    const fresh = picked.filter((c) => !cards.some((x) => x.id === c.id));
    if (!fresh.length) return;
    setCards([...cards, ...fresh]);
    dismissCardsPrompt();
    toast({ title: `${fresh.length} card${fresh.length > 1 ? "s" : ""} added to My cards`, body: "Saved to your account. Change them any time in My cards.", tone: "mint" });
  };

  return <CardsPromptDialog open={show} saved={cards} onAdd={add} onClose={dismissCardsPrompt} />;
}

/** The pop-up itself (no store access), so it can be looked at on its own. */
export function CardsPromptDialog({ open = true, saved, onAdd, onClose }: { open?: boolean; saved: Card[]; onAdd: (cards: Card[]) => void; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      icon={<CreditCard />}
      title="Add your cards"
      description="Search the list and tick the cards you have. We use them to find the best way to buy each voucher and your real price per USDC."
    >
      <p className="mb-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-mute">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-ink" />
        Only the card name and reward rates are saved, never a card number.
      </p>
      <CardPicker
        saved={saved}
        onAdd={onAdd}
        autoFocus
        listHeight="max-h-[min(300px,36dvh)]"
        secondary={
          <Button variant="ghost" size="md" onClick={onClose}>
            Not now
          </Button>
        }
      />
    </Dialog>
  );
}
