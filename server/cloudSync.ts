import crypto from 'crypto';
import { serializeDatabase, replaceDatabaseWithBuffer, getDbPath } from './db.js';

const DEFAULT_BUCKET_NAME = 'apostles-archive-persistence';
const DB_OBJECT_PATH = 'db/apostles.db';
const MEDIA_OBJECT_PREFIX = 'media';

export interface SyncPullResult {
  updated: boolean;
  notModified?: boolean;
  initialized?: boolean;
  etag?: string | null;
  error?: string;
}

export interface SyncPushResult {
  ok: boolean;
  status?: number;
  bytes?: number;
  etag?: string | null;
  error?: string;
}

interface CloudSyncHooks {
  fetchImpl: typeof fetch;
  serializeDb: () => Buffer;
  replaceDb: (buf: Buffer) => void;
}

let hooks: CloudSyncHooks = {
  fetchImpl: fetch,
  serializeDb: serializeDatabase,
  replaceDb: replaceDatabaseWithBuffer,
};

let initialRestoreCompleted = false;
let bucketEnsured = false;
let lastBackupAt = 0;
let lastBackupError: string | null = null;
let lastKnownEtag: string | null = null;
let lastKnownLastModified: string | null = null;
let lastSyncedSha256: string | null = null;
let lastSyncCheckedAt = 0;

// Serializes all database pull/push operations on this process so concurrent requests
// never overwrite each other's DB handle or drop a mutation upload.
let syncQueue: Promise<unknown> = Promise.resolve();

function enqueueSyncOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = syncQueue.then(fn, fn);
  syncQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function getBucketName(): string {
  return (process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET_NAME).trim();
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function getSupabaseKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
}

function getSupabaseHeaders(contentType?: string): Record<string, string> {
  const key = getSupabaseKey();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

function getSupabaseBaseUrl(): string {
  return (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildMediaObjectPath(filename: string): string {
  const safeName = filename.replace(/[/\\]+/g, '').replace(/\.\./g, '');
  return `${MEDIA_OBJECT_PREFIX}/${safeName}`;
}

function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isValidSqliteBuffer(buffer: Buffer): boolean {
  return buffer.length > 100 && buffer.subarray(0, 15).toString('utf8') === 'SQLite format 3';
}

export async function ensureBucketExists(): Promise<void> {
  if (!isSupabaseConfigured() || bucketEnsured) return;
  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  try {
    const checkRes = await hooks.fetchImpl(`${baseUrl}/storage/v1/bucket/${encodeURIComponent(bucketName)}`, {
      method: 'GET',
      headers: getSupabaseHeaders('application/json'),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (checkRes.ok) {
      bucketEnsured = true;
      return;
    }
    if (checkRes.status === 404 || checkRes.status === 400) {
      const createRes = await hooks.fetchImpl(`${baseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: getSupabaseHeaders('application/json'),
        body: JSON.stringify({
          id: bucketName,
          name: bucketName,
          public: false,
          file_size_limit: 104857600, // 100 MB
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (createRes.ok || createRes.status === 409) {
        bucketEnsured = true;
      } else {
        const errText = await createRes.text().catch(() => '');
        console.warn(`[CloudSync] Bucket create returned ${createRes.status}: ${errText.slice(0, 200)}`);
      }
    }
  } catch (err) {
    console.warn('[CloudSync] Bucket check warning:', err instanceof Error ? err.message : 'unknown error');
  }
}

async function refreshRemoteEtagQuietly(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  try {
    const headRes = await hooks.fetchImpl(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeObjectPath(DB_OBJECT_PATH)}`,
      {
        method: 'HEAD',
        headers: {
          ...getSupabaseHeaders(),
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      }
    );
    if (headRes.ok) {
      const etag = headRes.headers.get('etag');
      const lastMod = headRes.headers.get('last-modified');
      if (etag) lastKnownEtag = etag;
      if (lastMod) lastKnownLastModified = lastMod;
      return etag;
    }
  } catch {}
  return lastKnownEtag;
}

async function uploadCurrentDatabaseInternal(): Promise<SyncPushResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase Storage is not configured' };
  }

  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  const objectUrl = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeObjectPath(DB_OBJECT_PATH)}`;

  await ensureBucketExists();

  let buffer: Buffer;
  try {
    buffer = hooks.serializeDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to serialize SQLite database';
    lastBackupError = msg;
    return { ok: false, error: msg };
  }

  const localSha = computeSha256(buffer);
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await hooks.fetchImpl(objectUrl, {
        method: 'POST',
        headers: {
          ...getSupabaseHeaders('application/octet-stream'),
          'x-upsert': 'true',
          'cache-control': '0',
        },
        body: new Uint8Array(buffer),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        lastBackupAt = Date.now();
        lastBackupError = null;
        lastSyncedSha256 = localSha;
        lastSyncCheckedAt = Date.now();
        initialRestoreCompleted = true;

        const responseEtag = res.headers.get('etag');
        if (responseEtag) {
          lastKnownEtag = responseEtag;
        } else {
          lastKnownEtag = null;
          await refreshRemoteEtagQuietly();
        }

        return {
          ok: true,
          status: res.status,
          bytes: buffer.length,
          etag: lastKnownEtag,
        };
      }

      const errText = await res.text().catch(() => '');
      const errMsg = `HTTP ${res.status}${errText ? `: ${errText.slice(0, 220)}` : ''}`;
      const isRetryable = res.status >= 500 || res.status === 429;
      if (isRetryable && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      lastBackupError = errMsg;
      console.error(`[CloudSync] Backup upload failed (${errMsg})`);
      return { ok: false, status: res.status, error: errMsg };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'backup network error';
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      lastBackupError = errMsg;
      console.error('[CloudSync] Failed to push database snapshot:', errMsg);
      return { ok: false, error: errMsg };
    }
  }

  return { ok: false, error: lastBackupError || 'Unknown backup error' };
}

async function pullDatabaseFromSupabaseInternal(options: {
  force?: boolean;
  minIntervalMs?: number;
}): Promise<SyncPullResult> {
  if (!isSupabaseConfigured()) {
    initialRestoreCompleted = true;
    return { updated: false, notModified: true };
  }

  const minInterval = options.minIntervalMs ?? 0;
  if (
    !options.force &&
    initialRestoreCompleted &&
    minInterval > 0 &&
    Date.now() - lastSyncCheckedAt < minInterval
  ) {
    return { updated: false, notModified: true, etag: lastKnownEtag };
  }

  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  const objectUrl = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeObjectPath(DB_OBJECT_PATH)}`;

  try {
    await ensureBucketExists();

    const headers: Record<string, string> = {
      ...getSupabaseHeaders(),
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    };
    if (initialRestoreCompleted && lastKnownEtag) {
      headers['If-None-Match'] = lastKnownEtag;
    }

    const res = await hooks.fetchImpl(objectUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 304) {
      lastSyncCheckedAt = Date.now();
      initialRestoreCompleted = true;
      return { updated: false, notModified: true, etag: lastKnownEtag };
    }

    if (res.ok) {
      const remoteEtag = res.headers.get('etag');
      const remoteLastMod = res.headers.get('last-modified');
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (!isValidSqliteBuffer(buffer)) {
        const msg = `Remote snapshot is not a valid SQLite database (${buffer.length} bytes)`;
        lastBackupError = msg;
        console.warn(`[CloudSync] ${msg}`);
        initialRestoreCompleted = true;
        return { updated: false, error: msg };
      }

      const remoteSha = computeSha256(buffer);
      const shouldReplace = !initialRestoreCompleted || remoteSha !== lastSyncedSha256;

      if (shouldReplace) {
        hooks.replaceDb(buffer);
        lastSyncedSha256 = remoteSha;
        console.log(`[CloudSync] Synced fresh SQLite snapshot from Supabase (${buffer.length} bytes)`);
      }

      if (remoteEtag) lastKnownEtag = remoteEtag;
      if (remoteLastMod) lastKnownLastModified = remoteLastMod;
      lastSyncCheckedAt = Date.now();
      initialRestoreCompleted = true;
      lastBackupError = null;

      return {
        updated: shouldReplace,
        notModified: !shouldReplace,
        etag: lastKnownEtag,
      };
    }

    if (res.status === 404 || res.status === 400) {
      if (!initialRestoreCompleted) {
        // First run: upload our local seeded database to initialize cloud storage
        const initPush = await uploadCurrentDatabaseInternal();
        initialRestoreCompleted = true;
        return {
          updated: false,
          initialized: initPush.ok,
          etag: initPush.etag,
          error: initPush.ok ? undefined : initPush.error,
        };
      }
      lastSyncCheckedAt = Date.now();
      return { updated: false, notModified: true };
    }

    const errText = await res.text().catch(() => '');
    const errMsg = `Restore HTTP ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`;
    lastBackupError = errMsg;
    console.warn(`[CloudSync] Pull failed: ${errMsg}`);
    return { updated: false, error: errMsg };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'restore failed';
    lastBackupError = errMsg;
    console.warn('[CloudSync] Pull skipped or failed:', errMsg);
    return { updated: false, error: errMsg };
  }
}

/**
 * Checks Supabase Storage for a newer SQLite snapshot (using If-None-Match ETag & SHA-256 comparison)
 * and hot-swaps the local /tmp/apostles.db when another serverless instance wrote newer data.
 */
export async function syncCloudDatabase(options: {
  force?: boolean;
  minIntervalMs?: number;
} = {}): Promise<SyncPullResult> {
  if (!isSupabaseConfigured()) {
    initialRestoreCompleted = true;
    return { updated: false, notModified: true };
  }
  return enqueueSyncOp(() => pullDatabaseFromSupabaseInternal(options));
}

/**
 * Restores the latest SQLite snapshot from Supabase Storage on cold start.
 * If no remote snapshot exists yet, uploads the current seeded database so the cloud
 * store is initialized immediately with zero data loss.
 */
export async function ensureCloudDatabaseRestored(): Promise<void> {
  if (initialRestoreCompleted || !isSupabaseConfigured()) {
    initialRestoreCompleted = true;
    return;
  }
  await syncCloudDatabase({ force: true });
}

/**
 * Checkpoints SQLite (DELETE journal mode), serializes the database, and uploads it to
 * Supabase Storage with x-upsert: true. Always awaits completion and returns structured status.
 */
export async function pushDatabaseBackupNow(): Promise<SyncPushResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase Storage is not configured' };
  }
  return enqueueSyncOp(() => uploadCurrentDatabaseInternal());
}

/**
 * Mirrors an uploaded media file (MP3, WAV, cover image, video) into Supabase Storage
 * so large audio files survive serverless cold starts and redeploys.
 */
export async function uploadMediaToSupabase(
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  const objectPath = buildMediaObjectPath(filename);

  try {
    await ensureBucketExists();
    const res = await hooks.fetchImpl(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeObjectPath(objectPath)}`,
      {
        method: 'POST',
        headers: {
          ...getSupabaseHeaders(mimeType || 'application/octet-stream'),
          'x-upsert': 'true',
          'cache-control': '31536000',
        },
        body: new Uint8Array(buffer),
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[CloudSync] Media upload failed (${res.status}): ${errText.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[CloudSync] Media upload error:', err instanceof Error ? err.message : 'unknown error');
    return false;
  }
}

/**
 * Generates a short-lived signed upload URL for direct browser-to-Supabase Storage uploads.
 * Bypasses serverless payload limits (e.g., Vercel's 4.5 MB function request cap) for large MP3/WAV files.
 */
export async function createSignedMediaUploadUrl(
  filename: string
): Promise<{ signedUrl: string; token?: string; objectPath: string } | null> {
  if (!isSupabaseConfigured()) return null;
  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  const objectPath = buildMediaObjectPath(filename);

  try {
    await ensureBucketExists();
    const res = await hooks.fetchImpl(
      `${baseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(bucketName)}/${encodeObjectPath(objectPath)}`,
      {
        method: 'POST',
        headers: {
          ...getSupabaseHeaders('application/json'),
          'x-upsert': 'true',
        },
        body: JSON.stringify({}),
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[CloudSync] Signed upload URL error (${res.status}): ${errText.slice(0, 200)}`);
      return null;
    }
    const payload = (await res.json().catch(() => ({}))) as { url?: string; token?: string };
    if (!payload.url) return null;

    const fullSignedUrl = payload.url.startsWith('http')
      ? payload.url
      : payload.url.startsWith('/storage/v1')
        ? `${baseUrl}${payload.url}`
        : `${baseUrl}/storage/v1${payload.url.startsWith('/') ? '' : '/'}${payload.url}`;

    return {
      signedUrl: fullSignedUrl,
      token: payload.token,
      objectPath,
    };
  } catch (err) {
    console.warn('[CloudSync] Failed to sign upload URL:', err instanceof Error ? err.message : 'unknown error');
    return null;
  }
}

/**
 * Fetches a media file from Supabase Storage, forwarding HTTP Range headers so browsers
 * can seek smoothly through MP3/WAV tracks via 206 Partial Content.
 */
export async function fetchMediaFromSupabase(
  filename: string,
  rangeHeader?: string
): Promise<{
  status: number;
  contentType: string;
  contentLength?: string;
  contentRange?: string;
  body: Buffer;
} | null> {
  if (!isSupabaseConfigured()) return null;
  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  const objectPath = buildMediaObjectPath(filename);

  try {
    const key = getSupabaseKey();
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }

    const res = await hooks.fetchImpl(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeObjectPath(objectPath)}`,
      { method: 'GET', headers }
    );
    if (!res.ok && res.status !== 206) {
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      contentLength: res.headers.get('content-length') || undefined,
      contentRange: res.headers.get('content-range') || undefined,
      body: Buffer.from(arrayBuffer),
    };
  } catch (err) {
    console.warn('[CloudSync] Failed to fetch media from Supabase:', err instanceof Error ? err.message : 'unknown error');
    return null;
  }
}

export async function deleteMediaFromSupabase(filename: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const baseUrl = getSupabaseBaseUrl();
  const bucketName = getBucketName();
  const objectPath = buildMediaObjectPath(filename);

  try {
    const res = await hooks.fetchImpl(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeObjectPath(objectPath)}`,
      {
        method: 'DELETE',
        headers: getSupabaseHeaders('application/json'),
      }
    );
    return res.ok || res.status === 404;
  } catch (err) {
    console.warn('[CloudSync] Failed to delete media from Supabase:', err instanceof Error ? err.message : 'unknown error');
    return false;
  }
}

export function getCloudSyncStatus() {
  const isVercel = Boolean(process.env.VERCEL);
  const supabaseReady = isSupabaseConfigured();
  return {
    environment: isVercel ? 'vercel-serverless' : 'node-server',
    database_path: getDbPath(),
    cloud_persistence_enabled: supabaseReady,
    direct_media_upload_enabled: supabaseReady,
    storage_bucket: supabaseReady ? getBucketName() : null,
    storage_mode: supabaseReady
      ? 'supabase-cloud-synced-sqlite'
      : isVercel
        ? 'vercel-tmp-with-bundled-seed'
        : 'local-persistent-sqlite',
    last_backup_at: lastBackupAt ? new Date(lastBackupAt).toISOString() : null,
    last_backup_error: lastBackupError,
    last_known_etag: lastKnownEtag,
    last_known_last_modified: lastKnownLastModified,
  };
}

/**
 * Internal helper for unit tests to inject mock fetch/db hooks and reset in-memory sync state.
 */
export function _configureCloudSyncForTests(partial?: Partial<CloudSyncHooks>) {
  initialRestoreCompleted = false;
  bucketEnsured = false;
  lastBackupAt = 0;
  lastBackupError = null;
  lastKnownEtag = null;
  lastKnownLastModified = null;
  lastSyncedSha256 = null;
  lastSyncCheckedAt = 0;
  syncQueue = Promise.resolve();
  hooks = {
    fetchImpl: partial?.fetchImpl || fetch,
    serializeDb: partial?.serializeDb || serializeDatabase,
    replaceDb: partial?.replaceDb || replaceDatabaseWithBuffer,
  };
}
