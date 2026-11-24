import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Isolated temp SQLite file so data/apostles.db is NEVER touched
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apostles-prod-fixes-'));
const tmpDbPath = path.join(tmpDir, 'test-prod-fixes.db');

process.env.NODE_ENV = 'test';
process.env.APOSTLES_DB_PATH = tmpDbPath;
process.env.SESSION_SECRET = 'test_session_secret_apostles_2026';

import {
  AUDIO_CHUNK_SIZE_BYTES,
  AUDIO_REVERSE_FAST_CHUNK_BYTES,
  fetchAndDecodeAudio,
} from '../src/utils/webAudioGames.js';
import { createSignedEmailVerificationToken } from './accountSecurity.js';

let server: http.Server;
let baseUrl = '';
let dbMod: typeof import('./db.js');
let tokenMod: typeof import('./sessionToken.js');

describe('Production fixes: profile email verification, notifications, fast reverse audio, and full XP -> leaderboard -> shop -> admin reset chain', () => {
  let adminToken = '';
  let userAToken = '';
  let userBToken = '';

  before(async () => {
    dbMod = await import('./db.js');
    tokenMod = await import('./sessionToken.js');
    const serverMod = await import('../server.js');

    dbMod.db.pragma('foreign_keys = ON');

    // Create test admin, userA (unverified email, unsubscribed), userB (subscribed to news)
    dbMod.db.prepare(`
      INSERT OR REPLACE INTO users (id, nickname, email, email_verified, password_hash, role_id)
      VALUES
        ('usr_adm_test', 'testadmin', 'adm@example.com', 1, 'hash', 'admin'),
        ('usr_a_test', 'alice', 'alice@example.com', 0, 'hash', 'user'),
        ('usr_b_test', 'bob', 'bob@example.com', 1, 'hash', 'user')
    `).run();

    dbMod.db.prepare(`
      INSERT OR REPLACE INTO profiles (user_id, display_name, avatar_url, bio, level, xp, total_xp, daily_streak, notify_follows, notify_news)
      VALUES
        ('usr_adm_test', 'Admin', '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', '', 1, 0, 0, 0, 1, 0),
        ('usr_a_test', 'Alice', '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', '', 1, 0, 0, 0, 1, 0),
        ('usr_b_test', 'Bob', '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', '', 1, 0, 0, 0, 1, 1)
    `).run();

    adminToken = tokenMod.signSessionToken({
      sid: 'sess_adm_test',
      uid: 'usr_adm_test',
      nick: 'testadmin',
      role: 'admin',
    }).token;

    userAToken = tokenMod.signSessionToken({
      sid: 'sess_a_test',
      uid: 'usr_a_test',
      nick: 'alice',
      role: 'user',
    }).token;

    userBToken = tokenMod.signSessionToken({
      sid: 'sess_b_test',
      uid: 'usr_b_test',
      nick: 'bob',
      role: 'user',
    }).token;

    server = http.createServer(serverMod.app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    dbMod?.closeDatabase();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Profile email verification works via /api/auth/email/verify and /api/auth/verify-email alias and persists email_verified', async () => {
    const email1 = 'alice-verified@example.com';
    const code1 = '482910';
    const tok1 = createSignedEmailVerificationToken(
      email1,
      code1,
      'verify_existing',
      process.env.SESSION_SECRET!,
      'usr_a_test'
    );

    const res1 = await fetch(`${baseUrl}/api/auth/email/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        email: email1,
        code: code1,
        verification_token: tok1.verification_token,
      }),
    });
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as any;
    assert.equal(body1.ok, true);
    assert.equal(body1.email, email1);
    assert.equal(body1.email_verified, 1);

    // Check persistence via /api/auth/me and /api/profiles/alice
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const meData = (await meRes.json()) as any;
    assert.equal(meData.user.email, email1);
    assert.equal(meData.user.email_verified, 1);

    // Also test legacy/alias /api/auth/verify-email works for cached clients
    const email2 = 'alice-second@example.com';
    const code2 = '731904';
    const tok2 = createSignedEmailVerificationToken(
      email2,
      code2,
      'verify_existing',
      process.env.SESSION_SECRET!,
      'usr_a_test'
    );
    const res2 = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        email: email2,
        code: code2,
        verification_token: tok2.verification_token,
      }),
    });
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as any;
    assert.equal(body2.email, email2);
    assert.equal(body2.email_verified, 1);
  });

  it('2. News broadcast delivers persistent unread notifications only to opted-in subscribers until marked read', async () => {
    const bcastRes = await fetch(`${baseUrl}/api/admin/news/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Новый релиз в архиве',
        message: 'Добавлены новые треки и обложки в дискографию.',
        link: '/archive',
      }),
    });
    assert.equal(bcastRes.status, 200);
    const bcastBody = (await bcastRes.json()) as any;
    assert.equal(bcastBody.ok, true);
    assert.equal(bcastBody.sent_count, 1);

    // Bob (notify_news = 1) has 1 unread news notification
    const bobNotifsRes1 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const bobNotifs1 = (await bobNotifsRes1.json()) as any;
    assert.equal(bobNotifs1.unreadCount, 1);
    assert.equal(bobNotifs1.notifications.length, 1);
    assert.equal(bobNotifs1.notifications[0].type, 'news');
    assert.equal(bobNotifs1.notifications[0].is_read, 0);

    // Polling again keeps unreadCount === 1 (does not auto-clear)
    const bobNotifsRes2 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const bobNotifs2 = (await bobNotifsRes2.json()) as any;
    assert.equal(bobNotifs2.unreadCount, 1);

    // Alice (notify_news = 0) did NOT receive the broadcast
    const aliceNotifsRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const aliceNotifs = (await aliceNotifsRes.json()) as any;
    assert.equal(aliceNotifs.unreadCount, 0);

    // Clicking / reading marks it read and updates unreadCount to 0
    const readRes = await fetch(`${baseUrl}/api/notifications/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ id: bobNotifs1.notifications[0].id }),
    });
    assert.equal(readRes.status, 200);
    const readBody = (await readRes.json()) as any;
    assert.equal(readBody.unreadCount, 0);

    // Re-fetching confirms is_read persisted
    const bobNotifsRes3 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    const bobNotifs3 = (await bobNotifsRes3.json()) as any;
    assert.equal(bobNotifs3.unreadCount, 0);
    assert.equal(bobNotifs3.notifications[0].is_read, 1);
  });

  it('3. Fast Reverse Track fetch downloads 1 chunk (~1.25 MiB) for early snippets and max 2 chunks for deep offsets', async () => {
    const fakeLargeSize = 6 * 1024 * 1024;
    const rangesEarly: string[] = [];
    const rangesDeep: string[] = [];

    const makeFetchMock = (log: string[]) => (async (_input: any, init?: any) => {
      const rangeHeader = String(init?.headers?.Range || '');
      log.push(rangeHeader);
      const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
      const start = match ? Number(match[1]) : 0;
      const requestedEnd = match ? Number(match[2]) : AUDIO_CHUNK_SIZE_BYTES - 1;
      const end = Math.min(fakeLargeSize - 1, requestedEnd);
      const len = end - start + 1;
      return new Response(new Uint8Array(len).fill(7), {
        status: 206,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Range': `bytes ${start}-${end}/${fakeLargeSize}`,
          'Content-Length': String(len),
        },
      });
    }) as typeof fetch;

    const fakeCtx = {
      state: 'running',
      decodeAudioData(
        _buf: ArrayBuffer,
        onSuccess?: (decoded: AudioBuffer) => void
      ) {
        const decoded = {
          duration: 120,
          sampleRate: 44100,
          numberOfChannels: 2,
          length: 120 * 44100,
        } as unknown as AudioBuffer;
        if (onSuccess) onSuccess(decoded);
        return Promise.resolve(decoded);
      },
    } as unknown as AudioContext;

    const earlyBuf = await fetchAndDecodeAudio('/uploads/reverse_fast_early.mp3', fakeCtx, {
      snippetStart: 12,
      fetchImpl: makeFetchMock(rangesEarly),
    });
    assert.equal(earlyBuf.duration, 120);
    assert.equal(rangesEarly.length, 1);
    assert.equal(rangesEarly[0], `bytes=0-${AUDIO_REVERSE_FAST_CHUNK_BYTES - 1}`);

    const deepBuf = await fetchAndDecodeAudio('/uploads/reverse_fast_deep.mp3', fakeCtx, {
      snippetStart: 48,
      fetchImpl: makeFetchMock(rangesDeep),
    });
    assert.equal(deepBuf.duration, 120);
    assert.equal(rangesDeep.length, 2);
    assert.equal(rangesDeep[0], `bytes=0-${AUDIO_REVERSE_FAST_CHUNK_BYTES - 1}`);
    assert.equal(
      rangesDeep[1],
      `bytes=${AUDIO_REVERSE_FAST_CHUNK_BYTES}-${AUDIO_REVERSE_FAST_CHUNK_BYTES * 2 - 1}`
    );
  });

  it('4. Full XP chain: game + promo + forum post -> level & leaderboard -> shop keeps total_xp -> admin reset clears everything', async () => {
    // 4a. Play guess-track round as Alice
    const roundRes = await fetch(`${baseUrl}/api/games/guess-track/round`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    assert.equal(roundRes.status, 200);
    const roundData = (await roundRes.json()) as any;
    assert.ok(Array.isArray(roundData.options) && roundData.options.length >= 2);

    const verifyRes = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        round_token: roundData.round_token,
        challenge_date: roundData.challenge_date,
        selected_track_id: roundData.options[0].id,
        time_spent: 4,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = (await verifyRes.json()) as any;
    assert.ok(verifyBody.xp_earned >= 5);

    // 4b. Redeem promo code 'apostles'
    const promoRes = await fetch(`${baseUrl}/api/promo/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({ code: 'apostles' }),
    });
    assert.equal(promoRes.status, 200);
    const promoBody = (await promoRes.json()) as any;
    assert.ok(promoBody.xp > 0);
    assert.equal(promoBody.total_xp, promoBody.xp);

    // 4c. Create community post & approve it as admin to award +10 XP
    const catRow = dbMod.db
      .prepare('SELECT id FROM post_categories WHERE COALESCE(is_official, 0) = 0 LIMIT 1')
      .get() as { id: string };
    assert.ok(catRow?.id);

    const postRes = await fetch(`${baseUrl}/api/community/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({
        category_id: catRow.id,
        title: 'Любимая строчка из альбома',
        content: 'Разбираем атмосферу главного трека и звучание органа в припеве.',
      }),
    });
    assert.equal(postRes.status, 200);
    const postBody = (await postRes.json()) as any;
    assert.equal(postBody.status, 'pending');

    const modRes = await fetch(`${baseUrl}/api/admin/community/posts/${postBody.id}/moderate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(modRes.status, 200);

    // Check Alice's profile XP, total_xp, level
    const meBeforeBuyRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const meBeforeBuy = (await meBeforeBuyRes.json()) as any;
    const totalBeforeBuy = Number(meBeforeBuy.user.total_xp);
    const xpBeforeBuy = Number(meBeforeBuy.user.xp);
    const levelBeforeBuy = Number(meBeforeBuy.user.level);
    assert.ok(totalBeforeBuy >= promoBody.xp + 10);
    assert.equal(xpBeforeBuy, totalBeforeBuy);
    assert.ok(levelBeforeBuy >= 1);

    // Confirm Alice appears in leaderboard with total_xp & level
    const lbRes1 = await fetch(`${baseUrl}/api/games/leaderboard?timeframe=all&game=all`);
    assert.equal(lbRes1.status, 200);
    const lbData1 = (await lbRes1.json()) as any;
    const aliceLb1 = lbData1.leaders.find((l: any) => l.nickname === 'alice');
    assert.ok(aliceLb1, 'Alice must appear in all-time leaderboard');
    assert.equal(aliceLb1.total_xp, totalBeforeBuy);
    assert.equal(aliceLb1.level, levelBeforeBuy);

    // 4d. Buy affordable shop item -> spendable xp drops, total_xp & level & leaderboard stay intact
    const affordableItem = dbMod.db
      .prepare('SELECT id, cost_xp FROM shop_items WHERE is_active = 1 AND cost_xp <= ? ORDER BY cost_xp ASC LIMIT 1')
      .get(xpBeforeBuy) as { id: string; cost_xp: number } | undefined;
    assert.ok(affordableItem, 'Expected an affordable shop item');

    const buyRes = await fetch(`${baseUrl}/api/shop/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAToken}`,
      },
      body: JSON.stringify({ item_id: affordableItem.id }),
    });
    assert.equal(buyRes.status, 200);
    const buyBody = (await buyRes.json()) as any;
    const achievementBonus = Array.isArray(buyBody.newly_unlocked_achievements)
      ? buyBody.newly_unlocked_achievements.reduce((sum: number, a: any) => sum + (Number(a?.xp_reward) || 0), 0)
      : 0;
    const expectedTotalAfterBuy = totalBeforeBuy + achievementBonus;
    assert.equal(buyBody.new_xp, xpBeforeBuy - affordableItem.cost_xp + achievementBonus);
    assert.equal(buyBody.profile.total_xp, expectedTotalAfterBuy);
    assert.ok(buyBody.profile.total_xp > buyBody.new_xp);

    // Leaderboard still ranks Alice by total_xp and level (never reduced by shop spend)
    const lbRes2 = await fetch(`${baseUrl}/api/games/leaderboard?timeframe=all&game=all`);
    const lbData2 = (await lbRes2.json()) as any;
    const aliceLb2 = lbData2.leaders.find((l: any) => l.nickname === 'alice');
    assert.ok(aliceLb2);
    assert.equal(aliceLb2.total_xp, expectedTotalAfterBuy);
    assert.equal(aliceLb2.level, Number(buyBody.profile.level));

    // 4e. Admin resets Alice -> xp=0, total_xp=0, level=1, removed from leaderboard
    const resetRes = await fetch(`${baseUrl}/api/admin/users/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        mode: 'single',
        target_user_id: 'usr_a_test',
        scopes: { xp: true, achievements: true, cosmetics: true, games: true },
      }),
    });
    assert.equal(resetRes.status, 200);

    const meAfterResetRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const meAfterReset = (await meAfterResetRes.json()) as any;
    assert.equal(meAfterReset.user.xp, 0);
    assert.equal(meAfterReset.user.total_xp, 0);
    assert.equal(meAfterReset.user.level, 1);

    const lbRes3 = await fetch(`${baseUrl}/api/games/leaderboard?timeframe=all&game=all`);
    const lbData3 = (await lbRes3.json()) as any;
    const aliceLb3 = lbData3.leaders.find((l: any) => l.nickname === 'alice');
    assert.equal(aliceLb3, undefined, 'Reset user must be removed from leaderboard');
  });

  it('5. Shop single-source pricing: GET /api/shop & /api/shop/items match POST /api/shop/buy exact XP deduction with no-store headers, and replay returns 409', async () => {
    // Credit Bob exactly 300 XP so he can buy a 180 XP item cleanly
    dbMod.db
      .prepare('UPDATE profiles SET xp = 300, total_xp = 300, level = 2 WHERE user_id = ?')
      .run('usr_b_test');

    const shopRes1 = await fetch(`${baseUrl}/api/shop/items`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.equal(shopRes1.status, 200);
    assert.match(shopRes1.headers.get('cache-control') || '', /no-store/i);
    const shopBody1 = (await shopRes1.json()) as any;
    assert.equal(shopBody1.items.length, 86, 'Shop API must return all 86 customization items');

    const shopAliasRes = await fetch(`${baseUrl}/api/shop`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.equal(shopAliasRes.status, 200);
    assert.match(shopAliasRes.headers.get('cache-control') || '', /no-store/i);
    const shopAliasBody = (await shopAliasRes.json()) as any;

    const targetItem = shopBody1.items.find((i: any) => i.id === 'effect_midnight_ash');
    const aliasItem = shopAliasBody.items.find((i: any) => i.id === 'effect_midnight_ash');
    assert.ok(targetItem && aliasItem);
    assert.equal(targetItem.cost_xp, 180);
    assert.equal(targetItem.price, 180);
    assert.equal(aliasItem.cost_xp, 180);

    const buyRes = await fetch(`${baseUrl}/api/shop/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({ item_id: 'effect_midnight_ash' }),
    });
    assert.equal(buyRes.status, 200);
    assert.match(buyRes.headers.get('cache-control') || '', /no-store/i);
    const buyBody = (await buyRes.json()) as any;
    assert.equal(buyBody.cost_xp, 180);
    assert.equal(buyBody.xp_spent, 180);
    const achBonus = Array.isArray(buyBody.newly_unlocked_achievements)
      ? buyBody.newly_unlocked_achievements.reduce((s: number, a: any) => s + (Number(a?.xp_reward) || 0), 0)
      : 0;
    assert.equal(buyBody.new_xp, 300 - 180 + achBonus);
    assert.equal(buyBody.profile.total_xp, 300 + achBonus);
    assert.equal(buyBody.profile.level, buyBody.level);

    // Anti-farm replay check: playing guess-track twice in same 12h MSK window returns 409 and awards 0 XP
    const r1 = await fetch(`${baseUrl}/api/games/guess-track/round`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.equal(r1.status, 200);
    assert.match(r1.headers.get('cache-control') || '', /no-store/i);
    const r1Data = (await r1.json()) as any;

    const v1 = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        round_token: r1Data.round_token,
        challenge_date: r1Data.challenge_date,
        selected_track_id: r1Data.options[0].id,
        time_spent: 3,
      }),
    });
    assert.equal(v1.status, 200);

    const v2 = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userBToken}`,
      },
      body: JSON.stringify({
        round_token: r1Data.round_token,
        challenge_date: r1Data.challenge_date,
        selected_track_id: r1Data.options[0].id,
        time_spent: 3,
      }),
    });
    assert.equal(v2.status, 409);
    const v2Data = (await v2.json()) as any;
    assert.equal(v2Data.alreadyPlayed, true);
    assert.equal(v2Data.xp_earned, 0);
  });
});
