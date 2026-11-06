// Run: node --test test/suggestions.test.ts   (Node 22.18+ strips the types itself; the module has only type imports)
import test from "node:test";
import assert from "node:assert/strict";
import { initiatorOf, suggestionsFor } from "../src/lib/suggestions.ts";

const order = (id: string, initiator?: "spender" | "buyer") => ({
  id, brandId: "amazon", amount: 500, rate: 93.98, seller: "x", sellerTrades: 0, city: "", postedMin: 0, expiresMin: 30, ...(initiator && { initiator }),
});

test("a request with a crypto spender on it was started by a spender", () => {
  assert.equal(initiatorOf({ crypto_spender: "0xabc" }), "spender");
});

test("a request with no spender was started by a crypto buyer", () => {
  assert.equal(initiatorOf({ crypto_spender: null }), "buyer");
  assert.equal(initiatorOf({ crypto_spender: "" }), "buyer");
  assert.equal(initiatorOf({}), "buyer");
});

test("suggestions keep only orders a crypto buyer started", () => {
  const list = [order("a", "spender"), order("b", "buyer"), order("c", "spender"), order("d", "buyer")];
  assert.deepEqual(suggestionsFor(list).map((o) => o.id), ["b", "d"]);
});

test("a request created by a crypto spender is never suggested", () => {
  const spenderOnly = [order("a", "spender"), order("b", "spender")];
  assert.deepEqual(suggestionsFor(spenderOnly), []);
});

test("an order with no recorded initiator counts as a spender's and is not suggested", () => {
  assert.deepEqual(suggestionsFor([order("a")]), []);
});

test("an empty book gives no suggestions, and the input is not changed", () => {
  assert.deepEqual(suggestionsFor([]), []);
  const list = [order("a", "buyer"), order("b", "spender")];
  suggestionsFor(list);
  assert.equal(list.length, 2);
});
