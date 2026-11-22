import { serializeDatabase, replaceDatabaseWithBuffer, getDbPath } from './db.js';

const BUCKET_NAME = (process.env.SUPABASE_STORAGE_BUCKET || 'apostles-archive-persistence').trim();
const DB_OBJECT_PATH = 'db/apostles.db';
const MEDIA_OBJECT_PREFIX = 'media';

let initialRestorePromise: Promise<void> | null = null;
let initialRestoreCompleted = false;
let bucketEnsured = false;
let lastBackupAt = 0;
let lastBackupError: string | null = null;
let backupInFlight = false;
let pendingBackup = false;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function getSupabaseKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
}

function getSupabaseHeaders(contentType = 'application/octet-stream'): Record<string, string> {
  const key = getSupabaseKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
  };
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

export async function ensureBucketExists(): Promise<void> {
  if (!isSupabaseConfigured() || bucketEnsured) return;
  const baseUrl = getSupabaseBaseUrl();
  try {
    const checkRes = await fetch(`${baseUrl}/storage/v1/bucket/${encodeURIComponent(BUCKET_NAME)}`, {
      method: 'GET',
      headers: getSupabaseHeaders('application/json'),
    });
    if (checkRes.ok) {
      bucketEnsured = true;
      return;
    }
    if (checkRes.status === 404 || checkRes.status === 400) {
      const createRes = await fetch(`${baseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: getSupabaseHeaders('application/json'),
        body: JSON.stringify({
          id: BUCKET_NAME,
          name: BUCKET_NAME,
          public: false,
          file_size_limit: 104857600, // 100 MB
        }),
      });
      if (createRes.ok || createRes.status === 409) {
        bucketEnsured = true;
      }
    }
  } catch (err) {
    console.warn('[CloudSync] Bucket check warning:', err instanceof Error ? err.message : 'unknown error');
  }
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
  if (initialRestorePromise) {
    return initialRestorePromise;
  }

  initialRestorePromise = (async () => {
    const baseUrl = getSupabaseBaseUrl();
    try {
      await ensureBucketExists();
      const res = await fetch(
        `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET_NAME)}/${encodeObjectPath(DB_OBJECT_PATH)}`,
        {
          method: 'GET',
          headers: getSupabaseHeaders(),
        }
      );

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Validate SQLite magic header ("SQLite format 3\0")
        if (buffer.length > 100 && buffer.subarray(0, 15).toString('utf8') === 'SQLite format 3') {
          replaceDatabaseWithBuffer(buffer);
          lastBackupError = null;
          console.log(`[CloudSync] Restored SQLite snapshot from Supabase (${buffer.length} bytes)`);
        }
      } else if (res.status === 404 || res.status === 400) {
        // First run: upload our local seeded database to initialize cloud storage
        await pushDatabaseBackupNow();
      } else {
        lastBackupError = `Restore HTTP ${res.status}`;
      }
    } catch (err) {
      lastBackupError = err instanceof Error ? err.message : 'restore failed';
      console.warn('[CloudSync] Cold-start restore skipped or failed:', lastBackupError);
    } finally {
      initialRestoreCompleted = true;
    }
  })();

  return initialRestorePromise;
}

export async function pushDatabaseBackupNow(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  if (backupInFlight) {
    pendingBackup = true;
    return false;
  }

  backupInFlight = true;
  const baseUrl = getSupabaseBaseUrl();

  try {
    await ensureBucketExists();
    const buffer = serializeDatabase();
    const res = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET_NAME)}/${encodeObjectPath(DB_OBJECT_PATH)}`,
      {
        method: 'POST',
        headers: {
          ...getSupabaseHeaders('application/octet-stream'),
          'x-upsert': 'true',
        },
        body: new Uint8Array(buffer),
      }
    );
    if (res.ok) {
      lastBackupAt = Date.now();
      lastBackupError = null;
      return true;
    } else {
      const errText = await res.text().catch(() => '');
      lastBackupError = `HTTP ${res.status}`;
      console.warn(`[CloudSync] Backup upload returned ${res.status}: ${errText.slice(0, 200)}`);
      return false;
    }
  } catch (err) {
    lastBackupError = err instanceof Error ? err.message : 'backup failed';
    console.warn('[CloudSync] Failed to push database snapshot:', lastBackupError);
    return false;
  } finally {
    backupInFlight = false;
    if (pendingBackup) {
      pendingBackup = false;
      void pushDatabaseBackupNow();
    }
  }
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
  const objectPath = buildMediaObjectPath(filename);

  try {
    await ensureBucketExists();
    const res = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET_NAME)}/${encodeObjectPath(objectPath)}`,
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
  const objectPath = buildMediaObjectPath(filename);

  try {
    await ensureBucketExists();
    const res = await fetch(
      `${baseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(BUCKET_NAME)}/${encodeObjectPath(objectPath)}`,
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

    const res = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET_NAME)}/${encodeObjectPath(objectPath)}`,
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
  const objectPath = buildMediaObjectPath(filename);

  try {
    const res = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET_NAME)}/${encodeObjectPath(objectPath)}`,
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
    storage_bucket: supabaseReady ? BUCKET_NAME : null,
    storage_mode: supabaseReady
      ? 'supabase-cloud-synced-sqlite'
      : isVercel
        ? 'vercel-tmp-with-bundled-seed'
        : 'local-persistent-sqlite',
    last_backup_at: lastBackupAt ? new Date(lastBackupAt).toISOString() : null,
    last_backup_error: lastBackupError,
  };
}
