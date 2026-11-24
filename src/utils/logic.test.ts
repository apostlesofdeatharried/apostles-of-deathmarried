import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLevelFromXp,
  getQuizQuestionXp,
  calculateQuizScoreByDifficulty,
  calculateQuizScore,
  calculateMiniGameXp,
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
  transliterateToAsciiSlug,
  buildSafeAsciiFilename,
  getMoscowDateString,
  isMoscowMidnightWindow,
  getStreakBonusPercent,
  applyStreakBonusXp,
  parsePrivacySettings,
  formatXpTransactionLabel,
  sanitizeCssColor,
  buildCustomShieldValue,
  parseCustomShieldValue,
} from './logic';

test('calculateLevelFromXp maps balanced XP thresholds smoothly without multi-level jumps', () => {
  const lvl1 = calculateLevelFromXp(0);
  assert.equal(lvl1.level, 1);
  assert.equal(lvl1.progressPercent, 0);
  assert.equal(lvl1.nextLevelXp, 100);

  const lvl1Mid = calculateLevelFromXp(50);
  assert.equal(lvl1Mid.level, 1);
  assert.equal(lvl1Mid.progressPercent, 50);

  const lvl2 = calculateLevelFromXp(100);
  assert.equal(lvl2.level, 2);

  // One strong quiz (75-95 XP) from 0 XP should not jump straight past Level 2
  const afterOneQuiz = calculateLevelFromXp(85);
  assert.equal(afterOneQuiz.level, 1);

  const lvl3 = calculateLevelFromXp(305);
  assert.equal(lvl3.level, 3);

  const highLvl = calculateLevelFromXp(1000);
  assert.equal(highLvl.level, 5);
});

test('Daily Quiz difficulty XP (10/15/25) and mini-game rewards (15-20 XP) are balanced', () => {
  assert.equal(getQuizQuestionXp(1), 10);
  assert.equal(getQuizQuestionXp(2), 15);
  assert.equal(getQuizQuestionXp(3), 25);

  const byDiff = calculateQuizScoreByDifficulty([
    { isCorrect: true, difficulty: 1 },
    { isCorrect: true, difficulty: 2 },
    { isCorrect: false, difficulty: 3 },
    { isCorrect: true, difficulty: 3 },
  ]);
  assert.equal(byDiff.totalXp, 50); // 10 + 15 + 25
  assert.equal(byDiff.speedBonus, 0);

  const zero = calculateQuizScore(5, 0, 10);
  assert.equal(zero.totalXp, 0);

  const balanced = calculateQuizScore(5, 5, 10);
  assert.equal(balanced.baseScore, 75);
  assert.equal(balanced.speedBonus, 0);
  assert.equal(balanced.totalXp, 75);

  // Mini-games: 15-20 XP on win, 5 XP on participation
  assert.equal(calculateMiniGameXp(false, 5), 5);
  assert.equal(calculateMiniGameXp(true, 0), 15);
  assert.equal(calculateMiniGameXp(true, 3), 18);
  assert.equal(calculateMiniGameXp(true, 10), 20);
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

test('transliterateToAsciiSlug and buildSafeAsciiFilename produce strictly ASCII Supabase-safe keys', () => {
  assert.equal(transliterateToAsciiSlug('с мёртвыми (финал) #1!'), 's_myortvymi_final_1');
  assert.equal(transliterateToAsciiSlug('Любовью<3'), 'lyubovyu_3');
  assert.equal(transliterateToAsciiSlug('🖤🔥   ???'), 'media');

  const f1 = buildSafeAsciiFilename('с мёртвыми (master v2).mp3', 'audio/mpeg', 1700000000001, 'a1b2c3d4');
  const f2 = buildSafeAsciiFilename('с мёртвыми (master v2).mp3', 'audio/mpeg', 1700000000002, 'e5f60718');
  assert.equal(f1, '1700000000001_s_myortvymi_master_v2_a1b2c3d4.mp3');
  assert.notEqual(f1, f2);
  assert.match(f1, /^[0-9]+_[a-z0-9_-]+_[a-z0-9]+\.[a-z0-9]+$/);

  const fWave = buildSafeAsciiFilename('Любовью <3 [24-bit].WAVE', 'audio/wav', 1700000000003, 'deadbeef');
  assert.equal(fWave, '1700000000003_lyubovyu_3_24-bit_deadbeef.wav');
  assert.match(fWave, /^[\x20-\x7E]+$/);
});

test('Moscow date & midnight window (00:00-00:15 MSK, UTC+3) evaluate accurately', () => {
  // 2026-11-22T21:05:00Z === 2026-11-23 00:05 MSK
  const insideMskMidnight = Date.parse('2026-11-22T21:05:00Z');
  assert.equal(getMoscowDateString(insideMskMidnight), '2026-11-23');
  assert.equal(isMoscowMidnightWindow(insideMskMidnight), true);

  // 2026-11-22T21:15:59Z === 2026-11-23 00:15:59 MSK (still within 00:00-00:15)
  assert.equal(isMoscowMidnightWindow(Date.parse('2026-11-22T21:15:59Z')), true);

  // 2026-11-22T21:16:00Z === 2026-11-23 00:16 MSK (outside window)
  assert.equal(isMoscowMidnightWindow(Date.parse('2026-11-22T21:16:00Z')), false);

  // 2026-11-22T20:59:59Z === 2026-11-22 23:59:59 MSK (previous Moscow day, outside window)
  assert.equal(getMoscowDateString(Date.parse('2026-11-22T20:59:59Z')), '2026-11-22');
  assert.equal(isMoscowMidnightWindow(Date.parse('2026-11-22T20:59:59Z')), false);
});

test('Daily streak bonus grants +5% per day capped at +50%', () => {
  assert.equal(getStreakBonusPercent(0), 0);
  assert.equal(getStreakBonusPercent(1), 5);
  assert.equal(getStreakBonusPercent(5), 25);
  assert.equal(getStreakBonusPercent(10), 50);
  assert.equal(getStreakBonusPercent(25), 50);

  assert.deepEqual(applyStreakBonusXp(20, 0), { totalXp: 20, bonusXp: 0, bonusPercent: 0 });
  assert.deepEqual(applyStreakBonusXp(20, 5), { totalXp: 25, bonusXp: 5, bonusPercent: 25 });
  assert.deepEqual(applyStreakBonusXp(100, 12), { totalXp: 150, bonusXp: 50, bonusPercent: 50 });
});

test('parsePrivacySettings defaults XP history to hidden and safely merges overrides', () => {
  assert.deepEqual(parsePrivacySettings(null), {
    hide_community: false,
    hide_streak: false,
    hide_xp_history: true,
    hide_game_stats: false,
  });

  assert.deepEqual(
    parsePrivacySettings(JSON.stringify({ hide_xp_history: false, hide_community: true, hide_streak: 'invalid' })),
    {
      hide_community: true,
      hide_streak: false,
      hide_xp_history: false,
      hide_game_stats: false,
    }
  );
});

test('formatXpTransactionLabel translates legacy English and current entries to Russian', () => {
  assert.deepEqual(formatXpTransactionLabel('guess_track', 'Guess Track (2026-11-22-H0): Correct', 'ru'), {
    title: 'Угадай трек',
    subtitle: 'Верный ответ',
  });
  assert.deepEqual(formatXpTransactionLabel('guess_track', 'Guess Track (2026-11-22-H0): Participation', 'ru'), {
    title: 'Угадай трек',
    subtitle: 'Участие в раунде',
  });
  assert.deepEqual(formatXpTransactionLabel('daily_quiz', 'Daily Quiz (2026-11-22): 4/5', 'ru'), {
    title: 'Ежедневная викторина',
    subtitle: 'Результат: 4/5',
  });
  assert.deepEqual(formatXpTransactionLabel('community_post', 'Created post: Ночной релиз', 'ru'), {
    title: 'Новая тема в сообществе',
    subtitle: 'Ночной релиз',
  });
  assert.deepEqual(formatXpTransactionLabel('comment', 'Posted a comment', 'ru'), {
    title: 'Комментарий в сообществе',
    subtitle: 'Ответ в обсуждении',
  });
  assert.deepEqual(formatXpTransactionLabel('promo_code', 'Промокод «APOSTLES»', 'ru'), {
    title: 'Промокод',
    subtitle: 'Промокод «APOSTLES»',
  });
  assert.deepEqual(formatXpTransactionLabel('meme_upload', 'Мем «Night»', 'ru'), {
    title: 'Публикация мема',
    subtitle: 'Мем «Night»',
  });
  assert.deepEqual(formatXpTransactionLabel('xp_rollback', 'Откат XP при удалении публикации', 'ru'), {
    title: 'Откат XP при удалении/отклонении',
    subtitle: 'Откат XP при удалении публикации',
  });
});

test('sanitizeCssColor allows valid hex/rgb/rgba colors and blocks unsafe CSS expressions', () => {
  assert.equal(sanitizeCssColor('#821c2c', '#000000'), '#821c2c');
  assert.equal(sanitizeCssColor('#abc', '#000000'), '#abc');
  assert.equal(sanitizeCssColor('rgb(12, 34, 56)', '#000000'), 'rgb(12, 34, 56)');
  assert.equal(sanitizeCssColor('rgba(130, 28, 44, 0.45)', '#000000'), 'rgba(130, 28, 44, 0.45)');

  assert.equal(sanitizeCssColor('url(javascript:alert(1))', '#111111'), '#111111');
  assert.equal(sanitizeCssColor('red; position:fixed', '#111111'), '#111111');
  assert.equal(sanitizeCssColor('expression(alert(1))', '#111111'), '#111111');
  assert.equal(sanitizeCssColor('', '#111111'), '#111111');
});

test('buildCustomShieldValue and parseCustomShieldValue round-trip safely and reject malformed inputs', () => {
  const encoded = buildCustomShieldValue({
    ru: 'тёмный хранитель',
    en: 'dark warden',
    bg: '#220d14',
    border: '#962a3d',
    text: '#f2bcc6',
    glow: 'rgba(130, 28, 44, 0.4)',
  });
  assert.ok(encoded.startsWith('cshield:'));

  const parsed = parseCustomShieldValue(encoded);
  assert.deepEqual(parsed, {
    ru: 'тёмный хранитель',
    en: 'dark warden',
    bg: '#220d14',
    border: '#962a3d',
    text: '#f2bcc6',
    glow: 'rgba(130, 28, 44, 0.4)',
  });

  // Malicious color values inside cshield payload should fall back to safe defaults
  const sanitized = parseCustomShieldValue(
    'cshield:' +
      JSON.stringify({
        ru: 'Тест',
        en: 'Test',
        bg: 'url(https://evil.example/x)',
        border: 'red;content:"x"',
        text: '#ffffff',
        glow: 'expression(1)',
      })
  );
  assert.ok(sanitized);
  assert.equal(sanitized?.ru, 'Тест');
  assert.equal(sanitized?.text, '#ffffff');
  assert.notEqual(sanitized?.bg, 'url(https://evil.example/x)');
  assert.notEqual(sanitized?.border, 'red;content:"x"');

  assert.equal(parseCustomShieldValue('shield_apostol'), null);
  assert.equal(parseCustomShieldValue('cshield:{broken json'), null);
  assert.equal(parseCustomShieldValue(null), null);
});



