import { db, col, FieldValue } from './firestore.js';
import { conflict } from '../lib/errors.js';

/**
 * A person's saved card reward profiles (issuer, variant, reward rates). Never card numbers.
 *
 *   users/{address}/cards/{cardId}   one document per card
 *   users/{address}.cardsPromptDismissed   true once they closed the "add your cards" pop-up
 *
 * One document per card (not one array on the user) so a card can be added, edited or removed on its own:
 * Firestore can append to an array (arrayUnion) but cannot edit one element of it in place.
 */
export const MAX_CARDS = 30;

const cardsOf = (address) => col.users.doc(address).collection('cards');

/** Only the card's own fields, never Firestore bookkeeping. */
function present(id, data) {
  const { createdAt: _c, updatedAt: _u, ...card } = data;
  return { ...card, id };
}

export async function listCards(address) {
  const [snap, user] = await Promise.all([
    cardsOf(address).orderBy('createdAt', 'asc').limit(MAX_CARDS).get(),
    col.users.doc(address).get(),
  ]);
  return { cards: snap.docs.map((d) => present(d.id, d.data())), promptDismissed: user.data()?.cardsPromptDismissed === true };
}

/** Add a card, or replace the rate fields of one you already have. Safe to repeat. */
export async function saveCard(address, card) {
  const ref = cardsOf(address).doc(card.id);
  await db.runTransaction(async (tx) => {
    const [existing, all] = await Promise.all([tx.get(ref), tx.get(cardsOf(address).limit(MAX_CARDS + 1))]);
    const { id: _id, ...fields } = card;
    if (existing.exists) {
      tx.set(ref, { ...fields, createdAt: existing.data().createdAt, updatedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (all.size >= MAX_CARDS) throw conflict('too_many_cards', `You can save up to ${MAX_CARDS} cards. Remove one first.`);
    tx.set(ref, { ...fields, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return present(card.id, card);
}

/** Removing a card you don't have is fine (it is already gone). */
export async function removeCard(address, cardId) {
  await cardsOf(address).doc(cardId).delete();
}

/** Remember that this person closed the pop-up, so it is not shown again on any device. */
export async function dismissCardsPrompt(address) {
  await col.users.doc(address).set({ cardsPromptDismissed: true, cardsPromptDismissedAt: FieldValue.serverTimestamp() }, { merge: true });
}
