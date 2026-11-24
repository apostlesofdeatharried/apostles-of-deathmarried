import crypto from 'crypto';
import fs from 'fs';
import {
  extractLyricPairs,
  getMoscow12hCycle,
  isValidMoscow12hCycle,
  getNextMoscow12hResetIso,
  getPreviousMoscow12hCycle,
} from '../src/utils/logic.js';

export const DAILY_SNIPPET_DURATION_SECONDS = 5;
export const DEFAULT_DAILY_QUIZ_COUNT = 5;

export {
  getMoscow12hCycle,
  isValidMoscow12hCycle,
  getNextMoscow12hResetIso,
  getPreviousMoscow12hCycle,
};

export interface PlayableTrackCandidate {
  id: string;
  title: string;
  audio_url: string;
  duration_seconds: number;
  source: 'track' | 'single';
  album_title?: string;
  cover_url?: string;
}

export interface LyricTrackCandidate {
  id: string;
  title: string;
  lyrics: string;
  source: 'track' | 'single';
  album_title?: string;
  cover_url?: string;
}

export interface TitleOption {
  id: string;
  title: string;
}

export interface LyricOption {
  id: string;
  text: string;
}

export interface DailyTrackSelection {
  challenge_date: string;
  track: PlayableTrackCandidate;
  snippet_start_seconds: number;
  snippet_start_ratio: number;
  snippet_duration_seconds: number;
  options: TitleOption[];
}

export interface DailySpeedTrackSelection extends DailyTrackSelection {
  speed_mode: 0.5 | 2.5;
}

export interface DailyLyricsSelection {
  challenge_date: string;
  track: LyricTrackCandidate;
  prompt_line: string;
  correct_option_id: string;
  correct_line: string;
  options: LyricOption[];
}

export interface RawQuizQuestion {
  id: string;
  question_ru: string;
  question_en: string;
  options_json: string;
  correct_index: number;
  explanation_ru?: string | null;
  explanation_en?: string | null;
  difficulty?: number;
  is_active?: number;
}

export interface ValidatedQuizQuestion {
  id: string;
  question_ru: string;
  question_en: string;
  options: string[];
  correct_index: number;
  explanation_ru: string;
  explanation_en: string;
  difficulty: number;
}

const UTC_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UTC_12H_SLOT_REGEX = /^\d{4}-\d{2}-\d{2}-H([01])$/;

/**
 * Returns the current UTC calendar date formatted as YYYY-MM-DD.
 */
export function getUtcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Validates YYYY-MM-DD calendar date format.
 */
export function isValidUtcDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_DATE_REGEX.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * Returns the ISO timestamp of the next 00:00:00.000Z UTC reset after the given UTC date.
 */
export function getNextUtcMidnightIso(utcDate: string): string {
  const baseMs = Date.parse(`${utcDate}T00:00:00.000Z`);
  if (Number.isNaN(baseMs)) {
    const today = getUtcDateString();
    return new Date(Date.parse(`${today}T00:00:00.000Z`) + 86400000).toISOString();
  }
  return new Date(baseMs + 86400000).toISOString();
}

/**
 * Legacy 12-hour UTC slot helpers kept for backwards compatibility with tests.
 */
export function getUtc12HourSlot(now: Date = new Date()): string {
  const datePart = getUtcDateString(now);
  const half = now.getUTCHours() < 12 ? 0 : 1;
  return `${datePart}-H${half}`;
}

export function isValidUtc12HourSlot(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = UTC_12H_SLOT_REGEX.exec(value);
  if (!match) return false;
  return isValidUtcDateString(value.slice(0, 10));
}

export function getNextUtc12HourResetIso(slotKey: string): string {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  if (!isValidUtc12HourSlot(slotKey)) {
    return getNextUtc12HourResetIso(getUtc12HourSlot());
  }
  const datePart = slotKey.slice(0, 10);
  const half = slotKey.endsWith('-H1') ? 1 : 0;
  const baseMs = Date.parse(`${datePart}T00:00:00.000Z`) + half * TWELVE_HOURS_MS;
  return new Date(baseMs + TWELVE_HOURS_MS).toISOString();
}

/**
 * Produces a deterministic unsigned 32-bit integer from HMAC-SHA256(secret, seedInput).
 */
export function hmacUint32(seedInput: string, secret: string): number {
  const digest = crypto.createHmac('sha256', secret || 'apostles-daily-default-salt').update(seedInput).digest();
  return digest.readUInt32BE(0);
}

/**
 * Produces a deterministic float in [0, 1) from HMAC-SHA256.
 */
export function computeDeterministicUnitFloat(seedInput: string, secret: string): number {
  return hmacUint32(seedInput, secret) / 0x100000000;
}

/**
 * Deterministic Fisher-Yates shuffle keyed by HMAC-SHA256.
 * Never mutates the input array.
 */
export function deterministicShuffle<T>(items: readonly T[], seedInput: string, secret: string): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const rand = hmacUint32(`${seedInput}:shuffle:${i}`, secret);
    const j = rand % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Computes exact snippet start and duration bounded cleanly within track length.
 */
export function computeDailySnippetWindow(
  durationSeconds: number,
  cycleId: string,
  trackId: string,
  secret: string,
  targetDuration: number = DAILY_SNIPPET_DURATION_SECONDS,
  scopePrefix: string = 'daily-track-snippet'
): { snippet_start_seconds: number; snippet_start_ratio: number; snippet_duration_seconds: number } {
  const ratio = computeDeterministicUnitFloat(`${scopePrefix}:${cycleId}:${trackId}`, secret);
  const safeDur = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.floor(durationSeconds) : 0;

  if (safeDur <= 0) {
    return {
      snippet_start_seconds: 0,
      snippet_start_ratio: Number(ratio.toFixed(6)),
      snippet_duration_seconds: targetDuration,
    };
  }

  if (safeDur <= targetDuration) {
    return {
      snippet_start_seconds: 0,
      snippet_start_ratio: 0,
      snippet_duration_seconds: Math.max(1, safeDur),
    };
  }

  const maxStart = safeDur - targetDuration;
  const start = Math.min(maxStart, Math.max(0, Math.floor(ratio * (maxStart + 1))));

  return {
    snippet_start_seconds: start,
    snippet_start_ratio: Number(ratio.toFixed(6)),
    snippet_duration_seconds: targetDuration,
  };
}

/**
 * Deterministically picks the shared 12-hour track challenge, 5-second snippet window,
 * and Fisher-Yates shuffled multiple-choice options.
 * Supports `gameScope` so guess-track, reverse-track, and speed-track select independent tracks!
 */
export function pickDailyTrackChallenge(params: {
  utcDate: string;
  playableTracks: PlayableTrackCandidate[];
  allTitleCandidates: TitleOption[];
  recentTrackIds?: string[];
  secret: string;
  optionsCount?: number;
  gameScope?: string;
  sourceWindowSeconds?: number;
}): DailyTrackSelection | null {
  const {
    utcDate,
    playableTracks,
    allTitleCandidates,
    recentTrackIds = [],
    secret,
    optionsCount = 4,
    gameScope = 'daily-track',
    sourceWindowSeconds = DAILY_SNIPPET_DURATION_SECONDS,
  } = params;

  const uniqueMap = new Map<string, PlayableTrackCandidate>();
  for (const t of playableTracks) {
    if (!t || !t.id || !t.title?.trim() || !t.audio_url?.trim()) continue;
    if (!uniqueMap.has(t.id)) {
      uniqueMap.set(t.id, t);
    }
  }
  const sortedPool = Array.from(uniqueMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  if (sortedPool.length === 0) return null;

  const maxRecentToExclude = Math.max(0, Math.min(recentTrackIds.length, sortedPool.length - 1));
  const excludedSet = new Set(recentTrackIds.slice(0, maxRecentToExclude));
  const preferredPool = sortedPool.filter((t) => !excludedSet.has(t.id));
  const candidatePool = preferredPool.length > 0 ? preferredPool : sortedPool;

  const pickSeed = gameScope === 'daily-track' ? `daily-track-pick:${utcDate}` : `${gameScope}-pick:${utcDate}`;
  const pickedIdx = hmacUint32(pickSeed, secret) % candidatePool.length;
  const track = candidatePool[pickedIdx];

  const window = computeDailySnippetWindow(
    track.duration_seconds,
    utcDate,
    track.id,
    secret,
    sourceWindowSeconds,
    gameScope === 'daily-track' ? 'daily-track-snippet' : `${gameScope}-snippet`
  );

  const seenTitles = new Set<string>([track.title.trim().toLowerCase()]);
  const distractorCandidates: TitleOption[] = [];
  const sortedTitles = [...allTitleCandidates].sort((a, b) => a.id.localeCompare(b.id));
  for (const cand of sortedTitles) {
    if (!cand || !cand.id || !cand.title?.trim()) continue;
    if (cand.id === track.id) continue;
    const normTitle = cand.title.trim().toLowerCase();
    if (seenTitles.has(normTitle)) continue;
    seenTitles.add(normTitle);
    distractorCandidates.push({ id: cand.id, title: cand.title.trim() });
  }

  const shuffledDistractors = deterministicShuffle(
    distractorCandidates,
    `${gameScope}-distractors:${utcDate}:${track.id}`,
    secret
  ).slice(0, Math.max(0, optionsCount - 1));

  const options = deterministicShuffle(
    [{ id: track.id, title: track.title.trim() }, ...shuffledDistractors],
    `${gameScope}-options:${utcDate}:${track.id}`,
    secret
  );

  return {
    challenge_date: utcDate,
    track,
    snippet_start_seconds: window.snippet_start_seconds,
    snippet_start_ratio: window.snippet_start_ratio,
    snippet_duration_seconds: DAILY_SNIPPET_DURATION_SECONDS,
    options,
  };
}

/**
 * Picks the 12-hour MSK "Задом наперёд" (5-second reversed audio) challenge.
 */
export function pickDailyReverseTrackChallenge(params: {
  cycleId: string;
  playableTracks: PlayableTrackCandidate[];
  allTitleCandidates: TitleOption[];
  excludeTrackIds?: string[];
  secret: string;
}): DailyTrackSelection | null {
  return pickDailyTrackChallenge({
    utcDate: params.cycleId,
    playableTracks: params.playableTracks,
    allTitleCandidates: params.allTitleCandidates,
    recentTrackIds: params.excludeTrackIds || [],
    secret: params.secret,
    gameScope: 'reverse-track',
    sourceWindowSeconds: DAILY_SNIPPET_DURATION_SECONDS,
  });
}

/**
 * Picks the 12-hour MSK "0.5x / 2.5x" (5 seconds of real listening time) challenge.
 * Deterministically picks either 0.5x slowed or 2.5x sped-up mode per cycle.
 */
export function pickDailySpeedTrackChallenge(params: {
  cycleId: string;
  playableTracks: PlayableTrackCandidate[];
  allTitleCandidates: TitleOption[];
  excludeTrackIds?: string[];
  secret: string;
}): DailySpeedTrackSelection | null {
  const speedMode: 0.5 | 2.5 =
    hmacUint32(`speed-track-mode:${params.cycleId}`, params.secret) % 2 === 0 ? 0.5 : 2.5;
  // Real listening duration is 5s: 0.5x consumes 2.5s of source, 2.5x consumes 12.5s of source
  const sourceSpan = Math.ceil(DAILY_SNIPPET_DURATION_SECONDS * speedMode);

  const base = pickDailyTrackChallenge({
    utcDate: params.cycleId,
    playableTracks: params.playableTracks,
    allTitleCandidates: params.allTitleCandidates,
    recentTrackIds: params.excludeTrackIds || [],
    secret: params.secret,
    gameScope: 'speed-track',
    sourceWindowSeconds: sourceSpan,
  });
  if (!base) return null;

  return {
    ...base,
    speed_mode: speedMode,
  };
}

/**
 * Deterministically picks the 12-hour MSK "Угадай строчку" challenge from real DB lyrics.
 * Shows Line 1 and gives 4 Fisher-Yates shuffled options (real Line 2 + 3 plausible lines from other tracks).
 */
export function pickDailyLyricsChallenge(params: {
  cycleId: string;
  lyricTracks: LyricTrackCandidate[];
  recentTrackIds?: string[];
  secret: string;
}): DailyLyricsSelection | null {
  const { cycleId, lyricTracks, recentTrackIds = [], secret } = params;

  interface IndexedPair {
    pairKey: string;
    track: LyricTrackCandidate;
    prompt: string;
    answer: string;
  }

  const sortedTracks = [...lyricTracks]
    .filter((t) => t && t.id && t.title?.trim() && t.lyrics?.trim())
    .sort((a, b) => a.id.localeCompare(b.id));

  const allPairs: IndexedPair[] = [];
  const allDistractorLines: Array<{ trackId: string; text: string }> = [];
  const seenGlobalLines = new Set<string>();

  for (const track of sortedTracks) {
    const pairs = extractLyricPairs(track.lyrics);
    pairs.forEach((p, idx) => {
      allPairs.push({
        pairKey: `${track.id}:${idx}`,
        track,
        prompt: p.prompt,
        answer: p.answer,
      });
      const normAns = p.answer.toLowerCase();
      if (!seenGlobalLines.has(`${track.id}:${normAns}`)) {
        seenGlobalLines.add(`${track.id}:${normAns}`);
        allDistractorLines.push({ trackId: track.id, text: p.answer });
      }
      const normPr = p.prompt.toLowerCase();
      if (!seenGlobalLines.has(`${track.id}:${normPr}`)) {
        seenGlobalLines.add(`${track.id}:${normPr}`);
        allDistractorLines.push({ trackId: track.id, text: p.prompt });
      }
    });
  }

  if (allPairs.length === 0) return null;

  // Prefer tracks not used in the previous 12h MSK cycle(s)
  const uniqueTrackIds = Array.from(new Set(allPairs.map((p) => p.track.id)));
  const maxExclude = Math.max(0, Math.min(recentTrackIds.length, uniqueTrackIds.length - 1));
  const excludedTracks = new Set(recentTrackIds.slice(0, maxExclude));
  const preferredPairs = allPairs.filter((p) => !excludedTracks.has(p.track.id));
  const pool = preferredPairs.length > 0 ? preferredPairs : allPairs;

  const pickedIdx = hmacUint32(`guess-lyrics-pick:${cycleId}`, secret) % pool.length;
  const chosen = pool[pickedIdx];

  // Collect 3 unique distractor lines — strictly preferring lines from OTHER tracks
  const forbidden = new Set<string>([
    chosen.prompt.toLowerCase(),
    chosen.answer.toLowerCase(),
  ]);

  const otherTrackLines: string[] = [];
  const sameTrackFallbackLines: string[] = [];
  const seenCandidateText = new Set<string>();

  for (const item of allDistractorLines) {
    const norm = item.text.toLowerCase();
    if (forbidden.has(norm) || seenCandidateText.has(norm)) continue;
    seenCandidateText.add(norm);
    if (item.trackId !== chosen.track.id) {
      otherTrackLines.push(item.text);
    } else {
      sameTrackFallbackLines.push(item.text);
    }
  }

  const shuffledOther = deterministicShuffle(
    otherTrackLines,
    `guess-lyrics-distractors-other:${cycleId}:${chosen.pairKey}`,
    secret
  );
  const shuffledSame = deterministicShuffle(
    sameTrackFallbackLines,
    `guess-lyrics-distractors-same:${cycleId}:${chosen.pairKey}`,
    secret
  );

  const distractors = [...shuffledOther, ...shuffledSame].slice(0, 3);
  if (distractors.length < 1) return null;

  const makeOptionId = (text: string) =>
    'lo_' +
    crypto
      .createHmac('sha256', secret || 'apostles-daily-default-salt')
      .update(`${cycleId}:${chosen.pairKey}:${text}`)
      .digest('hex')
      .slice(0, 10);

  const correctOptionId = makeOptionId(chosen.answer);
  const rawOptions: LyricOption[] = [
    { id: correctOptionId, text: chosen.answer },
    ...distractors.map((text) => ({ id: makeOptionId(text), text })),
  ];

  // Unbiased Fisher-Yates shuffle across all 4 options
  const options = deterministicShuffle(
    rawOptions,
    `guess-lyrics-options:${cycleId}:${chosen.pairKey}`,
    secret
  );

  return {
    challenge_date: cycleId,
    track: chosen.track,
    prompt_line: chosen.prompt,
    correct_option_id: correctOptionId,
    correct_line: chosen.answer,
    options,
  };
}

/**
 * Validates a quiz question row from SQLite before including it in a quiz set.
 */
export function parseAndValidateQuizQuestion(raw: RawQuizQuestion): ValidatedQuizQuestion | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (raw.is_active !== undefined && Number(raw.is_active) !== 1) return null;

  const questionRu = typeof raw.question_ru === 'string' ? raw.question_ru.trim() : '';
  const questionEn = typeof raw.question_en === 'string' ? raw.question_en.trim() : '';
  if (!questionRu && !questionEn) return null;

  let parsedOptions: unknown;
  try {
    parsedOptions = JSON.parse(raw.options_json);
  } catch {
    return null;
  }

  if (!Array.isArray(parsedOptions)) return null;
  const cleanOptions = parsedOptions
    .filter((opt): opt is string => typeof opt === 'string' && opt.trim().length > 0)
    .map((opt) => opt.trim());

  if (cleanOptions.length < 2) return null;

  const correctIndex = Number(raw.correct_index);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= cleanOptions.length) {
    return null;
  }

  const diffNum = Number(raw.difficulty);
  const normalizedDifficulty = diffNum === 3 ? 3 : diffNum === 2 ? 2 : 1;

  return {
    id: raw.id,
    question_ru: questionRu || questionEn,
    question_en: questionEn || questionRu,
    options: cleanOptions,
    correct_index: correctIndex,
    explanation_ru: typeof raw.explanation_ru === 'string' ? raw.explanation_ru : '',
    explanation_en: typeof raw.explanation_en === 'string' ? raw.explanation_en : '',
    difficulty: normalizedDifficulty,
  };
}

/**
 * Deterministically forms a quiz question set for a given 12-hour cycle.
 */
export function pickDailyQuizSet(params: {
  utcDate: string;
  rawQuestions: RawQuizQuestion[];
  recentQuestionIds?: string[];
  limit?: number;
  secret: string;
}): ValidatedQuizQuestion[] {
  const {
    utcDate,
    rawQuestions,
    recentQuestionIds = [],
    limit = DEFAULT_DAILY_QUIZ_COUNT,
    secret,
  } = params;

  const uniqueValidMap = new Map<string, ValidatedQuizQuestion>();
  for (const raw of rawQuestions) {
    const valid = parseAndValidateQuizQuestion(raw);
    if (valid && !uniqueValidMap.has(valid.id)) {
      uniqueValidMap.set(valid.id, valid);
    }
  }

  const allValid = Array.from(uniqueValidMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  if (allValid.length === 0) return [];

  const targetCount = Math.min(Math.max(1, limit), allValid.length);
  const recentSet = new Set(recentQuestionIds);

  const freshPool = allValid.filter((q) => !recentSet.has(q.id));
  const recentPool = allValid.filter((q) => recentSet.has(q.id));

  const shuffledFresh = deterministicShuffle(freshPool, `daily-quiz-fresh:${utcDate}`, secret);
  if (shuffledFresh.length >= targetCount) {
    return shuffledFresh.slice(0, targetCount);
  }

  const shuffledRecent = deterministicShuffle(recentPool, `daily-quiz-recent:${utcDate}`, secret);
  const combined = [...shuffledFresh, ...shuffledRecent].slice(0, targetCount);
  return deterministicShuffle(combined, `daily-quiz-order:${utcDate}`, secret);
}

/**
 * Shuffles a quiz question's answer options using Fisher-Yates shuffle and remaps
 * correct_index accurately so the correct answer lands on a random/uniform position.
 */
export function shuffleQuizQuestionOptions(
  question: ValidatedQuizQuestion,
  seedInput: string,
  secret: string
): ValidatedQuizQuestion {
  const indexed = question.options.map((text, idx) => ({
    text,
    isCorrect: idx === question.correct_index,
  }));
  const shuffled = deterministicShuffle(indexed, `quiz-opt-shuffle:${seedInput}:${question.id}`, secret);
  const nextCorrectIndex = shuffled.findIndex((item) => item.isCorrect);
  return {
    ...question,
    options: shuffled.map((item) => item.text),
    correct_index: nextCorrectIndex >= 0 ? nextCorrectIndex : 0,
  };
}

/**
 * Reads exact duration in seconds from a local PCM RIFF/WAVE file header.
 */
export function readLocalWavDurationSeconds(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(64);
      const bytesRead = fs.readSync(fd, header, 0, 64, 0);
      if (bytesRead < 44) return null;
      if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
        return null;
      }
      const byteRate = header.readUInt32LE(28);
      if (!byteRate || byteRate <= 0) return null;
      const stat = fs.fstatSync(fd);
      const dataBytes = Math.max(0, stat.size - 44);
      const seconds = dataBytes / byteRate;
      return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
