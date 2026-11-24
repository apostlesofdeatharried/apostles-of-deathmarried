import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchemaAndMigrations } from './db.js';

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
});
