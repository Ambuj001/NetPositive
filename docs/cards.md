# Saved cards and the "add your cards" pop-up

Each person's card reward profiles (issuer, variant, rates, bonus cap) are stored in Firestore, so they follow the wallet to any device. **Never card numbers.**

## Where it lives

```
users/{wallet}/cards/{cardId}        one document per card
users/{wallet}.cardsPromptDismissed  true once they closed the pop-up
```

One document per card, not an array on the user: Firestore can append to an array (`arrayUnion`) and remove an exact element (`arrayRemove`), but cannot edit one element in place, and cards are edited (the bonus-cap slider). With a document per card, adding is a new document, editing updates only that document, removing deletes it.

## API (all need the sign-in token)

| Call | Does |
|---|---|
| `GET /cards` | `{ cards, promptDismissed }` for the signed-in wallet, in the order added |
| `PUT /cards/:id` | add the card, or update it if saved (safe to repeat). Strictly validated, max 30 cards per wallet |
| `DELETE /cards/:id` | remove it (removing a missing card is fine) |
| `POST /cards/prompt/dismiss` | remember that they closed the pop-up |

Code: `backend/src/services/cards.js`, `backend/src/routes/cards.js`. Tests: `npm run cards:test` (in memory) and `CONFIRM_REAL_FIRESTORE=yes node scripts/cards-real-check.mjs` (real Firestore, throwaway wallet, deletes what it made).

## Frontend

- `lib/useSavedCards.ts`: signed in, cards come from the server and changes are written in the background (grouped for 400 ms); not signed in, they stay in this browser. Cards saved in this browser before this existed are moved up once.
- `lib/cardsSync.ts`: the plain logic (what to write, when to show the pop-up). Tested in `test/cardsSync.test.ts`.
- `components/CardsPrompt.tsx`: the pop-up. Shown once to a signed-in person with no cards who has not closed it. Closing it, or choosing "Add my cards", stops it for good (kept on the server).

## Picking cards from the list

The pop-up (and "Add a card" on My cards) has a search box over the card list supplied by the product owner (`chatbot/data/cards.json`, 34 cards available in India). Type a bank, a name or a short form, tick the cards you have, and add them. They appear in My cards at once and are saved to the account.

- The list is generated into `apps/web-v2/src/lib/cardCatalog.data.ts` by `npm run catalog:build` (in `apps/web-v2`). A test fails if the committed file no longer matches `chatbot/data/cards.json`.
- Saved card id = the catalog id (for example `hdfc_infinia`). Picking a card whose old example id you already have (for example `infinia`) shows it as already added.
- **Reward rates come only from verified research.** Today that is HDFC Infinia, HDFC Infinia Metal and SBI Aurum ("Verified rates"). Cards whose gift-card rewards are excluded say "No gift-card rewards". Every other card is saved with 0% and the label "Rates not confirmed", because the research marks its numbers unverified or stale (for example the ICICI iShop figures). As more routes are verified in `chatbot/data/cards.json`, rebuild the list and they are picked up.
- One point is worth ₹1 (travel) or ₹0.30 (statement credit), the same assumption the chatbot uses.
