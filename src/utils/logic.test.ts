import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLevelFromXp,
  calculateQuizScore,
  validateNickname,
  validatePassword,
  checkAchievementEligibility,
  formatDuration,
  parseRoute,
  buildPath,
  isSafeMediaUrl,
  computeDailyStreak,
  pickDailyQuizQuestions,
  resolveServerPort,
  sanitizeStreamingLinks,
  classifyMediaUpload,
} from './logic';

test('calculateLevelFromXp correctly maps XP thresholds to levels and percentages', () => {
  const lvl1 = calculateLevelFromXp(0);
  assert.equal(lvl1.level, 1);
  assert.equal(lvl1.progressPercent, 0);

  const lvl1Mid = calculateLevelFromXp(37);
  assert.equal(lvl1Mid.level, 1);
  assert.ok(lvl1Mid.progressPercent > 0 && lvl1Mid.progressPercent <= 100);

  const lvl2 = calculateLevelFromXp(100);
  assert.equal(lvl2.level, 2);

  const highLvl = calculateLevelFromXp(1000);
  assert.ok(highLvl.level >= 5);
});

test('calculateQuizScore handles questions, accuracy, and speed bonuses', () => {
  const zero = calculateQuizScore(5, 0, 10);
  assert.equal(zero.totalXp, 0);

  const perfectFast = calculateQuizScore(5, 5, 10);
  assert.equal(perfectFast.baseScore, 125);
  // (30 - 10) * 2 * 1 = 40
  assert.equal(perfectFast.speedBonus, 40);
  assert.equal(perfectFast.totalXp, 165);

  const slowQuiz = calculateQuizScore(5, 5, 45);
  assert.equal(slowQuiz.speedBonus, 0);
  assert.equal(slowQuiz.totalXp, 125);
});

test('validateNickname enforces length and characters', () => {
  assert.equal(validateNickname('').valid, false);
  assert.equal(validateNickname('ab').valid, false);
  assert.equal(validateNickname('ValidGothUser').valid, true);
  assert.equal(validateNickname('Апостол_Тьмы').valid, true);
  assert.equal(validateNickname('Bad<script>').valid, false);
});

test('validatePassword requires at least 6 characters', () => {
  assert.equal(validatePassword('12345').valid, false);
  assert.equal(validatePassword('gothic_secret_99').valid, true);
});

test('checkAchievementEligibility unlocks appropriate badges', () => {
  const initial = checkAchievementEligibility({
    totalXp: 0,
    gamesPlayed: 0,
    postsCount: 0,
    creationsCount: 0,
    dailyStreak: 0,
    quizzesWon: 0,
  });
  assert.equal(initial.length, 0);

  const activeUser = checkAchievementEligibility({
    totalXp: 600,
    gamesPlayed: 12,
    postsCount: 6,
    creationsCount: 2,
    dailyStreak: 7,
    quizzesWon: 4,
  });
  assert.ok(activeUser.includes('first_blood'));
  assert.ok(activeUser.includes('initiate_ritual'));
  assert.ok(activeUser.includes('lore_scholar'));
  assert.ok(activeUser.includes('devoted_acolyte'));
  assert.ok(activeUser.includes('eternal_vigil'));
  assert.ok(activeUser.includes('gothic_artisan'));
  assert.ok(activeUser.includes('voice_of_abyss'));
  assert.ok(activeUser.includes('dark_apostle'));
});

test('formatDuration formats seconds to MM:SS correctly', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(5), '0:05');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(215), '3:35');
});

test('parseRoute and buildPath handle all valid SPA routes and 404s', () => {
  assert.deepEqual(parseRoute('/'), { tab: 'home' });
  assert.deepEqual(parseRoute('/archive/'), { tab: 'archive' });
  assert.deepEqual(parseRoute('/games'), { tab: 'games' });
  assert.deepEqual(parseRoute('/community'), { tab: 'community' });
  assert.deepEqual(parseRoute('/creations'), { tab: 'creations' });
  assert.deepEqual(parseRoute('/profile'), { tab: 'profile' });
  assert.deepEqual(parseRoute('/profile/sushkanov097'), { tab: 'profile', profileNickname: 'sushkanov097' });
  assert.deepEqual(parseRoute('/admin'), { tab: 'admin' });
  assert.equal(parseRoute('/unknown-page').notFound, true);
  assert.equal(parseRoute('/profile/a/b').notFound, true);

  assert.equal(buildPath('home'), '/');
  assert.equal(buildPath('archive'), '/archive');
  assert.equal(buildPath('profile', 'sushkanov097'), '/profile/sushkanov097');
});

test('isSafeMediaUrl validates safe paths and blocks XSS schemes', () => {
  assert.equal(isSafeMediaUrl('/uploads/track.mp3'), true);
  assert.equal(isSafeMediaUrl('/audio/crown_of_thorns.wav'), true);
  assert.equal(isSafeMediaUrl('/assets/aistudio/rose.jpg'), true);
  assert.equal(isSafeMediaUrl('https://avatars.yandex.net/cover.jpg'), true);

  assert.equal(isSafeMediaUrl('javascript:alert(1)'), false);
  assert.equal(isSafeMediaUrl('data:text/html,<script>'), false);
  assert.equal(isSafeMediaUrl('/uploads/../secret.db'), false);
  assert.equal(isSafeMediaUrl(''), false);
});

test('computeDailyStreak handles first day, consecutive days, same day, and gaps', () => {
  assert.equal(computeDailyStreak(null, '2026-11-13', 0), 1);
  assert.equal(computeDailyStreak('2026-11-13', '2026-11-13', 3), 3);
  assert.equal(computeDailyStreak('2026-11-12', '2026-11-13', 3), 4);
  assert.equal(computeDailyStreak('2026-11-10', '2026-11-13', 5), 1);
});

test('pickDailyQuizQuestions deterministically selects up to limit questions', () => {
  const pool = Array.from({ length: 8 }, (_, idx) => ({ id: `q_${idx}` }));
  const day1A = pickDailyQuizQuestions(pool, '2026-11-13', 5);
  const day1B = pickDailyQuizQuestions(pool, '2026-11-13', 5);
  const day2 = pickDailyQuizQuestions(pool, '2026-11-14', 5);
  assert.equal(day1A.length, 5);
  assert.deepEqual(day1A, day1B);
  assert.notDeepEqual(day1A.map((q) => q.id), day2.map((q) => q.id));
});

test('resolveServerPort respects CLI flags, avoids NGINX_PORT collision, and preserves PaaS PORT', () => {
  // AI Studio container env: PORT=8080, NGINX_PORT=8080, DEFAULT_APP_PORT=3000
  assert.equal(
    resolveServerPort(['node', 'server.ts', '--port', '3000', '--host', '0.0.0.0'], {
      PORT: '8080',
      NGINX_PORT: '8080',
      DEFAULT_APP_PORT: '3000',
    }),
    3000
  );
  assert.equal(
    resolveServerPort(['node', 'server.ts'], {
      PORT: '8080',
      NGINX_PORT: '8080',
      DEFAULT_APP_PORT: '3000',
    }),
    3000
  );
  // Explicit --port= overrides env
  assert.equal(
    resolveServerPort(['node', 'server.ts', '--port=4123'], { PORT: '5000' }),
    4123
  );
  // Standard PaaS (Render/Railway/Cloud Run) without NGINX_PORT collision
  assert.equal(
    resolveServerPort(['node', 'server.ts'], { PORT: '5050' }),
    5050
  );
  // Empty fallback
  assert.equal(resolveServerPort(['node', 'server.ts'], {}), 3000);
});

test('sanitizeStreamingLinks keeps only safe http/https URLs for allowed platforms', () => {
  const result = sanitizeStreamingLinks({
    spotify: 'https://open.spotify.com/album/123',
    apple_music: 'javascript:alert(1)',
    yandex_music: 'https://music.yandex.ru/album/456',
    unknown_field: 'https://evil.example/x',
    vk_music: '',
  });
  assert.deepEqual(result, {
    spotify: 'https://open.spotify.com/album/123',
    yandex_music: 'https://music.yandex.ru/album/456',
  });
});

test('classifyMediaUpload accepts valid audio/image/video and rejects SVG and executables', () => {
  assert.deepEqual(classifyMediaUpload('track.mp3', 'audio/mpeg'), {
    allowed: true,
    kind: 'audio',
    normalizedExt: '.mp3',
  });
  assert.deepEqual(classifyMediaUpload('master.WAVE', 'audio/wav'), {
    allowed: true,
    kind: 'audio',
    normalizedExt: '.wav',
  });
  assert.deepEqual(classifyMediaUpload('cover.webp', 'image/webp'), {
    allowed: true,
    kind: 'image',
    normalizedExt: '.webp',
  });
  assert.deepEqual(classifyMediaUpload('edit.mp4', 'video/mp4'), {
    allowed: true,
    kind: 'video',
    normalizedExt: '.mp4',
  });
  // Security: reject SVG (active script risk), HTML, JS, PHP
  assert.equal(classifyMediaUpload('payload.svg', 'image/svg+xml').allowed, false);
  assert.equal(classifyMediaUpload('shell.html', 'text/html').allowed, false);
  assert.equal(classifyMediaUpload('script.js', 'application/javascript').allowed, false);
});



