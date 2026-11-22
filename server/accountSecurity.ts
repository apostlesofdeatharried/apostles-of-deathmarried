import crypto from 'crypto';

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MINUTES = 15;
export const USERNAME_COOLDOWN_DAYS = 14;
export const MAX_FEATURED_ACHIEVEMENTS = 4;

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'moderator',
  'mod',
  'staff',
  'api',
  'auth',
  'login',
  'register',
  'logout',
  'profile',
  'profiles',
  'settings',
  'shop',
  'archive',
  'games',
  'community',
  'creations',
  'guest',
  'anonymous',
  'null',
  'undefined',
  'me',
]);

export function normalizeUsername(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function validateUsername(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
  errorEn?: string;
} {
  const normalized = normalizeUsername(raw);
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: 'Укажите уникальный @username.',
      errorEn: 'Username is required.',
    };
  }
  if (normalized.length < 3) {
    return {
      valid: false,
      normalized,
      error: 'Username должен содержать минимум 3 символа.',
      errorEn: 'Username must be at least 3 characters.',
    };
  }
  if (normalized.length > 20) {
    return {
      valid: false,
      normalized,
      error: 'Username не может быть длиннее 20 символов.',
      errorEn: 'Username cannot exceed 20 characters.',
    };
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Username может содержать только латинские буквы, цифры, _ и - (начинается с буквы или цифры).',
      errorEn: 'Username can only contain Latin letters, numbers, _ and - (must start with a letter or number).',
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Этот username зарезервирован системой.',
      errorEn: 'This username is reserved.',
    };
  }
  return { valid: true, normalized };
}

export function validateDisplayName(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
  errorEn?: string;
} {
  if (typeof raw !== 'string') {
    return {
      valid: false,
      normalized: '',
      error: 'Укажите отображаемое имя (Display Name).',
      errorEn: 'Display Name is required.',
    };
  }
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    return {
      valid: false,
      normalized,
      error: 'Display Name должно содержать минимум 2 символа.',
      errorEn: 'Display Name must be at least 2 characters.',
    };
  }
  if (normalized.length > 36) {
    return {
      valid: false,
      normalized,
      error: 'Display Name не может превышать 36 символов.',
      errorEn: 'Display Name cannot exceed 36 characters.',
    };
  }
  // Reject control characters or HTML brackets
  if (/[\x00-\x1F\x7F<>]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Display Name содержит недопустимые символы.',
      errorEn: 'Display Name contains disallowed characters.',
    };
  }
  return { valid: true, normalized };
}

export function normalizeEmail(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

export function validateEmail(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
  errorEn?: string;
} {
  const normalized = normalizeEmail(raw);
  if (!normalized) {
    return {
      valid: false,
      normalized: '',
      error: 'Укажите адрес электронной почты (Email).',
      errorEn: 'Email address is required.',
    };
  }
  if (normalized.length > 254) {
    return {
      valid: false,
      normalized,
      error: 'Email слишком длинный.',
      errorEn: 'Email address is too long.',
    };
  }
  // Standard strict-enough email regex rejecting spaces and malformed domains
  const emailRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!emailRegex.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Введите корректный адрес электронной почты.',
      errorEn: 'Enter a valid email address.',
    };
  }
  return { valid: true, normalized };
}

export function validateRegistrationPassword(
  password: string,
  confirmPassword?: string
): { valid: boolean; error?: string; errorEn?: string } {
  if (typeof password !== 'string' || !password) {
    return {
      valid: false,
      error: 'Введите пароль.',
      errorEn: 'Password is required.',
    };
  }
  if (password.length < 6) {
    return {
      valid: false,
      error: 'Пароль должен содержать минимум 6 символов.',
      errorEn: 'Password must be at least 6 characters long.',
    };
  }
  if (password.length > 128) {
    return {
      valid: false,
      error: 'Пароль слишком длинный (максимум 128 символов).',
      errorEn: 'Password is too long (max 128 characters).',
    };
  }
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return {
      valid: false,
      error: 'Пароли не совпадают.',
      errorEn: 'Passwords do not match.',
    };
  }
  return { valid: true };
}

export function computeLoginLockout(
  nextFailedAttempts: number,
  nowMs: number = Date.now()
): {
  shouldLock: boolean;
  lockedUntil: string | null;
  remainingAttempts: number;
  lockoutMinutes: number;
} {
  if (nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    const multiplier = nextFailedAttempts >= 10 ? 2 : 1;
    const lockoutMinutes = LOGIN_LOCKOUT_MINUTES * multiplier;
    const lockedUntil = new Date(nowMs + lockoutMinutes * 60 * 1000).toISOString();
    return {
      shouldLock: true,
      lockedUntil,
      remainingAttempts: 0,
      lockoutMinutes,
    };
  }
  return {
    shouldLock: false,
    lockedUntil: null,
    remainingAttempts: Math.max(0, MAX_FAILED_LOGIN_ATTEMPTS - nextFailedAttempts),
    lockoutMinutes: 0,
  };
}

export function isAccountLocked(
  lockedUntil: string | null | undefined,
  nowMs: number = Date.now()
): { locked: boolean; retryAfterSeconds: number } {
  if (!lockedUntil) return { locked: false, retryAfterSeconds: 0 };
  const untilMs = Date.parse(lockedUntil);
  if (Number.isNaN(untilMs) || untilMs <= nowMs) {
    return { locked: false, retryAfterSeconds: 0 };
  }
  return {
    locked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((untilMs - nowMs) / 1000)),
  };
}

export function canChangeUsername(
  lastChangedAt: string | null | undefined,
  nowMs: number = Date.now(),
  cooldownDays: number = USERNAME_COOLDOWN_DAYS
): { allowed: boolean; nextAllowedAt: string | null; remainingDays: number } {
  if (!lastChangedAt) {
    return { allowed: true, nextAllowedAt: null, remainingDays: 0 };
  }
  const parsed = Date.parse(lastChangedAt.endsWith('Z') ? lastChangedAt : `${lastChangedAt.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed)) {
    return { allowed: true, nextAllowedAt: null, remainingDays: 0 };
  }
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const nextAllowedMs = parsed + cooldownMs;
  if (nowMs >= nextAllowedMs) {
    return { allowed: true, nextAllowedAt: null, remainingDays: 0 };
  }
  const remainingDays = Math.max(1, Math.ceil((nextAllowedMs - nowMs) / (24 * 60 * 60 * 1000)));
  return {
    allowed: false,
    nextAllowedAt: new Date(nextAllowedMs).toISOString(),
    remainingDays,
  };
}

/**
 * Verifies same-origin for cookie-authenticated mutating requests (CSRF defense-in-depth).
 * Requests with an explicit Authorization: Bearer token are not susceptible to ambient cookie CSRF.
 */
export function isSameOriginRequest(
  originHeader: string | undefined,
  refererHeader: string | undefined,
  hostHeader: string | undefined
): boolean {
  if (!hostHeader) return true;
  const cleanHost = hostHeader.toLowerCase().trim();
  const source = originHeader || refererHeader;
  // Non-browser API clients (curl, server-to-server) may omit both Origin and Referer
  if (!source) return true;
  try {
    const parsed = new URL(source);
    return parsed.host.toLowerCase() === cleanHost;
  } catch {
    return false;
  }
}

export function generateVerificationCode(): string {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(6, '0');
}

export function hashVerificationCode(code: string, salt: string = ''): string {
  return crypto.createHash('sha256').update(`${salt}:${code.trim()}`).digest('hex');
}

export interface AchievementMetrics {
  isRegistered?: boolean;
  gamesPlayed: number;
  guessTrackPlayed: number;
  guessTrackWins: number;
  quizPlayed: number;
  quizPerfectRuns: number;
  dailyStreak: number;
  totalXp: number;
  level: number;
  purchasesCount: number;
  equippedItemsCount: number;
  postsCount: number;
  commentsCount: number;
  creationsCount: number;
  followersCount: number;
  followingCount: number;
  hasCustomProfile?: boolean;
  accountAgeDays?: number;
}

/**
 * Pure server-authoritative achievement evaluator across all 26 achievements.
 * Never depends on client-supplied flags.
 */
export function evaluateAchievementSlugs(m: AchievementMetrics): string[] {
  const slugs: string[] = [];

  // Getting Started
  if (m.isRegistered) slugs.push('archive_initiate');
  if (m.hasCustomProfile) slugs.push('shadow_identity');
  if (m.gamesPlayed >= 1) slugs.push('first_blood');

  // Music / Guess The Track
  if (m.guessTrackWins >= 1) slugs.push('first_note');
  if (m.guessTrackWins >= 5) slugs.push('vinyl_hunter');
  if (m.guessTrackWins >= 15) slugs.push('phantom_ear');
  if (m.gamesPlayed >= 10) slugs.push('initiate_ritual');
  if (m.gamesPlayed >= 30) slugs.push('ritual_master');

  // Quiz / Discography Knowledge
  if (m.quizPlayed >= 1) slugs.push('quiz_seeker');
  if (m.quizPerfectRuns >= 1) slugs.push('lore_scholar');
  if (m.quizPerfectRuns >= 3) slugs.push('obsidian_oracle');
  if (m.quizPlayed >= 10) slugs.push('cathedral_historian');

  // Consistency / Daily Streaks
  if (m.dailyStreak >= 3) slugs.push('devoted_acolyte');
  if (m.dailyStreak >= 7) slugs.push('eternal_vigil');
  if (m.dailyStreak >= 14) slugs.push('midnight_devotion');
  if (m.dailyStreak >= 30) slugs.push('immortal_flame');

  // Collector / Customization Shop
  if (m.purchasesCount >= 1) slugs.push('collector');
  if (m.purchasesCount >= 5) slugs.push('relic_hoarder');
  if (m.purchasesCount >= 10) slugs.push('gothic_treasury');
  if (m.equippedItemsCount >= 3) slugs.push('dressed_in_velvet');

  // Community & Creations
  if (m.postsCount >= 1) slugs.push('first_chronicle');
  if (m.postsCount >= 3) slugs.push('voice_of_abyss');
  if (m.commentsCount >= 5) slugs.push('midnight_critic');
  if (m.creationsCount >= 1) slugs.push('gothic_artisan');
  if (m.followersCount >= 3 || m.followingCount >= 3) slugs.push('coven_circle');

  // Veteran & XP Milestones
  if (m.totalXp >= 500) slugs.push('dark_apostle');
  if (m.totalXp >= 1500 || m.level >= 8) slugs.push('archon_of_sound');

  return slugs;
}
