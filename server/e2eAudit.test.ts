import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Strictly isolated temp SQLite file in os.tmpdir() — NEVER touches data/apostles.db
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apostles-e2e-audit-'));
const tmpDbPath = path.join(tmpDir, 'e2e-audit.db');

process.env.NODE_ENV = 'test';
process.env.APOSTLES_DB_PATH = tmpDbPath;
process.env.SESSION_SECRET = 'e2e_audit_session_secret_apostles_2026';

let server: http.Server;
let baseUrl = '';
let dbMod: typeof import('./db.js');
let tokenMod: typeof import('./sessionToken.js');
let secMod: typeof import('./accountSecurity.js');

function solveArithmeticQuestion(questionRu: string): number {
  const match = questionRu.match(/(\d+)\s*([+\-−×*])\s*(\d+)/);
  assert.ok(match, `Unexpected captcha question format: ${questionRu}`);
  const a = Number(match[1]);
  const op = match[2];
  const b = Number(match[3]);
  if (op === '+') return a + b;
  if (op === '-' || op === '−') return a - b;
  return a * b;
}

describe('End-to-end audit across auth, archive streaming, all 5 games, moderation + XP rollback, long multiline notifications, promo/shop, and admin reset', () => {
  let adminToken = '';
  let adminId = '';
  let followerToken = '';
  let followerId = '';
  let registeredUserToken = '';
  let registeredUserId = '';
  let registeredUsername = '';

  before(async () => {
    dbMod = await import('./db.js');
    tokenMod = await import('./sessionToken.js');
    secMod = await import('./accountSecurity.js');
    const serverMod = await import('../server.js');

    dbMod.db.pragma('foreign_keys = ON');

    // Ensure an admin user exists for admin/mod actions
    const existingAdmin = dbMod.db
      .prepare("SELECT id, nickname FROM users WHERE role_id = 'admin' LIMIT 1")
      .get() as { id: string; nickname: string } | undefined;

    if (existingAdmin) {
      adminId = existingAdmin.id;
      adminToken = tokenMod.signSessionToken({
        sid: 'sess_e2e_admin',
        uid: existingAdmin.id,
        nick: existingAdmin.nickname,
        role: 'admin',
      }).token;
    } else {
      adminId = 'usr_e2e_admin';
      dbMod.db
        .prepare(`
          INSERT INTO users (id, nickname, email, email_verified, accepted_rules, password_hash, role_id)
          VALUES (?, 'e2e_admin', 'e2eadmin@example.com', 1, 1, 'hash', 'admin')
        `)
        .run(adminId);
      dbMod.db
        .prepare(`
          INSERT INTO profiles (user_id, display_name, level, xp, total_xp, daily_streak, notify_follows, notify_news)
          VALUES (?, 'E2E Admin', 1, 0, 0, 0, 1, 1)
        `)
        .run(adminId);
      adminToken = tokenMod.signSessionToken({
        sid: 'sess_e2e_admin',
        uid: adminId,
        nick: 'e2e_admin',
        role: 'admin',
      }).token;
    }

    // Create a follower user with both notification toggles enabled + unverified email first
    followerId = 'usr_e2e_follower';
    dbMod.db
      .prepare(`
        INSERT OR REPLACE INTO users (id, nickname, email, email_verified, accepted_rules, password_hash, role_id)
        VALUES (?, 'e2e_follower', 'e2e_follower@example.com', 0, 1, 'hash', 'user')
      `)
      .run(followerId);
    dbMod.db
      .prepare(`
        INSERT OR REPLACE INTO profiles (user_id, display_name, level, xp, total_xp, daily_streak, notify_follows, notify_news)
        VALUES (?, 'E2E Follower', 1, 0, 0, 0, 1, 1)
      `)
      .run(followerId);
    followerToken = tokenMod.signSessionToken({
      sid: 'sess_e2e_follower',
      uid: followerId,
      nick: 'e2e_follower',
      role: 'user',
    }).token;

    // Guarantee eligible tracks with lyrics & audio URLs so all 5 games have valid rounds
    const eligibleTrackCount = Number(
      (
        dbMod.db
          .prepare("SELECT COUNT(*) as c FROM tracks WHERE is_game_eligible = 1 AND COALESCE(lyrics, '') != ''")
          .get() as any
      )?.c || 0
    );
    if (eligibleTrackCount < 4) {
      dbMod.db
        .prepare(`
          INSERT OR IGNORE INTO albums (id, title, release_year, cover_url, track_count, duration_seconds)
          VALUES ('alb_e2e_1', 'E2E Nocturne', 2025, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', 4, 720)
        `)
        .run();

      const lines = [
        'Тени на стенах старого собора',
        'Холодный ветер шепчет имена',
        'В осколках витражей горит рассвет',
        'Ночь не отпустит тихий шёпот струн',
        'Пепел ложится на чёрный бархат',
        'Сквозь тишину звучит забытый хорал',
      ].join('\n');

      for (let i = 1; i <= 4; i++) {
        dbMod.db
          .prepare(`
            INSERT OR IGNORE INTO tracks (id, album_id, title, track_number, duration_seconds, audio_url, lyrics, is_game_eligible)
            VALUES (?, 'alb_e2e_1', ?, ?, 180, '/audio/crown_of_thorns.wav', ?, 1)
          `)
          .run(`trk_e2e_${i}`, `E2E Track ${i}`, i, `${lines}\nСтрока номер ${i} завершает куплет`);
      }
    }

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

  it('1. Full registration -> existing email verify -> profile & privacy update', async () => {
    // Solve real signed captcha from endpoint
    const capRes = await fetch(`${baseUrl}/api/auth/captcha`);
    assert.equal(capRes.status, 200);
    const cap = (await capRes.json()) as { question_ru: string; captcha_token: string };
    const answer = solveArithmeticQuestion(cap.question_ru);

    registeredUsername = 'e2e_apostle_' + Math.floor(Math.random() * 9000 + 1000);
    const regEmail = `${registeredUsername}@example.com`;
    const regCode = '482913';
    const regEmailToken = secMod.createSignedEmailVerificationToken(
      regEmail,
      regCode,
      'register',
      process.env.SESSION_SECRET!
    ).verification_token;

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: registeredUsername,
        display_name: 'E2E Apostle',
        email: regEmail,
        password: 'StrongPassword2026!',
        confirm_password: 'StrongPassword2026!',
        captcha_token: cap.captcha_token,
        captcha_answer: answer,
        email_verification_token: regEmailToken,
        email_code: regCode,
      }),
    });
    assert.equal(regRes.status, 201, `Registration failed: ${await regRes.clone().text()}`);
    const regJson = (await regRes.json()) as any;
    assert.ok(regJson.token && regJson.user?.id);
    assert.equal(regJson.user.xp, 0);
    assert.equal(regJson.user.total_xp, 0);
    assert.equal(regJson.user.email_verified, 1);
    registeredUserToken = regJson.token;
    registeredUserId = regJson.user.id;

    // Verify existing unverified account email flow (regression check for profile email verify)
    const verifyCode = '903152';
    const verifyToken = secMod.createSignedEmailVerificationToken(
      'e2e_follower@example.com',
      verifyCode,
      'verify_existing',
      process.env.SESSION_SECRET!,
      followerId
    ).verification_token;

    const verifyRes = await fetch(`${baseUrl}/api/auth/email/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${followerToken}`,
      },
      body: JSON.stringify({
        email: 'e2e_follower@example.com',
        verification_token: verifyToken,
        code: verifyCode,
      }),
    });
    assert.equal(verifyRes.status, 200, `Email verify failed: ${await verifyRes.clone().text()}`);
    const verifyJson = (await verifyRes.json()) as any;
    assert.equal(verifyJson.email_verified, 1);

    // Update profile bio, display name, privacy settings, favorite_track
    const updRes = await fetch(`${baseUrl}/api/profiles/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${registeredUserToken}`,
      },
      body: JSON.stringify({
        display_name: 'Obsidian Apostle',
        bio: 'Testing end-to-end persistence',
        custom_status: 'Listening at midnight',
        favorite_track: 'Crown of Thorns',
        privacy_settings: {
          hide_xp: true,
          hide_game_stats: true,
        },
      }),
    });
    assert.equal(updRes.status, 200, `Profile update failed: ${await updRes.clone().text()}`);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${registeredUserToken}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = (await meRes.json()) as any;
    assert.equal(meJson.user.display_name, 'Obsidian Apostle');
    assert.equal(meJson.user.bio, 'Testing end-to-end persistence');
  });

  it('2. Archive endpoints + HTTP 206 Range streaming on /uploads/:filename', async () => {
    const albRes = await fetch(`${baseUrl}/api/archive/albums`);
    assert.equal(albRes.status, 200);
    const sngRes = await fetch(`${baseUrl}/api/archive/singles`);
    assert.equal(sngRes.status, 200);

    const payload = Buffer.alloc(64 * 1024, 0xab);
    dbMod.db
      .prepare(`
        INSERT OR REPLACE INTO uploaded_blobs (filename, mime_type, byte_size, data)
        VALUES ('e2e_range_probe.wav', 'audio/wav', ?, ?)
      `)
      .run(payload.length, payload);

    const rangeRes = await fetch(`${baseUrl}/uploads/e2e_range_probe.wav`, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), `bytes 0-1023/${payload.length}`);
    const chunk = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(chunk.length, 1024);
    assert.ok(chunk.equals(payload.subarray(0, 1024)));
  });

  it('3. All 5 daily games award XP cleanly once and enforce HTTP 409 lock on repeat play', async () => {
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredUserToken}`,
    };

    // 1) Guess Track
    {
      const g = await (await fetch(`${baseUrl}/api/games/guess-track/round`, { headers: authHeaders })).json() as any;
      assert.ok(g.options?.length >= 2);
      const p1 = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          round_token: g.round_token,
          challenge_date: g.challenge_date,
          selected_track_id: g.options[0].id,
        }),
      });
      assert.equal(p1.status, 200);
      const p2 = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          round_token: g.round_token,
          challenge_date: g.challenge_date,
          selected_track_id: g.options[0].id,
        }),
      });
      assert.equal(p2.status, 409);
    }

    // 2) Daily Quiz
    {
      const q = await (await fetch(`${baseUrl}/api/games/quiz/daily`, { headers: authHeaders })).json() as any;
      assert.ok(q.questions?.length > 0);
      const answers: Record<string, number> = {};
      for (const item of q.questions) answers[item.id] = 0;
      const p1 = await fetch(`${baseUrl}/api/games/quiz/submit`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ answers, challenge_date: q.challenge_date }),
      });
      assert.equal(p1.status, 200);
      const p2 = await fetch(`${baseUrl}/api/games/quiz/submit`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ answers, challenge_date: q.challenge_date }),
      });
      assert.equal(p2.status, 409);
    }

    // 3) Guess Lyrics
    {
      const l = await (await fetch(`${baseUrl}/api/games/guess-lyrics/round`, { headers: authHeaders })).json() as any;
      assert.ok(l.options?.length >= 2);
      const p1 = await fetch(`${baseUrl}/api/games/guess-lyrics/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ challenge_date: l.challenge_date, selected_option_id: l.options[0].id }),
      });
      assert.equal(p1.status, 200);
      const p2 = await fetch(`${baseUrl}/api/games/guess-lyrics/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ challenge_date: l.challenge_date, selected_option_id: l.options[0].id }),
      });
      assert.equal(p2.status, 409);
    }

    // 4) Reverse Track
    {
      const r = await (await fetch(`${baseUrl}/api/games/reverse-track/round`, { headers: authHeaders })).json() as any;
      assert.ok(r.options?.length >= 2);
      const p1 = await fetch(`${baseUrl}/api/games/reverse-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ challenge_date: r.challenge_date, selected_track_id: r.options[0].id }),
      });
      assert.equal(p1.status, 200);
      const p2 = await fetch(`${baseUrl}/api/games/reverse-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ challenge_date: r.challenge_date, selected_track_id: r.options[0].id }),
      });
      assert.equal(p2.status, 409);
    }

    // 5) Speed Track
    {
      const s = await (await fetch(`${baseUrl}/api/games/speed-track/round`, { headers: authHeaders })).json() as any;
      assert.ok(s.options?.length >= 2);
      const p1 = await fetch(`${baseUrl}/api/games/speed-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ challenge_date: s.challenge_date, selected_track_id: s.options[0].id }),
      });
      assert.equal(p1.status, 200);
      const p2 = await fetch(`${baseUrl}/api/games/speed-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ challenge_date: s.challenge_date, selected_track_id: s.options[0].id }),
      });
      assert.equal(p2.status, 409);
    }

    const row = dbMod.db
      .prepare('SELECT xp, total_xp FROM profiles WHERE user_id = ?')
      .get(registeredUserId) as { xp: number; total_xp: number };
    assert.ok(row.total_xp > 0, 'Total XP should grow after completing games');
  });

  it('4. Creations & Community moderation + XP award/rollback + follow + long multiline notifications (> 250 chars with \\n) + read', async () => {
    const userHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredUserToken}`,
    };
    const followerHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${followerToken}`,
    };
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // Follower follows registered user
    const flwRes = await fetch(`${baseUrl}/api/profiles/${encodeURIComponent(registeredUsername)}/follow`, {
      method: 'POST',
      headers: followerHeaders,
    });
    assert.equal(flwRes.status, 200);
    assert.equal(((await flwRes.json()) as any).following, true);

    // Measure XP before creation
    const xpBeforeCreation = Number(
      (dbMod.db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(registeredUserId) as any).total_xp
    );

    // User submits pending creation (0 XP while pending)
    const crRes = await fetch(`${baseUrl}/api/creations`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({
        title: 'Cathedral Engraving',
        category: 'art',
        description: 'Ink study',
        media_url: '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
        media_type: 'image',
      }),
    });
    assert.equal(crRes.status, 200);
    const crJson = (await crRes.json()) as any;
    assert.equal(crJson.status, 'pending');
    assert.equal(crJson.xp_earned, 0);

    // Moderator/Admin approves -> grants +15 XP (+ possible achievement bonus)
    const modApproveRes = await fetch(`${baseUrl}/api/admin/creations/${crJson.id}/moderate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(modApproveRes.status, 200);

    const xpAfterApprove = Number(
      (dbMod.db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(registeredUserId) as any).total_xp
    );
    assert.ok(xpAfterApprove >= xpBeforeCreation + 15, 'Approving art creation must grant >= 15 XP');

    // Rejecting rolls back the creation's +15 XP
    const modRejectRes = await fetch(`${baseUrl}/api/admin/creations/${crJson.id}/moderate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'rejected', rejection_reason: 'Test rollback' }),
    });
    assert.equal(modRejectRes.status, 200);

    const xpAfterReject = Number(
      (dbMod.db.prepare('SELECT total_xp FROM profiles WHERE user_id = ?').get(registeredUserId) as any).total_xp
    );
    assert.equal(xpAfterReject, xpAfterApprove - 15, 'Rejecting creation must roll back exact 15 XP');

    // Community post moderation + long multiline reply + long multiline news broadcast
    const catRow = dbMod.db
      .prepare('SELECT id FROM post_categories WHERE COALESCE(is_official, 0) = 0 LIMIT 1')
      .get() as { id: string };
    assert.ok(catRow?.id);

    const postRes = await fetch(`${baseUrl}/api/community/posts`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({
        category_id: catRow.id,
        title: 'Midnight Discussion',
        content: 'Detailed discussion about tracks, lyrics and cathedral atmosphere for community moderation audit.',
      }),
    });
    assert.equal(postRes.status, 200);
    const postJson = (await postRes.json()) as any;
    assert.equal(postJson.status, 'pending');

    const postApproveRes = await fetch(`${baseUrl}/api/admin/community/posts/${postJson.id}/moderate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(postApproveRes.status, 200);

    // Long multiline comment (> 250 chars with \n) triggers reply notification to registered user
    const longReply = [
      'Первая строка длинного ответа с сохранением переносов и подробным разбором релиза.',
      'Вторая строка продолжает мысль — проверяем, что ничего не обрезается на 140 символах.',
      'Третья строка добавляет детали о звучании органа, атмосфере и хоровых партиях ближе к финалу.',
    ].join('\n');
    assert.ok(longReply.length > 250);

    const cmRes = await fetch(`${baseUrl}/api/community/posts/${postJson.id}/comments`, {
      method: 'POST',
      headers: followerHeaders,
      body: JSON.stringify({ content: longReply }),
    });
    assert.equal(cmRes.status, 200);

    // Check recipient notifications preserve full >250 char text and \n newlines
    const userNotifs = (await (await fetch(`${baseUrl}/api/notifications`, { headers: userHeaders })).json()) as any;
    const replyNotif = userNotifs.notifications.find((n: any) => n.type === 'reply');
    assert.ok(replyNotif, 'Reply notification must exist');
    assert.equal(replyNotif.excerpt, longReply, 'Long multiline reply notification must not be truncated');
    assert.ok(replyNotif.excerpt.includes('\n'), 'Newlines must be preserved');

    // Admin site news broadcast (> 300 chars, multiline) to subscribers (follower)
    const longBroadcast = [
      'Важное обновление архива deathmarried — строка первая с описанием ночного релиза и новых вопросов викторины.',
      '',
      'Вторая абзацная строка содержит подробности обновления мобильной версии, системы уведомлений и таблицы лидеров, превышая 300 символов без обрезки на сервере.',
      'Третья строка подтверждает сохранение абзацев и длинных текстов.',
    ].join('\n');
    assert.ok(longBroadcast.length > 300);

    const bcRes = await fetch(`${baseUrl}/api/admin/news/broadcast`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        title: 'Большое обновление архива',
        message: longBroadcast,
        link: '/community',
      }),
    });
    assert.equal(bcRes.status, 200);
    const bcJson = (await bcRes.json()) as any;
    assert.ok(bcJson.sent_count >= 1);

    const followerNotifs = (await (await fetch(`${baseUrl}/api/notifications`, { headers: followerHeaders })).json()) as any;
    const newsNotif = followerNotifs.notifications.find((n: any) => n.type === 'news');
    assert.ok(newsNotif, 'Subscriber must receive news broadcast notification');
    assert.equal(newsNotif.excerpt, longBroadcast, 'Broadcast notification must preserve >300 char multiline message');
    assert.ok(followerNotifs.unreadCount >= 1);

    // Mark notification as read
    const readRes = await fetch(`${baseUrl}/api/notifications/read`, {
      method: 'POST',
      headers: followerHeaders,
      body: JSON.stringify({ id: newsNotif.id }),
    });
    assert.equal(readRes.status, 200);
    const readJson = (await readRes.json()) as any;
    assert.ok(readJson.unreadCount < followerNotifs.unreadCount);
  });

  it('5. Promo codes (apostles & deathmarried), shop buy preserves total_xp/level/leaderboard, and admin user reset', async () => {
    const userHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registeredUserToken}`,
    };
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // Redeem both promo codes
    for (const code of ['apostles', 'deathmarried']) {
      const prRes = await fetch(`${baseUrl}/api/promo/redeem`, {
        method: 'POST',
        headers: userHeaders,
        body: JSON.stringify({ code }),
      });
      assert.equal(prRes.status, 200, `Promo ${code} redeem failed: ${await prRes.clone().text()}`);
    }

    // Pick an affordable item from /api/shop/items
    const shopList = (await (await fetch(`${baseUrl}/api/shop/items`, { headers: userHeaders })).json()) as any;
    const profileBeforeShop = dbMod.db
      .prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?')
      .get(registeredUserId) as { xp: number; total_xp: number; level: number };

    const affordableItem = (shopList.items as any[])
      .filter((i) => !i.is_owned && i.cost_xp > 0 && i.cost_xp <= profileBeforeShop.xp)
      .sort((a, b) => a.cost_xp - b.cost_xp)[0];
    assert.ok(affordableItem, `Expected an affordable shop item within ${profileBeforeShop.xp} XP`);

    // Buy item -> spendable xp drops, total_xp & level & leaderboard preserved
    const buyRes = await fetch(`${baseUrl}/api/shop/buy`, {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({ item_id: affordableItem.id }),
    });
    assert.equal(buyRes.status, 200, `Shop buy failed: ${await buyRes.clone().text()}`);
    const buyJson = (await buyRes.json()) as {
      ok: boolean;
      new_xp: number;
      newly_unlocked_achievements?: Array<{ xp_reward?: number }>;
    };
    const bonusXp = (buyJson.newly_unlocked_achievements || []).reduce(
      (sum, a) => sum + Number(a.xp_reward || 0),
      0
    );

    const profileAfterShop = dbMod.db
      .prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?')
      .get(registeredUserId) as { xp: number; total_xp: number; level: number };

    assert.equal(
      profileAfterShop.xp,
      profileBeforeShop.xp - affordableItem.cost_xp + bonusXp,
      'Spendable XP must drop by item cost (plus any achievement reward)'
    );
    assert.ok(profileAfterShop.total_xp >= profileBeforeShop.total_xp, 'total_xp must NOT decrease on shop purchase');
    assert.ok(profileAfterShop.level >= profileBeforeShop.level, 'Level must NOT decrease on shop purchase');

    const lbRes = (await (await fetch(`${baseUrl}/api/games/leaderboard`)).json()) as any;
    const myLbEntry = (lbRes.leaders || []).find((r: any) => r.id === registeredUserId);
    assert.ok(myLbEntry, 'Player should appear on leaderboard');
    assert.equal(myLbEntry.total_xp, profileAfterShop.total_xp, 'Leaderboard uses total_xp, unaffected by shop spending');

    // Admin single-user full reset clears XP, achievements, cosmetics, games
    const resetRes = await fetch(`${baseUrl}/api/admin/users/reset`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        mode: 'single',
        target_user_id: registeredUserId,
        scopes: { xp: true, achievements: true, cosmetics: true, games: true },
      }),
    });
    assert.equal(resetRes.status, 200, `Admin user reset failed: ${await resetRes.clone().text()}`);
    const resetJson = (await resetRes.json()) as any;
    assert.equal(resetJson.ok, true);
    assert.equal(resetJson.affected_users, 1);

    const afterReset = dbMod.db
      .prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?')
      .get(registeredUserId) as { xp: number; total_xp: number; level: number };
    assert.equal(afterReset.xp, 0);
    assert.equal(afterReset.total_xp, 0);
    assert.equal(afterReset.level, 1);
  });
});
