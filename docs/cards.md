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
