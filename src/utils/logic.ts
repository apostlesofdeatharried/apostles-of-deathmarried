/**
 * Core game, experience, and validation logic for Apostles of deathmarried.
 * Pure deterministic functions decoupled from UI for unit testing and backend verification.
 */

export interface LevelProgress {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
}

export function calculateLevelFromXp(xp: number): LevelProgress {
  const safeXp = Math.max(0, Math.floor(xp));
  // Smooth, balanced progression curve:
  // Level 1 -> 2: 100 XP, Level 2 -> 3: 303 XP, Level 3 -> 4: 580 XP, Level 4 -> 5: 919 XP, etc.
  // Formula: cumulative XP threshold for completing level L is floor(100 * L^1.6).
  let level = 1;
  while (true) {
    const nextThreshold = Math.floor(100 * Math.pow(level, 1.6));
    if (safeXp < nextThreshold) {
      const prevThreshold = level === 1 ? 0 : Math.floor(100 * Math.pow(level - 1, 1.6));
      const neededForNext = nextThreshold - prevThreshold;
      const progressInLevel = safeXp - prevThreshold;
      const progressPercent = Math.min(100, Math.max(0, Math.round((progressInLevel / neededForNext) * 100)));
      return {
        level,
        currentLevelXp: progressInLevel,
        nextLevelXp: neededForNext,
        progressPercent,
      };
    }
    level++;
    if (level > 100) {
      return {
        level: 100,
        currentLevelXp: 1000,
        nextLevelXp: 1000,
        progressPercent: 100,
      };
    }
  }
}

/**
 * Returns balanced XP per Daily Quiz question based on difficulty:
 * 1 (easy) = 10 XP, 2 (medium) = 15 XP, 3 (hard) = 25 XP.
 */
export function getQuizQuestionXp(difficulty?: number): number {
  const d = Math.round(Number(difficulty) || 2);
  if (d <= 1) return 10;
  if (d >= 3) return 25;
  return 15;
}

export function calculateQuizScoreByDifficulty(
  items: Array<{ isCorrect: boolean; difficulty?: number }>
): {
  baseScore: number;
  speedBonus: number;
  totalXp: number;
} {
  if (!Array.isArray(items) || items.length === 0) {
    return { baseScore: 0, speedBonus: 0, totalXp: 0 };
  }
  let totalXp = 0;
  for (const item of items) {
    if (item.isCorrect) {
      totalXp += getQuizQuestionXp(item.difficulty);
    }
  }
  return {
    baseScore: totalXp,
    speedBonus: 0,
    totalXp,
  };
}

export function calculateQuizScore(totalQuestions: number, correctAnswers: number, _timeSpentSeconds: number = 30): {
  baseScore: number;
  speedBonus: number;
  totalXp: number;
} {
  if (totalQuestions <= 0 || correctAnswers <= 0) {
    return { baseScore: 0, speedBonus: 0, totalXp: 0 };
  }
  const safeCorrect = Math.min(totalQuestions, Math.max(0, Math.floor(correctAnswers)));
  const baseScore = safeCorrect * 15;
  return {
    baseScore,
    speedBonus: 0,
    totalXp: baseScore,
  };
}

/**
 * Balanced mini-game XP reward (Guess Track, future Lyrics / Reverse / Speed modes):
 * 15–20 XP for a successful round (15 base + up to 5 streak bonus), 5 XP for participation.
 */
export function calculateMiniGameXp(isCorrect: boolean, currentStreak: number = 0): number {
  if (!isCorrect) return 5;
  const streakBonus = Math.min(5, Math.max(0, Math.floor(currentStreak || 0)));
  return 15 + streakBonus;
}

export function validateNickname(nickname: string): { valid: boolean; error?: string } {
  if (!nickname || typeof nickname !== 'string') {
    return { valid: false, error: 'Nickname is required.' };
  }
  const trimmed = nickname.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Nickname must be at least 3 characters long.' };
  }
  if (trimmed.length > 24) {
    return { valid: false, error: 'Nickname cannot exceed 24 characters.' };
  }
  // Allow letters, numbers, underscores, hyphens, and spaces
  const regex = /^[a-zA-Z0-9_\-\u0400-\u04FF\s]+$/;
  if (!regex.test(trimmed)) {
    return { valid: false, error: 'Nickname contains invalid characters.' };
  }
  return { valid: true };
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters long.' };
  }
  return { valid: true };
}

export interface UserStatsForAchievements {
  totalXp: number;
  gamesPlayed: number;
  postsCount: number;
  creationsCount: number;
  dailyStreak: number;
  quizzesWon: number;
  purchasesCount?: number;
}

export function checkAchievementEligibility(stats: UserStatsForAchievements): string[] {
  const unlocked: string[] = [];

  if (stats.gamesPlayed >= 1) unlocked.push('first_blood');
  if (stats.gamesPlayed >= 10) unlocked.push('initiate_ritual');
  if (stats.quizzesWon >= 3) unlocked.push('lore_scholar');
  if (stats.dailyStreak >= 3) unlocked.push('devoted_acolyte');
  if (stats.dailyStreak >= 7) unlocked.push('eternal_vigil');
  if (stats.creationsCount >= 1) unlocked.push('gothic_artisan');
  if (stats.postsCount >= 3) unlocked.push('voice_of_abyss');
  if (stats.totalXp >= 500) unlocked.push('dark_apostle');
  if (stats.purchasesCount && stats.purchasesCount >= 1) unlocked.push('collector');

  return unlocked;
}

export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Safely parses response body as JSON.
 * Guards against HTML 404/500 pages (e.g. <!DOCTYPE html>) throwing SyntaxError.
 */
export async function safeJson<T = any>(res: Response, fallback: any = {}): Promise<T> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return fallback as T;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return fallback as T;
    }
    return JSON.parse(text) as T;
  } catch {
    return fallback as T;
  }
}

export type AppTab = 'home' | 'archive' | 'games' | 'community' | 'creations' | 'profile' | 'admin';

export interface ParsedRoute {
  tab: AppTab;
  profileNickname?: string;
  notFound?: boolean;
}

const VALID_TABS: ReadonlySet<string> = new Set([
  'archive',
  'games',
  'community',
  'creations',
  'profile',
  'admin',
]);

export function parseRoute(pathname: string): ParsedRoute {
  const clean = (pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (clean === '/') {
    return { tab: 'home' };
  }
  const segments = clean.slice(1).split('/');
  const first = segments[0];
  if (first === 'profile') {
    if (segments.length === 1) {
      return { tab: 'profile' };
    }
    if (segments.length === 2 && segments[1].trim().length > 0) {
      try {
        return { tab: 'profile', profileNickname: decodeURIComponent(segments[1]) };
      } catch {
        return { tab: 'home', notFound: true };
      }
    }
    return { tab: 'home', notFound: true };
  }
  if (segments.length === 1 && VALID_TABS.has(first)) {
    return { tab: first as AppTab };
  }
  return { tab: 'home', notFound: true };
}

export function buildPath(tab: AppTab, profileNickname?: string): string {
  if (tab === 'home') return '/';
  if (tab === 'profile' && profileNickname && profileNickname.trim().length > 0) {
    return `/profile/${encodeURIComponent(profileNickname.trim())}`;
  }
  return `/${tab}`;
}

export function isSafeMediaUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.startsWith('/')) {
    return (
      trimmed.startsWith('/uploads/') ||
      trimmed.startsWith('/audio/') ||
      trimmed.startsWith('/assets/')
    );
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function computeDailyStreak(
  lastActiveDate: string | null | undefined,
  todayDate: string,
  currentStreak: number
): number {
  const safeStreak = Math.max(0, Math.floor(currentStreak || 0));
  if (!lastActiveDate || typeof lastActiveDate !== 'string') {
    return 1;
  }
  const lastStr = lastActiveDate.slice(0, 10);
  const todayStr = todayDate.slice(0, 10);
  if (lastStr === todayStr) {
    return Math.max(1, safeStreak);
  }
  const lastMs = Date.parse(`${lastStr}T00:00:00Z`);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(lastMs) || Number.isNaN(todayMs)) {
    return 1;
  }
  const diffDays = Math.round((todayMs - lastMs) / 86400000);
  if (diffDays === 1) {
    return safeStreak + 1;
  }
  return 1;
}

export function pickDailyQuizQuestions<T extends { id: string }>(
  allQuestions: T[],
  challengeDate: string,
  limit: number = 5
): T[] {
  if (allQuestions.length <= limit) {
    return allQuestions;
  }
  let seed = 0;
  for (let i = 0; i < challengeDate.length; i++) {
    seed = (seed * 31 + challengeDate.charCodeAt(i)) >>> 0;
  }
  const copy = [...allQuestions].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, limit);
}

/**
 * Resolves the HTTP port for server.ts:
 * 1. Explicit CLI flag (--port 3000, --port=3000, -p 3000) takes highest priority.
 * 2. process.env.PORT is used unless it collides with process.env.NGINX_PORT (container proxy).
 * 3. Falls back to process.env.DEFAULT_APP_PORT or 3000.
 */
export function resolveServerPort(
  argv: string[],
  env: Record<string, string | undefined>
): number {
  const parseValidPort = (raw: string | undefined): number | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const num = Number(trimmed);
    return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : null;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--port=')) {
      const parsed = parseValidPort(arg.slice('--port='.length));
      if (parsed !== null) return parsed;
    } else if (arg === '--port' || arg === '-p') {
      const parsed = parseValidPort(argv[i + 1]);
      if (parsed !== null) return parsed;
    }
  }

  const defaultPort = parseValidPort(env.DEFAULT_APP_PORT) ?? 3000;
  const envPort = parseValidPort(env.PORT);
  const nginxPort = parseValidPort(env.NGINX_PORT);

  if (envPort !== null) {
    if (nginxPort !== null && envPort === nginxPort) {
      return defaultPort;
    }
    return envPort;
  }

  return defaultPort;
}

const ALLOWED_STREAMING_KEYS = new Set([
  'spotify',
  'apple_music',
  'yandex_music',
  'vk_music',
  'soundcloud',
  'youtube_music',
]);

export function sanitizeStreamingLinks(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const clean: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_STREAMING_KEYS.has(key) || typeof rawVal !== 'string') continue;
    const trimmed = rawVal.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        clean[key] = trimmed;
      }
    } catch {
      // Ignore invalid or unsafe URLs (e.g. javascript:)
    }
  }
  return clean;
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.wave', '.ogg', '.m4a', '.flac', '.aac', '.aiff', '.wma']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);

export function classifyMediaUpload(
  filename: string,
  mimeType: string = ''
): { allowed: boolean; kind: 'audio' | 'image' | 'video' | null; normalizedExt: string } {
  if (!filename || typeof filename !== 'string') {
    return { allowed: false, kind: null, normalizedExt: '' };
  }
  const dotIdx = filename.lastIndexOf('.');
  const rawExt = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  const mime = (mimeType || '').toLowerCase().trim();

  if (AUDIO_EXTENSIONS.has(rawExt)) {
    return { allowed: true, kind: 'audio', normalizedExt: rawExt === '.wave' ? '.wav' : rawExt };
  }
  if (IMAGE_EXTENSIONS.has(rawExt)) {
    return { allowed: true, kind: 'image', normalizedExt: rawExt };
  }
  if (VIDEO_EXTENSIONS.has(rawExt)) {
    return { allowed: true, kind: 'video', normalizedExt: rawExt };
  }

  // Fallback by MIME type only when extension is missing/unknown and not executable
  if (!rawExt) {
    if (mime.startsWith('audio/')) return { allowed: true, kind: 'audio', normalizedExt: '.mp3' };
    if (mime.startsWith('image/') && !mime.includes('svg')) return { allowed: true, kind: 'image', normalizedExt: '.jpg' };
    if (mime.startsWith('video/')) return { allowed: true, kind: 'video', normalizedExt: '.mp4' };
  }

  return { allowed: false, kind: null, normalizedExt: rawExt };
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

export function transliterateToAsciiSlug(input: string, maxLength: number = 40): string {
  if (!input || typeof input !== 'string') return 'media';
  let out = '';
  for (const ch of input.toLowerCase()) {
    if (ch in CYRILLIC_TO_LATIN) {
      out += CYRILLIC_TO_LATIN[ch];
    } else {
      out += ch;
    }
  }
  const normalized = out
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, maxLength)
    .replace(/^[_-]+|[_-]+$/g, '');

  return normalized || 'media';
}

export function buildSafeAsciiFilename(
  originalName: string,
  mimeType: string = '',
  timestamp: number = Date.now(),
  randomSuffix: string = Math.random().toString(16).slice(2, 10)
): string {
  const classified = classifyMediaUpload(originalName, mimeType);
  const dotIdx = typeof originalName === 'string' ? originalName.lastIndexOf('.') : -1;
  const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : (originalName || 'media');
  const safeExt = classified.allowed
    ? classified.normalizedExt.replace(/[^a-z0-9.]/g, '')
    : '.bin';
  const safeBase = transliterateToAsciiSlug(baseName, 40);
  const safeRand = String(randomSuffix).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'rnd';
  return `${timestamp}_${safeBase}_${safeRand}${safeExt}`;
}

// ============================================================================
// STAGE 3: MOSCOW TIME STREAKS, STREAK XP MULTIPLIER, PRIVACY & XP HISTORY I18N
// ============================================================================

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 (MSK, no DST)

/**
 * Returns the current calendar date string (YYYY-MM-DD) in Moscow time (UTC+3).
 */
export function getMoscowDateString(nowMs: number = Date.now()): string {
  return new Date(nowMs + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Checks whether the given timestamp falls within 00:00–00:15 Moscow time (UTC+3).
 */
export function isMoscowMidnightWindow(nowMs: number = Date.now()): boolean {
  const msk = new Date(nowMs + MOSCOW_OFFSET_MS);
  return msk.getUTCHours() === 0 && msk.getUTCMinutes() <= 15;
}

/**
 * Balanced daily streak bonus percent: +5% per active streak day, capped at +50% (10+ days).
 */
export function getStreakBonusPercent(streak: number): number {
  const safeDays = Math.max(0, Math.floor(Number(streak) || 0));
  return Math.min(50, safeDays * 5);
}

/**
 * Applies the daily streak bonus (+5%/day, max +50%) to a game XP base reward.
 */
export function applyStreakBonusXp(
  baseXp: number,
  streak: number
): { totalXp: number; bonusXp: number; bonusPercent: number } {
  const safeBase = Math.max(0, Math.round(Number(baseXp) || 0));
  const bonusPercent = getStreakBonusPercent(streak);
  if (safeBase === 0 || bonusPercent === 0) {
    return { totalXp: safeBase, bonusXp: 0, bonusPercent };
  }
  const totalXp = Math.round(safeBase * (1 + bonusPercent / 100));
  return {
    totalXp,
    bonusXp: Math.max(0, totalXp - safeBase),
    bonusPercent,
  };
}

export interface PrivacySettings {
  hide_community: boolean;
  hide_streak: boolean;
  hide_xp_history: boolean;
  hide_game_stats: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  hide_community: false,
  hide_streak: false,
  hide_xp_history: true, // Hidden from other users by default
  hide_game_stats: false,
};

export function parsePrivacySettings(raw: unknown): PrivacySettings {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      obj = null;
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }

  return {
    hide_community: obj && typeof obj.hide_community === 'boolean' ? obj.hide_community : DEFAULT_PRIVACY_SETTINGS.hide_community,
    hide_streak: obj && typeof obj.hide_streak === 'boolean' ? obj.hide_streak : DEFAULT_PRIVACY_SETTINGS.hide_streak,
    hide_xp_history: obj && typeof obj.hide_xp_history === 'boolean' ? obj.hide_xp_history : DEFAULT_PRIVACY_SETTINGS.hide_xp_history,
    hide_game_stats: obj && typeof obj.hide_game_stats === 'boolean' ? obj.hide_game_stats : DEFAULT_PRIVACY_SETTINGS.hide_game_stats,
  };
}

const XP_SOURCE_LABELS_RU: Record<string, string> = {
  daily_quiz: 'Ежедневная викторина',
  quiz_complete: 'Ежедневная викторина',
  quiz: 'Ежедневная викторина',
  guess_track: 'Угадай трек',
  daily_track: 'Угадай трек',
  guess_lyrics: 'Угадай строчку',
  reverse_track: 'Задом наперёд',
  speed_track: 'Трек 0.5x / 2.5x',
  daily_login: 'Ежедневный вход',
  shop_purchase: 'Покупка в магазине',
  shop: 'Покупка в магазине',
  promo_code: 'Промокод',
  achievement: 'Достижение',
  admin_adjust: 'Корректировка администратором',
  admin_grant: 'Начисление от администрации',
  community_post: 'Новая тема в сообществе',
  post_create: 'Создание темы',
  comment: 'Комментарий',
  comment_create: 'Комментарий в сообществе',
  creation_upload: 'Публикация работы',
  meme_upload: 'Публикация мема',
  xp_rollback: 'Откат XP при удалении/отклонении',
  registration: 'Регистрация',
};

const XP_SOURCE_LABELS_EN: Record<string, string> = {
  daily_quiz: 'Daily Quiz',
  quiz_complete: 'Daily Quiz',
  quiz: 'Daily Quiz',
  guess_track: 'Guess The Track',
  daily_track: 'Guess The Track',
  guess_lyrics: 'Guess The Lyric',
  reverse_track: 'Reverse Track',
  speed_track: '0.5x / 2.5x Track',
  daily_login: 'Daily Login',
  shop_purchase: 'Shop Purchase',
  shop: 'Shop Purchase',
  promo_code: 'Promo Code',
  achievement: 'Achievement',
  admin_adjust: 'Admin Adjustment',
  admin_grant: 'Admin Reward',
  community_post: 'Community Topic',
  post_create: 'Forum Topic',
  comment: 'Comment',
  comment_create: 'Community Comment',
  creation_upload: 'Creation Published',
  meme_upload: 'Meme Published',
  xp_rollback: 'XP Rollback (Deleted/Rejected)',
  registration: 'Registration',
};

const MOSCOW_12H_CYCLE_REGEX = /^\d{4}-\d{2}-\d{2}-(AM|PM)$/;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Returns the active 12-hour Moscow Time (UTC+3) game cycle:
 * - YYYY-MM-DD-AM for 00:00:00–11:59:59 MSK (resets at 12:00:00 MSK)
 * - YYYY-MM-DD-PM for 12:00:00–23:59:59 MSK (resets at 00:00:00 MSK next day)
 */
export function getMoscow12hCycle(nowMs: number = Date.now()): {
  cycleId: string;
  dateStr: string;
  half: 'AM' | 'PM';
  nextResetAt: string;
} {
  const mskDate = new Date(nowMs + MOSCOW_OFFSET_MS);
  const dateStr = mskDate.toISOString().slice(0, 10);
  const mskHour = mskDate.getUTCHours();
  const half: 'AM' | 'PM' = mskHour < 12 ? 'AM' : 'PM';
  const cycleId = `${dateStr}-${half}`;
  const nextResetAt = getNextMoscow12hResetIso(cycleId);
  return { cycleId, dateStr, half, nextResetAt };
}

export function isValidMoscow12hCycle(value: unknown): value is string {
  if (typeof value !== 'string' || !MOSCOW_12H_CYCLE_REGEX.test(value)) {
    return false;
  }
  const datePart = value.slice(0, 10);
  const parsed = Date.parse(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === datePart;
}

/**
 * Returns the exact UTC ISO timestamp of the next 00:00 or 12:00 MSK boundary
 * after the given YYYY-MM-DD-AM / YYYY-MM-DD-PM cycle.
 */
export function getNextMoscow12hResetIso(cycleId: string): string {
  if (!isValidMoscow12hCycle(cycleId)) {
    return getMoscow12hCycle().nextResetAt;
  }
  const datePart = cycleId.slice(0, 10);
  const isPm = cycleId.endsWith('-PM');
  // 00:00:00 MSK on datePart in UTC ms = UTC midnight - 3h
  const mskDayStartUtcMs = Date.parse(`${datePart}T00:00:00.000Z`) - MOSCOW_OFFSET_MS;
  const cycleStartUtcMs = mskDayStartUtcMs + (isPm ? TWELVE_HOURS_MS : 0);
  return new Date(cycleStartUtcMs + TWELVE_HOURS_MS).toISOString();
}

/**
 * Returns the immediately preceding 12-hour Moscow cycle ID.
 */
export function getPreviousMoscow12hCycle(cycleId: string): string {
  if (!isValidMoscow12hCycle(cycleId)) {
    return getPreviousMoscow12hCycle(getMoscow12hCycle().cycleId);
  }
  const datePart = cycleId.slice(0, 10);
  const isPm = cycleId.endsWith('-PM');
  const mskDayStartUtcMs = Date.parse(`${datePart}T00:00:00.000Z`) - MOSCOW_OFFSET_MS;
  const prevCycleMidUtcMs = mskDayStartUtcMs + (isPm ? 6 * 3600 * 1000 : -6 * 3600 * 1000);
  return getMoscow12hCycle(prevCycleMidUtcMs).cycleId;
}

/**
 * Fisher-Yates unbiased shuffle (never mutates input array).
 */
export function fisherYatesShuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Cleans track lyrics and extracts consecutive meaningful (prompt -> nextLine) pairs
 * for the "Угадай строчку" mini-game.
 */
export function extractLyricPairs(lyrics: string | null | undefined): Array<{ prompt: string; answer: string }> {
  if (!lyrics || typeof lyrics !== 'string') return [];

  let rawLines = lyrics
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Also support compact slash-separated lyrics (e.g. "line 1 / line 2")
  if (rawLines.length < 2 && lyrics.includes('/')) {
    rawLines = lyrics
      .split(/\s*\/\s*/)
      .map((l) => l.trim())
      .filter(Boolean);
  } else {
    // Expand inline slash-separated lines if a single line contains " / "
    const expanded: string[] = [];
    for (const line of rawLines) {
      if (line.includes(' / ')) {
        expanded.push(
          ...line
            .split(/\s+\/\s+/)
            .map((s) => s.trim())
            .filter(Boolean)
        );
      } else {
        expanded.push(line);
      }
    }
    rawLines = expanded;
  }

  const meaningful = rawLines
    .map((line) =>
      line
        .replace(/^\[[^\]]+\]\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((line) => {
      if (line.length < 5 || line.length > 160) return false;
      if (/^\[.*\]$/.test(line)) return false;
      if (/^\(?\s*(?:куплет|припев|бридж|интро|аутро|verse|chorus|bridge|intro|outro|hook|pre-chorus)\b/i.test(line)) {
        return false;
      }
      // Require at least 2 letter characters
      const letterCount = (line.match(/[a-zA-Zа-яА-ЯёЁ]/g) || []).length;
      return letterCount >= 4;
    });

  const pairs: Array<{ prompt: string; answer: string }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < meaningful.length - 1; i++) {
    const prompt = meaningful[i];
    const answer = meaningful[i + 1];
    const normPrompt = prompt.toLowerCase();
    const normAnswer = answer.toLowerCase();
    if (normPrompt === normAnswer) continue;
    const key = `${normPrompt}||${normAnswer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ prompt, answer });
  }

  return pairs;
}

/**
 * Translates current and legacy English XP transaction sources/details into clean Russian (or English).
 */
export function formatXpTransactionLabel(
  source: string | null | undefined,
  details: string | null | undefined,
  lang: 'ru' | 'en' = 'ru'
): { title: string; subtitle: string | null } {
  const srcKey = String(source || '').trim().toLowerCase();
  const rawDetails = String(details || '').trim();

  if (lang === 'en') {
    const title = XP_SOURCE_LABELS_EN[srcKey] || (srcKey ? srcKey.replace(/_/g, ' ') : 'XP Transaction');
    return { title, subtitle: rawDetails || null };
  }

  const baseTitle = XP_SOURCE_LABELS_RU[srcKey] || 'Операция с XP';
  if (!rawDetails) {
    return { title: baseTitle, subtitle: null };
  }

  // Legacy "Guess Track (2026-04-01-H0): Correct" / "Participation"
  const guessMatch = rawDetails.match(/^Guess Track\s*\(([^)]+)\)\s*:\s*(.+)$/i);
  if (guessMatch) {
    const outcomeRaw = guessMatch[2].trim().toLowerCase();
    const outcomeRu = outcomeRaw.includes('correct')
      ? 'Верный ответ'
      : outcomeRaw.includes('particip')
        ? 'Участие в раунде'
        : guessMatch[2].trim();
    return { title: 'Угадай трек', subtitle: outcomeRu };
  }

  // Legacy "Daily Quiz (2026-04-01): 4/5" or "Daily Quiz (2026-04-01): 4/5 (+10%)"
  const quizMatch = rawDetails.match(/^Daily Quiz\s*\(([^)]+)\)\s*:\s*(.+)$/i);
  if (quizMatch) {
    return { title: 'Ежедневная викторина', subtitle: `Результат: ${quizMatch[2].trim()}` };
  }

  // Legacy "Created post: ..."
  const postMatch = rawDetails.match(/^Created\s+post\s*:\s*(.+)$/i);
  if (postMatch) {
    return { title: 'Новая тема в сообществе', subtitle: postMatch[1].trim() };
  }

  // Legacy "Uploaded work: ..."
  const workMatch = rawDetails.match(/^Uploaded\s+work\s*:\s*(.+)$/i);
  if (workMatch) {
    return { title: 'Публикация работы', subtitle: workMatch[1].trim() };
  }

  // Legacy comments
  if (/^Posted\s+a\s+comment$/i.test(rawDetails)) {
    return { title: 'Комментарий в сообществе', subtitle: 'Ответ в обсуждении' };
  }
  if (/^Commented\s+on\s+gallery\s+creation$/i.test(rawDetails)) {
    return { title: 'Комментарий в галерее', subtitle: 'Отзыв к творческой работе' };
  }

  // Legacy "Purchased ..." / "Bought ..."
  const purchaseMatch = rawDetails.match(/^(?:Purchased|Bought)\s+(.+)$/i);
  if (purchaseMatch) {
    return { title: 'Покупка в магазине', subtitle: purchaseMatch[1].trim() };
  }

  // Legacy "Admin adjusted XP..." / "Admin grant..."
  if (/^Admin\b/i.test(rawDetails)) {
    const cleaned = rawDetails
      .replace(/^Admin\s+(?:adjusted|grant(?:ed)?|set)\s*:?\s*/i, '')
      .trim();
    return { title: 'Начисление от администрации', subtitle: cleaned || null };
  }

  // Legacy "Unlocked achievement: ..."
  const achMatch = rawDetails.match(/^(?:Unlocked\s+achievement|Achievement)\s*:\s*(.+)$/i);
  if (achMatch) {
    return { title: 'Достижение', subtitle: achMatch[1].trim() };
  }

  // Legacy "Daily login bonus"
  if (/daily\s*login/i.test(rawDetails)) {
    return { title: 'Ежедневный вход', subtitle: 'Бонус за активность' };
  }

  // Already clean Russian or readable custom subtitle
  return { title: baseTitle, subtitle: rawDetails };
}

export interface CustomShieldStyle {
  ru: string;
  en: string;
  bg: string;
  border: string;
  text: string;
  glow: string;
}

const HEX_OR_RGBA_COLOR_REGEX =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;

export function sanitizeCssColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return fallback;
  return HEX_OR_RGBA_COLOR_REGEX.test(trimmed) ? trimmed : fallback;
}

export function parseCustomShieldValue(raw: unknown): CustomShieldStyle | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('cshield:')) return null;
  try {
    const parsed = JSON.parse(trimmed.slice('cshield:'.length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const ru = String(parsed.ru || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const en = String(parsed.en || ru || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!ru && !en) return null;
    return {
      ru: ru || en,
      en: en || ru,
      bg: sanitizeCssColor(parsed.bg, '#1a1014'),
      border: sanitizeCssColor(parsed.border, '#821c2c'),
      text: sanitizeCssColor(parsed.text, '#f2bcc6'),
      glow: sanitizeCssColor(parsed.glow, 'rgba(130, 28, 44, 0.35)'),
    };
  } catch {
    return null;
  }
}

export function buildCustomShieldValue(spec: Partial<CustomShieldStyle>): string {
  const ru = String(spec.ru || spec.en || 'уникальный').replace(/\s+/g, ' ').trim().slice(0, 32) || 'уникальный';
  const en = String(spec.en || ru).replace(/\s+/g, ' ').trim().slice(0, 32) || ru;
  const payload: CustomShieldStyle = {
    ru,
    en,
    bg: sanitizeCssColor(spec.bg, '#1a1014'),
    border: sanitizeCssColor(spec.border, '#821c2c'),
    text: sanitizeCssColor(spec.text, '#f2bcc6'),
    glow: sanitizeCssColor(spec.glow, 'rgba(130, 28, 44, 0.35)'),
  };
  return `cshield:${JSON.stringify(payload)}`;
}

