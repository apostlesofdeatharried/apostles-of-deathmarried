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
  postsReadCount?: number;
  promoRedeemedCount?: number;
  maxTrackCompletions?: number;
  visitedMidnightMsk?: boolean;
  clickedSecretRose?: boolean;
}

/**
 * Pure server-authoritative achievement evaluator across all easy, hard, and secret achievements.
 * Never depends on client-supplied unlock flags.
 */
export function evaluateAchievementSlugs(m: AchievementMetrics): string[] {
  const slugs: string[] = [];
  const postsRead = Number(m.postsReadCount || 0);
  const promoRedeemed = Number(m.promoRedeemedCount || 0);
  const maxTrackCompletions = Number(m.maxTrackCompletions || 0);

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
  if (m.commentsCount >= 1) slugs.push('easy_first_reply');
  if (m.commentsCount >= 5) slugs.push('midnight_critic');
  if (postsRead >= 5) slugs.push('easy_avid_reader');
  if (postsRead >= 20) slugs.push('hard_community_reader');
  if (m.creationsCount >= 1) slugs.push('gothic_artisan');
  if (m.followersCount >= 3 || m.followingCount >= 3) slugs.push('coven_circle');

  // Veteran & XP Milestones
  if (m.totalXp >= 500) slugs.push('dark_apostle');
  if (m.totalXp >= 1500 || m.level >= 8) slugs.push('archon_of_sound');

  // Secret Easter Eggs (5 required secrets)
  if (m.visitedMidnightMsk) slugs.push('secret_midnight_visitor');
  if (maxTrackCompletions >= 10) slugs.push('secret_on_repeat');
  if (m.clickedSecretRose) slugs.push('secret_curious_rose');
  if (promoRedeemed >= 1) slugs.push('secret_first_code');
  if (m.quizPerfectRuns >= 1) slugs.push('secret_flawless_quiz');

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

  switch (slug) {
    case 'archive_initiate':
      return clamp(m.isRegistered ? 1 : 0, 1);
    case 'shadow_identity':
      return clamp(m.hasCustomProfile ? 1 : 0, 1);
    case 'first_blood':
      return clamp(m.gamesPlayed, 1);
    case 'first_note':
      return clamp(m.guessTrackWins, 1);
    case 'vinyl_hunter':
      return clamp(m.guessTrackWins, 5);
    case 'phantom_ear':
      return clamp(m.guessTrackWins, 15);
    case 'initiate_ritual':
      return clamp(m.gamesPlayed, 10);
    case 'ritual_master':
      return clamp(m.gamesPlayed, 30);
    case 'quiz_seeker':
      return clamp(m.quizPlayed, 1);
    case 'lore_scholar':
      return clamp(m.quizPerfectRuns, 1);
    case 'obsidian_oracle':
      return clamp(m.quizPerfectRuns, 3);
    case 'cathedral_historian':
      return clamp(m.quizPlayed, 10);
    case 'devoted_acolyte':
      return clamp(m.dailyStreak, 3);
    case 'eternal_vigil':
      return clamp(m.dailyStreak, 7);
    case 'midnight_devotion':
      return clamp(m.dailyStreak, 14);
    case 'immortal_flame':
      return clamp(m.dailyStreak, 30);
    case 'collector':
      return clamp(m.purchasesCount, 1);
    case 'relic_hoarder':
      return clamp(m.purchasesCount, 5);
    case 'gothic_treasury':
      return clamp(m.purchasesCount, 10);
    case 'dressed_in_velvet':
      return clamp(m.equippedItemsCount, 3);
    case 'first_chronicle':
      return clamp(m.postsCount, 1);
    case 'voice_of_abyss':
      return clamp(m.postsCount, 3);
    case 'easy_first_reply':
      return clamp(m.commentsCount, 1);
    case 'midnight_critic':
      return clamp(m.commentsCount, 5);
    case 'easy_avid_reader':
      return clamp(Number(m.postsReadCount || 0), 5);
    case 'hard_community_reader':
      return clamp(Number(m.postsReadCount || 0), 20);
    case 'gothic_artisan':
      return clamp(m.creationsCount, 1);
    case 'coven_circle':
      return clamp(Math.max(m.followersCount, m.followingCount), 3);
    case 'dark_apostle':
      return clamp(m.totalXp, 500);
    case 'archon_of_sound':
      return clamp(m.level >= 8 ? 1500 : m.totalXp, 1500);
    case 'secret_midnight_visitor':
      return clamp(m.visitedMidnightMsk ? 1 : 0, 1);
    case 'secret_on_repeat':
      return clamp(Number(m.maxTrackCompletions || 0), 10);
    case 'secret_curious_rose':
      return clamp(m.clickedSecretRose ? 1 : 0, 1);
    case 'secret_first_code':
      return clamp(Number(m.promoRedeemedCount || 0), 1);
    case 'secret_flawless_quiz':
      return clamp(m.quizPerfectRuns, 1);
    default:
      return clamp(isUnlocked ? 1 : 0, 1);
  }
}

