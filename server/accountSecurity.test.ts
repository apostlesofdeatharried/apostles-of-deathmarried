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
  ACHIEVEMENT_CATALOG,
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

test('ACHIEVEMENT_CATALOG preserves all 35 legacy slugs and enforces 3-tier balance (52 total)', () => {
  assert.ok(ACHIEVEMENT_CATALOG.length >= 45, `Expected >= 45 achievements, got ${ACHIEVEMENT_CATALOG.length}`);
  assert.equal(ACHIEVEMENT_CATALOG.length, 52);

  const ids = new Set<string>();
  const slugs = new Set<string>();
  const byTier: Record<'easy' | 'medium' | 'hard', number> = { easy: 0, medium: 0, hard: 0 };

  for (const a of ACHIEVEMENT_CATALOG) {
    assert.ok(!ids.has(a.id), `Duplicate achievement id: ${a.id}`);
    assert.ok(!slugs.has(a.slug), `Duplicate achievement slug: ${a.slug}`);
    ids.add(a.id);
    slugs.add(a.slug);
    assert.ok(a.difficulty_tier === 'easy' || a.difficulty_tier === 'medium' || a.difficulty_tier === 'hard');
    byTier[a.difficulty_tier] += 1;

    if (a.slug === 'archive_initiate') {
      assert.equal(a.xp_reward, 0, 'Starter archive_initiate must stay 0 XP for clean 0-XP registration');
    } else if (a.difficulty_tier === 'easy') {
      assert.ok(a.xp_reward >= 10 && a.xp_reward <= 25, `Easy ${a.slug} XP out of 10-25: ${a.xp_reward}`);
    } else if (a.difficulty_tier === 'medium') {
      assert.ok(a.xp_reward >= 50 && a.xp_reward <= 150, `Medium ${a.slug} XP out of 50-150: ${a.xp_reward}`);
    } else if (a.difficulty_tier === 'hard') {
      assert.ok(a.xp_reward >= 250 && a.xp_reward <= 800, `Hard ${a.slug} XP out of 250-800: ${a.xp_reward}`);
    }
  }

  assert.equal(byTier.easy, 16);
  assert.equal(byTier.medium, 19);
  assert.equal(byTier.hard, 17);

  // Every single one of the 35 legacy slugs must remain present
  const legacySlugs = [
    'archive_initiate', 'shadow_identity', 'first_blood', 'first_note', 'quiz_seeker',
    'devoted_acolyte', 'collector', 'first_chronicle', 'easy_first_reply', 'midnight_critic',
    'easy_avid_reader', 'gothic_artisan', 'coven_circle', 'dressed_in_velvet', 'vinyl_hunter',
    'phantom_ear', 'initiate_ritual', 'ritual_master', 'lore_scholar', 'obsidian_oracle',
    'cathedral_historian', 'eternal_vigil', 'midnight_devotion', 'immortal_flame', 'relic_hoarder',
    'gothic_treasury', 'voice_of_abyss', 'hard_community_reader', 'dark_apostle', 'archon_of_sound',
    'secret_midnight_visitor', 'secret_on_repeat', 'secret_curious_rose', 'secret_first_code', 'secret_flawless_quiz',
  ];
  for (const leg of legacySlugs) {
    assert.ok(slugs.has(leg), `Missing legacy achievement slug: ${leg}`);
  }
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
    gamesPlayed: 25,
    guessTrackPlayed: 18,
    guessTrackWins: 16,
    guessLyricsWins: 5,
    reverseTrackWins: 5,
    speedTrackWins: 5,
    quizPlayed: 10,
    quizWins: 5,
    quizPerfectRuns: 5,
    dailyStreak: 30,
    totalXp: 3600,
    level: 10,
    purchasesCount: 15,
    equippedItemsCount: 4,
    postsCount: 5,
    approvedPostsCount: 5,
    commentsCount: 12,
    creationsCount: 2,
    approvedCreationsCount: 2,
    creationRosesTotal: 12,
    followersCount: 5,
    followingCount: 4,
    postsReadCount: 3,
    promoRedeemedCount: 1,
    maxTrackCompletions: 4,
    uniqueTracksListened: 3,
    visitedMidnightMsk: true,
    clickedSecretRose: true,
    lyricsOpenedCount: 12,
    shareCardCount: 1,
    totalGameWins: 36,
    distinctGamesPlayed: 5,
    distinctGamesWon: 5,
    bestGameWinStreak: 11,
  });
  assert.ok(veteran.includes('first_listen'));
  assert.ok(veteran.includes('lyrics_reader'));
  assert.ok(veteran.includes('archive_completionist'));
  assert.ok(veteran.includes('discography_listener'));
  assert.ok(veteran.includes('secret_on_repeat'));
  assert.ok(veteran.includes('grand_champion'));
  assert.ok(veteran.includes('share_card_first'));
  assert.ok(veteran.includes('all_games_explorer'));
  assert.ok(veteran.includes('all_games_winner'));
  assert.ok(veteran.includes('win_streak_5'));
  assert.ok(veteran.includes('win_streak_10'));
  assert.ok(veteran.includes('creation_idol'));
  assert.ok(veteran.includes('meta_collector_20'));
  assert.ok(veteran.includes('meta_legend_35'));
  assert.equal(veteran.length, 52);

  // Verify numeric progress reporting
  const partialMetrics = {
    isRegistered: true,
    gamesPlayed: 3,
    guessTrackPlayed: 2,
    guessTrackWins: 2,
    reverseTrackWins: 1,
    speedTrackWins: 1,
    quizPlayed: 1,
    quizWins: 1,
    quizPerfectRuns: 0,
    dailyStreak: 2,
    totalXp: 300,
    level: 2,
    purchasesCount: 1,
    equippedItemsCount: 1,
    postsCount: 0,
    commentsCount: 0,
    creationsCount: 0,
    followersCount: 0,
    followingCount: 0,
    lyricsOpenedCount: 4,
    bestGameWinStreak: 3,
    uniqueTracksListened: 2,
  };
  assert.deepEqual(getAchievementProgress('secret_on_repeat', partialMetrics, false), { current: 6, target: 9 });
  assert.deepEqual(getAchievementProgress('win_streak_5', partialMetrics, false), { current: 3, target: 5 });
  assert.deepEqual(getAchievementProgress('discography_listener', partialMetrics, false), { current: 2, target: 3 });
  assert.deepEqual(getAchievementProgress('archive_completionist', partialMetrics, false), { current: 4, target: 12 });
  assert.deepEqual(getAchievementProgress('meta_collector_20', partialMetrics, false), { current: 7, target: 20 });
});


