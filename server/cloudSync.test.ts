import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncCloudDatabase,
  pushDatabaseBackupNow,
  _configureCloudSyncForTests,
} from './cloudSync.js';

function makeFakeSqliteBuffer(tag: string): Buffer {
  const header = Buffer.from('SQLite format 3\0', 'utf8');
  const body = Buffer.from(tag.padEnd(128, '_'), 'utf8');
  return Buffer.concat([header, body]);
}

test('CloudSync pushes with x-upsert: true, uses ETag/If-None-Match on pull, and hot-swaps when remote DB changes', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    let localBuf = makeFakeSqliteBuffer('v1-initial');
    let remoteBuf: Buffer | null = makeFakeSqliteBuffer('v1-initial');
    let remoteEtag = '"etag-v1"';
    const seenUpsertHeaders: string[] = [];
    const seenIfNoneMatch: Array<string | null> = [];
    let replaceCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});

      if (url.includes('/storage/v1/bucket/')) {
        return new Response(JSON.stringify({ id: 'apostles-archive-persistence' }), { status: 200 });
      }

      if (url.includes('/storage/v1/object/')) {
        if (method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { etag: remoteEtag, 'last-modified': new Date().toUTCString() },
          });
        }
        if (method === 'GET') {
          const inm = headers.get('if-none-match');
          seenIfNoneMatch.push(inm);
          if (inm && inm === remoteEtag) {
            return new Response(null, { status: 304, headers: { etag: remoteEtag } });
          }
          if (!remoteBuf) return new Response('Not found', { status: 404 });
          return new Response(new Uint8Array(remoteBuf), {
            status: 200,
            headers: { etag: remoteEtag, 'last-modified': new Date().toUTCString() },
          });
        }
        if (method === 'POST') {
          seenUpsertHeaders.push(headers.get('x-upsert') || '');
          const bodyBytes = init?.body as Uint8Array;
          remoteBuf = Buffer.from(bodyBytes);
          remoteEtag = `"etag-v${Date.now()}-${Math.random()}"`;
          return new Response(JSON.stringify({ Key: 'db/apostles.db' }), {
            status: 200,
            headers: { etag: remoteEtag },
          });
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

    // 1. Cold-start restore downloads v1
    const firstPull = await syncCloudDatabase({ force: true });
    assert.equal(firstPull.updated, true);
    assert.equal(replaceCount, 1);

    // 2. Subsequent pull sends If-None-Match and receives 304 without replacing DB
    const secondPull = await syncCloudDatabase({ force: true });
    assert.equal(secondPull.updated, false);
    assert.equal(secondPull.notModified, true);
    assert.equal(seenIfNoneMatch.at(-1), '"etag-v1"');
    assert.equal(replaceCount, 1);

    // 3. Another Vercel instance writes v2 directly to remote Supabase Storage
    remoteBuf = makeFakeSqliteBuffer('v2-from-instance-B');
    remoteEtag = '"etag-v2"';

    // 4. Warm Instance A pulls before mutating/reading -> sees new ETag and hot-swaps!
    const thirdPull = await syncCloudDatabase({ force: true });
    assert.equal(thirdPull.updated, true);
    assert.equal(replaceCount, 2);
    assert.ok(localBuf.toString('utf8').includes('v2-from-instance-B'));

    // 5. Instance A mutates local DB and pushes backup with x-upsert: true
    localBuf = makeFakeSqliteBuffer('v3-edited-track');
    const pushRes = await pushDatabaseBackupNow();
    assert.equal(pushRes.ok, true);
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

test('CloudSync push surfaces errors cleanly instead of silently succeeding and serializes concurrent writes', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    let failMode = true;
    let uploadCalls = 0;
    let activeUploads = 0;
    let maxConcurrentUploads = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/storage/v1/bucket/')) {
        return new Response(JSON.stringify({ id: 'apostles-archive-persistence' }), { status: 200 });
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
        return new Response(JSON.stringify({ Key: 'db/apostles.db' }), {
          status: 200,
          headers: { etag: `"etag-${uploadCalls}"` },
        });
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
  } finally {
    _configureCloudSyncForTests();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});
