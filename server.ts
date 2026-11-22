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
  syncCloudDatabase,
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
  SESSION_TTL_MS,
} from './server/sessionToken.js';
import {
  calculateLevelFromXp,
  calculateQuizScore,
  validateNickname,
  validatePassword,
  checkAchievementEligibility,
  isSafeMediaUrl,
  computeDailyStreak,
  resolveServerPort,
  sanitizeStreamingLinks,
  classifyMediaUpload,
  buildSafeAsciiFilename,
} from './src/utils/logic.js';
import {
  DAILY_SNIPPET_DURATION_SECONDS,
  DEFAULT_DAILY_QUIZ_COUNT,
  getUtcDateString,
  isValidUtcDateString,
  getNextUtcMidnightIso,
  pickDailyTrackChallenge,
  parseAndValidateQuizQuestion,
  pickDailyQuizSet,
  readLocalWavDurationSeconds,
  type PlayableTrackCandidate,
  type TitleOption,
  type RawQuizQuestion,
  type ValidatedQuizQuestion,
} from './server/dailyGames.js';

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

const STATELESS_POST_PATHS = new Set(['/api/upload/signed-url']);
const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Cloud database freshness check (before reads/writes) & write-through snapshot sync middleware
// CRITICAL: DB backup upload to Supabase Storage ONLY runs after successful mutating requests (POST/PUT/PATCH/DELETE).
// GET requests are strictly read-only and NEVER upload apostles.db.
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    const isMutation =
      MUTATING_HTTP_METHODS.has(req.method) && !STATELESS_POST_PATHS.has(req.path);

    if (isSupabaseConfigured()) {
      if (isMutation) {
        // Always download the latest cache-busted apostles.db (?t=Date.now()) directly before mutating
        // so a warm Vercel Lambda NEVER overwrites newer cloud data with a stale /tmp/apostles.db.
        const pullResult = await syncCloudDatabase({ force: true });
        if (pullResult.error && !pullResult.notFound) {
          console.error('[CloudSync] Aborting mutation because fresh DB pull failed:', pullResult.error);
          res.status(503).json({
            error: `Не удалось получить актуальную базу данных из Supabase Storage перед сохранением: ${pullResult.error}`,
            cloud_sync_error: pullResult.error,
          });
          return;
        }

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
      } else if (req.method === 'GET' && req.path.startsWith('/api')) {
        // Strictly read-only pull: on Vercel, always fetch fresh cache-busted snapshot (?t=Date.now())
        // so any warm Lambda returns newly saved changes immediately, while NEVER uploading on GET.
        try {
          await syncCloudDatabase({ force: isVercel, minIntervalMs: isVercel ? 0 : 5000 });
        } catch (err) {
          console.warn('[CloudSync] Read-only sync warning:', err instanceof Error ? err.message : err);
        }
      } else if (req.method === 'GET') {
        try {
          await ensureCloudDatabaseRestored();
        } catch {}
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

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max for high-res WAV & video uploads
  fileFilter: (_req, file, cb) => {
    const classified = classifyMediaUpload(file.originalname, file.mimetype);
    if (classified.allowed) {
      cb(null, true);
    } else {
      cb(new Error('Disallowed file type. Only audio (MP3, WAV, FLAC, OGG, M4A), images (JPG, PNG, WEBP, GIF), and video (MP4, WEBM, MOV) are accepted.'));
    }
  },
});

// Authentication middleware
interface AuthRequest extends Request {
  user?: {
    id: string;
    nickname: string;
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
      SELECT u.id as user_id, u.id, u.nickname, u.email, u.role_id, u.is_banned,
             p.display_name, p.avatar_url, p.bio, p.level, p.xp, p.daily_streak
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = ? OR u.nickname = ? COLLATE NOCASE
      ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(payload.uid, payload.nick, payload.uid) as any;

    if (!userRow || userRow.is_banned) {
      return null;
    }
    return userRow;
  }

  // Path B: Legacy opaque session token stored in SQLite sessions table
  const session = db.prepare(`
    SELECT s.user_id, s.expires_at, u.id, u.nickname, u.email, u.role_id, u.is_banned,
           p.display_name, p.avatar_url, p.bio, p.level, p.xp, p.daily_streak
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).get(token) as any;

  if (!session || session.is_banned) {
    return null;
  }
  return session;
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

app.post('/api/auth/register', authRateLimit, (req: Request, res: Response) => {
  const { nickname, password } = req.body;
  const nickCheck = validateNickname(nickname);
  if (!nickCheck.valid) {
    res.status(400).json({ error: nickCheck.error });
    return;
  }
  const passCheck = validatePassword(password);
  if (!passCheck.valid) {
    res.status(400).json({ error: passCheck.error });
    return;
  }

  const trimmedNick = nickname.trim();
  const normalizedNick = trimmedNick.toLowerCase();
  if (normalizedNick === 'sushkanov097' || normalizedNick === 'deathmarried_admin') {
    res.status(403).json({ error: 'This administrator nickname is reserved.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE nickname = ?').get(trimmedNick);
  if (existing) {
    res.status(409).json({ error: 'Nickname already taken.' });
    return;
  }

  const userId = 'usr_' + crypto.randomUUID().slice(0, 8);
  const hash = bcrypt.hashSync(password, 10);
  const assignedRole = 'user';

  const insertUser = db.prepare(`
    INSERT INTO users (id, nickname, password_hash, role_id)
    VALUES (?, ?, ?, ?)
  `);
  const insertProfile = db.prepare(`
    INSERT INTO profiles (user_id, display_name, avatar_url, bio, level, xp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertUser.run(userId, trimmedNick, hash, assignedRole);
    insertProfile.run(
      userId,
      trimmedNick,
      '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      'deathmarried archive member.',
      1,
      0
    );
  })();

  const token = issueSessionForUser(res, {
    id: userId,
    nickname: trimmedNick,
    role_id: assignedRole,
  });

  res.json({
    user: {
      id: userId,
      nickname: trimmedNick,
      email: null,
      role_id: assignedRole,
      display_name: trimmedNick,
      avatar_url: '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      bio: 'deathmarried archive member.',
      level: 1,
      xp: 0,
      daily_streak: 0,
    },
    token,
  });
});

app.post('/api/auth/login', authRateLimit, (req: Request, res: Response) => {
  const { nickname, password } = req.body || {};
  if (typeof nickname !== 'string' || typeof password !== 'string' || !nickname.trim() || !password) {
    res.status(400).json({ error: 'Nickname and password are required.' });
    return;
  }

  const user = db.prepare(`
    SELECT u.id, u.nickname, u.email, u.password_hash, u.role_id, u.is_banned, u.ban_reason,
           p.display_name, p.avatar_url, p.bio, p.level, p.xp, p.daily_streak
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE (u.nickname = ? COLLATE NOCASE OR u.email = ? COLLATE NOCASE)
  `).get(nickname.trim(), nickname.trim()) as any;

  if (!user) {
    res.status(401).json({ error: 'Invalid nickname or password.' });
    return;
  }

  if (user.is_banned) {
    res.status(403).json({ error: `Account suspended: ${user.ban_reason || 'Violation of sanctuary rules.'}` });
    return;
  }

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) {
    res.status(401).json({ error: 'Invalid nickname or password.' });
    return;
  }

  // Auto-elevate sushkanov097 to admin if needed
  if ((user.nickname.toLowerCase() === 'sushkanov097' || (user.email && user.email.toLowerCase() === 'sushkanov097@gmail.com')) && user.role_id !== 'admin') {
    db.prepare("UPDATE users SET role_id = 'admin', email = 'sushkanov097@gmail.com' WHERE id = ?").run(user.id);
    user.role_id = 'admin';
  }

  const token = issueSessionForUser(res, {
    id: user.id,
    nickname: user.nickname,
    role_id: user.role_id,
  });

  const { password_hash, ...cleanUser } = user;
  res.json({ user: cleanUser, token });
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
app.post('/api/admin/delete-file', requireAdminOrMod, async (req: AuthRequest, res: Response) => {
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

  // Fetch unlocked achievements
  const achievements = db.prepare(`
    SELECT a.slug, a.title_ru, a.title_en, a.desc_ru, a.desc_en, a.icon, ua.unlocked_at
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
// API: ARCHIVE (ALBUMS, SINGLES, TRACKS)
// ----------------------------------------------------------------------------

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
app.post('/api/archive/albums', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.put('/api/archive/albums/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.delete('/api/archive/albums/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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
app.post('/api/archive/tracks', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.put('/api/archive/tracks/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.delete('/api/archive/tracks/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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
app.post('/api/archive/singles', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.put('/api/archive/singles/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.delete('/api/archive/singles/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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
app.get('/api/admin/audio-files', requireAdminOrMod, (_req: Request, res: Response) => {
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
      audio_url: String(row.audio_url || '').trim(),
      duration_seconds: resolveEffectiveTrackDuration(String(row.audio_url || ''), Number(row.duration_seconds) || 0),
      source: 'track' as const,
      album_title: row.album_title,
      cover_url: row.cover_url,
    })),
    ...rawSingles.map((row) => ({
      id: String(row.id),
      title: String(row.title || '').trim(),
      audio_url: String(row.audio_url || '').trim(),
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

function getOrCreateDailyQuizChallenge(utcDate: string): ValidatedQuizQuestion[] {
  const rawQuestions = db.prepare(`
    SELECT id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty, is_active
    FROM quiz_questions
    WHERE is_active = 1
  `).all() as RawQuizQuestion[];

  const validById = new Map<string, ValidatedQuizQuestion>();
  for (const raw of rawQuestions) {
    const valid = parseAndValidateQuizQuestion(raw);
    if (valid && !validById.has(valid.id)) {
      validById.set(valid.id, valid);
    }
  }
  if (validById.size === 0) return [];

  const existing = db.prepare(`
    SELECT id, questions_json FROM daily_challenges WHERE challenge_date = ?
  `).get(utcDate) as { id: string; questions_json: string } | undefined;

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
        if (resolved.length > 0) {
          return resolved;
        }
      }
    } catch {}
  }

  // Avoid repeating questions used in the last 3 UTC days when enough questions exist
  const recentRows = db.prepare(`
    SELECT questions_json FROM daily_challenges
    WHERE challenge_date < ?
    ORDER BY challenge_date DESC
    LIMIT 3
  `).all(utcDate) as Array<{ questions_json: string }>;

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
    utcDate,
    rawQuestions,
    recentQuestionIds,
    limit: DEFAULT_DAILY_QUIZ_COUNT,
    secret: getDailyChallengeSecret(),
  });
  if (selected.length === 0) return [];

  const selectedIds = selected.map((q) => q.id);
  const rowId = existing?.id || `dq_${utcDate.replace(/-/g, '')}`;
  if (existing) {
    db.prepare(`UPDATE daily_challenges SET questions_json = ? WHERE challenge_date = ?`).run(
      JSON.stringify(selectedIds),
      utcDate
    );
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO daily_challenges (id, challenge_date, questions_json)
      VALUES (?, ?, ?)
    `).run(rowId, utcDate, JSON.stringify(selectedIds));
  }

  const persisted = db.prepare(`SELECT questions_json FROM daily_challenges WHERE challenge_date = ?`).get(utcDate) as
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

// 1. Daily Guess The Track (shared 24h UTC challenge with exact 5-second snippet)
app.get('/api/games/guess-track/round', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const today = getUtcDateString();
  const nextResetAt = getNextUtcMidnightIso(today);

  const daily = getOrCreateDailyTrackChallenge(today);
  if (!daily) {
    res.status(404).json({ error: 'В архиве пока нет доступных аудиофайлов для ежедневного испытания.' });
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
    const attempt = db.prepare(`
      SELECT * FROM daily_track_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, today) as any;
    if (attempt) {
      alreadyCompleted = true;
      previousAttempt = {
        correct: Boolean(attempt.is_correct),
        selected_track_id: attempt.selected_track_id,
        correct_track_id: attempt.track_id,
        score: Number(attempt.score) || 0,
        xp_earned: Number(attempt.xp_earned) || 0,
        track: getTrackRevealInfo(attempt.track_id) || { id: daily.track.id, title: daily.track.title },
      };
    }
  }

  // Notice: correct track id is NEVER returned until user completes today's challenge!
  res.json({
    challenge_date: today,
    next_reset_at: nextResetAt,
    round_token: `daily:${today}`,
    audio_url: daily.track.audio_url,
    snippet_start: daily.snippet_start_seconds,
    snippet_start_ratio: daily.snippet_start_ratio,
    snippet_duration: daily.snippet_duration_seconds,
    options: daily.options,
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
  const today = getUtcDateString();
  const nextResetAt = getNextUtcMidnightIso(today);

  // Extract client challenge date (if provided) to gracefully handle midnight UTC rollover
  let clientDate: string | null = null;
  if (isValidUtcDateString(challenge_date)) {
    clientDate = challenge_date;
  } else if (typeof round_token === 'string' && round_token.startsWith('daily:')) {
    const extracted = round_token.slice('daily:'.length);
    if (isValidUtcDateString(extracted)) {
      clientDate = extracted;
    }
  }

  if (clientDate && clientDate !== today) {
    res.status(409).json({
      error: 'Наступил новый день (UTC) — доступно новое ежедневное испытание!',
      code: 'DAILY_ROLLOVER',
      challenge_date: today,
      next_reset_at: nextResetAt,
    });
    return;
  }

  const daily = getOrCreateDailyTrackChallenge(today);
  if (!daily) {
    res.status(404).json({ error: 'Ежедневное испытание временно недоступно.' });
    return;
  }

  if (!daily.options.some((o) => o.id === selected_track_id)) {
    res.status(400).json({ error: 'Selected option is not valid for today\'s challenge.' });
    return;
  }

  if (user) {
    const existingAttempt = db.prepare(`
      SELECT id FROM daily_track_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, today);
    if (existingAttempt) {
      res.status(400).json({
        error: 'Вы уже прошли сегодняшнее испытание «Угадай трек». Новое появится в 00:00 UTC!',
        already_completed: true,
      });
      return;
    }
  }

  const correctTrackId = daily.track.id;
  const isCorrect = correctTrackId === selected_track_id;
  const safeTimeSpent = Math.max(1, Math.min(180, Math.round(Number(time_spent) || 10)));
  const score = isCorrect ? 100 : 0;
  let xpEarned = 5;
  if (isCorrect) {
    // 15 XP base + speed bonus if under 15 seconds (up to 10 extra)
    const speed = Math.max(0, 15 - Math.floor(safeTimeSpent));
    xpEarned = 15 + Math.min(10, speed);
  }

  const trackInfo = getTrackRevealInfo(correctTrackId) || {
    id: daily.track.id,
    title: daily.track.title,
    album_title: daily.track.album_title || 'Single',
    cover_url: daily.track.cover_url,
  };

  if (user) {
    try {
      db.transaction(() => {
        // Ensure today's daily track challenge row is persisted in the DB snapshot synced to Supabase
        db.prepare(`
          INSERT OR IGNORE INTO daily_track_challenges
            (id, challenge_date, track_id, track_source, snippet_start_seconds, snippet_start_ratio, snippet_duration_seconds, options_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          daily.id,
          today,
          daily.track.id,
          daily.track.source,
          daily.snippet_start_seconds,
          daily.snippet_start_ratio,
          daily.snippet_duration_seconds,
          JSON.stringify(daily.options)
        );

        // Enforce strictly 1 rewarded attempt per user per UTC day
        db.prepare(`
          INSERT INTO daily_track_attempts
            (id, user_id, challenge_date, track_id, selected_track_id, is_correct, score, xp_earned, time_spent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'dta_' + crypto.randomUUID().slice(0, 8),
          user.id,
          today,
          correctTrackId,
          selected_track_id,
          isCorrect ? 1 : 0,
          score,
          xpEarned,
          safeTimeSpent
        );

        // Record game attempt
        db.prepare(`
          INSERT INTO game_attempts (id, user_id, game_id, score, xp_earned, details_json)
          VALUES (?, ?, 'guess-track', ?, ?, ?)
        `).run(
          'att_' + crypto.randomUUID().slice(0, 8),
          user.id,
          score,
          xpEarned,
          JSON.stringify({ isCorrect, correctTrackId, challengeDate: today })
        );

        // Record XP transaction
        db.prepare(`
          INSERT INTO xp_transactions (id, user_id, amount, source, details)
          VALUES (?, ?, ?, 'guess_track', ?)
        `).run(
          'xpt_' + crypto.randomUUID().slice(0, 8),
          user.id,
          xpEarned,
          isCorrect ? `Daily Guess Track (${today}): Correct` : `Daily Guess Track (${today}): Participation`
        );

        const prev = db.prepare('SELECT total_xp, daily_streak, last_active_date FROM profiles WHERE user_id = ?').get(user.id) as any;
        const nextStreak = computeDailyStreak(prev?.last_active_date, today, prev?.daily_streak || 0);
        const nextTotalXp = (prev?.total_xp || 0) + xpEarned;
        const { level } = calculateLevelFromXp(nextTotalXp);

        db.prepare(`
          UPDATE profiles SET
            xp = xp + ?,
            total_xp = ?,
            level = ?,
            daily_streak = ?,
            last_active_date = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `).run(xpEarned, nextTotalXp, level, nextStreak, today, user.id);

        // Check achievements
        const attemptsCount = (db.prepare('SELECT COUNT(*) as c FROM game_attempts WHERE user_id = ?').get(user.id) as any).c;
        if (attemptsCount >= 1) unlockAchievement(user.id, 'first_blood');
        if (attemptsCount >= 10) unlockAchievement(user.id, 'initiate_ritual');
        if (nextStreak >= 3) unlockAchievement(user.id, 'devoted_acolyte');
        if (nextStreak >= 7) unlockAchievement(user.id, 'eternal_vigil');
        if (nextTotalXp >= 500) unlockAchievement(user.id, 'dark_apostle');
      })();
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(400).json({
          error: 'Вы уже прошли сегодняшнее испытание «Угадай трек». Новое появится в 00:00 UTC!',
          already_completed: true,
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
    score,
    xp_earned: xpEarned,
    track: trackInfo,
    challenge_date: today,
    next_reset_at: nextResetAt,
  });
});

// 2. Daily Quiz with 24h UTC persisted set & duplicate protection
app.get('/api/games/quiz/daily', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const today = getUtcDateString();
  const nextResetAt = getNextUtcMidnightIso(today);

  let alreadyCompleted = false;
  let previousScore = 0;
  let previousXp = 0;

  if (user) {
    const attempt = db.prepare(`
      SELECT * FROM quiz_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, today) as any;
    if (attempt) {
      alreadyCompleted = true;
      previousScore = attempt.score;
      previousXp = attempt.xp_earned;
    }
  }

  const questions = getOrCreateDailyQuizChallenge(today);
  const sanitized = questions.map((q) => ({
    id: q.id,
    question_ru: q.question_ru,
    question_en: q.question_en,
    options: q.options,
    difficulty: q.difficulty,
  }));

  res.json({
    questions: sanitized,
    already_completed: alreadyCompleted,
    previous_score: previousScore,
    previous_xp: previousXp,
    challenge_date: today,
    next_reset_at: nextResetAt,
  });
});

app.post('/api/games/quiz/submit', (req: AuthRequest, res: Response) => {
  const { answers, time_spent_seconds, challenge_date } = req.body || {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    res.status(400).json({ error: 'Answers must be provided.' });
    return;
  }

  const user = getSessionUser(req);
  const today = getUtcDateString();
  const nextResetAt = getNextUtcMidnightIso(today);

  if (isValidUtcDateString(challenge_date) && challenge_date !== today) {
    res.status(409).json({
      error: 'Наступил новый день (UTC) — доступна новая ежедневная викторина!',
      code: 'DAILY_ROLLOVER',
      challenge_date: today,
      next_reset_at: nextResetAt,
    });
    return;
  }

  if (user) {
    const existingAttempt = db.prepare(`
      SELECT id FROM quiz_attempts WHERE user_id = ? AND challenge_date = ?
    `).get(user.id, today);

    if (existingAttempt) {
      res.status(400).json({ error: 'Вы уже прошли ежедневную викторину сегодня. Возвращайтесь завтра!' });
      return;
    }
  }

  const dailyQuestions = getOrCreateDailyQuizChallenge(today);
  if (dailyQuestions.length === 0) {
    res.status(404).json({ error: 'Вопросы для ежедневной викторины не найдены.' });
    return;
  }

  let correctCount = 0;
  const matchedQuestions = dailyQuestions.filter((q) => answers[q.id] !== undefined);
  if (matchedQuestions.length === 0) {
    res.status(400).json({ error: 'Не переданы ответы на сегодняшние вопросы викторины.' });
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
    };
  });

  const safeTime = Math.max(1, Math.min(3600, Number(time_spent_seconds) || 30));
  const { baseScore, speedBonus, totalXp } = calculateQuizScore(total, correctCount, safeTime);

  if (user) {
    try {
      db.transaction(() => {
        // Ensure today's daily_challenges row is persisted in the DB snapshot synced to Supabase
        db.prepare(`
          INSERT OR IGNORE INTO daily_challenges (id, challenge_date, questions_json)
          VALUES (?, ?, ?)
        `).run(`dq_${today.replace(/-/g, '')}`, today, JSON.stringify(dailyQuestions.map((q) => q.id)));

        // Record in quiz_attempts (UNIQUE(user_id, challenge_date) enforces single reward)
        db.prepare(`
          INSERT INTO quiz_attempts (id, user_id, challenge_date, score, xp_earned)
          VALUES (?, ?, ?, ?, ?)
        `).run('qa_' + crypto.randomUUID().slice(0, 8), user.id, today, baseScore, totalXp);

        // Record in game_attempts
        db.prepare(`
          INSERT INTO game_attempts (id, user_id, game_id, score, xp_earned, details_json)
          VALUES (?, ?, 'daily-quiz', ?, ?, ?)
        `).run(
          'att_' + crypto.randomUUID().slice(0, 8),
          user.id,
          baseScore,
          totalXp,
          JSON.stringify({ correctCount, total, challengeDate: today })
        );

        // Record XP transaction
        db.prepare(`
          INSERT INTO xp_transactions (id, user_id, amount, source, details)
          VALUES (?, ?, ?, 'daily_quiz', ?)
        `).run('xpt_' + crypto.randomUUID().slice(0, 8), user.id, totalXp, `Daily Quiz (${today}): ${correctCount}/${total}`);

        const prev = db.prepare('SELECT total_xp, daily_streak, last_active_date FROM profiles WHERE user_id = ?').get(user.id) as any;
        const nextStreak = computeDailyStreak(prev?.last_active_date, today, prev?.daily_streak || 0);
        const nextTotalXp = (prev?.total_xp || 0) + totalXp;
        const { level } = calculateLevelFromXp(nextTotalXp);

        // Update spendable XP, total XP, level, and streak accurately
        db.prepare(`
          UPDATE profiles SET
            xp = xp + ?,
            total_xp = ?,
            level = ?,
            daily_streak = ?,
            last_active_date = ?,
            updated_at = datetime('now')
          WHERE user_id = ?
        `).run(totalXp, nextTotalXp, level, nextStreak, today, user.id);

        // Check achievements
        unlockAchievement(user.id, 'first_blood');
        if (nextStreak >= 3) unlockAchievement(user.id, 'devoted_acolyte');
        if (nextStreak >= 7) unlockAchievement(user.id, 'eternal_vigil');
        if (correctCount === total && total >= 3) {
          unlockAchievement(user.id, 'lore_scholar');
        }
        if (nextTotalXp >= 500) {
          unlockAchievement(user.id, 'dark_apostle');
        }
      })();
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(400).json({ error: 'Вы уже прошли ежедневную викторину сегодня. Возвращайтесь завтра!' });
        return;
      }
      throw err;
    }
  }

  res.json({
    total,
    correct_count: correctCount,
    base_score: baseScore,
    speed_bonus: speedBonus,
    total_xp: totalXp,
    results,
    challenge_date: today,
    next_reset_at: nextResetAt,
  });
});

// Helper for unlocking achievements safely
function unlockAchievement(userId: string, achievementSlug: string) {
  const ach = db.prepare('SELECT id FROM achievements WHERE slug = ?').get(achievementSlug) as any;
  if (!ach) return;
  db.prepare(`
    INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id)
    VALUES (?, ?, ?)
  `).run('uach_' + crypto.randomUUID().slice(0, 8), userId, ach.id);
}

// 3. Leaderboard (All-Time, Weekly, Monthly + optional Game filter)
app.get('/api/games/leaderboard', (req: Request, res: Response) => {
  const rawTimeframe = String(req.query.timeframe || 'all');
  const timeframe = rawTimeframe === 'weekly' || rawTimeframe === 'monthly' ? rawTimeframe : 'all';
  const rawGame = String(req.query.game || 'all');
  const gameFilter = rawGame === 'guess-track' || rawGame === 'daily-quiz' ? rawGame : 'all';

  if (gameFilter !== 'all') {
    const timeClause =
      timeframe === 'weekly'
        ? "AND datetime(ga.created_at) >= datetime('now', '-7 days')"
        : timeframe === 'monthly'
          ? "AND datetime(ga.created_at) >= datetime('now', '-30 days')"
          : '';
    const leaders = db.prepare(`
      SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level,
             p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge,
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
      ORDER BY xp DESC, score DESC, games_played DESC
      LIMIT 50
    `).all(gameFilter);
    res.json({ leaders, timeframe, game: gameFilter });
    return;
  }

  let query = `
    SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level, p.total_xp as xp, p.daily_streak,
           p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge,
           (SELECT COUNT(*) FROM game_attempts WHERE user_id = u.id) as games_played
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.is_banned = 0
      AND (p.total_xp > 0 OR EXISTS (SELECT 1 FROM game_attempts ga WHERE ga.user_id = u.id))
    ORDER BY p.total_xp DESC, games_played DESC, p.level DESC
    LIMIT 50
  `;

  if (timeframe === 'weekly') {
    query = `
      SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level,
             p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge,
             COALESCE(SUM(xt.amount), 0) as xp, p.daily_streak,
             (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id AND datetime(ga.created_at) >= datetime('now', '-7 days')) as games_played
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      LEFT JOIN xp_transactions xt ON xt.user_id = u.id AND xt.amount > 0 AND datetime(xt.created_at) >= datetime('now', '-7 days')
      WHERE u.is_banned = 0
      GROUP BY u.id
      HAVING xp > 0 OR games_played > 0
      ORDER BY xp DESC, games_played DESC
      LIMIT 50
    `;
  } else if (timeframe === 'monthly') {
    query = `
      SELECT u.id, u.nickname, p.display_name, p.avatar_url, p.level,
             p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge,
             COALESCE(SUM(xt.amount), 0) as xp, p.daily_streak,
             (SELECT COUNT(*) FROM game_attempts ga WHERE ga.user_id = u.id AND datetime(ga.created_at) >= datetime('now', '-30 days')) as games_played
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      LEFT JOIN xp_transactions xt ON xt.user_id = u.id AND xt.amount > 0 AND datetime(xt.created_at) >= datetime('now', '-30 days')
      WHERE u.is_banned = 0
      GROUP BY u.id
      HAVING xp > 0 OR games_played > 0
      ORDER BY xp DESC, games_played DESC
      LIMIT 50
    `;
  }

  const leaders = db.prepare(query).all();
  res.json({ leaders, timeframe, game: gameFilter });
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

app.post('/api/shop/buy', requireAuth, (req: AuthRequest, res: Response) => {
  const { item_id } = req.body;
  if (!item_id) {
    res.status(400).json({ error: 'Item ID is required.' });
    return;
  }

  const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND is_active = 1').get(item_id) as any;
  if (!item) {
    res.status(404).json({ error: 'Item not found in catalog.' });
    return;
  }

  const user = db.prepare(`
    SELECT p.xp, p.total_xp FROM profiles p WHERE p.user_id = ?
  `).get(req.user!.id) as any;

  if (user.xp < item.cost_xp) {
    res.status(400).json({ error: `Недостаточно XP. Требуется: ${item.cost_xp} XP, у вас: ${user.xp} XP.` });
    return;
  }

  const alreadyOwned = db.prepare('SELECT id FROM user_inventory WHERE user_id = ? AND item_id = ?').get(req.user!.id, item_id);
  if (alreadyOwned) {
    res.status(400).json({ error: 'Этот предмет уже есть в вашем инвентаре.' });
    return;
  }

  db.transaction(() => {
    // Deduct spendable XP only (total_xp remains untouched so level never decreases!)
    db.prepare('UPDATE profiles SET xp = xp - ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(item.cost_xp, req.user!.id);

    // Insert into user_inventory
    db.prepare(`
      INSERT INTO user_inventory (id, user_id, item_id, is_equipped)
      VALUES (?, ?, ?, 0)
    `).run('inv_' + crypto.randomUUID().slice(0, 8), req.user!.id, item_id);

    // Record transaction
    db.prepare(`
      INSERT INTO xp_transactions (id, user_id, amount, source, details)
      VALUES (?, ?, ?, 'shop_purchase', ?)
    `).run('xpt_' + crypto.randomUUID().slice(0, 8), req.user!.id, -item.cost_xp, `Purchased ${item.name_ru}`);

    // Unlock collector achievement
    unlockAchievement(req.user!.id, 'collector');
  })();

  const updatedProfile = db.prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?').get(req.user!.id) as any;
  res.json({ ok: true, new_xp: updatedProfile.xp, profile: updatedProfile });
});

app.post('/api/shop/equip', requireAuth, (req: AuthRequest, res: Response) => {
  const { item_id, equip } = req.body;
  if (!item_id) {
    res.status(400).json({ error: 'Item ID is required.' });
    return;
  }

  const owned = db.prepare(`
    SELECT ui.*, si.category, si.preview_value
    FROM user_inventory ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ? AND ui.item_id = ?
  `).get(req.user!.id, item_id) as any;

  if (!owned) {
    res.status(403).json({ error: 'You do not own this item.' });
    return;
  }

  const shouldEquip = equip !== undefined ? Boolean(equip) : !owned.is_equipped;

  db.transaction(() => {
    if (shouldEquip) {
      // Unequip any item of same category
      db.prepare(`
        UPDATE user_inventory
        SET is_equipped = 0
        WHERE user_id = ? AND item_id IN (SELECT id FROM shop_items WHERE category = ?)
      `).run(req.user!.id, owned.category);

      // Equip this item
      db.prepare('UPDATE user_inventory SET is_equipped = 1 WHERE user_id = ? AND item_id = ?').run(req.user!.id, item_id);

      // Update profile column
      let column = '';
      if (owned.category === 'frame') column = 'equipped_frame';
      else if (owned.category === 'banner') column = 'equipped_banner';
      else if (owned.category === 'name_style') column = 'equipped_name_style';
      else if (owned.category === 'badge') column = 'equipped_badge';

      if (column) {
        db.prepare(`UPDATE profiles SET ${column} = ? WHERE user_id = ?`).run(owned.preview_value, req.user!.id);
      }
    } else {
      // Unequip item
      db.prepare('UPDATE user_inventory SET is_equipped = 0 WHERE user_id = ? AND item_id = ?').run(req.user!.id, item_id);

      let column = '';
      if (owned.category === 'frame') column = 'equipped_frame';
      else if (owned.category === 'banner') column = 'equipped_banner';
      else if (owned.category === 'name_style') column = 'equipped_name_style';
      else if (owned.category === 'badge') column = 'equipped_badge';

      if (column) {
        db.prepare(`UPDATE profiles SET ${column} = NULL WHERE user_id = ?`).run(req.user!.id);
      }
    }
  })();

  res.json({ ok: true, is_equipped: shouldEquip });
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
           pr.equipped_badge as author_badge,
           c.name_ru as category_name_ru, c.name_en as category_name_en, c.slug as category_slug,
           c.is_official as category_is_official
    FROM posts p
    JOIN users u ON u.id = p.user_id
    JOIN profiles pr ON pr.user_id = u.id
    JOIN post_categories c ON c.id = p.category_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 100
  `;

  const posts = db.prepare(query).all(...params);
  res.json({ posts });
});

app.get('/api/community/posts/:id', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const post = db.prepare(`
    SELECT p.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge,
           c.name_ru as category_name_ru, c.name_en as category_name_en, c.slug as category_slug,
           c.is_official as category_is_official
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

  // Increment view count
  db.prepare('UPDATE posts SET views_count = views_count + 1 WHERE id = ?').run(post.id);

  const comments = db.prepare(`
    SELECT cm.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge
    FROM comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE cm.post_id = ?
    ORDER BY cm.created_at ASC
  `).all(post.id);

  let userReaction = null;
  if (user) {
    const rx = db.prepare("SELECT reaction_type FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?").get(post.id, user.id) as any;
    userReaction = rx?.reaction_type || null;
  }

  res.json({ post, comments, userReaction });
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

  // Regular user posts need moderation, staff posts are auto-approved
  const status = isStaff ? 'approved' : 'pending';
  const id = 'post_' + crypto.randomUUID().slice(0, 8);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO posts (id, user_id, category_id, title, content, media_url, media_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user!.id, category_id, cleanTitle, cleanContent, media_url ? String(media_url).trim() : null, media_type || null, status);

    // Award XP for posting (20 XP) & recalculate level
    db.prepare(`
      UPDATE profiles SET xp = xp + 20, total_xp = total_xp + 20, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(req.user!.id);
    const updated = db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(req.user!.id) as any;
    const { level } = calculateLevelFromXp(updated.total_xp);
    db.prepare('UPDATE profiles SET level = ? WHERE user_id = ?').run(level, req.user!.id);

    db.prepare(`
      INSERT INTO xp_transactions (id, user_id, amount, source, details)
      VALUES (?, ?, 20, 'community_post', ?)
    `).run('xpt_' + crypto.randomUUID().slice(0, 8), req.user!.id, `Created post: ${cleanTitle.slice(0, 30)}`);

    const postCount = (db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(req.user!.id) as any).c;
    if (postCount >= 3) {
      unlockAchievement(req.user!.id, 'voice_of_abyss');
    }
    if (updated.total_xp >= 500) {
      unlockAchievement(req.user!.id, 'dark_apostle');
    }
  })();

  res.json({ ok: true, id, status });
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

  db.prepare(`
    UPDATE posts SET status = ?, rejection_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, rejection_reason || null, req.params.id);

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

  const targetPost = db.prepare('SELECT id, is_locked FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!targetPost) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const isStaff = req.user!.role_id === 'admin' || req.user!.role_id === 'moderator';
  if (targetPost.is_locked && !isStaff) {
    res.status(403).json({ error: 'This discussion is locked by moderators.' });
    return;
  }

  const id = 'cm_' + crypto.randomUUID().slice(0, 8);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO comments (id, user_id, post_id, content, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.user!.id, req.params.id, cleanContent, parent_id || null);

    db.prepare(`
      UPDATE posts SET comments_count = comments_count + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);

    // Give 5 XP for participation & recalculate level
    db.prepare(`
      UPDATE profiles SET xp = xp + 5, total_xp = total_xp + 5, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(req.user!.id);
    const updated = db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(req.user!.id) as any;
    const { level } = calculateLevelFromXp(updated.total_xp);
    db.prepare('UPDATE profiles SET level = ? WHERE user_id = ?').run(level, req.user!.id);

    db.prepare(`
      INSERT INTO xp_transactions (id, user_id, amount, source, details)
      VALUES (?, ?, 5, 'comment', 'Posted a comment')
    `).run('xpt_' + crypto.randomUUID().slice(0, 8), req.user!.id);

    if (updated.total_xp >= 500) {
      unlockAchievement(req.user!.id, 'dark_apostle');
    }
  })();

  res.json({ ok: true, id });
});

app.post('/api/community/posts/:id/react', requireAuth, (req: AuthRequest, res: Response) => {
  const { reaction_type } = req.body; // 'rose', 'flame', 'skull', 'heart'
  const valid = ['rose', 'flame', 'skull', 'heart'].includes(reaction_type) ? reaction_type : 'rose';
  const postId = req.params.id;

  const target = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!target) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }

  const existing = db.prepare(`
    SELECT id, reaction_type FROM reactions WHERE target_type = 'post' AND target_id = ? AND user_id = ?
  `).get(postId, req.user!.id) as any;

  if (existing) {
    if (existing.reaction_type === valid) {
      // Remove reaction
      db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
      db.prepare('UPDATE posts SET reactions_count = MAX(0, reactions_count - 1) WHERE id = ?').run(postId);
      res.json({ reacted: false });
      return;
    } else {
      // Change reaction
      db.prepare('UPDATE reactions SET reaction_type = ? WHERE id = ?').run(valid, existing.id);
      res.json({ reacted: true, reaction_type: valid });
      return;
    }
  } else {
    // Add new reaction
    db.prepare(`
      INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type)
      VALUES (?, ?, 'post', ?, ?)
    `).run('rx_' + crypto.randomUUID().slice(0, 8), req.user!.id, postId, valid);
    db.prepare('UPDATE posts SET reactions_count = reactions_count + 1 WHERE id = ?').run(postId);
    res.json({ reacted: true, reaction_type: valid });
  }
});

app.delete('/api/community/posts/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id) as any;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return;
  }
  if (post.user_id !== req.user!.id && req.user!.role_id !== 'admin' && req.user!.role_id !== 'moderator') {
    res.status(403).json({ error: 'Cannot delete others posts' });
    return;
  }

  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/community/comments/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const comment = db.prepare('SELECT id, user_id, post_id, creation_id FROM comments WHERE id = ?').get(req.params.id) as any;
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
    db.prepare('DELETE FROM comments WHERE parent_id = ?').run(comment.id);
    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
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
    conditions.push('c.category = ?');
    params.push(category);
  }

  if (search && typeof search === 'string' && search.trim()) {
    conditions.push('(c.title LIKE ? OR c.description LIKE ?)');
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  let orderBy = 'c.created_at DESC';
  if (sort === 'popular') {
    orderBy = 'c.likes_count DESC, c.created_at DESC';
  }

  const creations = db.prepare(`
    SELECT c.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge
    FROM creations c
    JOIN users u ON u.id = c.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT 100
  `).all(...params);

  res.json({ creations });
});

app.get('/api/creations/:id', (req: Request, res: Response) => {
  const user = getSessionUser(req);
  const creation = db.prepare(`
    SELECT c.*, u.nickname as author_nickname, pr.display_name as author_name,
           pr.avatar_url as author_avatar, pr.level as author_level,
           pr.equipped_frame as author_frame, pr.equipped_name_style as author_name_style,
           pr.equipped_badge as author_badge
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
    WHERE cm.creation_id = ?
    ORDER BY cm.created_at ASC
  `).all(creation.id);

  let liked = false;
  let favorited = false;
  if (user) {
    const rx = db.prepare("SELECT id FROM reactions WHERE target_type = 'creation' AND target_id = ? AND user_id = ?").get(creation.id, user.id);
    liked = Boolean(rx);
    const fav = db.prepare("SELECT id FROM favorites WHERE target_type = 'creation' AND target_id = ? AND user_id = ?").get(creation.id, user.id);
    favorited = Boolean(fav);
  }

  res.json({ creation: { ...creation, views_count: (creation.views_count || 0) + 1 }, comments, liked, favorited });
});

app.post('/api/creations/:id/comments', requireAuth, (req: AuthRequest, res: Response) => {
  const { content, parent_id } = req.body;
  const cleanContent = content ? String(content).trim().slice(0, 2000) : '';
  if (!cleanContent) {
    res.status(400).json({ error: 'Comment content cannot be empty.' });
    return;
  }

  const creation = db.prepare('SELECT id FROM creations WHERE id = ?').get(req.params.id);
  if (!creation) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }

  const id = 'cm_' + crypto.randomUUID().slice(0, 8);
  db.transaction(() => {
    db.prepare(`
      INSERT INTO comments (id, user_id, creation_id, content, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.user!.id, req.params.id, cleanContent, parent_id || null);

    db.prepare(`
      UPDATE profiles SET xp = xp + 5, total_xp = total_xp + 5, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(req.user!.id);
    const updated = db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(req.user!.id) as any;
    const { level } = calculateLevelFromXp(updated.total_xp);
    db.prepare('UPDATE profiles SET level = ? WHERE user_id = ?').run(level, req.user!.id);

    db.prepare(`
      INSERT INTO xp_transactions (id, user_id, amount, source, details)
      VALUES (?, ?, 5, 'comment', 'Commented on gallery creation')
    `).run('xpt_' + crypto.randomUUID().slice(0, 8), req.user!.id);

    if (updated.total_xp >= 500) {
      unlockAchievement(req.user!.id, 'dark_apostle');
    }
  })();

  res.json({ ok: true, id });
});

app.post('/api/creations', requireAuth, (req: AuthRequest, res: Response) => {
  const { title, category, description, media_url, media_type } = req.body;
  if (!title || !category || !media_url) {
    res.status(400).json({ error: 'Title, category, and media URL are required.' });
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

  db.transaction(() => {
    db.prepare(`
      INSERT INTO creations (id, user_id, title, category, description, media_url, media_type, status, is_approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user!.id, cleanTitle, category, description ? String(description).slice(0, 3000) : '', String(media_url).trim(), media_type || 'image', status, status === 'approved' ? 1 : 0);

    // Give 50 XP for creative contribution & recalculate level
    db.prepare(`
      UPDATE profiles SET xp = xp + 50, total_xp = total_xp + 50, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(req.user!.id);
    const updated = db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(req.user!.id) as any;
    const { level } = calculateLevelFromXp(updated.total_xp);
    db.prepare('UPDATE profiles SET level = ? WHERE user_id = ?').run(level, req.user!.id);

    db.prepare(`
      INSERT INTO xp_transactions (id, user_id, amount, source, details)
      VALUES (?, ?, 50, 'creation_upload', ?)
    `).run('xpt_' + crypto.randomUUID().slice(0, 8), req.user!.id, `Uploaded work: ${cleanTitle.slice(0, 30)}`);

    unlockAchievement(req.user!.id, 'gothic_artisan');
    if (updated.total_xp >= 500) {
      unlockAchievement(req.user!.id, 'dark_apostle');
    }
  })();

  res.json({ ok: true, id, status });
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
    category || existing.category,
    description !== undefined ? String(description).slice(0, 3000) : existing.description,
    media_url ? String(media_url).trim() : existing.media_url,
    media_type || existing.media_type,
    existing.id
  );
  res.json({ ok: true });
});

app.post('/api/admin/creations/:id/moderate', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const { status, rejection_reason } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    res.status(400).json({ error: 'Invalid moderation status' });
    return;
  }

  db.prepare(`
    UPDATE creations SET
      status = ?,
      is_approved = ?,
      rejection_reason = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(status, status === 'approved' ? 1 : 0, rejection_reason || null, req.params.id);

  res.json({ ok: true, status });
});

app.post('/api/creations/:id/react', requireAuth, (req: AuthRequest, res: Response) => {
  const creationId = req.params.id;
  const target = db.prepare('SELECT id FROM creations WHERE id = ?').get(creationId);
  if (!target) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }
  const existing = db.prepare(`
    SELECT id FROM reactions WHERE target_type = 'creation' AND target_id = ? AND user_id = ?
  `).get(creationId, req.user!.id) as any;

  if (existing) {
    db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
    db.prepare('UPDATE creations SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(creationId);
    res.json({ liked: false });
  } else {
    db.prepare(`
      INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type)
      VALUES (?, ?, 'creation', ?, 'rose')
    `).run('rx_' + crypto.randomUUID().slice(0, 8), req.user!.id, creationId);
    db.prepare('UPDATE creations SET likes_count = likes_count + 1 WHERE id = ?').run(creationId);
    res.json({ liked: true });
  }
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
  const creation = db.prepare('SELECT user_id FROM creations WHERE id = ?').get(req.params.id) as any;
  if (!creation) {
    res.status(404).json({ error: 'Creation not found' });
    return;
  }
  if (creation.user_id !== req.user!.id && req.user!.role_id !== 'admin' && req.user!.role_id !== 'moderator') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  db.prepare('DELETE FROM creations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// API: PROFILES & SOCIAL
// ----------------------------------------------------------------------------

app.get('/api/profiles/:nickname', (req: Request, res: Response) => {
  const currentUser = getSessionUser(req);
  const profile = db.prepare(`
    SELECT u.id, u.nickname, u.role_id, u.is_banned, u.created_at as registered_at,
           p.display_name, p.avatar_url, p.bio, p.level, p.xp, p.total_xp, p.daily_streak, p.is_private,
           p.custom_status, p.equipped_frame, p.equipped_banner, p.equipped_name_style, p.equipped_badge
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.nickname = ? COLLATE NOCASE
  `).get(req.params.nickname) as any;

  if (!profile) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  // Follower counts
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following_count,
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) as posts_count,
      (SELECT COUNT(*) FROM creations WHERE user_id = ?) as creations_count,
      (SELECT COUNT(*) FROM game_attempts WHERE user_id = ?) as games_played
  `).get(profile.id, profile.id, profile.id, profile.id, profile.id) as any;

  // Is following?
  let isFollowing = false;
  if (currentUser && currentUser.id !== profile.id) {
    const f = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(currentUser.id, profile.id);
    isFollowing = Boolean(f);
  }

  // Achievements
  const achievements = db.prepare(`
    SELECT a.slug, a.title_ru, a.title_en, a.desc_ru, a.desc_en, a.icon, ua.unlocked_at
    FROM user_achievements ua
    JOIN achievements a ON a.id = ua.achievement_id
    WHERE ua.user_id = ?
    ORDER BY ua.unlocked_at DESC
  `).all(profile.id);

  // User's recent creations and posts
  const recentCreations = db.prepare(`
    SELECT * FROM creations WHERE user_id = ? AND (status = 'approved' OR user_id = ?) ORDER BY created_at DESC LIMIT 6
  `).all(profile.id, currentUser?.id || '');

  const recentPosts = db.prepare(`
    SELECT p.*, c.name_ru as category_name_ru, c.name_en as category_name_en
    FROM posts p
    JOIN post_categories c ON c.id = p.category_id
    WHERE p.user_id = ? AND (p.status = 'approved' OR p.user_id = ?)
    ORDER BY p.created_at DESC LIMIT 6
  `).all(profile.id, currentUser?.id || '');

  // User inventory
  const inventory = db.prepare(`
    SELECT ui.*, si.name_ru, si.name_en, si.category, si.preview_value, si.rarity
    FROM user_inventory ui
    JOIN shop_items si ON si.id = ui.item_id
    WHERE ui.user_id = ?
    ORDER BY ui.purchased_at DESC
  `).all(profile.id);

  // User's favorite creations
  const favoriteCreations = db.prepare(`
    SELECT c.*, u.nickname as author_nickname, pr.display_name as author_name
    FROM favorites f
    JOIN creations c ON c.id = f.target_id
    JOIN users u ON u.id = c.user_id
    JOIN profiles pr ON pr.user_id = u.id
    WHERE f.user_id = ? AND f.target_type = 'creation' AND c.status = 'approved'
    ORDER BY f.created_at DESC
    LIMIT 12
  `).all(profile.id);

  res.json({
    profile: {
      ...profile,
      ...counts,
      isFollowing,
      achievements,
      recentCreations,
      recentPosts,
      favoriteCreations,
      inventory,
    },
  });
});

app.get('/api/profiles/:nickname/history', (req: Request, res: Response) => {
  const user = db.prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE').get(req.params.nickname) as any;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const xpTransactions = db.prepare(`
    SELECT * FROM xp_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(user.id);

  const gameAttempts = db.prepare(`
    SELECT * FROM game_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(user.id);

  res.json({ xpTransactions, gameAttempts });
});

app.post('/api/profiles/:nickname/follow', requireAuth, (req: AuthRequest, res: Response) => {
  const target = db.prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE').get(req.params.nickname) as any;
  if (!target) {
    res.status(404).json({ error: 'Target user not found' });
    return;
  }
  if (target.id === req.user!.id) {
    res.status(400).json({ error: 'Cannot follow yourself' });
    return;
  }

  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user!.id, target.id) as any;
  if (existing) {
    db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').run(
      'flw_' + crypto.randomUUID().slice(0, 8),
      req.user!.id,
      target.id
    );
    res.json({ following: true });
  }
});

app.put('/api/profiles/me', requireAuth, (req: AuthRequest, res: Response) => {
  const { display_name, bio, avatar_url, is_private, custom_status } = req.body;
  if (avatar_url && !isSafeMediaUrl(String(avatar_url))) {
    res.status(400).json({ error: 'Invalid avatar URL.' });
    return;
  }
  db.prepare(`
    UPDATE profiles SET
      display_name = COALESCE(?, display_name),
      bio = COALESCE(?, bio),
      avatar_url = COALESCE(?, avatar_url),
      is_private = COALESCE(?, is_private),
      custom_status = COALESCE(?, custom_status),
      updated_at = datetime('now')
    WHERE user_id = ?
  `).run(
    display_name !== undefined ? String(display_name).trim().slice(0, 60) : null,
    bio !== undefined ? String(bio).slice(0, 500) : null,
    avatar_url !== undefined ? (avatar_url ? String(avatar_url).trim() : null) : null,
    is_private !== undefined ? (is_private ? 1 : 0) : null,
    custom_status !== undefined ? String(custom_status).slice(0, 120) : null,
    req.user!.id
  );

  res.json({ ok: true });
});

// Admin Game Pool management (Automatic audio linking)
app.get('/api/admin/game-tracks', requireAdminOrMod, (_req: Request, res: Response) => {
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

app.post('/api/admin/game-tracks/:id/toggle', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.get('/api/admin/users', requireAdminOrMod, (_req: Request, res: Response) => {
  const users = db.prepare(`
    SELECT u.id, u.nickname, u.email, u.role_id, u.is_banned, u.ban_reason, u.created_at as registered_at,
           p.display_name, p.level, p.xp,
           (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as posts_count,
           (SELECT COUNT(*) FROM creations WHERE user_id = u.id) as creations_count
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users });
});

app.post('/api/admin/users/:id/ban', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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

app.get('/api/admin/stats', requireAdminOrMod, (_req: Request, res: Response) => {
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

// Admin Quiz Question management
app.get('/api/admin/quiz-questions', requireAdminOrMod, (_req: Request, res: Response) => {
  const questions = db.prepare('SELECT * FROM quiz_questions ORDER BY created_at DESC').all();
  res.json({ questions });
});

app.post('/api/admin/quiz-questions', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  const { question_ru, question_en, options, correct_index, explanation_ru, explanation_en, difficulty } = req.body || {};
  if (
    typeof question_ru !== 'string' ||
    !question_ru.trim() ||
    typeof question_en !== 'string' ||
    !question_en.trim() ||
    !Array.isArray(options) ||
    options.length < 2 ||
    correct_index === undefined
  ) {
    res.status(400).json({ error: 'Missing required quiz question fields' });
    return;
  }
  const id = 'qz_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO quiz_questions (id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    question_ru.trim(),
    question_en.trim(),
    JSON.stringify(options),
    Math.max(0, Math.min(Number(correct_index) || 0, options.length - 1)),
    typeof explanation_ru === 'string' ? explanation_ru : '',
    typeof explanation_en === 'string' ? explanation_en : '',
    Number(difficulty) || 1
  );

  res.json({ ok: true, id });
});

app.put('/api/admin/quiz-questions/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
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
    typeof question_ru === 'string' ? question_ru : null,
    typeof question_en === 'string' ? question_en : null,
    Array.isArray(options) ? JSON.stringify(options) : null,
    correct_index !== undefined ? Number(correct_index) : null,
    typeof explanation_ru === 'string' ? explanation_ru : null,
    typeof explanation_en === 'string' ? explanation_en : null,
    difficulty !== undefined ? Number(difficulty) : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/admin/quiz-questions/:id', requireAdminOrMod, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM quiz_questions WHERE id = ?').run(req.params.id);
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

app.get('/api/admin/leaderboard', requireAdminOrMod, (req: Request, res: Response) => {
  const rawTimeframe = String(req.query.timeframe || 'all');
  const timeframe = rawTimeframe === 'weekly' || rawTimeframe === 'monthly' ? rawTimeframe : 'all';
  const rawGame = String(req.query.game || 'all');
  const gameFilter = rawGame === 'guess-track' || rawGame === 'daily-quiz' ? rawGame : 'all';
  const search = String(req.query.search || '').trim().toLowerCase();
  const today = getUtcDateString();

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
      EXISTS(SELECT 1 FROM daily_track_attempts dta WHERE dta.user_id = u.id AND dta.challenge_date = @today) as completed_today_track,
      EXISTS(SELECT 1 FROM quiz_attempts qa WHERE qa.user_id = u.id AND qa.challenge_date = @today) as completed_today_quiz
    FROM users u
    JOIN profiles p ON p.user_id = u.id
  `).all({ gameFilter, today }) as any[];

  const enriched = rows
    .map((row) => {
      const rankXp =
        gameFilter !== 'all'
          ? Number(row.game_xp) || 0
          : timeframe === 'all'
            ? Number(row.total_xp) || 0
            : Number(row.period_xp) || 0;
      const scopedGamesPlayed =
        gameFilter === 'guess-track'
          ? Number(row.guess_track_played) || 0
          : gameFilter === 'daily-quiz'
            ? Number(row.daily_quiz_played) || 0
            : Number(row.games_played) || 0;
      return {
        ...row,
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
      if (b.rank_xp !== a.rank_xp) return b.rank_xp - a.rank_xp;
      if (b.game_score !== a.game_score) return b.game_score - a.game_score;
      return b.scoped_games_played - a.scoped_games_played;
    });

  const todayTrack = getOrCreateDailyTrackChallenge(today);
  const todayQuiz = getOrCreateDailyQuizChallenge(today);
  const totalAttempts = (db.prepare('SELECT COUNT(*) as c FROM game_attempts').get() as any)?.c || 0;
  const todayTrackAttempts = (db.prepare('SELECT COUNT(*) as c FROM daily_track_attempts WHERE challenge_date = ?').get(today) as any)?.c || 0;
  const todayQuizAttempts = (db.prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE challenge_date = ?').get(today) as any)?.c || 0;

  res.json({
    leaders: enriched,
    timeframe,
    game: gameFilter,
    summary: {
      today_utc: today,
      next_reset_at: getNextUtcMidnightIso(today),
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
  const allowedScopes = new Set(['all', 'weekly', 'monthly', 'guess-track', 'daily-quiz', 'daily-attempts']);
  if (!allowedScopes.has(rawScope)) {
    res.status(400).json({ error: 'Invalid leaderboard clear scope.' });
    return;
  }

  const today = getUtcDateString();
  const removed = {
    game_attempts: 0,
    daily_track_attempts: 0,
    quiz_attempts: 0,
    xp_transactions: 0,
    profiles_updated: 0,
  };

  db.transaction(() => {
    if (rawScope === 'all') {
      removed.game_attempts = db.prepare('DELETE FROM game_attempts').run().changes;
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts').run().changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts').run().changes;
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE source IN ('guess_track', 'daily_quiz') OR amount > 0").run().changes;
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
      removed.xp_transactions = db.prepare(`DELETE FROM xp_transactions WHERE amount > 0 AND datetime(created_at) >= datetime('now', ?)`).run(windowSql).changes;

      for (const item of xpByUser) {
        adjustUserProfileAfterXpRemoval(item.user_id, item.sum_xp);
        removed.profiles_updated += 1;
      }
    } else if (rawScope === 'guess-track') {
      const xpByUser = db.prepare(`
        SELECT user_id, COALESCE(SUM(xp_earned), 0) as sum_xp
        FROM game_attempts
        WHERE game_id = 'guess-track'
        GROUP BY user_id
      `).all() as Array<{ user_id: string; sum_xp: number }>;

      removed.game_attempts = db.prepare("DELETE FROM game_attempts WHERE game_id = 'guess-track'").run().changes;
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts').run().changes;
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE source = 'guess_track'").run().changes;

      for (const item of xpByUser) {
        adjustUserProfileAfterXpRemoval(item.user_id, item.sum_xp);
        removed.profiles_updated += 1;
      }
    } else if (rawScope === 'daily-quiz') {
      const xpByUser = db.prepare(`
        SELECT user_id, COALESCE(SUM(xp_earned), 0) as sum_xp
        FROM game_attempts
        WHERE game_id = 'daily-quiz'
        GROUP BY user_id
      `).all() as Array<{ user_id: string; sum_xp: number }>;

      removed.game_attempts = db.prepare("DELETE FROM game_attempts WHERE game_id = 'daily-quiz'").run().changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts').run().changes;
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE source = 'daily_quiz'").run().changes;

      for (const item of xpByUser) {
        adjustUserProfileAfterXpRemoval(item.user_id, item.sum_xp);
        removed.profiles_updated += 1;
      }
    } else if (rawScope === 'daily-attempts') {
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE challenge_date = ?').run(today).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE challenge_date = ?').run(today).changes;
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
  const allowedScopes = new Set(['all', 'guess-track', 'daily-quiz', 'daily-attempts']);
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

  const today = getUtcDateString();
  const removed = {
    game_attempts: 0,
    daily_track_attempts: 0,
    quiz_attempts: 0,
    xp_transactions: 0,
  };

  db.transaction(() => {
    if (rawScope === 'all') {
      removed.game_attempts = db.prepare('DELETE FROM game_attempts WHERE user_id = ?').run(userId).changes;
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(userId).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(userId).changes;
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE user_id = ? AND (source IN ('guess_track', 'daily_quiz') OR amount > 0)").run(userId).changes;
      db.prepare(`
        UPDATE profiles
        SET xp = 0, total_xp = 0, level = 1, daily_streak = 0, last_active_date = NULL, updated_at = datetime('now')
        WHERE user_id = ?
      `).run(userId);
    } else if (rawScope === 'guess-track') {
      const sumRow = db.prepare("SELECT COALESCE(SUM(xp_earned), 0) as sum_xp FROM game_attempts WHERE user_id = ? AND game_id = 'guess-track'").get(userId) as any;
      removed.game_attempts = db.prepare("DELETE FROM game_attempts WHERE user_id = ? AND game_id = 'guess-track'").run(userId).changes;
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ?').run(userId).changes;
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE user_id = ? AND source = 'guess_track'").run(userId).changes;
      adjustUserProfileAfterXpRemoval(userId, Number(sumRow?.sum_xp) || 0);
    } else if (rawScope === 'daily-quiz') {
      const sumRow = db.prepare("SELECT COALESCE(SUM(xp_earned), 0) as sum_xp FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz'").get(userId) as any;
      removed.game_attempts = db.prepare("DELETE FROM game_attempts WHERE user_id = ? AND game_id = 'daily-quiz'").run(userId).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(userId).changes;
      removed.xp_transactions = db.prepare("DELETE FROM xp_transactions WHERE user_id = ? AND source = 'daily_quiz'").run(userId).changes;
      adjustUserProfileAfterXpRemoval(userId, Number(sumRow?.sum_xp) || 0);
    } else if (rawScope === 'daily-attempts') {
      removed.daily_track_attempts = db.prepare('DELETE FROM daily_track_attempts WHERE user_id = ? AND challenge_date = ?').run(userId, today).changes;
      removed.quiz_attempts = db.prepare('DELETE FROM quiz_attempts WHERE user_id = ? AND challenge_date = ?').run(userId, today).changes;
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

// Step 1 of direct cloud upload (bypasses Vercel 4.5MB serverless body limit for large MP3/WAV files)
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
  const classified = classifyMediaUpload(filename, typeof mimetype === 'string' ? mimetype : '');
  if (!classified.allowed) {
    res.status(400).json({
      error: 'Disallowed file type. Only audio (MP3, WAV, FLAC, OGG, M4A), images (JPG, PNG, WEBP, GIF), and video (MP4, WEBM, MOV) are accepted.',
    });
    return;
  }

  if (!isSupabaseConfigured()) {
    res.json({ direct: false, reason: 'supabase-not-configured' });
    return;
  }

  const storedFilename = buildSafeUploadFilename(filename, typeof mimetype === 'string' ? mimetype : '');
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
    kind: classified.kind,
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
  const classified = classifyMediaUpload(safeOriginal, safeMime);
  if (!classified.allowed) {
    res.status(400).json({ error: 'Disallowed media type.' });
    return;
  }

  const fileUrl = `/uploads/${path.basename(storedFilename)}`;
  const numericSize = Math.max(0, Number(size) || 0);
  const fileId = indexUploadedMediaMetadata(classified.kind, safeOriginal, safeMime, numericSize, fileUrl, req.user?.id || null);

  res.json({
    id: fileId,
    url: fileUrl,
    filename: safeOriginal,
    mimetype: safeMime,
    size: numericSize,
    is_audio: classified.kind === 'audio',
    is_image: classified.kind === 'image',
    is_video: classified.kind === 'video',
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

    const fileUrl = `/uploads/${req.file.filename}`;
    const classified = classifyMediaUpload(req.file.originalname, req.file.mimetype);
    const isAudio = classified.kind === 'audio';
    const isImage = classified.kind === 'image';
    const isVideo = classified.kind === 'video';

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
      classified.kind,
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

// Serve uploaded files from disk first, falling back to SQLite uploaded_blobs, then Supabase Storage (with HTTP Range streaming)
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
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
        if (!isNaN(start) && !isNaN(end) && start >= 0 && end < total && start <= end) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          res.end(buffer.subarray(start, end + 1));
          return;
        }
      }

      res.setHeader('Content-Length', String(total));
      res.end(buffer);
      return;
    }

    // Fallback to Supabase Storage (supports large MP3/WAV files >25MB and direct signed uploads)
    const cloudMedia = await fetchMediaFromSupabase(filename, req.headers.range);
    if (cloudMedia) {
      res.status(cloudMedia.status);
      res.setHeader('Content-Type', cloudMedia.contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
app.use('/uploads', express.static(uploadDir));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'public', 'uploads')));
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
