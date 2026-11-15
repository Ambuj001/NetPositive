import assert from "node:assert/strict";
import { test } from "node:test";
import { WORLD_ID_STATE_LINE, capUsage, changedLine, explorerFor, networkName, orderTotals, rateCheckLine, switchConfirm } from "../src/lib/adminView.ts";

test("cap usage gives a bar percentage and a line", () => {
  assert.deepEqual(capUsage(0n, 5_000_000_000n), { pct: 0, text: "0 of 5,000 USDC locked (0%)", full: false });
  assert.deepEqual(capUsage(1_250_000_000n, 5_000_000_000n), { pct: 25, text: "1,250 of 5,000 USDC locked (25%)", full: false });
  // one decimal, rounded down
  assert.equal(capUsage(1_234_000n, 1_000_000_000n).pct, 0.1);
  assert.equal(capUsage(2_999_999n, 1_000_000_000n).pct, 0.2);
  assert.deepEqual(capUsage(5_000_000_000n, 5_000_000_000n).full, true);
  // over the cap (the owner lowered it) stays at 100 for the bar
  assert.equal(capUsage(6_000_000_000n, 5_000_000_000n).pct, 100);
  assert.deepEqual(capUsage(0n, 0n), { pct: 0, text: "0 USDC locked, no cap set", full: false });
});

test("order totals split live and finished orders", () => {
  const t = orderTotals({ pending_funding: 1, open: 4, accepted: 2, code_submitted: 1, disputed: 1, releasing: 0, released: 10, refunding: 1, refunded: 3, cancelled: 2 });
  assert.equal(t.live, 10);
  assert.equal(t.finished, 15);
  assert.equal(t.total, 25);
  assert.equal(t.count("open"), 4);
});

test("order totals treat missing or bad counts as zero", () => {
  const t = orderTotals({ open: 2, released: -1, refunded: Number.NaN, cancelled: "3" as unknown as number });
  assert.deepEqual([t.live, t.finished, t.total], [2, 0, 2]);
  assert.deepEqual([orderTotals(null).total, orderTotals(undefined).total], [0, 0]);
});

test("the confirmation says exactly what each switch does", () => {
  const on = switchConfirm(true);
  assert.equal(on.title, "Switch the World ID requirement on?");
  assert.match(on.body, /need a World ID bound to the wallet/);
  assert.match(on.body, /asked to verify with World ID/);
  assert.equal(on.cta, "Yes, require World ID");

  const off = switchConfirm(false);
  assert.equal(off.title, "Switch the World ID requirement off?");
  assert.match(off.body, /any signed-in wallet can post, fund, accept and deliver orders without World ID/);
  assert.match(off.body, /one person can use many wallets/);
  assert.equal(off.cta, "Yes, switch it off");
});

test("state lines", () => {
  assert.equal(WORLD_ID_STATE_LINE.on, "On: every trader must prove they are one person with World ID.");
  assert.equal(WORLD_ID_STATE_LINE.off, "Off: any wallet can trade; one person can use many wallets.");
});

test("who changed the setting and when", () => {
  assert.equal(changedLine({ updatedBy: null, updatedAt: null }), "Not changed here yet: the server's default (WORLD_ID_REQUIRED) applies.");
  assert.equal(
    changedLine({ updatedBy: "0x1234567890abcdef1234567890abcdef12345678", updatedAt: "2026-11-15T09:05:00.000Z" }, "UTC"),
    "Last changed by 0x1234…5678 on 15 Nov 2026, 09:05.",
  );
  assert.equal(changedLine({ updatedBy: "0x1234567890abcdef1234567890abcdef12345678", updatedAt: null }), "Last changed by 0x1234…5678.");
});

test("explorer and network names for the chain the server reports", () => {
  assert.equal(explorerFor(5042), "https://explorer.arc.io");
  assert.equal(explorerFor(5042002), "https://testnet.arcscan.app");
  assert.equal(explorerFor(31337), null);
  assert.equal(networkName(5042), "Arc (5042)");
  assert.equal(networkName(31337), "chain 31337");
});

test("rate check in words", () => {
  assert.equal(rateCheckLine(15), "Within 15% of the market rate");
  assert.equal(rateCheckLine(0), "Off: rates are not checked against the market");
  assert.equal(rateCheckLine(undefined), "Off: rates are not checked against the market");
});
