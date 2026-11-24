import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  syncCloudDatabase,
  syncIfCloudNewer,
  ensureCloudDatabaseRestored,
  pushDatabaseBackupNow,
  uploadDatabaseToCloud,
  createSignedMediaUploadUrl,
  getCloudSyncStatus,
  _configureCloudSyncForTests,
} from './cloudSync.js';

function makeFakeSqliteBuffer(tag: string): Buffer {
  const header = Buffer.from('SQLite format 3\0', 'utf8');
  const body = Buffer.from(tag.padEnd(128, '_'), 'utf8');
  return Buffer.concat([header, body]);
}

function makeRealSeededSqliteBuffer(): Buffer {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, nickname TEXT NOT NULL);
    INSERT INTO albums (id, title) VALUES ('alb_test', 'nightmortan');
    INSERT INTO users (id, nickname) VALUES ('u_test', 'apostle_prod');
  `);
  const buf = mem.serialize();
  mem.close();
  return buf;
}

test('CloudSync pulls with ?t= cache-buster + no-store (never If-None-Match), never uploads on GET/404/400, and hot-swaps on change', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    let localBuf = makeFakeSqliteBuffer('v1-initial');
    let remoteBuf: Buffer | null = null;
    const seenGetUrls: string[] = [];
    const seenGetHeaders: Array<{ cacheControl: string | null; pragma: string | null; ifNoneMatch: string | null }> = [];
    const seenCacheModes: Array<RequestCache | undefined> = [];
    const seenUpsertHeaders: string[] = [];
    let bucketCheckCallsDuringGet = 0;
    let postUploadCount = 0;
    let replaceCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});

      if (url.includes('/storage/v1/bucket/')) {
        if (postUploadCount === 0) bucketCheckCallsDuringGet += 1;
        return new Response(JSON.stringify({ id: 'apostles-archive-persistence' }), { status: 200 });
      }

      if (url.includes('/storage/v1/object/')) {
        if (method === 'GET') {
          seenGetUrls.push(url);
          seenCacheModes.push(init?.cache);
          seenGetHeaders.push({
            cacheControl: headers.get('cache-control'),
            pragma: headers.get('pragma'),
            ifNoneMatch: headers.get('if-none-match'),
          });
          if (!remoteBuf) {
            // Simulate Supabase returning HTTP 400 with not_found payload
            return new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 400 });
          }
          return new Response(new Uint8Array(remoteBuf), { status: 200 });
        }
        if (method === 'POST') {
          postUploadCount += 1;
          seenUpsertHeaders.push(headers.get('x-upsert') || '');
          const bodyBytes = init?.body as Uint8Array;
          remoteBuf = Buffer.from(bodyBytes);
          return new Response(JSON.stringify({ Key: 'db/apostles.db' }), { status: 200 });
        }
      }
      return new Response('Not found', { status: 404 });
    };

    _configureCloudSyncForTests({
      fetchImpl: mockFetch,
      serializeDb: () => localBuf,
      replaceDb: (buf) => {
        localBuf = buf;
        replaceCount += 1;
      },
    });

    // 1. Cold-start GET when remote does not exist yet MUST NOT upload local DB and MUST NOT call bucket check!
    const missingPull = await syncCloudDatabase({ force: true });
    assert.equal(missingPull.notFound, true);
    assert.equal(postUploadCount, 0, 'GET/pull must NEVER upload apostles.db even on 404/400');
    assert.equal(bucketCheckCallsDuringGet, 0, 'Pull must download directly without calling ensureBucketExists()');

    // 2. Remote DB exists (v1) -> pull downloads with ?t= timestamp, no-cache headers, cache: no-store, no If-None-Match
    remoteBuf = makeFakeSqliteBuffer('v1-remote');
    const firstPull = await syncCloudDatabase({ force: true });
    assert.equal(firstPull.updated, true);
    assert.equal(replaceCount, 1);
    assert.match(seenGetUrls.at(-1)!, /\?t=\d+$/);
    assert.equal(seenCacheModes.at(-1), 'no-store');
    assert.equal(seenGetHeaders.at(-1)!.cacheControl, 'no-cache, no-store, max-age=0');
    assert.equal(seenGetHeaders.at(-1)!.pragma, 'no-cache');
    assert.equal(seenGetHeaders.at(-1)!.ifNoneMatch, null);

    // 3. Pulling again when bytes are identical still fetches with ?t= (never If-None-Match) and skips redundant DB reopen
    const secondPull = await syncCloudDatabase({ force: true });
    assert.equal(secondPull.updated, false);
    assert.equal(secondPull.notModified, true);
    assert.equal(seenGetHeaders.at(-1)!.ifNoneMatch, null);
    assert.equal(replaceCount, 1);

    // 4. Another Vercel instance writes v2 directly to Supabase Storage
    remoteBuf = makeFakeSqliteBuffer('v2-from-instance-B');

    // 5. Warm Instance A pulls before mutating -> immediately sees new bytes via ?t= and hot-swaps!
    const thirdPull = await syncCloudDatabase({ force: true });
    assert.equal(thirdPull.updated, true);
    assert.equal(replaceCount, 2);
    assert.ok(localBuf.toString('utf8').includes('v2-from-instance-B'));
    assert.equal(postUploadCount, 0, 'All read pulls must perform zero DB uploads');

    // 6. Explicit mutation push uploads with x-upsert: true
    localBuf = makeFakeSqliteBuffer('v3-edited-track');
    const pushRes = await pushDatabaseBackupNow();
    assert.equal(pushRes.ok, true);
    assert.equal(postUploadCount, 1);
    assert.equal(seenUpsertHeaders.at(-1), 'true');
    assert.ok(remoteBuf!.toString('utf8').includes('v3-edited-track'));
  } finally {
    _configureCloudSyncForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('CloudSync serverless cold-start restores even when local empty DB file already exists on disk, caches per container, and skips Supabase on 2nd GET', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevVercel = process.env.VERCEL;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.VERCEL = '1';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aod-cloudsync-test-'));
  const localDbPath = path.join(tmpDir, 'apostles.db');
  let activeLocalDb: Database.Database | null = null;

  try {
    // Pre-create an empty SQLite file on disk (simulating /tmp/apostles.db created on import) + stale WAL/SHM
    activeLocalDb = new Database(localDbPath);
    activeLocalDb.exec('CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL);');
    fs.writeFileSync(`${localDbPath}-wal`, 'stale-wal');
    fs.writeFileSync(`${localDbPath}-shm`, 'stale-shm');
    assert.equal(fs.existsSync(localDbPath), true);
    assert.equal((activeLocalDb.prepare('SELECT COUNT(*) as c FROM albums').get() as any).c, 0);

    const cloudSnapshot = makeRealSeededSqliteBuffer();
    let getRequestsToSupabase = 0;
    let bucketChecks = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/storage/v1/bucket/')) {
        bucketChecks += 1;
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/storage/v1/object/') && method === 'GET') {
        getRequestsToSupabase += 1;
        await new Promise((r) => setTimeout(r, 15));
        return new Response(new Uint8Array(cloudSnapshot), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    _configureCloudSyncForTests({
      fetchImpl: mockFetch,
      serializeDb: () => activeLocalDb!.serialize(),
      replaceDb: (buf) => {
        activeLocalDb!.close();
        for (const suffix of ['-wal', '-shm', '-journal']) {
          if (fs.existsSync(`${localDbPath}${suffix}`)) fs.unlinkSync(`${localDbPath}${suffix}`);
        }
        const swapPath = `${localDbPath}.swap`;
        fs.writeFileSync(swapPath, buf);
        fs.renameSync(swapPath, localDbPath);
        activeLocalDb = new Database(localDbPath);
      },
    });

    // Simulate two concurrent cold-start GET requests arriving before restore finishes
    await Promise.all([ensureCloudDatabaseRestored(), ensureCloudDatabaseRestored()]);

    assert.equal(getRequestsToSupabase, 1, 'Concurrent cold-start GETs must share one cached restorePromise');
    assert.equal(bucketChecks, 0, 'Cold-start pull must skip ensureBucketExists()');
    assert.equal(fs.existsSync(`${localDbPath}-wal`), false);
    assert.equal(fs.existsSync(`${localDbPath}-shm`), false);
    assert.equal((activeLocalDb.prepare('SELECT COUNT(*) as c FROM albums').get() as any).c, 1);
    assert.equal((activeLocalDb.prepare('SELECT title FROM albums WHERE id = ?').get('alb_test') as any).title, 'nightmortan');

    const status = getCloudSyncStatus();
    assert.equal(status.supabaseConfigured, true);
    assert.equal(status.cloudRestoreStatus, 'restored');
    assert.equal(status.cloudRestoreError, null);
    assert.equal(status.dbObjectPath, 'db/apostles.db');

    // Subsequent GET requests in same warm container must NOT hit Supabase at all
    await ensureCloudDatabaseRestored();
    await ensureCloudDatabaseRestored();
    assert.equal(getRequestsToSupabase, 1, 'Subsequent GET requests must trigger 0 Supabase calls');
  } finally {
    try { activeLocalDb?.close(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _configureCloudSyncForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
  }
});

test('CloudSync retries after cold-start failure and blocks uploadDatabaseToCloud while restore failed', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    let remoteAvailable = false;
    let getCalls = 0;
    let postCalls = 0;
    const remoteBuf = makeFakeSqliteBuffer('live-production-db');

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/storage/v1/bucket/')) {
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/storage/v1/object/') && method === 'GET') {
        getCalls += 1;
        if (!remoteAvailable) {
          return new Response('Upstream timeout', { status: 504 });
        }
        return new Response(new Uint8Array(remoteBuf), { status: 200 });
      }
      if (url.includes('/storage/v1/object/') && method === 'POST') {
        postCalls += 1;
        return new Response(JSON.stringify({ Key: 'db/apostles.db' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    let replaced = 0;
    _configureCloudSyncForTests({
      fetchImpl: mockFetch,
      serializeDb: () => makeFakeSqliteBuffer('empty-local-db'),
      replaceDb: () => {
        replaced += 1;
      },
    });

    // 1. First request fails (504) -> status = failed, restorePromise resets so next request can retry
    await ensureCloudDatabaseRestored();
    assert.equal(getCalls, 1);
    assert.equal(replaced, 0);
    assert.equal(getCloudSyncStatus().cloudRestoreStatus, 'failed');
    assert.ok(getCloudSyncStatus().cloudRestoreError?.includes('504'));

    // 2. While restore failed, uploadDatabaseToCloud MUST refuse to overwrite production DB!
    const blockedPush = await uploadDatabaseToCloud();
    assert.equal(blockedPush.ok, false);
    assert.equal(postCalls, 0, 'Empty local DB must NEVER overwrite remote DB after failed restore');

    // 3. Next request retries restore when Supabase recovers -> succeeds and unlocks uploads
    remoteAvailable = true;
    await ensureCloudDatabaseRestored();
    assert.equal(getCalls, 2);
    assert.equal(replaced, 1);
    assert.equal(getCloudSyncStatus().cloudRestoreStatus, 'restored');
    assert.equal(getCloudSyncStatus().cloudRestoreError, null);

    const allowedPush = await uploadDatabaseToCloud();
    assert.equal(allowedPush.ok, true);
    assert.equal(postCalls, 1);
  } finally {
    _configureCloudSyncForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('CloudSync push surfaces errors cleanly, serializes concurrent writes, and signed media URLs stay strictly ASCII', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    let failMode = true;
    let uploadCalls = 0;
    let activeUploads = 0;
    let maxConcurrentUploads = 0;
    let signedRequestUrl = '';

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/storage/v1/bucket/')) {
        return new Response(JSON.stringify({ id: 'apostles-archive-persistence' }), { status: 200 });
      }
      if (url.includes('/storage/v1/object/upload/sign/') && method === 'POST') {
        signedRequestUrl = url;
        return new Response(JSON.stringify({ url: '/object/upload/sign/apostles-archive-persistence/media/ok.mp3?token=abc', token: 'abc' }), { status: 200 });
      }
      if (url.includes('/storage/v1/object/') && method === 'POST') {
        uploadCalls += 1;
        activeUploads += 1;
        maxConcurrentUploads = Math.max(maxConcurrentUploads, activeUploads);
        await new Promise((r) => setTimeout(r, 20));
        activeUploads -= 1;

        if (failMode) {
          return new Response('{"error":"bucket policy denied"}', { status: 403 });
        }
        return new Response(JSON.stringify({ Key: 'db/apostles.db' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    _configureCloudSyncForTests({
      fetchImpl: mockFetch,
      serializeDb: () => makeFakeSqliteBuffer(`snap-${uploadCalls}`),
      replaceDb: () => {},
    });

    // Failing upload must return ok: false with detailed error
    const failResult = await pushDatabaseBackupNow();
    assert.equal(failResult.ok, false);
    assert.equal(failResult.status, 403);
    assert.ok(failResult.error?.includes('403'));

    // Concurrent uploads must execute sequentially and both succeed without being skipped
    failMode = false;
    const [r1, r2] = await Promise.all([pushDatabaseBackupNow(), pushDatabaseBackupNow()]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(maxConcurrentUploads, 1, 'Uploads must be serialized so no mutation is dropped');

    // Signed URL objectPath must transliterate Cyrillic/spaces/specials to strict ASCII
    const signed = await createSignedMediaUploadUrl('с мёртвыми (тест #1).mp3');
    assert.ok(signed);
    assert.equal(signed.objectPath, 'media/s_myortvymi_test_1.mp3');
    assert.match(signed.objectPath, /^media\/[a-z0-9_.-]+$/);
    assert.ok(signedRequestUrl.endsWith('/media/s_myortvymi_test_1.mp3'));
  } finally {
    _configureCloudSyncForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('syncIfCloudNewer tracks ETag, returns 304 without replacing DB, throttles reads, and hot-swaps when Container A levels up a user', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    // Container A initial DB: user at level 1 with 0 achievements
    const dbContainerA = new Database(':memory:');
    dbContainerA.exec(`
      CREATE TABLE profiles (user_id TEXT PRIMARY KEY, level INTEGER NOT NULL, xp INTEGER NOT NULL, total_xp INTEGER NOT NULL);
      CREATE TABLE user_achievements (user_id TEXT NOT NULL, achievement_slug TEXT NOT NULL, PRIMARY KEY (user_id, achievement_slug));
      INSERT INTO profiles (user_id, level, xp, total_xp) VALUES ('u_1', 1, 50, 50);
    `);

    let remoteBuf: Buffer = dbContainerA.serialize();
    let remoteEtag = '"etag-v1"';
    let containerBBuf: Buffer = Buffer.alloc(0);
    let containerBDb: Database.Database | null = null;
    let replaceCalls = 0;
    let networkGetCalls = 0;
    const seenIfNoneMatch: Array<string | null> = [];
    const seenUrls: string[] = [];
    const seenCacheControl: Array<string | null> = [];
    const seenCacheModes: Array<RequestCache | undefined> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});
      if (url.includes('/storage/v1/object/') && method === 'GET') {
        networkGetCalls += 1;
        seenUrls.push(url);
        seenCacheControl.push(headers.get('cache-control'));
        seenCacheModes.push(init?.cache);
        const inm = headers.get('if-none-match');
        seenIfNoneMatch.push(inm);
        if (inm && inm === remoteEtag) {
          return new Response(null, { status: 304, headers: { ETag: remoteEtag } });
        }
        return new Response(new Uint8Array(remoteBuf), {
          status: 200,
          headers: { ETag: remoteEtag },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    _configureCloudSyncForTests({
      fetchImpl: mockFetch,
      serializeDb: () => containerBBuf,
      replaceDb: (buf) => {
        replaceCalls += 1;
        containerBBuf = Buffer.from(buf);
        containerBDb?.close();
        containerBDb = new Database(containerBBuf);
      },
    });

    // 1. Cold-start restore on Container B pulls v1 and records ETag
    await ensureCloudDatabaseRestored();
    assert.equal(replaceCalls, 1);
    assert.equal(getCloudSyncStatus().last_synced_etag, '"etag-v1"');
    assert.equal((containerBDb!.prepare('SELECT level FROM profiles WHERE user_id = ?').get('u_1') as any).level, 1);

    // 2. Read check with explicit minIntervalMs is throttled -> 0 network calls
    const throttledRes = await syncIfCloudNewer({ minIntervalMs: 60000 });
    assert.equal(throttledRes.notModified, true);
    assert.equal(networkGetCalls, 1);

    // 3. Forced check sends ?t=, max-age=0, no-store, and If-None-Match: "etag-v1" -> receives 304 -> 0 DB swaps
    const notModifiedRes = await syncIfCloudNewer({ force: true });
    assert.equal(notModifiedRes.updated, false);
    assert.equal(notModifiedRes.notModified, true);
    assert.match(seenUrls.at(-1)!, /\?t=\d+$/);
    assert.equal(seenCacheControl.at(-1), 'no-cache, no-store, max-age=0');
    assert.equal(seenCacheModes.at(-1), 'no-store');
    assert.equal(seenIfNoneMatch.at(-1), '"etag-v1"');
    assert.equal(replaceCalls, 1);
    assert.equal(networkGetCalls, 2);

    // 4. Container A levels user up 1 -> 2 and unlocks an achievement, publishing new ETag
    dbContainerA.exec(`
      UPDATE profiles SET level = 2, xp = 200, total_xp = 200 WHERE user_id = 'u_1';
      INSERT INTO user_achievements (user_id, achievement_slug) VALUES ('u_1', 'first_blood');
    `);
    remoteBuf = dbContainerA.serialize();
    remoteEtag = '"etag-v2"';

    // 5. Container B calls syncIfCloudNewer() with default args (minIntervalMs defaults to 0) -> immediately detects ETag mismatch & hot-swaps!
    const updatedRes = await syncIfCloudNewer();
    assert.equal(updatedRes.updated, true);
    assert.equal(replaceCalls, 2);
    assert.match(seenUrls.at(-1)!, /\?t=\d+$/);
    assert.equal(seenCacheControl.at(-1), 'no-cache, no-store, max-age=0');
    assert.equal(getCloudSyncStatus().last_synced_etag, '"etag-v2"');
    assert.equal((containerBDb!.prepare('SELECT level FROM profiles WHERE user_id = ?').get('u_1') as any).level, 2);
    const achCount = (
      containerBDb!.prepare("SELECT COUNT(*) as c FROM user_achievements WHERE user_id = 'u_1' AND achievement_slug = 'first_blood'").get() as any
    ).c;
    assert.equal(achCount, 1);

    dbContainerA.close();
    (containerBDb as Database.Database | null)?.close();
  } finally {
    _configureCloudSyncForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
