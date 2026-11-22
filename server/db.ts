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
    instance.pragma('synchronous = NORMAL');
  } catch {}
  instance.pragma('foreign_keys = ON');
  return instance;
}

export let db = openConfiguredDatabase(activeDbPath);

export function getDbPath(): string {
  return activeDbPath;
}

export function closeDatabase(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    db.close();
  } catch {}
}

export function serializeDatabase(): Buffer {
  return db.serialize();
}

export function replaceDatabaseWithBuffer(buffer: Buffer): void {
  if (!buffer || buffer.length < 100) return;
  try {
    db.close();
  } catch {}
  try {
    if (fs.existsSync(`${activeDbPath}-wal`)) fs.unlinkSync(`${activeDbPath}-wal`);
    if (fs.existsSync(`${activeDbPath}-shm`)) fs.unlinkSync(`${activeDbPath}-shm`);
  } catch {}
  fs.writeFileSync(activeDbPath, buffer);
  db = openConfiguredDatabase(activeDbPath);
  initDatabase();
}

export function initDatabase() {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS uploaded_blobs (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe table schema migrations for existing databases
  try { db.exec("ALTER TABLE profiles ADD COLUMN total_xp INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN custom_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_frame TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_banner TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_name_style TEXT;"); } catch {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN equipped_badge TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tracks ADD COLUMN is_game_eligible INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE singles ADD COLUMN is_game_eligible INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE post_categories ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';"); } catch {}
  try { db.exec("ALTER TABLE posts ADD COLUMN rejection_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE comments ADD COLUMN parent_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';"); } catch {}
  try { db.exec("ALTER TABLE creations ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';"); } catch {}
  try { db.exec("ALTER TABLE creations ADD COLUMN rejection_reason TEXT;"); } catch {}

  // Sync total_xp with existing xp if total_xp is 0
  try {
    db.exec("UPDATE profiles SET total_xp = xp WHERE total_xp = 0 AND xp > 0;");
  } catch {}

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

  // Seed clean music-centric Achievements
  const achievements = [
    { id: 'ach_first_blood', slug: 'first_blood', title_ru: 'Первый шаг', title_en: 'First Step', desc_ru: 'Сыграйте в любое интерактивное испытание архива', desc_en: 'Play your first interactive challenge', icon: 'play', xp_reward: 50 },
    { id: 'ach_initiate_ritual', slug: 'initiate_ritual', title_ru: 'Чуткий слух', title_en: 'Musical Ear', desc_ru: 'Завершите 10 раундов в играх архива', desc_en: 'Complete 10 interactive game sessions', icon: 'headphones', xp_reward: 100 },
    { id: 'ach_lore_scholar', slug: 'lore_scholar', title_ru: 'Знаток дискографии', title_en: 'Discography Connoisseur', desc_ru: 'Пройдите ежедневную викторину без ошибок', desc_en: 'Achieve a perfect score in Daily Quiz', icon: 'award', xp_reward: 150 },
    { id: 'ach_devoted_acolyte', slug: 'devoted_acolyte', title_ru: 'Преданный слушатель', title_en: 'Devoted Listener', desc_ru: 'Поддерживайте серию активности 3 дня подряд', desc_en: 'Maintain a 3-day daily streak', icon: 'calendar', xp_reward: 100 },
    { id: 'ach_eternal_vigil', slug: 'eternal_vigil', title_ru: 'Хранитель архива', title_en: 'Archive Keeper', desc_ru: 'Серия активности 7 дней подряд', desc_en: 'Maintain a 7-day daily streak', icon: 'shield', xp_reward: 250 },
    { id: 'ach_gothic_artisan', slug: 'gothic_artisan', title_ru: 'Творец', title_en: 'Creator', desc_ru: 'Опубликуйте свою работу в творческой галерее', desc_en: 'Publish your work in the Creations gallery', icon: 'sparkles', xp_reward: 100 },
    { id: 'ach_voice_of_abyss', slug: 'voice_of_abyss', title_ru: 'Голос сообщества', title_en: 'Community Voice', desc_ru: 'Создайте 3 записи на форуме сообщества', desc_en: 'Create 3 community forum discussions', icon: 'message-square', xp_reward: 150 },
    { id: 'ach_dark_apostle', slug: 'dark_apostle', title_ru: 'Мастер звука', title_en: 'Sound Master', desc_ru: 'Наберите 500 очков опыта (XP)', desc_en: 'Attain 500 total XP', icon: 'trophy', xp_reward: 300 },
    { id: 'ach_collector', slug: 'collector', title_ru: 'Коллекционер', title_en: 'Collector', desc_ru: 'Приобретите первый предмет в магазине кастомизации', desc_en: 'Acquire your first item in the XP Shop', icon: 'tag', xp_reward: 100 },
  ];

  const insertAch = db.prepare(`
    INSERT INTO achievements (id, slug, title_ru, title_en, desc_ru, desc_en, icon, xp_reward)
    VALUES (@id, @slug, @title_ru, @title_en, @desc_ru, @desc_en, @icon, @xp_reward)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title_ru = excluded.title_ru,
      title_en = excluded.title_en,
      desc_ru = excluded.desc_ru,
      desc_en = excluded.desc_en,
      icon = excluded.icon,
      xp_reward = excluded.xp_reward
  `);
  for (const ach of achievements) {
    insertAch.run(ach);
  }

  // Seed default XP Shop Items
  const shopItems = [
    // Frames
    { id: 'frame_silver_thorn', name_ru: 'Серебряный шип', name_en: 'Silver Thorn', description_ru: 'Элегантная серебристая окантовка с мягким свечением', description_en: 'Elegant silver border with subtle glow', category: 'frame', cost_xp: 120, rarity: 'rare', preview_value: 'border-2 border-[#c5c8cf] shadow-[0_0_14px_rgba(197,200,207,0.35)]' },
    { id: 'frame_dark_velvet', name_ru: 'Чёрный бархат', name_en: 'Dark Velvet', description_ru: 'Глубокая бархатная рамка с бордовым отсветом', description_en: 'Deep velvet frame with dark crimson sheen', category: 'frame', cost_xp: 160, rarity: 'rare', preview_value: 'border-2 border-[#54121e] shadow-[0_0_16px_rgba(130,28,44,0.5)]' },
    { id: 'frame_gothic_crown', name_ru: 'Венец терновника', name_en: 'Thorn Crown', description_ru: 'Готический венец с двойным контуром и сиянием', description_en: 'Gothic double contour with dark radiance', category: 'frame', cost_xp: 300, rarity: 'epic', preview_value: 'border-2 border-[#821c2c] ring-2 ring-white/20 shadow-[0_0_20px_rgba(130,28,44,0.7)]' },
    { id: 'frame_graphite', name_ru: 'Графитовый контур', name_en: 'Graphite Contour', description_ru: 'Минималистичный холодный серый кант', description_en: 'Minimalist cool graphite contour', category: 'frame', cost_xp: 60, rarity: 'common', preview_value: 'border-2 border-white/30' },
    // Banners
    { id: 'banner_night_mist', name_ru: 'Ночной туман', name_en: 'Night Mist', description_ru: 'Атмосферный тёмно-графитовый фон с дымчатой глубиной', description_en: 'Dark graphite backdrop with smoky gradient', category: 'banner', cost_xp: 140, rarity: 'rare', preview_value: 'from-[#0e0d12] via-[#1a1722] to-[#0c0b0e]' },
    { id: 'banner_cathedral_veil', name_ru: 'Готический свод', name_en: 'Gothic Vault', description_ru: 'Глубокий винный полумрак с архитектурной фактурой', description_en: 'Deep wine darkness with subtle architectural depth', category: 'banner', cost_xp: 220, rarity: 'epic', preview_value: 'from-[#1c0c14] via-[#2a101b] to-[#0c0b0e]' },
    { id: 'banner_silver_silk', name_ru: 'Серебряная вуаль', name_en: 'Silver Veil', description_ru: 'Холодные стальные тона с полупрозрачным сиянием', description_en: 'Cold steel hues with ethereal sheen', category: 'banner', cost_xp: 180, rarity: 'rare', preview_value: 'from-[#14151b] via-[#21242e] to-[#0c0b0e]' },
    { id: 'banner_abyss', name_ru: 'Тёмная материя', name_en: 'Dark Matter', description_ru: 'Абсолютный минималистичный чёрный градиент', description_en: 'Pure minimalist dark gradient', category: 'banner', cost_xp: 80, rarity: 'common', preview_value: 'from-[#060608] via-[#100f14] to-[#060608]' },
    // Name Styles
    { id: 'style_silver_glow', name_ru: 'Серебряный глянец', name_en: 'Silver Glow', description_ru: 'Светлое серебристое свечение символов никнейма', description_en: 'Luminous silver lettering', category: 'name_style', cost_xp: 110, rarity: 'rare', preview_value: 'text-[#e6e8ee] drop-shadow-[0_0_8px_rgba(255,255,255,0.45)] font-medium' },
    { id: 'style_crimson_shade', name_ru: 'Бархатный оттенок', name_en: 'Crimson Shade', description_ru: 'Благородный винный оттенок с мягкой тенью', description_en: 'Muted wine tone with soft velvet shadow', category: 'name_style', cost_xp: 150, rarity: 'rare', preview_value: 'text-[#e58a96] drop-shadow-[0_0_8px_rgba(229,138,150,0.4)]' },
    { id: 'style_monochrome', name_ru: 'Холодный графит', name_en: 'Cold Graphite', description_ru: 'Сдержанный матовый стиль с увеличенным трекингом', description_en: 'Matte cool font with expanded tracking', category: 'name_style', cost_xp: 50, rarity: 'common', preview_value: 'text-[#aaa59e] tracking-wider' },
    // Badges
    { id: 'badge_archivist', name_ru: 'Значок «Хранитель»', name_en: 'Archivist Badge', description_ru: 'Особый знак исследователя дискографии', description_en: 'Emblem of the discography curator', category: 'badge', cost_xp: 150, rarity: 'rare', preview_value: 'Shield' },
    { id: 'badge_audiophile', name_ru: 'Значок «Аудиофил»', name_en: 'Audiophile Badge', description_ru: 'Отметка преданного ценителя звука', description_en: 'Badge of the devoted sound enthusiast', category: 'badge', cost_xp: 200, rarity: 'epic', preview_value: 'Disc' },
    { id: 'badge_wanderer', name_ru: 'Значок «Странник»', name_en: 'Wanderer Badge', description_ru: 'Символ ночного исследователя', description_en: 'Emblem of the nocturnal wanderer', category: 'badge', cost_xp: 80, rarity: 'common', preview_value: 'Sparkles' },
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
  // SEED VERIFIED DEATHMARRIED DISCOGRAPHY (ALBUMS, EPS, SINGLES)
  // --------------------------------------------------------------------------
  const albumCount = db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number };
  if (albumCount.count === 0) {
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

    // Clean duplicate broken track trk_8f0b51c4 and ensure verified track #9 (the last violin) exists
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

    // Update cliché admin display_name if untouched
    db.prepare("UPDATE profiles SET display_name = 'Archive Curator (Admin)' WHERE user_id = 'usr_admin_001' AND display_name = 'Arch-Apostle (Admin)'").run();
  } catch (err) {
    console.warn('DB cleanup notice:', err);
  }
}

