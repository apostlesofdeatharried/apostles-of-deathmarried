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

export const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;
export type EmailVerificationPurpose = 'register' | 'verify_existing';

export interface SignedEmailVerificationToken {
  verification_token: string;
  expires_at: number;
}

/**
 * Generates a stateless HMAC-SHA256 signed email verification token.
 * Stores only the salted SHA-256 hash of the 6-digit code inside the signed payload,
 * working reliably across Vercel serverless instances without shared RAM state.
 */
export function createSignedEmailVerificationToken(
  email: string,
  code: string,
  purpose: EmailVerificationPurpose,
  secret: string,
  userId?: string | null,
  nowMs: number = Date.now()
): SignedEmailVerificationToken {
  const normalizedEmail = normalizeEmail(email);
  const nonce = crypto.randomBytes(12).toString('hex');
  const codeHash = hashVerificationCode(code, `${nonce}:${normalizedEmail}`);
  const expiresAt = nowMs + EMAIL_VERIFICATION_TTL_MS;
  const payloadObj: Record<string, unknown> = {
    email: normalizedEmail,
    code_hash: codeHash,
    purpose,
    nonce,
    exp: expiresAt,
  };
  if (userId) {
    payloadObj.uid = userId;
  }
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret || 'apostles-email-verify-secret')
    .update(`email_verify:${payload}`)
    .digest('base64url');

  return {
    verification_token: `ev1.${payload}.${sig}`,
    expires_at: expiresAt,
  };
}

/**
 * Verifies a stateless HMAC-SHA256 signed email verification token against email, 6-digit code,
 * expected purpose, optional user ID, and expiration timestamp.
 */
export function verifySignedEmailVerificationToken(
  token: unknown,
  email: string,
  code: unknown,
  expectedPurpose: EmailVerificationPurpose,
  secret: string,
  expectedUserId?: string | null,
  nowMs: number = Date.now()
): { valid: boolean; email?: string; error?: string } {
  if (typeof token !== 'string' || !token.startsWith('ev1.')) {
    return { valid: false, error: 'Сначала запросите 6-значный код подтверждения на почту.' };
  }
  const trimmedCode = String(code ?? '').trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    return { valid: false, error: 'Введите корректный 6-значный код из письма.' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Некорректный токен подтверждения почты. Запросите код заново.' };
  }
  const [, payload, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret || 'apostles-email-verify-secret')
    .update(`email_verify:${payload}`)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig);
  const sigBufB = Buffer.from(expectedSig);
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return { valid: false, error: 'Токен подтверждения почты недействителен. Запросите код заново.' };
  }

  let decoded: {
    email?: string;
    code_hash?: string;
    purpose?: string;
    nonce?: string;
    exp?: number;
    uid?: string;
  } | null = null;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'Ошибка чтения токена подтверждения. Запросите код заново.' };
  }

  if (
    !decoded ||
    typeof decoded.email !== 'string' ||
    typeof decoded.code_hash !== 'string' ||
    typeof decoded.nonce !== 'string' ||
    typeof decoded.exp !== 'number'
  ) {
    return { valid: false, error: 'Недействительный токен подтверждения. Запросите код заново.' };
  }

  if (decoded.purpose !== expectedPurpose) {
    return { valid: false, error: 'Токен подтверждения предназначен для другого действия.' };
  }
  if (expectedUserId && decoded.uid !== expectedUserId) {
    return { valid: false, error: 'Токен подтверждения не соответствует вашему аккаунту.' };
  }
  if (nowMs > decoded.exp) {
    return { valid: false, error: 'Срок действия кода истёк (10 минут). Запросите новый код.' };
  }

  const normalizedEmail = normalizeEmail(email);
  if (decoded.email !== normalizedEmail) {
    return { valid: false, error: 'Email изменился после отправки кода. Запросите код на новый адрес.' };
  }

  const expectedCodeHash = hashVerificationCode(trimmedCode, `${decoded.nonce}:${normalizedEmail}`);
  const hashBufA = Buffer.from(decoded.code_hash, 'utf8');
  const hashBufB = Buffer.from(expectedCodeHash, 'utf8');
  if (hashBufA.length !== hashBufB.length || !crypto.timingSafeEqual(hashBufA, hashBufB)) {
    return { valid: false, error: 'Неверный 6-значный код подтверждения.' };
  }

  return { valid: true, email: normalizedEmail };
}

export function normalizePromoCode(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

export const MAX_REGISTRATIONS_PER_IP_24H = 2;
export const MAX_REGISTRATIONS_PER_DEVICE_24H = 2;
const CAPTCHA_TTL_MS = 10 * 60 * 1000;

/**
 * Privacy-preserving keyed hash for IP addresses and client fingerprints in registration_guards.
 */
export function hashGuardIdentifier(value: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret || 'apostles-guard-salt')
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, 48);
}

export interface SignedCaptchaChallenge {
  question_ru: string;
  question_en: string;
  captcha_token: string;
  expires_at: number;
}

/**
 * Generates a stateless HMAC-signed anti-bot arithmetic challenge.
 * Works identically across serverless Vercel instances without shared RAM state.
 */
export function createSignedCaptcha(secret: string, nowMs: number = Date.now()): SignedCaptchaChallenge {
  const op = crypto.randomInt(0, 3); // 0: add, 1: subtract, 2: small multiply
  let a: number;
  let b: number;
  let expected: number;
  let expr: string;

  if (op === 0) {
    a = crypto.randomInt(4, 18);
    b = crypto.randomInt(3, 15);
    expected = a + b;
    expr = `${a} + ${b}`;
  } else if (op === 1) {
    a = crypto.randomInt(10, 25);
    b = crypto.randomInt(2, a - 2);
    expected = a - b;
    expr = `${a} − ${b}`;
  } else {
    a = crypto.randomInt(2, 7);
    b = crypto.randomInt(2, 6);
    expected = a * b;
    expr = `${a} × ${b}`;
  }

  const expiresAt = nowMs + CAPTCHA_TTL_MS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = Buffer.from(JSON.stringify({ expected, exp: expiresAt, nonce })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret || 'apostles-captcha-secret')
    .update(`captcha:${payload}`)
    .digest('base64url');

  return {
    question_ru: `Сколько будет ${expr}?`,
    question_en: `What is ${expr}?`,
    captcha_token: `cap1.${payload}.${sig}`,
    expires_at: expiresAt,
  };
}

/**
 * Verifies a stateless HMAC-signed anti-bot captcha token and numeric answer.
 */
export function verifySignedCaptcha(
  token: unknown,
  answer: unknown,
  secret: string,
  nowMs: number = Date.now()
): { valid: boolean; error?: string } {
  if (typeof token !== 'string' || !token.startsWith('cap1.')) {
    return { valid: false, error: 'Пройдите антибот-проверку перед регистрацией.' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Некорректный токен проверки. Обновите капчу.' };
  }
  const [, payload, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret || 'apostles-captcha-secret')
    .update(`captcha:${payload}`)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig);
  const sigBufB = Buffer.from(expectedSig);
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    return { valid: false, error: 'Подпись капчи недействительна. Обновите проверку.' };
  }

  let decoded: { expected?: number; exp?: number } | null = null;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'Ошибка чтения капчи. Обновите проверку.' };
  }

  if (!decoded || typeof decoded.expected !== 'number' || typeof decoded.exp !== 'number') {
    return { valid: false, error: 'Недействительная капча. Обновите проверку.' };
  }
  if (nowMs > decoded.exp) {
    return { valid: false, error: 'Срок действия проверки истёк. Нажмите «Обновить» и решите пример снова.' };
  }

  const parsedAnswer = Number(String(answer ?? '').trim());
  if (!Number.isFinite(parsedAnswer) || parsedAnswer !== decoded.expected) {
    return { valid: false, error: 'Неверный ответ антибот-проверки. Попробуйте ещё раз.' };
  }

  return { valid: true };
}

export interface BulkQuizItemInput {
  question_ru: string;
  question_en: string;
  options: string[];
  correct_index: number;
  explanation_ru: string;
  explanation_en: string;
  difficulty: number;
}

/**
 * Parses bulk quiz questions from either JSON array or pipe-separated lines:
 *   Question | Opt1 | Opt2 | Opt3 | Opt4 | CorrectNum(1-4) | Hint (optional) | Difficulty(1-3, optional)
 */
export function parseBulkQuizInput(raw: unknown): {
  items: BulkQuizItemInput[];
  errors: string[];
} {
  const items: BulkQuizItemInput[] = [];
  const errors: string[] = [];

  const normalizeEntry = (entry: any, rowLabel: string) => {
    const questionRu = String(entry?.question_ru ?? entry?.question ?? '').trim();
    const questionEn = String(entry?.question_en ?? questionRu).trim();
    const rawOptions = Array.isArray(entry?.options) ? entry.options : [];
    const cleanOptions = rawOptions.map((o: unknown) => String(o ?? '').trim()).filter(Boolean);
    let correctIndex = Number(entry?.correct_index);
    if (!Number.isInteger(correctIndex) && entry?.correct_number !== undefined) {
      correctIndex = Number(entry.correct_number) - 1;
    }
    const explanationRu = String(entry?.explanation_ru ?? entry?.explanation ?? entry?.hint ?? '').trim();
    const explanationEn = String(entry?.explanation_en ?? explanationRu).trim();
    const difficulty = Math.max(1, Math.min(3, Math.round(Number(entry?.difficulty) || 2)));

    if (!questionRu) {
      errors.push(`${rowLabel}: пустой текст вопроса`);
      return;
    }
    if (cleanOptions.length < 2 || cleanOptions.length > 6) {
      errors.push(`${rowLabel}: нужно от 2 до 6 вариантов ответа`);
      return;
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= cleanOptions.length) {
      errors.push(`${rowLabel}: некорректный индекс правильного ответа`);
      return;
    }

    items.push({
      question_ru: questionRu,
      question_en: questionEn || questionRu,
      options: cleanOptions,
      correct_index: correctIndex,
      explanation_ru: explanationRu,
      explanation_en: explanationEn,
      difficulty,
    });
  };

  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => normalizeEntry(entry, `Элемент #${i + 1}`));
    return { items, errors };
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return { items, errors: ['Передайте список вопросов (JSON-массив или строки через «|»).'] };
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        parsed.forEach((entry, i) => normalizeEntry(entry, `Элемент #${i + 1}`));
        return { items, errors };
      }
    } catch (e: any) {
      return { items, errors: [`Ошибка синтаксиса JSON: ${e?.message || 'invalid JSON'}`] };
    }
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  lines.forEach((line, i) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 6) {
      errors.push(`Строка #${i + 1}: формат «Вопрос | А | Б | В | Г | Номер(1-4) | Подсказка»`);
      return;
    }
    const [question, opt0, opt1, opt2, opt3, correctRaw, hint = '', diffRaw = '2'] = parts;
    const opts = [opt0, opt1, opt2, opt3].filter(Boolean);
    const num = Number(correctRaw);
    // Accept 1-based (1..4) as documented; if 0 given treat as index 0
    const correctIndex = Number.isInteger(num) ? (num >= 1 ? num - 1 : num) : -1;
    normalizeEntry(
      {
        question_ru: question,
        question_en: question,
        options: opts,
        correct_index: correctIndex,
        explanation_ru: hint,
        explanation_en: hint,
        difficulty: Number(diffRaw) || 2,
      },
      `Строка #${i + 1}`
    );
  });

  return { items, errors };
}

export type AchievementDifficultyTier = 'easy' | 'medium' | 'hard';
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AchievementDefinition {
  id: string;
  slug: string;
  title_ru: string;
  title_en: string;
  desc_ru: string;
  desc_en: string;
  condition_ru: string;
  condition_en: string;
  category: string;
  rarity: AchievementRarity;
  difficulty_tier: AchievementDifficultyTier;
  is_secret: 0 | 1;
  icon: string;
  xp_reward: number;
}

/**
 * Single-source canonical catalog of all 52 achievements across 3 balanced difficulty tiers:
 * - Easy ('easy'): 10–25 XP (starter 'archive_initiate' stays 0 XP so newly registered accounts start at 0 XP;
 *   aligns with a single mini-game round 15–20 XP and shop common tier 100–250 XP)
 * - Medium ('medium'): 50–150 XP (aligns with 1–2 Rare or 1 Epic shop item 400–850 XP across several days)
 * - Hard ('hard'): 250–800 XP (long-term mastery & community contribution without flooding the XP economy)
 * All 35 legacy `id` and `slug` identifiers are preserved 1:1 so existing user unlocks stay intact.
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementDefinition[] = [
  // =========================================================================
  // EASY ('easy') — 16 achievements (1 starter at 0 XP + 15 in 10–25 XP)
  // =========================================================================
  {
    id: 'ach_archive_initiate',
    slug: 'archive_initiate',
    title_ru: 'Участник архива',
    title_en: 'Archive Member',
    desc_ru: 'Создайте свой аккаунт в сообществе Apostles of deathmarried',
    desc_en: 'Create your Apostles of deathmarried account',
    condition_ru: 'Зарегистрироваться на сайте',
    condition_en: 'Register an account',
    category: 'getting_started',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'moon',
    xp_reward: 0,
  },
  {
    id: 'ach_first_listen',
    slug: 'first_listen',
    title_ru: 'Первый звук',
    title_en: 'First Echo',
    desc_ru: 'Прослушайте любую композицию в плеере архива до конца',
    desc_en: 'Listen to any archive track to completion',
    condition_ru: 'Дослушать 1 трек в архиве',
    condition_en: 'Complete 1 archive track',
    category: 'music',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'play',
    xp_reward: 15,
  },
  {
    id: 'ach_lyrics_reader',
    slug: 'lyrics_reader',
    title_ru: 'Между строк',
    title_en: 'Between the Lines',
    desc_ru: 'Откройте текст песни у любого трека или сингла в дискографии',
    desc_en: 'Open lyrics for any track or single in the archive',
    condition_ru: 'Открыть текст песни',
    condition_en: 'Open track lyrics once',
    category: 'music',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'book-open',
    xp_reward: 15,
  },
  {
    id: 'ach_easy_first_reply',
    slug: 'easy_first_reply',
    title_ru: 'Первый отклик',
    title_en: 'First Reply',
    desc_ru: 'Оставьте свой первый комментарий в обсуждении релиза, темы или творчества',
    desc_en: 'Post your first reply in a discussion',
    condition_ru: 'Оставить 1 комментарий',
    condition_en: 'Write 1 comment',
    category: 'community',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'message-square',
    xp_reward: 15,
  },
  {
    id: 'ach_shadow_identity',
    slug: 'shadow_identity',
    title_ru: 'Личный почерк',
    title_en: 'Personal Mark',
    desc_ru: 'Заполните раздел «О себе», статус, любимый трек или загрузите свой аватар',
    desc_en: 'Customize your profile bio, status, favorite track, or avatar',
    condition_ru: 'Оформить профиль (био, статус или аватар)',
    condition_en: 'Customize your profile',
    category: 'getting_started',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'feather',
    xp_reward: 15,
  },
  {
    id: 'ach_first_blood',
    slug: 'first_blood',
    title_ru: 'Первый шаг',
    title_en: 'First Step',
    desc_ru: 'Сыграйте в любое ежедневное испытание архива',
    desc_en: 'Play your first interactive challenge',
    condition_ru: 'Завершить 1 игру',
    condition_en: 'Complete 1 game',
    category: 'getting_started',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'play',
    xp_reward: 15,
  },
  {
    id: 'ach_share_card_first',
    slug: 'share_card_first',
    title_ru: 'Вестник архива',
    title_en: 'Archive Herald',
    desc_ru: 'Сохраните PNG-карточку с цитатой, результатом игры или профилем',
    desc_en: 'Save a PNG share card of lyrics, game result, or profile',
    condition_ru: 'Скачать PNG-карточку',
    condition_en: 'Save 1 PNG share card',
    category: 'community',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'sparkles',
    xp_reward: 15,
  },
  {
    id: 'ach_quiz_seeker',
    slug: 'quiz_seeker',
    title_ru: 'Искатель фактов',
    title_en: 'Lore Seeker',
    desc_ru: 'Завершите первую ежедневную викторину архива',
    desc_en: 'Complete your first Daily Quiz',
    condition_ru: 'Пройти 1 ежедневную викторину',
    condition_en: 'Complete 1 Daily Quiz',
    category: 'quiz',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'book-open',
    xp_reward: 15,
  },
  {
    id: 'ach_collector',
    slug: 'collector',
    title_ru: 'Коллекционер',
    title_en: 'Collector',
    desc_ru: 'Приобретите первый предмет в магазине кастомизации',
    desc_en: 'Acquire your first item in the XP Shop',
    condition_ru: 'Купить 1 предмет в магазине',
    condition_en: 'Buy 1 shop item',
    category: 'collector',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'tag',
    xp_reward: 15,
  },
  {
    id: 'ach_first_note',
    slug: 'first_note',
    title_ru: 'Узнанный аккорд',
    title_en: 'Recognized Chord',
    desc_ru: 'Впервые угадайте трек дня по 5-секундному отрывку',
    desc_en: 'Correctly guess a Daily Track from its 5-second snippet',
    condition_ru: '1 победа в «Угадай трек»',
    condition_en: '1 Guess The Track win',
    category: 'music',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'music',
    xp_reward: 20,
  },
  {
    id: 'ach_first_chronicle',
    slug: 'first_chronicle',
    title_ru: 'Первая запись',
    title_en: 'First Chronicle',
    desc_ru: 'Создайте свою первую тему на форуме сообщества',
    desc_en: 'Publish your first community forum topic',
    condition_ru: 'Создать 1 тему на форуме',
    condition_en: 'Create 1 forum topic',
    category: 'community',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'message-square',
    xp_reward: 20,
  },
  {
    id: 'ach_easy_avid_reader',
    slug: 'easy_avid_reader',
    title_ru: 'Читатель форума',
    title_en: 'Forum Reader',
    desc_ru: 'Откройте и прочитайте любое обсуждение на форуме сообщества',
    desc_en: 'Open and read any topic in the community forum',
    condition_ru: 'Прочитать 1 тему на форуме',
    condition_en: 'Read 1 community topic',
    category: 'community',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'book-open',
    xp_reward: 15,
  },
  {
    id: 'ach_secret_first_code',
    slug: 'secret_first_code',
    title_ru: 'Первый код',
    title_en: 'First Code',
    desc_ru: 'Вы нашли и активировали свой первый секретный промокод',
    desc_en: 'Redeem your first promo code',
    condition_ru: 'Активировать любой промокод',
    condition_en: 'Redeem any promo code',
    category: 'secret',
    rarity: 'rare',
    difficulty_tier: 'easy',
    is_secret: 1,
    icon: 'tag',
    xp_reward: 20,
  },
  {
    id: 'ach_track_duo',
    slug: 'track_duo',
    title_ru: 'Двойная проба',
    title_en: 'Double Trial',
    desc_ru: 'Попробуйте как минимум 2 разных игровых режима архива',
    desc_en: 'Play at least 2 different archive game modes',
    condition_ru: 'Сыграть в 2 разных игры',
    condition_en: 'Play 2 distinct games',
    category: 'music',
    rarity: 'common',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'compass',
    xp_reward: 20,
  },
  {
    id: 'ach_dressed_in_velvet',
    slug: 'dressed_in_velvet',
    title_ru: 'Стиль архива',
    title_en: 'Archive Style',
    desc_ru: 'Одновременно экипируйте 3 элемента оформления профиля',
    desc_en: 'Equip 3 customization layers simultaneously',
    condition_ru: 'Экипировать 3 предмета одновременно',
    condition_en: 'Equip 3 items at once',
    category: 'collector',
    rarity: 'rare',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'sparkles',
    xp_reward: 20,
  },
  {
    id: 'ach_coven_circle',
    slug: 'coven_circle',
    title_ru: 'Свой круг',
    title_en: 'Inner Circle',
    desc_ru: 'Наберите 3 подписчиков или подпишитесь на 3 участников',
    desc_en: 'Reach 3 followers or follow 3 community members',
    condition_ru: '3 подписчика или 3 подписки',
    condition_en: '3 followers or following',
    category: 'community',
    rarity: 'rare',
    difficulty_tier: 'easy',
    is_secret: 0,
    icon: 'users',
    xp_reward: 25,
  },

  // =========================================================================
  // MEDIUM ('medium') — 19 achievements (50–150 XP)
  // =========================================================================
  {
    id: 'ach_devoted_acolyte',
    slug: 'devoted_acolyte',
    title_ru: 'Преданный слушатель',
    title_en: 'Devoted Listener',
    desc_ru: 'Поддерживайте серию ежедневной активности 5 дней подряд по МСК',
    desc_en: 'Maintain a 5-day daily streak',
    category: 'consistency',
    condition_ru: 'Серия 5 дней подряд',
    condition_en: '5-day daily streak',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'calendar',
    xp_reward: 60,
  },
  {
    id: 'ach_secret_curious_rose',
    slug: 'secret_curious_rose',
    title_ru: 'Любопытный',
    title_en: 'Curious Mind',
    desc_ru: 'Вы нашли пасхалку и нажали 5 раз на спрятанную деталь в оформлении сайта',
    desc_en: 'Click 5 times on the hidden rose detail in the header',
    condition_ru: 'Нажать 5 раз на скрытую розу в шапке сайта',
    condition_en: 'Click 5 times on the hidden rose emblem',
    category: 'secret',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 1,
    icon: 'eye',
    xp_reward: 50,
  },
  {
    id: 'ach_initiate_ritual',
    slug: 'initiate_ritual',
    title_ru: 'Чуткий слух',
    title_en: 'Musical Ear',
    desc_ru: 'Завершите 10 раундов в ежедневных играх архива',
    desc_en: 'Complete 10 interactive game sessions',
    condition_ru: 'Сыграть 10 игр',
    condition_en: 'Play 10 games',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'headphones',
    xp_reward: 70,
  },
  {
    id: 'ach_midnight_critic',
    slug: 'midnight_critic',
    title_ru: 'Ночной собеседник',
    title_en: 'Nocturnal Critic',
    desc_ru: 'Оставьте 10 комментариев в обсуждениях сообщества и релизов',
    desc_en: 'Post 10 comments across discussions and releases',
    condition_ru: 'Оставить 10 комментариев',
    condition_en: 'Write 10 comments',
    category: 'community',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'feather',
    xp_reward: 70,
  },
  {
    id: 'ach_vinyl_hunter',
    slug: 'vinyl_hunter',
    title_ru: 'Охотник за винилом',
    title_en: 'Vinyl Hunter',
    desc_ru: 'Угадайте 5 ежедневных композиций deathmarried в «Угадай трек»',
    desc_en: 'Guess 5 daily deathmarried tracks correctly',
    condition_ru: '5 побед в «Угадай трек»',
    condition_en: '5 Guess The Track wins',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'disc',
    xp_reward: 80,
  },
  {
    id: 'ach_voice_of_abyss',
    slug: 'voice_of_abyss',
    title_ru: 'Голос сообщества',
    title_en: 'Community Voice',
    desc_ru: 'Создайте 3 записи на форуме сообщества',
    desc_en: 'Create 3 community forum discussions',
    condition_ru: 'Создать 3 темы на форуме',
    condition_en: 'Create 3 forum topics',
    category: 'community',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'message-square',
    xp_reward: 80,
  },
  {
    id: 'ach_gothic_artisan',
    slug: 'gothic_artisan',
    title_ru: 'Творец',
    title_en: 'Creator',
    desc_ru: 'Опубликуйте свою работу в творческой галерее и пройдите модерацию',
    desc_en: 'Have your work approved in the Creations gallery',
    condition_ru: '1 одобренная работа в галерее',
    condition_en: '1 approved creation',
    category: 'community',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'sparkles',
    xp_reward: 85,
  },
  {
    id: 'ach_discography_listener',
    slug: 'discography_listener',
    title_ru: 'Хранитель каталога',
    title_en: 'Catalog Keeper',
    desc_ru: 'Прослушайте до конца 3 разные аудиокомпозиции в плеере архива',
    desc_en: 'Listen to 3 unique playable tracks in the archive to completion',
    condition_ru: 'Дослушать 3 разных трека',
    condition_en: 'Complete 3 unique tracks',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'disc',
    xp_reward: 90,
  },
  {
    id: 'ach_all_games_explorer',
    slug: 'all_games_explorer',
    title_ru: 'Пять ритуалов',
    title_en: 'Five Rituals',
    desc_ru: 'Сыграйте хотя бы по одному разу во все 5 игр архива',
    desc_en: 'Play every one of the 5 archive games at least once',
    condition_ru: 'Сыграть во все 5 игр',
    condition_en: 'Play all 5 game modes',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'compass',
    xp_reward: 90,
  },
  {
    id: 'ach_lyrics_hunter',
    slug: 'lyrics_hunter',
    title_ru: 'Хранитель строчек',
    title_en: 'Verse Keeper',
    desc_ru: 'Одержите 5 побед в игре «Угадай строчку»',
    desc_en: 'Win 5 rounds in Guess the Lyrics',
    condition_ru: '5 побед в «Угадай строчку»',
    condition_en: '5 Guess Lyrics wins',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'feather',
    xp_reward: 95,
  },
  {
    id: 'ach_reverse_decoder',
    slug: 'reverse_decoder',
    title_ru: 'Ловец реверса',
    title_en: 'Reverse Decoder',
    desc_ru: 'Одержите 5 побед в игре «Задом наперёд»',
    desc_en: 'Win 5 rounds in Reverse Track',
    condition_ru: '5 побед в «Задом наперёд»',
    condition_en: '5 Reverse Track wins',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'headphones',
    xp_reward: 100,
  },
  {
    id: 'ach_speed_runner',
    slug: 'speed_runner',
    title_ru: 'Повелитель темпа',
    title_en: 'Tempo Weaver',
    desc_ru: 'Одержите 5 побед в испытании «Трек 0.5x / 2.5x»',
    desc_en: 'Win 5 rounds in Speed Track 0.5x / 2.5x',
    condition_ru: '5 побед в «Трек 0.5x / 2.5x»',
    condition_en: '5 Speed Track wins',
    category: 'music',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'zap',
    xp_reward: 100,
  },
  {
    id: 'ach_lore_scholar',
    slug: 'lore_scholar',
    title_ru: 'Знаток дискографии',
    title_en: 'Discography Connoisseur',
    desc_ru: 'Пройдите ежедневную викторину без единой ошибки',
    desc_en: 'Achieve a perfect score in Daily Quiz',
    condition_ru: '100% правильных ответов в викторине',
    condition_en: 'Perfect score in Daily Quiz',
    category: 'quiz',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'award',
    xp_reward: 110,
  },
  {
    id: 'ach_relic_hoarder',
    slug: 'relic_hoarder',
    title_ru: 'Собиратель реликвий',
    title_en: 'Relic Curator',
    desc_ru: 'Соберите 5 предметов кастомизации в своей коллекции',
    desc_en: 'Own 5 customization items',
    condition_ru: 'Собрать 5 предметов коллекции',
    condition_en: 'Own 5 shop items',
    category: 'collector',
    rarity: 'rare',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'gem',
    xp_reward: 100,
  },
  {
    id: 'ach_win_streak_5',
    slug: 'win_streak_5',
    title_ru: 'Пять точных нот',
    title_en: 'Five in a Row',
    desc_ru: 'Одержите 5 побед подряд в играх архива без поражений',
    desc_en: 'Win 5 archive games in a row',
    condition_ru: 'Серия из 5 побед подряд в играх',
    condition_en: '5 consecutive game wins',
    category: 'music',
    rarity: 'epic',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'flame',
    xp_reward: 120,
  },
  {
    id: 'ach_cathedral_historian',
    slug: 'cathedral_historian',
    title_ru: 'Летописец свода',
    title_en: 'Cathedral Historian',
    desc_ru: 'Завершите 10 ежедневных викторин архива',
    desc_en: 'Complete 10 Daily Quizzes',
    condition_ru: 'Пройти 10 викторин',
    condition_en: 'Complete 10 Daily Quizzes',
    category: 'quiz',
    rarity: 'epic',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'compass',
    xp_reward: 110,
  },
  {
    id: 'ach_eternal_vigil',
    slug: 'eternal_vigil',
    title_ru: 'Декада в ритме',
    title_en: 'Ten Nights',
    desc_ru: 'Поддерживайте серию ежедневной активности 10 дней подряд по МСК',
    desc_en: 'Maintain a 10-day daily streak',
    condition_ru: 'Серия 10 дней подряд',
    condition_en: '10-day daily streak',
    category: 'consistency',
    rarity: 'epic',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'shield',
    xp_reward: 125,
  },
  {
    id: 'ach_dark_apostle',
    slug: 'dark_apostle',
    title_ru: 'Мастер звука',
    title_en: 'Sound Master',
    desc_ru: 'Наберите 1000 суммарных очков опыта (Total XP)',
    desc_en: 'Attain 1000 lifetime Total XP',
    condition_ru: 'Набрать 1000 Total XP',
    condition_en: 'Reach 1000 Total XP',
    category: 'veteran',
    rarity: 'epic',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'trophy',
    xp_reward: 130,
  },
  {
    id: 'ach_all_games_winner',
    slug: 'all_games_winner',
    title_ru: 'Пятикратный триумф',
    title_en: 'Fivefold Triumph',
    desc_ru: 'Победите хотя бы по одному разу во всех 5 игровых режимах архива',
    desc_en: 'Win at least once in each of all 5 game modes',
    condition_ru: 'Победить в каждой из 5 игр',
    condition_en: 'Win in all 5 game modes',
    category: 'music',
    rarity: 'epic',
    difficulty_tier: 'medium',
    is_secret: 0,
    icon: 'crown',
    xp_reward: 150,
  },

  // =========================================================================
  // HARD ('hard') — 17 achievements (250–800 XP)
  // =========================================================================
  {
    id: 'ach_hard_community_reader',
    slug: 'hard_community_reader',
    title_ru: 'Хроникёр форума',
    title_en: 'Forum Chronicler',
    desc_ru: 'Опубликуйте 5 одобренных тем на форуме или оставьте 20 комментариев',
    desc_en: 'Publish 5 approved forum topics or write 20 comments',
    condition_ru: '5 одобренных тем или 20 комментариев',
    condition_en: '5 approved topics or 20 comments',
    category: 'community',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'book-open',
    xp_reward: 300,
  },
  {
    id: 'ach_secret_midnight_visitor',
    slug: 'secret_midnight_visitor',
    title_ru: 'Полуночник',
    title_en: 'Midnight Visitor',
    desc_ru: 'Вы заглянули в архив в самый тихий час — с 00:00 до 00:15 по МСК',
    desc_en: 'Visit the archive between 00:00 and 00:15 Moscow time',
    condition_ru: 'Зайти на сайт с 00:00 до 00:15 по МСК',
    condition_en: 'Visit between 00:00 and 00:15 MSK',
    category: 'secret',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 1,
    icon: 'moon',
    xp_reward: 250,
  },
  {
    id: 'ach_phantom_ear',
    slug: 'phantom_ear',
    title_ru: 'Абсолютный слух',
    title_en: 'Phantom Ear',
    desc_ru: 'Угадайте 15 ежедневных композиций по 5-секундному фрагменту',
    desc_en: 'Guess 15 daily tracks from 5-second snippets',
    condition_ru: '15 побед в «Угадай трек»',
    condition_en: '15 Guess The Track wins',
    category: 'music',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'headphones',
    xp_reward: 350,
  },
  {
    id: 'ach_secret_flawless_quiz',
    slug: 'secret_flawless_quiz',
    title_ru: 'Без права на ошибку',
    title_en: 'Flawless Run',
    desc_ru: 'Безупречная эрудиция — пройдите ежедневную викторину на 100% трижды',
    desc_en: 'Complete Daily Quiz with a flawless 100% score 3 times',
    condition_ru: '3 идеальных прохождения викторины',
    condition_en: '3 perfect Daily Quiz runs',
    category: 'secret',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 1,
    icon: 'crown',
    xp_reward: 350,
  },
  {
    id: 'ach_ritual_master',
    slug: 'ritual_master',
    title_ru: 'Мастер испытаний',
    title_en: 'Trial Master',
    desc_ru: 'Одержите 20 побед в любых ежедневных играх архива',
    desc_en: 'Win 20 archive game challenges',
    condition_ru: 'Одержать 20 побед в играх',
    condition_en: 'Win 20 games',
    category: 'music',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'zap',
    xp_reward: 350,
  },
  {
    id: 'ach_creation_idol',
    slug: 'creation_idol',
    title_ru: 'Кумир галереи',
    title_en: 'Gallery Idol',
    desc_ru: 'Соберите 10 роз от других участников на ваших одобренных работах',
    desc_en: 'Receive 10 rose reactions from others on approved creations',
    condition_ru: 'Получить 10 роз на одобренных работах',
    condition_en: '10 rose reactions on creations',
    category: 'community',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'sparkles',
    xp_reward: 380,
  },
  {
    id: 'ach_secret_on_repeat',
    slug: 'secret_on_repeat',
    title_ru: 'Резонанс слуха',
    title_en: 'Audio Resonance',
    desc_ru: 'Прослушайте 3 разные композиции до конца и одержите 6 побед в аудио-играх',
    desc_en: 'Complete 3 unique archive tracks and win 6 audio-based games',
    condition_ru: 'Дослушать 3 трека и выиграть 6 аудио-игр',
    condition_en: 'Complete 3 tracks & win 6 audio games',
    category: 'secret',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 1,
    icon: 'disc',
    xp_reward: 350,
  },
  {
    id: 'ach_obsidian_oracle',
    slug: 'obsidian_oracle',
    title_ru: 'Обсидиановый оракул',
    title_en: 'Obsidian Oracle',
    desc_ru: 'Пройдите ежедневную викторину без ошибок 5 раз',
    desc_en: 'Score 100% in Daily Quiz 5 times',
    condition_ru: '5 идеальных прохождений викторины',
    condition_en: '5 perfect Daily Quiz runs',
    category: 'quiz',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'eye',
    xp_reward: 420,
  },
  {
    id: 'ach_midnight_devotion',
    slug: 'midnight_devotion',
    title_ru: 'Полуночная вахта',
    title_en: 'Midnight Vigil',
    desc_ru: 'Возвращайтесь в архив 21 день подряд без перерыва',
    desc_en: 'Maintain a 21-day daily streak',
    condition_ru: 'Серия 21 день подряд',
    condition_en: '21-day daily streak',
    category: 'consistency',
    rarity: 'epic',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'flame',
    xp_reward: 450,
  },
  {
    id: 'ach_archive_completionist',
    slug: 'archive_completionist',
    title_ru: 'Полная дискография',
    title_en: 'Complete Discography',
    desc_ru: 'Изучите тексты 12 разных композиций из дискографии deathmarried',
    desc_en: 'Read lyrics of 12 unique tracks in the deathmarried archive',
    condition_ru: 'Изучить тексты 12 разных треков',
    condition_en: 'Read 12 unique track lyrics',
    category: 'music',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'music',
    xp_reward: 450,
  },
  {
    id: 'ach_win_streak_10',
    slug: 'win_streak_10',
    title_ru: 'Десять безупречных нот',
    title_en: 'Ten in a Row',
    desc_ru: 'Одержите 10 побед подряд в ежедневных играх архива',
    desc_en: 'Win 10 archive games in a row',
    condition_ru: 'Серия из 10 побед подряд в играх',
    condition_en: '10 consecutive game wins',
    category: 'music',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'trophy',
    xp_reward: 500,
  },
  {
    id: 'ach_archon_of_sound',
    slug: 'archon_of_sound',
    title_ru: 'Ветеран архива',
    title_en: 'Archive Veteran',
    desc_ru: 'Достигните 3500 Total XP или 10-го уровня профиля',
    desc_en: 'Reach 3500 Total XP or Profile Level 10',
    condition_ru: '3500 Total XP или 10-й уровень',
    condition_en: '3500 Total XP or Level 10',
    category: 'veteran',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'star',
    xp_reward: 500,
  },
  {
    id: 'ach_gothic_treasury',
    slug: 'gothic_treasury',
    title_ru: 'Большая коллекция',
    title_en: 'Grand Treasury',
    desc_ru: 'Соберите 15 предметов оформления в своём инвентаре',
    desc_en: 'Own 15 customization items',
    condition_ru: 'Собрать 15 предметов коллекции',
    condition_en: 'Own 15 shop items',
    category: 'collector',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'layers',
    xp_reward: 500,
  },
  {
    id: 'ach_meta_collector_20',
    slug: 'meta_collector_20',
    title_ru: 'Хранитель печатей',
    title_en: 'Seal Keeper',
    desc_ru: 'Откройте любые 20 достижений в архиве Apostles of deathmarried',
    desc_en: 'Unlock any 20 archive achievements',
    condition_ru: 'Открыть 20 достижений',
    condition_en: 'Unlock 20 achievements',
    category: 'veteran',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'shield',
    xp_reward: 500,
  },
  {
    id: 'ach_grand_champion',
    slug: 'grand_champion',
    title_ru: 'Магистр состязаний',
    title_en: 'Grand Champion',
    desc_ru: 'Одержите минимум по 3 победы в каждом из всех 5 игровых режимов архива',
    desc_en: 'Achieve at least 3 wins in each of all 5 archive game modes',
    condition_ru: 'По 3 победы в каждой из 5 игр',
    condition_en: '3 wins in all 5 game modes',
    category: 'music',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'trophy',
    xp_reward: 600,
  },
  {
    id: 'ach_immortal_flame',
    slug: 'immortal_flame',
    title_ru: 'Негасимое пламя',
    title_en: 'Immortal Flame',
    desc_ru: 'Выдержите серию ежедневной активности 30 дней подряд',
    desc_en: 'Maintain a 30-day unbroken daily streak',
    condition_ru: 'Серия 30 дней подряд',
    condition_en: '30-day daily streak',
    category: 'consistency',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'crown',
    xp_reward: 700,
  },
  {
    id: 'ach_meta_legend_35',
    slug: 'meta_legend_35',
    title_ru: 'Апостол архива',
    title_en: 'Apostle of the Archive',
    desc_ru: 'Откройте 35 достижений и станьте живой легендой Apostles of deathmarried',
    desc_en: 'Unlock 35 achievements to become a legend of the Archive',
    condition_ru: 'Открыть 35 достижений',
    condition_en: 'Unlock 35 achievements',
    category: 'veteran',
    rarity: 'legendary',
    difficulty_tier: 'hard',
    is_secret: 0,
    icon: 'crown',
    xp_reward: 800,
  },
] as const;

export const META_ACHIEVEMENT_SLUGS = new Set(['meta_collector_20', 'meta_legend_35']);

export interface AchievementMetrics {
  isRegistered?: boolean;
  gamesPlayed: number;
  guessTrackPlayed: number;
  guessTrackWins: number;
  quizPlayed: number;
  quizWins?: number;
  quizPerfectRuns: number;
  dailyStreak: number;
  totalXp: number;
  level: number;
  purchasesCount: number;
  equippedItemsCount: number;
  postsCount: number;
  approvedPostsCount?: number;
  commentsCount: number;
  creationsCount: number;
  approvedCreationsCount?: number;
  creationRosesTotal?: number;
  followersCount: number;
  followingCount: number;
  hasCustomProfile?: boolean;
  accountAgeDays?: number;
  postsReadCount?: number;
  promoRedeemedCount?: number;
  maxTrackCompletions?: number;
  uniqueTracksListened?: number;
  visitedMidnightMsk?: boolean;
  clickedSecretRose?: boolean;
  lyricsOpenedCount?: number;
  shareCardCount?: number;
  totalGameWins?: number;
  distinctGamesPlayed?: number;
  distinctGamesWon?: number;
  bestGameWinStreak?: number;
  guessLyricsWins?: number;
  reverseTrackWins?: number;
  speedTrackWins?: number;
  existingRegularUnlockedCount?: number;
}

function getAllModeWinCounts(m: AchievementMetrics): [number, number, number, number, number] {
  return [
    Math.max(0, Number(m.guessTrackWins || 0)),
    Math.max(0, Number(m.guessLyricsWins || 0)),
    Math.max(0, Number(m.reverseTrackWins || 0)),
    Math.max(0, Number(m.speedTrackWins || 0)),
    Math.max(0, Number(m.quizWins ?? m.quizPerfectRuns ?? 0)),
  ];
}

function getAudioGamesWon(m: AchievementMetrics): number {
  return (
    Math.max(0, Number(m.guessTrackWins || 0)) +
    Math.max(0, Number(m.reverseTrackWins || 0)) +
    Math.max(0, Number(m.speedTrackWins || 0))
  );
}

/**
 * Pure server-authoritative achievement evaluator across all 52 easy, medium, hard & secret achievements.
 * Never depends on client-supplied unlock flags or mindless repeat farming.
 */
export function evaluateAchievementSlugs(m: AchievementMetrics): string[] {
  const regularSlugs: string[] = [];
  const postsRead = Number(m.postsReadCount || 0);
  const promoRedeemed = Number(m.promoRedeemedCount || 0);
  const uniqueTracks = Number(m.uniqueTracksListened || 0);
  const lyricsOpened = Number(m.lyricsOpenedCount || 0);
  const shareCards = Number(m.shareCardCount || 0);
  const distinctGamesPlayed = Number(m.distinctGamesPlayed || 0);
  const distinctGamesWon = Number(m.distinctGamesWon || 0);
  const totalGameWins = Number(m.totalGameWins || 0);
  const bestGameWinStreak = Number(m.bestGameWinStreak || 0);
  const guessLyricsWins = Number(m.guessLyricsWins || 0);
  const reverseTrackWins = Number(m.reverseTrackWins || 0);
  const speedTrackWins = Number(m.speedTrackWins || 0);
  const approvedPosts = Number(m.approvedPostsCount ?? m.postsCount ?? 0);
  const approvedCreations = Number(m.approvedCreationsCount ?? m.creationsCount ?? 0);
  const creationRoses = Number(m.creationRosesTotal || 0);
  const audioGamesWon = getAudioGamesWon(m);
  const modeWins = getAllModeWinCounts(m);
  const minWinsAll5 = Math.min(...modeWins);

  // Easy Tier
  if (m.isRegistered) regularSlugs.push('archive_initiate');
  if (uniqueTracks >= 1) regularSlugs.push('first_listen');
  if (lyricsOpened >= 1) regularSlugs.push('lyrics_reader');
  if (m.commentsCount >= 1) regularSlugs.push('easy_first_reply');
  if (m.hasCustomProfile) regularSlugs.push('shadow_identity');
  if (m.gamesPlayed >= 1) regularSlugs.push('first_blood');
  if (shareCards >= 1) regularSlugs.push('share_card_first');
  if (m.quizPlayed >= 1) regularSlugs.push('quiz_seeker');
  if (m.purchasesCount >= 1) regularSlugs.push('collector');
  if (m.guessTrackWins >= 1) regularSlugs.push('first_note');
  if (m.postsCount >= 1) regularSlugs.push('first_chronicle');
  if (postsRead >= 1) regularSlugs.push('easy_avid_reader');
  if (promoRedeemed >= 1) regularSlugs.push('secret_first_code');
  if (distinctGamesPlayed >= 2) regularSlugs.push('track_duo');
  if (m.equippedItemsCount >= 3) regularSlugs.push('dressed_in_velvet');
  if (m.followersCount >= 3 || m.followingCount >= 3) regularSlugs.push('coven_circle');

  // Medium Tier
  if (m.dailyStreak >= 5) regularSlugs.push('devoted_acolyte');
  if (m.clickedSecretRose) regularSlugs.push('secret_curious_rose');
  if (m.gamesPlayed >= 10) regularSlugs.push('initiate_ritual');
  if (m.commentsCount >= 10) regularSlugs.push('midnight_critic');
  if (m.guessTrackWins >= 5) regularSlugs.push('vinyl_hunter');
  if (m.postsCount >= 3) regularSlugs.push('voice_of_abyss');
  if (approvedCreations >= 1) regularSlugs.push('gothic_artisan');
  if (uniqueTracks >= 3) regularSlugs.push('discography_listener');
  if (distinctGamesPlayed >= 5) regularSlugs.push('all_games_explorer');
  if (guessLyricsWins >= 5) regularSlugs.push('lyrics_hunter');
  if (reverseTrackWins >= 5) regularSlugs.push('reverse_decoder');
  if (speedTrackWins >= 5) regularSlugs.push('speed_runner');
  if (m.quizPerfectRuns >= 1) regularSlugs.push('lore_scholar');
  if (m.purchasesCount >= 5) regularSlugs.push('relic_hoarder');
  if (bestGameWinStreak >= 5) regularSlugs.push('win_streak_5');
  if (m.quizPlayed >= 10) regularSlugs.push('cathedral_historian');
  if (m.dailyStreak >= 10) regularSlugs.push('eternal_vigil');
  if (m.totalXp >= 1000) regularSlugs.push('dark_apostle');
  if (distinctGamesWon >= 5) regularSlugs.push('all_games_winner');

  // Hard Tier
  if (approvedPosts >= 5 || m.commentsCount >= 20) regularSlugs.push('hard_community_reader');
  if (m.visitedMidnightMsk) regularSlugs.push('secret_midnight_visitor');
  if (m.guessTrackWins >= 15) regularSlugs.push('phantom_ear');
  if (m.quizPerfectRuns >= 3) regularSlugs.push('secret_flawless_quiz');
  if (totalGameWins >= 20) regularSlugs.push('ritual_master');
  if (creationRoses >= 10) regularSlugs.push('creation_idol');
  if (uniqueTracks >= 3 && audioGamesWon >= 6) regularSlugs.push('secret_on_repeat');
  if (m.quizPerfectRuns >= 5) regularSlugs.push('obsidian_oracle');
  if (m.dailyStreak >= 21) regularSlugs.push('midnight_devotion');
  if (lyricsOpened >= 12) regularSlugs.push('archive_completionist');
  if (bestGameWinStreak >= 10) regularSlugs.push('win_streak_10');
  if (m.totalXp >= 3500 || m.level >= 10) regularSlugs.push('archon_of_sound');
  if (m.purchasesCount >= 15) regularSlugs.push('gothic_treasury');
  if (minWinsAll5 >= 3) regularSlugs.push('grand_champion');
  if (m.dailyStreak >= 30) regularSlugs.push('immortal_flame');

  // Meta Collector Achievements (second pass over unlocked non-meta count)
  const effectiveRegularCount = Math.max(
    regularSlugs.length,
    Number(m.existingRegularUnlockedCount || 0)
  );
  const slugs = [...regularSlugs];
  if (effectiveRegularCount >= 20) slugs.push('meta_collector_20');
  if (effectiveRegularCount >= 35) slugs.push('meta_legend_35');

  return slugs;
}

/**
 * Computes numeric progress { current, target } for each achievement slug based on real DB metrics.
 */
export function getAchievementProgress(
  slug: string,
  m: AchievementMetrics,
  isUnlocked: boolean
): { current: number; target: number } {
  const clamp = (current: number, target: number) => ({
    current: isUnlocked ? target : Math.min(target, Math.max(0, Math.floor(current))),
    target,
  });

  const effectiveRegularCount = Math.max(
    evaluateAchievementSlugs(m).filter((s) => !META_ACHIEVEMENT_SLUGS.has(s)).length,
    Number(m.existingRegularUnlockedCount || 0)
  );

  switch (slug) {
    // Easy
    case 'archive_initiate':
      return clamp(m.isRegistered ? 1 : 0, 1);
    case 'first_listen':
      return clamp(Number(m.uniqueTracksListened || 0), 1);
    case 'lyrics_reader':
      return clamp(Number(m.lyricsOpenedCount || 0), 1);
    case 'easy_first_reply':
      return clamp(m.commentsCount, 1);
    case 'shadow_identity':
      return clamp(m.hasCustomProfile ? 1 : 0, 1);
    case 'first_blood':
      return clamp(m.gamesPlayed, 1);
    case 'share_card_first':
      return clamp(Number(m.shareCardCount || 0), 1);
    case 'quiz_seeker':
      return clamp(m.quizPlayed, 1);
    case 'collector':
      return clamp(m.purchasesCount, 1);
    case 'first_note':
      return clamp(m.guessTrackWins, 1);
    case 'first_chronicle':
      return clamp(m.postsCount, 1);
    case 'easy_avid_reader':
      return clamp(Number(m.postsReadCount || 0), 1);
    case 'secret_first_code':
      return clamp(Number(m.promoRedeemedCount || 0), 1);
    case 'track_duo':
      return clamp(Number(m.distinctGamesPlayed || 0), 2);
    case 'dressed_in_velvet':
      return clamp(m.equippedItemsCount, 3);
    case 'coven_circle':
      return clamp(Math.max(m.followersCount, m.followingCount), 3);

    // Medium
    case 'devoted_acolyte':
      return clamp(m.dailyStreak, 5);
    case 'secret_curious_rose':
      return clamp(m.clickedSecretRose ? 1 : 0, 1);
    case 'initiate_ritual':
      return clamp(m.gamesPlayed, 10);
    case 'midnight_critic':
      return clamp(m.commentsCount, 10);
    case 'vinyl_hunter':
      return clamp(m.guessTrackWins, 5);
    case 'voice_of_abyss':
      return clamp(m.postsCount, 3);
    case 'gothic_artisan':
      return clamp(Number(m.approvedCreationsCount ?? m.creationsCount ?? 0), 1);
    case 'discography_listener':
      return clamp(Number(m.uniqueTracksListened || 0), 3);
    case 'all_games_explorer':
      return clamp(Number(m.distinctGamesPlayed || 0), 5);
    case 'lyrics_hunter':
      return clamp(Number(m.guessLyricsWins || 0), 5);
    case 'reverse_decoder':
      return clamp(Number(m.reverseTrackWins || 0), 5);
    case 'speed_runner':
      return clamp(Number(m.speedTrackWins || 0), 5);
    case 'lore_scholar':
      return clamp(m.quizPerfectRuns, 1);
    case 'relic_hoarder':
      return clamp(m.purchasesCount, 5);
    case 'win_streak_5':
      return clamp(Number(m.bestGameWinStreak || 0), 5);
    case 'cathedral_historian':
      return clamp(m.quizPlayed, 10);
    case 'eternal_vigil':
      return clamp(m.dailyStreak, 10);
    case 'dark_apostle':
      return clamp(m.totalXp, 1000);
    case 'all_games_winner':
      return clamp(Number(m.distinctGamesWon || 0), 5);

    // Hard
    case 'hard_community_reader': {
      const approvedPosts = Number(m.approvedPostsCount ?? m.postsCount ?? 0);
      return clamp(Math.max(approvedPosts * 4, Number(m.commentsCount || 0)), 20);
    }
    case 'secret_midnight_visitor':
      return clamp(m.visitedMidnightMsk ? 1 : 0, 1);
    case 'phantom_ear':
      return clamp(m.guessTrackWins, 15);
    case 'secret_flawless_quiz':
      return clamp(m.quizPerfectRuns, 3);
    case 'ritual_master':
      return clamp(Number(m.totalGameWins || 0), 20);
    case 'creation_idol':
      return clamp(Number(m.creationRosesTotal || 0), 10);
    case 'secret_on_repeat': {
      const audioWinsPart = Math.min(6, getAudioGamesWon(m));
      const tracksPart = Math.min(3, Number(m.uniqueTracksListened || 0));
      return clamp(audioWinsPart + tracksPart, 9);
    }
    case 'obsidian_oracle':
      return clamp(m.quizPerfectRuns, 5);
    case 'midnight_devotion':
      return clamp(m.dailyStreak, 21);
    case 'archive_completionist':
      return clamp(Number(m.lyricsOpenedCount || 0), 12);
    case 'win_streak_10':
      return clamp(Number(m.bestGameWinStreak || 0), 10);
    case 'archon_of_sound':
      return clamp(m.level >= 10 ? 3500 : m.totalXp, 3500);
    case 'gothic_treasury':
      return clamp(m.purchasesCount, 15);
    case 'meta_collector_20':
      return clamp(effectiveRegularCount, 20);
    case 'grand_champion': {
      const modeWins = getAllModeWinCounts(m);
      const sumProgress = modeWins.reduce((acc, val) => acc + Math.min(3, val), 0);
      return clamp(sumProgress, 15);
    }
    case 'immortal_flame':
      return clamp(m.dailyStreak, 30);
    case 'meta_legend_35':
      return clamp(effectiveRegularCount, 35);
    default:
      return clamp(isUnlocked ? 1 : 0, 1);
  }
}


