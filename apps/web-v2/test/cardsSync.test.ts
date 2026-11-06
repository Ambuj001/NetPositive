// Run: node --test test/cardsSync.test.ts   (Node 22.18+ strips the types itself; the module has only type imports)
import test from "node:test";
import assert from "node:assert/strict";
import { diffCards, loadFromServer, pushChanges, shouldPromptForCards, type CardsApi } from "../src/lib/cardsSync.ts";

const card = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, issuer: "HDFC", name: id, last: "", gradient: "", pointsPer: 5, spendUnit: 150, travelValue: 1, statementValue: 0.3, bonusCap: 3000, bonusUsed: 0, channels: [{ id: "d", name: "Direct", multiplier: 1, denomination: 10000, note: "" }], ...over }) as never;

/** A stand-in server that records every call. */
function fakeServer(initial: ReturnType<typeof card>[] = [], opts: { failSaveOn?: string; failList?: boolean; dismissed?: boolean } = {}) {
  const db = new Map<string, ReturnType<typeof card>>(initial.map((c) => [(c as { id: string }).id, c]));
  const calls: string[] = [];
  const api: CardsApi = {
    async cardsList() {
      calls.push("list");
      if (opts.failList) throw new Error("offline");
      return { cards: [...db.values()], promptDismissed: !!opts.dismissed };
    },
    async cardSave(c) {
      const id = (c as { id: string }).id;
      calls.push(`save:${id}`);
      if (id === opts.failSaveOn) throw new Error("server said no");
      db.set(id, c);
    },
    async cardRemove(id) {
      calls.push(`remove:${id}`);
      db.delete(id);
    },
  };
  return { api, db, calls };
}

/* ---------------------------------------------------------------- diffCards */

test("diff: a new card is saved, an unchanged one is not", () => {
  const a = card("a"), b = card("b");
  assert.deepEqual(diffCards([a], [a, b]), { save: [b], remove: [] });
  assert.deepEqual(diffCards([a, b], [a, b]), { save: [], remove: [] });
});

test("diff: only the card that changed is saved", () => {
  const d = diffCards([card("a"), card("b")], [card("a"), card("b", { bonusUsed: 500 })]);
  assert.deepEqual(d.save.map((c) => (c as { id: string }).id), ["b"]);
  assert.deepEqual(d.remove, []);
});

test("diff: a removed card is deleted, and removing everything works", () => {
  assert.deepEqual(diffCards([card("a"), card("b")], [card("b")]), { save: [], remove: ["a"] });
  assert.deepEqual(diffCards([card("a"), card("b")], []), { save: [], remove: ["a", "b"] });
});

test("diff: only reordering writes nothing, and an edit inside a channel counts as a change", () => {
  assert.deepEqual(diffCards([card("a"), card("b")], [card("b"), card("a")]), { save: [], remove: [] });
  const changed = card("a", { channels: [{ id: "d", name: "Direct", multiplier: 3, denomination: 10000, note: "" }] });
  assert.equal(diffCards([card("a")], [changed]).save.length, 1);
});

test("diff: from nothing to a list saves everything; nothing to nothing is nothing", () => {
  assert.equal(diffCards([], [card("a"), card("b")]).save.length, 2);
  assert.deepEqual(diffCards([], []), { save: [], remove: [] });
});

/* ------------------------------------------------------- shouldPromptForCards */

const base = { signedIn: true, loaded: true, count: 0, dismissed: false, pathname: "/trade" };

test("the pop-up shows for a signed-in person whose cards were read, with none saved and never dismissed", () => {
  assert.equal(shouldPromptForCards(base), true);
});

test("it never shows when any condition is missing", () => {
  assert.equal(shouldPromptForCards({ ...base, signedIn: false }), false); // not signed in
  assert.equal(shouldPromptForCards({ ...base, loaded: false }), false); // cards not read yet: no flash for people who have cards
  assert.equal(shouldPromptForCards({ ...base, count: 1 }), false); // already has a card
  assert.equal(shouldPromptForCards({ ...base, dismissed: true }), false); // closed before
  assert.equal(shouldPromptForCards({ ...base, busy: true }), false); // wallet dialog is open
});

test("it stays off the landing page and the cards page, and shows on the other pages", () => {
  assert.equal(shouldPromptForCards({ ...base, pathname: "/" }), false);
  assert.equal(shouldPromptForCards({ ...base, pathname: "/cards" }), false);
  assert.equal(shouldPromptForCards({ ...base, pathname: "/cards/anything" }), false);
  for (const p of ["/trade", "/market", "/track", "/dispute", "/track?id=1"]) assert.equal(shouldPromptForCards({ ...base, pathname: p }), true, p);
});

/* ------------------------------------------------------------ loadFromServer */

test("load: the server's cards are used as they are and nothing is uploaded", async () => {
  const s = fakeServer([card("a"), card("b")]);
  const r = await loadFromServer(s.api, "t", [card("old")], false);
  assert.deepEqual(r.cards.map((c) => (c as { id: string }).id), ["a", "b"]);
  assert.equal(r.moved, false);
  assert.deepEqual(s.calls, ["list"]);
});

test("load: cards saved in this browser before are moved up once when the server has none", async () => {
  const s = fakeServer([]);
  const r = await loadFromServer(s.api, "t", [card("old1"), card("old2")], false);
  assert.equal(r.moved, true);
  assert.deepEqual(r.cards.map((c) => (c as { id: string }).id), ["old1", "old2"]);
  assert.deepEqual([...s.db.keys()], ["old1", "old2"]);
});

test("load: they are not moved again once moved, so deleting every card stays deleted", async () => {
  const s = fakeServer([]);
  const r = await loadFromServer(s.api, "t", [card("old")], true);
  assert.deepEqual(r.cards, []);
  assert.equal(r.moved, false);
  assert.deepEqual(s.calls, ["list"]);
});

test("load: a new person with nothing anywhere gets an empty list and the dismissed flag as stored", async () => {
  assert.deepEqual((await loadFromServer(fakeServer().api, "t", [], false)).cards, []);
  assert.equal((await loadFromServer(fakeServer([], { dismissed: true }).api, "t", [], false)).promptDismissed, true);
  assert.equal((await loadFromServer(fakeServer().api, "t", [], false)).promptDismissed, false);
});

test("load: an unreachable server throws (the app then keeps the browser's cards)", async () => {
  await assert.rejects(loadFromServer(fakeServer([], { failList: true }).api, "t", [], false), /offline/);
});

test("load: if moving the old cards fails part-way it throws instead of claiming success", async () => {
  const s = fakeServer([], { failSaveOn: "old2" });
  await assert.rejects(loadFromServer(s.api, "t", [card("old1"), card("old2"), card("old3")], false), /server said no/);
});

/* --------------------------------------------------------------- pushChanges */

test("push: adds, edits and removes reach the server, and only the changed ones", async () => {
  const s = fakeServer([card("a"), card("b"), card("c")]);
  const r = await pushChanges(s.api, "t", [card("a"), card("b"), card("c")], [card("a"), card("b", { bonusUsed: 9 }), card("d")]);
  assert.deepEqual(r, { ok: true, wrote: 3 });
  assert.deepEqual(s.calls, ["save:b", "save:d", "remove:c"]);
  assert.deepEqual([...s.db.keys()].sort(), ["a", "b", "d"]);
  assert.equal((s.db.get("b") as { bonusUsed: number }).bonusUsed, 9);
});

test("push: no change means no calls at all", async () => {
  const s = fakeServer([card("a")]);
  assert.deepEqual(await pushChanges(s.api, "t", [card("a")], [card("a")]), { ok: true, wrote: 0 });
  assert.deepEqual(s.calls, []);
});

test("push: a failure reports the error and what the server really holds", async () => {
  const s = fakeServer([card("a")], { failSaveOn: "b" });
  const r = await pushChanges(s.api, "t", [card("a")], [card("a"), card("b")]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /server said no/);
    assert.deepEqual(r.server?.map((c) => (c as { id: string }).id), ["a"]);
  }
});

test("push: if the server can't even be read after a failure, it says so with null", async () => {
  const api: CardsApi = { cardsList: async () => { throw new Error("offline"); }, cardSave: async () => { throw new Error("boom"); }, cardRemove: async () => undefined };
  const r = await pushChanges(api, "t", [], [card("a")]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.server, null);
});

test("push: the first failure stops the rest, and nothing after it is claimed", async () => {
  const s = fakeServer([card("x")], { failSaveOn: "a" });
  const r = await pushChanges(s.api, "t", [card("x")], [card("a"), card("b")]);
  assert.equal(r.ok, false);
  assert.ok(!s.calls.includes("save:b"));
});
