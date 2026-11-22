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
  // Base progression: Level 1 = 0 XP, Level 2 = 100 XP, Level 3 = 250 XP, etc.
  // Formula: XP needed for level L is 50 * (L - 1)^1.6
  let level = 1;
  while (true) {
    const nextThreshold = Math.floor(75 * Math.pow(level, 1.5));
    if (safeXp < nextThreshold) {
      const prevThreshold = level === 1 ? 0 : Math.floor(75 * Math.pow(level - 1, 1.5));
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

export function calculateQuizScore(totalQuestions: number, correctAnswers: number, timeSpentSeconds: number): {
  baseScore: number;
  speedBonus: number;
  totalXp: number;
} {
  if (totalQuestions <= 0 || correctAnswers <= 0) {
    return { baseScore: 0, speedBonus: 0, totalXp: 0 };
  }
  const accuracyRatio = Math.min(1, Math.max(0, correctAnswers / totalQuestions));
  const baseScore = Math.round(correctAnswers * 25);
  // Speed bonus if answered in under 30 seconds
  const speedBonus = timeSpentSeconds < 30 ? Math.round((30 - timeSpentSeconds) * 2 * accuracyRatio) : 0;
  const totalXp = baseScore + speedBonus;

  return {
    baseScore,
    speedBonus,
    totalXp,
  };
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
