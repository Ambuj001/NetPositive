// Run: node --test test/portals.test.ts   (Node 22.18+ strips the types itself; the module has no imports)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRED, PORTALS, PORTAL_ISSUERS, portalFor } from "../src/lib/portals.ts";

test("every bank with a link is found, whatever the letter case or spacing", () => {
  for (const i of PORTAL_ISSUERS) {
    assert.equal(portalFor(i), PORTALS[i]);
    assert.equal(portalFor(i.toUpperCase()), PORTALS[i]);
    assert.equal(portalFor(`  ${i.toLowerCase()} `), PORTALS[i]);
  }
});

test("a bank with no link on file (SBI) or an unknown or empty one gives nothing", () => {
  for (const x of ["SBI", "sbi", "Unknown Bank", "", "   ", null, undefined]) assert.equal(portalFor(x as string | null | undefined), null, String(x));
});

test("every link is a safe https page and each bank has a name", () => {
  for (const p of [...Object.values(PORTALS), CRED]) {
    const u = new URL(p.url);
    assert.equal(u.protocol, "https:", p.name);
    assert.ok(p.name.length > 2);
  }
});

test("the links match the product owner's list in chatbot/data/portals.json", () => {
  const file = JSON.parse(readFileSync(new URL("../../../chatbot/data/portals.json", import.meta.url), "utf8")) as { portals: Record<string, { url: string; name: string }>; cred: { url: string } };
  assert.deepEqual(Object.keys(file.portals).sort(), [...PORTAL_ISSUERS].sort());
  for (const [issuer, p] of Object.entries(file.portals)) {
    assert.equal(PORTALS[issuer].url, p.url, `${issuer} url`);
    assert.equal(PORTALS[issuer].name, p.name, `${issuer} name`);
  }
  assert.equal(CRED.url, file.cred.url);
});
