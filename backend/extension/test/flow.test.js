const test = require('node:test');
const assert = require('node:assert/strict');
const { isCheckPage, shouldReturnToCheck } = require('../src/flow.js');

test('isCheckPage', () => {
  assert.equal(isCheckPage('https://www.woohoo.in/profile/check-balance'), true);
  assert.equal(isCheckPage('https://woohoo.in/profile/check-balance?x=1'), true);
  assert.equal(isCheckPage('https://www.woohoo.in/login'), false);
  assert.equal(isCheckPage('https://evil.com/profile/check-balance'), false);
  assert.equal(isCheckPage('https://woohoo.in.evil.com/profile/check-balance'), false);
  assert.equal(isCheckPage('not a url'), false);
});

test('shouldReturnToCheck: stays put on login/OTP steps, returns once logged in', () => {
  const loginPath = '/login';
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/login', loginPath), false);
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/login/otp', loginPath), false);
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/verify-otp', loginPath), false);
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/', loginPath), true);
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/profile', loginPath), true);
});

test('shouldReturnToCheck: never from the same landing path, other sites, or the check page', () => {
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/welcome', '/welcome'), false);
  assert.equal(shouldReturnToCheck('https://evil.com/', '/login'), false);
  assert.equal(shouldReturnToCheck('https://www.woohoo.in/profile/check-balance', '/login'), false);
  assert.equal(shouldReturnToCheck('garbage', '/login'), false);
});
