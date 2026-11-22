import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const isVercel = Boolean(process.env.VERCEL);
const bundledDbPath = path.resolve(process.cwd(), 'data', 'apostles.db');

function resolveWritableDbPath(): string {
  if (isVercel) {
    const tmpDbPath = path.join('/tmp', 'apostles.db');
    if (!fs.existsSync(tmpDbPath) && fs.existsSync(bundledDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, tmpDbPath);
      } catch (err) {
        console.error('[DB] Failed to copy bundled database to /tmp:', err);
      }
    }
    return tmpDbPath;
  }

  const dbDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    return path.join(dbDir, 'apostles.db');
  } catch {
    // Fallback to /tmp if current directory is read-only
    const tmpDbPath = path.join('/tmp', 'apostles.db');
    if (!fs.existsSync(tmpDbPath) && fs.existsSync(bundledDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, tmpDbPath);
      } catch {}
    }
    return tmpDbPath;
  }
}

const activeDbPath = resolveWritableDbPath();

function openConfiguredDatabase(dbPath: string): Database.Database {
  const instance = new Database(dbPath);
  try {
    instance.pragma('busy_timeout = 5000');
  } catch {}
  try {
    // Checkpoint any legacy WAL file before switching to single-file DELETE journal mode
    instance.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    // Single-file rollback journal prevents -wal/-shm sidecar desyncs during cloud/container snapshots
    instance.pragma('journal_mode = DELETE');
    instance.pragma('synchronous = FULL');
  } catch {}
  instance.pragma('foreign_keys = ON');
  return instance;
}

let currentDb: Database.Database = openConfiguredDatabase(activeDbPath);

// Live Proxy guarantees every module (ESM or transpiled CJS) always targets the current reopened DB handle
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const value = (currentDb as any)[prop];
    return typeof value === 'function' ? value.bind(currentDb) : value;
  },
});

export function getDbPath(): string {
  return activeDbPath;
}

export function checkpointDatabase(): void {
  try {
    currentDb.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    currentDb.pragma('journal_mode = DELETE');
  } catch {}
}

export function closeDatabase(): void {
  checkpointDatabase();
  try {
    currentDb.close();
  } catch {}
}

export function serializeDatabase(): Buffer {
  checkpointDatabase();
  return currentDb.serialize();
}

export function replaceDatabaseWithBuffer(buffer: Buffer): void {
  if (!buffer || buffer.length < 100) return;
  if (buffer.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
    throw new Error('Invalid SQLite database buffer');
  }
  try {
    currentDb.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    currentDb.close();
  } catch {}
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      if (fs.existsSync(`${activeDbPath}${suffix}`)) {
        fs.unlinkSync(`${activeDbPath}${suffix}`);
      }
    } catch {}
  }
  const tmpFile = `${activeDbPath}.swap.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, buffer);
  fs.renameSync(tmpFile, activeDbPath);
  currentDb = openConfiguredDatabase(activeDbPath);
  ensureSchemaAndMigrations();
}

export function ensureSchemaAndMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      level INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO roles (id, name, description, level) VALUES
      ('guest', 'Guest', 'Unauthenticated visitor', 0),
      ('user', 'User', 'Registered community member', 1),
      ('moderator', 'Moderator', 'Content & community moderator', 2),
      ('admin', 'Administrator', 'Full site & archive administrator', 3);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role_id TEXT NOT NULL DEFAULT 'user' REFERENCES roles(id) ON DELETE RESTRICT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS revoked_sessions (
      sid TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      release_year INTEGER,
      release_date TEXT,
      cover_url TEXT,
      description TEXT,
      track_count INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      format_type TEXT NOT NULL DEFAULT 'album',
      source_url TEXT,
      streaming_links_json TEXT,
      verified_source TEXT,
      last_verified_at TEXT,
      is_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS singles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      release_year INTEGER,
      release_date TEXT,
      cover_url TEXT,
      description TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      audio_url TEXT,
      source_url TEXT,
      streaming_links_json TEXT,
      verified_source TEXT,
      last_verified_at TEXT,
      is_verified INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      album_id TEXT REFERENCES albums(id) ON DELETE CASCADE,
      single_id TEXT REFERENCES singles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      track_number INTEGER NOT NULL DEFAULT 1,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      audio_url TEXT NOT NULL,
      snippet_start_seconds INTEGER DEFAULT 0,
      snippet_duration_seconds INTEGER DEFAULT 15,
      lyrics TEXT,
      external_url TEXT,
      source_url TEXT,
      is_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audio_files (
      id TEXT PRIMARY KEY,
      track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS archive_images (
      id TEXT PRIMARY KEY,
      title TEXT,
      storage_path TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'artwork',
      uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      rules TEXT,
      xp_multiplier REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO games (id, slug, title, description, xp_multiplier) VALUES
      ('guess-track', 'guess-track', 'Guess The Track', 'Listen to short fragments and identify the track title.', 1.0),
      ('daily-quiz', 'daily-quiz', 'Daily Lore Quiz', 'Daily questions about verified discography and official facts.', 1.2);

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      question_ru TEXT NOT NULL,
      question_en TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      explanation_ru TEXT,
      explanation_en TEXT,
      difficulty INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_challenges (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title_ru TEXT NOT NULL,
      title_en TEXT NOT NULL,
      desc_ru TEXT NOT NULL,
      desc_en TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'rose',
      xp_reward INTEGER NOT NULL DEFAULT 50
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS post_categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name_ru TEXT NOT NULL,
      name_en TEXT NOT NULL,
      desc_ru TEXT,
      desc_en TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES post_categories(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      reactions_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
      creation_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL DEFAULT 'rose',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL,
      views_count INTEGER NOT NULL DEFAULT 0,
      likes_count INTEGER NOT NULL DEFAULT 0,
      is_approved INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      resolution_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id TEXT PRIMARY KEY,
      moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY,
      name_ru TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_ru TEXT,
      description_en TEXT,
      category TEXT NOT NULL,
      cost_xp INTEGER NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      preview_value TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      requires_achievement_id TEXT REFERENCES achievements(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_equipped INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS xp_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      source TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      score INTEGER NOT NULL,
      xp_earned INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );

    CREATE TABLE IF NOT EXISTS guess_track_rounds (
      token TEXT PRIMARY KEY,
      user_id TEXT,
      correct_track_id TEXT NOT NULL,
      options_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      is_used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_track_challenges (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      track_id TEXT NOT NULL,
      track_source TEXT NOT NULL DEFAULT 'track',
      snippet_start_seconds INTEGER NOT NULL DEFAULT 0,
      snippet_start_ratio REAL NOT NULL DEFAULT 0,
      snippet_duration_seconds INTEGER NOT NULL DEFAULT 5,
      options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_track_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      selected_track_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      time_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );

    CREATE TABLE IF NOT EXISTS uploaded_blobs (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe table schema migrations for existing databases
  try { db.exec("ALTER TABLE daily_track_challenges ADD COLUMN snippet_start_ratio REAL NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN total_xp INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN custom_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_frame TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_banner TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_name_style TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_badge TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_theme TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_effect TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN featured_achievements_json TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN username_changed_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tracks ADD COLUMN is_game_eligible INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN is_game_eligible INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE post_categories ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';"); } catch {}
  try { db.exec("ALTER TABLE posts ADD COLUMN rejection_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE comments ADD COLUMN parent_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';"); } catch {}
  try { db.exec("ALTER TABLE creations ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';"); } catch {}
  try { db.exec("ALTER TABLE creations ADD COLUMN rejection_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN email TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN locked_until TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN password_changed_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE achievements ADD COLUMN rarity TEXT NOT NULL DEFAULT 'common';"); } catch {}
  try { db.exec("ALTER TABLE achievements ADD COLUMN category TEXT NOT NULL DEFAULT 'general';"); } catch {}
  try { db.exec("ALTER TABLE achievements ADD COLUMN condition_ru TEXT;"); } catch {}
  try { db.exec("ALTER TABLE achievements ADD COLUMN condition_en TEXT;"); } catch {}
  try { db.exec("ALTER TABLE albums ADD COLUMN streaming_links_json TEXT;"); } catch {}
  try { db.exec("ALTER TABLE albums ADD COLUMN verified_source TEXT;"); } catch {}
  try { db.exec("ALTER TABLE albums ADD COLUMN last_verified_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN streaming_links_json TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN verified_source TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN last_verified_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN lyrics TEXT;"); } catch {}

  // Sync total_xp with existing xp if total_xp is 0 (non-destructive)
  try {
    db.exec("UPDATE profiles SET total_xp = xp WHERE total_xp = 0 AND xp > 0;");
  } catch {}

  // Ensure legacy accounts with empty display_name gracefully inherit nickname
  try {
    db.exec(`
      UPDATE profiles
      SET display_name = (SELECT u.nickname FROM users u WHERE u.id = profiles.user_id)
      WHERE display_name IS NULL OR trim(display_name) = '';
    `);
  } catch {}
}

export function initDatabase() {
  ensureSchemaAndMigrations();
  seedInitialData();
}

function seedInitialData() {
  // Check if admin user exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE nickname = ?').get('deathmarried_admin');
  if (!existingAdmin) {
    const adminId = 'usr_admin_001';
    const hash = bcrypt.hashSync('apostle_admin_2026', 10);
    db.prepare(`
      INSERT INTO users (id, nickname, password_hash, role_id)
      VALUES (?, ?, ?, 'admin')
    `).run(adminId, 'deathmarried_admin', hash);

    db.prepare(`
      INSERT INTO profiles (user_id, display_name, avatar_url, bio, level, xp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      adminId,
      'Archive Curator (Admin)',
      '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      'Keeper of the official deathmarried archive and underground catalog.',
      10,
      1500
    );
  }

  try {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
  } catch {}

  const sushkanovAdmin = db.prepare('SELECT id FROM users WHERE nickname = ? OR email = ?').get('sushkanov097', 'sushkanov097@gmail.com') as any;
  if (!sushkanovAdmin) {
    const sushId = 'usr_sushkanov_097';
    const sushHash = bcrypt.hashSync('sushkanov097', 10);
    db.prepare(`
      INSERT INTO users (id, nickname, email, password_hash, role_id)
      VALUES (?, ?, ?, ?, 'admin')
    `).run(sushId, 'sushkanov097', 'sushkanov097@gmail.com', sushHash);

    db.prepare(`
      INSERT INTO profiles (user_id, display_name, avatar_url, bio, level, xp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sushId,
      'sushkanov097 (Administrator)',
      '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      'Chief Administrator and Curator of Apostles of deathmarried.',
      10,
      2500
    );
  } else {
    db.prepare("UPDATE users SET role_id = 'admin', email = 'sushkanov097@gmail.com' WHERE id = ?").run(sushkanovAdmin.id);
  }

  // Seed default Categories (Official vs Community)
  const categories = [
    { id: 'cat_official', slug: 'official', name_ru: 'Новости и анонсы', name_en: 'News & Announcements', desc_ru: 'Официальные обновления архива и релизы deathmarried (публикует администрация)', desc_en: 'Official archive updates and deathmarried news (administrators only)', sort_order: 1, is_official: 1 },
    { id: 'cat_music', slug: 'music', name_ru: 'Обсуждение музыки', name_en: 'Music Discussion', desc_ru: 'Анализ композиций, концепций альбомов и звучания deathmarried', desc_en: 'Discussion of songs, production, and sonic concepts', sort_order: 2, is_official: 0 },
    { id: 'cat_production', slug: 'production', name_ru: 'Звук и саунд-дизайн', name_en: 'Sound Design & Beats', desc_ru: 'Синтезаторы, сэмплы, пресеты и инструменты', desc_en: 'Synths, samples, plugins and dark production aesthetics', sort_order: 3, is_official: 0 },
    { id: 'cat_general', slug: 'general', name_ru: 'Общение', name_en: 'Community Lounge', desc_ru: 'Свободное обсуждение для участников сообщества', desc_en: 'Open discussion space for music lovers', sort_order: 4, is_official: 0 },
  ];

  const insertCategory = db.prepare(`
    INSERT INTO post_categories (id, slug, name_ru, name_en, desc_ru, desc_en, sort_order, is_official)
    VALUES (@id, @slug, @name_ru, @name_en, @desc_ru, @desc_en, @sort_order, @is_official)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      name_ru = excluded.name_ru,
      name_en = excluded.name_en,
      desc_ru = excluded.desc_ru,
      desc_en = excluded.desc_en,
      sort_order = excluded.sort_order,
      is_official = excluded.is_official
  `);
  for (const cat of categories) {
    insertCategory.run(cat);
  }

  // Seed expanded 27 real mechanics-driven Achievements across categories and 4 rarities
  const achievements = [
    // Getting Started
    { id: 'ach_archive_initiate', slug: 'archive_initiate', title_ru: 'Посвящённый архива', title_en: 'Archive Initiate', desc_ru: 'Создайте свой аккаунт в сообществе Apostles of deathmarried', desc_en: 'Create your Apostles of deathmarried account', condition_ru: 'Зарегистрироваться на сайте', condition_en: 'Register an account', category: 'getting_started', rarity: 'common', icon: 'moon', xp_reward: 0 },
    { id: 'ach_shadow_identity', slug: 'shadow_identity', title_ru: 'Личный почерк', title_en: 'Personal Mark', desc_ru: 'Заполните описание профиля или личный статус', desc_en: 'Customize your profile bio or personal status', condition_ru: 'Добавить «О себе» или статус в профиле', condition_en: 'Set a profile bio or custom status', category: 'getting_started', rarity: 'common', icon: 'feather', xp_reward: 0 },
    { id: 'ach_first_blood', slug: 'first_blood', title_ru: 'Первый шаг', title_en: 'First Step', desc_ru: 'Сыграйте в любое интерактивное испытание архива', desc_en: 'Play your first interactive challenge', condition_ru: 'Завершить 1 игру', condition_en: 'Complete 1 game', category: 'getting_started', rarity: 'common', icon: 'play', xp_reward: 0 },

    // Music / Guess The Track
    { id: 'ach_first_note', slug: 'first_note', title_ru: 'Узнанный аккорд', title_en: 'Recognized Chord', desc_ru: 'Впервые угадайте трек дня по 5-секундному отрывку', desc_en: 'Correctly guess a Daily Track from its 5-second snippet', condition_ru: '1 правильный ответ в «Угадай трек»', condition_en: '1 correct Guess The Track', category: 'music', rarity: 'common', icon: 'music', xp_reward: 0 },
    { id: 'ach_vinyl_hunter', slug: 'vinyl_hunter', title_ru: 'Охотник за винилом', title_en: 'Vinyl Hunter', desc_ru: 'Угадайте 5 ежедневных композиций deathmarried', desc_en: 'Guess 5 daily deathmarried tracks correctly', condition_ru: '5 побед в «Угадай трек»', condition_en: '5 Guess The Track wins', category: 'music', rarity: 'rare', icon: 'disc', xp_reward: 0 },
    { id: 'ach_phantom_ear', slug: 'phantom_ear', title_ru: 'Абсолютный слух', title_en: 'Phantom Ear', desc_ru: 'Угадайте 15 ежедневных композиций по 5-секундному фрагменту', desc_en: 'Guess 15 daily tracks from 5-second snippets', condition_ru: '15 побед в «Угадай трек»', condition_en: '15 Guess The Track wins', category: 'music', rarity: 'epic', icon: 'headphones', xp_reward: 0 },
    { id: 'ach_initiate_ritual', slug: 'initiate_ritual', title_ru: 'Чуткий слух', title_en: 'Musical Ear', desc_ru: 'Завершите 10 раундов в ежедневных играх архива', desc_en: 'Complete 10 interactive game sessions', condition_ru: 'Сыграть 10 игр', condition_en: 'Play 10 games', category: 'music', rarity: 'rare', icon: 'headphones', xp_reward: 0 },
    { id: 'ach_ritual_master', slug: 'ritual_master', title_ru: 'Мастер испытаний', title_en: 'Trial Master', desc_ru: 'Примите участие в 30 игровых испытаниях сообщества', desc_en: 'Complete 30 archive game trials', condition_ru: 'Сыграть 30 игр', condition_en: 'Play 30 games', category: 'music', rarity: 'epic', icon: 'zap', xp_reward: 0 },

    // Quiz / Discography Knowledge
    { id: 'ach_quiz_seeker', slug: 'quiz_seeker', title_ru: 'Искатель фактов', title_en: 'Lore Seeker', desc_ru: 'Завершите первую ежедневную викторину архива', desc_en: 'Complete your first Daily Quiz', condition_ru: 'Пройти 1 ежедневную викторину', condition_en: 'Complete 1 Daily Quiz', category: 'quiz', rarity: 'common', icon: 'book-open', xp_reward: 0 },
    { id: 'ach_lore_scholar', slug: 'lore_scholar', title_ru: 'Знаток дискографии', title_en: 'Discography Connoisseur', desc_ru: 'Пройдите ежедневную викторину без единой ошибки', desc_en: 'Achieve a perfect score in Daily Quiz', condition_ru: '100% правильных ответов в викторине', condition_en: 'Perfect score in Daily Quiz', category: 'quiz', rarity: 'rare', icon: 'award', xp_reward: 0 },
    { id: 'ach_obsidian_oracle', slug: 'obsidian_oracle', title_ru: 'Обсидиановый оракул', title_en: 'Obsidian Oracle', desc_ru: 'Пройдите ежедневную викторину без ошибок 3 раза', desc_en: 'Score 100% in Daily Quiz 3 times', condition_ru: '3 идеальных прохождения викторины', condition_en: '3 perfect Daily Quiz runs', category: 'quiz', rarity: 'epic', icon: 'eye', xp_reward: 0 },
    { id: 'ach_cathedral_historian', slug: 'cathedral_historian', title_ru: 'Летописец свода', title_en: 'Cathedral Historian', desc_ru: 'Завершите 10 ежедневных викторин архива', desc_en: 'Complete 10 Daily Quizzes', condition_ru: 'Пройти 10 викторин', condition_en: 'Complete 10 Daily Quizzes', category: 'quiz', rarity: 'epic', icon: 'compass', xp_reward: 0 },

    // Consistency / Streaks
    { id: 'ach_devoted_acolyte', slug: 'devoted_acolyte', title_ru: 'Преданный слушатель', title_en: 'Devoted Listener', desc_ru: 'Поддерживайте серию активности 3 дня подряд', desc_en: 'Maintain a 3-day daily streak', condition_ru: 'Серия 3 дня подряд', condition_en: '3-day daily streak', category: 'consistency', rarity: 'common', icon: 'calendar', xp_reward: 0 },
    { id: 'ach_eternal_vigil', slug: 'eternal_vigil', title_ru: 'Хранитель архива', title_en: 'Archive Keeper', desc_ru: 'Поддерживайте серию активности 7 дней подряд', desc_en: 'Maintain a 7-day daily streak', condition_ru: 'Серия 7 дней подряд', condition_en: '7-day daily streak', category: 'consistency', rarity: 'rare', icon: 'shield', xp_reward: 0 },
    { id: 'ach_midnight_devotion', slug: 'midnight_devotion', title_ru: 'Полуночная вахта', title_en: 'Midnight Vigil', desc_ru: 'Возвращайтесь в архив 14 дней без перерыва', desc_en: 'Maintain a 14-day daily streak', condition_ru: 'Серия 14 дней подряд', condition_en: '14-day daily streak', category: 'consistency', rarity: 'epic', icon: 'flame', xp_reward: 0 },
    { id: 'ach_immortal_flame', slug: 'immortal_flame', title_ru: 'Негасимое пламя', title_en: 'Immortal Flame', desc_ru: 'Выдержите серию активности 30 дней подряд', desc_en: 'Maintain a 30-day unbroken daily streak', condition_ru: 'Серия 30 дней подряд', condition_en: '30-day daily streak', category: 'consistency', rarity: 'legendary', icon: 'crown', xp_reward: 0 },

    // Collector / Shop
    { id: 'ach_collector', slug: 'collector', title_ru: 'Коллекционер', title_en: 'Collector', desc_ru: 'Приобретите первый предмет в магазине кастомизации', desc_en: 'Acquire your first item in the XP Shop', condition_ru: 'Купить 1 предмет в магазине', condition_en: 'Buy 1 shop item', category: 'collector', rarity: 'common', icon: 'tag', xp_reward: 0 },
    { id: 'ach_relic_hoarder', slug: 'relic_hoarder', title_ru: 'Собиратель реликвий', title_en: 'Relic Curator', desc_ru: 'Соберите 5 предметов кастомизации в своей коллекции', desc_en: 'Own 5 customization items', condition_ru: 'Собрать 5 предметов коллекции', condition_en: 'Own 5 items', category: 'collector', rarity: 'rare', icon: 'gem', xp_reward: 0 },
    { id: 'ach_gothic_treasury', slug: 'gothic_treasury', title_ru: 'Готическая сокровищница', title_en: 'Gothic Treasury', desc_ru: 'Соберите 10 редких и уникальных предметов оформления', desc_en: 'Own 10 customization items', condition_ru: 'Собрать 10 предметов коллекции', condition_en: 'Own 10 items', category: 'collector', rarity: 'legendary', icon: 'layers', xp_reward: 0 },
    { id: 'ach_dressed_in_velvet', slug: 'dressed_in_velvet', title_ru: 'В бархате и серебре', title_en: 'Dressed in Velvet', desc_ru: 'Одновременно экипируйте 3 элемента оформления профиля', desc_en: 'Equip 3 customization layers simultaneously', condition_ru: 'Экипировать 3 предмета одновременно', condition_en: 'Equip 3 items at once', category: 'collector', rarity: 'rare', icon: 'sparkles', xp_reward: 0 },

    // Community & Creations
    { id: 'ach_first_chronicle', slug: 'first_chronicle', title_ru: 'Первая запись', title_en: 'First Chronicle', desc_ru: 'Создайте свою первую тему в сообществе', desc_en: 'Publish your first community forum topic', condition_ru: 'Создать 1 тему на форуме', condition_en: 'Create 1 forum topic', category: 'community', rarity: 'common', icon: 'message-square', xp_reward: 0 },
    { id: 'ach_voice_of_abyss', slug: 'voice_of_abyss', title_ru: 'Голос сообщества', title_en: 'Community Voice', desc_ru: 'Создайте 3 записи на форуме сообщества', desc_en: 'Create 3 community forum discussions', condition_ru: 'Создать 3 темы на форуме', condition_en: 'Create 3 forum topics', category: 'community', rarity: 'rare', icon: 'message-square', xp_reward: 0 },
    { id: 'ach_midnight_critic', slug: 'midnight_critic', title_ru: 'Ночной собеседник', title_en: 'Nocturnal Critic', desc_ru: 'Оставьте 5 комментариев в обсуждениях и галерее', desc_en: 'Post 5 comments across discussions and creations', condition_ru: 'Оставить 5 комментариев', condition_en: 'Write 5 comments', category: 'community', rarity: 'common', icon: 'feather', xp_reward: 0 },
    { id: 'ach_gothic_artisan', slug: 'gothic_artisan', title_ru: 'Творец', title_en: 'Creator', desc_ru: 'Опубликуйте свою работу в творческой галерее', desc_en: 'Publish your work in the Creations gallery', condition_ru: 'Опубликовать 1 работу в галерее', condition_en: 'Publish 1 creation', category: 'community', rarity: 'rare', icon: 'sparkles', xp_reward: 0 },
    { id: 'ach_coven_circle', slug: 'coven_circle', title_ru: 'Круг единомышленников', title_en: 'Inner Circle', desc_ru: 'Наберите 3 подписчиков или подпишитесь на 3 участников', desc_en: 'Reach 3 followers or follow 3 community members', condition_ru: '3 подписчика или 3 подписки', condition_en: '3 followers or following', category: 'community', rarity: 'rare', icon: 'users', xp_reward: 0 },

    // Veteran & XP Milestones
    { id: 'ach_dark_apostle', slug: 'dark_apostle', title_ru: 'Мастер звука', title_en: 'Sound Master', desc_ru: 'Наберите 500 суммарных очков опыта (Total XP)', desc_en: 'Attain 500 lifetime Total XP', condition_ru: 'Набрать 500 Total XP', condition_en: 'Reach 500 Total XP', category: 'veteran', rarity: 'epic', icon: 'trophy', xp_reward: 0 },
    { id: 'ach_archon_of_sound', slug: 'archon_of_sound', title_ru: 'Архонт архива', title_en: 'Archive Archon', desc_ru: 'Достигните 1500 Total XP или 8-го уровня профиля', desc_en: 'Reach 1500 Total XP or Profile Level 8', condition_ru: '1500 Total XP или 8-й уровень', condition_en: '1500 Total XP or Level 8', category: 'veteran', rarity: 'legendary', icon: 'star', xp_reward: 0 },
  ];

  const insertAch = db.prepare(`
    INSERT INTO achievements (id, slug, title_ru, title_en, desc_ru, desc_en, condition_ru, condition_en, category, rarity, icon, xp_reward)
    VALUES (@id, @slug, @title_ru, @title_en, @desc_ru, @desc_en, @condition_ru, @condition_en, @category, @rarity, @icon, @xp_reward)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title_ru = excluded.title_ru,
      title_en = excluded.title_en,
      desc_ru = excluded.desc_ru,
      desc_en = excluded.desc_en,
      condition_ru = excluded.condition_ru,
      condition_en = excluded.condition_en,
      category = excluded.category,
      rarity = excluded.rarity,
      icon = excluded.icon,
      xp_reward = excluded.xp_reward
  `);
  for (const ach of achievements) {
    insertAch.run(ach);
  }

  // Seed expanded 36-item XP Customization Shop across 6 distinct categories & 5 rarities
  const shopItems = [
    // 1. Avatar Frames (7 items)
    { id: 'frame_graphite', name_ru: 'Графитовый контур', name_en: 'Graphite Contour', description_ru: 'Минималистичный холодный серый кант', description_en: 'Minimalist cool graphite contour', category: 'frame', cost_xp: 60, rarity: 'common', preview_value: 'border-2 border-white/30' },
    { id: 'frame_ash_ring', name_ru: 'Пепельное кольцо', name_en: 'Ash Ring', description_ru: 'Матовый дымчатый ободок с тонкой обводкой', description_en: 'Matte smoky ring with subtle rim', category: 'frame', cost_xp: 90, rarity: 'uncommon', preview_value: 'border-2 border-[#7b746b] ring-2 ring-[#7b746b]/25' },
    { id: 'frame_silver_thorn', name_ru: 'Серебряный шип', name_en: 'Silver Thorn', description_ru: 'Элегантная серебристая окантовка с мягким свечением', description_en: 'Elegant silver border with subtle glow', category: 'frame', cost_xp: 120, rarity: 'rare', preview_value: 'border-2 border-[#c5c8cf] shadow-[0_0_14px_rgba(197,200,207,0.35)]' },
    { id: 'frame_dark_velvet', name_ru: 'Чёрный бархат', name_en: 'Dark Velvet', description_ru: 'Глубокая бархатная рамка с бордовым отсветом', description_en: 'Deep velvet frame with dark crimson sheen', category: 'frame', cost_xp: 160, rarity: 'rare', preview_value: 'border-2 border-[#721b2b] shadow-[0_0_16px_rgba(130,28,44,0.55)]' },
    { id: 'frame_nocturne_amethyst', name_ru: 'Сумеречный аметист', name_en: 'Nocturne Amethyst', description_ru: 'Холодный фиолетовый ореол ночного эфира', description_en: 'Cold violet halo of midnight resonance', category: 'frame', cost_xp: 220, rarity: 'epic', preview_value: 'border-2 border-[#6e56a8] ring-2 ring-[#a38ee0]/25 shadow-[0_0_18px_rgba(110,86,168,0.55)]' },
    { id: 'frame_gothic_crown', name_ru: 'Венец терновника', name_en: 'Thorn Crown', description_ru: 'Готический венец с двойным контуром и сиянием', description_en: 'Gothic double contour with dark radiance', category: 'frame', cost_xp: 300, rarity: 'epic', preview_value: 'border-2 border-[#821c2c] ring-2 ring-white/25 shadow-[0_0_20px_rgba(130,28,44,0.75)]' },
    { id: 'frame_gilded_relic', name_ru: 'Позолота собора', name_en: 'Cathedral Gilding', description_ru: 'Античная золотая оправа с благородным отблеском', description_en: 'Antique gold reliquary frame with warm glow', category: 'frame', cost_xp: 480, rarity: 'legendary', preview_value: 'border-2 border-[#d4af68] ring-2 ring-[#f3dca6]/35 shadow-[0_0_24px_rgba(212,175,104,0.6)]' },

    // 2. Profile Banners (7 items)
    { id: 'banner_abyss', name_ru: 'Тёмная материя', name_en: 'Dark Matter', description_ru: 'Абсолютный минималистичный чёрный градиент', description_en: 'Pure minimalist dark gradient', category: 'banner', cost_xp: 80, rarity: 'common', preview_value: 'from-[#060608] via-[#100f14] to-[#060608]' },
    { id: 'banner_slate_rain', name_ru: 'Свинцовый дождь', name_en: 'Slate Rain', description_ru: 'Холодный графитовый горизонт осенней ночи', description_en: 'Cold slate horizon of autumn rain', category: 'banner', cost_xp: 110, rarity: 'uncommon', preview_value: 'from-[#0d1014] via-[#1b222c] to-[#0b0c10]' },
    { id: 'banner_night_mist', name_ru: 'Ночной туман', name_en: 'Night Mist', description_ru: 'Атмосферный тёмно-графитовый фон с дымчатой глубиной', description_en: 'Dark graphite backdrop with smoky gradient', category: 'banner', cost_xp: 140, rarity: 'rare', preview_value: 'from-[#0e0d12] via-[#1a1722] to-[#0c0b0e]' },
    { id: 'banner_silver_silk', name_ru: 'Серебряная вуаль', name_en: 'Silver Veil', description_ru: 'Холодные стальные тона с полупрозрачным сиянием', description_en: 'Cold steel hues with ethereal sheen', category: 'banner', cost_xp: 180, rarity: 'rare', preview_value: 'from-[#14151b] via-[#262a36] to-[#0c0b0e]' },
    { id: 'banner_cathedral_veil', name_ru: 'Готический свод', name_en: 'Gothic Vault', description_ru: 'Глубокий винный полумрак с архитектурной фактурой', description_en: 'Deep wine darkness with subtle architectural depth', category: 'banner', cost_xp: 220, rarity: 'epic', preview_value: 'from-[#1c0c14] via-[#341120] to-[#0c0b0e]' },
    { id: 'banner_midnight_choir', name_ru: 'Полуночный хор', name_en: 'Midnight Choir', description_ru: 'Глубокий индиго и бархатные тени собора', description_en: 'Deep indigo and velvet cathedral shadows', category: 'banner', cost_xp: 260, rarity: 'epic', preview_value: 'from-[#110d1e] via-[#251b3d] to-[#0c0b0e]' },
    { id: 'banner_gilded_eclipse', name_ru: 'Золотое затмение', name_en: 'Gilded Eclipse', description_ru: 'Величественный чёрно-золотой градиент реликвии', description_en: 'Regal obsidian and antique gold eclipse gradient', category: 'banner', cost_xp: 440, rarity: 'legendary', preview_value: 'from-[#161108] via-[#362812] to-[#0b0a09]' },

    // 3. Name Styles (6 items)
    { id: 'style_monochrome', name_ru: 'Холодный графит', name_en: 'Cold Graphite', description_ru: 'Сдержанный матовый стиль с увеличенным трекингом', description_en: 'Matte cool font with expanded tracking', category: 'name_style', cost_xp: 50, rarity: 'common', preview_value: 'text-[#b5b0a8] tracking-wider' },
    { id: 'style_bone_ivory', name_ru: 'Слоновая кость', name_en: 'Antique Ivory', description_ru: 'Тёплый винтажный тон старой бумаги и мягкий акцент', description_en: 'Warm vintage ivory tone with soft emphasis', category: 'name_style', cost_xp: 85, rarity: 'uncommon', preview_value: 'text-[#f2e8d5] tracking-wide font-medium' },
    { id: 'style_silver_glow', name_ru: 'Серебряный глянец', name_en: 'Silver Glow', description_ru: 'Светлое серебристое свечение символов имени', description_en: 'Luminous silver lettering', category: 'name_style', cost_xp: 110, rarity: 'rare', preview_value: 'text-[#e6e8ee] drop-shadow-[0_0_8px_rgba(255,255,255,0.45)] font-medium' },
    { id: 'style_crimson_shade', name_ru: 'Бархатный оттенок', name_en: 'Crimson Shade', description_ru: 'Благородный винный оттенок с мягкой тенью', description_en: 'Muted wine tone with soft velvet shadow', category: 'name_style', cost_xp: 150, rarity: 'rare', preview_value: 'text-[#eb909d] drop-shadow-[0_0_9px_rgba(229,138,150,0.45)] font-medium' },
    { id: 'style_amethyst_whisper', name_ru: 'Лунный аметист', name_en: 'Moonlit Amethyst', description_ru: 'Призрачное сиренево-серебристое сияние шрифта', description_en: 'Spectral lavender-silver glow lettering', category: 'name_style', cost_xp: 230, rarity: 'epic', preview_value: 'text-[#d3c4f7] drop-shadow-[0_0_10px_rgba(167,140,235,0.5)] font-medium tracking-wide' },
    { id: 'style_gilded_sovereign', name_ru: 'Золото архива', name_en: 'Archive Gold', description_ru: 'Античный золотой градиент с благородным сиянием', description_en: 'Antique gold luminous lettering', category: 'name_style', cost_xp: 380, rarity: 'legendary', preview_value: 'text-[#f0d599] drop-shadow-[0_0_12px_rgba(224,188,112,0.55)] font-semibold tracking-wide' },

    // 4. Badges & Emblems (6 items)
    { id: 'badge_wanderer', name_ru: 'Значок «Странник»', name_en: 'Wanderer Badge', description_ru: 'Символ ночного исследователя архива', description_en: 'Emblem of the nocturnal wanderer', category: 'badge', cost_xp: 80, rarity: 'common', preview_value: 'Sparkles' },
    { id: 'badge_nocturne', name_ru: 'Значок «Полуночник»', name_en: 'Nocturne Badge', description_ru: 'Эмблема слушателя глубокой ночи', description_en: 'Emblem of the midnight listener', category: 'badge', cost_xp: 115, rarity: 'uncommon', preview_value: 'Moon' },
    { id: 'badge_archivist', name_ru: 'Значок «Хранитель»', name_en: 'Archivist Badge', description_ru: 'Особый знак исследователя дискографии', description_en: 'Emblem of the discography curator', category: 'badge', cost_xp: 150, rarity: 'rare', preview_value: 'Shield' },
    { id: 'badge_audiophile', name_ru: 'Значок «Аудиофил»', name_en: 'Audiophile Badge', description_ru: 'Отметка преданного ценителя звука', description_en: 'Badge of the devoted sound enthusiast', category: 'badge', cost_xp: 200, rarity: 'epic', preview_value: 'Disc' },
    { id: 'badge_ember', name_ru: 'Значок «Пламя»', name_en: 'Ember Badge', description_ru: 'Багровая печать неугасимой преданности', description_en: 'Crimson seal of unbroken devotion', category: 'badge', cost_xp: 260, rarity: 'epic', preview_value: 'Flame' },
    { id: 'badge_night_crown', name_ru: 'Значок «Венец ночи»', name_en: 'Night Crown Badge', description_ru: 'Легендарный знак избранных мастеров архива', description_en: 'Legendary emblem of archive sovereigns', category: 'badge', cost_xp: 450, rarity: 'legendary', preview_value: 'Crown' },

    // 5. Profile Themes (5 items)
    { id: 'theme_obsidian_monolith', name_ru: 'Тема «Обсидиан»', name_en: 'Obsidian Monolith Theme', description_ru: 'Строгий угольно-чёрный корпус карточки с графитовым акцентом', description_en: 'Strict obsidian charcoal card surface with graphite bar', category: 'theme', cost_xp: 140, rarity: 'uncommon', preview_value: 'theme_obsidian_monolith' },
    { id: 'theme_silver_cathedral', name_ru: 'Тема «Серебряный собор»', name_en: 'Silver Cathedral Theme', description_ru: 'Холодное серебристое окаймление и стальной прогресс-бар', description_en: 'Cold silver border sheen with metallic accent bar', category: 'theme', cost_xp: 210, rarity: 'rare', preview_value: 'theme_silver_cathedral' },
    { id: 'theme_crimson_sanctum', name_ru: 'Тема «Багровый неф»', name_en: 'Crimson Sanctum Theme', description_ru: 'Глубокие винные акценты, бордовое свечение и тёмный бархат', description_en: 'Deep wine accents, crimson aura and dark velvet surfaces', category: 'theme', cost_xp: 280, rarity: 'epic', preview_value: 'theme_crimson_sanctum' },
    { id: 'theme_midnight_violet', name_ru: 'Тема «Ночной винтаж»', name_en: 'Midnight Violet Theme', description_ru: 'Благородный сумеречный фиолет для всей карточки профиля', description_en: 'Refined nocturnal twilight violet across profile cards', category: 'theme', cost_xp: 310, rarity: 'epic', preview_value: 'theme_midnight_violet' },
    { id: 'theme_gilded_reliquary', name_ru: 'Тема «Реликварий»', name_en: 'Gilded Reliquary Theme', description_ru: 'Легендарное тёмно-золотое оформление с античным свечением', description_en: 'Legendary dark-gold antique aesthetic with warm radiance', category: 'theme', cost_xp: 520, rarity: 'legendary', preview_value: 'theme_gilded_reliquary' },

    // 6. Profile Atmospheric Effects & Decorations (5 items)
    { id: 'effect_vinyl_grain', name_ru: 'Орнамент «Виниловые дорожки»', name_en: 'Vinyl Grooves Overlay', description_ru: 'Тонкие концентрические линии пластинки на шапке профиля', description_en: 'Subtle concentric vinyl grooves across the profile header', category: 'effect', cost_xp: 130, rarity: 'uncommon', preview_value: 'effect_vinyl_grain' },
    { id: 'effect_silver_filigree', name_ru: 'Украшение «Серебряная филигрань»', name_en: 'Silver Filigree Corners', description_ru: 'Изящные готические уголки и двойная рамка на шапке профиля', description_en: 'Refined gothic corner filigree framing your profile banner', category: 'effect', cost_xp: 200, rarity: 'rare', preview_value: 'effect_silver_filigree' },
    { id: 'effect_crimson_mist', name_ru: 'Эффект «Багровая дымка»', name_en: 'Crimson Mist Aura', description_ru: 'Мягкое винное сияние и тонкая светящаяся линия на баннере', description_en: 'Atmospheric crimson mist glow with illuminated hairline', category: 'effect', cost_xp: 260, rarity: 'epic', preview_value: 'effect_crimson_mist' },
    { id: 'effect_cathedral_light', name_ru: 'Эффект «Свет витража»', name_en: 'Cathedral Light Rays', description_ru: 'Диагональные лучи приглушённого света сквозь тёмный фон', description_en: 'Diagonal muted light shafts across the dark banner', category: 'effect', cost_xp: 320, rarity: 'epic', preview_value: 'effect_cathedral_light' },
    { id: 'effect_eclipse_halo', name_ru: 'Эффект «Ореол затмения»', name_en: 'Eclipse Halo', description_ru: 'Легендарный золотой нимб затмения и глубокая виньетка', description_en: 'Legendary golden eclipse ring and deep atmospheric vignette', category: 'effect', cost_xp: 500, rarity: 'legendary', preview_value: 'effect_eclipse_halo' },
  ];

  const insertShopItem = db.prepare(`
    INSERT INTO shop_items (id, name_ru, name_en, description_ru, description_en, category, cost_xp, rarity, preview_value, is_active)
    VALUES (@id, @name_ru, @name_en, @description_ru, @description_en, @category, @cost_xp, @rarity, @preview_value, 1)
    ON CONFLICT(id) DO UPDATE SET
      name_ru = excluded.name_ru,
      name_en = excluded.name_en,
      description_ru = excluded.description_ru,
      description_en = excluded.description_en,
      category = excluded.category,
      cost_xp = excluded.cost_xp,
      rarity = excluded.rarity,
      preview_value = excluded.preview_value,
      is_active = 1
  `);
  for (const item of shopItems) {
    insertShopItem.run(item);
  }

  // Safe table schema migrations for existing SQLite databases
  try { db.exec("ALTER TABLE albums ADD COLUMN streaming_links_json TEXT;"); } catch {}
  try { db.exec("ALTER TABLE albums ADD COLUMN verified_source TEXT;"); } catch {}
  try { db.exec("ALTER TABLE albums ADD COLUMN last_verified_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN streaming_links_json TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN verified_source TEXT;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN last_verified_at TEXT;"); } catch {}

  // --------------------------------------------------------------------------
  // SEED VERIFIED DEATHMARRIED DISCOGRAPHY (ALBUMS, EPS, SINGLES) — ONCE ONLY
  // --------------------------------------------------------------------------
  const discographySeeded = db.prepare("SELECT value FROM app_meta WHERE key = 'discography_seeded'").get() as { value: string } | undefined;
  const albumCount = db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number };
  if (!discographySeeded && albumCount.count > 0) {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('discography_seeded', '1')").run();
  }
  if (!discographySeeded && albumCount.count === 0) {
    // 1. Studio Album: nightmortan (Released October 10, 2025)
    const alb1Id = 'alb_nightmortan';
    const nightmortanStreaming = JSON.stringify({
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      apple_music: 'https://music.apple.com/us/artist/deathmarried/1769850125',
      yandex_music: 'https://music.yandex.ru/album/38538013',
      vk_music: 'https://vk.com/artist/deathmarried',
      youtube_music: 'https://music.youtube.com/search?q=deathmarried+nightmortan',
    });

    db.prepare(`
      INSERT INTO albums (id, title, release_year, release_date, cover_url, description, track_count, duration_seconds, sort_order, format_type, source_url, streaming_links_json, verified_source, last_verified_at, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alb1Id,
      'nightmortan',
      2025,
      '2025-10-10',
      'https://avatars.yandex.net/get-music-content/16508792/c2b3af87.a.38538013-1/1000x1000',
      'Официальный полноформатный студийный альбом deathmarried, выпущенный 10 октября 2025 года. Мрачная винтажная эстетика, сплав экспериментального андеграунд-рэпа, нью-джаза и гипнотического звукового ландшафта.',
      9,
      1150,
      1,
      'album',
      'https://music.apple.com/us/artist/deathmarried/1769850125',
      nightmortanStreaming,
      'Apple Music (Artist ID: 1769850125) & Yandex Music (Album ID: 38538013)',
      '2026-11-09',
      1
    );

    const nightmortanTracks = [
      { id: 'trk_nm_01', num: 1, title: 'twilight', dur: 132, audio: '/audio/crown_of_thorns.wav', lyrics: 'twilight hours / shadows stretch across the cathedral floor\nwhispers echoing beneath the heavy iron door' },
      { id: 'trk_nm_02', num: 2, title: 'edward scissorhands', dur: 144, audio: '/audio/midnight_rose.wav', lyrics: 'cold blades, quiet hands / garden of black roses in the dead of night' },
      { id: 'trk_nm_03', num: 3, title: 'cross pirouette', dur: 128, audio: '/audio/cathedral_veil.wav', lyrics: 'pirouette in the dust / velvet threads unspooling in silence' },
      { id: 'trk_nm_04', num: 4, title: 'dreams fallen', dur: 140, audio: '', lyrics: 'fallen from the heights into the velvet mist / memory fading where darkness exists' },
      { id: 'trk_nm_05', num: 5, title: 'get married', dur: 136, audio: '', lyrics: 'tied with black silk ribbon / vows taken beneath the autumn veil' },
      { id: 'trk_nm_06', num: 6, title: 'bon ami', dur: 118, audio: '', lyrics: 'farewell to trusted shades / footprints washed by the rain' },
      { id: 'trk_nm_07', num: 7, title: 'on my bones', dur: 152, audio: '', lyrics: 'carved into marrow / heavy subterranean low-end' },
      { id: 'trk_nm_08', num: 8, title: 'there are no angels here', dur: 148, audio: '', lyrics: 'empty stone halls / resonance of forgotten hymns' },
      { id: 'trk_nm_09', num: 9, title: 'the last violin', dur: 162, audio: '', lyrics: 'final bow strokes fading into absolute stillness' },
    ];

    const insertTrack = db.prepare(`
      INSERT INTO tracks (id, album_id, title, track_number, duration_seconds, audio_url, lyrics, source_url, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (const trk of nightmortanTracks) {
      insertTrack.run(
        trk.id,
        alb1Id,
        trk.title,
        trk.num,
        trk.dur,
        trk.audio,
        trk.lyrics,
        'https://music.apple.com/us/artist/deathmarried/1769850125'
      );
    }

    // 2. EP: YOU COULD BE PUMPKIN (Released December 2024 by deathmarried)
    const epPumpkinId = 'ep_pumpkin_2024';
    const pumpkinStreaming = JSON.stringify({
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      apple_music: 'https://music.apple.com/us/artist/deathmarried/1769850125',
      yandex_music: 'https://music.yandex.ru/artist/24402692',
      vk_music: 'https://vk.com/artist/deathmarried',
      youtube_music: 'https://music.youtube.com/search?q=deathmarried+YOU+COULD+BE+PUMPKIN',
    });

    db.prepare(`
      INSERT INTO albums (id, title, release_year, release_date, cover_url, description, track_count, duration_seconds, sort_order, format_type, source_url, streaming_links_json, verified_source, last_verified_at, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      epPumpkinId,
      'YOU COULD BE PUMPKIN',
      2024,
      '2024-12-01',
      '',
      'Официальный концептуальный EP (декабрь 2024). Авангардный лоу-фай и рейдж-звучание deathmarried.',
      6,
      768,
      2,
      'ep',
      'https://music.apple.com/us/artist/deathmarried/1769850125',
      pumpkinStreaming,
      'Apple Music & VK (Artist: deathmarried)',
      '2026-11-09',
      1
    );

    const pumpkinTracks = [
      { id: 'trk_pk_01', num: 1, title: 'с мёртвыми', dur: 105 },
      { id: 'trk_pk_02', num: 2, title: 'Chery Tiggo', dur: 151 },
      { id: 'trk_pk_03', num: 3, title: 'Estate', dur: 124 },
      { id: 'trk_pk_04', num: 4, title: 'Gotham', dur: 130 },
      { id: 'trk_pk_05', num: 5, title: 'Batman', dur: 138 },
      { id: 'trk_pk_06', num: 6, title: 'DJ Pumpkin', dur: 120 },
    ];

    for (const trk of pumpkinTracks) {
      insertTrack.run(
        trk.id,
        epPumpkinId,
        trk.title,
        trk.num,
        trk.dur,
        '',
        'Track from YOU COULD BE PUMPKIN EP.',
        'https://music.apple.com/us/artist/deathmarried/1769850125'
      );
    }

    // 3. EP: MURDA M (Released 2024 by deathmarried)
    const epMurdaId = 'ep_murda_m_2024';
    const murdaStreaming = JSON.stringify({
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      apple_music: 'https://music.apple.com/us/artist/deathmarried/1769850125',
      vk_music: 'https://vk.com/artist/deathmarried',
      youtube_music: 'https://music.youtube.com/search?q=deathmarried+MURDA+M',
    });

    db.prepare(`
      INSERT INTO albums (id, title, release_year, release_date, cover_url, description, track_count, duration_seconds, sort_order, format_type, source_url, streaming_links_json, verified_source, last_verified_at, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      epMurdaId,
      'MURDA M',
      2024,
      '2024-04-15',
      '',
      'Официальный мини-релиз MURDA M (2024). Агрессивный звук и эксперименты с ритмикой.',
      3,
      375,
      3,
      'ep',
      'https://music.apple.com/us/artist/deathmarried/1769850125',
      murdaStreaming,
      'Apple Music (Artist: deathmarried)',
      '2026-11-09',
      1
    );

    const murdaTracks = [
      { id: 'trk_mm_01', num: 1, title: 'НИКТО НЕ ХОЧЕТ', dur: 125 },
      { id: 'trk_mm_02', num: 2, title: 'Гриффины', dur: 118 },
      { id: 'trk_mm_03', num: 3, title: 'MURDA M', dur: 132 },
    ];

    for (const trk of murdaTracks) {
      insertTrack.run(
        trk.id,
        epMurdaId,
        trk.title,
        trk.num,
        trk.dur,
        '',
        'Archived canon track from MURDA M.',
        'https://music.apple.com/us/artist/deathmarried/1769850125'
      );
    }

    // 4. Official Verified Singles
    const insertSingle = db.prepare(`
      INSERT INTO singles (id, title, release_year, release_date, cover_url, description, duration_seconds, audio_url, source_url, streaming_links_json, verified_source, last_verified_at, is_verified, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const standardStreaming = (title: string, appleUrl?: string) => JSON.stringify({
      apple_music: appleUrl || 'https://music.apple.com/us/artist/deathmarried/1769850125',
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      vk_music: 'https://vk.com/artist/deathmarried',
      yandex_music: 'https://music.yandex.ru/artist/24402692',
      youtube_music: `https://music.youtube.com/search?q=deathmarried+${encodeURIComponent(title)}`,
    });

    const verifiedSinglesList = [
      {
        id: 'sng_athens_2026',
        title: 'athens',
        year: 2026,
        date: '2026-06-01',
        dur: 142,
        desc: 'Официальный сингл 2026 года. Эволюция готического трэпа и атмосферных текстур.',
        url: 'https://music.apple.com/us/album/athens-single/1813476901',
        source: 'Apple Music (Album ID: 1813476901)',
      },
      {
        id: 'sng_satn_2025',
        title: 'satn',
        year: 2025,
        date: '2025-03-28',
        dur: 135,
        desc: 'Официальный сингл (28 марта 2025 г.). Тяжёлый низкочастотный бас и фирменная подача.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_sexisdeath_2025',
        title: 'sexisdeath',
        year: 2025,
        date: '2025-01-24',
        dur: 128,
        desc: 'Официальный сингл (24 января 2025 г.), предварявший альбом nightmortan.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_erd_2024',
        title: 'Erd',
        year: 2024,
        date: '2024-08-10',
        dur: 115,
        desc: 'Культовый андеграунд-сингл deathmarried.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & VK',
      },
      {
        id: 'sng_yetiraper_2024',
        title: '#YETIRAPER',
        year: 2024,
        date: '2024-05-20',
        dur: 130,
        desc: 'Официальный сингл 2024 года с характерным агрессивным флоу deathmarried.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_swag_from_ohio_2023',
        title: 'SWAG FROM OHIO',
        year: 2023,
        date: '2023-11-12',
        dur: 134,
        desc: 'Официальный ранний релиз deathmarried, заложивший основы андеграунд-стиля.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_hells_holidays_2023',
        title: "HELL'S HOLIDAYS",
        year: 2023,
        date: '2023-09-01',
        dur: 122,
        desc: 'Мрачный экспериментальный сингл 2023 года.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music',
      },
      {
        id: 'sng_flawless_2023',
        title: 'FLAWLЁSS',
        year: 2023,
        date: '2023-06-15',
        dur: 145,
        desc: 'Сингл с уникальным звучанием и гипнотической атмосферой.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music',
      },
      {
        id: 'sng_love_2023',
        title: 'Любовью<3',
        year: 2023,
        date: '2023-04-10',
        dur: 125,
        desc: 'Мелодичный готическо-романтический релиз 2023 года.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & VK',
      },
      {
        id: 'sng_pnmd_2023',
        title: 'ПНМД',
        year: 2023,
        date: '2023-02-18',
        dur: 112,
        desc: 'Ранний андеграунд-сингл с плотным саундом.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & VK',
      },
    ];

    verifiedSinglesList.forEach((sng, idx) => {
      insertSingle.run(
        sng.id,
        sng.title,
        sng.year,
        sng.date,
        '',
        sng.desc,
        sng.dur,
        '',
        sng.url,
        standardStreaming(sng.title, sng.url),
        sng.source,
        '2026-11-09',
        1,
        idx + 1
      );
    });
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('discography_seeded', '1')").run();
  }

  // Seed verified Quiz Questions on real deathmarried canon
  const quizCount = db.prepare('SELECT COUNT(*) as count FROM quiz_questions').get() as { count: number };
  if (quizCount.count === 0) {
    const questions = [
      {
        id: 'qz_dm_01',
        question_ru: 'Какой полноформатный студийный альбом deathmarried официально выпустил 10 октября 2025 года?',
        question_en: 'Which full-length studio album did deathmarried officially release on October 10, 2025?',
        options_json: JSON.stringify(['nightmortan', 'YOU COULD BE PUMPKIN', 'athens', 'dark gothic tape']),
        correct_index: 0,
        explanation_ru: 'Альбом nightmortan из 9 композиций официально вышел 10 октября 2025 года.',
        explanation_en: 'The 9-track studio album nightmortan officially dropped on October 10, 2025.',
        difficulty: 1,
      },
      {
        id: 'qz_dm_02',
        question_ru: 'В каком музыкальном жанре создаёт композиции артист deathmarried?',
        question_en: 'In which musical aesthetic does deathmarried compose his works?',
        options_json: JSON.stringify(['Экспериментальный андеграунд-рэп и нью-джаз', 'Синти-поп 80-х', 'Классический шансон', 'Хеви-метал']),
        correct_index: 0,
        explanation_ru: 'Звучание deathmarried характеризуется экспериментальным трэпом, нью-джазом и мрачной текстурной атмосферой.',
        explanation_en: 'The sound of deathmarried is characterized by experimental trap, new-jazz and dark textured atmospheres.',
        difficulty: 1,
      },
      {
        id: 'qz_dm_03',
        question_ru: 'Какая композиция является открывающим треком альбома nightmortan?',
        question_en: 'Which track serves as the opening composition on the album nightmortan?',
        options_json: JSON.stringify(['twilight', 'edward scissorhands', 'the last violin', 'get married']),
        correct_index: 0,
        explanation_ru: 'Открывающим треком альбома является "twilight".',
        explanation_en: 'The album opens with "twilight".',
        difficulty: 1,
      },
      {
        id: 'qz_dm_04',
        question_ru: 'Какой концептуальный EP был выпущен артистом в 2024 году?',
        question_en: 'Which conceptual EP was released by the artist in 2024?',
        options_json: JSON.stringify(['YOU COULD BE PUMPKIN', 'nightmortan', 'athens', 'velvet crypt']),
        correct_index: 0,
        explanation_ru: 'EP "YOU COULD BE PUMPKIN" вышел в 2024 году и включает треки estate, dj pumpkin, ERD и chery tiggo.',
        explanation_en: 'The EP "YOU COULD BE PUMPKIN" was released in 2024, featuring estate, dj pumpkin, ERD and chery tiggo.',
        difficulty: 1,
      },
      {
        id: 'qz_dm_05',
        question_ru: 'Какой официальный сингл deathmarried датирован 2026 годом?',
        question_en: 'Which official single by deathmarried is dated 2026?',
        options_json: JSON.stringify(['athens', 'satn', 'sexisdeath', 'dreams fallen']),
        correct_index: 0,
        explanation_ru: 'Сингл "athens" является официальным релизом 2026 года.',
        explanation_en: 'The single "athens" is the official 2026 release.',
        difficulty: 1,
      },
    ];

    const insertQ = db.prepare(`
      INSERT INTO quiz_questions (id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty)
      VALUES (@id, @question_ru, @question_en, @options_json, @correct_index, @explanation_ru, @explanation_en, @difficulty)
    `);
    for (const q of questions) {
      insertQ.run(q);
    }
  }

  // Seed welcoming community discussion
  const postCount = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
  if (postCount.count === 0) {
    const p1Id = 'post_001';
    db.prepare(`
      INSERT INTO posts (id, user_id, category_id, title, content, is_pinned, reactions_count, views_count)
      VALUES (?, ?, ?, ?, ?, 1, 4, 38)
    `).run(
      p1Id,
      'usr_admin_001',
      'cat_official',
      'nightmortan & YOU COULD BE PUMPKIN: Дискография deathmarried',
      'Приветствуем всех слушателей и исследователей звука. Этот портал создан для сохранения подтверждённой дискографии артиста deathmarried — от альбома nightmortan (10 октября 2025) и релиза YOU COULD BE PUMPKIN (2024) до новейших синглов. Делитесь теориями, анализируйте тексты и публикуйте авторские работы в галерее.'
    );

    db.prepare(`
      INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type)
      VALUES ('rx_001', 'usr_admin_001', 'post', ?, 'rose')
    `).run(p1Id);
  }

  // --------------------------------------------------------------------------
  // LIVE DATABASE CLEANUP & REVISIONS
  // --------------------------------------------------------------------------
  try {
    // Unset the project logo from album and single covers so clean typography sleeve displays
    db.prepare("UPDATE albums SET cover_url = '' WHERE cover_url LIKE '%photo_2026%'").run();
    db.prepare("UPDATE singles SET cover_url = '' WHERE cover_url LIKE '%photo_2026%'").run();
    // Ensure nightmortan has its official CDN cover
    db.prepare("UPDATE albums SET cover_url = 'https://avatars.yandex.net/get-music-content/16508792/c2b3af87.a.38538013-1/1000x1000' WHERE id = 'alb_nightmortan' AND (cover_url IS NULL OR cover_url = '')").run();

    // Purge any legacy yeschapskii mentions from database text
    db.prepare("UPDATE albums SET description = REPLACE(description, ' / yeschapskii', '') WHERE description LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE singles SET description = REPLACE(description, 'периода yeschapskii / deathmarried', 'deathmarried') WHERE description LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE singles SET description = REPLACE(description, 'ранний релиз yeschapskii', 'ранний релиз deathmarried') WHERE description LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE posts SET content = REPLACE(content, ' (yeschapskii)', '') WHERE content LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE posts SET title = REPLACE(title, ' (yeschapskii)', '') WHERE title LIKE '%yeschapskii%'").run();

    // Update quiz question 2 to deathmarried sound aesthetics
    db.prepare(`
      UPDATE quiz_questions
      SET question_ru = 'В каком музыкальном жанре создаёт композиции артист deathmarried?',
          question_en = 'In which musical aesthetic does deathmarried compose his works?',
          options_json = ?,
          correct_index = 0,
          explanation_ru = 'Звучание deathmarried характеризуется экспериментальным трэпом, нью-джазом и мрачной текстурной атмосферой.',
          explanation_en = 'The sound of deathmarried is characterized by experimental trap, new-jazz and dark textured atmospheres.'
      WHERE id = 'qz_dm_02'
    `).run(JSON.stringify(['Экспериментальный андеграунд-рэп и нью-джаз', 'Синти-поп 80-х', 'Классический шансон', 'Хеви-метал']));

    // Clean legacy cat_lore category references -> cat_official
    db.prepare("UPDATE posts SET category_id = 'cat_official' WHERE category_id = 'cat_lore'").run();
    db.prepare("DELETE FROM post_categories WHERE id = 'cat_lore'").run();

    const cleanupApplied = db.prepare("SELECT value FROM app_meta WHERE key = 'cleanup_v1_applied'").get();
    if (!cleanupApplied) {
      // Clean duplicate broken track trk_8f0b51c4 and ensure verified track #9 (the last violin) exists (once only)
      const brokenAudioPath = path.resolve('public/audio/the_last_violin.mp3');
      if (!fs.existsSync(brokenAudioPath)) {
        db.prepare("DELETE FROM tracks WHERE id = 'trk_8f0b51c4' AND audio_url = '/audio/the_last_violin.mp3'").run();
      }
      const nmAlbum = db.prepare("SELECT id FROM albums WHERE id = 'alb_nightmortan'").get();
      const hasLastViolin = db.prepare("SELECT id FROM tracks WHERE album_id = 'alb_nightmortan' AND LOWER(title) = 'the last violin'").get();
      if (nmAlbum && !hasLastViolin) {
        db.prepare(`
          INSERT OR IGNORE INTO tracks (id, album_id, title, track_number, duration_seconds, audio_url, lyrics, source_url, is_verified)
          VALUES ('trk_nm_09', 'alb_nightmortan', 'the last violin', 9, 162, '', 'final bow strokes fading into absolute stillness', 'https://music.apple.com/us/artist/deathmarried/1769850125', 1)
        `).run();
      }
      db.prepare(`
        UPDATE albums SET
          track_count = (SELECT COUNT(*) FROM tracks WHERE album_id = albums.id),
          duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM tracks WHERE album_id = albums.id)
        WHERE id = 'alb_nightmortan'
      `).run();
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('cleanup_v1_applied', '1')").run();
    }

    // Update cliché admin display_name if untouched
    db.prepare("UPDATE profiles SET display_name = 'Archive Curator (Admin)' WHERE user_id = 'usr_admin_001' AND display_name = 'Arch-Apostle (Admin)'").run();
  } catch (err) {
    console.warn('DB cleanup notice:', err);
  }
}

