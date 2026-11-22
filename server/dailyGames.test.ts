import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_SNIPPET_DURATION_SECONDS,
  getUtcDateString,
  isValidUtcDateString,
  getNextUtcMidnightIso,
  computeDailySnippetWindow,
  pickDailyTrackChallenge,
  parseAndValidateQuizQuestion,
  pickDailyQuizSet,
  type PlayableTrackCandidate,
  type RawQuizQuestion,
} from './dailyGames.js';

const TEST_SECRET = 'unit-test-daily-secret-key';

test('UTC date helpers calculate YYYY-MM-DD and next midnight strictly in UTC', () => {
  const beforeMidnight = new Date('2026-11-22T23:59:59.999Z');
  const afterMidnight = new Date('2026-11-23T00:00:00.000Z');

  assert.equal(getUtcDateString(beforeMidnight), '2026-11-22');
  assert.equal(getUtcDateString(afterMidnight), '2026-11-23');
  assert.equal(getNextUtcMidnightIso('2026-11-22'), '2026-11-23T00:00:00.000Z');
  assert.equal(getNextUtcMidnightIso('2026-12-31'), '2027-01-01T00:00:00.000Z');

  assert.equal(isValidUtcDateString('2026-11-22'), true);
  assert.equal(isValidUtcDateString('2026-02-30'), false);
  assert.equal(isValidUtcDateString('not-a-date'), false);
  assert.equal(isValidUtcDateString(null), false);
});

test('computeDailySnippetWindow clamps strictly to 5-second window inside track bounds', () => {
  // Normal 3-minute track
  for (let day = 1; day <= 30; day++) {
    const date = `2026-05-${String(day).padStart(2, '0')}`;
    const win = computeDailySnippetWindow(180, date, 'trk_1', TEST_SECRET);
    assert.equal(win.snippet_duration_seconds, DAILY_SNIPPET_DURATION_SECONDS);
    assert.ok(win.snippet_start_seconds >= 0);
    assert.ok(win.snippet_start_seconds + win.snippet_duration_seconds <= 180);
  }

  // Short 3-second track (never exceeds duration)
  const shortWin = computeDailySnippetWindow(3, '2026-05-01', 'trk_short', TEST_SECRET);
  assert.equal(shortWin.snippet_start_seconds, 0);
  assert.equal(shortWin.snippet_duration_seconds, 3);

  // Exact 5-second track
  const exactWin = computeDailySnippetWindow(5, '2026-05-01', 'trk_five', TEST_SECRET);
  assert.equal(exactWin.snippet_start_seconds, 0);
  assert.equal(exactWin.snippet_duration_seconds, 5);

  // Unknown duration (0) still sets exact 5s duration and valid ratio
  const unknownWin = computeDailySnippetWindow(0, '2026-05-01', 'trk_zero', TEST_SECRET);
  assert.equal(unknownWin.snippet_start_seconds, 0);
  assert.equal(unknownWin.snippet_duration_seconds, 5);
  assert.ok(unknownWin.snippet_start_ratio >= 0 && unknownWin.snippet_start_ratio < 1);
});

test('pickDailyTrackChallenge is 100% deterministic for same UTC day and avoids recent tracks', () => {
  const tracks: PlayableTrackCandidate[] = [
    { id: 'trk_1', title: 'Twilight', audio_url: '/audio/crown_of_thorns.wav', duration_seconds: 160, source: 'track' },
    { id: 'trk_2', title: 'Athens', audio_url: '/audio/midnight_rose.wav', duration_seconds: 140, source: 'single' },
    { id: 'trk_3', title: 'Velvet Crypt', audio_url: '/audio/cathedral_veil.wav', duration_seconds: 210, source: 'track' },
    { id: 'trk_4', title: 'Midnight Rose', audio_url: '/audio/midnight_rose.wav', duration_seconds: 120, source: 'track' },
  ];
  const titles = tracks.map((t) => ({ id: t.id, title: t.title }));

  // Identical across repeated / shuffled input calls on the same UTC date
  const runA = pickDailyTrackChallenge({
    utcDate: '2026-11-22',
    playableTracks: tracks,
    allTitleCandidates: titles,
    recentTrackIds: [],
    secret: TEST_SECRET,
  });
  const runB = pickDailyTrackChallenge({
    utcDate: '2026-11-22',
    playableTracks: [...tracks].reverse(),
    allTitleCandidates: [...titles].reverse(),
    recentTrackIds: [],
    secret: TEST_SECRET,
  });

  assert.ok(runA && runB);
  assert.equal(runA.track.id, runB.track.id);
  assert.equal(runA.snippet_start_seconds, runB.snippet_start_seconds);
  assert.equal(runA.snippet_duration_seconds, 5);
  assert.deepEqual(runA.options, runB.options);
  assert.equal(runA.options.length, 4);
  assert.ok(runA.options.some((o) => o.id === runA.track.id));

  // Avoids recently played tracks when alternatives exist
  const nextDay = pickDailyTrackChallenge({
    utcDate: '2026-11-23',
    playableTracks: tracks,
    allTitleCandidates: titles,
    recentTrackIds: [runA.track.id, 'trk_2', 'trk_3'].filter((id, idx, arr) => arr.indexOf(id) === idx).slice(0, 3),
    secret: TEST_SECRET,
  });
  assert.ok(nextDay);
  assert.notEqual(nextDay.track.id, runA.track.id);
});

test('pickDailyQuizSet filters invalid questions, avoids duplicates, and rotates across UTC days', () => {
  const bank: RawQuizQuestion[] = Array.from({ length: 12 }, (_, idx) => ({
    id: `q_${String(idx + 1).padStart(2, '0')}`,
    question_ru: `Вопрос ${idx + 1}`,
    question_en: `Question ${idx + 1}`,
    options_json: JSON.stringify(['A', 'B', 'C', 'D']),
    correct_index: idx % 4,
    is_active: 1,
  }));

  // Inject malformed / inactive questions that MUST be filtered out
  bank.push(
    {
      id: 'q_bad_inactive',
      question_ru: 'Inactive',
      question_en: 'Inactive',
      options_json: JSON.stringify(['A', 'B']),
      correct_index: 0,
      is_active: 0,
    },
    {
      id: 'q_bad_json',
      question_ru: 'Broken JSON',
      question_en: 'Broken JSON',
      options_json: '{bad',
      correct_index: 0,
      is_active: 1,
    },
    {
      id: 'q_bad_index',
      question_ru: 'Out of bounds',
      question_en: 'Out of bounds',
      options_json: JSON.stringify(['A', 'B']),
      correct_index: 5,
      is_active: 1,
    },
    {
      id: 'q_bad_empty',
      question_ru: '   ',
      question_en: '',
      options_json: JSON.stringify(['A', 'B']),
      correct_index: 0,
      is_active: 1,
    }
  );

  assert.equal(parseAndValidateQuizQuestion(bank[bank.length - 1]), null);

  const day1A = pickDailyQuizSet({
    utcDate: '2026-11-22',
    rawQuestions: bank,
    recentQuestionIds: [],
    limit: 5,
    secret: TEST_SECRET,
  });
  const day1B = pickDailyQuizSet({
    utcDate: '2026-11-22',
    rawQuestions: [...bank].reverse(),
    recentQuestionIds: [],
    limit: 5,
    secret: TEST_SECRET,
  });

  // Same UTC day => identical set & order
  assert.equal(day1A.length, 5);
  assert.deepEqual(
    day1A.map((q) => q.id),
    day1B.map((q) => q.id)
  );
  // Zero duplicates
  assert.equal(new Set(day1A.map((q) => q.id)).size, 5);
  // None of the malformed questions included
  assert.ok(day1A.every((q) => !q.id.startsWith('q_bad_')));

  // Next UTC day avoids day 1 questions when bank has 12 valid questions
  const day2 = pickDailyQuizSet({
    utcDate: '2026-11-23',
    rawQuestions: bank,
    recentQuestionIds: day1A.map((q) => q.id),
    limit: 5,
    secret: TEST_SECRET,
  });
  assert.equal(day2.length, 5);
  const day1Ids = new Set(day1A.map((q) => q.id));
  assert.ok(day2.every((q) => !day1Ids.has(q.id)));
});
