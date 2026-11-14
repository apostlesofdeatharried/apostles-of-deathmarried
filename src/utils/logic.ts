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
