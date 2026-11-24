import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUsername,
  validateUsername,
  validateDisplayName,
  validateEmail,
  validateRegistrationPassword,
  computeLoginLockout,
  isAccountLocked,
  canChangeUsername,
  isSameOriginRequest,
  generateVerificationCode,
  hashVerificationCode,
  createSignedEmailVerificationToken,
  verifySignedEmailVerificationToken,
  normalizePromoCode,
  evaluateAchievementSlugs,
  getAchievementProgress,
} from './accountSecurity';

test('normalizeUsername and validateUsername enforce clean unique handles', () => {
  assert.equal(normalizeUsername('  @Night_Wolf  '), 'night_wolf');
  assert.equal(validateUsername('@apostle_01').valid, true);
  assert.equal(validateUsername('@apostle_01').normalized, 'apostle_01');
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('admin').valid, false);
  assert.equal(validateUsername('bad user!').valid, false);
  assert.equal(validateUsername('_leading').valid, false);
  assert.equal(validateUsername('a'.repeat(21)).valid, false);
});

test('validateDisplayName allows expressive names and blocks XSS/control chars', () => {
  const ok = validateDisplayName('  Shadow   Rose  ');
  assert.equal(ok.valid, true);
  assert.equal(ok.normalized, 'Shadow Rose');
  assert.equal(validateDisplayName('Апостол Ночи').valid, true);
  assert.equal(validateDisplayName('A').valid, false);
  assert.equal(validateDisplayName('<script>alert(1)</script>').valid, false);
  assert.equal(validateDisplayName('x'.repeat(37)).valid, false);
});

test('validateEmail normalizes and validates email addresses', () => {
  const valid = validateEmail('  User.Name+tag@Example.RU  ');
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized, 'user.name+tag@example.ru');
  assert.equal(validateEmail('not-an-email').valid, false);
  assert.equal(validateEmail('missing@domain').valid, false);
  assert.equal(validateEmail('').valid, false);
});

test('validateRegistrationPassword enforces min length and confirmation match', () => {
  assert.equal(validateRegistrationPassword('12345', '12345').valid, false);
  assert.equal(validateRegistrationPassword('secret123', 'different').valid, false);
  assert.equal(validateRegistrationPassword('secret123', 'secret123').valid, true);
});

test('computeLoginLockout and isAccountLocked enforce brute-force protection', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const attempt4 = computeLoginLockout(4, now);
  assert.equal(attempt4.shouldLock, false);
  assert.equal(attempt4.remainingAttempts, 1);

  const attempt5 = computeLoginLockout(5, now);
  assert.equal(attempt5.shouldLock, true);
  assert.equal(attempt5.lockoutMinutes, 15);
  assert.ok(attempt5.lockedUntil);

  const lockState = isAccountLocked(attempt5.lockedUntil, now + 60_000);
  assert.equal(lockState.locked, true);
  assert.ok(lockState.retryAfterSeconds > 800);

  const expiredLock = isAccountLocked(attempt5.lockedUntil, now + 16 * 60_000);
  assert.equal(expiredLock.locked, false);
});

test('canChangeUsername enforces 14-day cooldown', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  assert.equal(canChangeUsername(null, now).allowed, true);

  const recent = canChangeUsername('2026-11-18T12:00:00Z', now);
  assert.equal(recent.allowed, false);
  assert.equal(recent.remainingDays, 10);

  const old = canChangeUsername('2026-11-01T12:00:00Z', now);
  assert.equal(old.allowed, true);
});

test('isSameOriginRequest validates Origin/Referer against Host', () => {
  assert.equal(
    isSameOriginRequest('https://apostlesofdeathmarried.ru', undefined, 'apostlesofdeathmarried.ru'),
    true
  );
  assert.equal(
    isSameOriginRequest('https://evil.example.com', undefined, 'apostlesofdeathmarried.ru'),
    false
  );
  assert.equal(
    isSameOriginRequest(undefined, 'http://localhost:3000/profile', 'localhost:3000'),
    true
  );
});

test('verification code hashing never stores plaintext codes', () => {
  const code = generateVerificationCode();
  assert.match(code, /^\d{6}$/);
  const h1 = hashVerificationCode(code, 'user_1');
  const h2 = hashVerificationCode(code, 'user_1');
  assert.equal(h1, h2);
  assert.notEqual(h1, code);
  assert.equal(h1.length, 64);
});

test('stateless HMAC email verification tokens validate email, code, purpose, userId, and TTL', () => {
  const secret = 'test-session-secret-0123456789abcdef';
  const now = Date.parse('2026-11-23T10:00:00Z');
  const signed = createSignedEmailVerificationToken('Listener@Example.RU', '482910', 'register', secret, null, now);
  assert.ok(signed.verification_token.startsWith('ev1.'));

  // Valid check (case-insensitive email)
  assert.equal(
    verifySignedEmailVerificationToken(signed.verification_token, 'listener@example.ru', '482910', 'register', secret, null, now + 60_000).valid,
    true
  );
  // Wrong 6-digit code
  assert.equal(
    verifySignedEmailVerificationToken(signed.verification_token, 'listener@example.ru', '999999', 'register', secret, null, now + 60_000).valid,
    false
  );
  // Changed email
  assert.equal(
    verifySignedEmailVerificationToken(signed.verification_token, 'other@example.ru', '482910', 'register', secret, null, now + 60_000).valid,
    false
  );
  // Wrong purpose
  assert.equal(
    verifySignedEmailVerificationToken(signed.verification_token, 'listener@example.ru', '482910', 'verify_existing', secret, null, now + 60_000).valid,
    false
  );
  // Expired (> 10 minutes)
  assert.equal(
    verifySignedEmailVerificationToken(signed.verification_token, 'listener@example.ru', '482910', 'register', secret, null, now + 11 * 60_000).valid,
    false
  );
  // Tampered signature
  assert.equal(
    verifySignedEmailVerificationToken(signed.verification_token + 'x', 'listener@example.ru', '482910', 'register', secret, null, now + 60_000).valid,
    false
  );
  // Existing user binding check
  const existingSigned = createSignedEmailVerificationToken('old@example.ru', '123456', 'verify_existing', secret, 'usr_123', now);
  assert.equal(
    verifySignedEmailVerificationToken(existingSigned.verification_token, 'old@example.ru', '123456', 'verify_existing', secret, 'usr_123', now + 1000).valid,
    true
  );
  assert.equal(
    verifySignedEmailVerificationToken(existingSigned.verification_token, 'old@example.ru', '123456', 'verify_existing', secret, 'usr_other', now + 1000).valid,
    false
  );
  // Promo normalization
  assert.equal(normalizePromoCode('  APOSTLES  '), 'apostles');
  assert.equal(normalizePromoCode('DeathMarried'), 'deathmarried');
});

test('evaluateAchievementSlugs unlocks server-authoritative achievements accurately', () => {
  const fresh = evaluateAchievementSlugs({
    isRegistered: true,
    gamesPlayed: 0,
    guessTrackPlayed: 0,
    guessTrackWins: 0,
    quizPlayed: 0,
    quizPerfectRuns: 0,
    dailyStreak: 0,
    totalXp: 0,
    level: 1,
    purchasesCount: 0,
    equippedItemsCount: 0,
    postsCount: 0,
    commentsCount: 0,
    creationsCount: 0,
    followersCount: 0,
    followingCount: 0,
  });
  assert.deepEqual(fresh, ['archive_initiate']);

  const veteran = evaluateAchievementSlugs({
    isRegistered: true,
    hasCustomProfile: true,
    gamesPlayed: 32,
    guessTrackPlayed: 18,
    guessTrackWins: 16,
    quizPlayed: 12,
    quizPerfectRuns: 4,
    dailyStreak: 30,
    totalXp: 1800,
    level: 9,
    purchasesCount: 10,
    equippedItemsCount: 4,
    postsCount: 4,
    commentsCount: 8,
    creationsCount: 2,
    followersCount: 5,
    followingCount: 4,
    postsReadCount: 25,
    promoRedeemedCount: 1,
    maxTrackCompletions: 10,
    visitedMidnightMsk: true,
    clickedSecretRose: true,
  });
  assert.ok(veteran.includes('first_note'));
  assert.ok(veteran.includes('phantom_ear'));
  assert.ok(veteran.includes('obsidian_oracle'));
  assert.ok(veteran.includes('immortal_flame'));
  assert.ok(veteran.includes('gothic_treasury'));
  assert.ok(veteran.includes('dressed_in_velvet'));
  assert.ok(veteran.includes('archon_of_sound'));
  // New community & secret easter egg achievements
  assert.ok(veteran.includes('easy_first_reply'));
  assert.ok(veteran.includes('easy_avid_reader'));
  assert.ok(veteran.includes('hard_community_reader'));
  assert.ok(veteran.includes('secret_midnight_visitor'));
  assert.ok(veteran.includes('secret_on_repeat'));
  assert.ok(veteran.includes('secret_curious_rose'));
  assert.ok(veteran.includes('secret_first_code'));
  assert.ok(veteran.includes('secret_flawless_quiz'));
  assert.equal(veteran.length, 35);

  // Verify numeric progress reporting
  const prog = getAchievementProgress(
    'secret_on_repeat',
    {
      isRegistered: true,
      gamesPlayed: 0,
      guessTrackPlayed: 0,
      guessTrackWins: 0,
      quizPlayed: 0,
      quizPerfectRuns: 0,
      dailyStreak: 0,
      totalXp: 0,
      level: 1,
      purchasesCount: 0,
      equippedItemsCount: 0,
      postsCount: 0,
      commentsCount: 0,
      creationsCount: 0,
      followersCount: 0,
      followingCount: 0,
      maxTrackCompletions: 7,
    },
    false
  );
  assert.deepEqual(prog, { current: 7, target: 10 });
});

