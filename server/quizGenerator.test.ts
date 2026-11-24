import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDiscographyQuizQuestions } from './quizGenerator.js';
import {
  getUtc12HourSlot,
  isValidUtc12HourSlot,
  getNextUtc12HourResetIso,
  shuffleQuizQuestionOptions,
  parseAndValidateQuizQuestion,
} from './dailyGames.js';
import {
  createSignedCaptcha,
  verifySignedCaptcha,
  parseBulkQuizInput,
  hashGuardIdentifier,
} from './accountSecurity.js';

const SAMPLE_ALBUMS = [
  { id: 'alb_nightmortan', title: 'nightmortan', release_year: 2025, release_date: '2025-10-10', format_type: 'album' },
  { id: 'ep_pumpkin', title: 'YOU COULD BE PUMPKIN', release_year: 2024, release_date: '2024-12-01', format_type: 'ep' },
  { id: 'ep_murda', title: 'MURDA M', release_year: 2024, release_date: '2024-04-15', format_type: 'ep' },
];

const SAMPLE_TRACKS = [
  { id: 't1', album_id: 'alb_nightmortan', title: 'twilight', track_number: 1, duration_seconds: 132, lyrics: 'shadows stretch across the cathedral floor\nwhispers echoing beneath the heavy iron door' },
  { id: 't2', album_id: 'alb_nightmortan', title: 'edward scissorhands', track_number: 2, duration_seconds: 144, lyrics: 'cold blades, quiet hands in the dead of night' },
  { id: 't3', album_id: 'alb_nightmortan', title: 'cross pirouette', track_number: 3, duration_seconds: 128, lyrics: 'velvet threads unspooling in silence' },
  { id: 't4', album_id: 'alb_nightmortan', title: 'the last violin', track_number: 4, duration_seconds: 162, lyrics: 'final bow strokes fading into absolute stillness' },
  { id: 'p1', album_id: 'ep_pumpkin', title: 'с мёртвыми', track_number: 1, duration_seconds: 105, lyrics: 'Track from YOU COULD BE PUMPKIN EP.' },
  { id: 'p2', album_id: 'ep_pumpkin', title: 'Chery Tiggo', track_number: 2, duration_seconds: 151, lyrics: 'Track from YOU COULD BE PUMPKIN EP.' },
  { id: 'p3', album_id: 'ep_pumpkin', title: 'Estate', track_number: 3, duration_seconds: 124, lyrics: 'Track from YOU COULD BE PUMPKIN EP.' },
  { id: 'p4', album_id: 'ep_pumpkin', title: 'DJ Pumpkin', track_number: 4, duration_seconds: 120, lyrics: 'Track from YOU COULD BE PUMPKIN EP.' },
  { id: 'm1', album_id: 'ep_murda', title: 'НИКТО НЕ ХОЧЕТ', track_number: 1, duration_seconds: 125, lyrics: 'Archived canon track from MURDA M.' },
  { id: 'm2', album_id: 'ep_murda', title: 'Гриффины', track_number: 2, duration_seconds: 118, lyrics: 'Archived canon track from MURDA M.' },
  { id: 'm3', album_id: 'ep_murda', title: 'MURDA M', track_number: 3, duration_seconds: 132, lyrics: 'Archived canon track from MURDA M.' },
];

const SAMPLE_SINGLES = [
  { id: 's1', title: 'athens', release_year: 2026, release_date: '2026-06-01', duration_seconds: 142 },
  { id: 's2', title: 'satn', release_year: 2025, release_date: '2025-03-28', duration_seconds: 135 },
  { id: 's3', title: 'sexisdeath', release_year: 2025, release_date: '2025-01-24', duration_seconds: 128 },
  { id: 's4', title: '#YETIRAPER', release_year: 2024, release_date: '2024-05-20', duration_seconds: 130 },
  { id: 's5', title: 'SWAG FROM OHIO', release_year: 2023, release_date: '2023-11-12', duration_seconds: 134 },
];

test('generateDiscographyQuizQuestions builds large 100% factual pool with zero fabricated facts or placeholder lyrics', () => {
  const pool = generateDiscographyQuizQuestions({
    albums: SAMPLE_ALBUMS,
    tracks: SAMPLE_TRACKS,
    singles: SAMPLE_SINGLES,
    secret: 'test-secret',
  });

  assert.ok(pool.length >= 35, `Expected large factual pool (>=35), got ${pool.length}`);

  for (const raw of pool) {
    const valid = parseAndValidateQuizQuestion(raw);
    assert.ok(valid, `Generated question ${raw.id} failed validation`);
    assert.equal(valid!.options.length, 4, `Question ${raw.id} should have 4 options`);
    const uniqueOpts = new Set(valid!.options.map((o) => o.toLowerCase()));
    assert.equal(uniqueOpts.size, 4, `Question ${raw.id} has duplicate options`);
    const combinedText = `${valid!.question_ru} ${valid!.explanation_ru} ${valid!.options.join(' ')}`.toLowerCase();
    assert.ok(!combinedText.includes('нью-джаз'), 'Must never mention fabricated new-jazz');
    assert.ok(!combinedText.includes('track from you could be pumpkin'), 'Must filter placeholder lyrics');
    assert.ok(!combinedText.includes('archived canon track'), 'Must filter archived placeholder lyrics');
  }

  // Should generate real lyric questions from nightmortan
  assert.ok(pool.some((q) => q.id.startsWith('gen_trk_lyric_')), 'Should generate real lyric questions');
});

test('shuffleQuizQuestionOptions uses Fisher-Yates to distribute correct_index uniformly and preserve answer text', () => {
  const pool = generateDiscographyQuizQuestions({
    albums: SAMPLE_ALBUMS,
    tracks: SAMPLE_TRACKS,
    singles: SAMPLE_SINGLES,
    secret: 'test-secret',
  });

  const positions = new Set<number>();
  for (const raw of pool) {
    const valid = parseAndValidateQuizQuestion(raw)!;
    const correctText = valid.options[valid.correct_index];
    const shuffled = shuffleQuizQuestionOptions(valid, '2026-11-22:user1', 'test-secret');
    assert.equal(shuffled.options[shuffled.correct_index], correctText);
    assert.equal(shuffled.options.length, valid.options.length);
    positions.add(shuffled.correct_index);

    // Deterministic for same seed
    const shuffledAgain = shuffleQuizQuestionOptions(valid, '2026-11-22:user1', 'test-secret');
    assert.deepEqual(shuffled, shuffledAgain);
  }

  // Correct answers must land across ALL 4 indices (0, 1, 2, 3), never stuck at index 0
  assert.equal(positions.size, 4, `Expected all 4 positions (0..3) used, got ${Array.from(positions).join(',')}`);
});

test('12-hour UTC slot helpers split day into H0 (00:00-11:59) and H1 (12:00-23:59) accurately', () => {
  const morning = new Date('2026-11-22T07:15:00.000Z');
  const evening = new Date('2026-11-22T19:45:00.000Z');

  assert.equal(getUtc12HourSlot(morning), '2026-11-22-H0');
  assert.equal(getUtc12HourSlot(evening), '2026-11-22-H1');
  assert.equal(isValidUtc12HourSlot('2026-11-22-H0'), true);
  assert.equal(isValidUtc12HourSlot('2026-11-22-H1'), true);
  assert.equal(isValidUtc12HourSlot('2026-11-22-H2'), false);
  assert.equal(isValidUtc12HourSlot('2026-11-22'), false);

  assert.equal(getNextUtc12HourResetIso('2026-11-22-H0'), '2026-11-22T12:00:00.000Z');
  assert.equal(getNextUtc12HourResetIso('2026-11-22-H1'), '2026-11-23T00:00:00.000Z');
});

test('signed anti-bot captcha validates right answers and blocks tampering, wrong answers, and expiry', () => {
  const secret = 'captcha-test-secret';
  const now = 1795300000000;
  const challenge = createSignedCaptcha(secret, now);
  assert.ok(challenge.captcha_token.startsWith('cap1.'));

  // Extract expected from payload just for test verification
  const payloadStr = Buffer.from(challenge.captcha_token.split('.')[1], 'base64url').toString('utf8');
  const { expected } = JSON.parse(payloadStr);

  assert.equal(verifySignedCaptcha(challenge.captcha_token, String(expected), secret, now + 5000).valid, true);
  assert.equal(verifySignedCaptcha(challenge.captcha_token, String(expected + 1), secret, now + 5000).valid, false);
  assert.equal(verifySignedCaptcha(challenge.captcha_token + 'x', String(expected), secret, now + 5000).valid, false);
  assert.equal(verifySignedCaptcha(challenge.captcha_token, String(expected), secret, now + 11 * 60 * 1000).valid, false);

  // Guard identifier hashing is deterministic & privacy-safe
  const h1 = hashGuardIdentifier('127.0.0.1', secret);
  const h2 = hashGuardIdentifier('127.0.0.1', secret);
  assert.equal(h1, h2);
  assert.ok(!h1.includes('127.0.0.1'));
});

test('parseBulkQuizInput parses both pipe-separated lines and JSON arrays cleanly', () => {
  const pipeText = `
# comment line
Какой трек открывает nightmortan? | twilight | bon ami | on my bones | get married | 1 | Открывающий трек #1 | 2
В каком году вышел сингл athens? | 2024 | 2025 | 2026 | 2023 | 3 | Релиз 2026 года | 1
`;
  const r1 = parseBulkQuizInput(pipeText);
  assert.equal(r1.errors.length, 0);
  assert.equal(r1.items.length, 2);
  assert.equal(r1.items[0].correct_index, 0);
  assert.equal(r1.items[1].correct_index, 2);

  const jsonText = JSON.stringify([
    {
      question_ru: 'Сколько треков в MURDA M?',
      options: ['2', '3', '5', '6'],
      correct_index: 1,
      explanation_ru: 'В EP MURDA M ровно 3 трека.',
      difficulty: 2,
    },
  ]);
  const r2 = parseBulkQuizInput(jsonText);
  assert.equal(r2.errors.length, 0);
  assert.equal(r2.items.length, 1);
  assert.equal(r2.items[0].correct_index, 1);
});
