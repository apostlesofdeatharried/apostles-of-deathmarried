import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncCloudDatabase,
  pushDatabaseBackupNow,
  createSignedMediaUploadUrl,
  _configureCloudSyncForTests,
} from './cloudSync.js';

function makeFakeSqliteBuffer(tag: string): Buffer {
  const header = Buffer.from('SQLite format 3\0', 'utf8');
  const body = Buffer.from(tag.padEnd(128, '_'), 'utf8');
  return Buffer.concat([header, body]);
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
    let postUploadCount = 0;
    let replaceCount = 0;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});

      if (url.includes('/storage/v1/bucket/')) {
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

    // 1. Cold-start GET when remote does not exist yet MUST NOT upload local DB!
    const missingPull = await syncCloudDatabase({ force: true });
    assert.equal(missingPull.notFound, true);
    assert.equal(postUploadCount, 0, 'GET/pull must NEVER upload apostles.db even on 404/400');

    // 2. Remote DB exists (v1) -> pull downloads with ?t= timestamp, no-cache headers, cache: no-store, no If-None-Match
    remoteBuf = makeFakeSqliteBuffer('v1-remote');
    const firstPull = await syncCloudDatabase({ force: true });
    assert.equal(firstPull.updated, true);
    assert.equal(replaceCount, 1);
    assert.match(seenGetUrls.at(-1)!, /\?t=\d+$/);
    assert.equal(seenCacheModes.at(-1), 'no-store');
    assert.equal(seenGetHeaders.at(-1)!.cacheControl, 'no-cache, no-store');
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
