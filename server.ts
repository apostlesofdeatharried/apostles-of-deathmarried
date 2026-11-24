import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { db, initDatabase, closeDatabase } from './server/db.js';
import {
  ensureCloudDatabaseRestored,
  pushDatabaseBackupNow,
  getCloudSyncStatus,
  isSupabaseConfigured,
  uploadMediaToSupabase,
  createSignedMediaUploadUrl,
  fetchMediaFromSupabase,
  deleteMediaFromSupabase,
} from './server/cloudSync.js';
import {
  signSessionToken,
  verifySessionToken,
  isSignedSessionToken,
  resolveSessionSecret,
  SESSION_TTL_MS,
} from './server/sessionToken.js';
import {
  calculateLevelFromXp,
  calculateQuizScore,
  calculateQuizScoreByDifficulty,
  calculateMiniGameXp,
  validateNickname,
  validatePassword,
  checkAchievementEligibility,
  isSafeMediaUrl,
  computeDailyStreak,
  resolveServerPort,
  sanitizeStreamingLinks,
  classifyMediaUpload,
  buildSafeAsciiFilename,
  getMoscowDateString,
  isMoscowMidnightWindow,
  getStreakBonusPercent,
  applyStreakBonusXp,
  parsePrivacySettings,
  fisherYatesShuffle,
  buildCustomShieldValue,
  parseCustomShieldValue,
  sanitizeCssColor,
} from './src/utils/logic.js';
import {
  DAILY_SNIPPET_DURATION_SECONDS,
  DEFAULT_DAILY_QUIZ_COUNT,
  getUtcDateString,
  isValidUtcDateString,
  getNextUtcMidnightIso,
  getUtc12HourSlot,
  isValidUtc12HourSlot,
  getNextUtc12HourResetIso,
  getMoscow12hCycle,
  isValidMoscow12hCycle,
  getPreviousMoscow12hCycle,
  pickDailyTrackChallenge,
  pickDailyReverseTrackChallenge,
  pickDailySpeedTrackChallenge,
  pickDailyLyricsChallenge,
  parseAndValidateQuizQuestion,
  pickDailyQuizSet,
  shuffleQuizQuestionOptions,
  readLocalWavDurationSeconds,
  type PlayableTrackCandidate,
  type LyricTrackCandidate,
  type TitleOption,
  type RawQuizQuestion,
  type ValidatedQuizQuestion,
} from './server/dailyGames.js';
import {
  generateDiscographyQuizQuestions,
  type DiscographyAlbum,
  type DiscographyTrack,
  type DiscographySingle,
} from './server/quizGenerator.js';
import {
  normalizeUsername,
  validateUsername,
  validateDisplayName,
  validateEmail,
  validateRegistrationPassword,
  computeLoginLockout,
  isAccountLocked,
  canChangeUsername,
  isSameOriginRequest,
  evaluateAchievementSlugs,
  getAchievementProgress,
  type AchievementMetrics,
  MAX_FEATURED_ACHIEVEMENTS,
  MAX_REGISTRATIONS_PER_IP_24H,
  MAX_REGISTRATIONS_PER_DEVICE_24H,
  hashGuardIdentifier,
  createSignedCaptcha,
  verifySignedCaptcha,
  parseBulkQuizInput,
  generateVerificationCode,
  createSignedEmailVerificationToken,
  verifySignedEmailVerificationToken,
  normalizePromoCode,
  type EmailVerificationPurpose,
} from './server/accountSecurity.js';
import { sendVerificationCodeEmail } from './server/emailService.js';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('apostles_dummy_timing_guard_2026', 12);

const app = express();
const PORT = resolveServerPort(process.argv, process.env);
const isVercel = Boolean(process.env.VERCEL);

// Trust Vercel / reverse proxy headers for rate limiting & secure cookies
app.set('trust proxy', 1);

// Initialize SQLite database
initDatabase();

// Baseline security headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Disable HTTP/CDN/browser caching on all /api/* responses so admin edits appear immediately
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  next();
});

// CSRF / Origin defense-in-depth for cookie-only mutating API requests
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const authHeader = req.headers.authorization;
    const hasBearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
    const hasCookie = Boolean(req.cookies?.apostle_session);
    if (!hasBearer && hasCookie) {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
      if (!isSameOriginRequest(origin, referer, host)) {
        res.status(403).json({ error: 'Cross-origin request rejected.' });
        return;
      }
    }
  }
  next();
});

const STATELESS_POST_PATHS = new Set(['/api/upload/signed-url']);
const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let coldStartRestorePromise: Promise<void> | null = null;
function triggerColdStartRestoreOnce(): Promise<void> {
  if (!coldStartRestorePromise) {
    coldStartRestorePromise = ensureCloudDatabaseRestored().catch((err) => {
      console.warn('[CloudSync] Cold-start restore warning:', err instanceof Error ? err.message : err);
    });
  }
  return coldStartRestorePromise;
}

// Cold-start-only restore + write-through backup on mutations.
// CRITICAL: DB backup upload to Supabase Storage ONLY runs after successful mutating requests (POST/PUT/PATCH/DELETE).
// GET requests NEVER download or upload apostles.db (cold-start restore runs once only when local DB did not exist).
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    if (isSupabaseConfigured()) {
      await triggerColdStartRestoreOnce();

      const isMutation =
        MUTATING_HTTP_METHODS.has(req.method) && !STATELESS_POST_PATHS.has(req.path);

      if (isMutation) {
        // Flush checkpointed SQLite snapshot to Supabase Storage BEFORE sending the HTTP 2xx response.
        // If cloud upload fails, return HTTP 500 with the exact error instead of a false 200 OK.
        const originalJson = res.json.bind(res);
        let cloudSyncHandled = false;
        res.json = ((body: any) => {
          if (cloudSyncHandled) {
            return originalJson(body);
          }
          cloudSyncHandled = true;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            pushDatabaseBackupNow()
              .then((syncResult) => {
                if (!syncResult.ok) {
                  console.error('[CloudSync] Failed to persist mutation to Supabase:', syncResult.error);
                  res.status(500);
                  return originalJson({
                    error: `Ошибка сохранения базы данных в Supabase Storage: ${syncResult.error || 'unknown error'}`,
                    cloud_sync_error: syncResult.error || 'unknown error',
                  });
                }
                return originalJson(body);
              })
              .catch((err: any) => {
                const msg = err?.message || 'unexpected cloud sync failure';
                console.error('[CloudSync] Mutation backup threw:', msg);
                res.status(500);
                return originalJson({
                  error: `Ошибка сохранения базы данных в Supabase Storage: ${msg}`,
                  cloud_sync_error: msg,
                });
              });
            return res;
          }
          return originalJson(body);
        }) as Response['json'];
      }
    }
  }
  next();
});

// Lightweight in-memory rate limiter for auth & upload routes
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function createRateLimiter(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'local';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || now > current.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (current.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    current.count += 1;
    next();
  };
}
const authRateLimit = createRateLimiter('auth', 40, 60 * 1000);
const emailCodeRateLimit = createRateLimiter('email_code', 5, 10 * 60 * 1000);
const promoRateLimit = createRateLimiter('promo', 15, 60 * 1000);
const uploadRateLimit = createRateLimiter('upload', 30, 60 * 1000);

// Static uploads folder (uses /tmp/uploads on Vercel read-only filesystem)
const uploadDir = isVercel
  ? path.join('/tmp', 'uploads')
  : path.resolve(process.cwd(), 'public', 'uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.warn('[Uploads] Could not create uploadDir:', err);
}

const BUNDLED_AUDIO_FILES = new Set([
  '/audio/crown_of_thorns.wav',
  '/audio/midnight_rose.wav',
  '/audio/cathedral_veil.wav',
]);

function isPathInsideDir(baseDir: string, candidatePath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate.startsWith(resolvedBase + path.sep);
}

function localAudioExists(audioUrl?: string | null): boolean {
  if (!audioUrl || typeof audioUrl !== 'string') return false;
  const trimmed = audioUrl.trim();
  if (!trimmed) return false;
  if (BUNDLED_AUDIO_FILES.has(trimmed)) return true;

  if (trimmed.startsWith('/audio/')) {
    if (trimmed.includes('..')) return false;
    const rel = trimmed.slice(1);
    const publicPath = path.resolve(process.cwd(), 'public', rel);
    const distPath = path.resolve(process.cwd(), 'dist', rel);
    return fs.existsSync(publicPath) || fs.existsSync(distPath);
  }

  if (trimmed.startsWith('/uploads/')) {
    if (trimmed.includes('..')) return false;
    const filename = path.basename(trimmed);
    const diskPath = path.join(uploadDir, filename);
    const publicPath = path.resolve(process.cwd(), 'public', 'uploads', filename);
    if (fs.existsSync(diskPath) || fs.existsSync(publicPath)) return true;
    if (isSupabaseConfigured()) return true;
    try {
      const blobRow = db.prepare('SELECT 1 FROM uploaded_blobs WHERE filename = ?').get(filename);
      if (blobRow) return true;
      const indexedAudio = db.prepare('SELECT 1 FROM audio_files WHERE storage_path = ?').get(trimmed);
      if (indexedAudio) return true;
    } catch {}
    return false;
  }

  return isSafeMediaUrl(trimmed);
}

function buildSafeUploadFilename(originalName: string, mimeType: string): string {
  return buildSafeAsciiFilename(
    originalName,
    mimeType,
    Date.now(),
    crypto.randomBytes(4).toString('hex')
  );
}

// Multer storage configuration with strict mime/extension validation
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, buildSafeUploadFilename(file.originalname, file.mimetype));
  },
});

const UPLOAD_AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.m4a']);
const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

function validateUploadPolicy(
  filename: string,
  mimetype: string,
  size?: number
): { ok: boolean; status?: number; error?: string; kind: 'audio' | 'image' | 'video' | null } {
  const classified = classifyMediaUpload(filename, mimetype);
  if (!classified.allowed) {
    return {
      ok: false,
      status: 400,
      error: 'Disallowed file type. Only audio (MP3, OGG, M4A), images (JPG, PNG, WEBP, GIF), and video (MP4, WEBM, MOV) are accepted.',
      kind: null,
    };
  }
  if (classified.kind === 'audio') {
    if (!UPLOAD_AUDIO_EXTENSIONS.has(classified.normalizedExt)) {
      return {
        ok: false,
        status: 400,
        error: 'Разрешены только аудиофайлы форматов MP3, OGG и M4A (до 12 МБ).',
        kind: null,
      };
    }
    if (typeof size === 'number' && size > MAX_AUDIO_UPLOAD_BYTES) {
      return {
        ok: false,
        status: 413,
        error: 'Аудиофайл превышает максимальный размер 12 МБ.',
        kind: null,
      };
    }
  }
  return { ok: true, kind: classified.kind };
}

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max for video; audio is capped at 12MB below
  fileFilter: (_req, file, cb) => {
    const policy = validateUploadPolicy(file.originalname, file.mimetype);
    if (policy.ok) {
      cb(null, true);
    } else {
      cb(new Error(policy.error || 'Disallowed file type.'));
    }
  },
});

// Authentication middleware
interface AuthRequest extends Request {
  user?: {
    id: string;
    nickname: string;
    email?: string | null;
    email_verified?: number;
    role_id: string;
    is_banned: number;
    level: number;
    xp: number;
    display_name: string;
    avatar_url: string;
  };
}

function issueSessionForUser(
  res: Response,
  user: { id: string; nickname: string; role_id: string }
): string {
  const sid = 'ses_' + crypto.randomUUID().slice(0, 12);
  const { token, expiresAt } = signSessionToken({
    sid,
    uid: user.id,
    nick: user.nickname,
    role: user.role_id,
  });

  try {
    db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sid, user.id, token, expiresAt);
  } catch (err) {
    console.warn('[Auth] Could not mirror session row in SQLite:', err);
  }

  res.cookie('apostle_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || isVercel,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });

  return token;
}

function extractRequestTokens(req: Request): {
  bearerToken: string | null;
  cookieToken: string | null;
  candidates: string[];
} {
  const authHeader = req.headers.authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim() || null
      : null;
  const cookieToken =
    typeof req.cookies?.apostle_session === 'string' && req.cookies.apostle_session.trim()
      ? req.cookies.apostle_session.trim()
      : null;

  const candidates: string[] = [];
  if (bearerToken) candidates.push(bearerToken);
  if (cookieToken && cookieToken !== bearerToken) candidates.push(cookieToken);

  return { bearerToken, cookieToken, candidates };
}

function parseFeaturedAchievements(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === 'string').slice(0, MAX_FEATURED_ACHIEVEMENTS);
    }
  } catch {}
  return [];
}

function hydrateSessionUserRow(row: any) {
  if (!row) return null;
  const { password_changed_at, featured_achievements_json, ...safeRow } = row;
  const totalXp = Number(safeRow.total_xp ?? safeRow.xp ?? 0);
  const { level: computedLevel } = calculateLevelFromXp(totalXp);
  return {
    ...safeRow,
    email_verified: Number(safeRow.email_verified || 0),
    accepted_rules: Number(safeRow.accepted_rules || 0),
    notify_follows: safeRow.notify_follows === 0 ? 0 : 1,
    notify_news: safeRow.notify_news ? 1 : 0,
    favorite_track: safeRow.favorite_track || null,
    display_name: safeRow.display_name && String(safeRow.display_name).trim()
      ? safeRow.display_name
      : safeRow.nickname,
    total_xp: totalXp,
    level: computedLevel,
    featured_achievements: parseFeaturedAchievements(featured_achievements_json),
  };
}

function resolveUserFromToken(token: string) {
  // Path A: Stateless HMAC-SHA256 signed token (survives all Vercel serverless cold starts & multi-instance routing)
  if (isSignedSessionToken(token)) {
    const payload = verifySessionToken(token);
    if (!payload) return null;

    try {
      const revoked = db
        .prepare('SELECT 1 FROM revoked_sessions WHERE sid = ?')
        .get(payload.sid);
      if (revoked) return null;
    } catch {}

    const userRow = db.prepare(`
      SELECT u.id as user_id, u.id, u.nickname, u.email, u.email_verified, u.accepted_rules, u.role_id, u.is_banned,
             u.password_changed_at, u.created_at as registered_at,
             p.display_name, p.avatar_url, p.bio, p.custom_status, p.favorite_track, p.level, p.xp, p.total_xp,
             p.daily_streak, p.is_private, p.notify_follows, p.notify_news,
             p.equipped_frame, p.equipped_banner,
             p.equipped_name_style, p.equipped_badge, p.equipped_title, p.equipped_theme, p.equipped_effect,
             p.featured_achievements_json, p.username_changed_at
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ? OR u.nickname = ? COLLATE NOCASE
      ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(payload.uid, payload.nick, payload.uid) as any;

    if (!userRow || userRow.is_banned) {
      return null;
    }

    // Invalidate tokens issued prior to a password reset
    if (userRow.password_changed_at) {
      const changedMs = Date.parse(
        userRow.password_changed_at.endsWith('Z')
          ? userRow.password_changed_at
          : `${userRow.password_changed_at.replace(' ', 'T')}Z`
      );
      if (!Number.isNaN(changedMs) && payload.iat * 1000 < changedMs - 1000) {
        return null;
      }
    }

    return hydrateSessionUserRow(userRow);
  }

  // Path B: Legacy opaque session token stored in SQLite sessions table
  const session = db.prepare(`
    SELECT s.user_id, s.expires_at, u.id, u.nickname, u.email, u.email_verified, u.accepted_rules, u.role_id, u.is_banned,
           u.password_changed_at, u.created_at as registered_at,
           p.display_name, p.avatar_url, p.bio, p.custom_status, p.favorite_track, p.level, p.xp, p.total_xp,
           p.daily_streak, p.is_private, p.notify_follows, p.notify_news,
           p.equipped_frame, p.equipped_banner,
           p.equipped_name_style, p.equipped_badge, p.equipped_title, p.equipped_theme, p.equipped_effect,
           p.featured_achievements_json, p.username_changed_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).get(token) as any;

  if (!session || session.is_banned) {
    return null;
  }
  return hydrateSessionUserRow(session);
}

function getSessionUser(req: Request) {
  const { candidates } = extractRequestTokens(req);
  for (const token of candidates) {
    const resolved = resolveUserFromToken(token);
    if (resolved) return resolved;
  }
  return null;
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

function requireAdminOrMod(req: AuthRequest, res: Response, next: NextFunction) {
  const user = getSessionUser(req);
  if (!user || (user.role_id !== 'admin' && user.role_id !== 'moderator')) {
    res.status(403).json({ error: 'Administrator or Moderator privileges required' });
    return;
  }
  req.user = user;
  next();
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const user = getSessionUser(req);
  if (!user || user.role_id !== 'admin') {
    res.status(403).json({ error: 'Administrator privileges required' });
    return;
  }
  req.user = user;
  next();
}

// ----------------------------------------------------------------------------
// API: AUTHENTICATION
// ----------------------------------------------------------------------------

// Stateless HMAC-signed arithmetic captcha for registration anti-bot protection
app.get('/api/auth/captcha', authRateLimit, (_req: Request, res: Response) => {
  const challenge = createSignedCaptcha(resolveSessionSecret());
  res.json(challenge);
});

// Send 6-digit email verification code via Resend (stateless HMAC-signed token; safe across Vercel serverless cold starts)
app.post('/api/auth/email/send-code', emailCodeRateLimit, async (req: Request, res: Response) => {
  const honeypot = String(req.body?.website ?? req.body?.company_url ?? '').trim();
  if (honeypot.length > 0) {
    res.status(400).json({ error: 'Не удалось пройти проверку защиты от ботов.' });
    return;
  }

  const rawPurpose = String(req.body?.purpose || 'register').trim();
  const purpose: EmailVerificationPurpose = rawPurpose === 'verify_existing' ? 'verify_existing' : 'register';
  const sessionUser = getSessionUser(req);

  let targetEmail = '';
  let targetUserId: string | null = null;

  if (purpose === 'verify_existing') {
    if (!sessionUser) {
      res.status(401).json({ error: 'Войдите в аккаунт для подтверждения почты.' });
      return;
    }
    targetUserId = sessionUser.id;
    const rawRequestedEmail = String(req.body?.email || sessionUser.email || '').trim();
    const emailCheck = validateEmail(rawRequestedEmail);
    if (!emailCheck.valid) {
      res.status(400).json({ error: emailCheck.error || 'Укажите корректный адрес электронной почты.' });
      return;
    }
    targetEmail = emailCheck.normalized;

    // Ensure no other account already owns this email
    const conflicting = db
      .prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ?')
      .get(targetEmail, sessionUser.id);
    if (conflicting) {
      res.status(409).json({ error: 'Эта почта уже зарегистрирована' });
      return;
    }
  } else {
    const emailCheck = validateEmail(String(req.body?.email || ''));
    if (!emailCheck.valid) {
      res.status(400).json({ error: emailCheck.error || 'Введите корректный адрес электронной почты.' });
      return;
    }
    targetEmail = emailCheck.normalized;

    const existingEmail = db
      .prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ?')
      .get(targetEmail);
    if (existingEmail) {
      res.status(409).json({ error: 'Эта почта уже зарегистрирована' });
      return;
    }
  }

  const code = generateVerificationCode();
  const guardSecret = resolveSessionSecret();
  const signed = createSignedEmailVerificationToken(
    targetEmail,
    code,
    purpose,
    guardSecret,
    targetUserId
  );

  const delivery = await sendVerificationCodeEmail({
    to: targetEmail,
    code,
    purpose,
  });

  if (!delivery.ok) {
    res.status(delivery.configured ? 502 : 503).json({
      error: delivery.error || 'Не удалось отправить код подтверждения на почту.',
      email_service_configured: delivery.configured,
    });
    return;
  }

  res.json({
    ok: true,
    email: targetEmail,
    verification_token: signed.verification_token,
    expires_at: signed.expires_at,
  });
});

// Verify existing account's email using stateless HMAC-signed token + 6-digit code
app.post('/api/auth/email/verify', requireAuth, authRateLimit, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const rawEmail = String(req.body?.email || req.user.email || '').trim();
  const emailCheck = validateEmail(rawEmail);
  if (!emailCheck.valid) {
    res.status(400).json({ error: emailCheck.error || 'Укажите корректный адрес электронной почты.' });
    return;
  }

  const conflicting = db
    .prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ?')
    .get(emailCheck.normalized, req.user.id);
  if (conflicting) {
    res.status(409).json({ error: 'Эта почта уже зарегистрирована' });
    return;
  }

  const guardSecret = resolveSessionSecret();
  const check = verifySignedEmailVerificationToken(
    req.body?.verification_token ?? req.body?.email_verification_token,
    emailCheck.normalized,
    req.body?.code ?? req.body?.email_code,
    'verify_existing',
    guardSecret,
    req.user.id
  );
  if (!check.valid) {
    res.status(400).json({ error: check.error || 'Неверный или истёкший код подтверждения.' });
    return;
  }

  db.prepare(`
    UPDATE users
    SET email = ?, email_verified = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(emailCheck.normalized, req.user.id);

  res.json({
    ok: true,
    email: emailCheck.normalized,
    email_verified: 1,
  });
});

app.post('/api/auth/register', authRateLimit, (req: Request, res: Response) => {
  // 1. Honeypot trap: bots filling hidden fields are rejected immediately
  const honeypot = String(req.body?.website ?? req.body?.company_url ?? '').trim();
  if (honeypot.length > 0) {
    res.status(400).json({ error: 'Не удалось пройти проверку защиты от ботов.' });
    return;
  }

  // 2. Stateless HMAC-signed math captcha check
  const guardSecret = resolveSessionSecret();
  const captchaCheck = verifySignedCaptcha(
    req.body?.captcha_token,
    req.body?.captcha_answer,
    guardSecret
  );
  if (!captchaCheck.valid) {
    res.status(400).json({ error: captchaCheck.error || 'Неверный ответ на проверочный вопрос.' });
    return;
  }

  const rawUsername = req.body?.username ?? req.body?.nickname ?? '';
  const rawDisplayName = req.body?.display_name ?? '';
  const rawEmail = req.body?.email ?? '';
  const password = req.body?.password ?? '';
  const confirmPassword = req.body?.confirm_password;

  const usernameCheck = validateUsername(String(rawUsername));
  if (!usernameCheck.valid) {
    res.status(400).json({ error: usernameCheck.error });
    return;
  }

  const displayNameCheck = validateDisplayName(String(rawDisplayName || usernameCheck.normalized));
  if (!displayNameCheck.valid) {
    res.status(400).json({ error: displayNameCheck.error });
    return;
  }

  const emailCheck = validateEmail(String(rawEmail));
  if (!emailCheck.valid) {
    res.status(400).json({ error: emailCheck.error });
    return;
  }

  const passCheck = validateRegistrationPassword(
    String(password),
    confirmPassword !== undefined ? String(confirmPassword) : undefined
  );
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }

  const normalizedUsername = usernameCheck.normalized;

  // 3. Case-insensitive trimmed username & email uniqueness check FIRST (exact HTTP 409 messages)
  const existingNick = db
    .prepare('SELECT id FROM users WHERE LOWER(TRIM(nickname)) = ?')
    .get(normalizedUsername);
  if (existingNick) {
    res.status(409).json({ error: 'Этот юзернейм уже занят' });
    return;
  }

  if (normalizedUsername === 'sushkanov097' || normalizedUsername === 'deathmarried_admin') {
    res.status(409).json({ error: 'Этот юзернейм уже занят' });
    return;
  }

  const existingEmail = db
    .prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ?')
    .get(emailCheck.normalized);
  if (existingEmail) {
    res.status(409).json({ error: 'Эта почта уже зарегистрирована' });
    return;
  }

  // 4. Mandatory stateless 6-digit email verification code check for all new registrations
  const emailCodeCheck = verifySignedEmailVerificationToken(
    req.body?.email_verification_token ?? req.body?.verification_token,
    emailCheck.normalized,
    req.body?.email_code ?? req.body?.code,
    'register',
    guardSecret
  );
  if (!emailCodeCheck.valid) {
    res.status(400).json({ error: emailCodeCheck.error || 'Подтвердите электронную почту 6-значным кодом из письма.' });
    return;
  }

  // 5. Anti-spam multi-account guard: max 2 registrations per IP / device per 24 hours
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const clientIp = forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
  const ipHash = hashGuardIdentifier(`ip:${clientIp}`, guardSecret);

  const rawClientFp =
    (typeof req.body?.client_fp === 'string' && req.body.client_fp.trim()) ||
    (typeof req.cookies?.aod_reg_mark === 'string' && req.cookies.aod_reg_mark.trim()) ||
    '';
  const clientFpHash = rawClientFp ? hashGuardIdentifier(`fp:${rawClientFp}`, guardSecret) : null;

  const recentIpRow = db
    .prepare(
      "SELECT COUNT(*) as c FROM registration_guards WHERE ip_hash = ? AND datetime(created_at) >= datetime('now', '-24 hours')"
    )
    .get(ipHash) as { c: number };
  if ((recentIpRow?.c || 0) >= MAX_REGISTRATIONS_PER_IP_24H) {
    res.status(429).json({
      error: `С одного IP-адреса можно создать не более ${MAX_REGISTRATIONS_PER_IP_24H} аккаунтов за 24 часа. Попробуйте позже.`,
    });
    return;
  }

  if (clientFpHash) {
    const recentFpRow = db
      .prepare(
        "SELECT COUNT(*) as c FROM registration_guards WHERE client_fp_hash = ? AND datetime(created_at) >= datetime('now', '-24 hours')"
      )
      .get(clientFpHash) as { c: number };
    if ((recentFpRow?.c || 0) >= MAX_REGISTRATIONS_PER_DEVICE_24H) {
      res.status(429).json({
        error: `С этого устройства уже создано максимальное число аккаунтов (${MAX_REGISTRATIONS_PER_DEVICE_24H}) за последние 24 часа.`,
      });
      return;
    }
  }

  const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
  const hash = bcrypt.hashSync(String(password), 12);
  const assignedRole = 'user';
  const defaultAvatar = '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg';
  const deviceMarkValue = rawClientFp || `dev_${crypto.randomUUID().replace(/-/g, '')}`;
  const persistedFpHash = hashGuardIdentifier(`fp:${deviceMarkValue}`, guardSecret);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO users (id, nickname, email, email_verified, password_hash, role_id, failed_login_attempts)
      VALUES (?, ?, ?, 1, ?, ?, 0)
    `).run(userId, normalizedUsername, emailCheck.normalized, hash, assignedRole);

    // CRITICAL: New accounts always start with strictly 0 XP, 0 total_xp, Level 1, 0 streak
    db.prepare(`
      INSERT INTO profiles (user_id, display_name, avatar_url, bio, level, xp, total_xp, daily_streak)
      VALUES (?, ?, ?, ?, 1, 0, 0, 0)
    `).run(
      userId,
      displayNameCheck.normalized,
      defaultAvatar,
      ''
    );

    db.prepare(`
      INSERT INTO registration_guards (id, ip_hash, client_fp_hash)
      VALUES (?, ?, ?)
    `).run('rg_' + crypto.randomUUID().slice(0, 10), ipHash, persistedFpHash);
  })();

  // Award 0-XP registration milestone badge without touching XP
  unlockAchievement(userId, 'archive_initiate');

  const token = issueSessionForUser(res, {
    id: userId,
    nickname: normalizedUsername,
    role_id: assignedRole,
  });

  res.cookie('aod_reg_mark', deviceMarkValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || isVercel,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.status(201).json({
    user: {
      id: userId,
      nickname: normalizedUsername,
      email: emailCheck.normalized,
      email_verified: 1,
      role_id: assignedRole,
      display_name: displayNameCheck.normalized,
      avatar_url: defaultAvatar,
      bio: '',
      custom_status: null,
      level: 1,
      xp: 0,
      total_xp: 0,
      daily_streak: 0,
      equipped_frame: null,
      equipped_banner: null,
      equipped_name_style: null,
      equipped_badge: null,
      equipped_title: null,
      equipped_theme: null,
      equipped_effect: null,
      featured_achievements: [],
      registered_at: new Date().toISOString(),
    },
    token,
  });
});

app.post('/api/auth/login', authRateLimit, (req: Request, res: Response) => {
  const rawLogin = req.body?.login ?? req.body?.nickname ?? req.body?.username ?? '';
  const password = req.body?.password ?? '';
  if (typeof rawLogin !== 'string' || typeof password !== 'string' || !rawLogin.trim() || !password) {
    res.status(400).json({ error: 'Введите @username или email и пароль.' });
    return;
  }

  const trimmedInput = rawLogin.trim();
  const normalizedHandle = normalizeUsername(trimmedInput);
  const normalizedMail = trimmedInput.toLowerCase();

  const user = db.prepare(`
    SELECT u.id, u.nickname, u.email, u.email_verified, u.password_hash, u.role_id, u.is_banned, u.ban_reason,
           u.failed_login_attempts, u.locked_until, u.created_at as registered_at,
           p.display_name, p.avatar_url, p.bio, p.custom_status, p.level, p.xp, p.total_xp,
           p.daily_streak, p.equipped_frame, p.equipped_banner, p.equipped_name_style,
           p.equipped_badge, p.equipped_title, p.equipped_theme, p.equipped_effect, p.featured_achievements_json,
           p.username_changed_at
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.nickname = ? COLLATE NOCASE
       OR u.nickname = ? COLLATE NOCASE
       OR u.email = ? COLLATE NOCASE
    LIMIT 1
  `).get(trimmedInput, normalizedHandle, normalizedMail) as any;

  // Anti-enumeration: run constant-cost bcrypt check even when account is not found
  if (!user) {
    bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
    res.status(401).json({ error: 'Неверный логин или пароль.' });
    return;
  }

  // Brute-force lockout check
  const lockCheck = isAccountLocked(user.locked_until);
  if (lockCheck.locked) {
    const mins = Math.max(1, Math.ceil(lockCheck.retryAfterSeconds / 60));
    res.status(429).json({
      error: `Слишком много неудачных попыток входа. Попробуйте снова через ${mins} мин.`,
      retry_after_seconds: lockCheck.retryAfterSeconds,
    });
    return;
  }

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) {
    const nextAttempts = Number(user.failed_login_attempts || 0) + 1;
    const lockout = computeLoginLockout(nextAttempts);
    db.prepare(`
      UPDATE users
      SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nextAttempts, lockout.lockedUntil, user.id);

    if (lockout.shouldLock) {
      res.status(429).json({
        error: `Аккаунт временно заблокирован после серии неудачных попыток входа. Повторите через ${lockout.lockoutMinutes} мин.`,
        retry_after_seconds: lockout.lockoutMinutes * 60,
      });
      return;
    }

    // Generic error message — never reveal whether login existed or password was wrong
    res.status(401).json({ error: 'Неверный логин или пароль.' });
    return;
  }

  if (user.is_banned) {
    res.status(403).json({ error: `Аккаунт заблокирован: ${user.ban_reason || 'Нарушение правил сообщества.'}` });
    return;
  }

  // Reset failed login counter on successful authentication
  if (user.failed_login_attempts || user.locked_until) {
    db.prepare(`
      UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?
    `).run(user.id);
  }

  // Auto-elevate sushkanov097 to admin if needed
  if (
    (user.nickname.toLowerCase() === 'sushkanov097' ||
      (user.email && user.email.toLowerCase() === 'sushkanov097@gmail.com')) &&
    user.role_id !== 'admin'
  ) {
    db.prepare("UPDATE users SET role_id = 'admin', email = 'sushkanov097@gmail.com' WHERE id = ?").run(user.id);
    user.role_id = 'admin';
  }

  // Sync earned achievements server-side (never modifies XP)
  evaluateUserAchievements(user.id);

  const token = issueSessionForUser(res, {
    id: user.id,
    nickname: user.nickname,
    role_id: user.role_id,
  });

  const {
    password_hash,
    failed_login_attempts,
    locked_until,
    featured_achievements_json,
    ...cleanUser
  } = user;

  const totalXp = Number(cleanUser.total_xp ?? cleanUser.xp ?? 0);
  const { level: computedLevel } = calculateLevelFromXp(totalXp);

  res.json({
    user: {
      ...cleanUser,
      email_verified: Number(cleanUser.email_verified || 0),
      display_name: cleanUser.display_name && String(cleanUser.display_name).trim()
        ? cleanUser.display_name
        : cleanUser.nickname,
      total_xp: totalXp,
      level: computedLevel,
      featured_achievements: parseFeaturedAchievements(featured_achievements_json),
    },
    token,
  });
});

// Verify/sync admin email binding (restricted strictly to existing administrators)
app.post('/api/auth/bind-admin', requireAdmin, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Auth required' });
    return;
  }
  const email = typeof req.body?.email === 'string' && req.body.email.includes('@')
    ? req.body.email.trim()
    : 'sushkanov097@gmail.com';
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
  const updatedUser = db.prepare(`
    SELECT u.id, u.nickname, u.email, u.role_id,
           p.display_name, p.avatar_url, p.bio, p.level, p.xp, p.daily_streak
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `).get(req.user.id) as any;
  res.json({ ok: true, user: updatedUser });
});

// Delete uploaded file from storage, Supabase bucket, and database
app.post('/api/admin/delete-file', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Valid URL is required.' });
    return;
  }
  if (url.startsWith('/uploads/') && !url.includes('..')) {
    const filename = path.basename(url);
    const uploadPath = path.join(uploadDir, filename);
    const publicUploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
    const publicPath = path.join(publicUploadsDir, filename);

    for (const [base, candidate] of [
      [uploadDir, uploadPath],
      [publicUploadsDir, publicPath],
    ] as const) {
      if (isPathInsideDir(base, candidate) && fs.existsSync(candidate)) {
        try {
          fs.unlinkSync(candidate);
        } catch (err) {
          console.error('Failed to unlink file:', err);
        }
      }
    }
    db.prepare('DELETE FROM audio_files WHERE storage_path = ?').run(url);
    db.prepare('DELETE FROM archive_images WHERE storage_path = ?').run(url);
    db.prepare('DELETE FROM uploaded_blobs WHERE filename = ?').run(filename);
    await deleteMediaFromSupabase(filename);
  }
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const { candidates } = extractRequestTokens(req);
  for (const token of candidates) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    if (isSignedSessionToken(token)) {
      const verified = verifySessionToken(token);
      if (verified) {
        try {
          db.prepare(`
            INSERT OR REPLACE INTO revoked_sessions (sid, expires_at)
            VALUES (?, ?)
          `).run(verified.sid, new Date(verified.exp * 1000).toISOString());
        } catch {}
      }
    }
  }
  res.clearCookie('apostle_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  if (!user) {
    res.json({ user: null });
    return;
  }

  // Upgrade legacy/cookie-only sessions to stateless signed tokens transparently
  const { bearerToken } = extractRequestTokens(req);
  let upgradedToken: string | undefined;
  if (!bearerToken || !isSignedSessionToken(bearerToken)) {
    upgradedToken = issueSessionForUser(res, {
      id: user.id,
      nickname: user.nickname,
      role_id: user.role_id,
    });
  }

  // Fetch unlocked achievements with rarity and category
  const achievements = db.prepare(`
    SELECT a.id, a.slug, a.title_ru, a.title_en, a.desc_ru, a.desc_en,
           a.condition_ru, a.condition_en, a.category, a.rarity, a.icon, ua.unlocked_at
    FROM user_achievements ua
    JOIN achievements a ON a.id = ua.achievement_id
    WHERE ua.user_id = ?
    ORDER BY ua.unlocked_at DESC
  `).all(user.id);

  // Followers & Following counts
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following_count,
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts_count,
      (SELECT COUNT(*) FROM creations WHERE user_id = ?) as creations_count
  `).get(user.id, user.id, user.id, user.id) as any;

  res.json({
    user: {
      ...user,
      achievements,
      followers_count: counts.followers_count || 0,
      following_count: counts.following_count || 0,
      posts_count: counts.posts_count || 0,
      creations_count: counts.creations_count || 0,
    },
    ...(upgradedToken ? { token: upgradedToken } : {}),
  });
});

// ----------------------------------------------------------------------------
// UNIFIED XP GRANT / ROLLBACK, ANTI-SPAM & NOTIFICATION HELPERS
// ----------------------------------------------------------------------------

function awardXpWithRef(params: {
  userId: string;
  amount: number;
  source: string;
  details: string;
  referenceKey: string;
}): { awarded: boolean; amount: number; xp: number; totalXp: number; level: number } {
  const safeAmount = Math.max(0, Math.round(Number(params.amount) || 0));
  const prof = db.prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?').get(params.userId) as
    | { xp: number; total_xp: number; level: number }
    | undefined;
  if (!prof || safeAmount <= 0) {
    const currTotal = Number(prof?.total_xp || 0);
    return {
      awarded: false,
      amount: 0,
      xp: Number(prof?.xp || 0),
      totalXp: currTotal,
      level: calculateLevelFromXp(currTotal).level,
    };
  }

  const refKey = String(params.referenceKey || '').trim();
  const insertRes = db.prepare(`
    INSERT OR IGNORE INTO xp_transactions (id, user_id, amount, source, details, reference_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('xpt_' + crypto.randomUUID().slice(0, 8), params.userId, safeAmount, params.source, params.details, refKey || null);

  if (insertRes.changes !== 1) {
    const currTotal = Number(prof.total_xp || 0);
    return {
      awarded: false,
      amount: 0,
      xp: Number(prof.xp || 0),
      totalXp: currTotal,
      level: calculateLevelFromXp(currTotal).level,
    };
  }

  const nextXp = Number(prof.xp || 0) + safeAmount;
  const nextTotalXp = Number(prof.total_xp || 0) + safeAmount;
  const { level } = calculateLevelFromXp(nextTotalXp);

  db.prepare(`
    UPDATE profiles
    SET xp = ?, total_xp = ?, level = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(nextXp, nextTotalXp, level, params.userId);

  return { awarded: true, amount: safeAmount, xp: nextXp, totalXp: nextTotalXp, level };
}

function revokeXpWithRef(params: {
  userId: string;
  amount: number;
  source?: string;
  details: string;
  referenceKey: string;
}): { revoked: boolean; amount: number; xp: number; totalXp: number; level: number } {
  const safeAmount = Math.max(0, Math.round(Number(params.amount) || 0));
  const prof = db.prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?').get(params.userId) as
    | { xp: number; total_xp: number; level: number }
    | undefined;
  if (!prof || safeAmount <= 0) {
    const currTotal = Number(prof?.total_xp || 0);
    return {
      revoked: false,
      amount: 0,
      xp: Number(prof?.xp || 0),
      totalXp: currTotal,
      level: calculateLevelFromXp(currTotal).level,
    };
  }

  const refKey = String(params.referenceKey || '').trim();
  const insertRes = db.prepare(`
    INSERT OR IGNORE INTO xp_transactions (id, user_id, amount, source, details, reference_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'xpt_' + crypto.randomUUID().slice(0, 8),
    params.userId,
    -safeAmount,
    params.source || 'xp_rollback',
    params.details,
    refKey || null
  );

  if (insertRes.changes !== 1) {
    const currTotal = Number(prof.total_xp || 0);
    return {
      revoked: false,
      amount: 0,
      xp: Number(prof.xp || 0),
      totalXp: currTotal,
      level: calculateLevelFromXp(currTotal).level,
    };
  }

  const nextXp = Math.max(0, Number(prof.xp || 0) - safeAmount);
  const nextTotalXp = Math.max(0, Number(prof.total_xp || 0) - safeAmount);
  const { level } = calculateLevelFromXp(nextTotalXp);

  db.prepare(`
    UPDATE profiles
    SET xp = ?, total_xp = ?, level = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(nextXp, nextTotalXp, level, params.userId);

  return { revoked: true, amount: safeAmount, xp: nextXp, totalXp: nextTotalXp, level };
}

function getMoscowDayStartSqliteUtc(): string {
  const mskDate = getMoscowDateString();
  const utcStartMs = Date.parse(`${mskDate}T00:00:00.000Z`) - 3 * 60 * 60 * 1000;
  return new Date(utcStartMs).toISOString().slice(0, 19).replace('T', ' ');
}

function canEarnDiscussionXp(userId: string, content: string): boolean {
  const nonWhitespaceLen = String(content || '').replace(/\s+/g, '').length;
  if (nonWhitespaceLen < 15) return false;

  const recentReward = db.prepare(`
    SELECT 1 FROM xp_transactions
    WHERE user_id = ?
      AND source IN ('community_post', 'comment')
      AND amount > 0
      AND datetime(created_at) > datetime('now', '-60 seconds')
    LIMIT 1
  `).get(userId);
  if (recentReward) return false;

  const dayStartUtc = getMoscowDayStartSqliteUtc();
  const dailyRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM xp_transactions
    WHERE user_id = ?
      AND source IN ('community_post', 'comment')
      AND amount > 0
      AND datetime(created_at) >= datetime(?)
  `).get(userId, dayStartUtc) as { cnt?: number } | undefined;

  return Number(dailyRow?.cnt || 0) < 3;
}

function createNotificationRecord(params: {
  recipientUserId: string;
  actor: { id: string; nickname: string; display_name?: string };
  type: 'reply' | 'new_post' | 'new_creation' | 'new_comment' | 'news';
  targetType: 'post' | 'creation' | 'album' | 'single' | 'news';
  targetId: string;
  targetTitle: string;
  targetLink: string;
  excerpt: string;
  allowSelf?: boolean;
}) {
  if (!params.recipientUserId) return;
  if (!params.allowSelf && params.recipientUserId === params.actor.id) return;
  try {
    const cleanExcerpt = String(params.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const cleanTitle = String(params.targetTitle || '').trim().slice(0, 120);
    const actorName = (params.actor.display_name || params.actor.nickname || 'Участник').trim().slice(0, 60);
    db.prepare(`
      INSERT INTO notifications (
        id, user_id, actor_id, actor_nickname, actor_name, type,
        target_type, target_id, target_title, target_link, excerpt, is_read
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      'ntf_' + crypto.randomUUID().slice(0, 10),
      params.recipientUserId,
      params.actor.id,
      params.actor.nickname,
      actorName,
      params.type,
      params.targetType,
      params.targetId,
      cleanTitle,
      params.targetLink,
      cleanExcerpt
    );
  } catch (err) {
    console.error('[Notifications] Failed to create notification:', err);
  }
}

function createReplyNotification(params: {
  recipientUserId: string;
  actor: { id: string; nickname: string; display_name?: string };
  targetType: 'post' | 'creation' | 'album' | 'single';
  targetId: string;
  targetTitle: string;
  targetLink: string;
  excerpt: string;
}) {
  createNotificationRecord({ ...params, type: 'reply' });
}

function notifyFollowers(params: {
  author: { id: string; nickname: string; display_name?: string };
  type: 'new_post' | 'new_creation' | 'new_comment';
  targetType: 'post' | 'creation' | 'album' | 'single';
  targetId: string;
  targetTitle: string;
  targetLink: string;
  excerpt: string;
  excludeUserIds?: Set<string>;
}) {
  try {
    const followers = db.prepare(`
      SELECT f.follower_id
      FROM follows f
      JOIN users u ON u.id = f.follower_id
      JOIN profiles p ON p.user_id = u.id
      WHERE f.following_id = ?
        AND u.is_banned = 0
        AND COALESCE(p.notify_follows, 1) = 1
    `).all(params.author.id) as Array<{ follower_id: string }>;

    for (const row of followers) {
      if (row.follower_id === params.author.id) continue;
      if (params.excludeUserIds?.has(row.follower_id)) continue;
      createNotificationRecord({
        recipientUserId: row.follower_id,
        actor: params.author,
        type: params.type,
        targetType: params.targetType,
        targetId: params.targetId,
        targetTitle: params.targetTitle,
        targetLink: params.targetLink,
        excerpt: params.excerpt,
      });
    }
  } catch (err) {
    console.error('[Notifications] Failed to notify followers:', err);
  }
}

// Strictly read-only GET endpoint for gentle polling (never triggers CloudSync upload)
app.get('/api/notifications', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const notifications = db.prepare(`
    SELECT id, user_id, actor_id, actor_nickname, actor_name, type,
           target_type, target_id, target_title, target_link, excerpt, is_read, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(userId);

  const unreadRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(userId) as { cnt?: number } | undefined;

  res.json({
    notifications,
    unreadCount: Number(unreadRow?.cnt || 0),
  });
});

app.get('/api/notifications/preferences', requireAuth, (req: AuthRequest, res: Response) => {
  const row = db
    .prepare('SELECT notify_follows, notify_news FROM profiles WHERE user_id = ?')
    .get(req.user!.id) as { notify_follows?: number; notify_news?: number } | undefined;
  res.json({
    notify_follows: row?.notify_follows === 0 ? false : true,
    notify_news: Boolean(row?.notify_news),
  });
});

app.put('/api/notifications/preferences', requireAuth, (req: AuthRequest, res: Response) => {
  const { notify_follows, notify_news } = req.body || {};
  const nextFollows = notify_follows !== undefined ? (notify_follows ? 1 : 0) : null;
  const nextNews = notify_news !== undefined ? (notify_news ? 1 : 0) : null;

  db.prepare(`
    UPDATE profiles SET
      notify_follows = COALESCE(?, notify_follows),
      notify_news = COALESCE(?, notify_news),
      updated_at = datetime('now')
    WHERE user_id = ?
  `).run(nextFollows, nextNews, req.user!.id);

  const row = db
    .prepare('SELECT notify_follows, notify_news FROM profiles WHERE user_id = ?')
    .get(req.user!.id) as { notify_follows?: number; notify_news?: number } | undefined;

  res.json({
    ok: true,
    notify_follows: row?.notify_follows === 0 ? false : true,
    notify_news: Boolean(row?.notify_news),
  });
});

app.get('/api/admin/news', requireAdmin, (_req: AuthRequest, res: Response) => {
  const news = db.prepare(`
    SELECT sn.*, u.nickname as author_nickname
    FROM site_news sn
    LEFT JOIN users u ON u.id = sn.created_by
    ORDER BY datetime(sn.created_at) DESC
    LIMIT 100
  `).all();
  const subRow = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.is_banned = 0 AND COALESCE(p.notify_news, 0) = 1
  `).get() as { cnt?: number } | undefined;
  res.json({ news, subscribers_count: Number(subRow?.cnt || 0) });
});

app.post('/api/admin/news/broadcast', requireAdmin, (req: AuthRequest, res: Response) => {
  const cleanTitle = String(req.body?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const cleanMessage = String(req.body?.message || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const rawLink = String(req.body?.link || '/').trim();
  const safeLink = rawLink.startsWith('/') ? rawLink.slice(0, 200) : '/';

  if (!cleanTitle || !cleanMessage) {
    res.status(400).json({ error: 'Укажите заголовок и текст новости.' });
    return;
  }

  const subscribers = db.prepare(`
    SELECT u.id
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.is_banned = 0 AND COALESCE(p.notify_news, 0) = 1
  `).all() as Array<{ id: string }>;

  const newsId = 'news_' + crypto.randomUUID().slice(0, 8);
  let sentCount = 0;

  db.transaction(() => {
    for (const sub of subscribers) {
      createNotificationRecord({
        recipientUserId: sub.id,
        actor: req.user!,
        type: 'news',
        targetType: 'news',
        targetId: newsId,
        targetTitle: cleanTitle,
        targetLink: safeLink,
        excerpt: cleanMessage,
        allowSelf: true,
      });
      sentCount += 1;
    }
    db.prepare(`
      INSERT INTO site_news (id, title, message, link, sent_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newsId, cleanTitle, cleanMessage, safeLink, sentCount, req.user!.id);
  })();

  res.json({ ok: true, id: newsId, sent_count: sentCount });
});

app.post('/api/notifications/read', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id, all } = req.body || {};

  if (all) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
  } else if (typeof id === 'string' && id.trim()) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id.trim(), userId);
  } else {
    res.status(400).json({ error: 'Specify notification id or all: true.' });
    return;
  }

  const unreadRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(userId) as { cnt?: number } | undefined;

  res.json({ ok: true, unreadCount: Number(unreadRow?.cnt || 0) });
});

app.post('/api/rules/accept', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare("UPDATE users SET accepted_rules = 1, updated_at = datetime('now') WHERE id = ?").run(req.user!.id);
  res.json({ ok: true, accepted_rules: 1 });
});

const DEFAULT_COMMUNITY_RULES_FALLBACK = {
  intro_ru:
    'Тут общаются слушатели и авторы вокруг музыки deathmarried. Чтобы всем было комфортно, держимся четырёх простых правил:',
  intro_en:
    'Listeners and creators gather here around deathmarried music. To keep the space welcoming, we follow four simple rules:',
  footer_ru:
    'За нарушения модераторы могут скрыть или удалить публикацию, а при повторах — ограничить доступ к аккаунту.',
  footer_en:
    'Moderators may hide or remove content that breaks the rules, and repeated violations can lead to account restrictions.',
  items: [
    {
      title_ru: 'Без 18+ и NSFW',
      title_en: 'No 18+ or NSFW',
      body_ru: 'Никакой порнографии, эротики и откровенного контента — ни в текстах, ни в картинках, ни в ссылках.',
      body_en: 'No pornography, erotica, or explicit adult content in text, images, or external links.',
    },
    {
      title_ru: 'Без насилия, крови и жести',
      title_en: 'No violence or gore',
      body_ru: 'Запрещены шок-контент, реальная кровь, расчленёнка, угрозы и любые призывы к причинению вреда.',
      body_en: 'Shock content, real gore, threats, and any calls to violence or self-harm are strictly forbidden.',
    },
    {
      title_ru: 'Без оскорблений и травли',
      title_en: 'No harassment or hate',
      body_ru: 'Спорить о музыке и вкусах — нормально. Переходить на личности, унижать участников или разжигать ненависть — нет.',
      body_en: 'Debating music and taste is welcome; personal attacks, bullying, and hate speech are not.',
    },
    {
      title_ru: 'Без спама и рекламы',
      title_en: 'No spam or promotion',
      body_ru: 'Никакого флуда, реферальных ссылок, рекламы чужих каналов/магазинов, ботов и скама.',
      body_en: 'No flooding, referral links, unsolicited promotion of external channels/stores, bots, or scams.',
    },
  ],
};

app.get('/api/rules', (_req: Request, res: Response) => {
  try {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'community_rules_json'").get() as
      | { value?: string }
      | undefined;
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
        res.json({ rules: parsed });
        return;
      }
    }
  } catch {}
  res.json({ rules: DEFAULT_COMMUNITY_RULES_FALLBACK });
});

app.put('/api/admin/rules', requireAdmin, (req: AuthRequest, res: Response) => {
  const payload = req.body?.rules ?? req.body;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items) || payload.items.length === 0) {
    res.status(400).json({ error: 'Нужен минимум один пункт правил.' });
    return;
  }

  const cleanItems = payload.items
    .map((item: any) => ({
      title_ru: String(item?.title_ru || '').trim().slice(0, 140),
      title_en: String(item?.title_en || item?.title_ru || '').trim().slice(0, 140),
      body_ru: String(item?.body_ru || '').trim().slice(0, 1000),
      body_en: String(item?.body_en || item?.body_ru || '').trim().slice(0, 1000),
    }))
    .filter((it: any) => it.title_ru && it.body_ru)
    .slice(0, 25);

  if (cleanItems.length === 0) {
    res.status(400).json({ error: 'Заполните заголовок и текст хотя бы одного правила.' });
    return;
  }

  const normalized = {
    intro_ru: String(payload.intro_ru || DEFAULT_COMMUNITY_RULES_FALLBACK.intro_ru).trim().slice(0, 800),
    intro_en: String(payload.intro_en || payload.intro_ru || DEFAULT_COMMUNITY_RULES_FALLBACK.intro_en)
      .trim()
      .slice(0, 800),
    footer_ru: String(payload.footer_ru || DEFAULT_COMMUNITY_RULES_FALLBACK.footer_ru).trim().slice(0, 800),
    footer_en: String(payload.footer_en || payload.footer_ru || DEFAULT_COMMUNITY_RULES_FALLBACK.footer_en)
      .trim()
      .slice(0, 800),
    items: cleanItems,
  };

  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES ('community_rules_json', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(normalized));

  res.json({ ok: true, rules: normalized });
});

// ----------------------------------------------------------------------------
// API: ARCHIVE (ALBUMS, SINGLES, TRACKS & RELEASE COMMENTS)
// ----------------------------------------------------------------------------

app.get('/api/archive/:releaseType/:releaseId/comments', (req: Request, res: Response) => {
  const releaseType = String(req.params.releaseType || '').toLowerCase();
  const releaseId = String(req.params.releaseId || '').trim();
  if ((releaseType !== 'album' && releaseType !== 'single') || !releaseId) {
    res.status(400).json({ error: 'Invalid release target.' });
    return;
  }

  const user = getSessionUser(req);
  const isStaff = Boolean(user && (user.role_id === 'admin' || user.role_id === 'moderator'));
  const col = releaseType === 'album' ? 'cm.album_id' : 'cm.single_id';

  const comments = db.prepare(`
    SELECT cm.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge, pr.equipped_title as author_title
    FROM comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE ${col} = ? ${isStaff ? '' : 'AND COALESCE(cm.is_hidden, 0) = 0'}
    ORDER BY cm.created_at ASC
    LIMIT 200
  `).all(releaseId);

  res.json({ comments });
});

app.post('/api/archive/:releaseType/:releaseId/comments', requireAuth, (req: AuthRequest, res: Response) => {
  const releaseType = String(req.params.releaseType || '').toLowerCase() as 'album' | 'single';
  const releaseId = String(req.params.releaseId || '').trim();
  if ((releaseType !== 'album' && releaseType !== 'single') || !releaseId) {
    res.status(400).json({ error: 'Invalid release target.' });
    return;
  }

  const { content, parent_id } = req.body || {};
  const cleanContent = content ? String(content).trim().slice(0, 1500) : '';
  if (!cleanContent) {
    res.status(400).json({ error: 'Текст комментария не может быть пустым.' });
    return;
  }

  const targetRelease = releaseType === 'album'
    ? (db.prepare('SELECT id, title FROM albums WHERE id = ?').get(releaseId) as any)
    : (db.prepare('SELECT id, title FROM singles WHERE id = ?').get(releaseId) as any);

  if (!targetRelease) {
    res.status(404).json({ error: 'Релиз не найден.' });
    return;
  }

  let parentComment: any = null;
  if (parent_id && typeof parent_id === 'string') {
    parentComment = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(parent_id) as any;
  }

  const id = 'cm_' + crypto.randomUUID().slice(0, 8);
  let newlyUnlocked: UnlockedAchievementInfo[] = [];
  let xpAwardedAmount = 0;

  db.transaction(() => {
    const eligibleXp = canEarnDiscussionXp(req.user!.id, cleanContent);
    xpAwardedAmount = eligibleXp ? 5 : 0;

    db.prepare(`
      INSERT INTO comments (id, user_id, album_id, single_id, content, parent_id, is_hidden, xp_awarded, xp_awarded_amount)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      req.user!.id,
      releaseType === 'album' ? releaseId : null,
      releaseType === 'single' ? releaseId : null,
      cleanContent,
      parentComment ? parentComment.id : null,
      xpAwardedAmount > 0 ? 1 : 0,
      xpAwardedAmount
    );

    if (xpAwardedAmount > 0) {
      awardXpWithRef({
        userId: req.user!.id,
        amount: xpAwardedAmount,
        source: 'comment',
        details: `Комментарий к релизу «${String(targetRelease.title).slice(0, 36)}»`,
        referenceKey: `award:comment:${id}`,
      });
    }

    const excluded = new Set<string>();
    const targetLink = `/archive?${releaseType}=${encodeURIComponent(releaseId)}`;
    if (parentComment && parentComment.user_id && parentComment.user_id !== req.user!.id) {
      excluded.add(parentComment.user_id);
      createReplyNotification({
        recipientUserId: parentComment.user_id,
        actor: req.user!,
        targetType: releaseType,
        targetId: releaseId,
        targetTitle: targetRelease.title,
        targetLink,
        excerpt: cleanContent,
      });
    }

    notifyFollowers({
      author: req.user!,
      type: 'new_comment',
      targetType: releaseType,
      targetId: releaseId,
      targetTitle: targetRelease.title,
      targetLink,
      excerpt: cleanContent,
      excludeUserIds: excluded,
    });

    newlyUnlocked = evaluateUserAchievements(req.user!.id);
  })();

  res.json({ ok: true, id, xp_earned: xpAwardedAmount, newly_unlocked_achievements: newlyUnlocked });
});

app.get('/api/archive/albums', (_req: Request, res: Response) => {
  const albums = db.prepare(`
    SELECT * FROM albums ORDER BY sort_order ASC, created_at DESC
  `).all() as any[];

  const getTracks = db.prepare(`
    SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number ASC
  `);

  const full = albums.map((alb) => {
    let streaming_links = {};
    try {
      if (alb.streaming_links_json) streaming_links = JSON.parse(alb.streaming_links_json);
    } catch {}

    const rawTracks = getTracks.all(alb.id) as any[];
    const tracks = rawTracks.map((trk) => ({
      ...trk,
      has_local_audio: localAudioExists(trk.audio_url),
    }));

    return {
      ...alb,
      streaming_links,
      tracks,
    };
  });

  res.json({ albums: full });
});

app.get('/api/archive/singles', (_req: Request, res: Response) => {
  const singles = db.prepare(`
    SELECT * FROM singles ORDER BY sort_order ASC, created_at DESC
  `).all() as any[];

  const full = singles.map((sng) => {
    let streaming_links = {};
    try {
      if (sng.streaming_links_json) streaming_links = JSON.parse(sng.streaming_links_json);
    } catch {}
    return {
      ...sng,
      streaming_links,
      has_local_audio: localAudioExists(sng.audio_url),
    };
  });

  res.json({ singles: full });
});

app.get('/api/archive/albums/:id', (req: Request, res: Response) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id) as any;
  if (!album) {
    res.status(404).json({ error: 'Album not found' });
    return;
  }
  let streaming_links = {};
  try {
    if (album.streaming_links_json) streaming_links = JSON.parse(album.streaming_links_json);
  } catch {}

  const rawTracks = db.prepare('SELECT * FROM tracks WHERE album_id = ? ORDER BY track_number ASC').all(album.id) as any[];
  const tracks = rawTracks.map((trk) => ({
    ...trk,
    has_local_audio: localAudioExists(trk.audio_url),
  }));

  res.json({ album: { ...album, streaming_links, tracks } });
});

// Single details route
app.get('/api/archive/singles/:id', (req: Request, res: Response) => {
  const single = db.prepare('SELECT * FROM singles WHERE id = ?').get(req.params.id) as any;
  if (!single) {
    res.status(404).json({ error: 'Single not found' });
    return;
  }
  let streaming_links = {};
  try {
    if (single.streaming_links_json) streaming_links = JSON.parse(single.streaming_links_json);
  } catch {}
  res.json({
    single: {
      ...single,
      streaming_links,
      has_local_audio: localAudioExists(single.audio_url),
    },
  });
});

// Admin album management
app.post('/api/archive/albums', requireAdmin, (req: AuthRequest, res: Response) => {
  const { title, format_type, release_year, release_date, cover_url, description, source_url, streaming_links, sort_order } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Album title is required.' });
    return;
  }
  const cleanCover = typeof cover_url === 'string' && cover_url.trim() ? cover_url.trim() : null;
  if (cleanCover && !isSafeMediaUrl(cleanCover)) {
    res.status(400).json({ error: 'Invalid cover URL.' });
    return;
  }
  const cleanSource = typeof source_url === 'string' && source_url.trim() ? source_url.trim() : '';
  if (cleanSource && !isSafeMediaUrl(cleanSource)) {
    res.status(400).json({ error: 'Invalid source URL.' });
    return;
  }
  const parsedLinks = typeof streaming_links === 'object'
    ? sanitizeStreamingLinks(streaming_links)
    : (() => {
        try {
          return sanitizeStreamingLinks(JSON.parse(req.body.streaming_links_json || '{}'));
        } catch {
          return {};
        }
      })();
  const id = 'alb_' + crypto.randomUUID().slice(0, 8);
  const yearNum = Number(release_year) || new Date().getFullYear();
  db.prepare(`
    INSERT INTO albums (id, title, format_type, release_year, release_date, cover_url, description, source_url, streaming_links_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title.trim(),
    format_type === 'ep' ? 'ep' : 'album',
    yearNum,
    typeof release_date === 'string' && release_date.trim() ? release_date.trim() : `${yearNum}-01-01`,
    cleanCover,
    typeof description === 'string' ? description : '',
    cleanSource,
    JSON.stringify(parsedLinks),
    sort_order ?? 10
  );

  res.json({ ok: true, id });
});

app.put('/api/archive/albums/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existingAlbum = db.prepare('SELECT id FROM albums WHERE id = ?').get(req.params.id);
  if (!existingAlbum) {
    res.status(404).json({ error: 'Album not found' });
    return;
  }

  const { title, format_type, release_year, release_date, cover_url, description, source_url, streaming_links, sort_order } = req.body || {};
  const hasCover = 'cover_url' in (req.body || {});
  const nextCover = typeof cover_url === 'string' && cover_url.trim() ? cover_url.trim() : null;
  if (hasCover && nextCover && !isSafeMediaUrl(nextCover)) {
    res.status(400).json({ error: 'Invalid cover URL.' });
    return;
  }
  if (typeof source_url === 'string' && source_url.trim() && !isSafeMediaUrl(source_url.trim())) {
    res.status(400).json({ error: 'Invalid source URL.' });
    return;
  }
  let linksJson: string | undefined;
  if (streaming_links !== undefined) {
    if (typeof streaming_links === 'object') {
      linksJson = JSON.stringify(sanitizeStreamingLinks(streaming_links));
    } else if (typeof streaming_links === 'string') {
      try {
        linksJson = JSON.stringify(sanitizeStreamingLinks(JSON.parse(streaming_links)));
      } catch {
        linksJson = '{}';
      }
    }
  }

  db.prepare(`
    UPDATE albums SET
      title = COALESCE(?, title),
      format_type = COALESCE(?, format_type),
      release_year = COALESCE(?, release_year),
      release_date = COALESCE(?, release_date),
      cover_url = CASE WHEN ? = 1 THEN ? ELSE cover_url END,
      description = COALESCE(?, description),
      source_url = COALESCE(?, source_url),
      streaming_links_json = COALESCE(?, streaming_links_json),
      sort_order = COALESCE(?, sort_order),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    typeof title === 'string' && title.trim() ? title.trim() : null,
    format_type === 'ep' || format_type === 'album' ? format_type : null,
    release_year ?? null,
    typeof release_date === 'string' ? release_date : null,
    hasCover ? 1 : 0,
    nextCover,
    typeof description === 'string' ? description : null,
    typeof source_url === 'string' ? source_url.trim() : null,
    linksJson ?? null,
    sort_order ?? null,
    req.params.id
  );

  const updatedAlbum = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  res.json({ ok: true, id: req.params.id, album: updatedAlbum });
});

app.delete('/api/archive/albums/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const albumId = req.params.id;
  const existingAlbum = db.prepare('SELECT id FROM albums WHERE id = ?').get(albumId);
  if (!existingAlbum) {
    res.status(404).json({ error: 'Album not found' });
    return;
  }

  let deletedTracks = 0;
  db.transaction(() => {
    const albumTracks = db.prepare('SELECT id FROM tracks WHERE album_id = ?').all(albumId) as Array<{ id: string }>;
    deletedTracks = albumTracks.length;

    for (const trk of albumTracks) {
      db.prepare('UPDATE audio_files SET track_id = NULL WHERE track_id = ?').run(trk.id);
      db.prepare('DELETE FROM guess_track_rounds WHERE correct_track_id = ?').run(trk.id);
      db.prepare("DELETE FROM favorites WHERE target_type = 'track' AND target_id = ?").run(trk.id);
    }

    db.prepare("DELETE FROM favorites WHERE target_type = 'album' AND target_id = ?").run(albumId);
    db.prepare("DELETE FROM reactions WHERE target_type = 'album' AND target_id = ?").run(albumId);
    db.prepare('DELETE FROM tracks WHERE album_id = ?').run(albumId);
    db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
  })();

  res.json({ ok: true, deletedId: albumId, deletedTracks });
});

// Admin tracks management
app.post('/api/archive/tracks', requireAdmin, (req: AuthRequest, res: Response) => {
  const { album_id, single_id, title, track_number, duration_seconds, audio_url, lyrics, external_url } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Track title is required.' });
    return;
  }
  if (album_id) {
    const parentAlbum = db.prepare('SELECT id FROM albums WHERE id = ?').get(album_id);
    if (!parentAlbum) {
      res.status(400).json({ error: 'Selected album does not exist.' });
      return;
    }
  }
  if (single_id) {
    const parentSingle = db.prepare('SELECT id FROM singles WHERE id = ?').get(single_id);
    if (!parentSingle) {
      res.status(400).json({ error: 'Selected single does not exist.' });
      return;
    }
  }
  const cleanAudio = typeof audio_url === 'string' ? audio_url.trim() : '';
  if (cleanAudio && !isSafeMediaUrl(cleanAudio)) {
    res.status(400).json({ error: 'Invalid audio URL.' });
    return;
  }
  const cleanExternal = typeof external_url === 'string' ? external_url.trim() : '';
  if (cleanExternal && !isSafeMediaUrl(cleanExternal)) {
    res.status(400).json({ error: 'Invalid external URL.' });
    return;
  }

  const id = 'trk_' + crypto.randomUUID().slice(0, 8);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO tracks (id, album_id, single_id, title, track_number, duration_seconds, audio_url, lyrics, external_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      album_id || null,
      single_id || null,
      title.trim(),
      Number(track_number) || 1,
      Number(duration_seconds) || 180,
      cleanAudio,
      typeof lyrics === 'string' ? lyrics : '',
      cleanExternal
    );

    if (cleanAudio.startsWith('/uploads/')) {
      db.prepare('UPDATE audio_files SET track_id = ? WHERE storage_path = ?').run(id, cleanAudio);
    }

    if (album_id) {
      db.prepare(`
        UPDATE albums SET
          track_count = (SELECT COUNT(*) FROM tracks WHERE album_id = ?),
          duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM tracks WHERE album_id = ?),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(album_id, album_id, album_id);
    }
  })();

  const savedTrack = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as any;
  res.json({
    ok: true,
    id,
    track: savedTrack ? { ...savedTrack, has_local_audio: localAudioExists(savedTrack.audio_url) } : null,
  });
});

app.put('/api/archive/tracks/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existingTrack = db.prepare('SELECT album_id, audio_url FROM tracks WHERE id = ?').get(req.params.id) as any;
  if (!existingTrack) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  const { album_id, title, track_number, duration_seconds, audio_url, lyrics, external_url } = req.body || {};
  const hasAlbumId = 'album_id' in (req.body || {});
  if (hasAlbumId && album_id) {
    const parentAlbum = db.prepare('SELECT id FROM albums WHERE id = ?').get(album_id);
    if (!parentAlbum) {
      res.status(400).json({ error: 'Selected album does not exist.' });
      return;
    }
  }
  const hasAudio = 'audio_url' in (req.body || {});
  const nextAudio = typeof audio_url === 'string' ? audio_url.trim() : '';
  if (hasAudio && nextAudio && !isSafeMediaUrl(nextAudio)) {
    res.status(400).json({ error: 'Invalid audio URL.' });
    return;
  }
  if (typeof external_url === 'string' && external_url.trim() && !isSafeMediaUrl(external_url.trim())) {
    res.status(400).json({ error: 'Invalid external URL.' });
    return;
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE tracks SET
        album_id = CASE WHEN ? = 1 THEN ? ELSE album_id END,
        title = COALESCE(?, title),
        track_number = COALESCE(?, track_number),
        duration_seconds = COALESCE(?, duration_seconds),
        audio_url = CASE WHEN ? = 1 THEN ? ELSE audio_url END,
        lyrics = COALESCE(?, lyrics),
        external_url = COALESCE(?, external_url)
      WHERE id = ?
    `).run(
      hasAlbumId ? 1 : 0,
      album_id || null,
      typeof title === 'string' && title.trim() ? title.trim() : null,
      track_number ?? null,
      duration_seconds ?? null,
      hasAudio ? 1 : 0,
      nextAudio,
      typeof lyrics === 'string' ? lyrics : null,
      typeof external_url === 'string' ? external_url.trim() : null,
      req.params.id
    );

    if (hasAudio) {
      db.prepare('UPDATE audio_files SET track_id = NULL WHERE track_id = ? AND storage_path != ?').run(req.params.id, nextAudio);
      if (nextAudio.startsWith('/uploads/')) {
        db.prepare('UPDATE audio_files SET track_id = ? WHERE storage_path = ?').run(req.params.id, nextAudio);
      }
    }

    const updatedRef = db.prepare('SELECT album_id FROM tracks WHERE id = ?').get(req.params.id) as any;
    const affectedAlbums = new Set<string>();
    if (existingTrack.album_id) affectedAlbums.add(existingTrack.album_id);
    if (updatedRef?.album_id) affectedAlbums.add(updatedRef.album_id);

    for (const albId of affectedAlbums) {
      db.prepare(`
        UPDATE albums SET
          track_count = (SELECT COUNT(*) FROM tracks WHERE album_id = ?),
          duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM tracks WHERE album_id = ?),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(albId, albId, albId);
    }
  })();

  const savedTrack = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id) as any;
  res.json({
    ok: true,
    id: req.params.id,
    track: savedTrack ? { ...savedTrack, has_local_audio: localAudioExists(savedTrack.audio_url) } : null,
  });
});

app.delete('/api/archive/tracks/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const track = db.prepare('SELECT id, album_id FROM tracks WHERE id = ?').get(req.params.id) as any;
  if (!track) {
    res.status(404).json({ error: 'Track not found' });
    return;
  }

  db.transaction(() => {
    db.prepare('UPDATE audio_files SET track_id = NULL WHERE track_id = ?').run(track.id);
    db.prepare('DELETE FROM guess_track_rounds WHERE correct_track_id = ?').run(track.id);
    db.prepare("DELETE FROM favorites WHERE target_type = 'track' AND target_id = ?").run(track.id);
    db.prepare('DELETE FROM tracks WHERE id = ?').run(track.id);
    if (track.album_id) {
      db.prepare(`
        UPDATE albums SET
          track_count = (SELECT COUNT(*) FROM tracks WHERE album_id = ?),
          duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM tracks WHERE album_id = ?),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(track.album_id, track.album_id, track.album_id);
    }
  })();

  res.json({ ok: true, deletedId: track.id });
});

// Admin singles management
app.post('/api/archive/singles', requireAdmin, (req: AuthRequest, res: Response) => {
  const { title, release_year, release_date, cover_url, description, duration_seconds, audio_url, lyrics, streaming_links, sort_order } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Single title is required.' });
    return;
  }
  const cleanCover = typeof cover_url === 'string' && cover_url.trim() ? cover_url.trim() : null;
  if (cleanCover && !isSafeMediaUrl(cleanCover)) {
    res.status(400).json({ error: 'Invalid cover URL.' });
    return;
  }
  const cleanAudio = typeof audio_url === 'string' ? audio_url.trim() : '';
  if (cleanAudio && !isSafeMediaUrl(cleanAudio)) {
    res.status(400).json({ error: 'Invalid audio URL.' });
    return;
  }
  const parsedLinks = typeof streaming_links === 'object'
    ? sanitizeStreamingLinks(streaming_links)
    : (() => {
        try {
          return sanitizeStreamingLinks(JSON.parse(req.body.streaming_links_json || '{}'));
        } catch {
          return {};
        }
      })();
  const id = 'sng_' + crypto.randomUUID().slice(0, 8);
  const yearNum = Number(release_year) || new Date().getFullYear();
  db.prepare(`
    INSERT INTO singles (id, title, release_year, release_date, cover_url, description, duration_seconds, audio_url, lyrics, streaming_links_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title.trim(),
    yearNum,
    typeof release_date === 'string' && release_date.trim() ? release_date.trim() : `${yearNum}-01-01`,
    cleanCover,
    typeof description === 'string' ? description : '',
    Number(duration_seconds) || 180,
    cleanAudio,
    typeof lyrics === 'string' ? lyrics : '',
    JSON.stringify(parsedLinks),
    sort_order ?? 10
  );

  res.json({ ok: true, id });
});

app.put('/api/archive/singles/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existingSingle = db.prepare('SELECT id FROM singles WHERE id = ?').get(req.params.id);
  if (!existingSingle) {
    res.status(404).json({ error: 'Single not found' });
    return;
  }

  const { title, release_year, release_date, cover_url, description, duration_seconds, audio_url, lyrics, streaming_links, sort_order } = req.body || {};
  const hasCover = 'cover_url' in (req.body || {});
  const nextCover = typeof cover_url === 'string' && cover_url.trim() ? cover_url.trim() : null;
  if (hasCover && nextCover && !isSafeMediaUrl(nextCover)) {
    res.status(400).json({ error: 'Invalid cover URL.' });
    return;
  }
  const hasAudio = 'audio_url' in (req.body || {});
  const nextAudio = typeof audio_url === 'string' ? audio_url.trim() : '';
  if (hasAudio && nextAudio && !isSafeMediaUrl(nextAudio)) {
    res.status(400).json({ error: 'Invalid audio URL.' });
    return;
  }
  let linksJson: string | undefined;
  if (streaming_links !== undefined) {
    if (typeof streaming_links === 'object') {
      linksJson = JSON.stringify(sanitizeStreamingLinks(streaming_links));
    } else if (typeof streaming_links === 'string') {
      try {
        linksJson = JSON.stringify(sanitizeStreamingLinks(JSON.parse(streaming_links)));
      } catch {
        linksJson = '{}';
      }
    }
  }

  db.prepare(`
    UPDATE singles SET
      title = COALESCE(?, title),
      release_year = COALESCE(?, release_year),
      release_date = COALESCE(?, release_date),
      cover_url = CASE WHEN ? = 1 THEN ? ELSE cover_url END,
      description = COALESCE(?, description),
      duration_seconds = COALESCE(?, duration_seconds),
      audio_url = CASE WHEN ? = 1 THEN ? ELSE audio_url END,
      lyrics = COALESCE(?, lyrics),
      streaming_links_json = COALESCE(?, streaming_links_json),
      sort_order = COALESCE(?, sort_order),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    typeof title === 'string' && title.trim() ? title.trim() : null,
    release_year ?? null,
    typeof release_date === 'string' ? release_date : null,
    hasCover ? 1 : 0,
    nextCover,
    typeof description === 'string' ? description : null,
    duration_seconds ?? null,
    hasAudio ? 1 : 0,
    nextAudio,
    typeof lyrics === 'string' ? lyrics : null,
    linksJson ?? null,
    sort_order ?? null,
    req.params.id
  );

  const savedSingle = db.prepare('SELECT * FROM singles WHERE id = ?').get(req.params.id);
  res.json({ ok: true, id: req.params.id, single: savedSingle });
});

app.delete('/api/archive/singles/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const singleId = req.params.id;
  const existingSingle = db.prepare('SELECT id FROM singles WHERE id = ?').get(singleId);
  if (!existingSingle) {
    res.status(404).json({ error: 'Single not found' });
    return;
  }

  db.transaction(() => {
    const linkedTracks = db.prepare('SELECT id FROM tracks WHERE single_id = ?').all(singleId) as Array<{ id: string }>;
    for (const trk of linkedTracks) {
      db.prepare('UPDATE audio_files SET track_id = NULL WHERE track_id = ?').run(trk.id);
      db.prepare('DELETE FROM guess_track_rounds WHERE correct_track_id = ?').run(trk.id);
    }
    db.prepare('DELETE FROM guess_track_rounds WHERE correct_track_id = ?').run(singleId);
    db.prepare("DELETE FROM favorites WHERE target_type = 'single' AND target_id = ?").run(singleId);
    db.prepare('DELETE FROM tracks WHERE single_id = ?').run(singleId);
    db.prepare('DELETE FROM singles WHERE id = ?').run(singleId);
  })();

  res.json({ ok: true, deletedId: singleId });
});

// Admin media storage inventory (audio tracks + uploaded cover images)
app.get('/api/admin/audio-files', requireAdmin, (_req: Request, res: Response) => {
  const audioFiles = db.prepare(`
    SELECT af.id, af.filename, af.mime_type, af.byte_size, af.storage_path, af.created_at,
           u.nickname as uploader_name, t.title as attached_track_title
    FROM audio_files af
    LEFT JOIN users u ON u.id = af.uploaded_by
    LEFT JOIN tracks t ON t.id = af.track_id
  `).all() as any[];

  const imageFiles = db.prepare(`
    SELECT ai.id, ai.title as filename, 'image/*' as mime_type,
           COALESCE(ub.byte_size, 0) as byte_size,
           ai.storage_path, ai.created_at,
           u.nickname as uploader_name, NULL as attached_track_title
    FROM archive_images ai
    LEFT JOIN users u ON u.id = ai.uploaded_by
    LEFT JOIN uploaded_blobs ub ON ub.filename = replace(ai.storage_path, '/uploads/', '')
  `).all() as any[];

  const files = [...audioFiles, ...imageFiles].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  res.json({ files });
});

// ----------------------------------------------------------------------------
// API: GAMES & XP (24H UTC DAILY CHALLENGES + LEADERBOARD)
// ----------------------------------------------------------------------------

function getDailyChallengeSecret(): string {
  const configured = (process.env.SESSION_SECRET || '').trim();
  return configured ? `daily-games:${configured}` : 'apostles-daily-challenge-v1';
}

function resolveEffectiveTrackDuration(audioUrl: string, dbDurationSeconds: number): number {
  const trimmed = (audioUrl || '').trim();
  if (trimmed.startsWith('/audio/') && !trimmed.includes('..')) {
    const filename = path.basename(trimmed);
    const publicAudioDir = path.resolve(process.cwd(), 'public', 'audio');
    const distAudioDir = path.resolve(process.cwd(), 'dist', 'audio');
    const candidates = [
      { dir: publicAudioDir, file: path.join(publicAudioDir, filename) },
      { dir: distAudioDir, file: path.join(distAudioDir, filename) },
    ];
    for (const { dir, file } of candidates) {
      if (isPathInsideDir(dir, file)) {
        const wavDur = readLocalWavDurationSeconds(file);
        if (wavDur && wavDur > 0) return wavDur;
      }
    }
  } else if (trimmed.startsWith('/uploads/') && !trimmed.includes('..')) {
    const filename = path.basename(trimmed);
    const publicUploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
    const candidates = [
      { dir: uploadDir, file: path.join(uploadDir, filename) },
      { dir: publicUploadsDir, file: path.join(publicUploadsDir, filename) },
    ];
    for (const { dir, file } of candidates) {
      if (isPathInsideDir(dir, file)) {
        const wavDur = readLocalWavDurationSeconds(file);
        if (wavDur && wavDur > 0) return wavDur;
      }
    }
  }
  const parsed = Number(dbDurationSeconds);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeSameOriginAudioUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/audio/')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(/\/([^/]+\.(?:mp3|wav|ogg|m4a|flac|aac))$/i);
    if (match && /supabase\.(co|in)|storage/i.test(parsed.hostname)) {
      return `/uploads/${encodeURIComponent(match[1])}`;
    }
  } catch {}
  return trimmed;
}

function getPlayableGameTrackPool(): {
  playablePool: PlayableTrackCandidate[];
  allTitles: TitleOption[];
} {
  const rawTracks = db.prepare(`
    SELECT t.id, t.title, t.audio_url, t.duration_seconds,
           COALESCE(a.title, s.title, 'Archive Release') as album_title,
           COALESCE(a.cover_url, s.cover_url, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg') as cover_url
    FROM tracks t
    LEFT JOIN albums a ON a.id = t.album_id
    LEFT JOIN singles s ON s.id = t.single_id
    WHERE t.audio_url IS NOT NULL AND trim(t.audio_url) != '' AND (t.is_game_eligible = 1 OR t.is_game_eligible IS NULL)
  `).all() as any[];

  const rawSingles = db.prepare(`
    SELECT s.id, s.title, s.audio_url, s.duration_seconds,
           'Single' as album_title,
           COALESCE(s.cover_url, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg') as cover_url
    FROM singles s
    WHERE s.audio_url IS NOT NULL AND trim(s.audio_url) != '' AND (s.is_game_eligible = 1 OR s.is_game_eligible IS NULL)
      AND s.id NOT IN (SELECT single_id FROM tracks WHERE single_id IS NOT NULL)
  `).all() as any[];

  const playablePool: PlayableTrackCandidate[] = [
    ...rawTracks.map((row) => ({
      id: String(row.id),
      title: String(row.title || '').trim(),
      audio_url: normalizeSameOriginAudioUrl(String(row.audio_url || '')),
      duration_seconds: resolveEffectiveTrackDuration(String(row.audio_url || ''), Number(row.duration_seconds) || 0),
      source: 'track' as const,
      album_title: row.album_title,
      cover_url: row.cover_url,
    })),
    ...rawSingles.map((row) => ({
      id: String(row.id),
      title: String(row.title || '').trim(),
      audio_url: normalizeSameOriginAudioUrl(String(row.audio_url || '')),
      duration_seconds: resolveEffectiveTrackDuration(String(row.audio_url || ''), Number(row.duration_seconds) || 0),
      source: 'single' as const,
      album_title: row.album_title,
      cover_url: row.cover_url,
    })),
  ].filter((item) => item.title.length > 0 && localAudioExists(item.audio_url));

  const allTitles = db.prepare(`
    SELECT id, title FROM tracks WHERE title IS NOT NULL AND trim(title) != ''
    UNION
    SELECT id, title FROM singles WHERE title IS NOT NULL AND trim(title) != ''
  `).all() as TitleOption[];

  return { playablePool, allTitles };
}

function getLyricGameTrackPool(): LyricTrackCandidate[] {
  const rawTracks = db.prepare(`
    SELECT t.id, t.title, t.lyrics,
           COALESCE(a.title, s.title, 'Archive Release') as album_title,
           COALESCE(a.cover_url, s.cover_url, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg') as cover_url
    FROM tracks t
    LEFT JOIN albums a ON a.id = t.album_id
    LEFT JOIN singles s ON s.id = t.single_id
    WHERE t.lyrics IS NOT NULL AND length(trim(t.lyrics)) > 15
  `).all() as any[];

  const rawSingles = db.prepare(`
    SELECT s.id, s.title, s.lyrics,
           'Single' as album_title,
           COALESCE(s.cover_url, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg') as cover_url
    FROM singles s
    WHERE s.lyrics IS NOT NULL AND length(trim(s.lyrics)) > 15
      AND s.id NOT IN (SELECT single_id FROM tracks WHERE single_id IS NOT NULL)
  `).all() as any[];

  return [
    ...rawTracks.map((row) => ({
      id: String(row.id),
      title: String(row.title || '').trim(),
      lyrics: String(row.lyrics || ''),
      source: 'track' as const,
      album_title: row.album_title,
      cover_url: row.cover_url,
    })),
    ...rawSingles.map((row) => ({
      id: String(row.id),
      title: String(row.title || '').trim(),
      lyrics: String(row.lyrics || ''),
      source: 'single' as const,
      album_title: row.album_title,
      cover_url: row.cover_url,
    })),
  ].filter((t) => t.title.length > 0 && t.lyrics.trim().length > 15);
}

function getQuizSettingsFromDb(): { quiz_enabled: boolean; active_quiz_ids: string[] } {
  let quizEnabled = true;
  let activeQuizIds: string[] = [];
  try {
    const enabledRow = db.prepare("SELECT value FROM app_meta WHERE key = 'quiz_enabled'").get() as
      | { value: string }
      | undefined;
    if (enabledRow && (enabledRow.value === '0' || enabledRow.value === 'false')) {
      quizEnabled = false;
    }
    const idsRow = db.prepare("SELECT value FROM app_meta WHERE key = 'active_quiz_ids'").get() as
      | { value: string }
      | undefined;
    if (idsRow?.value) {
      const parsed = JSON.parse(idsRow.value);
      if (Array.isArray(parsed)) {
        activeQuizIds = parsed
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim());
      }
    }
  } catch {}
  return { quiz_enabled: quizEnabled, active_quiz_ids: activeQuizIds };
}

function getTrackRevealInfo(trackId: string) {
  return db.prepare(`
    SELECT t.id, t.title, COALESCE(a.title, s.title, 'Single') as album_title,
           COALESCE(a.cover_url, s.cover_url, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg') as cover_url
    FROM (
      SELECT id, title, album_id, single_id FROM tracks
      UNION ALL
      SELECT id, title, NULL as album_id, id as single_id FROM singles
    ) t
    LEFT JOIN albums a ON a.id = t.album_id
    LEFT JOIN singles s ON s.id = t.single_id
    WHERE t.id = ?
    LIMIT 1
  `).get(trackId) as any;
}

interface ResolvedDailyTrackChallenge {
  id: string;
  challenge_date: string;
  track: PlayableTrackCandidate;
  snippet_start_seconds: number;
  snippet_start_ratio: number;
  snippet_duration_seconds: number;
  options: TitleOption[];
}

function getOrCreateDailyTrackChallenge(utcDate: string): ResolvedDailyTrackChallenge | null {
  const { playablePool, allTitles } = getPlayableGameTrackPool();
  if (playablePool.length === 0) return null;

  const playableById = new Map(playablePool.map((t) => [t.id, t]));
  const existing = db.prepare(`
    SELECT * FROM daily_track_challenges WHERE challenge_date = ?
  `).get(utcDate) as any;

  if (existing && playableById.has(existing.track_id)) {
    const track = playableById.get(existing.track_id)!;
    let options: TitleOption[] = [];
    try {
      const parsed = JSON.parse(existing.options_json || '[]');
      if (Array.isArray(parsed)) {
        options = parsed.filter((o: any) => o && typeof o.id === 'string' && typeof o.title === 'string');
      }
    } catch {}
    if (options.some((o) => o.id === track.id)) {
      const storedDuration = Math.min(
        DAILY_SNIPPET_DURATION_SECONDS,
        Math.max(1, Number(existing.snippet_duration_seconds) || DAILY_SNIPPET_DURATION_SECONDS)
      );
      const maxStart = track.duration_seconds > storedDuration ? track.duration_seconds - storedDuration : 0;
      const clampedStart = Math.max(0, Math.min(maxStart > 0 ? maxStart : Number(existing.snippet_start_seconds) || 0, Number(existing.snippet_start_seconds) || 0));
      return {
        id: existing.id,
        challenge_date: utcDate,
        track,
        snippet_start_seconds: clampedStart,
        snippet_start_ratio: Number(existing.snippet_start_ratio) || 0,
        snippet_duration_seconds: storedDuration,
        options,
      };
    }
  }

  const recentRows = db.prepare(`
    SELECT track_id FROM daily_track_challenges
    WHERE challenge_date < ?
    ORDER BY challenge_date DESC
    LIMIT 7
  `).all(utcDate) as Array<{ track_id: string }>;
  const recentTrackIds = recentRows.map((r) => r.track_id);

  const generated = pickDailyTrackChallenge({
    utcDate,
    playableTracks: playablePool,
    allTitleCandidates: allTitles,
    recentTrackIds,
    secret: getDailyChallengeSecret(),
  });
  if (!generated) return null;

  const rowId = existing?.id || `dtc_${utcDate.replace(/-/g, '')}`;
  if (existing) {
    // Previously stored track was deleted or disabled by admin — repair today's entry safely
    db.prepare(`
      UPDATE daily_track_challenges
      SET track_id = ?, track_source = ?, snippet_start_seconds = ?, snippet_start_ratio = ?,
          snippet_duration_seconds = ?, options_json = ?
      WHERE challenge_date = ?
    `).run(
      generated.track.id,
      generated.track.source,
      generated.snippet_start_seconds,
      generated.snippet_start_ratio,
      generated.snippet_duration_seconds,
      JSON.stringify(generated.options),
      utcDate
    );
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO daily_track_challenges
        (id, challenge_date, track_id, track_source, snippet_start_seconds, snippet_start_ratio, snippet_duration_seconds, options_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rowId,
      utcDate,
      generated.track.id,
      generated.track.source,
      generated.snippet_start_seconds,
      generated.snippet_start_ratio,
      generated.snippet_duration_seconds,
      JSON.stringify(generated.options)
    );
  }

  // Re-read to guarantee atomicity under concurrent requests
  const persisted = db.prepare(`SELECT * FROM daily_track_challenges WHERE challenge_date = ?`).get(utcDate) as any;
  if (persisted && playableById.has(persisted.track_id)) {
    const persistedTrack = playableById.get(persisted.track_id)!;
    let persistedOptions: TitleOption[] = generated.options;
    try {
      const parsed = JSON.parse(persisted.options_json || '[]');
      if (Array.isArray(parsed) && parsed.some((o: any) => o.id === persistedTrack.id)) {
        persistedOptions = parsed;
      }
    } catch {}
    return {
      id: persisted.id,
      challenge_date: utcDate,
      track: persistedTrack,
      snippet_start_seconds: Number(persisted.snippet_start_seconds) || 0,
      snippet_start_ratio: Number(persisted.snippet_start_ratio) || 0,
      snippet_duration_seconds: Math.min(
        DAILY_SNIPPET_DURATION_SECONDS,
        Math.max(1, Number(persisted.snippet_duration_seconds) || DAILY_SNIPPET_DURATION_SECONDS)
      ),
      options: persistedOptions,
    };
  }

  return {
    id: rowId,
    challenge_date: utcDate,
    track: generated.track,
    snippet_start_seconds: generated.snippet_start_seconds,
    snippet_start_ratio: generated.snippet_start_ratio,
    snippet_duration_seconds: generated.snippet_duration_seconds,
    options: generated.options,
  };
}

function getCombinedQuizPool(): {
  allRaw: RawQuizQuestion[];
  validById: Map<string, ValidatedQuizQuestion>;
  customCount: number;
  generatedCount: number;
} {
  const customRaw = db.prepare(`
    SELECT id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty, is_active
    FROM quiz_questions
    WHERE is_active = 1
  `).all() as RawQuizQuestion[];

  const albums = db.prepare(`
    SELECT id, title, release_year, release_date, format_type, track_count
    FROM albums
  `).all() as DiscographyAlbum[];

  const tracks = db.prepare(`
    SELECT id, album_id, single_id, title, track_number, duration_seconds, lyrics
    FROM tracks
  `).all() as DiscographyTrack[];

  const singles = db.prepare(`
    SELECT id, title, release_year, release_date, duration_seconds, lyrics
    FROM singles
  `).all() as DiscographySingle[];

  const generatedRaw = generateDiscographyQuizQuestions({
    albums,
    tracks,
    singles,
    secret: getDailyChallengeSecret(),
  });

  const validById = new Map<string, ValidatedQuizQuestion>();
  const allRaw: RawQuizQuestion[] = [];
  let customCount = 0;
  let generatedCount = 0;

  for (const raw of customRaw) {
    const valid = parseAndValidateQuizQuestion(raw);
    if (valid && !validById.has(valid.id)) {
      validById.set(valid.id, valid);
      allRaw.push(raw);
      customCount++;
    }
  }
  for (const raw of generatedRaw) {
    const valid = parseAndValidateQuizQuestion(raw);
    if (valid && !validById.has(valid.id)) {
      validById.set(valid.id, valid);
      allRaw.push(raw);
      generatedCount++;
    }
  }

  return { allRaw, validById, customCount, generatedCount };
}

function getOrCreateDailyQuizChallenge(cycleId: string): ValidatedQuizQuestion[] {
  const { allRaw, validById } = getCombinedQuizPool();
  if (validById.size === 0) return [];

  // Manual selection mode: if admin pinned explicit active_quiz_ids, serve those exact valid questions
  const { active_quiz_ids } = getQuizSettingsFromDb();
  if (active_quiz_ids.length > 0) {
    const manualSet: ValidatedQuizQuestion[] = [];
    const seenManual = new Set<string>();
    for (const qid of active_quiz_ids) {
      if (!seenManual.has(qid) && validById.has(qid)) {
        seenManual.add(qid);
        manualSet.push(validById.get(qid)!);
      }
    }
    if (manualSet.length > 0) {
      return manualSet;
    }
  }

  const targetCount = Math.min(DEFAULT_DAILY_QUIZ_COUNT, validById.size);
  const existing = db.prepare(`
    SELECT id, questions_json FROM daily_challenges WHERE challenge_date = ?
  `).get(cycleId) as { id: string; questions_json: string } | undefined;

  if (existing) {
    try {
      const storedIds = JSON.parse(existing.questions_json);
      if (Array.isArray(storedIds)) {
        const seen = new Set<string>();
        const resolved: ValidatedQuizQuestion[] = [];
        for (const qid of storedIds) {
          if (typeof qid === 'string' && !seen.has(qid) && validById.has(qid)) {
            seen.add(qid);
            resolved.push(validById.get(qid)!);
          }
        }
        if (resolved.length === targetCount && resolved.length === storedIds.length) {
          return resolved;
        }
      }
    } catch {}
  }

  // Avoid repeating questions used in recent 12h MSK cycles when enough questions exist
  const recentRows = db.prepare(`
    SELECT questions_json FROM daily_challenges
    WHERE challenge_date < ?
    ORDER BY challenge_date DESC
    LIMIT 7
  `).all(cycleId) as Array<{ questions_json: string }>;

  const recentQuestionIds: string[] = [];
  for (const row of recentRows) {
    try {
      const parsed = JSON.parse(row.questions_json);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === 'string') recentQuestionIds.push(id);
        }
      }
    } catch {}
  }

  const selected = pickDailyQuizSet({
    utcDate: cycleId,
    rawQuestions: allRaw,
    recentQuestionIds,
    limit: DEFAULT_DAILY_QUIZ_COUNT,
    secret: getDailyChallengeSecret(),
  });
  if (selected.length === 0) return [];

  const selectedIds = selected.map((q) => q.id);
  const rowId = existing?.id || `dq_${cycleId.replace(/[^a-zA-Z0-9]/g, '')}`;
  if (existing) {
    db.prepare(`UPDATE daily_challenges SET questions_json = ? WHERE challenge_date = ?`).run(
      JSON.stringify(selectedIds),
      cycleId
    );
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO daily_challenges (id, challenge_date, questions_json)
      VALUES (?, ?, ?)
    `).run(rowId, cycleId, JSON.stringify(selectedIds));
  }

  const persisted = db.prepare(`SELECT questions_json FROM daily_challenges WHERE challenge_date = ?`).get(cycleId) as
    | { questions_json: string }
    | undefined;
  if (persisted) {
    try {
      const ids = JSON.parse(persisted.questions_json);
      if (Array.isArray(ids)) {
        const resolved = ids
          .filter((qid): qid is string => typeof qid === 'string' && validById.has(qid))
          .map((qid) => validById.get(qid)!);
        if (resolved.length > 0) return resolved;
      }
    } catch {}
  }

  return selected;
}

// 1. Guess The Track (shared 12-hour MSK challenge: 00:00 & 12:00 МСК, exact 5-second snippet)
app.get('/api/games/guess-track/round', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const { cycleId: slotKey, nextResetAt } = getMoscow12hCycle();

  const daily = getOrCreateDailyTrackChallenge(slotKey);
  if (!daily) {
    res.status(404).json({ error: 'В архиве пока нет доступных аудиофайлов для испытания.' });
    return;
  }

  let alreadyCompleted = false;
  let previousAttempt: {
    correct: boolean;
    selected_track_id: string;
    correct_track_id: string;
    score: number;
    xp_earned: number;
    track: any;
  } | null = null;

  if (user) {
    const completion = db.prepare(`
      SELECT * FROM game_completions WHERE user_id = ? AND game_type = 'guess-track' AND cycle_id = ?
    `).get(user.id, slotKey) as any;
    const attempt = db.prepare(`
      SELECT * FROM daily_track_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, slotKey) as any;

    if (completion || attempt) {
      alreadyCompleted = true;
      const trackId = attempt?.track_id || daily.track.id;
      previousAttempt = {
        correct: Boolean(attempt ? attempt.is_correct : completion?.is_correct),
        selected_track_id: attempt?.selected_track_id || '',
        correct_track_id: trackId,
        score: Number(attempt?.score ?? completion?.score) || 0,
        xp_earned: Number(attempt?.xp_earned ?? completion?.xp_earned) || 0,
        track: getTrackRevealInfo(trackId) || { id: daily.track.id, title: daily.track.title },
      };
    }
  }

  res.json({
    challenge_date: slotKey,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    round_token: `daily:${slotKey}`,
    audio_url: daily.track.audio_url,
    snippet_start: daily.snippet_start_seconds,
    snippet_start_ratio: daily.snippet_start_ratio,
    snippet_duration: daily.snippet_duration_seconds,
    options: daily.options,
    completed: alreadyCompleted,
    already_completed: alreadyCompleted,
    previous_attempt: previousAttempt,
  });
});

app.post('/api/games/guess-track/verify', (req: AuthRequest, res: Response) => {
  const { round_token, challenge_date, selected_track_id, time_spent } = req.body || {};
  if (!selected_track_id || typeof selected_track_id !== 'string') {
    res.status(400).json({ error: 'Missing selected_track_id' });
    return;
  }

  const user = getSessionUser(req);
  const { cycleId: slotKey, nextResetAt } = getMoscow12hCycle();

  let clientSlot: string | null = null;
  if (isValidMoscow12hCycle(challenge_date)) {
    clientSlot = challenge_date;
  } else if (typeof round_token === 'string' && round_token.startsWith('daily:')) {
    const extracted = round_token.slice('daily:'.length);
    if (isValidMoscow12hCycle(extracted)) {
      clientSlot = extracted;
    }
  }

  if (clientSlot && clientSlot !== slotKey) {
    res.status(409).json({
      error: 'Начался новый 12-часовой раунд (МСК) — доступен свежий трек!',
      code: 'DAILY_ROLLOVER',
      challenge_date: slotKey,
      next_reset_at: nextResetAt,
    });
    return;
  }

  const daily = getOrCreateDailyTrackChallenge(slotKey);
  if (!daily) {
    res.status(404).json({ error: 'Испытание «Угадай трек» временно недоступно.' });
    return;
  }

  if (!daily.options.some((o) => o.id === selected_track_id)) {
    res.status(400).json({ error: 'Selected option is not valid for the current round.' });
    return;
  }

  if (user) {
    const existingCompletion = db.prepare(`
      SELECT id FROM game_completions WHERE user_id = ? AND game_type = 'guess-track' AND cycle_id = ?
    `).get(user.id, slotKey);
    const existingAttempt = db.prepare(`
      SELECT id FROM daily_track_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, slotKey);
    if (existingCompletion || existingAttempt) {
      res.status(409).json({
        error: 'Вы уже прошли текущий раунд «Угадай трек». Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  const correctTrackId = daily.track.id;
  const isCorrect = correctTrackId === selected_track_id;
  const safeTimeSpent = Math.max(1, Math.min(180, Math.round(Number(time_spent) || 10)));
  const score = isCorrect ? 100 : 0;
  const todayMoscowDate = getMoscowDateString();
  const baseXp = isCorrect ? 15 : 5;

  let xpEarned = baseXp;
  let streakBonusXp = 0;
  let streakBonusPercent = 0;
  let nextStreak = 0;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];

  if (user) {
    const prev = db
      .prepare('SELECT total_xp, daily_streak, last_active_date FROM profiles WHERE user_id = ?')
      .get(user.id) as any;
    nextStreak = computeDailyStreak(prev?.last_active_date, todayMoscowDate, prev?.daily_streak || 0);
    const boosted = applyStreakBonusXp(baseXp, nextStreak);
    xpEarned = boosted.totalXp;
    streakBonusXp = boosted.bonusXp;
    streakBonusPercent = boosted.bonusPercent;
  }

  const trackInfo = getTrackRevealInfo(correctTrackId) || {
    id: daily.track.id,
    title: daily.track.title,
    album_title: daily.track.album_title || 'Single',
    cover_url: daily.track.cover_url,
  };

  if (user) {
    let duplicateCompletion = false;
    try {
      db.transaction(() => {
        const gcInsert = db.prepare(`
          INSERT OR IGNORE INTO game_completions (id, user_id, game_type, cycle_id, is_correct, score, xp_earned)
          VALUES (?, ?, 'guess-track', ?, ?, ?, ?)
        `).run('gc_' + crypto.randomUUID().slice(0, 8), user.id, slotKey, isCorrect ? 1 : 0, score, xpEarned);

        if (gcInsert.changes !== 1) {
          duplicateCompletion = true;
          return;
        }

        // Ensure current 12-hour track challenge row is persisted in the DB snapshot synced to Supabase
        db.prepare(`
          INSERT OR IGNORE INTO daily_track_challenges
            (id, challenge_date, track_id, track_source, snippet_start_seconds, snippet_start_ratio, snippet_duration_seconds, options_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          daily.id,
          slotKey,
          daily.track.id,
          daily.track.source,
          daily.snippet_start_seconds,
          daily.snippet_start_ratio,
          daily.snippet_duration_seconds,
          JSON.stringify(daily.options)
        );

        db.prepare(`
          INSERT INTO daily_track_attempts
            (id, user_id, challenge_date, track_id, selected_track_id, is_correct, score, xp_earned, time_spent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'dta_' + crypto.randomUUID().slice(0, 8),
          user.id,
          slotKey,
          correctTrackId,
          selected_track_id,
          isCorrect ? 1 : 0,
          score,
          xpEarned,
          safeTimeSpent
        );

        db.prepare(`
          INSERT INTO game_attempts (id, user_id, game_id, score, xp_earned, details_json)
          VALUES (?, ?, 'guess-track', ?, ?, ?)
        `).run(
          'att_' + crypto.randomUUID().slice(0, 8),
          user.id,
          score,
          xpEarned,
          JSON.stringify({ isCorrect, correctTrackId, challengeDate: slotKey, streakBonusPercent })
        );

        const txDetails = isCorrect
          ? (streakBonusPercent > 0 ? `Верный ответ (серия +${streakBonusPercent}%)` : 'Верный ответ')
          : (streakBonusPercent > 0 ? `Участие в раунде (серия +${streakBonusPercent}%)` : 'Участие в раунде');

        awardXpWithRef({
          userId: user.id,
          amount: xpEarned,
          source: 'guess_track',
          details: txDetails,
          referenceKey: `game:guess-track:${slotKey}:${user.id}`,
        });

        db.prepare(`
          UPDATE profiles SET
            daily_streak = ?,
            last_active_date = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `).run(nextStreak, todayMoscowDate, user.id);

        newlyUnlockedAchievements = evaluateUserAchievements(user.id);
      })();
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        duplicateCompletion = true;
      } else {
        throw err;
      }
    }

    if (duplicateCompletion) {
      res.status(409).json({
        error: 'Вы уже прошли текущий раунд «Угадай трек». Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  res.json({
    correct: isCorrect,
    correct_track_id: correctTrackId,
    selected_track_id,
    score,
    base_xp: baseXp,
    streak_bonus_xp: streakBonusXp,
    streak_bonus_percent: streakBonusPercent,
    daily_streak: nextStreak,
    xp_earned: xpEarned,
    track: trackInfo,
    challenge_date: slotKey,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    newly_unlocked_achievements: newlyUnlockedAchievements,
  });
});

// 2. Daily Quiz (12-hour MSK schedule: 00:00 & 12:00 МСК, quiz_enabled toggle, active_quiz_ids manual mode, difficulty XP + Fisher-Yates options)
app.get('/api/games/quiz/daily', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();
  const quizSecret = getDailyChallengeSecret();
  const { quiz_enabled } = getQuizSettingsFromDb();

  if (!quiz_enabled) {
    res.json({
      disabled: true,
      message: 'Зайдите позже, добавляются новые вопросы',
      questions: [],
      completed: false,
      already_completed: false,
      previous_score: 0,
      previous_xp: 0,
      challenge_date: cycleId,
      next_reset_at: nextResetAt,
      refresh_interval_hours: 12,
      timezone: 'MSK',
    });
    return;
  }

  let alreadyCompleted = false;
  let previousScore = 0;
  let previousXp = 0;

  if (user) {
    const completion = db.prepare(`
      SELECT * FROM game_completions WHERE user_id = ? AND game_type = 'daily-quiz' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    const attempt = db.prepare(`
      SELECT * FROM quiz_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, cycleId) as any;
    if (completion || attempt) {
      alreadyCompleted = true;
      previousScore = Number(attempt?.score ?? completion?.score) || 0;
      previousXp = Number(attempt?.xp_earned ?? completion?.xp_earned) || 0;
    }
  }

  const questions = getOrCreateDailyQuizChallenge(cycleId).map((q) =>
    shuffleQuizQuestionOptions(q, cycleId, quizSecret)
  );
  const sanitized = questions.map((q) => ({
    id: q.id,
    question_ru: q.question_ru,
    question_en: q.question_en,
    options: q.options,
    difficulty: q.difficulty,
  }));

  res.json({
    disabled: false,
    questions: sanitized,
    completed: alreadyCompleted,
    already_completed: alreadyCompleted,
    previous_score: previousScore,
    previous_xp: previousXp,
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
  });
});

app.post('/api/games/quiz/submit', (req: AuthRequest, res: Response) => {
  const { answers, challenge_date } = req.body || {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    res.status(400).json({ error: 'Answers must be provided.' });
    return;
  }

  const { quiz_enabled } = getQuizSettingsFromDb();
  if (!quiz_enabled) {
    res.status(403).json({
      disabled: true,
      error: 'Зайдите позже, добавляются новые вопросы',
    });
    return;
  }

  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();
  const quizSecret = getDailyChallengeSecret();

  if (isValidMoscow12hCycle(challenge_date) && challenge_date !== cycleId) {
    res.status(409).json({
      error: 'Начался новый 12-часовой цикл (МСК) — доступна новая викторина!',
      code: 'DAILY_ROLLOVER',
      challenge_date: cycleId,
      next_reset_at: nextResetAt,
    });
    return;
  }

  if (user) {
    const existingCompletion = db.prepare(`
      SELECT id FROM game_completions WHERE user_id = ? AND game_type = 'daily-quiz' AND cycle_id = ?
    `).get(user.id, cycleId);
    const existingAttempt = db.prepare(`
      SELECT id FROM quiz_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, cycleId);

    if (existingCompletion || existingAttempt) {
      res.status(409).json({
        error: 'Вы уже прошли викторину в этом раунде. Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  const dailyQuestions = getOrCreateDailyQuizChallenge(cycleId).map((q) =>
    shuffleQuizQuestionOptions(q, cycleId, quizSecret)
  );
  if (dailyQuestions.length === 0) {
    res.status(404).json({ error: 'Вопросы для викторины не найдены.' });
    return;
  }

  let correctCount = 0;
  const matchedQuestions = dailyQuestions.filter((q) => answers[q.id] !== undefined);
  if (matchedQuestions.length === 0) {
    res.status(400).json({ error: 'Не переданы ответы на текущие вопросы викторины.' });
    return;
  }

  const total = dailyQuestions.length;
  const results = dailyQuestions.map((q) => {
    const rawSelected = answers[q.id];
    const selectedIndex = Number.isInteger(Number(rawSelected)) ? Number(rawSelected) : -1;
    const isCorrect = selectedIndex === q.correct_index;
    if (isCorrect) correctCount++;
    return {
      id: q.id,
      is_correct: isCorrect,
      correct_index: q.correct_index,
      explanation_ru: q.explanation_ru,
      explanation_en: q.explanation_en,
      difficulty: q.difficulty,
    };
  });

  // Difficulty-based Quiz XP: easy (1) = 10 XP, medium (2) = 15 XP, hard (3) = 25 XP
  const { baseScore, speedBonus, totalXp: rawBaseXp } = calculateQuizScoreByDifficulty(
    dailyQuestions.map((q, idx) => ({
      isCorrect: results[idx].is_correct,
      difficulty: q.difficulty,
    }))
  );

  const todayMoscowDate = getMoscowDateString();
  let totalXp = rawBaseXp;
  let streakBonusXp = 0;
  let streakBonusPercent = 0;
  let nextStreak = 0;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];

  if (user) {
    const prev = db
      .prepare('SELECT total_xp, daily_streak, last_active_date FROM profiles WHERE user_id = ?')
      .get(user.id) as any;
    nextStreak = computeDailyStreak(prev?.last_active_date, todayMoscowDate, prev?.daily_streak || 0);
    const boosted = applyStreakBonusXp(rawBaseXp, nextStreak);
    totalXp = boosted.totalXp;
    streakBonusXp = boosted.bonusXp;
    streakBonusPercent = boosted.bonusPercent;

    let duplicateCompletion = false;
    try {
      db.transaction(() => {
        const gcInsert = db.prepare(`
          INSERT OR IGNORE INTO game_completions (id, user_id, game_type, cycle_id, is_correct, score, xp_earned)
          VALUES (?, ?, 'daily-quiz', ?, ?, ?, ?)
        `).run(
          'gc_' + crypto.randomUUID().slice(0, 8),
          user.id,
          cycleId,
          correctCount > 0 ? 1 : 0,
          baseScore,
          totalXp
        );
        if (gcInsert.changes !== 1) {
          duplicateCompletion = true;
          return;
        }

        db.prepare(`
          INSERT OR IGNORE INTO daily_challenges (id, challenge_date, questions_json)
          VALUES (?, ?, ?)
        `).run(
          `dq_${cycleId.replace(/[^a-zA-Z0-9]/g, '')}`,
          cycleId,
          JSON.stringify(dailyQuestions.map((q) => q.id))
        );

        db.prepare(`
          INSERT INTO quiz_attempts (id, user_id, challenge_date, score, xp_earned)
          VALUES (?, ?, ?, ?, ?)
        `).run('qa_' + crypto.randomUUID().slice(0, 8), user.id, cycleId, baseScore, totalXp);

        db.prepare(`
          INSERT INTO game_attempts (id, user_id, game_id, score, xp_earned, details_json)
          VALUES (?, ?, 'daily-quiz', ?, ?, ?)
        `).run(
          'att_' + crypto.randomUUID().slice(0, 8),
          user.id,
          baseScore,
          totalXp,
          JSON.stringify({ correctCount, total, challengeDate: cycleId, streakBonusPercent })
        );

        const txDetails =
          streakBonusPercent > 0
            ? `Результат ${correctCount}/${total} (серия +${streakBonusPercent}%)`
            : `Результат ${correctCount}/${total}`;

        awardXpWithRef({
          userId: user.id,
          amount: totalXp,
          source: 'daily_quiz',
          details: txDetails,
          referenceKey: `game:daily-quiz:${cycleId}:${user.id}`,
        });

        db.prepare(`
          UPDATE profiles SET
            daily_streak = ?,
            last_active_date = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `).run(nextStreak, todayMoscowDate, user.id);

        newlyUnlockedAchievements = evaluateUserAchievements(user.id);
      })();
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        duplicateCompletion = true;
      } else {
        throw err;
      }
    }

    if (duplicateCompletion) {
      res.status(409).json({
        error: 'Вы уже прошли викторину в этом раунде. Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  res.json({
    total,
    correct_count: correctCount,
    base_score: baseScore,
    base_xp: rawBaseXp,
    speed_bonus: speedBonus,
    streak_bonus_xp: streakBonusXp,
    streak_bonus_percent: streakBonusPercent,
    daily_streak: nextStreak,
    total_xp: totalXp,
    results,
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    newly_unlocked_achievements: newlyUnlockedAchievements,
  });
});

// Shared helper to record Stage 5/6 mini-game attempts (guess-lyrics, reverse-track, speed-track) with atomic game_completions lock
function recordMiniGameAttempt(params: {
  userId: string;
  gameId: 'guess-lyrics' | 'reverse-track' | 'speed-track';
  xpSource: 'guess_lyrics' | 'reverse_track' | 'speed_track';
  cycleId: string;
  isCorrect: boolean;
  baseXp: number;
  selectedValue: string;
  correctValue: string;
  details: Record<string, unknown>;
}): {
  duplicate?: boolean;
  xpEarned: number;
  streakBonusXp: number;
  streakBonusPercent: number;
  nextStreak: number;
  newlyUnlockedAchievements: UnlockedAchievementInfo[];
} {
  const { userId, gameId, xpSource, cycleId, isCorrect, baseXp, selectedValue, correctValue, details } = params;
  const todayMoscowDate = getMoscowDateString();
  const prev = db
    .prepare('SELECT total_xp, daily_streak, last_active_date FROM profiles WHERE user_id = ?')
    .get(userId) as any;
  const nextStreak = computeDailyStreak(prev?.last_active_date, todayMoscowDate, prev?.daily_streak || 0);
  const boosted = applyStreakBonusXp(baseXp, nextStreak);
  const xpEarned = boosted.totalXp;
  const score = isCorrect ? 100 : 0;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];
  let duplicate = false;

  db.transaction(() => {
    const gcInsert = db.prepare(`
      INSERT OR IGNORE INTO game_completions (id, user_id, game_type, cycle_id, is_correct, score, xp_earned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('gc_' + crypto.randomUUID().slice(0, 8), userId, gameId, cycleId, isCorrect ? 1 : 0, score, xpEarned);

    if (gcInsert.changes !== 1) {
      duplicate = true;
      return;
    }

    db.prepare(`
      INSERT INTO daily_mini_game_attempts
        (id, user_id, game_id, cycle_id, is_correct, score, xp_earned, selected_value, correct_value, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'dmg_' + crypto.randomUUID().slice(0, 8),
      userId,
      gameId,
      cycleId,
      isCorrect ? 1 : 0,
      score,
      xpEarned,
      selectedValue,
      correctValue,
      JSON.stringify(details)
    );

    db.prepare(`
      INSERT INTO game_attempts (id, user_id, game_id, score, xp_earned, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'att_' + crypto.randomUUID().slice(0, 8),
      userId,
      gameId,
      score,
      xpEarned,
      JSON.stringify({ ...details, challengeDate: cycleId, streakBonusPercent: boosted.bonusPercent })
    );

    const txDetails = isCorrect
      ? (boosted.bonusPercent > 0 ? `Верный ответ (серия +${boosted.bonusPercent}%)` : 'Верный ответ')
      : (boosted.bonusPercent > 0 ? `Участие в раунде (серия +${boosted.bonusPercent}%)` : 'Участие в раунде');

    awardXpWithRef({
      userId,
      amount: xpEarned,
      source: xpSource,
      details: txDetails,
      referenceKey: `game:${gameId}:${cycleId}:${userId}`,
    });

    db.prepare(`
      UPDATE profiles SET
        daily_streak = ?,
        last_active_date = ?,
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(nextStreak, todayMoscowDate, userId);

    newlyUnlockedAchievements = evaluateUserAchievements(userId);
  })();

  if (duplicate) {
    return {
      duplicate: true,
      xpEarned: 0,
      streakBonusXp: 0,
      streakBonusPercent: 0,
      nextStreak,
      newlyUnlockedAchievements: [],
    };
  }

  return {
    xpEarned,
    streakBonusXp: boosted.bonusXp,
    streakBonusPercent: boosted.bonusPercent,
    nextStreak,
    newlyUnlockedAchievements,
  };
}

// 3. Guess The Lyric (12-hour MSK cycle, real DB lyrics pairs + Fisher-Yates 4 options)
function resolveLyricsChallengeForCycle(cycleId: string) {
  const lyricTracks = getLyricGameTrackPool();
  if (lyricTracks.length === 0) return null;
  const secret = getDailyChallengeSecret();
  const prevCycleId = getPreviousMoscow12hCycle(cycleId);
  const prevSelection = pickDailyLyricsChallenge({
    cycleId: prevCycleId,
    lyricTracks,
    recentTrackIds: [],
    secret,
  });
  return pickDailyLyricsChallenge({
    cycleId,
    lyricTracks,
    recentTrackIds: prevSelection ? [prevSelection.track.id] : [],
    secret,
  });
}

app.get('/api/games/guess-lyrics/round', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();
  const round = resolveLyricsChallengeForCycle(cycleId);

  if (!round) {
    res.status(404).json({ error: 'В архиве пока недостаточно текстов песен для этой игры.' });
    return;
  }

  let alreadyCompleted = false;
  let previousAttempt: any = null;
  if (user) {
    const completion = db.prepare(`
      SELECT * FROM game_completions WHERE user_id = ? AND game_type = 'guess-lyrics' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    const row = db.prepare(`
      SELECT * FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = 'guess-lyrics' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    if (completion || row) {
      alreadyCompleted = true;
      let parsedDetails: any = {};
      try {
        parsedDetails = JSON.parse(row?.details_json || '{}');
      } catch {}
      previousAttempt = {
        correct: Boolean(row ? row.is_correct : completion?.is_correct),
        selected_option_id: row?.selected_value || '',
        correct_option_id: row?.correct_value || round.correct_option_id,
        correct_line: parsedDetails.correctLine || round.correct_line,
        score: Number(row?.score ?? completion?.score) || 0,
        xp_earned: Number(row?.xp_earned ?? completion?.xp_earned) || 0,
        track: parsedDetails.track || {
          id: round.track.id,
          title: round.track.title,
          album_title: round.track.album_title || 'Archive Release',
          cover_url: round.track.cover_url,
        },
      };
    }
  }

  res.json({
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    round_token: `lyrics:${cycleId}`,
    prompt_line: round.prompt_line,
    options: round.options,
    completed: alreadyCompleted,
    already_completed: alreadyCompleted,
    previous_attempt: previousAttempt,
  });
});

app.post('/api/games/guess-lyrics/verify', (req: AuthRequest, res: Response) => {
  const { challenge_date, selected_option_id } = req.body || {};
  if (!selected_option_id || typeof selected_option_id !== 'string') {
    res.status(400).json({ error: 'Не выбран вариант ответа.' });
    return;
  }

  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();

  if (isValidMoscow12hCycle(challenge_date) && challenge_date !== cycleId) {
    res.status(409).json({
      error: 'Начался новый 12-часовой раунд (МСК) — доступна новая строчка!',
      code: 'DAILY_ROLLOVER',
      challenge_date: cycleId,
      next_reset_at: nextResetAt,
    });
    return;
  }

  const round = resolveLyricsChallengeForCycle(cycleId);
  if (!round) {
    res.status(404).json({ error: 'Игра «Угадай строчку» временно недоступна.' });
    return;
  }

  if (!round.options.some((o) => o.id === selected_option_id)) {
    res.status(400).json({ error: 'Выбранный вариант не относится к текущему раунду.' });
    return;
  }

  if (user) {
    const existingGc = db.prepare(`
      SELECT id FROM game_completions WHERE user_id = ? AND game_type = 'guess-lyrics' AND cycle_id = ?
    `).get(user.id, cycleId);
    const existing = db.prepare(`
      SELECT id FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = 'guess-lyrics' AND cycle_id = ?
    `).get(user.id, cycleId);
    if (existingGc || existing) {
      res.status(409).json({
        error: 'Вы уже прошли текущий раунд «Угадай строчку». Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  const isCorrect = selected_option_id === round.correct_option_id;
  const baseXp = isCorrect ? 15 : 5;
  const trackInfo = {
    id: round.track.id,
    title: round.track.title,
    album_title: round.track.album_title || 'Archive Release',
    cover_url: round.track.cover_url,
  };

  let xpEarned = baseXp;
  let streakBonusXp = 0;
  let streakBonusPercent = 0;
  let nextStreak = 0;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];

  if (user) {
    try {
      const saved = recordMiniGameAttempt({
        userId: user.id,
        gameId: 'guess-lyrics',
        xpSource: 'guess_lyrics',
        cycleId,
        isCorrect,
        baseXp,
        selectedValue: selected_option_id,
        correctValue: round.correct_option_id,
        details: {
          isCorrect,
          promptLine: round.prompt_line,
          correctLine: round.correct_line,
          track: trackInfo,
        },
      });
      if (saved.duplicate) {
        res.status(409).json({
          error: 'Вы уже прошли текущий раунд «Угадай строчку». Обновление в 00:00 и 12:00 МСК!',
          completed: true,
          already_completed: true,
          xp_earned: 0,
          next_reset_at: nextResetAt,
        });
        return;
      }
      xpEarned = saved.xpEarned;
      streakBonusXp = saved.streakBonusXp;
      streakBonusPercent = saved.streakBonusPercent;
      nextStreak = saved.nextStreak;
      newlyUnlockedAchievements = saved.newlyUnlockedAchievements;
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(409).json({
          error: 'Вы уже прошли этот раунд.',
          completed: true,
          already_completed: true,
          xp_earned: 0,
          next_reset_at: nextResetAt,
        });
        return;
      }
      throw err;
    }
  }

  res.json({
    correct: isCorrect,
    selected_option_id,
    correct_option_id: round.correct_option_id,
    correct_line: round.correct_line,
    score: isCorrect ? 100 : 0,
    base_xp: baseXp,
    streak_bonus_xp: streakBonusXp,
    streak_bonus_percent: streakBonusPercent,
    daily_streak: nextStreak,
    xp_earned: xpEarned,
    track: trackInfo,
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    newly_unlocked_achievements: newlyUnlockedAchievements,
  });
});

// 4. Reverse Track (12-hour MSK cycle, 5-second reversed audio via Web Audio API)
function resolveReverseTrackForCycle(cycleId: string) {
  const { playablePool, allTitles } = getPlayableGameTrackPool();
  if (playablePool.length === 0) return null;
  const secret = getDailyChallengeSecret();
  const prevCycleId = getPreviousMoscow12hCycle(cycleId);
  const guessTrackToday = getOrCreateDailyTrackChallenge(cycleId);
  const prevReverse = pickDailyReverseTrackChallenge({
    cycleId: prevCycleId,
    playableTracks: playablePool,
    allTitleCandidates: allTitles,
    excludeTrackIds: [],
    secret,
  });
  const excludeIds = [prevReverse?.track.id, guessTrackToday?.track.id].filter(Boolean) as string[];
  return pickDailyReverseTrackChallenge({
    cycleId,
    playableTracks: playablePool,
    allTitleCandidates: allTitles,
    excludeTrackIds: excludeIds,
    secret,
  });
}

app.get('/api/games/reverse-track/round', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();
  const round = resolveReverseTrackForCycle(cycleId);

  if (!round) {
    res.status(404).json({ error: 'В архиве пока нет доступных аудиофайлов для игры «Задом наперёд».' });
    return;
  }

  let alreadyCompleted = false;
  let previousAttempt: any = null;
  if (user) {
    const completion = db.prepare(`
      SELECT * FROM game_completions WHERE user_id = ? AND game_type = 'reverse-track' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    const row = db.prepare(`
      SELECT * FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = 'reverse-track' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    if (completion || row) {
      alreadyCompleted = true;
      const trackReveal = getTrackRevealInfo(row?.correct_value || round.track.id) || {
        id: round.track.id,
        title: round.track.title,
      };
      previousAttempt = {
        correct: Boolean(row ? row.is_correct : completion?.is_correct),
        selected_track_id: row?.selected_value || '',
        correct_track_id: row?.correct_value || round.track.id,
        score: Number(row?.score ?? completion?.score) || 0,
        xp_earned: Number(row?.xp_earned ?? completion?.xp_earned) || 0,
        track: trackReveal,
      };
    }
  }

  res.json({
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    round_token: `reverse:${cycleId}`,
    audio_url: round.track.audio_url,
    snippet_start: round.snippet_start_seconds,
    snippet_start_ratio: round.snippet_start_ratio,
    snippet_duration: round.snippet_duration_seconds,
    options: round.options,
    completed: alreadyCompleted,
    already_completed: alreadyCompleted,
    previous_attempt: previousAttempt,
  });
});

app.post('/api/games/reverse-track/verify', (req: AuthRequest, res: Response) => {
  const { challenge_date, selected_track_id } = req.body || {};
  if (!selected_track_id || typeof selected_track_id !== 'string') {
    res.status(400).json({ error: 'Missing selected_track_id' });
    return;
  }

  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();

  if (isValidMoscow12hCycle(challenge_date) && challenge_date !== cycleId) {
    res.status(409).json({
      error: 'Начался новый 12-часовой раунд (МСК) — доступен свежий трек!',
      code: 'DAILY_ROLLOVER',
      challenge_date: cycleId,
      next_reset_at: nextResetAt,
    });
    return;
  }

  const round = resolveReverseTrackForCycle(cycleId);
  if (!round) {
    res.status(404).json({ error: 'Испытание «Задом наперёд» временно недоступно.' });
    return;
  }

  if (!round.options.some((o) => o.id === selected_track_id)) {
    res.status(400).json({ error: 'Selected option is not valid for the current round.' });
    return;
  }

  if (user) {
    const existingGc = db.prepare(`
      SELECT id FROM game_completions WHERE user_id = ? AND game_type = 'reverse-track' AND cycle_id = ?
    `).get(user.id, cycleId);
    const existing = db.prepare(`
      SELECT id FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = 'reverse-track' AND cycle_id = ?
    `).get(user.id, cycleId);
    if (existingGc || existing) {
      res.status(409).json({
        error: 'Вы уже прошли текущий раунд «Задом наперёд». Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  const correctTrackId = round.track.id;
  const isCorrect = selected_track_id === correctTrackId;
  const baseXp = isCorrect ? 20 : 5;
  const trackInfo = getTrackRevealInfo(correctTrackId) || {
    id: round.track.id,
    title: round.track.title,
    album_title: round.track.album_title || 'Single',
    cover_url: round.track.cover_url,
  };

  let xpEarned = baseXp;
  let streakBonusXp = 0;
  let streakBonusPercent = 0;
  let nextStreak = 0;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];

  if (user) {
    try {
      const saved = recordMiniGameAttempt({
        userId: user.id,
        gameId: 'reverse-track',
        xpSource: 'reverse_track',
        cycleId,
        isCorrect,
        baseXp,
        selectedValue: selected_track_id,
        correctValue: correctTrackId,
        details: { isCorrect, correctTrackId },
      });
      if (saved.duplicate) {
        res.status(409).json({
          error: 'Вы уже прошли текущий раунд «Задом наперёд». Обновление в 00:00 и 12:00 МСК!',
          completed: true,
          already_completed: true,
          xp_earned: 0,
          next_reset_at: nextResetAt,
        });
        return;
      }
      xpEarned = saved.xpEarned;
      streakBonusXp = saved.streakBonusXp;
      streakBonusPercent = saved.streakBonusPercent;
      nextStreak = saved.nextStreak;
      newlyUnlockedAchievements = saved.newlyUnlockedAchievements;
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(409).json({
          error: 'Вы уже прошли этот раунд.',
          completed: true,
          already_completed: true,
          xp_earned: 0,
          next_reset_at: nextResetAt,
        });
        return;
      }
      throw err;
    }
  }

  res.json({
    correct: isCorrect,
    correct_track_id: correctTrackId,
    selected_track_id,
    score: isCorrect ? 100 : 0,
    base_xp: baseXp,
    streak_bonus_xp: streakBonusXp,
    streak_bonus_percent: streakBonusPercent,
    daily_streak: nextStreak,
    xp_earned: xpEarned,
    track: trackInfo,
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    newly_unlocked_achievements: newlyUnlockedAchievements,
  });
});

// 5. Speed Track 0.5x / 2.5x (12-hour MSK cycle, 5 seconds real listening time with pitch shift)
function resolveSpeedTrackForCycle(cycleId: string) {
  const { playablePool, allTitles } = getPlayableGameTrackPool();
  if (playablePool.length === 0) return null;
  const secret = getDailyChallengeSecret();
  const prevCycleId = getPreviousMoscow12hCycle(cycleId);
  const guessTrackToday = getOrCreateDailyTrackChallenge(cycleId);
  const reverseToday = resolveReverseTrackForCycle(cycleId);
  const prevSpeed = pickDailySpeedTrackChallenge({
    cycleId: prevCycleId,
    playableTracks: playablePool,
    allTitleCandidates: allTitles,
    excludeTrackIds: [],
    secret,
  });
  const excludeIds = [prevSpeed?.track.id, reverseToday?.track.id, guessTrackToday?.track.id].filter(
    Boolean
  ) as string[];
  return pickDailySpeedTrackChallenge({
    cycleId,
    playableTracks: playablePool,
    allTitleCandidates: allTitles,
    excludeTrackIds: excludeIds,
    secret,
  });
}

app.get('/api/games/speed-track/round', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();
  const round = resolveSpeedTrackForCycle(cycleId);

  if (!round) {
    res.status(404).json({ error: 'В архиве пока нет доступных аудиофайлов для игры «0.5x / 2.5x».' });
    return;
  }

  let alreadyCompleted = false;
  let previousAttempt: any = null;
  if (user) {
    const completion = db.prepare(`
      SELECT * FROM game_completions WHERE user_id = ? AND game_type = 'speed-track' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    const row = db.prepare(`
      SELECT * FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = 'speed-track' AND cycle_id = ?
    `).get(user.id, cycleId) as any;
    if (completion || row) {
      alreadyCompleted = true;
      const trackReveal = getTrackRevealInfo(row?.correct_value || round.track.id) || {
        id: round.track.id,
        title: round.track.title,
      };
      previousAttempt = {
        correct: Boolean(row ? row.is_correct : completion?.is_correct),
        selected_track_id: row?.selected_value || '',
        correct_track_id: row?.correct_value || round.track.id,
        score: Number(row?.score ?? completion?.score) || 0,
        xp_earned: Number(row?.xp_earned ?? completion?.xp_earned) || 0,
        speed_mode: round.speed_mode,
        track: trackReveal,
      };
    }
  }

  res.json({
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    round_token: `speed:${cycleId}`,
    audio_url: round.track.audio_url,
    speed_mode: round.speed_mode,
    snippet_start: round.snippet_start_seconds,
    snippet_start_ratio: round.snippet_start_ratio,
    snippet_duration: round.snippet_duration_seconds,
    options: round.options,
    completed: alreadyCompleted,
    already_completed: alreadyCompleted,
    previous_attempt: previousAttempt,
  });
});

app.post('/api/games/speed-track/verify', (req: AuthRequest, res: Response) => {
  const { challenge_date, selected_track_id } = req.body || {};
  if (!selected_track_id || typeof selected_track_id !== 'string') {
    res.status(400).json({ error: 'Missing selected_track_id' });
    return;
  }

  const user = getSessionUser(req);
  const { cycleId, nextResetAt } = getMoscow12hCycle();

  if (isValidMoscow12hCycle(challenge_date) && challenge_date !== cycleId) {
    res.status(409).json({
      error: 'Начался новый 12-часовой раунд (МСК) — доступен свежий трек!',
      code: 'DAILY_ROLLOVER',
      challenge_date: cycleId,
      next_reset_at: nextResetAt,
    });
    return;
  }

  const round = resolveSpeedTrackForCycle(cycleId);
  if (!round) {
    res.status(404).json({ error: 'Испытание «0.5x / 2.5x» временно недоступно.' });
    return;
  }

  if (!round.options.some((o) => o.id === selected_track_id)) {
    res.status(400).json({ error: 'Selected option is not valid for the current round.' });
    return;
  }

  if (user) {
    const existingGc = db.prepare(`
      SELECT id FROM game_completions WHERE user_id = ? AND game_type = 'speed-track' AND cycle_id = ?
    `).get(user.id, cycleId);
    const existing = db.prepare(`
      SELECT id FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = 'speed-track' AND cycle_id = ?
    `).get(user.id, cycleId);
    if (existingGc || existing) {
      res.status(409).json({
        error: 'Вы уже прошли текущий раунд «0.5x / 2.5x». Обновление в 00:00 и 12:00 МСК!',
        completed: true,
        already_completed: true,
        xp_earned: 0,
        next_reset_at: nextResetAt,
      });
      return;
    }
  }

  const correctTrackId = round.track.id;
  const isCorrect = selected_track_id === correctTrackId;
  const baseXp = isCorrect ? 20 : 5;
  const trackInfo = getTrackRevealInfo(correctTrackId) || {
    id: round.track.id,
    title: round.track.title,
    album_title: round.track.album_title || 'Single',
    cover_url: round.track.cover_url,
  };

  let xpEarned = baseXp;
  let streakBonusXp = 0;
  let streakBonusPercent = 0;
  let nextStreak = 0;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];

  if (user) {
    try {
      const saved = recordMiniGameAttempt({
        userId: user.id,
        gameId: 'speed-track',
        xpSource: 'speed_track',
        cycleId,
        isCorrect,
        baseXp,
        selectedValue: selected_track_id,
        correctValue: correctTrackId,
        details: { isCorrect, correctTrackId, speedMode: round.speed_mode },
      });
      if (saved.duplicate) {
        res.status(409).json({
          error: 'Вы уже прошли текущий раунд «0.5x / 2.5x». Обновление в 00:00 и 12:00 МСК!',
          completed: true,
          already_completed: true,
          xp_earned: 0,
          next_reset_at: nextResetAt,
        });
        return;
      }
      xpEarned = saved.xpEarned;
      streakBonusXp = saved.streakBonusXp;
      streakBonusPercent = saved.streakBonusPercent;
      nextStreak = saved.nextStreak;
      newlyUnlockedAchievements = saved.newlyUnlockedAchievements;
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(409).json({
          error: 'Вы уже прошли этот раунд.',
          completed: true,
          already_completed: true,
          xp_earned: 0,
          next_reset_at: nextResetAt,
        });
        return;
      }
      throw err;
    }
  }

  res.json({
    correct: isCorrect,
    correct_track_id: correctTrackId,
    selected_track_id,
    speed_mode: round.speed_mode,
    score: isCorrect ? 100 : 0,
    base_xp: baseXp,
    streak_bonus_xp: streakBonusXp,
    streak_bonus_percent: streakBonusPercent,
    daily_streak: nextStreak,
    xp_earned: xpEarned,
    track: trackInfo,
    challenge_date: cycleId,
    next_reset_at: nextResetAt,
    refresh_interval_hours: 12,
    timezone: 'MSK',
    newly_unlocked_achievements: newlyUnlockedAchievements,
  });
});

interface UnlockedAchievementInfo {
  id: string;
  slug: string;
  title_ru: string;
  title_en: string;
  xp_reward: number;
  rarity: string;
  difficulty_tier: string;
  icon: string;
}

// Authoritative metric collector shared by achievement unlock evaluator and profile progress bars
function collectUserAchievementMetrics(userId: string): AchievementMetrics | null {
  const row = db.prepare(`
    SELECT
      p.total_xp, p.level, p.daily_streak, p.bio, p.custom_status,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ?) as games_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'guess-track') as guess_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'guess-track' AND score > 0) as guess_wins,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz') as quiz_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz' AND details_json IS NOT NULL AND json_valid(details_json) = 1 AND CAST(json_extract(details_json, '$.total') AS INTEGER) > 0 AND CAST(json_extract(details_json, '$.correctCount') AS INTEGER) >= CAST(json_extract(details_json, '$.total') AS INTEGER)) as quiz_perfect,
      (SELECT COUNT(*) FROM user_inventory WHERE user_id = ?) as purchases_count,
      (SELECT COUNT(*) FROM user_inventory WHERE user_id = ? AND is_equipped = 1) as equipped_count,
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts_count,
      (SELECT COUNT(*) FROM comments WHERE user_id = ?) as comments_count,
      (SELECT COUNT(*) FROM creations WHERE user_id = ?) as creations_count,
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following_count,
      (SELECT COUNT(*) FROM post_reads WHERE user_id = ?) as posts_read_count,
      (SELECT COUNT(*) FROM promo_code_uses WHERE user_id = ?) as promo_redeemed_count,
      (SELECT COALESCE(MAX(completions), 0) FROM user_track_plays WHERE user_id = ?) as max_track_completions,
      (SELECT COUNT(*) FROM user_secret_flags WHERE user_id = ? AND flag_key = 'midnight_msk') as visited_midnight_msk,
      (SELECT COUNT(*) FROM user_secret_flags WHERE user_id = ? AND flag_key = 'curious_rose') as clicked_secret_rose
    FROM profiles p
    WHERE p.user_id = ?
  `).get(
    userId, userId, userId, userId, userId,
    userId, userId, userId, userId, userId,
    userId, userId, userId, userId, userId,
    userId, userId, userId
  ) as any;

  if (!row) return null;

  return {
    isRegistered: true,
    hasCustomProfile: Boolean((row.bio && String(row.bio).trim()) || (row.custom_status && String(row.custom_status).trim())),
    gamesPlayed: Number(row.games_played || 0),
    guessTrackPlayed: Number(row.guess_played || 0),
    guessTrackWins: Number(row.guess_wins || 0),
    quizPlayed: Number(row.quiz_played || 0),
    quizPerfectRuns: Number(row.quiz_perfect || 0),
    dailyStreak: Number(row.daily_streak || 0),
    totalXp: Number(row.total_xp || 0),
    level: Number(row.level || 1),
    purchasesCount: Number(row.purchases_count || 0),
    equippedItemsCount: Number(row.equipped_count || 0),
    postsCount: Number(row.posts_count || 0),
    commentsCount: Number(row.comments_count || 0),
    creationsCount: Number(row.creations_count || 0),
    followersCount: Number(row.followers_count || 0),
    followingCount: Number(row.following_count || 0),
    postsReadCount: Number(row.posts_read_count || 0),
    promoRedeemedCount: Number(row.promo_redeemed_count || 0),
    maxTrackCompletions: Number(row.max_track_completions || 0),
    visitedMidnightMsk: Number(row.visited_midnight_msk || 0) > 0,
    clickedSecretRose: Number(row.clicked_secret_rose || 0) > 0,
  };
}

// Helper for unlocking achievements safely (idempotent; awards balanced xp_reward ONCE via awardXpWithRef)
function unlockAchievement(userId: string, achievementSlug: string): UnlockedAchievementInfo | null {
  const ach = db
    .prepare('SELECT id, slug, title_ru, title_en, xp_reward, rarity, difficulty_tier, icon FROM achievements WHERE slug = ?')
    .get(achievementSlug) as UnlockedAchievementInfo | undefined;
  if (!ach) return null;

  const insertResult = db.prepare(`
    INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id)
    VALUES (?, ?, ?)
  `).run('uach_' + crypto.randomUUID().slice(0, 8), userId, ach.id);

  if (insertResult.changes !== 1) {
    return null;
  }

  const reward = Math.max(0, Number(ach.xp_reward || 0));
  if (reward > 0) {
    awardXpWithRef({
      userId,
      amount: reward,
      source: 'achievement',
      details: `Достижение «${ach.title_ru}»`,
      referenceKey: `ach:${userId}:${ach.slug}`,
    });
  }

  return ach;
}

// Authoritative server-side achievement evaluator using real database records; returns newly unlocked achievements
function evaluateUserAchievements(userId: string): UnlockedAchievementInfo[] {
  try {
    const metrics = collectUserAchievementMetrics(userId);
    if (!metrics) return [];

    const eligibleSlugs = evaluateAchievementSlugs(metrics);
    const newlyUnlocked: UnlockedAchievementInfo[] = [];

    for (const slug of eligibleSlugs) {
      const unlocked = unlockAchievement(userId, slug);
      if (unlocked) {
        newlyUnlocked.push(unlocked);
      }
    }
    return newlyUnlocked;
  } catch (err) {
    console.warn('[Achievements] Failed to evaluate achievements for user:', userId, err);
    return [];
  }
}

// Secret & Activity Achievement Triggers (Server-authoritative)
app.post('/api/achievements/check-visit', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const inMidnightWindow = isMoscowMidnightWindow();
  let newlyUnlocked: UnlockedAchievementInfo[] = [];

  if (inMidnightWindow) {
    db.prepare(`
      INSERT OR IGNORE INTO user_secret_flags (user_id, flag_key, count)
      VALUES (?, 'midnight_msk', 1)
    `).run(userId);
    newlyUnlocked = evaluateUserAchievements(userId);
  }

  res.json({
    ok: true,
    midnight_window: inMidnightWindow,
    newly_unlocked_achievements: newlyUnlocked,
  });
});

app.post('/api/achievements/track-complete', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const rawTrackId = String(req.body?.track_id || '').trim().slice(0, 120);
  if (!rawTrackId) {
    res.status(400).json({ error: 'track_id is required.' });
    return;
  }

  const listenedSeconds = Number(req.body?.listened_seconds);
  const clientDurationSeconds = Number(req.body?.duration_seconds);

  const trackRow = db.prepare('SELECT audio_url, duration_seconds FROM tracks WHERE id = ?').get(rawTrackId) as
    | { audio_url?: string; duration_seconds?: number }
    | undefined;
  const singleRow = !trackRow
    ? (db.prepare('SELECT audio_url, duration_seconds FROM singles WHERE id = ?').get(rawTrackId) as
        | { audio_url?: string; duration_seconds?: number }
        | undefined)
    : undefined;

  const dbDuration = Number(trackRow?.duration_seconds || singleRow?.duration_seconds || 0);
  const dbAudioUrl = String(trackRow?.audio_url || singleRow?.audio_url || '');
  const resolvedDbDuration = dbAudioUrl ? resolveEffectiveTrackDuration(dbAudioUrl, dbDuration) : dbDuration;
  const effectiveDuration =
    resolvedDbDuration > 0
      ? resolvedDbDuration
      : (Number.isFinite(clientDurationSeconds) && clientDurationSeconds > 0 ? clientDurationSeconds : 0);

  if (!Number.isFinite(listenedSeconds) || listenedSeconds < 8) {
    res.json({ ok: false, counted: false, reason: 'threshold_not_met', required_ratio: 0.75 });
    return;
  }
  if (effectiveDuration > 0 && listenedSeconds < effectiveDuration * 0.75) {
    res.json({ ok: false, counted: false, reason: 'threshold_not_met', required_ratio: 0.75 });
    return;
  }

  let completions = 1;
  let newlyUnlocked: UnlockedAchievementInfo[] = [];

  db.transaction(() => {
    db.prepare(`
      INSERT INTO user_track_plays (user_id, track_id, completions, updated_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, track_id) DO UPDATE SET
        completions = completions + 1,
        updated_at = datetime('now')
    `).run(userId, rawTrackId);

    const row = db
      .prepare('SELECT completions FROM user_track_plays WHERE user_id = ? AND track_id = ?')
      .get(userId, rawTrackId) as { completions?: number } | undefined;
    completions = Number(row?.completions || 1);
    newlyUnlocked = evaluateUserAchievements(userId);
  })();

  res.json({
    ok: true,
    counted: true,
    track_id: rawTrackId,
    completions,
    newly_unlocked_achievements: newlyUnlocked,
  });
});

app.post('/api/achievements/easter-egg', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const key = String(req.body?.key || '').trim();
  if (key !== 'curious_rose') {
    res.status(400).json({ error: 'Unknown easter egg key.' });
    return;
  }

  let newlyUnlocked: UnlockedAchievementInfo[] = [];
  db.transaction(() => {
    db.prepare(`
      INSERT INTO user_secret_flags (user_id, flag_key, count)
      VALUES (?, 'curious_rose', 1)
      ON CONFLICT(user_id, flag_key) DO UPDATE SET count = count + 1
    `).run(userId);
    newlyUnlocked = evaluateUserAchievements(userId);
  })();

  res.json({
    ok: true,
    newly_unlocked_achievements: newlyUnlocked,
  });
});

// 3. Leaderboard (All-Time sorted strictly by Level DESC, Total XP DESC; Weekly/Monthly + optional Game filter)
app.get('/api/games/leaderboard', (req: Request, res: Response) => {
  const rawTimeframe = String(req.query.timeframe || 'all');
  const timeframe = rawTimeframe === 'weekly' || rawTimeframe === 'monthly' ? rawTimeframe : 'all';
  const rawGame = String(req.query.game || 'all');
  const ALLOWED_LEADERBOARD_GAMES = new Set([
    'guess-track',
    'daily-quiz',
    'guess-lyrics',
    'reverse-track',
    'speed-track',
  ]);
  const gameFilter = ALLOWED_LEADERBOARD_GAMES.has(rawGame) ? rawGame : 'all';

  if (gameFilter !== 'all') {
    const timeClause =
      timeframe === 'weekly'
        ? "AND datetime(ga.created_at) >= datetime('now', '-7 days')"
        : timeframe === 'monthly'
          ? "AND datetime(ga.created_at) >= datetime('now', '-30 days')"
          : '';
    const rawLeaders = db.prepare(`
      SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level, p.total_xp,
             p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge, p.equipped_title,
             COALESCE(SUM(ga.xp_earned), 0) as xp,
             COALESCE(SUM(ga.score), 0) as score,
             p.daily_streak,
             COUNT(ga.id) as games_played
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      JOIN game_attempts ga ON ga.user_id = u.id AND ga.game_id = ? ${timeClause}
      WHERE u.is_banned = 0
      GROUP BY u.id
      HAVING COUNT(ga.id) > 0
      ORDER BY p.level DESC, p.total_xp DESC, xp DESC, score DESC, games_played DESC
      LIMIT 50
    `).all(gameFilter) as any[];

    const leaders = rawLeaders
      .map((row) => ({
        ...row,
        total_xp: Number(row.total_xp ?? row.xp ?? 0),
        level: calculateLevelFromXp(Number(row.total_xp ?? 0)).level,
      }))
      .sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        if (b.total_xp !== a.total_xp) return b.total_xp - a.total_xp;
        if (b.xp !== a.xp) return b.xp - a.xp;
        return Number(b.games_played || 0) - Number(a.games_played || 0);
      });

    res.json({ leaders, timeframe, game: gameFilter });
    return;
  }

  let query = `
    SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level, p.total_xp, p.total_xp as xp, p.daily_streak,
           p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge, p.equipped_title,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id) as games_played
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.is_banned = 0
      AND (p.total_xp > 0 OR EXISTS (SELECT 1 FROM game_attempts ga WHERE ga.user_id = u.id))
    ORDER BY p.level DESC, p.total_xp DESC, games_played DESC
    LIMIT 100
  `;

  if (timeframe === 'weekly') {
    query = `
      SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level, p.total_xp,
             p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge, p.equipped_title,
             COALESCE(SUM(xt.amount), 0) as xp, p.daily_streak,
             (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id AND datetime(ga.created_at) >= datetime('now', '-7 days')) as games_played
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      LEFT JOIN xp_transactions xt ON xt.user_id = u.id AND xt.amount > 0 AND datetime(xt.created_at) >= datetime('now', '-7 days')
      WHERE u.is_banned = 0
      GROUP BY u.id
      HAVING xp > 0 OR games_played > 0
      ORDER BY xp DESC, p.level DESC, p.total_xp DESC, games_played DESC
      LIMIT 50
    `;
  } else if (timeframe === 'monthly') {
    query = `
      SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level, p.total_xp,
             p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge, p.equipped_title,
             COALESCE(SUM(xt.amount), 0) as xp, p.daily_streak,
             (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id AND datetime(ga.created_at) >= datetime('now', '-30 days')) as games_played
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      LEFT JOIN xp_transactions xt ON xt.user_id = u.id AND xt.amount > 0 AND datetime(xt.created_at) >= datetime('now', '-30 days')
      WHERE u.is_banned = 0
      GROUP BY u.id
      HAVING xp > 0 OR games_played > 0
      ORDER BY xp DESC, p.level DESC, p.total_xp DESC, games_played DESC
      LIMIT 50
    `;
  }

  const rawLeaders = db.prepare(query).all() as any[];
  const leaders = rawLeaders
    .map((row) => {
      const totalXp = Number(row.total_xp ?? row.xp ?? 0);
      return {
        ...row,
        total_xp: totalXp,
        level: calculateLevelFromXp(totalXp).level,
      };
    })
    .sort((a, b) => {
      if (timeframe === 'all') {
        if (b.level !== a.level) return b.level - a.level;
        if (b.total_xp !== a.total_xp) return b.total_xp - a.total_xp;
        return Number(b.games_played || 0) - Number(a.games_played || 0);
      }
      if (Number(b.xp || 0) !== Number(a.xp || 0)) return Number(b.xp || 0) - Number(a.xp || 0);
      if (b.level !== a.level) return b.level - a.level;
      return b.total_xp - a.total_xp;
    })
    .slice(0, 50);

  res.json({ leaders, timeframe, game: gameFilter });
});

// ----------------------------------------------------------------------------
// API: PROMO CODES
// ----------------------------------------------------------------------------

app.post('/api/promo/redeem', requireAuth, promoRateLimit, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const normalizedCode = normalizePromoCode(String(req.body?.code || ''));
  if (!normalizedCode || normalizedCode.length > 64) {
    res.status(400).json({ error: 'Введите промокод.' });
    return;
  }

  const promo = db
    .prepare('SELECT id, code, xp_reward, is_active, max_uses, expires_at FROM promo_codes WHERE LOWER(TRIM(code)) = ? LIMIT 1')
    .get(normalizedCode) as
    | { id: string; code: string; xp_reward: number; is_active: number; max_uses?: number | null; expires_at?: string | null }
    | undefined;

  if (!promo || !promo.is_active) {
    res.status(404).json({ error: 'Неверный промокод.' });
    return;
  }

  if (promo.expires_at) {
    const expMs = Date.parse(promo.expires_at);
    if (!Number.isNaN(expMs) && expMs <= Date.now()) {
      res.status(410).json({ error: 'Срок действия промокода истёк.' });
      return;
    }
  }

  if (promo.max_uses !== null && promo.max_uses !== undefined && Number(promo.max_uses) > 0) {
    const useCountRow = db
      .prepare('SELECT COUNT(*) as cnt FROM promo_code_uses WHERE promo_code_id = ?')
      .get(promo.id) as { cnt?: number } | undefined;
    if (Number(useCountRow?.cnt || 0) >= Number(promo.max_uses)) {
      res.status(410).json({ error: 'Лимит активаций этого промокода исчерпан.' });
      return;
    }
  }

  const alreadyUsed = db
    .prepare('SELECT id FROM promo_code_uses WHERE promo_code_id = ? AND user_id = ? LIMIT 1')
    .get(promo.id, req.user.id);
  if (alreadyUsed) {
    res.status(409).json({ error: 'Вы уже использовали этот промокод.' });
    return;
  }

  let updatedXp = 0;
  let updatedTotalXp = 0;
  let updatedLevel = 1;
  let newlyUnlockedAchievements: UnlockedAchievementInfo[] = [];

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO promo_code_uses (id, promo_code_id, user_id, xp_awarded)
        VALUES (?, ?, ?, ?)
      `).run('pcu_' + crypto.randomUUID().slice(0, 10), promo.id, req.user!.id, promo.xp_reward);

      const grantRes = awardXpWithRef({
        userId: req.user!.id,
        amount: promo.xp_reward,
        source: 'promo_code',
        details: `Промокод «${promo.code}»`,
        referenceKey: `promo:${promo.id}:${req.user!.id}`,
      });
      updatedXp = grantRes.xp;
      updatedTotalXp = grantRes.totalXp;
      updatedLevel = grantRes.level;

      newlyUnlockedAchievements = evaluateUserAchievements(req.user!.id);
      if (newlyUnlockedAchievements.length > 0) {
        const afterAch = db
          .prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?')
          .get(req.user!.id) as { xp: number; total_xp: number; level: number } | undefined;
        if (afterAch) {
          updatedXp = Number(afterAch.xp || updatedXp);
          updatedTotalXp = Number(afterAch.total_xp || updatedTotalXp);
          updatedLevel = Number(afterAch.level || updatedLevel);
        }
      }
    })();
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      res.status(409).json({ error: 'Вы уже использовали этот промокод.' });
      return;
    }
    throw err;
  }

  res.json({
    ok: true,
    code: promo.code,
    xp_reward: promo.xp_reward,
    xp: updatedXp,
    total_xp: updatedTotalXp,
    level: updatedLevel,
    newly_unlocked_achievements: newlyUnlockedAchievements,
  });
});

// ----------------------------------------------------------------------------
// API: XP SHOP & INVENTORY
// ----------------------------------------------------------------------------

app.get('/api/shop/items', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const items = db.prepare(`
    SELECT * FROM shop_items WHERE is_active = 1 ORDER BY category ASC, cost_xp ASC
  `).all() as any[];

  let inventoryMap = new Map<string, { is_equipped: number }>();
  if (user) {
    const owned = db.prepare(`
      SELECT item_id, is_equipped FROM user_inventory WHERE user_id = ?
    `).all(user.id) as any[];
    for (const o of owned) {
      inventoryMap.set(o.item_id, { is_equipped: o.is_equipped });
    }
  }

  const enriched = items.map((it) => {
    const inv = inventoryMap.get(it.id);
    return {
      ...it,
      is_owned: Boolean(inv),
      is_equipped: Boolean(inv?.is_equipped),
    };
  });

  res.json({ items: enriched });
});

const SHOP_CATEGORY_COLUMN_MAP: Record<string, string> = {
  frame: 'equipped_frame',
  banner: 'equipped_banner',
  name_style: 'equipped_name_style',
  badge: 'equipped_badge',
  title: 'equipped_title',
  theme: 'equipped_theme',
  effect: 'equipped_effect',
};

app.post('/api/shop/buy', requireAuth, (req: AuthRequest, res: Response) => {
  const { item_id } = req.body || {};
  if (!item_id || typeof item_id !== 'string') {
    res.status(400).json({ error: 'Item ID is required.' });
    return;
  }

  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND is_active = 1').get(item_id) as any;
  if (!item) {
    res.status(404).json({ error: 'Предмет не найден в каталоге магазина.' });
    return;
  }

  const userId = req.user!.id;
  let purchaseError: { status: number; message: string } | null = null;

  db.transaction(() => {
    const alreadyOwned = db
      .prepare('SELECT id FROM user_inventory WHERE user_id = ? AND item_id = ?')
      .get(userId, item_id);
    if (alreadyOwned) {
      purchaseError = { status: 400, message: 'Этот предмет уже есть в вашей коллекции.' };
      return;
    }

    const currentProfile = db
      .prepare('SELECT xp, total_xp FROM profiles WHERE user_id = ?')
      .get(userId) as any;
    if (!currentProfile || currentProfile.xp < item.cost_xp) {
      purchaseError = {
        status: 400,
        message: `Недостаточно XP. Требуется: ${item.cost_xp} XP, доступно: ${currentProfile?.xp ?? 0} XP.`,
      };
      return;
    }

    // Atomic conditional deduction of spendable XP only (total_xp & level never decrease!)
    const updateRes = db
      .prepare("UPDATE profiles SET xp = xp - ?, updated_at = datetime('now') WHERE user_id = ? AND xp >= ?")
      .run(item.cost_xp, userId, item.cost_xp);
    if (updateRes.changes === 0) {
      purchaseError = { status: 400, message: 'Недостаточно XP для покупки.' };
      return;
    }

    db.prepare(`
      INSERT INTO user_inventory (id, user_id, item_id, is_equipped)
      VALUES (?, ?, ?, 0)
    `).run('inv_' + crypto.randomUUID().slice(0, 8), userId, item_id);

    db.prepare(`
      INSERT INTO xp_transactions (id, user_id, amount, source, details)
      VALUES (?, ?, ?, 'shop_purchase', ?)
    `).run('xpt_' + crypto.randomUUID().slice(0, 8), userId, -item.cost_xp, `Покупка: ${item.name_ru}`);
  })();

  if (purchaseError) {
    const errObj = purchaseError as { status: number; message: string };
    res.status(errObj.status).json({ error: errObj.message });
    return;
  }

  const newlyUnlocked = evaluateUserAchievements(userId);

  const updatedProfile = db.prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?').get(userId) as any;
  res.json({ ok: true, new_xp: updatedProfile.xp, profile: updatedProfile, newly_unlocked_achievements: newlyUnlocked });
});

app.post('/api/shop/equip', requireAuth, (req: AuthRequest, res: Response) => {
  const { item_id, equip } = req.body || {};
  if (!item_id || typeof item_id !== 'string') {
    res.status(400).json({ error: 'Item ID is required.' });
    return;
  }

  const userId = req.user!.id;
  const owned = db.prepare(`
    SELECT ui.*, si.category, si.preview_value
    FROM user_inventory ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ? AND ui.item_id = ?
  `).get(userId, item_id) as any;

  if (!owned) {
    res.status(403).json({ error: 'Этот предмет не принадлежит вам.' });
    return;
  }

  const shouldEquip = equip !== undefined ? Boolean(equip) : !owned.is_equipped;
  const column = SHOP_CATEGORY_COLUMN_MAP[owned.category] || '';

  db.transaction(() => {
    if (shouldEquip) {
      // Unequip any item of same category
      db.prepare(`
        UPDATE user_inventory
        SET is_equipped = 0
        WHERE user_id = ? AND item_id IN (SELECT id FROM shop_items WHERE category = ?)
      `).run(userId, owned.category);

      db.prepare('UPDATE user_inventory SET is_equipped = 1 WHERE user_id = ? AND item_id = ?').run(userId, item_id);

      if (column) {
        db.prepare(`UPDATE profiles SET ${column} = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
          owned.preview_value,
          userId
        );
      }
    } else {
      db.prepare('UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND item_id = ?').run(userId, item_id);

      if (column) {
        db.prepare(`UPDATE profiles SET ${column} = NULL, updated_at = datetime('now') WHERE user_id = ?`).run(userId);
      }
    }
  })();

  const newlyUnlocked = evaluateUserAchievements(userId);
  const equippedState = db.prepare(`
    SELECT equipped_frame, equipped_banner, equipped_name_style, equipped_badge,
           equipped_title, equipped_theme, equipped_effect
    FROM profiles WHERE user_id = ?
  `).get(userId);
  res.json({ ok: true, is_equipped: shouldEquip, category: owned.category, equipped: equippedState, newly_unlocked_achievements: newlyUnlocked });
});

app.get('/api/shop/inventory', requireAuth, (req: AuthRequest, res: Response) => {
  const inventory = db.prepare(`
    SELECT ui.*, si.name_ru, si.name_en, si.description_ru, si.description_en, si.category, si.preview_value, si.rarity
    FROM user_inventory ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ?
    ORDER BY ui.purchased_at DESC
  `).all(req.user!.id);

  res.json({ inventory });
});

// ----------------------------------------------------------------------------
// API: COMMUNITY & FORUM
// ----------------------------------------------------------------------------

app.get('/api/community/categories', (_req: Request, res: Response) => {
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM posts WHERE category_id = c.id AND status = 'approved') as post_count
    FROM post_categories c
    ORDER BY c.sort_order ASC
  `).all();
  res.json({ categories });
});

app.get('/api/community/posts', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const isStaff = user && (user.role_id === 'admin' || user.role_id === 'moderator');
  const { category, sort, search, status } = req.query;
  let conditions: string[] = [];
  const params: any[] = [];

  if (isStaff) {
    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push('p.status = ?');
      params.push(status);
    } else {
      conditions.push('1=1');
    }
  } else {
    // Regular users see approved posts plus their own pending/rejected posts
    if (user) {
      conditions.push("(p.status = 'approved' OR p.user_id = ?)");
      params.push(user.id);
    } else {
      conditions.push("p.status = 'approved'");
    }
  }

  if (category && category !== 'all') {
    conditions.push('c.slug = ?');
    params.push(category);
  }

  if (search && typeof search === 'string' && search.trim()) {
    conditions.push('(p.title LIKE ? OR p.content LIKE ?)');
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  let orderBy = 'p.is_pinned DESC, p.created_at DESC';
  if (sort === 'popular') {
    orderBy = 'p.is_pinned DESC, p.reactions_count DESC, p.created_at DESC';
  } else if (sort === 'discussed') {
    orderBy = 'p.is_pinned DESC, p.comments_count DESC, p.created_at DESC';
  }

  const query = `
    SELECT p.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge, pr.equipped_title as author_title,
           c.name_ru as category_name_ru, c.name_en as category_name_en, c.slug as category_slug,
           c.is_official as category_is_official,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.reaction_type = 'rose') as rose_count,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.reaction_type = 'skull') as skull_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
    JOIN profiles pr ON pr.user_id = u.id
    JOIN post_categories c ON c.id = p.category_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 100
  `;

  const rawPosts = db.prepare(query).all(...params) as any[];
  const userPostReactions = new Map<string, 'rose' | 'skull'>();
  if (user && rawPosts.length > 0) {
    const rxRows = db
      .prepare("SELECT target_id, reaction_type FROM reactions WHERE target_type = 'post' AND user_id = ?")
      .all(user.id) as Array<{ target_id: string; reaction_type: string }>;
    for (const r of rxRows) {
      if (r.reaction_type === 'rose' || r.reaction_type === 'skull') {
        userPostReactions.set(r.target_id, r.reaction_type);
      }
    }
  }

  const posts = rawPosts.map((p) => ({
    ...p,
    rose_count: Number(p.rose_count || 0),
    skull_count: Number(p.skull_count || 0),
    user_reaction: userPostReactions.get(p.id) || null,
  }));

  res.json({ posts });
});

app.get('/api/community/posts/:id', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const post = db.prepare(`
    SELECT p.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge, pr.equipped_title as author_title,
           c.name_ru as category_name_ru, c.name_en as category_name_en, c.slug as category_slug,
           c.is_official as category_is_official,
           (SELECT COUNT(*) FROM follows f WHERE f.following_id = p.user_id) as author_followers_count,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.reaction_type = 'rose') as rose_count,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.reaction_type = 'skull') as skull_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
    JOIN profiles pr ON pr.user_id = u.id
    JOIN post_categories c ON c.id = p.category_id
    WHERE p.id = ?
  `).get(req.params.id) as any;

  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const isStaff = user && (user.role_id === 'admin' || user.role_id === 'moderator');
  if (post.status !== 'approved' && !isStaff && post.user_id !== user?.id) {
    res.status(403).json({ error: 'This discussion is not publicly visible.' });
    return;
  }

  // Increment view count & lightweight unique post_reads counter (strictly 0 XP)
  db.prepare('UPDATE posts SET views_count = views_count + 1 WHERE id = ?').run(post.id);
  if (user) {
    try {
      db.prepare('INSERT OR IGNORE INTO post_reads (user_id, post_id) VALUES (?, ?)').run(user.id, post.id);
    } catch {}
  }

  const comments = db.prepare(`
    SELECT cm.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge, pr.equipped_title as author_title
    FROM comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE cm.post_id = ? ${isStaff ? '' : 'AND COALESCE(cm.is_hidden, 0) = 0'}
    ORDER BY cm.created_at ASC
  `).all(post.id);

  let userReaction: 'rose' | 'skull' | null = null;
  let authorIsFollowing = false;
  if (user) {
    const rx = db.prepare("SELECT reaction_type FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?").get(post.id, user.id) as any;
    if (rx?.reaction_type === 'rose' || rx?.reaction_type === 'skull') {
      userReaction = rx.reaction_type;
    }
    if (user.id !== post.user_id) {
      const flw = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(user.id, post.user_id);
      authorIsFollowing = Boolean(flw);
    }
  }

  res.json({
    post: {
      ...post,
      rose_count: Number(post.rose_count || 0),
      skull_count: Number(post.skull_count || 0),
      author_followers_count: Number(post.author_followers_count || 0),
      author_is_following: authorIsFollowing,
      user_reaction: userReaction,
    },
    comments,
    userReaction,
  });
});

app.post('/api/community/posts', requireAuth, (req: AuthRequest, res: Response) => {
  const { title, content, category_id, media_url, media_type } = req.body;
  if (!title || !content || !category_id) {
    res.status(400).json({ error: 'Title, content and category are required.' });
    return;
  }
  const cleanTitle = String(title).trim().slice(0, 160);
  const cleanContent = String(content).trim().slice(0, 10000);
  if (!cleanTitle || !cleanContent) {
    res.status(400).json({ error: 'Title and content cannot be empty.' });
    return;
  }
  if (media_url && !isSafeMediaUrl(String(media_url))) {
    res.status(400).json({ error: 'Invalid media URL.' });
    return;
  }

  const category = db.prepare('SELECT * FROM post_categories WHERE id = ?').get(category_id) as any;
  if (!category) {
    res.status(400).json({ error: 'Category not found.' });
    return;
  }

  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  if (category.is_official && !isStaff) {
    res.status(403).json({ error: 'Публикация в официальном разделе доступна только администрации архива.' });
    return;
  }

  // Regular user posts wait in moderation queue with 0 XP until approved; staff posts auto-approve
  const status = isStaff ? 'approved' : 'pending';
  const id = 'post_' + crypto.randomUUID().slice(0, 8);
  let awardedXp = 0;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO posts (id, user_id, category_id, title, content, media_url, media_type, status, xp_awarded, xp_awarded_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(id, req.user!.id, category_id, cleanTitle, cleanContent, media_url ? String(media_url).trim() : null, media_type || null, status);

    if (status === 'approved') {
      if (canEarnDiscussionXp(req.user!.id, cleanContent)) {
        const grant = awardXpWithRef({
          userId: req.user!.id,
          amount: 10,
          source: 'community_post',
          details: `Тема: «${cleanTitle.slice(0, 40)}»`,
          referenceKey: `award:post:${id}`,
        });
        if (grant.awarded) {
          awardedXp = grant.amount;
          db.prepare('UPDATE posts SET xp_awarded = 1, xp_awarded_amount = ? WHERE id = ?').run(grant.amount, id);
        }
      }

      evaluateUserAchievements(req.user!.id);
      notifyFollowers({
        author: req.user!,
        type: 'new_post',
        targetType: 'post',
        targetId: id,
        targetTitle: cleanTitle,
        targetLink: `/community?post=${encodeURIComponent(id)}`,
        excerpt: cleanContent,
      });
    }
  })();

  res.json({ ok: true, id, status, xp_earned: awardedXp });
});

app.put('/api/community/posts/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  if (existing.user_id !== req.user!.id && !isStaff) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const { title, content, media_url, media_type } = req.body;
  const cleanTitle = title !== undefined ? String(title).trim().slice(0, 160) : existing.title;
  const cleanContent = content !== undefined ? String(content).trim().slice(0, 10000) : existing.content;
  if (!cleanTitle || !cleanContent) {
    res.status(400).json({ error: 'Title and content cannot be empty.' });
    return;
  }
  if (media_url && !isSafeMediaUrl(String(media_url))) {
    res.status(400).json({ error: 'Invalid media URL.' });
    return;
  }

  db.prepare(`
    UPDATE posts SET
      title = ?,
      content = ?,
      media_url = ?,
      media_type = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    cleanTitle,
    cleanContent,
    media_url !== undefined ? (media_url ? String(media_url).trim() : null) : existing.media_url,
    media_type !== undefined ? (media_type || null) : existing.media_type,
    existing.id
  );

  res.json({ ok: true });
});

app.post('/api/admin/community/posts/:id/moderate', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const { status, rejection_reason } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    res.status(400).json({ error: 'Invalid moderation status' });
    return;
  }

  const existing = db
    .prepare('SELECT id, user_id, title, content, status, xp_awarded, xp_awarded_amount FROM posts WHERE id = ?')
    .get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }

  const authorRow = db
    .prepare('SELECT u.id, u.nickname, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?')
    .get(existing.user_id) as { id: string; nickname: string; display_name?: string } | undefined;

  db.transaction(() => {
    db.prepare(`
      UPDATE posts SET status = ?, rejection_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, rejection_reason || null, existing.id);

    if (status === 'approved') {
      if (!existing.xp_awarded && canEarnDiscussionXp(existing.user_id, existing.content)) {
        const grant = awardXpWithRef({
          userId: existing.user_id,
          amount: 10,
          source: 'community_post',
          details: `Тема: «${String(existing.title || '').slice(0, 40)}»`,
          referenceKey: `award:post:${existing.id}`,
        });
        if (grant.awarded) {
          db.prepare('UPDATE posts SET xp_awarded = 1, xp_awarded_amount = ? WHERE id = ?').run(grant.amount, existing.id);
        }
      }
      if (existing.status !== 'approved') {
        evaluateUserAchievements(existing.user_id);
        if (authorRow) {
          notifyFollowers({
            author: authorRow,
            type: 'new_post',
            targetType: 'post',
            targetId: existing.id,
            targetTitle: existing.title,
            targetLink: `/community?post=${encodeURIComponent(existing.id)}`,
            excerpt: existing.content,
          });
        }
      }
    } else if (status === 'rejected' && existing.xp_awarded && Number(existing.xp_awarded_amount) > 0) {
      revokeXpWithRef({
        userId: existing.user_id,
        amount: Number(existing.xp_awarded_amount),
        source: 'xp_rollback',
        details: `Откат XP: отклонена тема «${String(existing.title || '').slice(0, 40)}»`,
        referenceKey: `rollback:post:${existing.id}`,
      });
      db.prepare('UPDATE posts SET xp_awarded = 0, xp_awarded_amount = 0 WHERE id = ?').run(existing.id);
    }
  })();

  res.json({ ok: true, status });
});

app.post('/api/admin/community/posts/:id/pin', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const post = db.prepare('SELECT id, is_pinned FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  const nextPinned = req.body?.is_pinned !== undefined ? (req.body.is_pinned ? 1 : 0) : (post.is_pinned ? 0 : 1);
  db.prepare("UPDATE posts SET is_pinned = ?, updated_at = datetime('now') WHERE id = ?").run(nextPinned, post.id);
  res.json({ ok: true, is_pinned: nextPinned });
});

app.post('/api/admin/community/posts/:id/lock', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const post = db.prepare('SELECT id, is_locked FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  const nextLocked = req.body?.is_locked !== undefined ? (req.body.is_locked ? 1 : 0) : (post.is_locked ? 0 : 1);
  db.prepare("UPDATE posts SET is_locked = ?, updated_at = datetime('now') WHERE id = ?").run(nextLocked, post.id);
  res.json({ ok: true, is_locked: nextLocked });
});

app.post('/api/community/posts/:id/comments', requireAuth, (req: AuthRequest, res: Response) => {
  const { content, parent_id } = req.body;
  const cleanContent = content ? String(content).trim().slice(0, 2000) : '';
  if (!cleanContent) {
    res.status(400).json({ error: 'Comment content cannot be empty.' });
    return;
  }

  const targetPost = db.prepare('SELECT id, user_id, title, status, is_locked FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!targetPost) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  if (targetPost.is_locked && !isStaff) {
    res.status(403).json({ error: 'This discussion is locked by moderators.' });
    return;
  }

  let parentComment: any = null;
  if (parent_id && typeof parent_id === 'string') {
    parentComment = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(parent_id) as any;
  }

  const id = 'cm_' + crypto.randomUUID().slice(0, 8);
  let newlyUnlocked: UnlockedAchievementInfo[] = [];
  let xpEarned = 0;

  db.transaction(() => {
    let xpAwardedFlag = 0;
    let xpAwardedAmount = 0;
    if (targetPost.status === 'approved' && canEarnDiscussionXp(req.user!.id, cleanContent)) {
      const grant = awardXpWithRef({
        userId: req.user!.id,
        amount: 5,
        source: 'comment',
        details: 'Комментарий в обсуждении',
        referenceKey: `award:comment:${id}`,
      });
      if (grant.awarded) {
        xpAwardedFlag = 1;
        xpAwardedAmount = grant.amount;
        xpEarned = grant.amount;
      }
    }

    db.prepare(`
      INSERT INTO comments (id, user_id, post_id, content, parent_id, xp_awarded, xp_awarded_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user!.id, req.params.id, cleanContent, parentComment ? parentComment.id : null, xpAwardedFlag, xpAwardedAmount);

    db.prepare(`
      UPDATE posts SET comments_count = comments_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);

    // Notify post author and/or parent comment author (deduplicated)
    const recipients = new Set<string>();
    if (targetPost.user_id && targetPost.user_id !== req.user!.id) recipients.add(targetPost.user_id);
    if (parentComment?.user_id && parentComment.user_id !== req.user!.id) recipients.add(parentComment.user_id);

    for (const recipientId of recipients) {
      createReplyNotification({
        recipientUserId: recipientId,
        actor: req.user!,
        targetType: 'post',
        targetId: targetPost.id,
        targetTitle: targetPost.title,
        targetLink: `/community?post=${encodeURIComponent(targetPost.id)}`,
        excerpt: cleanContent,
      });
    }

    if (targetPost.status === 'approved') {
      notifyFollowers({
        author: req.user!,
        type: 'new_comment',
        targetType: 'post',
        targetId: targetPost.id,
        targetTitle: targetPost.title,
        targetLink: `/community?post=${encodeURIComponent(targetPost.id)}`,
        excerpt: cleanContent,
        excludeUserIds: recipients,
      });
    }

    newlyUnlocked = evaluateUserAchievements(req.user!.id);
  })();

  res.json({ ok: true, id, xp_earned: xpEarned, newly_unlocked_achievements: newlyUnlocked });
});

app.post('/api/community/posts/:id/react', requireAuth, (req: AuthRequest, res: Response) => {
  const { reaction_type } = req.body || {};
  if (reaction_type !== 'rose' && reaction_type !== 'skull') {
    res.status(400).json({ error: 'Поддерживаются только реакции «Роза» (rose) и «Череп» (skull).' });
    return;
  }
  const postId = req.params.id;

  const target = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!target) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  let reacted = false;
  let nextType: 'rose' | 'skull' | null = null;

  db.transaction(() => {
    const existing = db.prepare(`
      SELECT id, reaction_type FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?
    `).get(postId, req.user!.id) as any;

    if (existing) {
      if (existing.reaction_type === reaction_type) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
        reacted = false;
        nextType = null;
      } else {
        db.prepare('UPDATE reactions SET reaction_type = ? WHERE id = ?').run(reaction_type, existing.id);
        reacted = true;
        nextType = reaction_type;
      }
    } else {
      db.prepare(`
        INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type)
        VALUES (?, ?, 'post', ?, ?)
      `).run('rx_' + crypto.randomUUID().slice(0, 8), req.user!.id, postId, reaction_type);
      reacted = true;
      nextType = reaction_type;
    }

    const total = (db.prepare(`
      SELECT COUNT(*) as c FROM reactions WHERE target_type = 'post' AND target_id = ? AND reaction_type IN ('rose', 'skull')
    `).get(postId) as any)?.c || 0;
    db.prepare('UPDATE posts SET reactions_count = ? WHERE id = ?').run(total, postId);
  })();

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN reaction_type = 'rose' THEN 1 ELSE 0 END) as rose_count,
      SUM(CASE WHEN reaction_type = 'skull' THEN 1 ELSE 0 END) as skull_count
    FROM reactions
    WHERE target_type = 'post' AND target_id = ?
  `).get(postId) as any;

  const roseCount = Number(counts?.rose_count || 0);
  const skullCount = Number(counts?.skull_count || 0);

  res.json({
    reacted,
    reaction_type: nextType,
    rose_count: roseCount,
    skull_count: skullCount,
    reactions_count: roseCount + skullCount,
  });
});

app.delete('/api/community/posts/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const post = db
    .prepare('SELECT id, user_id, title, xp_awarded, xp_awarded_amount FROM posts WHERE id = ?')
    .get(req.params.id) as any;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  if (post.user_id !== req.user!.id && req.user!.role_id !== 'admin' && req.user!.role_id !== 'moderator') {
    res.status(403).json({ error: 'Cannot delete others posts' });
    return;
  }

  db.transaction(() => {
    if (post.xp_awarded && Number(post.xp_awarded_amount) > 0) {
      revokeXpWithRef({
        userId: post.user_id,
        amount: Number(post.xp_awarded_amount),
        source: 'xp_rollback',
        details: `Откат XP: удаление темы «${String(post.title || '').slice(0, 40)}»`,
        referenceKey: `rollback:post:${post.id}`,
      });
    }

    const postComments = db
      .prepare('SELECT id, user_id, xp_awarded, xp_awarded_amount FROM comments WHERE post_id = ?')
      .all(post.id) as Array<{ id: string; user_id: string; xp_awarded: number; xp_awarded_amount: number }>;
    for (const cm of postComments) {
      if (cm.xp_awarded && Number(cm.xp_awarded_amount) > 0) {
        revokeXpWithRef({
          userId: cm.user_id,
          amount: Number(cm.xp_awarded_amount),
          source: 'xp_rollback',
          details: 'Откат XP: удаление комментария',
          referenceKey: `rollback:comment:${cm.id}`,
        });
      }
    }

    db.prepare('DELETE FROM comments WHERE post_id = ?').run(post.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  })();

  res.json({ ok: true });
});

app.get('/api/admin/comments', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const filter = String(req.query.filter || 'all');
  const scope = String(req.query.scope || 'all');
  const search = String(req.query.search || '').trim();

  const whereParts: string[] = [];
  const params: any[] = [];

  if (filter === 'hidden') {
    whereParts.push('c.is_hidden = 1');
  } else if (filter === 'visible') {
    whereParts.push('COALESCE(c.is_hidden, 0) = 0');
  }

  if (scope === 'releases') {
    whereParts.push('(c.album_id IS NOT NULL OR c.single_id IS NOT NULL)');
  } else if (scope === 'forum') {
    whereParts.push('c.post_id IS NOT NULL');
  } else if (scope === 'creations') {
    whereParts.push('c.creation_id IS NOT NULL');
  }

  if (search) {
    whereParts.push('(c.content LIKE ? COLLATE NOCASE OR u.nickname LIKE ? COLLATE NOCASE)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT c.id, c.user_id, c.post_id, c.creation_id, c.album_id, c.single_id, c.parent_id,
           c.content, c.is_hidden, c.status, c.xp_awarded, c.xp_awarded_amount, c.created_at,
           u.nickname as author_nickname, p.display_name as author_name, p.avatar_url as author_avatar,
           CASE
             WHEN c.album_id IS NOT NULL THEN 'album'
             WHEN c.single_id IS NOT NULL THEN 'single'
             WHEN c.post_id IS NOT NULL THEN 'post'
             WHEN c.creation_id IS NOT NULL THEN 'creation'
             ELSE 'unknown'
           END as target_type,
           COALESCE(a.title, s.title, po.title, cr.title, '') as target_title
    FROM comments c
    JOIN users u ON u.id = c.user_id
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN albums a ON a.id = c.album_id
    LEFT JOIN singles s ON s.id = c.single_id
    LEFT JOIN posts po ON po.id = c.post_id
    LEFT JOIN creations cr ON cr.id = c.creation_id
    ${whereSql}
    ORDER BY datetime(c.created_at) DESC
    LIMIT 150
  `).all(...params);

  res.json({ comments: rows });
});

app.post('/api/community/comments/:id/hide', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const comment = db.prepare('SELECT id, is_hidden FROM comments WHERE id = ?').get(req.params.id) as any;
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  const nextHidden = req.body?.is_hidden !== undefined
    ? (req.body.is_hidden ? 1 : 0)
    : (comment.is_hidden ? 0 : 1);
  db.prepare("UPDATE comments SET is_hidden = ?, updated_at = datetime('now') WHERE id = ?").run(nextHidden, comment.id);
  res.json({ ok: true, is_hidden: nextHidden });
});

app.delete('/api/community/comments/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const comment = db
    .prepare('SELECT id, user_id, post_id, creation_id, xp_awarded, xp_awarded_amount FROM comments WHERE id = ?')
    .get(req.params.id) as any;
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' });
    return;
  }
  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  if (comment.user_id !== req.user!.id && !isStaff) {
    res.status(403).json({ error: 'Cannot delete others comments' });
    return;
  }

  db.transaction(() => {
    const toDelete: Array<{ id: string; user_id: string; xp_awarded: number; xp_awarded_amount: number }> = [comment];
    const queue = [comment.id];
    const seen = new Set<string>([comment.id]);
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const children = db
        .prepare('SELECT id, user_id, xp_awarded, xp_awarded_amount FROM comments WHERE parent_id = ?')
        .all(parentId) as Array<{ id: string; user_id: string; xp_awarded: number; xp_awarded_amount: number }>;
      for (const ch of children) {
        if (!seen.has(ch.id)) {
          seen.add(ch.id);
          toDelete.push(ch);
          queue.push(ch.id);
        }
      }
    }

    for (const item of toDelete) {
      if (item.xp_awarded && Number(item.xp_awarded_amount) > 0) {
        revokeXpWithRef({
          userId: item.user_id,
          amount: Number(item.xp_awarded_amount),
          source: 'xp_rollback',
          details: 'Откат XP: удаление комментария',
          referenceKey: `rollback:comment:${item.id}`,
        });
      }
    }

    for (let i = toDelete.length - 1; i >= 0; i--) {
      db.prepare('DELETE FROM comments WHERE id = ?').run(toDelete[i].id);
    }

    if (comment.post_id) {
      db.prepare(`
        UPDATE posts
        SET comments_count = (SELECT COUNT(*) FROM comments WHERE post_id = ?),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(comment.post_id, comment.post_id);
    }
  })();

  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// API: CREATIONS GALLERY
// ----------------------------------------------------------------------------

app.get('/api/creations', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const isStaff = user && (user.role_id === 'admin' || user.role_id === 'moderator');
  const { category, sort, search, status } = req.query;
  let conditions: string[] = [];
  const params: any[] = [];

  if (isStaff) {
    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push('c.status = ?');
      params.push(status);
    } else {
      conditions.push('1=1');
    }
  } else {
    if (user) {
      conditions.push("(c.status = 'approved' OR c.user_id = ?)");
      params.push(user.id);
    } else {
      conditions.push("c.status = 'approved'");
    }
  }

  if (category && category !== 'all') {
    if (category === 'art') {
      conditions.push("c.category IN ('art', 'artwork', 'covers', 'beats', 'video', 'lyrics')");
    } else if (category === 'meme') {
      conditions.push("c.category = 'meme'");
    } else {
      conditions.push('c.category = ?');
      params.push(category);
    }
  }

  if (search && typeof search === 'string' && search.trim()) {
    conditions.push('(c.title LIKE ? OR c.description LIKE ?)');
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  let orderBy = 'c.created_at DESC';
  if (sort === 'popular') {
    orderBy = 'c.likes_count DESC, c.created_at DESC';
  }

  const rawCreations = db.prepare(`
    SELECT c.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'creation' AND r.target_id = c.id AND r.reaction_type = 'rose') as rose_count,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'creation' AND r.target_id = c.id AND r.reaction_type = 'skull') as skull_count
    FROM creations c
    JOIN users u ON u.id = c.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 100
  `).all(...params) as any[];

  const userCreationReactions = new Map<string, 'rose' | 'skull'>();
  if (user && rawCreations.length > 0) {
    const rxRows = db
      .prepare("SELECT target_id, reaction_type FROM reactions WHERE target_type = 'creation' AND user_id = ?")
      .all(user.id) as Array<{ target_id: string; reaction_type: string }>;
    for (const r of rxRows) {
      if (r.reaction_type === 'rose' || r.reaction_type === 'skull') {
        userCreationReactions.set(r.target_id, r.reaction_type);
      }
    }
  }

  const creations = rawCreations.map((c) => ({
    ...c,
    rose_count: Number(c.rose_count || 0),
    skull_count: Number(c.skull_count || 0),
    user_reaction: userCreationReactions.get(c.id) || null,
  }));

  res.json({ creations });
});

app.get('/api/creations/:id', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const creation = db.prepare(`
    SELECT c.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge,
           (SELECT COUNT(*) FROM follows f WHERE f.following_id = c.user_id) as author_followers_count,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'creation' AND r.target_id = c.id AND r.reaction_type = 'rose') as rose_count,
           (SELECT COUNT(*) FROM reactions r WHERE r.target_type = 'creation' AND r.target_id = c.id AND r.reaction_type = 'skull') as skull_count
    FROM creations c
    JOIN users u ON u.id = c.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE c.id = ?
  `).get(req.params.id) as any;

  if (!creation) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }

  const isStaff = user && (user.role_id === 'admin' || user.role_id === 'moderator');
  if (creation.status !== 'approved' && !isStaff && creation.user_id !== user?.id) {
    res.status(403).json({ error: 'This creation is not publicly visible.' });
    return;
  }

  db.prepare('UPDATE creations SET views_count = views_count + 1 WHERE id = ?').run(creation.id);

  const comments = db.prepare(`
    SELECT cm.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge
    FROM comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE cm.creation_id = ? ${isStaff ? '' : 'AND COALESCE(cm.is_hidden, 0) = 0'}
    ORDER BY cm.created_at ASC
  `).all(creation.id);

  let userReaction: 'rose' | 'skull' | null = null;
  let favorited = false;
  let authorIsFollowing = false;
  if (user) {
    const rx = db.prepare("SELECT reaction_type FROM reactions WHERE target_type = 'creation' AND target_id = ? AND user_id = ?").get(creation.id, user.id) as any;
    if (rx?.reaction_type === 'rose' || rx?.reaction_type === 'skull') {
      userReaction = rx.reaction_type;
    }
    const fav = db.prepare("SELECT id FROM favorites WHERE target_type = 'creation' AND target_id = ? AND user_id = ?").get(creation.id, user.id);
    favorited = Boolean(fav);
    if (user.id !== creation.user_id) {
      const flw = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(user.id, creation.user_id);
      authorIsFollowing = Boolean(flw);
    }
  }

  res.json({
    creation: {
      ...creation,
      views_count: (creation.views_count || 0) + 1,
      rose_count: Number(creation.rose_count || 0),
      skull_count: Number(creation.skull_count || 0),
      author_followers_count: Number(creation.author_followers_count || 0),
      author_is_following: authorIsFollowing,
      user_reaction: userReaction,
    },
    comments,
    liked: userReaction === 'rose',
    userReaction,
    favorited,
  });
});

app.post('/api/creations/:id/comments', requireAuth, (req: AuthRequest, res: Response) => {
  const { content, parent_id } = req.body;
  const cleanContent = content ? String(content).trim().slice(0, 2000) : '';
  if (!cleanContent) {
    res.status(400).json({ error: 'Comment content cannot be empty.' });
    return;
  }

  const creation = db.prepare('SELECT id, user_id, title, status FROM creations WHERE id = ?').get(req.params.id) as any;
  if (!creation) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }

  let parentComment: any = null;
  if (parent_id && typeof parent_id === 'string') {
    parentComment = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(parent_id) as any;
  }

  const id = 'cm_' + crypto.randomUUID().slice(0, 8);
  let newlyUnlocked: UnlockedAchievementInfo[] = [];
  let xpEarned = 0;

  db.transaction(() => {
    let xpAwardedFlag = 0;
    let xpAwardedAmount = 0;
    if (creation.status === 'approved' && canEarnDiscussionXp(req.user!.id, cleanContent)) {
      const grant = awardXpWithRef({
        userId: req.user!.id,
        amount: 5,
        source: 'comment',
        details: 'Комментарий в творчестве',
        referenceKey: `award:comment:${id}`,
      });
      if (grant.awarded) {
        xpAwardedFlag = 1;
        xpAwardedAmount = grant.amount;
        xpEarned = grant.amount;
      }
    }

    db.prepare(`
      INSERT INTO comments (id, user_id, creation_id, content, parent_id, xp_awarded, xp_awarded_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user!.id, req.params.id, cleanContent, parentComment ? parentComment.id : null, xpAwardedFlag, xpAwardedAmount);

    const recipients = new Set<string>();
    if (creation.user_id && creation.user_id !== req.user!.id) recipients.add(creation.user_id);
    if (parentComment?.user_id && parentComment.user_id !== req.user!.id) recipients.add(parentComment.user_id);

    for (const recipientId of recipients) {
      createReplyNotification({
        recipientUserId: recipientId,
        actor: req.user!,
        targetType: 'creation',
        targetId: creation.id,
        targetTitle: creation.title,
        targetLink: `/creations?creation=${encodeURIComponent(creation.id)}`,
        excerpt: cleanContent,
      });
    }

    if (creation.status === 'approved') {
      notifyFollowers({
        author: req.user!,
        type: 'new_comment',
        targetType: 'creation',
        targetId: creation.id,
        targetTitle: creation.title,
        targetLink: `/creations?creation=${encodeURIComponent(creation.id)}`,
        excerpt: cleanContent,
        excludeUserIds: recipients,
      });
    }

    newlyUnlocked = evaluateUserAchievements(req.user!.id);
  })();

  res.json({ ok: true, id, xp_earned: xpEarned, newly_unlocked_achievements: newlyUnlocked });
});

const VALID_CREATION_CATEGORIES = new Set(['art', 'meme', 'artwork', 'covers', 'beats', 'video', 'lyrics']);

app.post('/api/creations', requireAuth, (req: AuthRequest, res: Response) => {
  const { title, category, description, media_url, media_type } = req.body;
  const cleanCategory = typeof category === 'string' ? category.trim() : '';
  if (!title || !cleanCategory || !VALID_CREATION_CATEGORIES.has(cleanCategory) || !media_url) {
    res.status(400).json({ error: 'Выберите категорию («Творчество» или «Мемы»), укажите название и медиафайл.' });
    return;
  }
  const cleanTitle = String(title).trim().slice(0, 160);
  if (!cleanTitle) {
    res.status(400).json({ error: 'Title cannot be empty.' });
    return;
  }
  if (!isSafeMediaUrl(String(media_url))) {
    res.status(400).json({ error: 'Invalid media URL.' });
    return;
  }

  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  const status = isStaff ? 'approved' : 'pending';
  const id = 'cr_' + crypto.randomUUID().slice(0, 8);
  const cleanDesc = description ? String(description).slice(0, 3000) : '';
  let awardedXp = 0;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO creations (id, user_id, title, category, description, media_url, media_type, status, is_approved, xp_awarded, xp_awarded_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(id, req.user!.id, cleanTitle, cleanCategory, cleanDesc, String(media_url).trim(), media_type || 'image', status, status === 'approved' ? 1 : 0);

    if (status === 'approved') {
      const rewardAmount = cleanCategory === 'meme' ? 5 : 15;
      const source = cleanCategory === 'meme' ? 'meme_upload' : 'creation_upload';
      const grant = awardXpWithRef({
        userId: req.user!.id,
        amount: rewardAmount,
        source,
        details: cleanCategory === 'meme' ? `Мем: «${cleanTitle.slice(0, 35)}»` : `Работа: «${cleanTitle.slice(0, 35)}»`,
        referenceKey: `award:creation:${id}`,
      });
      if (grant.awarded) {
        awardedXp = grant.amount;
        db.prepare('UPDATE creations SET xp_awarded = 1, xp_awarded_amount = ? WHERE id = ?').run(grant.amount, id);
      }

      evaluateUserAchievements(req.user!.id);
      notifyFollowers({
        author: req.user!,
        type: 'new_creation',
        targetType: 'creation',
        targetId: id,
        targetTitle: cleanTitle,
        targetLink: `/creations?creation=${encodeURIComponent(id)}`,
        excerpt: cleanDesc || cleanTitle,
      });
    }
  })();

  res.json({ ok: true, id, status, xp_earned: awardedXp });
});

app.put('/api/creations/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }
  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  if (existing.user_id !== req.user!.id && !isStaff) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const { title, category, description, media_url, media_type } = req.body;
  const cleanTitle = title !== undefined ? String(title).trim().slice(0, 160) : existing.title;
  if (!cleanTitle) {
    res.status(400).json({ error: 'Title cannot be empty.' });
    return;
  }
  if (media_url && !isSafeMediaUrl(String(media_url))) {
    res.status(400).json({ error: 'Invalid media URL.' });
    return;
  }
  const nextCategory = typeof category === 'string' && VALID_CREATION_CATEGORIES.has(category.trim())
    ? category.trim()
    : existing.category;
  db.prepare(`
    UPDATE creations SET
      title = ?,
      category = ?,
      description = ?,
      media_url = ?,
      media_type = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    cleanTitle,
    nextCategory,
    description !== undefined ? String(description).slice(0, 3000) : existing.description,
    media_url ? String(media_url).trim() : existing.media_url,
    media_type || existing.media_type,
    existing.id
  );
  res.json({ ok: true });
});

app.post('/api/admin/creations/:id/moderate', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const { status, rejection_reason, category } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    res.status(400).json({ error: 'Invalid moderation status' });
    return;
  }

  const existing = db
    .prepare('SELECT id, user_id, title, description, category, status, xp_awarded, xp_awarded_amount FROM creations WHERE id = ?')
    .get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }

  const nextCategory = typeof category === 'string' && VALID_CREATION_CATEGORIES.has(category.trim())
    ? category.trim()
    : existing.category || 'art';

  const authorRow = db
    .prepare('SELECT u.id, u.nickname, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?')
    .get(existing.user_id) as { id: string; nickname: string; display_name?: string } | undefined;

  db.transaction(() => {
    db.prepare(`
      UPDATE creations SET
        status = ?,
        is_approved = ?,
        rejection_reason = ?,
        category = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status, status === 'approved' ? 1 : 0, rejection_reason || null, nextCategory, existing.id);

    if (status === 'approved') {
      if (!existing.xp_awarded) {
        const rewardAmount = nextCategory === 'meme' ? 5 : 15;
        const source = nextCategory === 'meme' ? 'meme_upload' : 'creation_upload';
        const grant = awardXpWithRef({
          userId: existing.user_id,
          amount: rewardAmount,
          source,
          details: nextCategory === 'meme'
            ? `Одобрен мем: «${String(existing.title || '').slice(0, 35)}»`
            : `Одобрена работа: «${String(existing.title || '').slice(0, 35)}»`,
          referenceKey: `award:creation:${existing.id}`,
        });
        if (grant.awarded) {
          db.prepare('UPDATE creations SET xp_awarded = 1, xp_awarded_amount = ? WHERE id = ?').run(grant.amount, existing.id);
        }
      }
      if (existing.status !== 'approved') {
        evaluateUserAchievements(existing.user_id);
        if (authorRow) {
          notifyFollowers({
            author: authorRow,
            type: 'new_creation',
            targetType: 'creation',
            targetId: existing.id,
            targetTitle: existing.title,
            targetLink: `/creations?creation=${encodeURIComponent(existing.id)}`,
            excerpt: existing.description || existing.title,
          });
        }
      }
    } else if (status === 'rejected' && existing.xp_awarded && Number(existing.xp_awarded_amount) > 0) {
      revokeXpWithRef({
        userId: existing.user_id,
        amount: Number(existing.xp_awarded_amount),
        source: 'xp_rollback',
        details: `Откат XP: отклонена публикация «${String(existing.title || '').slice(0, 35)}»`,
        referenceKey: `rollback:creation:${existing.id}`,
      });
      db.prepare('UPDATE creations SET xp_awarded = 0, xp_awarded_amount = 0 WHERE id = ?').run(existing.id);
    }
  })();

  res.json({ ok: true, status, category: nextCategory });
});

app.post('/api/creations/:id/react', requireAuth, (req: AuthRequest, res: Response) => {
  const rawType = req.body?.reaction_type;
  const reactionType: 'rose' | 'skull' = rawType === 'skull' ? 'skull' : 'rose';
  if (rawType !== undefined && rawType !== 'rose' && rawType !== 'skull') {
    res.status(400).json({ error: 'Поддерживаются только реакции «Роза» (rose) и «Череп» (skull).' });
    return;
  }

  const creationId = req.params.id;
  const target = db.prepare('SELECT id FROM creations WHERE id = ?').get(creationId);
  if (!target) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }

  let reacted = false;
  let nextType: 'rose' | 'skull' | null = null;

  db.transaction(() => {
    const existing = db.prepare(`
      SELECT id, reaction_type FROM reactions WHERE target_type = 'creation' AND target_id = ? AND user_id = ?
    `).get(creationId, req.user!.id) as any;

    if (existing) {
      if (existing.reaction_type === reactionType) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
        reacted = false;
        nextType = null;
      } else {
        db.prepare('UPDATE reactions SET reaction_type = ? WHERE id = ?').run(reactionType, existing.id);
        reacted = true;
        nextType = reactionType;
      }
    } else {
      db.prepare(`
        INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type)
        VALUES (?, ?, 'creation', ?, ?)
      `).run('rx_' + crypto.randomUUID().slice(0, 8), req.user!.id, creationId, reactionType);
      reacted = true;
      nextType = reactionType;
    }

    const roseTotal = (db.prepare(`
      SELECT COUNT(*) as c FROM reactions WHERE target_type = 'creation' AND target_id = ? AND reaction_type = 'rose'
    `).get(creationId) as any)?.c || 0;
    db.prepare('UPDATE creations SET likes_count = ? WHERE id = ?').run(roseTotal, creationId);
  })();

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN reaction_type = 'rose' THEN 1 ELSE 0 END) as rose_count,
      SUM(CASE WHEN reaction_type = 'skull' THEN 1 ELSE 0 END) as skull_count
    FROM reactions
    WHERE target_type = 'creation' AND target_id = ?
  `).get(creationId) as any;

  const roseCount = Number(counts?.rose_count || 0);
  const skullCount = Number(counts?.skull_count || 0);

  res.json({
    reacted,
    reaction_type: nextType,
    liked: nextType === 'rose',
    rose_count: roseCount,
    skull_count: skullCount,
    likes_count: roseCount,
  });
});

app.post('/api/creations/:id/favorite', requireAuth, (req: AuthRequest, res: Response) => {
  const creationId = req.params.id;
  const target = db.prepare('SELECT id FROM creations WHERE id = ?').get(creationId);
  if (!target) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }
  const existing = db.prepare(`
    SELECT id FROM favorites WHERE target_type = 'creation' AND target_id = ? AND user_id = ?
  `).get(creationId, req.user!.id) as any;

  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    res.json({ favorited: false });
  } else {
    db.prepare(`
      INSERT INTO favorites (id, user_id, target_type, target_id)
      VALUES (?, ?, 'creation', ?)
    `).run('fav_' + crypto.randomUUID().slice(0, 8), req.user!.id, creationId);
    res.json({ favorited: true });
  }
});

app.delete('/api/creations/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const creation = db
    .prepare('SELECT id, user_id, title, xp_awarded, xp_awarded_amount FROM creations WHERE id = ?')
    .get(req.params.id) as any;
  if (!creation) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }
  if (creation.user_id !== req.user!.id && req.user!.role_id !== 'admin' && req.user!.role_id !== 'moderator') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  db.transaction(() => {
    if (creation.xp_awarded && Number(creation.xp_awarded_amount) > 0) {
      revokeXpWithRef({
        userId: creation.user_id,
        amount: Number(creation.xp_awarded_amount),
        source: 'xp_rollback',
        details: `Откат XP: удаление работы «${String(creation.title || '').slice(0, 35)}»`,
        referenceKey: `rollback:creation:${creation.id}`,
      });
    }

    const creationComments = db
      .prepare('SELECT id, user_id, xp_awarded, xp_awarded_amount FROM comments WHERE creation_id = ?')
      .all(creation.id) as Array<{ id: string; user_id: string; xp_awarded: number; xp_awarded_amount: number }>;
    for (const cm of creationComments) {
      if (cm.xp_awarded && Number(cm.xp_awarded_amount) > 0) {
        revokeXpWithRef({
          userId: cm.user_id,
          amount: Number(cm.xp_awarded_amount),
          source: 'xp_rollback',
          details: 'Откат XP: удаление комментария',
          referenceKey: `rollback:comment:${cm.id}`,
        });
      }
    }

    db.prepare('DELETE FROM comments WHERE creation_id = ?').run(creation.id);
    db.prepare('DELETE FROM creations WHERE id = ?').run(creation.id);
  })();

  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// API: PROFILES & SOCIAL
// ----------------------------------------------------------------------------

app.get('/api/profiles/:nickname', (req: Request, res: Response) => {
  const currentUser = getSessionUser(req);
  const rawLookup = String(req.params.nickname || '').trim();
  const cleanLookup = normalizeUsername(rawLookup);

  const profile = db.prepare(`
    SELECT u.id, u.nickname, u.email, u.email_verified, u.role_id, u.is_banned, u.created_at as registered_at,
           p.display_name, p.avatar_url, p.bio, p.level, p.xp, p.total_xp, p.daily_streak, p.is_private,
           p.custom_status, p.favorite_track, p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge,
           p.equipped_title, p.equipped_theme, p.equipped_effect, p.featured_achievements_json, p.username_changed_at,
           p.privacy_settings, p.notify_follows, p.notify_news
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.nickname = ? COLLATE NOCASE OR u.nickname = ? COLLATE NOCASE
    LIMIT 1
  `).get(rawLookup, cleanLookup) as any;

  if (!profile) {
    res.status(404).json({ error: 'Профиль не найден.' });
    return;
  }

  const isOwnProfile = Boolean(currentUser && currentUser.id === profile.id);
  const privacySettings = parsePrivacySettings(profile.privacy_settings);
  const hiddenSections = {
    community: !isOwnProfile && privacySettings.hide_community,
    streak: !isOwnProfile && privacySettings.hide_streak,
    xp_history: !isOwnProfile && privacySettings.hide_xp_history,
    game_stats: !isOwnProfile && privacySettings.hide_game_stats,
  };

  // Detailed counts & game stats (including unique topics read)
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following_count,
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts_count,
      (SELECT COUNT(*) FROM creations WHERE user_id = ?) as creations_count,
      (SELECT COUNT(*) FROM comments WHERE user_id = ?) as comments_count,
      (SELECT COUNT(*) FROM post_reads WHERE user_id = ?) as posts_read_count,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ?) as games_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'guess-track') as guess_track_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'guess-track' AND score > 0) as guess_track_wins,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz') as quiz_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz' AND details_json IS NOT NULL AND json_valid(details_json) = 1 AND CAST(json_extract(details_json, '$.total') AS INTEGER) > 0 AND CAST(json_extract(details_json, '$.correctCount') AS INTEGER) >= CAST(json_extract(details_json, '$.total') AS INTEGER)) as quiz_perfect_runs,
      (SELECT COALESCE(MAX(score), 0) FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz') as quiz_best_score,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'guess-lyrics') as guess_lyrics_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'guess-lyrics' AND score > 0) as guess_lyrics_wins,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'reverse-track') as reverse_track_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'reverse-track' AND score > 0) as reverse_track_wins,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'speed-track') as speed_track_played,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ? AND game_id = 'speed-track' AND score > 0) as speed_track_wins
  `).get(
    profile.id, profile.id, profile.id, profile.id, profile.id, profile.id,
    profile.id, profile.id, profile.id, profile.id, profile.id, profile.id,
    profile.id, profile.id, profile.id, profile.id, profile.id, profile.id
  ) as any;

  // Is following?
  let isFollowing = false;
  if (currentUser && currentUser.id !== profile.id) {
    const f = db
      .prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(currentUser.id, profile.id);
    isFollowing = Boolean(f);
  }

  // Unlocked achievements
  const unlockedRows = db.prepare(`
    SELECT a.id, a.slug, a.title_ru, a.title_en, a.desc_ru, a.desc_en,
           a.condition_ru, a.condition_en, a.category, a.rarity, a.difficulty_tier, a.is_secret, a.xp_reward, a.icon, ua.unlocked_at
    FROM user_achievements ua
    JOIN achievements a ON a.id = ua.achievement_id
    WHERE ua.user_id = ?
    ORDER BY ua.unlocked_at DESC
  `).all(profile.id) as any[];

  const unlockedMap = new Map<string, string>();
  for (const row of unlockedRows) {
    unlockedMap.set(row.slug, row.unlocked_at);
  }

  const achMetrics = collectUserAchievementMetrics(profile.id);

  // Full achievements catalog (with difficulty tier, XP reward, server-computed progress, and masked secret hints)
  const allAchievementsCatalog = db.prepare(`
    SELECT id, slug, title_ru, title_en, desc_ru, desc_en, condition_ru, condition_en,
           category, rarity, difficulty_tier, is_secret, xp_reward, icon
    FROM achievements
    ORDER BY
      CASE difficulty_tier WHEN 'easy' THEN 1 WHEN 'hard' THEN 2 WHEN 'secret' THEN 3 ELSE 4 END,
      xp_reward ASC,
      title_ru ASC
  `).all() as any[];

  const allAchievements = allAchievementsCatalog.map((a) => {
    const isUnlocked = unlockedMap.has(a.slug);
    const isSecretLocked = Boolean(a.is_secret) && !isUnlocked;
    const progress = achMetrics
      ? getAchievementProgress(a.slug, achMetrics, isUnlocked)
      : { current: isUnlocked ? 1 : 0, target: 1 };

    return {
      ...a,
      is_secret: Boolean(a.is_secret),
      difficulty_tier: a.difficulty_tier || (a.is_secret ? 'secret' : 'easy'),
      xp_reward: Number(a.xp_reward || 0),
      desc_ru: isSecretLocked ? '???' : a.desc_ru,
      desc_en: isSecretLocked ? '???' : a.desc_en,
      condition_ru: isSecretLocked ? '???' : a.condition_ru,
      condition_en: isSecretLocked ? '???' : a.condition_en,
      progress: isSecretLocked ? { current: 0, target: 1 } : progress,
      is_unlocked: isUnlocked,
      unlocked_at: unlockedMap.get(a.slug) || null,
    };
  });

  // Featured showcase achievements (verified to be unlocked by this user)
  const savedFeatured = parseFeaturedAchievements(profile.featured_achievements_json);
  const validFeaturedSlugs = savedFeatured.filter((slug) => unlockedMap.has(slug));
  const featuredAchievements = validFeaturedSlugs.length > 0
    ? validFeaturedSlugs
        .map((slug) => allAchievements.find((a) => a.slug === slug))
        .filter(Boolean)
    : unlockedRows.slice(0, 3);

  // User's recent creations and posts (omitted server-side if community section is hidden from non-owner)
  const recentCreations = hiddenSections.community
    ? []
    : db.prepare(`
        SELECT * FROM creations WHERE user_id = ? AND (status = 'approved' OR user_id = ?) ORDER BY created_at DESC LIMIT 6
      `).all(profile.id, currentUser?.id || '');

  const recentPosts = hiddenSections.community
    ? []
    : db.prepare(`
        SELECT p.*, c.name_ru as category_name_ru, c.name_en as category_name_en
        FROM posts p
        JOIN post_categories c ON c.id = p.category_id
        WHERE p.user_id = ? AND (p.status = 'approved' OR p.user_id = ?)
        ORDER BY p.created_at DESC LIMIT 6
      `).all(profile.id, currentUser?.id || '');

  // User inventory (collection)
  const inventory = db.prepare(`
    SELECT ui.*, si.name_ru, si.name_en, si.description_ru, si.description_en, si.category, si.preview_value, si.rarity
    FROM user_inventory ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ?
    ORDER BY ui.is_equipped DESC, ui.purchased_at DESC
  `).all(profile.id);

  // User's favorite creations
  const favoriteCreations = hiddenSections.community
    ? []
    : db.prepare(`
        SELECT c.*, u.nickname as author_nickname, pr.display_name as author_name
        FROM favorites f
        JOIN creations c ON c.id = f.target_id
        JOIN users u ON u.id = c.user_id
        JOIN profiles pr ON pr.user_id = u.id
        WHERE f.user_id = ? AND f.target_type = 'creation' AND c.status = 'approved'
        ORDER BY f.created_at DESC
        LIMIT 12
      `).all(profile.id);

  // Privacy: never leak email, username cooldown, notification prefs, or hidden sections to other users
  const {
    email,
    email_verified,
    featured_achievements_json,
    username_changed_at,
    privacy_settings: _rawPrivacy,
    notify_follows: _rawNotifyFollows,
    notify_news: _rawNotifyNews,
    ...publicProfile
  } = profile;

  const usernameCooldown = isOwnProfile ? canChangeUsername(username_changed_at) : null;
  const resolvedTotalXp = Number(publicProfile.total_xp ?? publicProfile.xp ?? 0);
  const { level: computedProfileLevel } = calculateLevelFromXp(resolvedTotalXp);
  const streakDays = Number(publicProfile.daily_streak || 0);

  const safeCounts = {
    followers_count: Number(counts?.followers_count || 0),
    following_count: Number(counts?.following_count || 0),
    posts_count: hiddenSections.community ? null : Number(counts?.posts_count || 0),
    creations_count: hiddenSections.community ? null : Number(counts?.creations_count || 0),
    comments_count: hiddenSections.community ? null : Number(counts?.comments_count || 0),
    posts_read_count: hiddenSections.community ? null : Number(counts?.posts_read_count || 0),
    games_played: hiddenSections.game_stats ? null : Number(counts?.games_played || 0),
    guess_track_played: hiddenSections.game_stats ? null : Number(counts?.guess_track_played || 0),
    guess_track_wins: hiddenSections.game_stats ? null : Number(counts?.guess_track_wins || 0),
    quiz_played: hiddenSections.game_stats ? null : Number(counts?.quiz_played || 0),
    quiz_perfect_runs: hiddenSections.game_stats ? null : Number(counts?.quiz_perfect_runs || 0),
    quiz_best_score: hiddenSections.game_stats ? null : Number(counts?.quiz_best_score || 0),
    guess_lyrics_played: hiddenSections.game_stats ? null : Number(counts?.guess_lyrics_played || 0),
    guess_lyrics_wins: hiddenSections.game_stats ? null : Number(counts?.guess_lyrics_wins || 0),
    reverse_track_played: hiddenSections.game_stats ? null : Number(counts?.reverse_track_played || 0),
    reverse_track_wins: hiddenSections.game_stats ? null : Number(counts?.reverse_track_wins || 0),
    speed_track_played: hiddenSections.game_stats ? null : Number(counts?.speed_track_played || 0),
    speed_track_wins: hiddenSections.game_stats ? null : Number(counts?.speed_track_wins || 0),
  };

  // Resolve favorite track: explicit profile setting or most-listened track from user_track_plays
  let resolvedFavoriteTrack: string | null =
    publicProfile.favorite_track && String(publicProfile.favorite_track).trim()
      ? String(publicProfile.favorite_track).trim()
      : null;
  if (!resolvedFavoriteTrack) {
    try {
      const topPlay = db.prepare(`
        SELECT COALESCE(t.title, s.title) as title
        FROM user_track_plays utp
        LEFT JOIN tracks t ON t.id = utp.track_id
        LEFT JOIN singles s ON s.id = utp.track_id
        WHERE utp.user_id = ? AND COALESCE(t.title, s.title) IS NOT NULL
        ORDER BY utp.completions DESC, utp.updated_at DESC
        LIMIT 1
      `).get(profile.id) as { title?: string } | undefined;
      if (topPlay?.title) {
        resolvedFavoriteTrack = topPlay.title;
      }
    } catch {}
  }

  res.json({
    profile: {
      ...publicProfile,
      favorite_track: resolvedFavoriteTrack,
      daily_streak: hiddenSections.streak ? null : streakDays,
      streak_bonus_percent: hiddenSections.streak ? null : getStreakBonusPercent(streakDays),
      display_name: publicProfile.display_name && String(publicProfile.display_name).trim()
        ? publicProfile.display_name
        : publicProfile.nickname,
      total_xp: resolvedTotalXp,
      level: computedProfileLevel,
      hidden_sections: hiddenSections,
      ...(isOwnProfile
        ? {
            email: email || null,
            email_verified: Number(email_verified || 0),
            privacy_settings: privacySettings,
            notify_follows: Number(_rawNotifyFollows ?? 1),
            notify_news: Number(_rawNotifyNews ?? 0),
            username_change_allowed: usernameCooldown?.allowed ?? true,
            username_next_allowed_at: usernameCooldown?.nextAllowedAt ?? null,
            username_cooldown_days: usernameCooldown?.remainingDays ?? 0,
          }
        : {}),
      ...safeCounts,
      isFollowing,
      achievements: unlockedRows,
      allAchievements,
      featuredAchievements,
      featured_achievements: validFeaturedSlugs,
      recentCreations,
      recentPosts,
      favoriteCreations,
      inventory,
    },
  });
});

app.get('/api/profiles/:nickname/history', (req: Request, res: Response) => {
  const currentUser = getSessionUser(req);
  const rawLookup = String(req.params.nickname || '').trim();
  const cleanLookup = normalizeUsername(rawLookup);
  const user = db
    .prepare(`
      SELECT u.id, u.nickname, p.privacy_settings
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.nickname = ? COLLATE NOCASE OR u.nickname = ? COLLATE NOCASE
      LIMIT 1
    `)
    .get(rawLookup, cleanLookup) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const isOwnProfile = Boolean(currentUser && currentUser.id === user.id);
  const privacy = parsePrivacySettings(user.privacy_settings);

  // Enforce server-side privacy: XP History is hidden from non-owners by default
  if (!isOwnProfile && privacy.hide_xp_history) {
    res.json({
      hidden: true,
      nickname: user.nickname,
      xpTransactions: [],
      gameAttempts: [],
    });
    return;
  }

  const xpTransactions = db.prepare(`
    SELECT * FROM xp_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(user.id);

  const gameAttempts =
    !isOwnProfile && privacy.hide_game_stats
      ? []
      : db.prepare(`
          SELECT * FROM game_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 25
        `).all(user.id);

  res.json({
    hidden: false,
    nickname: user.nickname,
    xpTransactions,
    gameAttempts,
  });
});

app.post('/api/profiles/:nickname/follow', requireAuth, (req: AuthRequest, res: Response) => {
  const rawLookup = String(req.params.nickname || '').trim();
  const cleanLookup = normalizeUsername(rawLookup);
  const target = db
    .prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE OR nickname = ? COLLATE NOCASE')
    .get(rawLookup, cleanLookup) as any;
  if (!target) {
    res.status(404).json({ error: 'Target user not found' });
    return;
  }
  if (target.id === req.user!.id) {
    res.status(400).json({ error: 'Cannot follow yourself' });
    return;
  }

  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user!.id, target.id) as any;
  let following = false;
  let newlyUnlocked: UnlockedAchievementInfo[] = [];

  if (existing) {
    db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
    following = false;
  } else {
    db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').run(
      'flw_' + crypto.randomUUID().slice(0, 8),
      req.user!.id,
      target.id
    );
    following = true;
    newlyUnlocked = evaluateUserAchievements(req.user!.id);
    evaluateUserAchievements(target.id);
  }

  const followersCount = Number(
    (db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(target.id) as any)?.c || 0
  );

  res.json({
    following,
    followers_count: followersCount,
    ...(newlyUnlocked.length > 0 ? { newly_unlocked_achievements: newlyUnlocked } : {}),
  });
});

app.put('/api/profiles/me', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const {
    display_name,
    bio,
    avatar_url,
    is_private,
    custom_status,
    favorite_track,
    featured_achievements,
    username,
    privacy_settings,
    notify_follows,
    notify_news,
  } = req.body || {};

  let nextDisplayName: string | null = null;
  if (display_name !== undefined) {
    const check = validateDisplayName(String(display_name));
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }
    nextDisplayName = check.normalized;
  }

  if (avatar_url && !isSafeMediaUrl(String(avatar_url))) {
    res.status(400).json({ error: 'Некорректная ссылка на аватар.' });
    return;
  }

  let nextPrivacyJson: string | null = null;
  if (privacy_settings !== undefined) {
    if (!privacy_settings || typeof privacy_settings !== 'object' || Array.isArray(privacy_settings)) {
      res.status(400).json({ error: 'Некорректный формат настроек приватности.' });
      return;
    }
    const existingPrivacyRow = db
      .prepare('SELECT privacy_settings FROM profiles WHERE user_id = ?')
      .get(userId) as { privacy_settings?: string | null } | undefined;
    const mergedPrivacy = {
      ...parsePrivacySettings(existingPrivacyRow?.privacy_settings),
      ...privacy_settings,
    };
    nextPrivacyJson = JSON.stringify(parsePrivacySettings(mergedPrivacy));
  }

  let nextFeaturedJson: string | null = null;
  if (featured_achievements !== undefined) {
    if (!Array.isArray(featured_achievements)) {
      res.status(400).json({ error: 'featured_achievements must be an array.' });
      return;
    }
    // Verify user actually unlocked every selected showcase achievement
    const unlockedSlugs = new Set(
      (
        db
          .prepare(`
            SELECT a.slug FROM user_achievements ua
            JOIN achievements a ON a.id = ua.achievement_id
            WHERE ua.user_id = ?
          `)
          .all(userId) as any[]
      ).map((r) => r.slug)
    );
    const cleaned = featured_achievements
      .filter((s) => typeof s === 'string' && unlockedSlugs.has(s))
      .slice(0, MAX_FEATURED_ACHIEVEMENTS);
    nextFeaturedJson = JSON.stringify(Array.from(new Set(cleaned)));
  }

  // Optional controlled @username change with uniqueness + 14-day cooldown
  let changedUsername: string | null = null;
  if (username !== undefined && typeof username === 'string' && username.trim()) {
    const currentRow = db
      .prepare(`
        SELECT u.nickname, u.role_id, p.username_changed_at
        FROM users u
        JOIN profiles p ON p.user_id = u.id
        WHERE u.id = ?
      `)
      .get(userId) as any;

    const uCheck = validateUsername(username);
    if (!uCheck.valid) {
      res.status(400).json({ error: uCheck.error });
      return;
    }

    if (currentRow && uCheck.normalized !== String(currentRow.nickname).toLowerCase()) {
      const isMaster = String(currentRow.nickname).toLowerCase() === 'sushkanov097';
      if (isMaster) {
        res.status(403).json({ error: 'Главный @username администратора нельзя изменить.' });
        return;
      }

      const cooldown = canChangeUsername(currentRow.username_changed_at);
      if (!cooldown.allowed) {
        res.status(429).json({
          error: `Сменить @username можно раз в 14 дней. Осталось дней: ${cooldown.remainingDays}.`,
        });
        return;
      }

      const collision = db
        .prepare('SELECT id FROM users WHERE LOWER(TRIM(nickname)) = ? AND id != ?')
        .get(uCheck.normalized, userId);
      if (collision) {
        res.status(409).json({ error: 'Этот юзернейм уже занят' });
        return;
      }

      changedUsername = uCheck.normalized;
    }
  }

  const hasAvatarUpdate = avatar_url !== undefined;
  const resolvedAvatarUrl = hasAvatarUpdate
    ? (String(avatar_url || '').trim() || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg')
    : null;

  db.transaction(() => {
    if (changedUsername) {
      db.prepare("UPDATE users SET nickname = ?, updated_at = datetime('now') WHERE id = ?").run(
        changedUsername,
        userId
      );
      db.prepare("UPDATE profiles SET username_changed_at = datetime('now') WHERE user_id = ?").run(userId);
    }

    db.prepare(`
      UPDATE profiles SET
        display_name = COALESCE(?, display_name),
        bio = COALESCE(?, bio),
        avatar_url = CASE WHEN ? = 1 THEN ? ELSE avatar_url END,
        is_private = COALESCE(?, is_private),
        custom_status = COALESCE(?, custom_status),
        favorite_track = CASE WHEN ? = 1 THEN ? ELSE favorite_track END,
        featured_achievements_json = COALESCE(?, featured_achievements_json),
        privacy_settings = COALESCE(?, privacy_settings),
        notify_follows = COALESCE(?, notify_follows),
        notify_news = COALESCE(?, notify_news),
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      nextDisplayName,
      bio !== undefined ? String(bio).slice(0, 500) : null,
      hasAvatarUpdate ? 1 : 0,
      resolvedAvatarUrl,
      is_private !== undefined ? (is_private ? 1 : 0) : null,
      custom_status !== undefined ? String(custom_status).slice(0, 120) : null,
      favorite_track !== undefined ? 1 : 0,
      favorite_track !== undefined ? (String(favorite_track).trim().slice(0, 80) || null) : null,
      nextFeaturedJson,
      nextPrivacyJson,
      notify_follows !== undefined ? (notify_follows ? 1 : 0) : null,
      notify_news !== undefined ? (notify_news ? 1 : 0) : null,
      userId
    );
  })();

  const newlyUnlocked = evaluateUserAchievements(userId);

  let refreshedToken: string | undefined;
  if (changedUsername) {
    refreshedToken = issueSessionForUser(res, {
      id: userId,
      nickname: changedUsername,
      role_id: req.user!.role_id,
    });
  }

  res.json({
    ok: true,
    nickname: changedUsername || req.user!.nickname,
    ...(refreshedToken ? { token: refreshedToken } : {}),
    newly_unlocked_achievements: newlyUnlocked,
  });
});

// Admin Game Pool management (Automatic audio linking)
app.get('/api/admin/game-tracks', requireAdmin, (_req: Request, res: Response) => {
  const rawTracks = db.prepare(`
    SELECT t.id, t.title, t.duration_seconds, t.audio_url, t.snippet_start_seconds,
           t.snippet_duration_seconds, t.is_game_eligible,
           COALESCE(a.title, 'Single') as release_title,
           'track' as item_type
    FROM tracks t
    LEFT JOIN albums a ON a.id = t.album_id
    WHERE t.audio_url IS NOT NULL AND trim(t.audio_url) != ''
    UNION ALL
    SELECT s.id, s.title, s.duration_seconds, s.audio_url, 0 as snippet_start_seconds,
           15 as snippet_duration_seconds, s.is_game_eligible,
           'Single' as release_title,
           'single' as item_type
    FROM singles s
    WHERE s.audio_url IS NOT NULL AND trim(s.audio_url) != ''
      AND s.id NOT IN (SELECT single_id FROM tracks WHERE single_id IS NOT NULL)
    ORDER BY title ASC
  `).all() as any[];

  const tracks = rawTracks.filter((item) => localAudioExists(item.audio_url));
  res.json({ tracks });
});

app.post('/api/admin/game-tracks/:id/toggle', requireAdmin, (req: AuthRequest, res: Response) => {
  const { is_eligible } = req.body;
  const targetId = req.params.id;
  const val = is_eligible ? 1 : 0;

  const track = db.prepare('SELECT id FROM tracks WHERE id = ?').get(targetId);
  if (track) {
    db.prepare('UPDATE tracks SET is_game_eligible = ? WHERE id = ?').run(val, targetId);
    res.json({ ok: true, is_game_eligible: val });
    return;
  }

  const single = db.prepare('SELECT id FROM singles WHERE id = ?').get(targetId);
  if (single) {
    db.prepare('UPDATE singles SET is_game_eligible = ? WHERE id = ?').run(val, targetId);
    res.json({ ok: true, is_game_eligible: val });
    return;
  }

  res.status(404).json({ error: 'Audio item not found' });
});

// ----------------------------------------------------------------------------
// API: ADMINISTRATION & MODERATION
// ----------------------------------------------------------------------------

app.get('/api/admin/users', requireAdmin, (req: Request, res: Response) => {
  const rawSearch = String(req.query.search || '').trim();
  const cleanSearch = normalizeUsername(rawSearch);
  const likeParam = `%${rawSearch}%`;
  const cleanLike = `%${cleanSearch}%`;

  const sortParam = String(req.query.sort || 'registered_desc');
  const ORDER_BY_MAP: Record<string, string> = {
    registered_desc: 'u.created_at DESC',
    registered_asc: 'u.created_at ASC',
    xp_desc: 'COALESCE(p.total_xp, p.xp, 0) DESC, p.level DESC',
    level_desc: 'p.level DESC, COALESCE(p.total_xp, p.xp, 0) DESC',
    games_desc: 'games_played DESC, COALESCE(p.total_xp, p.xp, 0) DESC',
    active_desc: 'last_active_at DESC',
    username_asc: 'LOWER(u.nickname) ASC',
  };
  const orderClause = ORDER_BY_MAP[sortParam] || ORDER_BY_MAP.registered_desc;

  const baseSelect = `
    SELECT u.id, u.nickname, u.email, u.email_verified, u.role_id, u.is_banned, u.ban_reason,
           u.failed_login_attempts, u.locked_until, u.created_at as registered_at,
           p.display_name, p.avatar_url, p.level, p.xp, p.total_xp, p.daily_streak, p.last_active_date,
           MAX(
             COALESCE(p.updated_at, u.created_at),
             COALESCE((SELECT MAX(created_at) FROM game_attempts WHERE user_id = u.id), ''),
             COALESCE((SELECT MAX(created_at) FROM posts WHERE user_id = u.id), ''),
             COALESCE((SELECT MAX(created_at) FROM comments WHERE user_id = u.id), ''),
             COALESCE(u.updated_at, u.created_at)
           ) as last_active_at,
           (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as posts_count,
           (SELECT COUNT(*) FROM creations WHERE user_id = u.id) as creations_count,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id) as games_played,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'daily-quiz') as daily_quiz_played,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'guess-track') as guess_track_played,
           (SELECT COUNT(*) FROM user_achievements WHERE user_id = u.id) as achievements_count,
           (SELECT COUNT(*) FROM user_inventory WHERE user_id = u.id) as inventory_count
    FROM users u
    JOIN profiles p ON p.user_id = u.id
  `;

  const users = rawSearch
    ? db.prepare(`
        ${baseSelect}
        WHERE u.nickname LIKE ? COLLATE NOCASE
           OR u.nickname LIKE ? COLLATE NOCASE
           OR p.display_name LIKE ? COLLATE NOCASE
           OR COALESCE(u.email, '') LIKE ? COLLATE NOCASE
        ORDER BY ${orderClause}
      `).all(likeParam, cleanLike, likeParam, likeParam)
    : db.prepare(`
        ${baseSelect}
        ORDER BY ${orderClause}
      `).all();

  const summary = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM users WHERE datetime(created_at) >= datetime('now', '-24 hours')) as new_last_24h,
      (SELECT COUNT(*) FROM game_attempts) as total_games_played,
      (SELECT COUNT(*) FROM game_attempts WHERE game_id = 'daily-quiz') as total_quizzes_played,
      (SELECT COUNT(*) FROM game_attempts WHERE game_id = 'guess-track') as total_guess_track_played
  `).get();

  res.json({ users, summary, sort: sortParam });
});

app.get('/api/admin/users/:id/details', requireAdmin, (req: Request, res: Response) => {
  const userId = req.params.id;
  const target = db.prepare(`
    SELECT u.id, u.nickname, u.email, u.email_verified, u.accepted_rules, u.role_id, u.is_banned, u.ban_reason,
           u.failed_login_attempts, u.locked_until, u.created_at as registered_at,
           p.display_name, p.avatar_url, p.bio, p.custom_status, p.favorite_track,
           p.level, p.xp, p.total_xp, p.daily_streak, p.is_private,
           p.privacy_settings, p.notify_follows, p.notify_news,
           p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge,
           p.equipped_title, p.equipped_theme, p.equipped_effect,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id) as games_played,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'guess-track' AND score > 0) as guess_track_wins,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'daily-quiz') as quiz_played,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'guess-lyrics' AND score > 0) as guess_lyrics_wins,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'reverse-track' AND score > 0) as reverse_track_wins,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id AND game_id = 'speed-track' AND score > 0) as speed_track_wins,
           (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as posts_count,
           (SELECT COUNT(*) FROM creations WHERE user_id = u.id) as creations_count
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `).get(userId) as any;

  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  target.privacy_settings = parsePrivacySettings(target.privacy_settings);
  target.email_verified = Number(target.email_verified || 0);
  target.accepted_rules = Number(target.accepted_rules || 0);
  target.notify_follows = target.notify_follows === 0 ? 0 : 1;
  target.notify_news = Number(target.notify_news || 0);
  target.is_private = Number(target.is_private || 0);

  const unlockedAchIds = new Set(
    (db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').all(userId) as any[]).map(
      (r) => r.achievement_id
    )
  );
  const achievements = (
    db.prepare(`
      SELECT id, slug, title_ru, title_en, desc_ru, desc_en, condition_ru, condition_en,
             category, rarity, difficulty_tier, is_secret, xp_reward, icon
      FROM achievements
      ORDER BY is_secret ASC, category ASC, xp_reward ASC
    `).all() as any[]
  ).map((a) => ({
    ...a,
    is_secret: Boolean(a.is_secret),
    xp_reward: Number(a.xp_reward || 0),
    is_unlocked: unlockedAchIds.has(a.id),
  }));

  const ownedItemsMap = new Map<string, boolean>();
  for (const row of db.prepare('SELECT item_id, is_equipped FROM user_inventory WHERE user_id = ?').all(userId) as any[]) {
    ownedItemsMap.set(row.item_id, Boolean(row.is_equipped));
  }
  const items = (
    db.prepare(`
      SELECT id, name_ru, name_en, description_ru, description_en, category, cost_xp, rarity, preview_value, is_active
      FROM shop_items
      WHERE is_active = 1 OR id IN (SELECT item_id FROM user_inventory WHERE user_id = ?)
      ORDER BY category ASC, cost_xp ASC, name_ru ASC
    `).all(userId) as any[]
  ).map((it) => ({
    ...it,
    is_owned: ownedItemsMap.has(it.id),
    is_equipped: ownedItemsMap.get(it.id) || false,
  }));

  const { cycleId } = getMoscow12hCycle();
  const cycle_completions = db.prepare(`
    SELECT game_type, is_correct, score, xp_earned, created_at
    FROM game_completions
    WHERE user_id = ? AND cycle_id = ?
    ORDER BY created_at DESC
  `).all(userId, cycleId);

  res.json({ user: target, achievements, items, cycle_id: cycleId, cycle_completions });
});

app.put('/api/admin/users/:id/full', requireAdmin, (req: AuthRequest, res: Response) => {
  const adminId = req.user!.id;
  const targetId = req.params.id;
  const current = db.prepare(`
    SELECT u.*, p.display_name, p.bio, p.custom_status, p.avatar_url, p.favorite_track,
           p.level, p.xp, p.total_xp, p.daily_streak, p.is_private, p.privacy_settings,
           p.notify_follows, p.notify_news
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `).get(targetId) as any;

  if (!current) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  const isTargetMaster =
    String(current.nickname || '').toLowerCase() === 'sushkanov097' ||
    String(current.email || '').toLowerCase() === 'sushkanov097@gmail.com';

  const body = req.body || {};
  let nextNickname = String(current.nickname);
  let nicknameChanged = false;
  if (typeof body.nickname === 'string' && body.nickname.trim()) {
    const uCheck = validateUsername(body.nickname);
    if (!uCheck.valid) {
      res.status(400).json({ error: uCheck.error });
      return;
    }
    if (uCheck.normalized !== String(current.nickname).toLowerCase()) {
      if (isTargetMaster) {
        res.status(403).json({ error: 'Юзернейм главного администратора @sushkanov097 менять нельзя.' });
        return;
      }
      const collision = db
        .prepare('SELECT id FROM users WHERE LOWER(TRIM(nickname)) = ? AND id != ?')
        .get(uCheck.normalized, targetId);
      if (collision) {
        res.status(409).json({ error: 'Этот @username уже занят другим участником.' });
        return;
      }
      nextNickname = uCheck.normalized;
      nicknameChanged = true;
    }
  }

  let nextEmail: string | null = current.email ?? null;
  if (body.email !== undefined) {
    const rawEmail = String(body.email || '').trim().toLowerCase();
    if (!rawEmail) {
      nextEmail = null;
    } else {
      const eCheck = validateEmail(rawEmail);
      if (!eCheck.valid) {
        res.status(400).json({ error: eCheck.error });
        return;
      }
      const emailClash = db
        .prepare('SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND id != ?')
        .get(eCheck.normalized, targetId);
      if (emailClash) {
        res.status(409).json({ error: 'Этот email уже привязан к другому аккаунту.' });
        return;
      }
      nextEmail = eCheck.normalized;
    }
  }

  let nextRole = String(current.role_id || 'user');
  if (body.role_id !== undefined) {
    if (!['user', 'moderator', 'admin'].includes(body.role_id)) {
      res.status(400).json({ error: 'Недопустимая роль пользователя.' });
      return;
    }
    if (isTargetMaster && body.role_id !== 'admin') {
      res.status(403).json({ error: 'Роль главного администратора нельзя понизить.' });
      return;
    }
    if (targetId === adminId && body.role_id !== 'admin') {
      res.status(400).json({ error: 'Вы не можете понизить роль собственного аккаунта.' });
      return;
    }
    nextRole = body.role_id;
  }

  let nextBanned = Number(current.is_banned || 0);
  if (body.is_banned !== undefined) {
    const wantBan = body.is_banned ? 1 : 0;
    if (wantBan && targetId === adminId) {
      res.status(400).json({ error: 'Нельзя заблокировать собственный аккаунт.' });
      return;
    }
    if (wantBan && isTargetMaster) {
      res.status(403).json({ error: 'Главного администратора нельзя заблокировать.' });
      return;
    }
    nextBanned = wantBan;
  }

  let nextDisplayName = String(current.display_name || current.nickname);
  if (body.display_name !== undefined) {
    const dCheck = validateDisplayName(String(body.display_name || ''));
    if (!dCheck.valid) {
      res.status(400).json({ error: dCheck.error });
      return;
    }
    nextDisplayName = dCheck.normalized;
  }

  let nextAvatar = current.avatar_url;
  if (body.avatar_url !== undefined) {
    const av = String(body.avatar_url || '').trim();
    if (!av) {
      nextAvatar = '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg';
    } else if (!isSafeMediaUrl(av)) {
      res.status(400).json({ error: 'Некорректная ссылка на аватар.' });
      return;
    } else {
      nextAvatar = av;
    }
  }

  let nextPasswordHash: string | null = null;
  if (typeof body.new_password === 'string' && body.new_password.trim()) {
    if (isTargetMaster && targetId !== adminId) {
      res.status(403).json({ error: 'Пароль главного администратора нельзя сменить с другого аккаунта.' });
      return;
    }
    const pCheck = validateRegistrationPassword(body.new_password);
    if (!pCheck.valid) {
      res.status(400).json({ error: pCheck.error });
      return;
    }
    nextPasswordHash = bcrypt.hashSync(body.new_password, 12);
  }

  const nextEmailVerified = body.email_verified !== undefined ? (body.email_verified ? 1 : 0) : Number(current.email_verified || 0);
  const nextAcceptedRules = body.accepted_rules !== undefined ? (body.accepted_rules ? 1 : 0) : Number(current.accepted_rules || 0);
  const nextBio = body.bio !== undefined ? String(body.bio || '').slice(0, 500) : current.bio;
  const nextCustomStatus = body.custom_status !== undefined ? String(body.custom_status || '').slice(0, 120) : current.custom_status;
  const nextFavTrack =
    body.favorite_track !== undefined ? (String(body.favorite_track || '').trim().slice(0, 80) || null) : current.favorite_track;
  const nextBanReason =
    body.ban_reason !== undefined ? String(body.ban_reason || '').trim().slice(0, 300) : current.ban_reason;
  const nextIsPrivate = body.is_private !== undefined ? (body.is_private ? 1 : 0) : Number(current.is_private || 0);
  const nextNotifyFollows = body.notify_follows !== undefined ? (body.notify_follows ? 1 : 0) : Number(current.notify_follows ?? 1);
  const nextNotifyNews = body.notify_news !== undefined ? (body.notify_news ? 1 : 0) : Number(current.notify_news || 0);
  const nextPrivacyJson =
    body.privacy_settings !== undefined
      ? JSON.stringify(parsePrivacySettings(body.privacy_settings))
      : current.privacy_settings;

  const nextTotalXp =
    body.total_xp !== undefined ? Math.max(0, Math.floor(Number(body.total_xp) || 0)) : Number(current.total_xp ?? current.xp ?? 0);
  const nextXp = body.xp !== undefined ? Math.max(0, Math.floor(Number(body.xp) || 0)) : Number(current.xp || 0);
  const autoRecalc = body.auto_recalc_level !== false;
  const nextLevel = autoRecalc
    ? calculateLevelFromXp(nextTotalXp).level
    : Math.max(1, Math.min(100, Math.floor(Number(body.level ?? current.level) || 1)));
  const nextStreak =
    body.daily_streak !== undefined ? Math.max(0, Math.floor(Number(body.daily_streak) || 0)) : Number(current.daily_streak || 0);

  const nowIso = new Date().toISOString();
  const xpDelta = nextTotalXp - Number(current.total_xp ?? current.xp ?? 0);

  db.transaction(() => {
    db.prepare(`
      UPDATE users SET
        nickname = ?,
        email = ?,
        email_verified = ?,
        accepted_rules = ?,
        role_id = ?,
        is_banned = ?,
        ban_reason = ?,
        password_hash = COALESCE(?, password_hash),
        password_changed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE password_changed_at END,
        failed_login_attempts = CASE WHEN ? IS NOT NULL THEN 0 ELSE failed_login_attempts END,
        locked_until = CASE WHEN ? IS NOT NULL THEN NULL ELSE locked_until END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      nextNickname,
      nextEmail,
      nextEmailVerified,
      nextAcceptedRules,
      nextRole,
      nextBanned,
      nextBanReason,
      nextPasswordHash,
      nextPasswordHash,
      nowIso,
      nextPasswordHash,
      nextPasswordHash,
      targetId
    );

    if (nextPasswordHash || nextBanned) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
    }

    db.prepare(`
      UPDATE profiles SET
        display_name = ?,
        avatar_url = ?,
        bio = ?,
        custom_status = ?,
        favorite_track = ?,
        is_private = ?,
        privacy_settings = ?,
        notify_follows = ?,
        notify_news = ?,
        total_xp = ?,
        xp = ?,
        level = ?,
        daily_streak = ?,
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      nextDisplayName,
      nextAvatar,
      nextBio,
      nextCustomStatus,
      nextFavTrack,
      nextIsPrivate,
      nextPrivacyJson,
      nextNotifyFollows,
      nextNotifyNews,
      nextTotalXp,
      nextXp,
      nextLevel,
      nextStreak,
      targetId
    );

    if (xpDelta !== 0) {
      db.prepare(`
        INSERT INTO xp_transactions (id, user_id, amount, source, details)
        VALUES (?, ?, ?, 'admin_adjust', ?)
      `).run(
        'xpt_' + crypto.randomUUID().slice(0, 8),
        targetId,
        xpDelta,
        `Администратор скорректировал XP (${current.total_xp ?? current.xp ?? 0} → ${nextTotalXp})`
      );
    }

    db.prepare(`
      INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
      VALUES (?, ?, ?, 'admin_user_edit', ?)
    `).run(
      'mod_' + crypto.randomUUID().slice(0, 8),
      adminId,
      targetId,
      `Updated user @${nextNickname} (role=${nextRole}, total_xp=${nextTotalXp}, xp=${nextXp}, streak=${nextStreak})`
    );
  })();

  let refreshedToken: string | undefined;
  if (targetId === adminId && (nicknameChanged || nextRole !== current.role_id)) {
    refreshedToken = issueSessionForUser(res, {
      id: targetId,
      nickname: nextNickname,
      role_id: nextRole,
    });
  }

  res.json({ ok: true, nickname: nextNickname, role_id: nextRole, ...(refreshedToken ? { token: refreshedToken } : {}) });
});

app.post('/api/admin/users/:id/reset-cycle', requireAdmin, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const target = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  const { cycleId } = getMoscow12hCycle();
  const dateOnly = cycleId.slice(0, 10);
  let cleared = 0;

  db.transaction(() => {
    const r1 = db.prepare('DELETE FROM game_completions WHERE user_id = ? AND cycle_id = ?').run(targetId, cycleId);
    const r2 = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ? AND challenge_date IN (?, ?)').run(targetId, cycleId, dateOnly);
    const r3 = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ? AND challenge_date IN (?, ?)').run(targetId, cycleId, dateOnly);
    const r4 = db.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ? AND cycle_id = ?').run(targetId, cycleId);
    cleared = Number(r1.changes || 0) + Number(r2.changes || 0) + Number(r3.changes || 0) + Number(r4.changes || 0);

    db.prepare(`
      INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
      VALUES (?, ?, ?, 'reset_game_cycle', ?)
    `).run(
      'mod_' + crypto.randomUUID().slice(0, 8),
      req.user!.id,
      targetId,
      `Reset current cycle (${cycleId}) locks for @${target.nickname} (rows=${cleared})`
    );
  })();

  res.json({ ok: true, cycle_id: cycleId, cleared });
});

app.post('/api/admin/users/:id/equip', requireAdmin, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const { item_id, category, equip } = req.body || {};

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  if (item_id) {
    const item = db.prepare('SELECT id, category, preview_value FROM shop_items WHERE id = ?').get(item_id) as any;
    if (!item) {
      res.status(404).json({ error: 'Предмет не найден.' });
      return;
    }
    const column = SHOP_CATEGORY_COLUMN_MAP[item.category];
    const shouldEquip = equip !== false;

    db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO user_inventory (id, user_id, item_id, is_equipped)
        VALUES (?, ?, ?, 0)
      `).run('inv_' + crypto.randomUUID().slice(0, 8), targetId, item.id);

      if (shouldEquip) {
        db.prepare(`
          UPDATE user_inventory SET is_equipped = 0
          WHERE user_id = ? AND item_id IN (SELECT id FROM shop_items WHERE category = ?)
        `).run(targetId, item.category);
        db.prepare('UPDATE user_inventory SET is_equipped = 1 WHERE user_id = ? AND item_id = ?').run(targetId, item.id);
        if (column) {
          db.prepare(`UPDATE profiles SET ${column} = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
            item.preview_value,
            targetId
          );
        }
      } else {
        db.prepare('UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND item_id = ?').run(targetId, item.id);
        if (column) {
          db.prepare(`UPDATE profiles SET ${column} = NULL, updated_at = datetime('now') WHERE user_id = ?`).run(targetId);
        }
      }
    })();

    res.json({ ok: true, item_id: item.id, is_equipped: shouldEquip });
    return;
  }

  if (typeof category === 'string' && SHOP_CATEGORY_COLUMN_MAP[category]) {
    const column = SHOP_CATEGORY_COLUMN_MAP[category];
    db.transaction(() => {
      db.prepare(`
        UPDATE user_inventory SET is_equipped = 0
        WHERE user_id = ? AND item_id IN (SELECT id FROM shop_items WHERE category = ?)
      `).run(targetId, category);
      db.prepare(`UPDATE profiles SET ${column} = NULL, updated_at = datetime('now') WHERE user_id = ?`).run(targetId);
    })();
    res.json({ ok: true, category, is_equipped: false });
    return;
  }

  res.status(400).json({ error: 'Укажите item_id или category.' });
});

app.post('/api/admin/users/:id/custom-shield', requireAdmin, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const target = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(targetId) as any;
  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  const labelRu = String(req.body?.label_ru || '').replace(/\s+/g, ' ').trim().slice(0, 32);
  const labelEn = String(req.body?.label_en || labelRu).replace(/\s+/g, ' ').trim().slice(0, 32);
  if (!labelRu) {
    res.status(400).json({ error: 'Укажите текст шилда.' });
    return;
  }

  const allowedRarities = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
  const rarity = allowedRarities.has(req.body?.rarity) ? req.body.rarity : 'legendary';
  const addToShop = Boolean(req.body?.add_to_shop);
  const costXp = addToShop ? Math.max(0, Math.floor(Number(req.body?.cost_xp) || 0)) : 0;

  const previewValue = buildCustomShieldValue({
    ru: labelRu,
    en: labelEn || labelRu,
    bg: req.body?.bg,
    border: req.body?.border,
    text: req.body?.text,
    glow: req.body?.glow,
  });

  const itemId = 'item_cshield_' + crypto.randomUUID().slice(0, 8);
  const descRu = addToShop
    ? `Авторский шилд «${labelRu}».`
    : `Персональный уникальный шилд для @${target.nickname}.`;
  const descEn = addToShop
    ? `Custom shield "${labelEn || labelRu}".`
    : `Exclusive custom shield for @${target.nickname}.`;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO shop_items (id, name_ru, name_en, description_ru, description_en, category, cost_xp, rarity, preview_value, is_active)
      VALUES (?, ?, ?, ?, ?, 'title', ?, ?, ?, ?)
    `).run(
      itemId,
      `Шилд «${labelRu}»`,
      `Shield "${labelEn || labelRu}"`,
      descRu,
      descEn,
      costXp,
      rarity,
      previewValue,
      addToShop ? 1 : 0
    );

    db.prepare(`
      UPDATE user_inventory SET is_equipped = 0
      WHERE user_id = ? AND item_id IN (SELECT id FROM shop_items WHERE category = 'title')
    `).run(targetId);

    db.prepare(`
      INSERT INTO user_inventory (id, user_id, item_id, is_equipped)
      VALUES (?, ?, ?, 1)
    `).run('inv_' + crypto.randomUUID().slice(0, 8), targetId, itemId);

    db.prepare(`
      UPDATE profiles SET equipped_title = ?, updated_at = datetime('now') WHERE user_id = ?
    `).run(previewValue, targetId);
  })();

  res.json({ ok: true, item_id: itemId, preview_value: previewValue });
});

app.post('/api/admin/users/reset', requireAdmin, (req: AuthRequest, res: Response) => {
  const mode = req.body?.mode === 'bulk' ? 'bulk' : 'single';
  const targetUserId = typeof req.body?.target_user_id === 'string' ? req.body.target_user_id.trim() : '';
  const skipAdmins = req.body?.skip_admins !== false;
  const confirmText = String(req.body?.confirm_text || '').trim();
  const scopesRaw = req.body?.scopes || {};
  const scopes = {
    xp: Boolean(scopesRaw.xp),
    achievements: Boolean(scopesRaw.achievements),
    cosmetics: Boolean(scopesRaw.cosmetics),
    games: Boolean(scopesRaw.games),
  };

  if (!scopes.xp && !scopes.achievements && !scopes.cosmetics && !scopes.games) {
    res.status(400).json({ error: 'Выберите хотя бы одну категорию данных для сброса.' });
    return;
  }

  let targetIds: string[] = [];
  if (mode === 'single') {
    if (!targetUserId) {
      res.status(400).json({ error: 'Выберите пользователя для сброса.' });
      return;
    }
    const row = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as { id: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Пользователь не найден.' });
      return;
    }
    targetIds = [row.id];
  } else {
    if (confirmText !== 'СБРОСИТЬ') {
      res.status(400).json({ error: 'Для массового сброса введите точное слово СБРОСИТЬ.' });
      return;
    }
    const rows = skipAdmins
      ? (db.prepare("SELECT id FROM users WHERE role_id != 'admin'").all() as Array<{ id: string }>)
      : (db.prepare('SELECT id FROM users').all() as Array<{ id: string }>);
    targetIds = rows.map((r) => r.id);
  }

  if (targetIds.length === 0) {
    res.json({ ok: true, affected_users: 0, scopes });
    return;
  }

  db.transaction(() => {
    for (const uid of targetIds) {
      if (scopes.xp) {
        db.prepare(`
          UPDATE profiles SET total_xp = 0, xp = 0, level = 1, updated_at = datetime('now') WHERE user_id = ?
        `).run(uid);
        db.prepare('DELETE FROM xp_transactions WHERE user_id = ?').run(uid);
      }

      if (scopes.achievements) {
        db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(uid);
        db.prepare("UPDATE profiles SET featured_achievements_json = '[]', updated_at = datetime('now') WHERE user_id = ?").run(uid);
        db.prepare('DELETE FROM user_track_plays WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM post_reads WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM user_secret_flags WHERE user_id = ?').run(uid);
      }

      if (scopes.cosmetics) {
        db.prepare('DELETE FROM user_inventory WHERE user_id = ?').run(uid);
        db.prepare(`
          UPDATE profiles SET
            equipped_frame = NULL,
            equipped_banner = NULL,
            equipped_name_style = NULL,
            equipped_badge = NULL,
            equipped_title = NULL,
            equipped_theme = NULL,
            equipped_effect = NULL,
            updated_at = datetime('now')
          WHERE user_id = ?
        `).run(uid);
      }

      if (scopes.games) {
        db.prepare("UPDATE profiles SET daily_streak = 0, last_active_date = NULL, updated_at = datetime('now') WHERE user_id = ?").run(uid);
        db.prepare('DELETE FROM game_attempts WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM game_completions WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ?').run(uid);
      }
    }

    db.prepare(`
      INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
      VALUES (?, ?, ?, 'user_reset', ?)
    `).run(
      'mod_' + crypto.randomUUID().slice(0, 8),
      req.user!.id,
      mode === 'single' ? targetIds[0] : null,
      `mode=${mode} skip_admins=${skipAdmins} affected=${targetIds.length} scopes=${JSON.stringify(scopes)}`
    );
  })();

  res.json({ ok: true, mode, affected_users: targetIds.length, scopes });
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, (req: AuthRequest, res: Response) => {
  const adminId = req.user!.id;
  const targetId = req.params.id;
  const { new_password } = req.body || {};

  const passCheck = validateRegistrationPassword(String(new_password || ''));
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }

  const targetUser = db.prepare('SELECT id, nickname, email, role_id FROM users WHERE id = ?').get(targetId) as any;
  if (!targetUser) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  const isTargetMaster =
    String(targetUser.nickname || '').toLowerCase() === 'sushkanov097' ||
    String(targetUser.email || '').toLowerCase() === 'sushkanov097@gmail.com';
  if (isTargetMaster && targetUser.id !== adminId) {
    res.status(403).json({ error: 'Пароль главного администратора нельзя сбросить из другого аккаунта.' });
    return;
  }

  const nextHash = bcrypt.hashSync(String(new_password), 12);
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          failed_login_attempts = 0,
          locked_until = NULL,
          password_changed_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(nextHash, nowIso, targetId);

    // Revoke all active sessions for the target user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);

    // Audit log (never stores plaintext password!)
    db.prepare(`
      INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
      VALUES (?, ?, ?, 'password_reset', ?)
    `).run(
      'mod_' + crypto.randomUUID().slice(0, 8),
      adminId,
      targetId,
      `Admin password reset for @${targetUser.nickname}`
    );
  })();

  res.json({
    ok: true,
    message: `Новый пароль для @${targetUser.nickname} установлен. Предыдущие сессии завершены.`,
  });
});

app.post('/api/admin/users/:id/achievements', requireAdmin, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const { achievement_id, action, adjust_xp } = req.body || {};
  if (!achievement_id || (action !== 'grant' && action !== 'revoke')) {
    res.status(400).json({ error: 'Specify achievement_id and action (grant | revoke).' });
    return;
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  const ach = db.prepare('SELECT id, slug, title_ru, xp_reward FROM achievements WHERE id = ?').get(achievement_id) as any;
  if (!target || !ach) {
    res.status(404).json({ error: 'Пользователь или достижение не найдены.' });
    return;
  }

  const shouldAdjustXp = adjust_xp !== false;
  const reward = Number(ach.xp_reward || 0);
  let xpChanged = 0;

  db.transaction(() => {
    if (action === 'grant') {
      const insertRes = db.prepare(`
        INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id)
        VALUES (?, ?, ?)
      `).run('uach_' + crypto.randomUUID().slice(0, 8), targetId, ach.id);

      if (insertRes.changes > 0 && shouldAdjustXp && reward > 0) {
        const resGrant = awardXpWithRef({
          userId: targetId,
          amount: reward,
          source: 'achievement',
          details: `Достижение (адм.): ${ach.title_ru}`,
          referenceKey: `admin_ach_grant:${targetId}:${ach.id}:${crypto.randomUUID().slice(0, 8)}`,
        });
        xpChanged = resGrant.amount;
      }
    } else {
      const delRes = db
        .prepare('DELETE FROM user_achievements WHERE user_id = ? AND achievement_id = ?')
        .run(targetId, ach.id);

      if (delRes.changes > 0 && shouldAdjustXp && reward > 0) {
        const resRevoke = revokeXpWithRef({
          userId: targetId,
          amount: reward,
          source: 'xp_rollback',
          details: `Откат достижения: ${ach.title_ru}`,
          referenceKey: `admin_ach_revoke:${targetId}:${ach.id}:${crypto.randomUUID().slice(0, 8)}`,
        });
        xpChanged = -resRevoke.amount;
      }

      // Allow natural re-earning and clean featured showcase & secret progress flags
      db.prepare('DELETE FROM xp_transactions WHERE user_id = ? AND reference_key = ?').run(
        targetId,
        `ach:${targetId}:${ach.slug}`
      );
      if (ach.slug === 'secret_on_repeat') {
        db.prepare('DELETE FROM user_track_plays WHERE user_id = ?').run(targetId);
      } else if (ach.slug === 'secret_rose_hunter') {
        db.prepare("DELETE FROM user_secret_flags WHERE user_id = ? AND flag_key = 'curious_rose'").run(targetId);
      } else if (ach.slug === 'secret_scribe') {
        db.prepare('DELETE FROM post_reads WHERE user_id = ?').run(targetId);
      } else if (ach.slug === 'secret_midnight_apostle') {
        db.prepare("DELETE FROM user_secret_flags WHERE user_id = ? AND flag_key = 'midnight_visit'").run(targetId);
      }

      const profRow = db.prepare('SELECT featured_achievements_json FROM profiles WHERE user_id = ?').get(targetId) as
        | { featured_achievements_json?: string | null }
        | undefined;
      if (profRow?.featured_achievements_json) {
        const cleaned = parseFeaturedAchievements(profRow.featured_achievements_json).filter((s) => s !== ach.slug);
        db.prepare('UPDATE profiles SET featured_achievements_json = ? WHERE user_id = ?').run(
          JSON.stringify(cleaned),
          targetId
        );
      }
    }
  })();

  res.json({ ok: true, action, achievement_id: ach.id, xp_changed: xpChanged });
});

app.post('/api/admin/users/:id/items', requireAdmin, (req: AuthRequest, res: Response) => {
  const targetId = req.params.id;
  const { item_id, action } = req.body || {};
  if (!item_id || (action !== 'grant' && action !== 'revoke')) {
    res.status(400).json({ error: 'Specify item_id and action (grant | revoke).' });
    return;
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  const item = db.prepare('SELECT id, category, preview_value FROM shop_items WHERE id = ?').get(item_id) as any;
  if (!target || !item) {
    res.status(404).json({ error: 'Пользователь или предмет не найдены.' });
    return;
  }

  if (action === 'grant') {
    db.prepare(`
      INSERT OR IGNORE INTO user_inventory (id, user_id, item_id, is_equipped)
      VALUES (?, ?, ?, 0)
    `).run('inv_' + crypto.randomUUID().slice(0, 8), targetId, item.id);
  } else {
    db.transaction(() => {
      const existing = db
        .prepare('SELECT is_equipped FROM user_inventory WHERE user_id = ? AND item_id = ?')
        .get(targetId, item.id) as any;
      db.prepare('DELETE FROM user_inventory WHERE user_id = ? AND item_id = ?').run(targetId, item.id);
      if (existing?.is_equipped) {
        const col = SHOP_CATEGORY_COLUMN_MAP[item.category];
        if (col) {
          db.prepare(`UPDATE profiles SET ${col} = NULL WHERE user_id = ?`).run(targetId);
        }
      }
    })();
  }

  res.json({ ok: true, action, item_id: item.id });
});

app.post('/api/admin/users/:id/ban', requireAdmin, (req: AuthRequest, res: Response) => {
  const { is_banned, ban_reason } = req.body || {};
  const targetUser = db.prepare('SELECT id, nickname, email, role_id FROM users WHERE id = ?').get(req.params.id) as any;
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const isTargetMaster =
    String(targetUser.nickname || '').toLowerCase() === 'sushkanov097' ||
    String(targetUser.email || '').toLowerCase() === 'sushkanov097@gmail.com';
  if (targetUser.id === req.user!.id) {
    res.status(400).json({ error: 'You cannot ban your own account.' });
    return;
  }
  if (isTargetMaster) {
    res.status(403).json({ error: 'Master administrator account cannot be banned.' });
    return;
  }
  if (req.user!.role_id !== 'admin' && (targetUser.role_id === 'admin' || targetUser.role_id === 'moderator')) {
    res.status(403).json({ error: 'Moderators cannot ban administrators or other moderators.' });
    return;
  }

  db.prepare(`
    UPDATE users SET is_banned = ?, ban_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    is_banned ? 1 : 0,
    typeof ban_reason === 'string' && ban_reason.trim() ? ban_reason.trim() : 'Sanctuary rules violation',
    req.params.id
  );

  // If banned, invalidate sessions immediately
  if (is_banned) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  }

  res.json({ ok: true });
});

app.post('/api/admin/users/:id/role', requireAdmin, (req: AuthRequest, res: Response) => {
  const { role_id } = req.body || {};
  if (!['user', 'moderator', 'admin'].includes(role_id)) {
    res.status(400).json({ error: 'Invalid role' });
    return;
  }
  const targetUser = db.prepare('SELECT id, nickname, email FROM users WHERE id = ?').get(req.params.id) as any;
  if (!targetUser) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const isTargetMaster =
    String(targetUser.nickname || '').toLowerCase() === 'sushkanov097' ||
    String(targetUser.email || '').toLowerCase() === 'sushkanov097@gmail.com';
  if (isTargetMaster && role_id !== 'admin') {
    res.status(403).json({ error: 'Master administrator role cannot be downgraded.' });
    return;
  }
  if (targetUser.id === req.user!.id && role_id !== 'admin') {
    res.status(400).json({ error: 'You cannot demote your own administrator account.' });
    return;
  }
  db.prepare("UPDATE users SET role_id = ?, updated_at = datetime('now') WHERE id = ?").run(role_id, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/stats', requireAdmin, (_req: Request, res: Response) => {
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM tracks) as total_tracks,
      (SELECT COUNT(*) FROM albums) as total_albums,
      (SELECT COUNT(*) FROM posts) as total_posts,
      (SELECT COUNT(*) FROM creations) as total_creations,
      (SELECT COUNT(*) FROM game_attempts) as total_games_played,
      (SELECT COUNT(*) FROM reports WHERE status = 'pending') as pending_reports
  `).get();
  res.json({ stats });
});

app.get('/api/admin/reports', requireAdminOrMod, (_req: Request, res: Response) => {
  const reports = db.prepare(`
    SELECT r.*, u.nickname as reporter_nickname
    FROM reports r
    JOIN users u ON u.id = r.reporter_id
    ORDER BY r.created_at DESC
  `).all();
  res.json({ reports });
});

app.post('/api/admin/reports/:id/resolve', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const { status, note } = req.body || {}; // 'resolved', 'dismissed'
  const cleanStatus = status === 'dismissed' ? 'dismissed' : 'resolved';
  db.prepare(`
    UPDATE reports SET
      status = ?, resolution_note = ?, resolved_by = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(cleanStatus, typeof note === 'string' ? note : '', req.user!.id, req.params.id);
  res.json({ ok: true });
});

// User can report content
app.post('/api/reports', requireAuth, (req: AuthRequest, res: Response) => {
  const { target_type, target_id, reason } = req.body || {};
  if (
    typeof target_type !== 'string' ||
    typeof target_id !== 'string' ||
    typeof reason !== 'string' ||
    !target_type.trim() ||
    !target_id.trim() ||
    !reason.trim()
  ) {
    res.status(400).json({ error: 'target_type, target_id and reason are required.' });
    return;
  }
  const id = 'rep_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO reports (id, reporter_id, target_type, target_id, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, req.user!.id, target_type.trim(), target_id.trim(), reason.trim());

  res.json({ ok: true, id });
});

// Admin Quiz Settings (enable/disable quiz + manual active_quiz_ids mode)
app.get('/api/admin/quiz/settings', requireAdmin, (_req: Request, res: Response) => {
  const settings = getQuizSettingsFromDb();
  const poolInfo = getCombinedQuizPool();
  res.json({
    quiz_enabled: settings.quiz_enabled,
    active_quiz_ids: settings.active_quiz_ids,
    total_pool_count: poolInfo.validById.size,
  });
});

app.put('/api/admin/quiz/settings', requireAdmin, (req: AuthRequest, res: Response) => {
  const { quiz_enabled, active_quiz_ids } = req.body || {};

  db.transaction(() => {
    if (typeof quiz_enabled === 'boolean') {
      db.prepare(`
        INSERT INTO app_meta (key, value) VALUES ('quiz_enabled', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(quiz_enabled ? '1' : '0');
    }

    if (Array.isArray(active_quiz_ids)) {
      const cleaned = Array.from(
        new Set(
          active_quiz_ids
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .map((id) => id.trim())
            .slice(0, 20)
        )
      );
      db.prepare(`
        INSERT INTO app_meta (key, value) VALUES ('active_quiz_ids', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(cleaned));
    }
  })();

  const updated = getQuizSettingsFromDb();
  res.json({ ok: true, ...updated });
});

app.post('/api/admin/quiz/randomize', requireAdmin, (req: AuthRequest, res: Response) => {
  const mode = req.body?.mode === 'auto' ? 'auto' : 'pick5';
  const poolInfo = getCombinedQuizPool();
  const { cycleId } = getMoscow12hCycle();

  if (mode === 'auto') {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO app_meta (key, value) VALUES ('active_quiz_ids', '[]')
        ON CONFLICT(key) DO UPDATE SET value = '[]'
      `).run();
      db.prepare('DELETE FROM daily_challenges WHERE challenge_date = ?').run(cycleId);
    })();
    const updated = getQuizSettingsFromDb();
    res.json({ ok: true, mode, ...updated });
    return;
  }

  const validIds = Array.from(poolInfo.validById.keys());
  const picked = fisherYatesShuffle(validIds).slice(0, Math.min(5, validIds.length));

  db.transaction(() => {
    db.prepare(`
      INSERT INTO app_meta (key, value) VALUES ('active_quiz_ids', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(picked));
    db.prepare('DELETE FROM daily_challenges WHERE challenge_date = ?').run(cycleId);
  })();

  res.json({ ok: true, mode, quiz_enabled: getQuizSettingsFromDb().quiz_enabled, active_quiz_ids: picked });
});

// Admin Quiz Question management (with generated discography pool counter + bulk import)
app.get('/api/admin/quiz-questions', requireAdmin, (_req: Request, res: Response) => {
  const questions = db.prepare('SELECT * FROM quiz_questions ORDER BY created_at DESC').all();
  const poolInfo = getCombinedQuizPool();
  const settings = getQuizSettingsFromDb();
  res.json({
    questions,
    custom_active_count: poolInfo.customCount,
    generated_pool_count: poolInfo.generatedCount,
    total_pool_count: poolInfo.validById.size,
    quiz_enabled: settings.quiz_enabled,
    active_quiz_ids: settings.active_quiz_ids,
  });
});

app.post('/api/admin/quiz-questions/bulk', requireAdmin, (req: AuthRequest, res: Response) => {
  const rawInput = req.body?.raw_text ?? req.body?.items;
  const parsed = parseBulkQuizInput(rawInput);

  if (parsed.items.length === 0) {
    res.status(400).json({
      error: parsed.errors[0] || 'Не удалось распознать ни одного валидного вопроса для импорта.',
      errors: parsed.errors,
    });
    return;
  }

  const insertedIds: string[] = [];
  const insertStmt = db.prepare(`
    INSERT INTO quiz_questions (id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const item of parsed.items) {
      const id = 'qz_' + crypto.randomUUID().slice(0, 8);
      insertStmt.run(
        id,
        item.question_ru,
        item.question_en,
        JSON.stringify(item.options),
        item.correct_index,
        item.explanation_ru,
        item.explanation_en,
        item.difficulty
      );
      insertedIds.push(id);
    }
  })();

  res.json({
    ok: true,
    imported_count: insertedIds.length,
    skipped_count: parsed.errors.length,
    errors: parsed.errors,
    ids: insertedIds,
  });
});

app.post('/api/admin/quiz-questions', requireAdmin, (req: AuthRequest, res: Response) => {
  const { question_ru, question_en, options, correct_index, explanation_ru, explanation_en, difficulty } = req.body || {};
  const cleanRu = typeof question_ru === 'string' ? question_ru.trim() : '';
  const cleanEn = typeof question_en === 'string' && question_en.trim() ? question_en.trim() : cleanRu;
  if (
    !cleanRu ||
    !Array.isArray(options) ||
    options.length < 2 ||
    correct_index === undefined
  ) {
    res.status(400).json({ error: 'Заполните текст вопроса, варианты ответа и укажите верный индекс.' });
    return;
  }
  const cleanOptions = options.map((o: any) => String(o || '').trim()).filter(Boolean);
  if (cleanOptions.length < 2) {
    res.status(400).json({ error: 'Нужно указать минимум 2 непустых варианта ответа.' });
    return;
  }
  const id = 'qz_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO quiz_questions (id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cleanRu,
    cleanEn,
    JSON.stringify(cleanOptions),
    Math.max(0, Math.min(Number(correct_index) || 0, cleanOptions.length - 1)),
    typeof explanation_ru === 'string' ? explanation_ru.trim() : '',
    typeof explanation_en === 'string' && explanation_en.trim() ? explanation_en.trim() : (typeof explanation_ru === 'string' ? explanation_ru.trim() : ''),
    Math.max(1, Math.min(3, Number(difficulty) || 1))
  );

  res.json({ ok: true, id });
});

app.put('/api/admin/quiz-questions/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT id FROM quiz_questions WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Quiz question not found' });
    return;
  }
  const { question_ru, question_en, options, correct_index, explanation_ru, explanation_en, difficulty, is_active } = req.body || {};
  db.prepare(`
    UPDATE quiz_questions SET
      question_ru = COALESCE(?, question_ru),
      question_en = COALESCE(?, question_en),
      options_json = COALESCE(?, options_json),
      correct_index = COALESCE(?, correct_index),
      explanation_ru = COALESCE(?, explanation_ru),
      explanation_en = COALESCE(?, explanation_en),
      difficulty = COALESCE(?, difficulty),
      is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    typeof question_ru === 'string' ? question_ru.trim() : null,
    typeof question_en === 'string' ? question_en.trim() : null,
    Array.isArray(options) ? JSON.stringify(options.map((o: any) => String(o || '').trim()).filter(Boolean)) : null,
    correct_index !== undefined ? Number(correct_index) : null,
    typeof explanation_ru === 'string' ? explanation_ru.trim() : null,
    typeof explanation_en === 'string' ? explanation_en.trim() : null,
    difficulty !== undefined ? Number(difficulty) : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/admin/quiz-questions/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM quiz_questions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// API: ADMIN PROMO CODES & SHOP / SHIELDS CRUD
// ----------------------------------------------------------------------------

const PROTECTED_PROMO_IDS = new Set(['promo_apostles', 'promo_deathmarried']);
const PROTECTED_PROMO_CODES = new Set(['apostles', 'deathmarried']);

app.get('/api/admin/promos', requireAdmin, (_req: AuthRequest, res: Response) => {
  const promos = db.prepare(`
    SELECT pc.*,
           (SELECT COUNT(*) FROM promo_code_uses pcu WHERE pcu.promo_code_id = pc.id) as uses_count
    FROM promo_codes pc
    ORDER BY datetime(pc.created_at) DESC, pc.code ASC
  `).all();
  res.json({ promos });
});

app.post('/api/admin/promos', requireAdmin, (req: AuthRequest, res: Response) => {
  const normalizedCode = normalizePromoCode(String(req.body?.code || ''));
  if (!normalizedCode || normalizedCode.length < 2 || normalizedCode.length > 64) {
    res.status(400).json({ error: 'Промокод должен быть от 2 до 64 символов.' });
    return;
  }
  const xpReward = Math.max(1, Math.min(100000, Math.floor(Number(req.body?.xp_reward) || 0)));
  if (!xpReward) {
    res.status(400).json({ error: 'Укажите награду в XP (> 0).' });
    return;
  }
  const existing = db
    .prepare('SELECT id FROM promo_codes WHERE LOWER(TRIM(code)) = ?')
    .get(normalizedCode);
  if (existing) {
    res.status(409).json({ error: 'Такой промокод уже существует.' });
    return;
  }

  const maxUses =
    req.body?.max_uses !== undefined && req.body?.max_uses !== null && String(req.body.max_uses).trim() !== ''
      ? Math.max(1, Math.floor(Number(req.body.max_uses)))
      : null;
  const expiresAt =
    typeof req.body?.expires_at === 'string' && req.body.expires_at.trim()
      ? req.body.expires_at.trim()
      : null;
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    res.status(400).json({ error: 'Некорректная дата истечения срока.' });
    return;
  }
  const isActive = req.body?.is_active === false || req.body?.is_active === 0 ? 0 : 1;
  const id = 'promo_' + crypto.randomUUID().slice(0, 8);

  db.prepare(`
    INSERT INTO promo_codes (id, code, xp_reward, is_active, max_uses, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, normalizedCode, xpReward, isActive, maxUses, expiresAt);

  res.json({ ok: true, id });
});

app.put('/api/admin/promos/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Промокод не найден.' });
    return;
  }
  const isProtected =
    PROTECTED_PROMO_IDS.has(existing.id) ||
    PROTECTED_PROMO_CODES.has(String(existing.code || '').toLowerCase());

  let nextCode = existing.code;
  if (typeof req.body?.code === 'string' && req.body.code.trim()) {
    const norm = normalizePromoCode(req.body.code);
    if (!norm || norm.length < 2 || norm.length > 64) {
      res.status(400).json({ error: 'Некорректная длина промокода.' });
      return;
    }
    if (isProtected && norm !== String(existing.code).toLowerCase()) {
      res.status(403).json({ error: 'Базовый промокод нельзя переименовать.' });
      return;
    }
    const clash = db
      .prepare('SELECT id FROM promo_codes WHERE LOWER(TRIM(code)) = ? AND id != ?')
      .get(norm, existing.id);
    if (clash) {
      res.status(409).json({ error: 'Такой промокод уже существует.' });
      return;
    }
    nextCode = norm;
  }

  const nextXp =
    req.body?.xp_reward !== undefined
      ? Math.max(1, Math.min(100000, Math.floor(Number(req.body.xp_reward) || 0)))
      : existing.xp_reward;
  const nextActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  const nextMaxUses =
    req.body?.max_uses !== undefined
      ? req.body.max_uses === null || String(req.body.max_uses).trim() === ''
        ? null
        : Math.max(1, Math.floor(Number(req.body.max_uses)))
      : existing.max_uses;
  const nextExpiresAt =
    req.body?.expires_at !== undefined
      ? typeof req.body.expires_at === 'string' && req.body.expires_at.trim()
        ? req.body.expires_at.trim()
        : null
      : existing.expires_at;
  if (nextExpiresAt && Number.isNaN(Date.parse(nextExpiresAt))) {
    res.status(400).json({ error: 'Некорректная дата истечения срока.' });
    return;
  }

  db.prepare(`
    UPDATE promo_codes SET
      code = ?, xp_reward = ?, is_active = ?, max_uses = ?, expires_at = ?
    WHERE id = ?
  `).run(nextCode, nextXp, nextActive, nextMaxUses, nextExpiresAt, existing.id);

  res.json({ ok: true });
});

app.delete('/api/admin/promos/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT id, code FROM promo_codes WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Промокод не найден.' });
    return;
  }
  if (
    PROTECTED_PROMO_IDS.has(existing.id) ||
    PROTECTED_PROMO_CODES.has(String(existing.code || '').toLowerCase())
  ) {
    res.status(403).json({ error: 'Системные промокоды «apostles» и «deathmarried» защищены от удаления.' });
    return;
  }
  db.transaction(() => {
    db.prepare('DELETE FROM promo_code_uses WHERE promo_code_id = ?').run(existing.id);
    db.prepare('DELETE FROM promo_codes WHERE id = ?').run(existing.id);
  })();
  res.json({ ok: true });
});

app.get('/api/admin/shop/items', requireAdmin, (_req: AuthRequest, res: Response) => {
  const items = db.prepare(`
    SELECT si.*,
           (SELECT COUNT(*) FROM user_inventory ui WHERE ui.item_id = si.id) as owners_count
    FROM shop_items si
    ORDER BY si.category ASC, si.cost_xp ASC, si.name_ru ASC
  `).all();
  res.json({ items });
});

app.post('/api/admin/shop/items', requireAdmin, (req: AuthRequest, res: Response) => {
  const { name_ru, name_en, description_ru, description_en, category, cost_xp, rarity, preview_value, is_active } =
    req.body || {};

  if (!SHOP_CATEGORY_COLUMN_MAP[category]) {
    res.status(400).json({ error: 'Некорректная категория предмета.' });
    return;
  }
  const cleanNameRu = String(name_ru || '').trim().slice(0, 80);
  const cleanNameEn = String(name_en || cleanNameRu).trim().slice(0, 80);
  if (!cleanNameRu) {
    res.status(400).json({ error: 'Укажите название предмета.' });
    return;
  }
  const cleanPreview = String(preview_value || '').trim().slice(0, 500);
  if (!cleanPreview) {
    res.status(400).json({ error: 'Укажите ключ стиля или значение preview_value.' });
    return;
  }
  const allowedRarities = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
  const cleanRarity = allowedRarities.has(rarity) ? rarity : 'rare';
  const cleanCost = Math.max(0, Math.floor(Number(cost_xp) || 0));
  const id = 'item_' + crypto.randomUUID().slice(0, 8);

  db.prepare(`
    INSERT INTO shop_items (id, name_ru, name_en, description_ru, description_en, category, cost_xp, rarity, preview_value, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cleanNameRu,
    cleanNameEn,
    String(description_ru || '').trim().slice(0, 300),
    String(description_en || description_ru || '').trim().slice(0, 300),
    category,
    cleanCost,
    cleanRarity,
    cleanPreview,
    is_active === false || is_active === 0 ? 0 : 1
  );

  res.json({ ok: true, id });
});

app.put('/api/admin/shop/items/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Предмет магазина не найден.' });
    return;
  }

  const body = req.body || {};
  const nextCategory = body.category !== undefined ? body.category : existing.category;
  if (!SHOP_CATEGORY_COLUMN_MAP[nextCategory]) {
    res.status(400).json({ error: 'Некорректная категория предмета.' });
    return;
  }
  const allowedRarities = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']);
  const nextRarity = body.rarity !== undefined && allowedRarities.has(body.rarity) ? body.rarity : existing.rarity;
  const nextPreview =
    typeof body.preview_value === 'string' && body.preview_value.trim()
      ? body.preview_value.trim().slice(0, 500)
      : existing.preview_value;

  db.transaction(() => {
    db.prepare(`
      UPDATE shop_items SET
        name_ru = COALESCE(?, name_ru),
        name_en = COALESCE(?, name_en),
        description_ru = COALESCE(?, description_ru),
        description_en = COALESCE(?, description_en),
        category = ?,
        cost_xp = ?,
        rarity = ?,
        preview_value = ?,
        is_active = ?
      WHERE id = ?
    `).run(
      typeof body.name_ru === 'string' && body.name_ru.trim() ? body.name_ru.trim().slice(0, 80) : null,
      typeof body.name_en === 'string' && body.name_en.trim() ? body.name_en.trim().slice(0, 80) : null,
      typeof body.description_ru === 'string' ? body.description_ru.trim().slice(0, 300) : null,
      typeof body.description_en === 'string' ? body.description_en.trim().slice(0, 300) : null,
      nextCategory,
      body.cost_xp !== undefined ? Math.max(0, Math.floor(Number(body.cost_xp) || 0)) : existing.cost_xp,
      nextRarity,
      nextPreview,
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
      existing.id
    );

    if (nextPreview !== existing.preview_value) {
      const col = SHOP_CATEGORY_COLUMN_MAP[nextCategory];
      if (col) {
        db.prepare(`
          UPDATE profiles SET ${col} = ?, updated_at = datetime('now')
          WHERE user_id IN (SELECT user_id FROM user_inventory WHERE item_id = ? AND is_equipped = 1)
        `).run(nextPreview, existing.id);
      }
    }
  })();

  res.json({ ok: true });
});

app.delete('/api/admin/shop/items/:id', requireAdmin, (req: AuthRequest, res: Response) => {
  const existing = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Предмет не найден.' });
    return;
  }

  db.transaction(() => {
    const col = SHOP_CATEGORY_COLUMN_MAP[existing.category];
    if (col) {
      db.prepare(`
        UPDATE profiles SET ${col} = NULL, updated_at = datetime('now')
        WHERE user_id IN (SELECT user_id FROM user_inventory WHERE item_id = ? AND is_equipped = 1)
      `).run(existing.id);
    }
    db.prepare('DELETE FROM user_inventory WHERE item_id = ?').run(existing.id);
    db.prepare('DELETE FROM shop_items WHERE id = ?').run(existing.id);
  })();

  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// API: ADMIN LEADERBOARD MANAGEMENT (SAFE GAME-ONLY RESETS, NEVER DELETES ACCOUNTS)
// ----------------------------------------------------------------------------

function adjustUserProfileAfterXpRemoval(userId: string, removedXp: number) {
  const safeRemoved = Math.max(0, Math.floor(removedXp || 0));
  if (safeRemoved <= 0) return;
  const prof = db.prepare('SELECT xp, total_xp FROM profiles WHERE user_id = ?').get(userId) as any;
  if (!prof) return;
  const nextTotalXp = Math.max(0, (Number(prof.total_xp) || 0) - safeRemoved);
  const nextSpendableXp = Math.max(0, (Number(prof.xp) || 0) - safeRemoved);
  const { level } = calculateLevelFromXp(nextTotalXp);
  db.prepare(`
    UPDATE profiles
    SET xp = ?, total_xp = ?, level = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(nextSpendableXp, nextTotalXp, level, userId);
}

app.get('/api/admin/leaderboard', requireAdmin, (req: Request, res: Response) => {
  const rawTimeframe = String(req.query.timeframe || 'all');
  const timeframe = rawTimeframe === 'weekly' || rawTimeframe === 'monthly' ? rawTimeframe : 'all';
  const rawGame = String(req.query.game || 'all');
  const ALLOWED_GAMES = new Set(['guess-track', 'daily-quiz', 'guess-lyrics', 'reverse-track', 'speed-track']);
  const gameFilter = ALLOWED_GAMES.has(rawGame) ? rawGame : 'all';
  const search = String(req.query.search || '').trim().toLowerCase();
  const { cycleId, nextResetAt } = getMoscow12hCycle();

  const timeConditionGa =
    timeframe === 'weekly'
      ? "AND datetime(ga.created_at) >= datetime('now', '-7 days')"
      : timeframe === 'monthly'
        ? "AND datetime(ga.created_at) >= datetime('now', '-30 days')"
        : '';

  const timeConditionXt =
    timeframe === 'weekly'
      ? "AND datetime(xt.created_at) >= datetime('now', '-7 days')"
      : timeframe === 'monthly'
        ? "AND datetime(xt.created_at) >= datetime('now', '-30 days')"
        : '';

  const rows = db.prepare(`
    SELECT
      u.id,
      u.nickname,
      u.role_id,
      u.is_banned,
      p.display_name,
      p.avatar_url,
      p.level,
      p.xp as spendable_xp,
      p.total_xp,
      p.daily_streak,
      (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id ${timeConditionGa}) as games_played,
      (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id AND ga.game_id = 'guess-track' ${timeConditionGa}) as guess_track_played,
      (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id AND ga.game_id = 'daily-quiz' ${timeConditionGa}) as daily_quiz_played,
      (SELECT COALESCE(SUM(ga.score), 0) FROM game_attempts ga WHERE ga.user_id = u.id ${gameFilter !== 'all' ? 'AND ga.game_id = @gameFilter' : ''} ${timeConditionGa}) as game_score,
      (SELECT COALESCE(SUM(ga.xp_earned), 0) FROM game_attempts ga WHERE ga.user_id = u.id ${gameFilter !== 'all' ? 'AND ga.game_id = @gameFilter' : ''} ${timeConditionGa}) as game_xp,
      (SELECT COALESCE(SUM(xt.amount), 0) FROM xp_transactions xt WHERE xt.user_id = u.id AND xt.amount > 0 ${timeConditionXt}) as period_xp,
      EXISTS(SELECT 1 FROM game_completions gc WHERE gc.user_id = u.id AND gc.game_type = 'guess-track' AND gc.cycle_id = @cycleId) as completed_today_track,
      EXISTS(SELECT 1 FROM game_completions gc WHERE gc.user_id = u.id AND gc.game_type = 'daily-quiz' AND gc.cycle_id = @cycleId) as completed_today_quiz
    FROM users u
    JOIN profiles p ON p.user_id = u.id
  `).all({ gameFilter, cycleId }) as any[];

  const enriched = rows
    .map((row) => {
      const totalXp = Number(row.total_xp) || 0;
      const computedLevel = calculateLevelFromXp(totalXp).level;
      const rankXp =
        gameFilter !== 'all'
          ? Number(row.game_xp) || 0
          : timeframe === 'all'
            ? totalXp
            : Number(row.period_xp) || 0;
      const scopedGamesPlayed =
        gameFilter === 'guess-track'
          ? Number(row.guess_track_played) || 0
          : gameFilter === 'daily-quiz'
            ? Number(row.daily_quiz_played) || 0
            : Number(row.games_played) || 0;
      return {
        ...row,
        level: computedLevel,
        total_xp: totalXp,
        rank_xp: rankXp,
        scoped_games_played: scopedGamesPlayed,
        completed_today_track: Boolean(row.completed_today_track),
        completed_today_quiz: Boolean(row.completed_today_quiz),
      };
    })
    .filter((row) => {
      if (row.rank_xp <= 0 && row.scoped_games_played <= 0 && !row.completed_today_track && !row.completed_today_quiz) {
        return false;
      }
      if (search) {
        const nick = String(row.nickname || '').toLowerCase();
        const disp = String(row.display_name || '').toLowerCase();
        return nick.includes(search) || disp.includes(search);
      }
      return true;
    })
    .sort((a, b) => {
      if (timeframe === 'all' && gameFilter === 'all') {
        if (b.level !== a.level) return b.level - a.level;
        if (b.total_xp !== a.total_xp) return b.total_xp - a.total_xp;
      } else {
        if (b.level !== a.level && gameFilter !== 'all') return b.level - a.level;
        if (b.rank_xp !== a.rank_xp) return b.rank_xp - a.rank_xp;
      }
      if (b.game_score !== a.game_score) return b.game_score - a.game_score;
      return b.scoped_games_played - a.scoped_games_played;
    });

  const todayTrack = getOrCreateDailyTrackChallenge(cycleId);
  const todayQuiz = getOrCreateDailyQuizChallenge(cycleId);
  const totalAttempts = (db.prepare('SELECT COUNT(*) as c FROM game_attempts').get() as any)?.c || 0;
  const todayTrackAttempts = (db.prepare("SELECT COUNT(*) as c FROM game_completions WHERE game_type = 'guess-track' AND cycle_id = ?").get(cycleId) as any)?.c || 0;
  const todayQuizAttempts = (db.prepare("SELECT COUNT(*) as c FROM game_completions WHERE game_type = 'daily-quiz' AND cycle_id = ?").get(cycleId) as any)?.c || 0;

  res.json({
    leaders: enriched,
    timeframe,
    game: gameFilter,
    summary: {
      today_utc: cycleId,
      track_slot_utc: cycleId,
      next_reset_at: nextResetAt,
      next_track_reset_at: nextResetAt,
      total_ranked: enriched.length,
      total_attempts: totalAttempts,
      today_track_title: todayTrack?.track.title || null,
      today_track_snippet_start: todayTrack?.snippet_start_seconds ?? null,
      today_track_snippet_duration: todayTrack?.snippet_duration_seconds ?? DAILY_SNIPPET_DURATION_SECONDS,
      today_track_attempts: todayTrackAttempts,
      today_quiz_count: todayQuiz.length,
      today_quiz_attempts: todayQuizAttempts,
    },
  });
});

app.post('/api/admin/leaderboard/clear', requireAdmin, (req: AuthRequest, res: Response) => {
  const rawScope = String(req.body?.scope || 'all').trim();
  const allowedScopes = new Set(['all', 'weekly', 'monthly', 'guess-track', 'daily-quiz', 'guess-lyrics', 'reverse-track', 'speed-track', 'daily-attempts']);
  if (!allowedScopes.has(rawScope)) {
    res.status(400).json({ error: 'Invalid leaderboard clear scope.' });
    return;
  }

  const { cycleId } = getMoscow12hCycle();
  const removed = {
    game_attempts: 0,
    daily_track_attempts: 0,
    quiz_attempts: 0,
    game_completions: 0,
    xp_transactions: 0,
    profiles_updated: 0,
  };

  db.transaction(() => {
    if (rawScope === 'all') {
      removed.game_attempts = db.prepare('DELETE FROM game_attempts').run().changes;
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts').run().changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts').run().changes;
      removed.game_completions = db.prepare('DELETE FROM game_completions').run().changes;
      try { db.prepare('DELETE FROM daily_mini_game_attempts').run(); } catch {}
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE source IN ('guess_track', 'daily_quiz', 'guess_lyrics', 'reverse_track', 'speed_track') OR amount > 0").run().changes;
      removed.profiles_updated = db.prepare(`
        UPDATE profiles
        SET xp = 0, total_xp = 0, level = 1, daily_streak = 0, last_active_date = NULL, updated_at = datetime('now')
      `).run().changes;
    } else if (rawScope === 'weekly' || rawScope === 'monthly') {
      const windowSql = rawScope === 'weekly' ? '-7 days' : '-30 days';
      const xpByUser = db.prepare(`
        SELECT user_id, COALESCE(SUM(amount), 0) as sum_xp
        FROM xp_transactions
        WHERE amount > 0 AND datetime(created_at) >= datetime('now', ?)
        GROUP BY user_id
      `).all(windowSql) as Array<{ user_id: string; sum_xp: number }>;

      removed.game_attempts = db.prepare(`DELETE FROM game_attempts WHERE datetime(created_at) >= datetime('now', ?)`).run(windowSql).changes;
      removed.daily_track_attempts = db.prepare(`DELETE FROM daily_track_attempts WHERE datetime(created_at) >= datetime('now', ?)`).run(windowSql).changes;
      removed.quiz_attempts = db.prepare(`DELETE FROM quiz_attempts WHERE datetime(created_at) >= datetime('now', ?)`).run(windowSql).changes;
      removed.game_completions = db.prepare(`DELETE FROM game_completions WHERE datetime(created_at) >= datetime('now', ?)`).run(windowSql).changes;
      removed.xp_transactions = db.prepare(`DELETE FROM xp_transactions WHERE amount > 0 AND datetime(created_at) >= datetime('now', ?)`).run(windowSql).changes;

      for (const item of xpByUser) {
        adjustUserProfileAfterXpRemoval(item.user_id, item.sum_xp);
        removed.profiles_updated += 1;
      }
    } else if (rawScope === 'guess-track' || rawScope === 'daily-quiz' || rawScope === 'guess-lyrics' || rawScope === 'reverse-track' || rawScope === 'speed-track') {
      const xpSourceMap: Record<string, string> = {
        'guess-track': 'guess_track',
        'daily-quiz': 'daily_quiz',
        'guess-lyrics': 'guess_lyrics',
        'reverse-track': 'reverse_track',
        'speed-track': 'speed_track',
      };
      const xpSource = xpSourceMap[rawScope];
      const xpByUser = db.prepare(`
        SELECT user_id, COALESCE(SUM(xp_earned), 0) as sum_xp
        FROM game_attempts
        WHERE game_id = ?
        GROUP BY user_id
      `).all(rawScope) as Array<{ user_id: string; sum_xp: number }>;

      removed.game_attempts = db.prepare('DELETE FROM game_attempts WHERE game_id = ?').run(rawScope).changes;
      if (rawScope === 'guess-track') {
        removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts').run().changes;
      } else if (rawScope === 'daily-quiz') {
        removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts').run().changes;
      } else {
        try { db.prepare('DELETE FROM daily_mini_game_attempts WHERE game_id = ?').run(rawScope); } catch {}
      }
      removed.game_completions = db.prepare('DELETE FROM game_completions WHERE game_type = ?').run(rawScope).changes;
      removed.xp_transactions = db.prepare('DELETE FROM xp_transactions WHERE source = ?').run(xpSource).changes;

      for (const item of xpByUser) {
        adjustUserProfileAfterXpRemoval(item.user_id, item.sum_xp);
        removed.profiles_updated += 1;
      }
    } else if (rawScope === 'daily-attempts') {
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE challenge_date = ?').run(cycleId).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE challenge_date = ?').run(cycleId).changes;
      try { db.prepare('DELETE FROM daily_mini_game_attempts WHERE cycle_id = ?').run(cycleId); } catch {}
      removed.game_completions = db.prepare('DELETE FROM game_completions WHERE cycle_id = ?').run(cycleId).changes;
    }

    db.prepare(`
      INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
      VALUES (?, ?, ?, 'leaderboard_clear', ?)
    `).run(
      'mod_' + crypto.randomUUID().slice(0, 8),
      req.user!.id,
      req.user!.id,
      `Cleared leaderboard scope=${rawScope} (${JSON.stringify(removed)})`
    );
  })();

  res.json({ ok: true, scope: rawScope, removed });
});

app.delete('/api/admin/leaderboard/users/:userId', requireAdmin, (req: AuthRequest, res: Response) => {
  const userId = String(req.params.userId || '').trim();
  const rawScope = String(req.query.scope || req.body?.scope || 'all').trim();
  const allowedScopes = new Set(['all', 'guess-track', 'daily-quiz', 'guess-lyrics', 'reverse-track', 'speed-track', 'daily-attempts']);
  if (!allowedScopes.has(rawScope)) {
    res.status(400).json({ error: 'Invalid user leaderboard reset scope.' });
    return;
  }

  const targetUser = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(userId) as
    | { id: string; nickname: string }
    | undefined;
  if (!targetUser) {
    res.status(404).json({ error: 'Пользователь не найден.' });
    return;
  }

  const { cycleId } = getMoscow12hCycle();
  const removed = {
    game_attempts: 0,
    daily_track_attempts: 0,
    quiz_attempts: 0,
    game_completions: 0,
    xp_transactions: 0,
  };

  db.transaction(() => {
    if (rawScope === 'all') {
      removed.game_attempts = db.prepare('DELETE FROM game_attempts WHERE user_id = ?').run(userId).changes;
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(userId).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(userId).changes;
      removed.game_completions = db.prepare('DELETE FROM game_completions WHERE user_id = ?').run(userId).changes;
      try { db.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ?').run(userId); } catch {}
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE user_id = ? AND (source IN ('guess_track', 'daily_quiz', 'guess_lyrics', 'reverse_track', 'speed_track') OR amount > 0)").run(userId).changes;
      db.prepare(`
        UPDATE profiles
        SET xp = 0, total_xp = 0, level = 1, daily_streak = 0, last_active_date = NULL, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(userId);
    } else if (rawScope === 'guess-track' || rawScope === 'daily-quiz' || rawScope === 'guess-lyrics' || rawScope === 'reverse-track' || rawScope === 'speed-track') {
      const xpSourceMap: Record<string, string> = {
        'guess-track': 'guess_track',
        'daily-quiz': 'daily_quiz',
        'guess-lyrics': 'guess_lyrics',
        'reverse-track': 'reverse_track',
        'speed-track': 'speed_track',
      };
      const xpSource = xpSourceMap[rawScope];
      const sumRow = db.prepare('SELECT COALESCE(SUM(xp_earned), 0) as sum_xp FROM game_attempts WHERE user_id = ? AND game_id = ?').get(userId, rawScope) as any;
      removed.game_attempts = db.prepare('DELETE FROM game_attempts WHERE user_id = ? AND game_id = ?').run(userId, rawScope).changes;
      if (rawScope === 'guess-track') {
        removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(userId).changes;
      } else if (rawScope === 'daily-quiz') {
        removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(userId).changes;
      } else {
        try { db.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ? AND game_id = ?').run(userId, rawScope); } catch {}
      }
      removed.game_completions = db.prepare('DELETE FROM game_completions WHERE user_id = ? AND game_type = ?').run(userId, rawScope).changes;
      removed.xp_transactions = db.prepare('DELETE FROM xp_transactions WHERE user_id = ? AND source = ?').run(userId, xpSource).changes;
      adjustUserProfileAfterXpRemoval(userId, Number(sumRow?.sum_xp) || 0);
    } else if (rawScope === 'daily-attempts') {
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ? AND challenge_date = ?').run(userId, cycleId).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ? AND challenge_date = ?').run(userId, cycleId).changes;
      try { db.prepare('DELETE FROM daily_mini_game_attempts WHERE user_id = ? AND cycle_id = ?').run(userId, cycleId); } catch {}
      removed.game_completions = db.prepare('DELETE FROM game_completions WHERE user_id = ? AND cycle_id = ?').run(userId, cycleId).changes;
    }

    db.prepare(`
      INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
      VALUES (?, ?, ?, 'leaderboard_user_reset', ?)
    `).run(
      'mod_' + crypto.randomUUID().slice(0, 8),
      req.user!.id,
      userId,
      `Reset leaderboard for @${targetUser.nickname} scope=${rawScope} (${JSON.stringify(removed)})`
    );
  })();

  res.json({ ok: true, user_id: userId, nickname: targetUser.nickname, scope: rawScope, removed });
});

// ----------------------------------------------------------------------------
// API: UPLOAD (IMAGES, AUDIO & VIDEO) — LOCAL + SUPABASE DIRECT SIGNED STORAGE
// ----------------------------------------------------------------------------

function indexUploadedMediaMetadata(
  kind: 'audio' | 'image' | 'video' | null,
  originalName: string,
  mimeType: string,
  byteSize: number,
  fileUrl: string,
  userId: string | null
): string {
  const fileId = (kind === 'image' ? 'img_' : 'aud_') + crypto.randomUUID().slice(0, 8);
  if (kind === 'audio') {
    try {
      db.prepare(`
        INSERT INTO audio_files (id, filename, mime_type, byte_size, storage_path, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(fileId, originalName, mimeType || 'audio/mpeg', byteSize, fileUrl, userId);
    } catch (e) {
      console.error('Failed to index audio file:', e);
    }
  } else if (kind === 'image') {
    try {
      db.prepare(`
        INSERT INTO archive_images (id, title, storage_path, category, uploaded_by)
        VALUES (?, ?, ?, 'artwork', ?)
      `).run(fileId, originalName, fileUrl, userId);
    } catch (e) {
      console.error('Failed to index archive image:', e);
    }
  }
  return fileId;
}

// Step 1 of direct cloud upload (bypasses Vercel 4.5MB serverless body limit)
app.post('/api/upload/signed-url', uploadRateLimit, requireAuth, async (req: AuthRequest, res: Response) => {
  const { filename, mimetype, size } = req.body || {};
  if (typeof filename !== 'string' || !filename.trim()) {
    res.status(400).json({ error: 'Filename is required.' });
    return;
  }
  const numericSize = Number(size) || 0;
  if (numericSize > 100 * 1024 * 1024) {
    res.status(413).json({ error: 'File exceeds maximum allowed size of 100 MB.' });
    return;
  }
  const safeMime = typeof mimetype === 'string' ? mimetype : '';
  const policy = validateUploadPolicy(filename, safeMime, numericSize);
  if (!policy.ok) {
    res.status(policy.status || 400).json({
      error: policy.error,
    });
    return;
  }

  if (!isSupabaseConfigured()) {
    res.json({ direct: false, reason: 'supabase-not-configured' });
    return;
  }

  const storedFilename = buildSafeUploadFilename(filename, safeMime);
  const signed = await createSignedMediaUploadUrl(storedFilename);
  if (!signed) {
    res.json({ direct: false, reason: 'signed-url-unavailable' });
    return;
  }

  res.json({
    direct: true,
    signedUrl: signed.signedUrl,
    storedFilename,
    url: `/uploads/${storedFilename}`,
    kind: policy.kind,
  });
});

// Step 2 of direct cloud upload: register file metadata in SQLite + trigger cloud DB snapshot sync
app.post('/api/upload/complete', uploadRateLimit, requireAuth, (req: AuthRequest, res: Response) => {
  const { storedFilename, originalName, mimetype, size } = req.body || {};
  if (typeof storedFilename !== 'string' || !storedFilename.trim() || storedFilename.includes('..') || storedFilename.includes('/')) {
    res.status(400).json({ error: 'Invalid stored filename.' });
    return;
  }
  const safeOriginal = typeof originalName === 'string' && originalName.trim() ? originalName.trim() : storedFilename;
  const safeMime = typeof mimetype === 'string' ? mimetype : 'application/octet-stream';
  const numericSize = Math.max(0, Number(size) || 0);
  const policy = validateUploadPolicy(safeOriginal, safeMime, numericSize);
  if (!policy.ok) {
    res.status(policy.status || 400).json({ error: policy.error || 'Disallowed media type.' });
    return;
  }

  const fileUrl = `/uploads/${path.basename(storedFilename)}`;
  const fileId = indexUploadedMediaMetadata(policy.kind, safeOriginal, safeMime, numericSize, fileUrl, req.user?.id || null);

  res.json({
    id: fileId,
    url: fileUrl,
    filename: safeOriginal,
    mimetype: safeMime,
    size: numericSize,
    is_audio: policy.kind === 'audio',
    is_image: policy.kind === 'image',
    is_video: policy.kind === 'video',
    storage_backend: 'supabase-storage',
  });
});

app.post('/api/upload', uploadRateLimit, requireAuth, (req: AuthRequest, res: Response) => {
  upload.single('file')(req, res, async (multerErr: any) => {
    if (multerErr) {
      if (multerErr instanceof multer.MulterError && multerErr.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'File is too large. Maximum size is 100 MB.' });
        return;
      }
      res.status(400).json({ error: multerErr.message || 'File upload rejected.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded or file rejected.' });
      return;
    }

    const policy = validateUploadPolicy(req.file.originalname, req.file.mimetype, req.file.size);
    if (!policy.ok) {
      if (req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
      res.status(policy.status || 400).json({ error: policy.error || 'File upload rejected.' });
      return;
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const isAudio = policy.kind === 'audio';
    const isImage = policy.kind === 'image';
    const isVideo = policy.kind === 'video';

    let fileBuffer: Buffer | null = null;
    if (req.file.path && fs.existsSync(req.file.path)) {
      try {
        fileBuffer = fs.readFileSync(req.file.path);
      } catch (err) {
        console.warn('[Upload] Could not read uploaded file into memory:', err);
      }
    }

    let uploadedToCloud = false;
    if (fileBuffer && isSupabaseConfigured()) {
      uploadedToCloud = await uploadMediaToSupabase(
        req.file.filename,
        fileBuffer,
        req.file.mimetype || 'application/octet-stream'
      );
    }

    // Persist uploaded file binary in SQLite uploaded_blobs (up to 25MB) as fallback
    try {
      if (fileBuffer && req.file.size <= 25 * 1024 * 1024) {
        db.prepare(`
          INSERT INTO uploaded_blobs (filename, mime_type, byte_size, data)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(filename) DO UPDATE SET
            mime_type = excluded.mime_type,
            byte_size = excluded.byte_size,
            data = excluded.data
        `).run(req.file.filename, req.file.mimetype || 'application/octet-stream', req.file.size, fileBuffer);
      }
    } catch (err) {
      console.warn('[Upload] Failed to store blob in SQLite fallback table:', err);
    }

    const fileId = indexUploadedMediaMetadata(
      policy.kind,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      fileUrl,
      req.user?.id || null
    );

    res.json({
      id: fileId,
      url: fileUrl,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      is_audio: isAudio,
      is_image: isImage,
      is_video: isVideo,
      storage_backend: uploadedToCloud ? 'supabase-storage+local' : 'local+sqlite',
    });
  });
});

// Serve uploaded files from disk first, falling back to SQLite uploaded_blobs, then Supabase Storage (with HTTP Range streaming & CDN immutable caching)
app.get('/uploads/:filename', async (req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(req.params.filename || '');
  if (!filename || filename.includes('..')) {
    res.status(400).end();
    return;
  }

  const diskCandidate = path.join(uploadDir, filename);
  const publicUploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
  const publicCandidate = path.join(publicUploadsDir, filename);
  if (
    (isPathInsideDir(uploadDir, diskCandidate) && fs.existsSync(diskCandidate)) ||
    (isPathInsideDir(publicUploadsDir, publicCandidate) && fs.existsSync(publicCandidate))
  ) {
    next();
    return;
  }

  try {
    const row = db.prepare('SELECT mime_type, byte_size, data FROM uploaded_blobs WHERE filename = ?').get(filename) as
      | { mime_type: string; byte_size: number; data: Buffer }
      | undefined;

    if (row && row.data) {
      const buffer = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
      const total = buffer.length;
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');

      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (match) {
          let start: number;
          let end: number;
          if (match[1] === '' && match[2] !== '') {
            const suffix = parseInt(match[2], 10);
            start = Math.max(0, total - suffix);
            end = total - 1;
          } else {
            start = match[1] ? parseInt(match[1], 10) : 0;
            end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
          }
          if (!isNaN(start) && !isNaN(end) && start >= 0 && start < total && start <= end) {
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', String(end - start + 1));
            res.end(buffer.subarray(start, end + 1));
            return;
          }
          res.status(416);
          res.setHeader('Content-Range', `bytes */${total}`);
          res.end();
          return;
        }
      }

      res.setHeader('Content-Length', String(total));
      res.end(buffer);
      return;
    }

    // Fallback to Supabase Storage (supports audio seeking via HTTP Range / 206 Partial Content)
    const cloudMedia = await fetchMediaFromSupabase(filename, req.headers.range);
    if (cloudMedia) {
      res.status(cloudMedia.status);
      res.setHeader('Content-Type', cloudMedia.contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      if (cloudMedia.contentRange) {
        res.setHeader('Content-Range', cloudMedia.contentRange);
      }
      res.setHeader('Content-Length', cloudMedia.contentLength || String(cloudMedia.body.length));
      res.end(cloudMedia.body);
      return;
    }

    res.status(404).json({ error: 'Uploaded file not found' });
  } catch (err) {
    console.error('[Uploads] Error serving uploaded media:', err);
    res.status(500).end();
  }
});

// Serve uploaded static files & audio/asset resources
const uploadsStaticOptions = {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');
  },
};
app.use('/uploads', express.static(uploadDir, uploadsStaticOptions));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'public', 'uploads'), uploadsStaticOptions));
app.use('/audio', express.static(path.resolve(process.cwd(), 'public', 'audio')));
app.use('/assets', express.static(path.resolve(process.cwd(), 'public', 'assets')));

// Health & deployment diagnostic endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'Apostles of deathmarried API',
    ...getCloudSyncStatus(),
  });
});

// ----------------------------------------------------------------------------
// API STRICT 404 & ERROR HANDLER (Ensures API routes NEVER return HTML <!DOCTYPE html>)
// ----------------------------------------------------------------------------

app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Server Error]:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ----------------------------------------------------------------------------
// VITE INTEGRATION & SSR / SPA SERVING
// ----------------------------------------------------------------------------

async function startServer() {
  if (isSupabaseConfigured()) {
    await triggerColdStartRestoreOnce();
  }

  const httpServer = http.createServer(app);
  let viteServer: { close: () => Promise<void> } | null = null;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr =
      process.env.DISABLE_HMR === 'true' || Boolean(process.env.CONTROL_PLANE_PORT);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // Never open a separate standalone WebSocket port (24678) that conflicts during restarts
        hmr: disableHmr ? false : { server: httpServer },
        watch: disableHmr ? null : undefined,
      },
      appType: 'spa',
    });
    viteServer = vite;
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[Apostles of deathmarried] HTTP server error on port ${PORT}:`, err);
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      process.exit(1);
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Apostles of deathmarried] Server running on http://0.0.0.0:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Apostles of deathmarried] Received ${signal}, shutting down cleanly...`);
    httpServer.close(() => {
      Promise.resolve(viteServer?.close())
        .catch(() => {})
        .finally(() => {
          closeDatabase();
          process.exit(0);
        });
    });
    // Force exit if keep-alive connections stall shutdown
    setTimeout(() => {
      closeDatabase();
      process.exit(0);
    }, 3000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (!isVercel && process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason) => {
    console.error('[Apostles of deathmarried] Unhandled promise rejection:', reason);
  });

  startServer().catch((err) => {
    console.error('[Apostles of deathmarried] Fatal startup error:', err);
    closeDatabase();
    process.exit(1);
  });
}

export { app };
export default app;
