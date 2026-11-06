// Run: node --test test/cardCatalog.test.ts   (Node 22.18+ strips the types itself)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG, LABEL, isSaved, profileFor, searchCatalog, shortName } from "../src/lib/cardCatalog.ts";
import { CATALOG_DATA } from "../src/lib/cardCatalog.data.ts";
import { routesFor } from "../src/lib/engine.ts";
import { buildCatalogData, SOURCE } from "../scripts/build-card-catalog.mjs";

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const get = (id: string) => CATALOG.find((c) => c.id === id)!;

/* ---------------------------------------------------------------- the data */

test("the committed catalog is exactly what the generator makes from chatbot/data/cards.json", () => {
  const source = JSON.parse(readFileSync(SOURCE, "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG_DATA)), buildCatalogData(source).cards);
});

test("every card in the supplied list is there, except region-locked ones (EEA only)", () => {
  const source = JSON.parse(readFileSync(SOURCE, "utf8")) as { cards: { id: string; regions?: string[] }[] };
  const expected = source.cards.filter((c) => !c.regions || c.regions.includes("IN")).map((c) => c.id);
  assert.deepEqual(ids(CATALOG), expected);
  assert.ok(CATALOG.length >= 30);
  assert.ok(!ids(CATALOG).includes("cryptocom_obsidian_eu"));
});

test("ids are unique and usable as saved-card ids", () => {
  assert.equal(new Set(ids(CATALOG)).size, CATALOG.length);
  for (const c of CATALOG) assert.match(c.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, c.id);
});

test("every profile fits the limits the server enforces (so saving it can never be refused)", () => {
  const n = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  for (const { profile: p, id } of CATALOG) {
    assert.ok(p.issuer.length >= 1 && p.issuer.length <= 60, `${id} issuer`);
    assert.ok(p.name.length >= 1 && p.name.length <= 80, `${id} name`);
    assert.ok(p.last.length <= 20, `${id} last "${p.last}"`);
    assert.ok(p.gradient.length <= 300);
    assert.ok(n(p.pointsPer, 0, 100) && n(p.spendUnit, 0.01, 100000) && n(p.travelValue, 0, 100) && n(p.statementValue, 0, 100), `${id} rates`);
    assert.ok(n(p.bonusCap, 0, 10_000_000) && n(p.bonusUsed, 0, 10_000_000), `${id} caps`);
    assert.ok(p.channels.length >= 1 && p.channels.length <= 12, `${id} channels`);
    for (const ch of p.channels) {
      assert.match(ch.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, `${id}/${ch.id}`);
      assert.ok(ch.name.length >= 1 && ch.name.length <= 80 && ch.note.length <= 200);
      assert.ok(n(ch.multiplier, 0, 100) && Number.isInteger(ch.denomination) && ch.denomination >= 1 && ch.denomination <= 10_000_000);
      if (ch.instantDiscount !== undefined) assert.ok(n(ch.instantDiscount, 0, 1), `${id} discount`);
    }
  }
});

/* ---------------------------------------------------------------- profiles */

test("HDFC Infinia gets its three researched routes with the researched numbers", () => {
  const { profile: p, verified } = get("hdfc_infinia");
  assert.equal(verified, true);
  assert.deepEqual([p.issuer, p.name, p.last], ["HDFC", "Infinia", LABEL.verified]);
  assert.deepEqual([p.pointsPer, p.spendUnit, p.bonusCap], [5, 150, 3000]);
  assert.equal(p.channels.length, 3);
  const accelerated = p.channels.find((c) => c.id === "infinia_smartbuy_5x")!;
  const instant = p.channels.find((c) => c.id === "infinia_instadeals")!;
  assert.equal(accelerated.multiplier, 5);
  assert.equal(instant.instantDiscount, 0.075);
});

test("a verified flat cashback (SBI Aurum 1%) becomes 1 point per ₹100 worth ₹1", () => {
  const { profile: p } = get("sbi_aurum");
  assert.deepEqual([p.pointsPer, p.spendUnit, p.travelValue, p.statementValue], [1, 100, 1, 1]);
  const best = routesFor(5000, [p])[0];
  assert.ok(Math.abs(best.pctStatement - 1) < 0.01, `got ${best.pctStatement}`);
});

test("cards whose gift-card rewards are excluded say so and earn nothing", () => {
  for (const id of ["axis_magnus", "axis_magnus_burgundy", "axis_select", "sbi_flipkart"]) {
    const c = get(id);
    assert.equal(c.verified, false);
    assert.equal(c.profile.last, LABEL.excluded, id);
    assert.equal(c.profile.pointsPer, 0);
  }
});

test("cards with only stale or unconfirmed research are saved at 0% and labelled, never given a made-up rate", () => {
  for (const id of ["icici_emeralde_private", "icici_amazon_pay", "hdfc_regalia_gold", "kotak_zen", "amex_smartearn", "sbi_cashback"]) {
    const c = get(id);
    assert.equal(c.verified, false, id);
    assert.equal(c.profile.pointsPer, 0, id);
    assert.equal(c.profile.last, LABEL.unconfirmed, id);
    assert.equal(c.profile.channels.length, 1);
  }
});

test("only cards with a verified, usable route are marked verified", () => {
  assert.deepEqual(CATALOG.filter((c) => c.verified).map((c) => c.id).sort(), ["hdfc_infinia", "hdfc_infinia_metal", "sbi_aurum"]);
});

test("unconfirmed cards rank at 0% instead of crashing or claiming value", () => {
  const r = routesFor(5000, [get("kotak_zen").profile]);
  assert.ok(r.length >= 1);
  assert.ok(r.every((x) => Number.isFinite(x.pctTravel) && x.pctTravel === 0));
});

test("profileFor handles a card with no routes at all", () => {
  const { profile, verified } = profileFor({ id: "x", name: "Test Card", issuer: "Test", aliases: [], routes: [] });
  assert.equal(verified, false);
  assert.equal(profile.channels.length, 1);
  assert.equal(profile.name, "Card");
});

/* ------------------------------------------------------------- display name */

test("the bank is not repeated in a card's name", () => {
  assert.equal(shortName("HDFC Infinia", "HDFC"), "Infinia");
  assert.equal(shortName("Amazon Pay ICICI", "ICICI"), "Amazon Pay");
  assert.equal(shortName("Flipkart Axis", "Axis"), "Flipkart");
  assert.equal(shortName("Axis Magnus for Burgundy", "Axis"), "Magnus for Burgundy");
  assert.equal(shortName("Amex Platinum Travel", "Amex"), "Platinum Travel");
  assert.equal(shortName("Kotak 811 #DreamDifferent", "Kotak"), "811 #DreamDifferent");
});

test("a name that is only the bank is kept whole; similar words inside other words are untouched", () => {
  assert.equal(shortName("Axis", "Axis"), "Axis");
  assert.equal(shortName("Taxis Plus", "Axis"), "Taxis Plus");
});

/* ------------------------------------------------------------------ search */

test("an empty or blank search shows everything, in the list's order", () => {
  assert.deepEqual(ids(searchCatalog("")), ids(CATALOG));
  assert.deepEqual(ids(searchCatalog("   ")), ids(CATALOG));
});

test("search is case-insensitive and ignores extra spaces and punctuation", () => {
  const a = ids(searchCatalog("infinia"));
  assert.deepEqual(ids(searchCatalog("  INFINIA ")), a);
  assert.deepEqual(ids(searchCatalog("Infinia!!")), a);
  assert.ok(a.includes("hdfc_infinia") && a.includes("hdfc_infinia_metal"));
});

test("typing a bank lists that bank's cards", () => {
  const r = searchCatalog("hdfc");
  assert.ok(r.length >= 5 && r.every((c) => c.issuer === "HDFC" || c.title.toLowerCase().includes("hdfc")));
  assert.ok(searchCatalog("sbi").every((c) => c.issuer === "SBI" || /sbi/i.test(c.title)));
});

test("every word must match, in any order", () => {
  assert.deepEqual(ids(searchCatalog("amazon icici")), ["icici_amazon_pay"]);
  assert.deepEqual(ids(searchCatalog("pay amazon")), ["icici_amazon_pay"]);
  assert.deepEqual(ids(searchCatalog("infinia xyzzy")), []);
});

test("the closest match comes first", () => {
  assert.equal(searchCatalog("hdfc infinia")[0].id, "hdfc_infinia");
  assert.equal(searchCatalog("infinia")[0].id, "hdfc_infinia");
  assert.deepEqual(ids(searchCatalog("hdfc infinia")).slice(0, 2), ["hdfc_infinia", "hdfc_infinia_metal"]);
});

test("aliases are searched too", () => {
  for (const c of CATALOG) for (const a of c.aliases) assert.ok(ids(searchCatalog(a)).includes(c.id), `${c.id} not found by alias "${a}"`);
});

test("every card can be found by typing its own name", () => {
  for (const c of CATALOG) assert.ok(ids(searchCatalog(c.title)).includes(c.id), c.title);
});

test("no match gives an empty list, and odd input does not break search", () => {
  assert.deepEqual(searchCatalog("zzzz"), []);
  for (const q of ["(", "[", "\\", ".*", "^$", "💳", "a".repeat(500)]) assert.doesNotThrow(() => searchCatalog(q), q);
});

/* ------------------------------------------------------------ already saved */

test("a card counts as saved under its own id or the id of the old example it replaces", () => {
  assert.equal(isSaved("hdfc_infinia", ["hdfc_infinia"]), true);
  assert.equal(isSaved("hdfc_infinia", ["infinia"]), true);
  assert.equal(isSaved("axis_magnus_burgundy", ["magnus"]), true);
  assert.equal(isSaved("sbi_cashback", ["sbi"]), true);
  assert.equal(isSaved("axis_atlas", ["atlas"]), true);
  assert.equal(isSaved("icici_amazon_pay", ["amazon-icici"]), true);
  assert.equal(isSaved("hdfc_infinia", ["atlas", "custom-123"]), false);
  assert.equal(isSaved("hdfc_infinia", []), false);
  assert.equal(isSaved("hdfc_infinia_metal", ["infinia"]), false);
});
