// Run: node --test test/route.test.ts   (Node 22.18+ strips the types itself; the module has no imports)
import test from "node:test";
import assert from "node:assert/strict";

// A tiny stand-in for the browser's localStorage.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
const { saveRoute, readRoute } = await import("../src/lib/route.ts");

const route = { cardId: "infinia", cardLabel: "HDFC Infinia", channelId: "instadeals", channelName: "InstaDeals" };

test("a saved route is read back for the same order only", () => {
  saveRoute("order-1", route);
  assert.deepEqual(readRoute("order-1"), route);
  assert.equal(readRoute("order-2"), null);
});

test("nothing saved reads as null", () => {
  assert.equal(readRoute("never-saved"), null);
});

test("damaged or incomplete data reads as null instead of throwing", () => {
  store.set("netpositive:route:bad-json", "{not json");
  store.set("netpositive:route:partial", JSON.stringify({ cardId: "x" }));
  store.set("netpositive:route:wrong-types", JSON.stringify({ cardId: 1, cardLabel: "a", channelId: "b", channelName: "c" }));
  store.set("netpositive:route:null", "null");
  for (const id of ["bad-json", "partial", "wrong-types", "null"]) assert.equal(readRoute(id), null, id);
});

test("blocked storage never throws", () => {
  const real = globalThis.localStorage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = { ...real, getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as Storage;
  assert.doesNotThrow(() => saveRoute("x", route));
  assert.equal(readRoute("x"), null);
  (globalThis as unknown as { localStorage: Storage }).localStorage = real;
});
