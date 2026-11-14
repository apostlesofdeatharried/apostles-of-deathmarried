-- ============================================================================
-- APOSTLES OF DEATHMARRIED — MASTER RELATIONAL DATABASE SCHEMA (PostgreSQL / Supabase)
-- ============================================================================

-- Roles enum / table
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  level INT NOT NULL DEFAULT 1
);

INSERT INTO roles (id, name, description, level) VALUES
  ('guest', 'Guest', 'Unauthenticated visitor', 0),
  ('user', 'User', 'Registered community apostle', 1),
  ('moderator', 'Moderator', 'Content & community moderator', 2),
  ('admin', 'Administrator', 'Full site & archive administrator', 3)
ON CONFLICT (id) DO NOTHING;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL DEFAULT 'user' REFERENCES roles(id) ON DELETE RESTRICT,
  is_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(LOWER(nickname));

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  daily_streak INT NOT NULL DEFAULT 0,
  last_active_date DATE,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table for secure cookie-based auth
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Albums
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  release_year INT,
  cover_url TEXT,
  description TEXT,
  track_count INT NOT NULL DEFAULT 0,
  duration_seconds INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singles
CREATE TABLE IF NOT EXISTS singles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  release_year INT,
  cover_url TEXT,
  description TEXT,
  duration_seconds INT NOT NULL DEFAULT 0,
  audio_url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  album_id TEXT REFERENCES albums(id) ON DELETE CASCADE,
  single_id TEXT REFERENCES singles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  track_number INT NOT NULL DEFAULT 1,
  duration_seconds INT NOT NULL DEFAULT 0,
  audio_url TEXT NOT NULL,
  snippet_start_seconds INT DEFAULT 0,
  snippet_duration_seconds INT DEFAULT 15,
  lyrics TEXT,
  external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);

-- Audio files & Archive images storage log
CREATE TABLE IF NOT EXISTS audio_files (
  id TEXT PRIMARY KEY,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INT NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archive_images (
  id TEXT PRIMARY KEY,
  title TEXT,
  storage_path TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'artwork',
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Games catalog
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  rules TEXT,
  xp_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO games (id, slug, title, description, xp_multiplier) VALUES
  ('guess-track', 'guess-track', 'Guess The Track', 'Listen to short fragments of deathmarried compositions and identify the track title.', 1.0),
  ('daily-quiz', 'daily-quiz', 'Daily Lore Quiz', 'A daily set of lore, releases, and symbolic queries for true devotees.', 1.2)
ON CONFLICT (id) DO NOTHING;

-- Quiz Questions
CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  question_ru TEXT NOT NULL,
  question_en TEXT NOT NULL,
  options_json TEXT NOT NULL, -- JSON array of strings
  correct_index INT NOT NULL,
  explanation_ru TEXT,
  explanation_en TEXT,
  difficulty INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily Challenges
CREATE TABLE IF NOT EXISTS daily_challenges (
  id TEXT PRIMARY KEY,
  challenge_date DATE NOT NULL UNIQUE,
  questions_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game Attempts & User Scores
CREATE TABLE IF NOT EXISTS game_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  score INT NOT NULL DEFAULT 0,
  xp_earned INT NOT NULL DEFAULT 0,
  details_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_attempts_user ON game_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_game_attempts_created_at ON game_attempts(created_at);

-- Achievements
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title_ru TEXT NOT NULL,
  title_en TEXT NOT NULL,
  desc_ru TEXT NOT NULL,
  desc_en TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'rose',
  xp_reward INT NOT NULL DEFAULT 50
);

-- User Achievements
CREATE TABLE IF NOT EXISTS user_achievements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_achievement UNIQUE (user_id, achievement_id)
);

-- Forum Categories
CREATE TABLE IF NOT EXISTS post_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_ru TEXT NOT NULL,
  name_en TEXT NOT NULL,
  desc_ru TEXT,
  desc_en TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

-- Community Posts
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES post_categories(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT, -- image, video, audio, link
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  views_count INT NOT NULL DEFAULT 0,
  reactions_count INT NOT NULL DEFAULT 0,
  comments_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  creation_id TEXT, -- soft reference if commenting on creations
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- Reactions (heart, rose, flame, skull)
CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, -- post, creation, comment
  target_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL DEFAULT 'rose',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_reaction UNIQUE (user_id, target_type, target_id)
);

-- Creations Gallery (user art, fan covers, edits, beats, remixes, poetry)
CREATE TABLE IF NOT EXISTS creations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL, -- cover, artwork, edit, beat, remix, lyrics
  description TEXT,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL, -- image, audio, video
  views_count INT NOT NULL DEFAULT 0,
  likes_count INT NOT NULL DEFAULT 0,
  is_approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creations_category ON creations(category);
CREATE INDEX IF NOT EXISTS idx_creations_created_at ON creations(created_at DESC);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_follow UNIQUE (follower_id, following_id),
  CONSTRAINT chk_no_self_follow CHECK (follower_id != following_id)
);

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, -- track, album, creation, post
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_favorite UNIQUE (user_id, target_type, target_id)
);

-- Reports & Moderation Actions
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL, -- user, post, creation, comment
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, resolved, dismissed
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- warn, ban, unban, delete_content
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Translations dictionary table for dynamic i18n
CREATE TABLE IF NOT EXISTS translations (
  key TEXT PRIMARY KEY,
  ru TEXT NOT NULL,
  en TEXT NOT NULL
);
