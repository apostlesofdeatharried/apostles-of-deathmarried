import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchemaAndMigrations, getModerationActionsDiagnostics, DEFAULT_SHOP_ITEMS } from './db.js';
import { executeAdminUserReset } from './adminUserReset.js';

describe('SQLite additive migrations on legacy Stage 1–6 databases', () => {
  it('migrates missing site_news.created_by and all Stage 1–6 columns/tables without errors', () => {
    const testDb = new Database(':memory:');
    try {
      // Simulate an older production database schema missing Stage 2–6 columns and tables
      testDb.exec(`
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
          password_hash TEXT NOT NULL,
          role_id TEXT NOT NULL DEFAULT 'user',
          is_banned INTEGER NOT NULL DEFAULT 0,
          ban_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE profiles (
          user_id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          avatar_url TEXT,
          bio TEXT,
          level INTEGER NOT NULL DEFAULT 1,
          xp INTEGER NOT NULL DEFAULT 0,
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
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE tracks (
          id TEXT PRIMARY KEY,
          album_id TEXT,
          title TEXT NOT NULL,
          track_number INTEGER NOT NULL DEFAULT 1,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          audio_url TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE daily_track_challenges (
          id TEXT PRIMARY KEY,
          challenge_date TEXT NOT NULL UNIQUE,
          track_id TEXT NOT NULL,
          snippet_start_seconds INTEGER NOT NULL DEFAULT 0,
          options_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE post_categories (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name_ru TEXT NOT NULL,
          name_en TEXT NOT NULL,
          desc_ru TEXT,
          desc_en TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE posts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          category_id TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE comments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          post_id TEXT,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE creations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          media_url TEXT NOT NULL,
          media_type TEXT NOT NULL,
          views_count INTEGER NOT NULL DEFAULT 0,
          likes_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE xp_transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          source TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE promo_codes (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          xp_reward INTEGER NOT NULL DEFAULT 100,
          is_active INTEGER NOT NULL DEFAULT 1,
          description_ru TEXT,
          description_en TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE achievements (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          title_ru TEXT NOT NULL,
          title_en TEXT NOT NULL,
          desc_ru TEXT NOT NULL,
          desc_en TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT 'rose',
          xp_reward INTEGER NOT NULL DEFAULT 50
        );

        CREATE TABLE shop_items (
          id TEXT PRIMARY KEY,
          name_ru TEXT NOT NULL,
          name_en TEXT NOT NULL,
          description_ru TEXT,
          description_en TEXT,
          category TEXT NOT NULL,
          cost_xp INTEGER NOT NULL,
          preview_value TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Legacy site_news table without created_by
        CREATE TABLE site_news (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          link TEXT NOT NULL DEFAULT '/',
          sent_count INTEGER NOT NULL DEFAULT 0,
          author_id TEXT,
          author_nickname TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Seed legacy user, profile, and site_news record
      testDb
        .prepare("INSERT INTO users (id, nickname, password_hash, role_id) VALUES ('u_admin', 'legacy_admin', 'hash', 'admin')")
        .run();
      testDb
        .prepare("INSERT INTO profiles (user_id, display_name, xp) VALUES ('u_admin', '', 250)")
        .run();
      testDb
        .prepare(`
          INSERT INTO site_news (id, title, message, link, sent_count, author_id, author_nickname)
          VALUES ('news_legacy', 'Старый анонс', 'Текст старого анонса', '/archive', 4, 'u_admin', 'legacy_admin')
        `)
        .run();

      // Run idempotent additive migrations twice to verify idempotency
      ensureSchemaAndMigrations(testDb);
      ensureSchemaAndMigrations(testDb);

      // 1. Verify site_news.created_by exists and backfilled cleanly from author_id
      const newsCols = (testDb.prepare('PRAGMA table_info(site_news)').all() as Array<{ name: string }>).map((c) => c.name);
      assert.ok(newsCols.includes('created_by'), 'site_news must have created_by column');

      const newsRows = testDb.prepare(`
        SELECT sn.*, COALESCE(u.nickname, sn.author_nickname, 'admin') as author_nickname
        FROM site_news sn
        LEFT JOIN users u ON u.id = COALESCE(sn.created_by, sn.author_id)
        ORDER BY datetime(sn.created_at) DESC
        LIMIT 100
      `).all() as Array<any>;
      assert.equal(newsRows.length, 1);
      assert.equal(newsRows[0].created_by, 'u_admin');
      assert.equal(newsRows[0].author_nickname, 'legacy_admin');

      // 2. Verify new broadcast insert with empty link (no navigation) and created_by works cleanly
      testDb.prepare(`
        INSERT INTO site_news (id, title, message, link, sent_count, author_id, author_nickname, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('news_new', 'Новость без перехода', 'Просто прочитать', '', 1, 'u_admin', 'legacy_admin', 'u_admin');

      const insertedNews = testDb.prepare('SELECT link, created_by FROM site_news WHERE id = ?').get('news_new') as any;
      assert.equal(insertedNews.link, '');
      assert.equal(insertedNews.created_by, 'u_admin');

      // 3. Verify total_xp sync & empty display_name fallback ran cleanly
      const migratedProfile = testDb.prepare('SELECT display_name, total_xp, notify_news, notify_follows FROM profiles WHERE user_id = ?').get('u_admin') as any;
      assert.equal(migratedProfile.display_name, 'legacy_admin');
      assert.equal(migratedProfile.total_xp, 250);
      assert.equal(migratedProfile.notify_follows, 1);
      assert.equal(migratedProfile.notify_news, 0);

      // 4. Verify representative queries across Stage 1–6 tables prepare & execute with zero "no such column / table" errors
      const representativeQueries = [
        'SELECT email, email_verified, failed_login_attempts, locked_until, password_changed_at, accepted_rules FROM users',
        'SELECT total_xp, custom_status, equipped_frame, equipped_banner, equipped_name_style, equipped_badge, equipped_title, equipped_theme, equipped_effect, featured_achievements_json, username_changed_at, privacy_settings, favorite_track, notify_follows, notify_news FROM profiles',
        'SELECT status, rejection_reason, xp_awarded, xp_awarded_amount, is_pinned, is_locked, views_count, reactions_count, comments_count, media_url, media_type FROM posts',
        'SELECT parent_id, status, album_id, single_id, creation_id, is_hidden, xp_awarded, xp_awarded_amount FROM comments',
        'SELECT category, status, rejection_reason, xp_awarded, xp_awarded_amount, is_approved FROM creations',
        'SELECT streaming_links_json, verified_source, last_verified_at, release_date, format_type, source_url, is_verified FROM albums',
        'SELECT streaming_links_json, verified_source, last_verified_at, lyrics, is_game_eligible, audio_url FROM singles',
        'SELECT single_id, lyrics, is_game_eligible, snippet_start_seconds, snippet_duration_seconds FROM tracks',
        'SELECT rarity, category, condition_ru, condition_en, difficulty_tier, is_secret FROM achievements',
        'SELECT track_source, snippet_start_ratio, snippet_duration_seconds FROM daily_track_challenges',
        'SELECT reference_key FROM xp_transactions',
        'SELECT max_uses, expires_at FROM promo_codes',
        'SELECT game_id, cycle_id, is_correct, score, xp_earned, selected_value, correct_value, details_json FROM daily_mini_game_attempts',
        'SELECT game_type, cycle_id, is_correct, score, xp_earned FROM game_completions',
        'SELECT actor_id, type, target_type, target_id, target_title, target_link, is_read FROM notifications',
      ];
      for (const sql of representativeQueries) {
        assert.doesNotThrow(() => testDb.prepare(sql).all(), `Query failed after migration: ${sql}`);
      }
    } finally {
      testDb.close();
    }
  });

  it('rebuilds legacy moderation_actions with target_user_id INTEGER NOT NULL to allow NULL and preserves rows & indexes', () => {
    const testDb = new Database(':memory:');
    try {
      testDb.exec(`
        CREATE TABLE roles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          level INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO roles (id, name, description, level) VALUES ('admin', 'Administrator', 'Admin', 3);

        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role_id TEXT NOT NULL DEFAULT 'user',
          is_banned INTEGER NOT NULL DEFAULT 0,
          ban_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (id, nickname, password_hash, role_id) VALUES
          ('u_mod', 'mod_admin', 'hash', 'admin'),
          ('101', 'legacy_member', 'hash', 'user');

        CREATE TABLE moderation_actions (
          id TEXT PRIMARY KEY,
          moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action_type TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_moderation_actions_created ON moderation_actions(created_at DESC);
      `);

      testDb
        .prepare(`
          INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details, created_at)
          VALUES ('mod_legacy_1', 'u_mod', 101, 'legacy_ban', 'Legacy action row', '2026-01-15 12:00:00')
        `)
        .run();

      // Enable foreign_keys = ON to mirror production runtime and verify safe migration rebuild
      testDb.pragma('foreign_keys = ON');

      // Run migration twice to confirm idempotency even with foreign_keys = ON
      ensureSchemaAndMigrations(testDb);
      ensureSchemaAndMigrations(testDb);

      const cols = testDb.prepare('PRAGMA table_info(moderation_actions)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;
      const targetCol = cols.find((c) => c.name === 'target_user_id');
      assert.ok(targetCol, 'target_user_id column must exist');
      assert.equal(targetCol.notnull, 0, 'target_user_id must allow NULL after migration');

      // Custom index must survive rebuild
      const indexes = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'moderation_actions'")
        .all() as Array<{ name: string }>;
      assert.ok(
        indexes.some((i) => i.name === 'idx_moderation_actions_created'),
        'custom index on moderation_actions must be preserved'
      );

      // Existing legacy rows must remain intact
      const legacyRow = testDb
        .prepare('SELECT id, moderator_id, target_user_id, action_type, details, created_at FROM moderation_actions WHERE id = ?')
        .get('mod_legacy_1') as any;
      assert.ok(legacyRow, 'legacy moderation_actions row must be preserved');
      assert.equal(legacyRow.moderator_id, 'u_mod');
      assert.equal(String(legacyRow.target_user_id), '101');
      assert.equal(legacyRow.action_type, 'legacy_ban');
      assert.equal(legacyRow.details, 'Legacy action row');
      assert.equal(legacyRow.created_at, '2026-01-15 12:00:00');

      // Bulk reset audit log insert with target_user_id = NULL must succeed with FK ON
      assert.doesNotThrow(() => {
        testDb
          .prepare(`
            INSERT INTO moderation_actions (id, moderator_id, target_user_id, action_type, details)
            VALUES (?, ?, ?, 'user_reset', ?)
          `)
          .run('mod_bulk_1', 'u_mod', null, 'mode=bulk skip_admins=true affected=5');
      });

      const bulkRow = testDb
        .prepare('SELECT id, moderator_id, target_user_id, action_type, details FROM moderation_actions WHERE id = ?')
        .get('mod_bulk_1') as any;
      assert.equal(bulkRow.target_user_id, null);
      assert.equal(bulkRow.action_type, 'user_reset');

      const diag = getModerationActionsDiagnostics(testDb);
      assert.equal(diag.moderationActionsTargetNullable, true);
      assert.equal(diag.lastMigrationError, null);
      assert.deepEqual(diag.moderationActionsColumns, [
        'id',
        'moderator_id',
        'target_user_id',
        'action_type',
        'details',
        'created_at',
      ]);
    } finally {
      testDb.close();
    }
  });

  it('rebuilds truncated legacy moderation_actions (fewer columns + target_user_id INTEGER NOT NULL) and runs bulk reset cleanly', () => {
    const testDb = new Database(':memory:');
    try {
      testDb.exec(`
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
          password_hash TEXT NOT NULL,
          role_id TEXT NOT NULL DEFAULT 'user',
          is_banned INTEGER NOT NULL DEFAULT 0,
          ban_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (id, nickname, password_hash, role_id) VALUES
          ('u_admin', 'boss_admin', 'hash', 'admin'),
          ('101', 'member_one', 'hash', 'user'),
          ('102', 'member_two', 'hash', 'user');

        CREATE TABLE profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          display_name TEXT NOT NULL,
          avatar_url TEXT,
          bio TEXT,
          level INTEGER NOT NULL DEFAULT 1,
          xp INTEGER NOT NULL DEFAULT 0,
          daily_streak INTEGER NOT NULL DEFAULT 0,
          last_active_date TEXT,
          is_private INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO profiles (user_id, display_name, xp, level, daily_streak) VALUES
          ('u_admin', 'Boss', 900, 5, 10),
          ('101', 'Member 1', 240, 3, 4),
          ('102', 'Member 2', 120, 2, 2);

        -- Truncated legacy moderation_actions: ONLY 3 columns (missing action_type, details, created_at)
        -- and target_user_id is INTEGER NOT NULL
        CREATE TABLE moderation_actions (
          id TEXT PRIMARY KEY,
          moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
        );
      `);

      testDb
        .prepare('INSERT INTO moderation_actions (id, moderator_id, target_user_id) VALUES (?, ?, ?)')
        .run('mod_trunc_1', 'u_admin', 101);

      testDb.pragma('foreign_keys = ON');
      ensureSchemaAndMigrations(testDb);

      const diag = getModerationActionsDiagnostics(testDb);
      assert.equal(diag.lastMigrationError, null, 'truncated rebuild must produce zero migration errors');
      assert.equal(diag.moderationActionsTargetNullable, true, 'target_user_id must become nullable');
      assert.deepEqual(diag.moderationActionsColumns, [
        'id',
        'moderator_id',
        'target_user_id',
        'action_type',
        'details',
        'created_at',
      ]);

      const preserved = testDb
        .prepare('SELECT id, moderator_id, target_user_id, action_type, details, created_at FROM moderation_actions WHERE id = ?')
        .get('mod_trunc_1') as any;
      assert.ok(preserved);
      assert.equal(String(preserved.target_user_id), '101');
      assert.equal(preserved.action_type, 'legacy');
      assert.ok(preserved.created_at);

      // Run mass reset endpoint helper against the migrated DB
      const resetRes = executeAdminUserReset(testDb, {
        adminUserId: 'u_admin',
        mode: 'bulk',
        skipAdmins: true,
        confirmText: 'СБРОСИТЬ',
        scopes: { xp: true, achievements: true, cosmetics: true, games: true },
      });
      assert.equal(resetRes.ok, true);
      if (resetRes.ok) {
        assert.equal(resetRes.affected_users, 2);
        assert.equal(resetRes.audit_logged, true);
      }

      const member1Profile = testDb.prepare('SELECT total_xp, xp, level, daily_streak FROM profiles WHERE user_id = ?').get('101') as any;
      const adminProfile = testDb.prepare('SELECT total_xp, xp, level FROM profiles WHERE user_id = ?').get('u_admin') as any;
      assert.equal(member1Profile.total_xp, 0);
      assert.equal(member1Profile.xp, 0);
      assert.equal(member1Profile.level, 1);
      assert.equal(member1Profile.daily_streak, 0);
      assert.equal(adminProfile.total_xp, 900);

      const latestAudit = testDb
        .prepare("SELECT moderator_id, target_user_id, action_type, details FROM moderation_actions WHERE action_type = 'mass_reset'")
        .get() as any;
      assert.ok(latestAudit);
      assert.equal(latestAudit.moderator_id, 'u_admin');
      assert.equal(latestAudit.target_user_id, 'u_admin');
      assert.ok(String(latestAudit.details).includes('affected=2'));
    } finally {
      testDb.close();
    }
  });

  it('mass reset safely falls back to adminUserId if moderation_actions still has target_user_id NOT NULL and legacy action/reason columns', () => {
    const testDb = new Database(':memory:');
    try {
      testDb.exec(`
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
          password_hash TEXT NOT NULL,
          role_id TEXT NOT NULL DEFAULT 'user',
          is_banned INTEGER NOT NULL DEFAULT 0,
          ban_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users (id, nickname, password_hash, role_id) VALUES
          ('u_admin', 'boss_admin', 'hash', 'admin'),
          ('u_1', 'member_one', 'hash', 'user');

        CREATE TABLE profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          display_name TEXT NOT NULL,
          xp INTEGER NOT NULL DEFAULT 0,
          total_xp INTEGER NOT NULL DEFAULT 0,
          level INTEGER NOT NULL DEFAULT 1,
          daily_streak INTEGER NOT NULL DEFAULT 0,
          last_active_date TEXT,
          featured_achievements_json TEXT,
          equipped_frame TEXT,
          equipped_banner TEXT,
          equipped_name_style TEXT,
          equipped_badge TEXT,
          equipped_title TEXT,
          equipped_theme TEXT,
          equipped_effect TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO profiles (user_id, display_name, xp, total_xp, level) VALUES
          ('u_admin', 'Boss', 500, 500, 4),
          ('u_1', 'Member', 300, 300, 3);

        CREATE TABLE xp_transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, source TEXT NOT NULL);
        CREATE TABLE user_achievements (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, achievement_id TEXT NOT NULL);
        CREATE TABLE user_track_plays (user_id TEXT NOT NULL, track_id TEXT NOT NULL);
        CREATE TABLE post_reads (user_id TEXT NOT NULL, post_id TEXT NOT NULL);
        CREATE TABLE user_secret_flags (user_id TEXT NOT NULL, flag_key TEXT NOT NULL);
        CREATE TABLE user_inventory (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL);
        CREATE TABLE game_attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
        CREATE TABLE daily_track_attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
        CREATE TABLE quiz_attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
        CREATE TABLE game_completions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
        CREATE TABLE daily_mini_game_attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);

        -- Hostile un-migrated moderation_actions table (target_user_id NOT NULL + action/reason columns)
        CREATE TABLE moderation_actions (
          id TEXT PRIMARY KEY,
          moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      testDb.pragma('foreign_keys = ON');

      const resetRes = executeAdminUserReset(testDb, {
        adminUserId: 'u_admin',
        mode: 'bulk',
        skipAdmins: true,
        confirmText: 'СБРОСИТЬ',
        scopes: { xp: true, achievements: true, cosmetics: true, games: true },
      });

      assert.equal(resetRes.ok, true);
      if (resetRes.ok) {
        assert.equal(resetRes.affected_users, 1);
        assert.equal(resetRes.audit_logged, true);
      }

      const memberProfile = testDb.prepare('SELECT total_xp, xp, level FROM profiles WHERE user_id = ?').get('u_1') as any;
      assert.equal(memberProfile.total_xp, 0);
      assert.equal(memberProfile.xp, 0);
      assert.equal(memberProfile.level, 1);

      const fallbackLog = testDb
        .prepare('SELECT moderator_id, target_user_id, action, reason FROM moderation_actions')
        .get() as any;
      assert.ok(fallbackLog);
      assert.equal(fallbackLog.moderator_id, 'u_admin');
      assert.equal(fallbackLog.target_user_id, 'u_admin');
      assert.equal(fallbackLog.action, 'mass_reset');
      assert.ok(String(fallbackLog.reason).includes('affected=1'));
    } finally {
      testDb.close();
    }
  });

  it('single and bulk resets zero XP, level, xp_transactions and exclude reset users from leaderboard queries', () => {
    const testDb = new Database(':memory:');
    try {
      ensureSchemaAndMigrations(testDb);
      testDb.exec(`
        INSERT OR IGNORE INTO roles (id, name, description, level) VALUES
          ('user', 'User', 'Member', 1),
          ('admin', 'Administrator', 'Admin', 3);

        INSERT INTO users (id, nickname, password_hash, role_id) VALUES
          ('u_admin', 'boss_admin', 'hash', 'admin'),
          ('u_player1', 'player_one', 'hash', 'user'),
          ('u_player2', 'player_two', 'hash', 'user');

        INSERT INTO profiles (user_id, display_name, xp, total_xp, level, daily_streak) VALUES
          ('u_admin', 'Boss Admin', 900, 900, 5, 10),
          ('u_player1', 'Player One', 150, 350, 3, 5),
          ('u_player2', 'Player Two', 220, 480, 4, 7);

        INSERT INTO xp_transactions (id, user_id, amount, source, details) VALUES
          ('xpt_1', 'u_player1', 350, 'guess_track', 'Test XP 1'),
          ('xpt_2', 'u_player2', 480, 'daily_quiz', 'Test XP 2');

        INSERT INTO game_attempts (id, user_id, game_id, score, xp_earned) VALUES
          ('ga_1', 'u_player1', 'guess-track', 100, 50),
          ('ga_2', 'u_player2', 'daily-quiz', 120, 80);
      `);

      const queryLeaderboardIds = () =>
        (
          testDb
            .prepare(`
              SELECT u.id, p.xp, p.total_xp, p.level
              FROM users u
              JOIN profiles p ON p.user_id = u.id
              WHERE u.is_banned = 0
                AND (p.total_xp > 0 OR EXISTS (
                  SELECT 1 FROM game_attempts ga
                  WHERE ga.user_id = u.id AND (ga.xp_earned > 0 OR ga.score > 0)
                ))
              ORDER BY p.level DESC, p.total_xp DESC
            `)
            .all() as Array<{ id: string; xp: number; total_xp: number; level: number }>
        ).map((r) => r.id);

      assert.deepEqual(queryLeaderboardIds(), ['u_admin', 'u_player2', 'u_player1']);

      // 1) Single reset (XP only, keeping game_attempts rows zeroed)
      const singleRes = executeAdminUserReset(testDb, {
        adminUserId: 'u_admin',
        mode: 'single',
        targetUserId: 'u_player1',
        scopes: { xp: true, achievements: false, cosmetics: false, games: false },
      });
      assert.equal(singleRes.ok, true);
      if (singleRes.ok) {
        assert.equal(singleRes.affected_users, 1);
      }

      const p1AfterSingle = testDb
        .prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?')
        .get('u_player1') as { xp: number; total_xp: number; level: number };
      assert.equal(p1AfterSingle.total_xp, 0);
      assert.equal(p1AfterSingle.xp, 0);
      assert.equal(p1AfterSingle.level, 1);
      assert.deepEqual(queryLeaderboardIds(), ['u_admin', 'u_player2']);

      // 2) Bulk reset (skipAdmins: true)
      const bulkRes = executeAdminUserReset(testDb, {
        adminUserId: 'u_admin',
        mode: 'bulk',
        skipAdmins: true,
        confirmText: 'СБРОСИТЬ',
        scopes: { xp: true, achievements: true, cosmetics: true, games: true },
      });
      assert.equal(bulkRes.ok, true);
      if (bulkRes.ok) {
        assert.equal(bulkRes.affected_users, 2);
      }

      const p2AfterBulk = testDb
        .prepare('SELECT xp, total_xp, level, daily_streak FROM profiles WHERE user_id = ?')
        .get('u_player2') as { xp: number; total_xp: number; level: number; daily_streak: number };
      assert.equal(p2AfterBulk.total_xp, 0);
      assert.equal(p2AfterBulk.xp, 0);
      assert.equal(p2AfterBulk.level, 1);
      assert.equal(p2AfterBulk.daily_streak, 0);

      const adminAfterBulk = testDb
        .prepare('SELECT xp, total_xp, level FROM profiles WHERE user_id = ?')
        .get('u_admin') as { xp: number; total_xp: number; level: number };
      assert.equal(adminAfterBulk.total_xp, 900);
      assert.deepEqual(queryLeaderboardIds(), ['u_admin']);
    } finally {
      testDb.close();
    }
  });

  it('expands a legacy 14-item shop_items database to all 86 active items while preserving existing user_inventory and equipped cosmetics', () => {
    const testDb = new Database(':memory:');
    try {
      testDb.exec(`
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
          password_hash TEXT NOT NULL,
          role_id TEXT NOT NULL DEFAULT 'user',
          is_banned INTEGER NOT NULL DEFAULT 0,
          ban_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE profiles (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          display_name TEXT NOT NULL,
          xp INTEGER NOT NULL DEFAULT 0,
          total_xp INTEGER NOT NULL DEFAULT 0,
          level INTEGER NOT NULL DEFAULT 1,
          equipped_frame TEXT,
          equipped_banner TEXT,
          equipped_name_style TEXT,
          equipped_badge TEXT,
          equipped_title TEXT,
          equipped_theme TEXT,
          equipped_effect TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Legacy shop_items missing rarity, is_active, requires_achievement_id columns
        CREATE TABLE shop_items (
          id TEXT PRIMARY KEY,
          name_ru TEXT NOT NULL,
          name_en TEXT NOT NULL,
          description_ru TEXT,
          description_en TEXT,
          category TEXT NOT NULL,
          cost_xp INTEGER NOT NULL,
          preview_value TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE user_inventory (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
          is_equipped INTEGER NOT NULL DEFAULT 0,
          purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, item_id)
        );
      `);

      testDb.pragma('foreign_keys = ON');

      // Seed exactly 14 old shop items (13 older canonical entries + 1 legacy title_* shield)
      const legacyFourteen = [
        ['frame_graphite', 'Графитовый контур', 'Graphite Contour', 'Старая рамка', 'Old frame', 'frame', 100, 'border-2 border-white/30'],
        ['frame_silver_thorn', 'Серебряный шип', 'Silver Thorn', 'Старая рамка 2', 'Old frame 2', 'frame', 400, 'border-2 border-[#c5c8cf]'],
        ['frame_dark_velvet', 'Чёрный бархат', 'Dark Velvet', 'Старая рамка 3', 'Old frame 3', 'frame', 500, 'border-2 border-[#721b2b]'],
        ['banner_abyss', 'Бездна', 'Abyss', 'Старый градиент', 'Old gradient', 'banner', 150, 'bg-gradient-to-r from-zinc-900 to-black'],
        ['banner_cathedral_veil', 'Соборная вуаль', 'Cathedral Veil', 'Старый баннер', 'Old banner', 'banner', 700, 'bg-gradient-to-r from-red-950 to-black'],
        ['style_monochrome', 'Холодный графит', 'Cold Graphite', 'Старый стиль', 'Old style', 'name_style', 100, 'text-[#b5b0a8]'],
        ['style_silver_glow', 'Серебряный глянец', 'Silver Glow', 'Старый стиль 2', 'Old style 2', 'name_style', 350, 'text-white'],
        ['badge_wanderer', 'Иконка «Искра»', 'Spark Icon', 'Старый значок', 'Old badge', 'badge', 120, 'Sparkles'],
        ['badge_nocturne', 'Иконка «Луна»', 'Moon Icon', 'Старый значок 2', 'Old badge 2', 'badge', 220, 'Moon'],
        ['theme_ash_velvet', 'Тема «Пепельный бархат»', 'Ash Velvet', 'Старая тема', 'Old theme', 'theme', 190, 'theme_ash_velvet'],
        ['theme_crimson_sanctum', 'Тема «Тёмный кармин»', 'Dark Carmine', 'Старая тема 2', 'Old theme 2', 'theme', 900, 'theme_crimson_sanctum'],
        ['effect_midnight_ash', 'Эффект «Ночной пепел»', 'Midnight Ash', 'Старый эффект', 'Old effect', 'effect', 180, 'effect_midnight_ash'],
        ['shield_novichok', 'Шилд «новичок»', 'Shield: novichok', 'Старый шилд', 'Old shield', 'title', 100, 'shield_novichok'],
        ['title_nocturne_listener', 'Титул слушателя', 'Listener Title', 'Устаревший титул', 'Legacy title', 'title', 150, 'title_nocturne_listener'],
      ] as const;

      const insertLegacy = testDb.prepare(`
        INSERT INTO shop_items (id, name_ru, name_en, description_ru, description_en, category, cost_xp, preview_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of legacyFourteen) {
        insertLegacy.run(...row);
      }

      const preCount = (testDb.prepare('SELECT COUNT(*) as c FROM shop_items').get() as { c: number }).c;
      assert.equal(preCount, 14, 'Legacy DB must start with exactly 14 shop items');

      // Seed existing user with purchases + equipped items from the old 14-item shop
      testDb
        .prepare("INSERT INTO users (id, nickname, password_hash, role_id) VALUES ('u_collector', 'old_collector', 'hash', 'user')")
        .run();
      testDb
        .prepare(`
          INSERT INTO profiles (user_id, display_name, xp, total_xp, level, equipped_frame, equipped_banner, equipped_title)
          VALUES ('u_collector', 'Old Collector', 320, 1200, 6, 'border-2 border-white/30', 'bg-gradient-to-r from-zinc-900 to-black', 'title_nocturne_listener')
        `)
        .run();
      testDb.exec(`
        INSERT INTO user_inventory (id, user_id, item_id, is_equipped) VALUES
          ('inv_1', 'u_collector', 'frame_graphite', 1),
          ('inv_2', 'u_collector', 'banner_abyss', 1),
          ('inv_3', 'u_collector', 'style_monochrome', 0),
          ('inv_4', 'u_collector', 'title_nocturne_listener', 1);
      `);

      // Run ensureSchemaAndMigrations twice (simulates CloudSync cold-start restore + repeated boot)
      ensureSchemaAndMigrations(testDb);
      ensureSchemaAndMigrations(testDb);

      const diag = getModerationActionsDiagnostics(testDb);
      assert.equal(diag.lastMigrationError, null);

      // Verify all 86 canonical active items are available in the shop
      assert.equal(DEFAULT_SHOP_ITEMS.length, 86);
      const activeCount = (
        testDb.prepare('SELECT COUNT(*) as c FROM shop_items WHERE is_active = 1').get() as { c: number }
      ).c;
      assert.equal(activeCount, 86, 'After migration all 86 catalog items must be active in shop_items');

      // Verify every category matches exact catalog totals
      const byCategory = Object.fromEntries(
        (
          testDb
            .prepare('SELECT category, COUNT(*) as c FROM shop_items WHERE is_active = 1 GROUP BY category')
            .all() as Array<{ category: string; c: number }>
        ).map((r) => [r.category, r.c])
      );
      assert.deepEqual(byCategory, {
        frame: 14,
        banner: 16,
        name_style: 11,
        badge: 11,
        title: 15,
        theme: 8,
        effect: 11,
      });

      // Verify all 4 previous user_inventory purchases survived cleanly (no ON DELETE CASCADE wipe!)
      const invRows = testDb
        .prepare('SELECT item_id, is_equipped FROM user_inventory WHERE user_id = ? ORDER BY item_id ASC')
        .all('u_collector') as Array<{ item_id: string; is_equipped: number }>;
      assert.equal(invRows.length, 4, 'All existing user purchases must remain intact');
      assert.deepEqual(invRows, [
        { item_id: 'banner_abyss', is_equipped: 1 },
        { item_id: 'frame_graphite', is_equipped: 1 },
        { item_id: 'shield_slushatel', is_equipped: 1 },
        { item_id: 'style_monochrome', is_equipped: 0 },
      ]);

      // Verify equipped banner texture & legacy title shield remapped cleanly on profile
      const prof = testDb
        .prepare('SELECT equipped_frame, equipped_banner, equipped_title FROM profiles WHERE user_id = ?')
        .get('u_collector') as { equipped_frame: string; equipped_banner: string; equipped_title: string };
      assert.equal(prof.equipped_frame, 'border-2 border-white/30');
      assert.equal(prof.equipped_banner, 'banner_tex_graphite_grain');
      assert.equal(prof.equipped_title, 'shield_slushatel');
    } finally {
      testDb.close();
    }
  });
});


