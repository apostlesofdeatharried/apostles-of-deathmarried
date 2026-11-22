import crypto from 'crypto';
import fs from 'fs';

export const DAILY_SNIPPET_DURATION_SECONDS = 5;
export const DEFAULT_DAILY_QUIZ_COUNT = 5;

export interface PlayableTrackCandidate {
  id: string;
  title: string;
  audio_url: string;
  duration_seconds: number;
  source: 'track' | 'single';
  album_title?: string;
  cover_url?: string;
}

export interface TitleOption {
  id: string;
  title: string;
}

export interface DailyTrackSelection {
  challenge_date: string;
  track: PlayableTrackCandidate;
  snippet_start_seconds: number;
  snippet_start_ratio: number;
  snippet_duration_seconds: number;
  options: TitleOption[];
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
 * Computes exact 5-second (or track-bounded) snippet start and duration.
 * Allows positions across beginning, middle, and near-end while guaranteeing
 * [snippetStart, snippetStart + snippetDuration] never exceeds track duration.
 */
export function computeDailySnippetWindow(
  durationSeconds: number,
  utcDate: string,
  trackId: string,
  secret: string,
  targetDuration: number = DAILY_SNIPPET_DURATION_SECONDS
): { snippet_start_seconds: number; snippet_start_ratio: number; snippet_duration_seconds: number } {
  const ratio = computeDeterministicUnitFloat(`daily-track-snippet:${utcDate}:${trackId}`, secret);
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
 * Deterministically picks the shared UTC daily track, 5-second snippet window,
 * and shuffled multiple-choice options.
 * Avoids recently used track IDs whenever enough playable tracks exist.
 */
export function pickDailyTrackChallenge(params: {
  utcDate: string;
  playableTracks: PlayableTrackCandidate[];
  allTitleCandidates: TitleOption[];
  recentTrackIds?: string[];
  secret: string;
  optionsCount?: number;
}): DailyTrackSelection | null {
  const {
    utcDate,
    playableTracks,
    allTitleCandidates,
    recentTrackIds = [],
    secret,
    optionsCount = 4,
  } = params;

  // Deduplicate and stably sort playable tracks so order never varies across instances
  const uniqueMap = new Map<string, PlayableTrackCandidate>();
  for (const t of playableTracks) {
    if (!t || !t.id || !t.title?.trim() || !t.audio_url?.trim()) continue;
    if (!uniqueMap.has(t.id)) {
      uniqueMap.set(t.id, t);
    }
  }
  const sortedPool = Array.from(uniqueMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  if (sortedPool.length === 0) return null;

  // Avoid recently played tracks while ensuring at least 1 candidate remains
  const maxRecentToExclude = Math.max(0, Math.min(recentTrackIds.length, sortedPool.length - 1));
  const excludedSet = new Set(recentTrackIds.slice(0, maxRecentToExclude));
  const preferredPool = sortedPool.filter((t) => !excludedSet.has(t.id));
  const candidatePool = preferredPool.length > 0 ? preferredPool : sortedPool;

  const pickedIdx = hmacUint32(`daily-track-pick:${utcDate}`, secret) % candidatePool.length;
  const track = candidatePool[pickedIdx];

  const window = computeDailySnippetWindow(
    track.duration_seconds,
    utcDate,
    track.id,
    secret,
    DAILY_SNIPPET_DURATION_SECONDS
  );

  // Build unique distractor list (avoid duplicating target track id or exact normalized title)
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
    `daily-track-distractors:${utcDate}:${track.id}`,
    secret
  ).slice(0, Math.max(0, optionsCount - 1));

  const options = deterministicShuffle(
    [{ id: track.id, title: track.title.trim() }, ...shuffledDistractors],
    `daily-track-options:${utcDate}:${track.id}`,
    secret
  );

  return {
    challenge_date: utcDate,
    track,
    snippet_start_seconds: window.snippet_start_seconds,
    snippet_start_ratio: window.snippet_start_ratio,
    snippet_duration_seconds: window.snippet_duration_seconds,
    options,
  };
}

/**
 * Validates a quiz question row from SQLite before including it in a daily quiz set.
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

  return {
    id: raw.id,
    question_ru: questionRu || questionEn,
    question_en: questionEn || questionRu,
    options: cleanOptions,
    correct_index: correctIndex,
    explanation_ru: typeof raw.explanation_ru === 'string' ? raw.explanation_ru : '',
    explanation_en: typeof raw.explanation_en === 'string' ? raw.explanation_en : '',
    difficulty: Number(raw.difficulty) || 1,
  };
}

/**
 * Deterministically forms a daily quiz question set for a given UTC date.
 * - Filters out invalid/inactive/malformed questions.
 * - Never includes duplicate question IDs in the same day's set.
 * - Avoids recently used question IDs whenever the question bank has enough fresh questions.
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
 * Reads exact duration in seconds from a local PCM RIFF/WAVE file header.
 * Returns null if the file is missing or not a standard WAV file.
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
