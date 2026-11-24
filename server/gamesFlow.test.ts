import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';

// Isolated temp SQLite file so data/apostles.db is NEVER modified by tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apostles-games-test-'));
const tmpDbPath = path.join(tmpDir, 'test-games.db');

// Seed an OLD production-like DB BEFORE importing server.ts:
// - `games` is missing Stage 5/6 rows ('guess-lyrics', 'reverse-track', 'speed-track')
// - `daily_mini_game_attempts`, `game_completions`, `daily_track_challenges`, `daily_track_attempts`
//   carry stale `REFERENCES tracks(id)` foreign keys that broke whenever a round picked a track from `singles`
{
  const legacyDb = new Database(tmpDbPath);
  legacyDb.exec(`
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      level INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO roles (id, name, description, level) VALUES
      ('user', 'User', 'Member', 1),
      ('admin', 'Administrator', 'Admin', 3);

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL DEFAULT 'hash',
      role_id TEXT NOT NULL DEFAULT 'user',
      is_banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      total_xp INTEGER NOT NULL DEFAULT 0,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      last_active_date TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      release_year INTEGER,
      cover_url TEXT,
      description TEXT,
      track_count INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE singles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      release_year INTEGER,
      cover_url TEXT,
      description TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 180,
      audio_url TEXT,
      lyrics TEXT,
      is_game_eligible INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      album_id TEXT,
      single_id TEXT,
      title TEXT NOT NULL,
      track_number INTEGER NOT NULL DEFAULT 1,
      duration_seconds INTEGER NOT NULL DEFAULT 180,
      audio_url TEXT NOT NULL,
      lyrics TEXT,
      is_game_eligible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      rules TEXT,
      xp_multiplier REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO games (id, slug, title, description, xp_multiplier) VALUES
      ('guess-track', 'guess-track', 'Guess The Track', 'Legacy guess track', 1.0),
      ('daily-quiz', 'daily-quiz', 'Daily Quiz', 'Legacy quiz', 1.2);

    CREATE TABLE daily_track_challenges (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      track_source TEXT NOT NULL DEFAULT 'track',
      snippet_start_seconds INTEGER NOT NULL DEFAULT 0,
      snippet_start_ratio REAL NOT NULL DEFAULT 0,
      snippet_duration_seconds INTEGER NOT NULL DEFAULT 5,
      options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE daily_track_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      selected_track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      time_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );

    CREATE TABLE daily_mini_game_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      selected_value TEXT,
      correct_value TEXT REFERENCES tracks(id),
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_id, cycle_id)
    );

    CREATE TABLE game_completions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_type, cycle_id)
    );
  `);
  legacyDb.close();
}

process.env.NODE_ENV = 'test';
process.env.APOSTLES_DB_PATH = tmpDbPath;
process.env.SESSION_SECRET = 'test_session_secret_apostles_2026';

import { fetchAudioBufferInChunks, AUDIO_CHUNK_SIZE_BYTES, AUDIO_MAX_DOWNLOAD_BYTES } from '../src/utils/webAudioGames.js';

let server: http.Server;
let baseUrl = '';
let dbMod: typeof import('./db.js');
let tokenMod: typeof import('./sessionToken.js');

describe('All 5 mini-games HTTP flow (tracks + singles, FK safety) and chunked Range audio streaming', () => {
  let validUserToken = '';
  let deletedUserToken = '';

  before(async () => {
    dbMod = await import('./db.js');
    tokenMod = await import('./sessionToken.js');
    const serverMod = await import('../server.js');

    // Enforce foreign_keys = ON just like production
    dbMod.db.pragma('foreign_keys = ON');

    // Seed clean tracks + singles ONLY in DB so both `tracks` and `singles` pools are exercised
    dbMod.db.prepare('DELETE FROM tracks').run();
    dbMod.db.prepare('DELETE FROM singles').run();
    dbMod.db.prepare('DELETE FROM albums').run();

    dbMod.db.prepare(`
      INSERT INTO albums (id, title, release_year, cover_url, track_count, duration_seconds)
      VALUES ('alb_test_1', 'Test Cathedral', 2025, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', 2, 360)
    `).run();

    const sampleLyricsA = [
      'Тени падают на каменный пол',
      'Голос эха слышен сквозь темноту',
      'Мы идём дорогой ночных огней',
      'Пепел старых писем остыл на ветру',
      'Ночь хранит забытый нами пароль',
      'Звёзды смотрят молча в пустоту',
    ].join('\n');

    const sampleLyricsB = [
      'Сквозь холодный дождь звучит орган',
      'Время замирает на краю стекла',
      'Черный бархат скрыл вчерашний обман',
      'И свеча в соборе тихо догорела дотла',
      'Сердце бьётся в такт глухим колоколам',
      'Тайна нашей песни в вечность ушла',
    ].join('\n');

    dbMod.db.prepare(`
      INSERT INTO tracks (id, album_id, title, track_number, duration_seconds, audio_url, lyrics, is_game_eligible)
      VALUES
        ('trk_test_1', 'alb_test_1', 'Crown of Thorns', 1, 180, '/audio/crown_of_thorns.wav', ?, 1),
        ('trk_test_2', 'alb_test_1', 'Midnight Rose', 2, 180, '/audio/midnight_rose.wav', ?, 1)
    `).run(sampleLyricsA, sampleLyricsB);

    // Pure standalone single NOT linked in `tracks` (previously triggered FK errors when tracks-only FK existed)
    dbMod.db.prepare(`
      INSERT INTO singles (id, title, release_year, cover_url, duration_seconds, audio_url, lyrics, is_game_eligible)
      VALUES
        ('sng_test_only', 'Cathedral Veil Single', 2026, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', 180, '/audio/cathedral_veil.wav', ?, 1),
        ('sng_test_only_2', 'Ashes Without Name', 2026, '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg', 180, '/audio/crown_of_thorns.wav', ?, 1)
    `).run(sampleLyricsA + '\nПоследняя строчка сингла открывает путь', sampleLyricsB + '\nВетер уносит слова в ночной туман');

    // Create a registered player user
    dbMod.db.prepare(`
      INSERT OR REPLACE INTO users (id, nickname, password_hash, role_id, email_verified, accepted_rules)
      VALUES ('usr_player_test', 'testplayer', 'hash', 'user', 1, 1)
    `).run();
    dbMod.db.prepare(`
      INSERT OR REPLACE INTO profiles (user_id, display_name, level, xp, total_xp, daily_streak)
      VALUES ('usr_player_test', 'Test Player', 1, 0, 0, 0)
    `).run();

    validUserToken = tokenMod.signSessionToken({
      sid: 'sess_test_player',
      uid: 'usr_player_test',
      nick: 'testplayer',
      role: 'user',
    }).token;

    // Simulate a user who was deleted from DB while holding an otherwise valid signed JWT
    deletedUserToken = tokenMod.signSessionToken({
      sid: 'sess_test_deleted',
      uid: 'usr_deleted_999',
      nick: 'deleted_ghost',
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

  it('migrated legacy DB has all 5 games seeded and zero non-user FKs on progress tables', () => {
    const gamesRows = dbMod.db.prepare('SELECT id FROM games').all() as Array<{ id: string }>;
    const gameIds = new Set(gamesRows.map((g) => g.id));
    for (const expected of ['guess-track', 'daily-quiz', 'guess-lyrics', 'reverse-track', 'speed-track']) {
      assert.ok(gameIds.has(expected), `Missing seeded game '${expected}' after ensureSchemaAndMigrations`);
    }

    for (const table of ['daily_track_challenges', 'daily_track_attempts', 'daily_mini_game_attempts', 'game_completions']) {
      const fks = dbMod.db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string }>;
      const bad = fks.filter((fk) => fk.table && fk.table.toLowerCase() !== 'users');
      assert.equal(bad.length, 0, `Table ${table} still has unexpected FKs: ${JSON.stringify(bad)}`);
    }
  });

  it('GET + POST all 5 games succeed with PRAGMA foreign_keys=ON for registered user, guest, and stale token', async () => {
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${validUserToken}`,
    };

    // 1. GUESS TRACK
    {
      const getRes = await fetch(`${baseUrl}/api/games/guess-track/round`, { headers: authHeaders });
      assert.equal(getRes.status, 200);
      const round = await getRes.json() as any;
      assert.ok(Array.isArray(round.options) && round.options.length >= 2);

      // Guest submit must work cleanly
      const guestPost = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_token: round.round_token,
          challenge_date: round.challenge_date,
          selected_track_id: round.options[0].id,
        }),
      });
      assert.equal(guestPost.status, 200);

      // Registered submit
      const regPost = await fetch(`${baseUrl}/api/games/guess-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          round_token: round.round_token,
          challenge_date: round.challenge_date,
          selected_track_id: round.options[0].id,
        }),
      });
      assert.equal(regPost.status, 200, `guess-track verify failed: ${await regPost.clone().text()}`);
      const regData = await regPost.json() as any;
      assert.ok(regData.xp_earned > 0);
    }

    // 2. DAILY QUIZ
    {
      const getRes = await fetch(`${baseUrl}/api/games/quiz/daily`, { headers: authHeaders });
      assert.equal(getRes.status, 200);
      const quiz = await getRes.json() as any;
      assert.ok(Array.isArray(quiz.questions) && quiz.questions.length > 0);

      const answers: Record<string, number> = {};
      for (const q of quiz.questions) answers[q.id] = 0;

      const regPost = await fetch(`${baseUrl}/api/games/quiz/submit`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ answers, challenge_date: quiz.challenge_date }),
      });
      assert.equal(regPost.status, 200, `quiz submit failed: ${await regPost.clone().text()}`);
    }

    // 3. GUESS LYRICS (reported bug #1)
    {
      const getRes = await fetch(`${baseUrl}/api/games/guess-lyrics/round`, { headers: authHeaders });
      assert.equal(getRes.status, 200);
      const round = await getRes.json() as any;
      assert.ok(round.prompt_line && Array.isArray(round.options) && round.options.length >= 2);

      // Guest POST
      const guestPost = await fetch(`${baseUrl}/api/games/guess-lyrics/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_date: round.challenge_date,
          selected_option_id: round.options[0].id,
        }),
      });
      assert.equal(guestPost.status, 200);

      // Stale/deleted user token must NOT crash with SQLite FK error
      const deletedPost = await fetch(`${baseUrl}/api/games/guess-lyrics/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deletedUserToken}`,
        },
        body: JSON.stringify({
          challenge_date: round.challenge_date,
          selected_option_id: round.options[0].id,
        }),
      });
      assert.equal(deletedPost.status, 200);

      // Registered user POST
      const regPost = await fetch(`${baseUrl}/api/games/guess-lyrics/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          challenge_date: round.challenge_date,
          selected_option_id: round.options[0].id,
        }),
      });
      assert.equal(regPost.status, 200, `guess-lyrics verify failed: ${await regPost.clone().text()}`);
      const regData = await regPost.json() as any;
      assert.ok(regData.xp_earned > 0);

      // Duplicate submit returns clean 409
      const dupPost = await fetch(`${baseUrl}/api/games/guess-lyrics/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          challenge_date: round.challenge_date,
          selected_option_id: round.options[0].id,
        }),
      });
      assert.equal(dupPost.status, 409);
    }

    // 4. REVERSE TRACK
    {
      const getRes = await fetch(`${baseUrl}/api/games/reverse-track/round`, { headers: authHeaders });
      assert.equal(getRes.status, 200);
      const round = await getRes.json() as any;
      assert.ok(round.audio_url && Array.isArray(round.options) && round.options.length >= 2);

      const regPost = await fetch(`${baseUrl}/api/games/reverse-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          challenge_date: round.challenge_date,
          selected_track_id: round.options[0].id,
        }),
      });
      assert.equal(regPost.status, 200, `reverse-track verify failed: ${await regPost.clone().text()}`);
    }

    // 5. SPEED TRACK (0.5x / 2.5x)
    {
      const getRes = await fetch(`${baseUrl}/api/games/speed-track/round`, { headers: authHeaders });
      assert.equal(getRes.status, 200);
      const round = await getRes.json() as any;
      assert.ok(round.audio_url && (round.speed_mode === 0.5 || round.speed_mode === 2.5));

      const regPost = await fetch(`${baseUrl}/api/games/speed-track/verify`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          challenge_date: round.challenge_date,
          selected_track_id: round.options[0].id,
        }),
      });
      assert.equal(regPost.status, 200, `speed-track verify failed: ${await regPost.clone().text()}`);
    }

    // Verify all 5 attempts, completions, and XP are recorded
    const profile = dbMod.db
      .prepare('SELECT xp, total_xp FROM profiles WHERE user_id = ?')
      .get('usr_player_test') as { xp: number; total_xp: number };
    assert.ok(profile.total_xp > 0, 'Player total_xp should increase after playing games');

    const completions = dbMod.db
      .prepare('SELECT game_type FROM game_completions WHERE user_id = ?')
      .all('usr_player_test') as Array<{ game_type: string }>;
    assert.equal(completions.length, 5, `Expected 5 completed games, got ${completions.length}`);

    const miniGameRows = dbMod.db
      .prepare('SELECT game_id FROM daily_mini_game_attempts WHERE user_id = ?')
      .all('usr_player_test') as Array<{ game_id: string }>;
    assert.equal(miniGameRows.length, 3);
  });

  it('/uploads/:filename clamps open-ended Range to <=1.5MB and fetchAudioBufferInChunks reconstructs chunked audio cleanly', async () => {
    // Seed a 5 MiB audio blob into uploaded_blobs (> 4.5 MB Vercel response cap)
    const fiveMb = Buffer.alloc(5 * 1024 * 1024);
    for (let i = 0; i < fiveMb.length; i++) {
      fiveMb[i] = i % 251;
    }
    dbMod.db.prepare(`
      INSERT OR REPLACE INTO uploaded_blobs (filename, mime_type, byte_size, data)
      VALUES ('large_track_test.mp3', 'audio/mpeg', ?, ?)
    `).run(fiveMb.length, fiveMb);

    // 1. Open-ended Range: bytes=0- must return 206 with <= 1.5 MiB body
    const openRangeRes = await fetch(`${baseUrl}/uploads/large_track_test.mp3`, {
      headers: { Range: 'bytes=0-' },
    });
    assert.equal(openRangeRes.status, 206);
    const openBuf = Buffer.from(await openRangeRes.arrayBuffer());
    assert.equal(openBuf.length, AUDIO_CHUNK_SIZE_BYTES);
    assert.equal(
      openRangeRes.headers.get('content-range'),
      `bytes 0-${AUDIO_CHUNK_SIZE_BYTES - 1}/${fiveMb.length}`
    );

    // 2. Client chunked downloader fetches 1.5MB chunks capped at 4MB total and matches byte-for-byte
    const seenRanges: string[] = [];
    const downloaded = await fetchAudioBufferInChunks('/uploads/large_track_test.mp3', {
      fetchImpl: (input, init) => {
        const rangeHeader = (init?.headers as Record<string, string>)?.Range || '';
        seenRanges.push(rangeHeader);
        const rel = typeof input === 'string' ? input : input.toString();
        return fetch(`${baseUrl}${rel}`, init);
      },
    });

    assert.equal(downloaded.byteLength, AUDIO_MAX_DOWNLOAD_BYTES);
    assert.deepEqual(seenRanges, [
      'bytes=0-1572863',
      'bytes=1572864-3145727',
      'bytes=3145728-4194303',
    ]);
    assert.ok(Buffer.from(downloaded).equals(fiveMb.subarray(0, AUDIO_MAX_DOWNLOAD_BYTES)));
  });
});
