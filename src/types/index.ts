export type UserRole = 'guest' | 'user' | 'moderator' | 'admin';

export type ShopCategory = 'frame' | 'banner' | 'name_style' | 'badge' | 'title' | 'theme' | 'effect';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface UserProfile {
  id: string;
  nickname: string;
  email?: string;
  email_verified?: number;
  role_id: UserRole;
  display_name: string;
  avatar_url: string;
  bio?: string;
  custom_status?: string;
  level: number;
  xp: number; // Current spendable XP
  total_xp?: number; // Lifetime XP earned
  equipped_frame?: string | null;
  equipped_banner?: string | null;
  equipped_name_style?: string | null;
  equipped_badge?: string | null;
  equipped_title?: string | null;
  equipped_theme?: string | null;
  equipped_effect?: string | null;
  featured_achievements?: string[];
  username_changed_at?: string | null;
  daily_streak?: number;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  creations_count?: number;
  is_banned?: number;
  is_private?: number;
  accepted_rules?: number;
  favorite_track?: string | null;
  notify_follows?: number;
  notify_news?: number;
  registered_at?: string;
  games_played?: number | null;
  guess_track_played?: number | null;
  guess_track_wins?: number | null;
  quiz_played?: number | null;
  quiz_perfect_runs?: number | null;
  quiz_best_score?: number | null;
  guess_lyrics_played?: number | null;
  guess_lyrics_wins?: number | null;
  reverse_track_played?: number | null;
  reverse_track_wins?: number | null;
  speed_track_played?: number | null;
  speed_track_wins?: number | null;
}

export interface Track {
  id: string;
  album_id?: string | null;
  single_id?: string | null;
  title: string;
  track_number?: number;
  duration_seconds: number;
  audio_url: string;
  has_local_audio?: boolean;
  snippet_start_seconds?: number;
  snippet_duration_seconds?: number;
  lyrics?: string;
  external_url?: string;
  source_url?: string;
  is_verified?: boolean;
  is_game_eligible?: number;
  album_title?: string;
  cover_url?: string;
}

export interface StreamingLinks {
  spotify?: string;
  apple_music?: string;
  yandex_music?: string;
  vk_music?: string;
  youtube_music?: string;
  soundcloud?: string;
}

export interface Album {
  id: string;
  title: string;
  release_year: number;
  release_date?: string;
  cover_url: string;
  description: string;
  track_count: number;
  duration_seconds: number;
  sort_order: number;
  format_type?: 'album' | 'ep';
  source_url?: string;
  streaming_links?: StreamingLinks;
  verified_source?: string;
  last_verified_at?: string;
  is_verified?: boolean;
  tracks?: Track[];
}

export interface Single {
  id: string;
  title: string;
  release_year: number;
  release_date?: string;
  cover_url: string;
  description: string;
  duration_seconds: number;
  audio_url: string;
  has_local_audio?: boolean;
  source_url?: string;
  streaming_links?: StreamingLinks;
  lyrics?: string;
  verified_source?: string;
  last_verified_at?: string;
  is_verified?: boolean;
  is_game_eligible?: number;
  sort_order: number;
}

export interface Achievement {
  id?: string;
  slug: string;
  title_ru: string;
  title_en: string;
  desc_ru: string;
  desc_en: string;
  condition_ru?: string;
  condition_en?: string;
  category?: string;
  rarity?: AchievementRarity;
  difficulty_tier?: 'easy' | 'medium' | 'hard';
  is_secret?: boolean;
  progress?: {
    current: number;
    target: number;
  };
  icon: string;
  unlocked_at?: string | null;
  is_unlocked?: boolean;
  xp_reward?: number;
}

export interface PostCategory {
  id: string;
  slug: string;
  name_ru: string;
  name_en: string;
  desc_ru?: string;
  desc_en?: string;
  sort_order: number;
  is_official?: number;
  post_count?: number;
}

export interface QuizQuestion {
  id: string;
  question_ru: string;
  question_en: string;
  options: string[];
  difficulty?: number;
  correct_index?: number;
  explanation_ru?: string;
  explanation_en?: string;
}

export interface Post {
  id: string;
  user_id: string;
  category_id: string;
  title: string;
  content: string;
  media_url?: string;
  media_type?: string;
  is_pinned: number;
  is_locked: number;
  status: 'pending' | 'approved' | 'rejected' | 'hidden';
  rejection_reason?: string;
  views_count: number;
  reactions_count: number;
  comments_count: number;
  created_at: string;
  author_nickname: string;
  author_name: string;
  author_avatar: string;
  author_level: number;
  author_frame?: string;
  author_name_style?: string;
  author_badge?: string;
  author_title?: string;
  category_name_ru: string;
  category_name_en: string;
  category_slug: string;
  category_is_official?: number;
  is_official_category?: number;
  has_liked?: boolean;
  rose_count?: number;
  skull_count?: number;
  user_reaction?: 'rose' | 'skull' | null;
  author_followers_count?: number;
  author_is_following?: boolean;
}

export interface Comment {
  id: string;
  user_id: string;
  post_id?: string;
  creation_id?: string;
  album_id?: string | null;
  single_id?: string | null;
  parent_id?: string | null;
  content: string;
  status?: string;
  is_hidden?: number;
  created_at: string;
  author_nickname: string;
  author_name: string;
  author_avatar: string;
  author_level: number;
  author_frame?: string;
  author_name_style?: string;
  author_badge?: string;
  author_title?: string;
  replies?: Comment[];
}

export interface Creation {
  id: string;
  user_id: string;
  title: string;
  category: 'art' | 'meme' | 'artwork' | 'covers' | 'beats' | 'video' | 'lyrics';
  description?: string;
  media_url: string;
  media_type: 'image' | 'audio' | 'video';
  status: 'pending' | 'approved' | 'rejected' | 'hidden';
  rejection_reason?: string;
  views_count: number;
  likes_count: number;
  rose_count?: number;
  skull_count?: number;
  user_reaction?: 'rose' | 'skull' | null;
  created_at: string;
  author_nickname: string;
  author_name: string;
  author_avatar: string;
  author_level: number;
  author_frame?: string;
  author_name_style?: string;
  author_badge?: string;
  has_liked?: boolean;
  author_followers_count?: number;
  author_is_following?: boolean;
}

export interface AppNotification {
  id: string;
  user_id: string;
  actor_id?: string | null;
  actor_nickname: string;
  actor_name: string;
  type: string;
  target_type: 'post' | 'creation' | 'album' | 'single' | 'news' | 'achievement';
  target_id: string;
  target_title: string;
  target_link: string;
  excerpt: string;
  is_read: number;
  created_at: string;
}

export interface LeaderboardEntry {
  id?: string;
  rank?: number;
  user_id?: string;
  nickname: string;
  display_name: string;
  avatar_url: string;
  level: number;
  xp: number;
  total_xp?: number;
  daily_streak?: number;
  equipped_frame?: string;
  equipped_banner?: string;
  equipped_name_style?: string;
  equipped_badge?: string;
  equipped_title?: string;
}

export interface ShopItem {
  id: string;
  name_ru: string;
  name_en: string;
  description_ru?: string;
  description_en?: string;
  category: ShopCategory;
  cost_xp: number;
  rarity: ItemRarity;
  preview_value: string;
  is_active: number;
  requires_achievement_id?: string | null;
  is_owned?: boolean;
  is_equipped?: boolean;
}

export interface UserInventoryItem {
  id: string;
  item_id: string;
  category: ShopCategory;
  name_ru: string;
  name_en: string;
  description_ru?: string;
  description_en?: string;
  rarity?: ItemRarity;
  preview_value: string;
  is_equipped: boolean;
  purchased_at: string;
}

export interface XpTransaction {
  id: string;
  amount: number;
  source: string;
  details?: string;
  created_at: string;
}

export interface GuessTrackOption {
  id: string;
  title: string;
  release_title?: string;
}

export interface GuessTrackRound {
  token: string;
  audio_url: string;
  snippet_start_seconds: number;
  snippet_duration_seconds: number;
  options: GuessTrackOption[];
}

export interface CommunityRuleItem {
  id?: string;
  title_ru: string;
  title_en: string;
  body_ru: string;
  body_en: string;
}

export interface CommunityRulesPayload {
  intro_ru: string;
  intro_en: string;
  footer_ru: string;
  footer_en: string;
  items: CommunityRuleItem[];
}

export interface PromoCodeAdminItem {
  id: string;
  code: string;
  xp_reward: number;
  is_active: number;
  max_uses?: number | null;
  expires_at?: string | null;
  uses_count?: number;
  created_at?: string;
}

