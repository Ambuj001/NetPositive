import type { Card } from "./engine";

/** What has to be written to the server so that its list becomes `next`. Pure, so it can be tested. */
export function diffCards(prev: Card[], next: Card[]): { save: Card[]; remove: string[] } {
  const before = new Map(prev.map((c) => [c.id, JSON.stringify(c)]));
  const ids = new Set(next.map((c) => c.id));
  return {
    save: next.filter((c) => before.get(c.id) !== JSON.stringify(c)),
    remove: prev.filter((c) => !ids.has(c.id)).map((c) => c.id),
  };
}

/**
 * Whether to show the "add your cards" pop-up: only to someone signed in whose saved cards we have actually read
 * (so it never flashes for people who already have cards), who has none and has not closed it before. Not on the landing
 * page, and not on the cards page where they are already adding.
 */
export function shouldPromptForCards(a: { signedIn: boolean; loaded: boolean; count: number; dismissed: boolean; pathname: string; busy?: boolean }): boolean {
  if (!a.signedIn || !a.loaded || a.count > 0 || a.dismissed || a.busy) return false;
  return a.pathname !== "/" && !a.pathname.startsWith("/cards");
}

/* ------------------------------------------------------------ talking to the server */

/** The parts of the API client these functions use (so they can be tested with a fake). */
export type CardsApi = {
  cardsList(token: string): Promise<{ cards: Card[]; promptDismissed: boolean }>;
  cardSave(card: Card, token: string): Promise<unknown>;
  cardRemove(id: string, token: string): Promise<unknown>;
};

/**
 * Read the saved cards from the server. If the server has none and the person had cards saved in this browser before cards
 * lived on the server (and we have not moved them already), upload those once so nothing is lost.
 * Throws if the server can't be reached, or if moving the old cards fails part-way.
 */
export async function loadFromServer(api: CardsApi, token: string, oldLocal: Card[], alreadyMoved: boolean) {
  const res = await api.cardsList(token);
  let cards = res.cards;
  let moved = false;
  if (cards.length === 0 && !alreadyMoved && oldLocal.length > 0) {
    for (const c of oldLocal) await api.cardSave(c, token);
    cards = oldLocal;
    moved = true;
  }
  return { cards, promptDismissed: res.promptDismissed, moved };
}

/**
 * Make the server's list match `target`, writing only what changed. On failure, says so and reports what the server really
 * holds (null if even that can't be read), so the screen can show the truth.
 */
export async function pushChanges(api: CardsApi, token: string, synced: Card[], target: Card[]): Promise<{ ok: true; wrote: number } | { ok: false; error: string; server: Card[] | null }> {
  const { save, remove } = diffCards(synced, target);
  if (!save.length && !remove.length) return { ok: true, wrote: 0 };
  try {
    for (const c of save) await api.cardSave(c, token);
    for (const id of remove) await api.cardRemove(id, token);
    return { ok: true, wrote: save.length + remove.length };
  } catch (e) {
    let server: Card[] | null = null;
    try {
      server = (await api.cardsList(token)).cards;
    } catch {
      /* offline */
    }
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Try again in a moment.", server };
  }
}
