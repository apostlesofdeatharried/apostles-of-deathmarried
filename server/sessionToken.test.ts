import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSessionSecret,
  signSessionToken,
  verifySessionToken,
  isSignedSessionToken,
} from './sessionToken.js';

test('resolveSessionSecret is deterministic across serverless cold starts and prefers SESSION_SECRET', () => {
  const explicit = resolveSessionSecret({
    SESSION_SECRET: 'super_stable_production_secret_32chars',
    SUPABASE_SERVICE_ROLE_KEY: 'ignored_when_session_secret_present',
  });
  assert.equal(explicit, 'super_stable_production_secret_32chars');

  const fromSupabaseA = resolveSessionSecret({
    SUPABASE_SERVICE_ROLE_KEY: 'service_role_key_example_1234567890',
  });
  const fromSupabaseB = resolveSessionSecret({
    SUPABASE_SERVICE_ROLE_KEY: 'service_role_key_example_1234567890',
  });
  assert.equal(fromSupabaseA, fromSupabaseB);
  assert.notEqual(fromSupabaseA, 'service_role_key_example_1234567890');

  const fallbackA = resolveSessionSecret({ APP_URL: 'https://apostlesofdeathmarried.ru' });
  const fallbackB = resolveSessionSecret({ APP_URL: 'https://apostlesofdeathmarried.ru' });
  assert.equal(fallbackA, fallbackB);
});

test('signSessionToken and verifySessionToken round-trip validly and reject tampering/expiry', () => {
  const secret = resolveSessionSecret({ SESSION_SECRET: 'test_secret_key_for_hmac_verification' });
  const nowMs = 1_700_000_000_000;
  const { token } = signSessionToken(
    {
      sid: 'ses_abc123',
      uid: 'usr_admin',
      nick: 'sushkanov097',
      role: 'admin',
      ttlMs: 3600 * 1000,
    },
    secret,
    nowMs
  );

  assert.equal(isSignedSessionToken(token), true);
  assert.equal(isSignedSessionToken('deadbeef1234'), false);

  const verified = verifySessionToken(token, secret, Math.floor(nowMs / 1000) + 10);
  assert.ok(verified);
  assert.equal(verified.sid, 'ses_abc123');
  assert.equal(verified.uid, 'usr_admin');
  assert.equal(verified.nick, 'sushkanov097');
  assert.equal(verified.role, 'admin');

  // Expired token rejected
  assert.equal(verifySessionToken(token, secret, Math.floor(nowMs / 1000) + 7200), null);

  // Wrong secret rejected
  assert.equal(verifySessionToken(token, 'different_secret_key_that_does_not_match', Math.floor(nowMs / 1000) + 10), null);

  // Tampered payload rejected
  const parts = token.split('.');
  const fakePayload = Buffer.from(
    JSON.stringify({ sid: 'ses_abc123', uid: 'usr_hacker', nick: 'sushkanov097', role: 'admin', iat: 0, exp: 9999999999 }),
    'utf8'
  ).toString('base64url');
  assert.equal(verifySessionToken(`${parts[0]}.${fakePayload}.${parts[2]}`, secret, Math.floor(nowMs / 1000) + 10), null);
});
