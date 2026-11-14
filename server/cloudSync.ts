import { serializeDatabase, replaceDatabaseWithBuffer, getDbPath } from './db.js';

const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'apostles-archive-persistence';
const DB_OBJECT_PATH = 'db/apostles.db';

let initialRestorePromise: Promise<void> | null = null;
let initialRestoreCompleted = false;
let lastBackupAt = 0;
let backupInFlight = false;
let pendingBackup = false;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  );
}

function getSupabaseHeaders(contentType = 'application/octet-stream'): Record<string, string> {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': contentType,
  };
}

function getSupabaseBaseUrl(): string {
  return (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

async function ensureBucketExists(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const baseUrl = getSupabaseBaseUrl();
  try {
    const checkRes = await fetch(`${baseUrl}/storage/v1/bucket/${BUCKET_NAME}`, {
      method: 'GET',
      headers: getSupabaseHeaders('application/json'),
    });
    if (checkRes.status === 404 || checkRes.status === 400) {
      await fetch(`${baseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: getSupabaseHeaders('application/json'),
        body: JSON.stringify({
          id: BUCKET_NAME,
          name: BUCKET_NAME,
          public: false,
        }),
      });
    }
  } catch (err) {
    console.warn('[CloudSync] Bucket check warning:', err);
  }
}

/**
 * Restores the latest SQLite snapshot from Supabase Storage on Vercel cold start.
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
      const res = await fetch(`${baseUrl}/storage/v1/object/${BUCKET_NAME}/${DB_OBJECT_PATH}`, {
        method: 'GET',
        headers: getSupabaseHeaders(),
      });

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Validate SQLite magic header ("SQLite format 3\0")
        if (buffer.length > 100 && buffer.subarray(0, 15).toString('utf8') === 'SQLite format 3') {
          replaceDatabaseWithBuffer(buffer);
          console.log(`[CloudSync] Restored SQLite snapshot from Supabase (${buffer.length} bytes)`);
        }
      } else if (res.status === 404 || res.status === 400) {
        // First run: upload our local seeded database to initialize cloud storage
        await pushDatabaseBackupNow();
      }
    } catch (err) {
      console.warn('[CloudSync] Cold-start restore skipped or failed:', err);
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
    const buffer = serializeDatabase();
    const res = await fetch(`${baseUrl}/storage/v1/object/${BUCKET_NAME}/${DB_OBJECT_PATH}`, {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders('application/octet-stream'),
        'x-upsert': 'true',
      },
      body: new Uint8Array(buffer),
    });
    if (res.ok) {
      lastBackupAt = Date.now();
      return true;
    } else {
      const errText = await res.text().catch(() => '');
      console.warn(`[CloudSync] Backup upload returned ${res.status}: ${errText}`);
      return false;
    }
  } catch (err) {
    console.warn('[CloudSync] Failed to push database snapshot:', err);
    return false;
  } finally {
    backupInFlight = false;
    if (pendingBackup) {
      pendingBackup = false;
      void pushDatabaseBackupNow();
    }
  }
}

export function getCloudSyncStatus() {
  const isVercel = Boolean(process.env.VERCEL);
  const supabaseReady = isSupabaseConfigured();
  return {
    environment: isVercel ? 'vercel-serverless' : 'node-server',
    database_path: getDbPath(),
    cloud_persistence_enabled: supabaseReady,
    storage_mode: supabaseReady
      ? 'supabase-cloud-synced-sqlite'
      : isVercel
        ? 'vercel-tmp-with-bundled-seed'
        : 'local-persistent-sqlite',
    last_backup_at: lastBackupAt ? new Date(lastBackupAt).toISOString() : null,
  };
}
