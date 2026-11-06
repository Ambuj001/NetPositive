const test = require('node:test');
const assert = require('node:assert/strict');
const { toPaise, bindCard, normalizeWoohoo, evaluate } = require('../src/normalize.js');

// REAL sample: the `balance` response captured from woohoo.in on 6 Nov 2026 (card number partly masked).
const REAL = {
  cardNumber: '60148805xxx589729',
  balance: '1000.00',
  expiry: '2027-11-05T00:00:00+00:00',
  status: 'ACTIVATED',
  corporateName: '',
  currency: { code: 'INR', numericCode: '356', symbol: '₹', countryName: 'INDIA', currencyName: 'Indian Rupee' },
  additionalTxnFields: { responseCode: 0 },
};
const CODE = '6014880589589729';
const NOW = Date.parse('2026-11-06T00:00:00Z');
const ok = (body, status = 200) => ({ httpStatus: status, body });

test('toPaise parses decimals exactly and rejects junk', () => {
  assert.equal(toPaise('1000.00'), 100000);
  assert.equal(toPaise('1000.5'), 100050);
  assert.equal(toPaise('0.07'), 7);
  assert.equal(toPaise('5000'), 500000);
  for (const bad of ['', 'abc', '-5', '1e3', '1.234', null, undefined]) assert.equal(toPaise(bad), null);
});

test('bindCard handles masked numbers', () => {
  assert.equal(bindCard('60148805xxx589729', CODE), 'match');
  assert.equal(bindCard('60148805xxx589729', '6014880589589720'), 'mismatch');
  assert.equal(bindCard('6014880589589729', CODE), 'match');
  assert.equal(bindCard('60148805xx589729', CODE), 'match'); // mask length may vary
  assert.equal(bindCard('60148805xxx589720', CODE), 'mismatch');
  assert.equal(bindCard('123', CODE), 'mismatch');
  assert.equal(bindCard(undefined, CODE), 'unknown');
});

test('real activated voucher is valid and never echoes the code', () => {
  const r = normalizeWoohoo(ok(REAL), CODE);
  assert.equal(r.ok, true);
  assert.equal(r.balancePaise, 100000);
  assert.equal(r.binding, 'match');
  assert.ok(!JSON.stringify(r).includes(CODE));
  const v = evaluate(r, { expectedPaise: 100000, now: NOW });
  assert.deepEqual(v, { valid: true, failures: [] });
});

test('balance below expected fails', () => {
  const v = evaluate(normalizeWoohoo(ok(REAL), CODE), { expectedPaise: 500000, now: NOW });
  assert.deepEqual(v.failures, ['balance_too_low']);
});

test('expiring soon fails', () => {
  const r = normalizeWoohoo(ok({ ...REAL, expiry: '2026-11-20T00:00:00+00:00' }), CODE);
  assert.deepEqual(evaluate(r, { now: NOW }).failures, ['expires_too_soon']);
});

test('different card than entered fails (swap protection)', () => {
  const v = evaluate(normalizeWoohoo(ok(REAL), '6014880589589720'), { now: NOW });
  assert.ok(v.failures.includes('card_mismatch'));
});

// The following are SYNTHETIC: we have not yet captured Woohoo's real error/spent responses.
// They only prove we fail closed. Replace with real samples when available.
test('non-ACTIVATED status is not valid (synthetic)', () => {
  for (const status of ['REDEEMED', 'EXPIRED', 'DEACTIVATED', 'WHATEVER']) {
    const v = evaluate(normalizeWoohoo(ok({ ...REAL, status }), CODE), { now: NOW });
    assert.equal(v.valid, false, status);
  }
});

test('issuer error code, HTTP error, empty or malformed body all fail closed (synthetic)', () => {
  const cases = [
    ok({ ...REAL, additionalTxnFields: { responseCode: 5 } }),
    ok({ ...REAL, additionalTxnFields: undefined }),
    ok(REAL, 500),
    ok(null),
    ok('oops'),
    ok({ ...REAL, balance: 'NaN' }),
    undefined,
  ];
  for (const raw of cases) assert.equal(evaluate(normalizeWoohoo(raw, CODE), { now: NOW }).valid, false);
});

test('non-INR currency fails', () => {
  const r = normalizeWoohoo(ok({ ...REAL, currency: { code: 'USD' } }), CODE);
  assert.ok(evaluate(r, { now: NOW }).failures.includes('wrong_currency'));
});
