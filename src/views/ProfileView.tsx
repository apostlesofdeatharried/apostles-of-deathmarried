import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch, setStoredToken } from '../context/AuthContext.js';
import { calculateLevelFromXp, safeJson } from '../utils/logic.js';
import {
  RARITY_CONFIG,
  CATEGORY_LABELS,
  renderEquippedBadge,
  getProfileThemeStyle,
  renderProfileEffectOverlay,
  renderAchievementIcon,
  formatHandle,
} from '../utils/cosmetics.js';
import { ShopModal } from '../components/ShopModal.js';
import { ItemRarity, ShopCategory } from '../types/index.js';
import {
  Award,
  Flame,
  Sparkles,
  Calendar,
  Settings,
  X,
  Shield,
  Brush,
  MessageCircle,
  ShoppingBag,
  Heart,
  UserPlus,
  UserCheck,
  Tag,
  Trophy,
  Clock,
  Bookmark,
  Video,
  Music,
  Lock,
  Pin,
  Check,
  Upload,
  AtSign,
  Mail,
  Gamepad2,
} from 'lucide-react';

interface ProfileViewProps {
  targetNickname?: string;
  nickname?: string;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ targetNickname: routeNickname, nickname }) => {
  const { t, lang } = useI18n();
  const { user: currentUser, refresh, openAuth } = useAuth();

  const targetNickname = routeNickname || nickname || currentUser?.nickname;
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'achievements' | 'inventory' | 'creations' | 'posts' | 'favorites' | 'history'
  >('achievements');
  const [achFilter, setAchFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const [isShopOpen, setIsShopOpen] = useState(false);

  // History state
  const [historyTransactions, setHistoryTransactions] = useState<any[]>([]);
  const [historyAttempts, setHistoryAttempts] = useState<any[]>([]);

  // Inline collection / showcase action states
  const [equippingId, setEquippingId] = useState<string | null>(null);
  const [pinningSlug, setPinningSlug] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Edit profile modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [customStatus, setCustomStatus] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  };

  useEffect(() => {
    if (!editModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editModalOpen]);

  const formatProfileDate = (dateStr?: string | null, withTime = false) => {
    if (!dateStr) return '—';
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return dateStr;
    return withTime
      ? d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')
      : d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  };

  const fetchProfile = async (overrideNick?: string) => {
    const lookup = overrideNick || targetNickname;
    if (!lookup) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(lookup)}`);
      const data = await safeJson<{ profile?: any }>(res, {});
      if (res.ok && data.profile) {
        setProfile(data.profile);
        setDisplayName(data.profile.display_name || data.profile.nickname || '');
        setEditUsername(data.profile.nickname || '');
        setBio(data.profile.bio || '');
        setAvatarUrl(data.profile.avatar_url || '');
        setCustomStatus(data.profile.custom_status || '');
      } else {
        setProfile(null);
      }
    } catch (e) {
      console.error(e);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    if (!targetNickname) return;
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(targetNickname)}/history`);
      const data = await safeJson<{ xpTransactions?: any[]; gameAttempts?: any[] }>(res, {});
      if (res.ok) {
        setHistoryTransactions(data.xpTransactions || []);
        setHistoryAttempts(data.gameAttempts || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [targetNickname]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, targetNickname]);

  const handleFollowToggle = async () => {
    if (!currentUser) {
      openAuth('login');
      return;
    }
    if (!profile) return;
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(profile.nickname)}/follow`, { method: 'POST' });
      const data = await safeJson<{ following?: boolean }>(res, {});
      if (res.ok) {
        setProfile((prev: any) => ({
          ...prev,
          isFollowing: Boolean(data.following),
          followers_count: data.following
            ? (prev?.followers_count || 0) + 1
            : Math.max(0, (prev?.followers_count || 0) - 1),
        }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setUploadingAvatar(true);
    setSaveFeedback(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/upload', { method: 'POST', body: formData });
      const data = await safeJson<{ url?: string; error?: string }>(res, {});
      if (res.ok && data.url) {
        setAvatarUrl(data.url);
      } else {
        setSaveFeedback(data.error || (lang === 'ru' ? 'Не удалось загрузить изображение.' : 'Image upload failed.'));
      }
    } catch (e: any) {
      setSaveFeedback(e?.message || 'Upload error');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingProfile) return;
    setSaveFeedback(null);
    setSavingProfile(true);
    try {
      const payload: Record<string, any> = {
        display_name: displayName.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl.trim() || undefined,
        custom_status: customStatus.trim(),
      };
      const cleanNextNick = editUsername.trim().replace(/^@+/, '').toLowerCase();
      if (profile && cleanNextNick && cleanNextNick !== String(profile.nickname).toLowerCase()) {
        payload.username = cleanNextNick;
      }

      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson<{ ok?: boolean; nickname?: string; token?: string; error?: string }>(res, {});
      if (res.ok) {
        if (data.token) {
          setStoredToken(data.token);
        }
        setEditModalOpen(false);
        showToast(lang === 'ru' ? 'Профиль успешно обновлён' : 'Profile updated');
        await refresh();
        if (data.nickname && profile && data.nickname !== profile.nickname) {
          window.dispatchEvent(new CustomEvent('navigate-profile', { detail: data.nickname }));
          await fetchProfile(data.nickname);
        } else {
          await fetchProfile();
        }
      } else {
        setSaveFeedback(data.error || (lang === 'ru' ? 'Не удалось сохранить изменения' : 'Failed to save changes'));
      }
    } catch (e: any) {
      setSaveFeedback(e?.message || (lang === 'ru' ? 'Ошибка сети при сохранении' : 'Network error while saving'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleEquipCollectionItem = async (item: any, equip: boolean) => {
    setEquippingId(item.item_id);
    try {
      const res = await authFetch('/api/shop/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.item_id, equip }),
      });
      if (res.ok) {
        showToast(
          equip
            ? lang === 'ru'
              ? `Экипировано: ${item.name_ru}`
              : `Equipped: ${item.name_en}`
            : lang === 'ru'
              ? `Снято: ${item.name_ru}`
              : `Unequipped: ${item.name_en}`
        );
        await refresh();
        await fetchProfile();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setEquippingId(null);
    }
  };

  const handleToggleFeaturedAchievement = async (slug: string) => {
    if (!profile) return;
    const current: string[] = Array.isArray(profile.featured_achievements) ? profile.featured_achievements : [];
    let next: string[];
    if (current.includes(slug)) {
      next = current.filter((s) => s !== slug);
    } else {
      if (current.length >= 4) {
        showToast(lang === 'ru' ? 'На витрине можно закрепить до 4 достижений' : 'Maximum 4 showcase achievements');
        return;
      }
      next = [...current, slug];
    }

    setPinningSlug(slug);
    try {
      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured_achievements: next }),
      });
      if (res.ok) {
        await fetchProfile();
        await refresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPinningSlug(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-24 font-mono text-xs text-[#8e877e] tracking-wider uppercase">
        {lang === 'ru' ? 'Загрузка профиля...' : 'Loading profile...'}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-24 space-y-4 font-mono text-xs text-[#8e877e] px-4">
        <div className="font-display text-xl text-[#ded8ce]">
          {!targetNickname && !currentUser
            ? lang === 'ru'
              ? 'Войдите в аккаунт'
              : 'Sign in to view your profile'
            : lang === 'ru'
              ? 'Пользователь не найден.'
              : 'User not found.'}
        </div>
        <p className="max-w-md mx-auto">
          {!targetNickname && !currentUser
            ? lang === 'ru'
              ? 'Авторизуйтесь, чтобы просматривать достижения, коллекцию и историю XP.'
              : 'Sign in to view achievements, collection and XP history.'
            : lang === 'ru'
              ? 'Проверьте правильность @username или войдите в аккаунт.'
              : 'Check the @username or sign in to your account.'}
        </p>
        {!currentUser && (
          <button
            type="button"
            onClick={() => openAuth('login')}
            className="px-5 py-2.5 rounded-lg bg-white/[0.1] hover:bg-white/[0.18] border border-white/20 text-white uppercase tracking-wider cursor-pointer"
          >
            {t('loginBtn')}
          </button>
        )}
      </div>
    );
  }

  const isOwnProfile = Boolean(currentUser && currentUser.id === profile.id);
  const lifetimeXp = profile.total_xp ?? profile.xp ?? 0;
  const { level, currentLevelXp, nextLevelXp, progressPercent } = calculateLevelFromXp(lifetimeXp);
  const bannerClasses = profile.equipped_banner || 'from-[#0e0d12] via-[#1a1722] to-[#0c0b0e]';
  const themeStyle = getProfileThemeStyle(profile.equipped_theme);

  const allAchievements: any[] = profile.allAchievements || profile.achievements || [];
  const unlockedCount = (profile.achievements || []).length;
  const totalAchCount = allAchievements.length;
  const featuredList: any[] = profile.featuredAchievements || [];
  const featuredSlugs: string[] = profile.featured_achievements || [];

  const visibleAchievements = allAchievements.filter((a) => {
    if (achFilter === 'unlocked') return Boolean(a.is_unlocked || a.unlocked_at);
    if (achFilter === 'locked') return !a.is_unlocked && !a.unlocked_at;
    return true;
  });

  const isMasterAdmin = String(profile.nickname || '').toLowerCase() === 'sushkanov097';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6 animate-fadeIn">
      <ShopModal
        isOpen={isShopOpen}
        onClose={() => {
          setIsShopOpen(false);
          fetchProfile();
        }}
      />

      {toastMsg && (
        <div className="fixed bottom-24 right-5 z-50 px-4 py-2.5 rounded-lg bg-[#162e1c] border border-[#2b6637] text-xs font-mono text-[#6ee7b7] shadow-2xl">
          {toastMsg}
        </div>
      )}

      {/* ==================================================================== */}
      {/* PROFILE HERO CARD (THEME + BANNER + EFFECT + FRAME + NAME + BADGE)   */}
      {/* ==================================================================== */}
      <div className={`rounded-xl overflow-hidden border shadow-2xl transition-colors ${themeStyle.cardClass}`}>
        {/* Equipped Banner + Atmospheric Effect Overlay */}
        <div className={`h-32 sm:h-44 w-full bg-gradient-to-r ${bannerClasses} relative overflow-hidden`}>
          {renderProfileEffectOverlay(profile.equipped_effect)}

          {/* Top-right metadata pill: Registration Date */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/55 backdrop-blur-sm border border-white/[0.08] font-mono text-[10px] text-[#a39b8b]">
            <Calendar className="w-3 h-3 text-[#821c2c]" />
            <span>
              {lang === 'ru' ? 'В архиве с' : 'Member since'} {formatProfileDate(profile.registered_at)}
            </span>
          </div>
        </div>

        {/* Profile Identity Row */}
        <div className="px-5 sm:px-8 pb-6 relative">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 -mt-12 sm:-mt-16 mb-5">
            <div className="flex items-end gap-4 min-w-0">
              {/* Avatar with equipped frame */}
              <div
                className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-black shrink-0 shadow-2xl ${
                  profile.equipped_frame || 'border-2 border-white/20'
                }`}
              >
                <img
                  src={profile.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                  alt={profile.display_name || profile.nickname}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Display Name + @username + Badge + Role */}
              <div className="pb-1 min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1
                    className={`font-display text-2xl sm:text-3xl tracking-wide truncate ${
                      profile.equipped_name_style || 'text-[#f2eee9]'
                    }`}
                  >
                    {profile.display_name || profile.nickname}
                  </h1>
                  {renderEquippedBadge(profile.equipped_badge, lang)}
                  {profile.role_id !== 'user' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[#821c2c]/30 border border-[#821c2c]/70 text-[#f3b6c0]">
                      <Shield className="w-2.5 h-2.5" />
                      {profile.role_id}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs text-[#9e968b]">
                  <span className="text-[#c49298] font-medium">{formatHandle(profile.nickname)}</span>
                  <span className="text-[#423d38]">·</span>
                  <span>
                    {t('level')} <strong className="text-[#f2eee9]">{level}</strong>
                  </span>
                  {profile.custom_status && (
                    <>
                      <span className="text-[#423d38]">·</span>
                      <span className="italic text-[#ded8ce] font-sans text-xs">«{profile.custom_status}»</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isOwnProfile ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsShopOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-xs font-mono text-white transition-colors cursor-pointer"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    <span>{t('navShop')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveFeedback(null);
                      setEditUsername(profile.nickname || '');
                      setEditModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.12] text-xs font-mono text-[#ded8ce] hover:text-white transition-colors cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>{lang === 'ru' ? 'Настроить профиль' : 'Edit Profile'}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleFollowToggle}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider border transition-colors cursor-pointer ${
                    profile.isFollowing
                      ? 'bg-white/[0.08] border-white/20 text-[#ded8ce] hover:bg-white/[0.14]'
                      : 'bg-[#5a1622] border-[#821c2c] text-white hover:bg-[#721b2b]'
                  }`}
                >
                  {profile.isFollowing ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  <span>
                    {profile.isFollowing
                      ? lang === 'ru'
                        ? 'Подписан'
                        : 'Following'
                      : lang === 'ru'
                        ? 'Подписаться'
                        : 'Follow'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="text-sm text-[#c8c1b6] font-sans leading-relaxed max-w-3xl mb-5 whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}

          {/* Level & XP Progress Bar */}
          <div className="p-4 rounded-xl bg-black/35 border border-white/[0.06] space-y-2.5 mb-5">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-[#c49298]" />
                <span className="text-[#f2eee9] font-semibold">
                  {lang === 'ru' ? `Уровень ${level}` : `Level ${level}`}
                </span>
                <span className="text-[#736c64]">
                  ({currentLevelXp} / {nextLevelXp} XP {lang === 'ru' ? 'до следующего' : 'to next'})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <span className="text-[#ded8ce]">
                  {lang === 'ru' ? 'Баланс:' : 'Spendable:'} <strong className="text-white">{profile.xp || 0} XP</strong>
                </span>
                <span className="text-[#423d38]">|</span>
                <span className="text-[#9e968b]">
                  Total XP: <strong className="text-[#ded8ce]">{lifetimeXp}</strong>
                </span>
                {Boolean(profile.daily_streak) && (
                  <>
                    <span className="text-[#423d38]">|</span>
                    <span className="inline-flex items-center gap-1 text-[#e8909c]">
                      <Flame className="w-3.5 h-3.5 text-[#821c2c]" />
                      {profile.daily_streak} {lang === 'ru' ? 'дн.' : 'd'}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${themeStyle.accentBarClass}`}
                style={{ width: `${Math.max(2, progressPercent)}%` }}
              />
            </div>
          </div>

          {/* Featured Achievements Showcase */}
          {featuredList.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8e877e] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-[#c49298]" />
                  {lang === 'ru' ? 'Витрина достижений' : 'Featured Achievements'}
                </span>
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('achievements')}
                    className="font-mono text-[10px] text-[#8e877e] hover:text-white cursor-pointer"
                  >
                    {lang === 'ru' ? 'Настроить витрину →' : 'Customize showcase →'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {featuredList.map((ach: any) => {
                  const rarityKey = (ach.rarity || 'common') as ItemRarity;
                  const rMeta = RARITY_CONFIG[rarityKey] || RARITY_CONFIG.common;
                  return (
                    <div
                      key={ach.slug}
                      className={`p-3 rounded-lg bg-black/40 border ${rMeta.borderClass} flex items-center gap-2.5`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${rMeta.badgeClass}`}>
                        {renderAchievementIcon(ach.icon, 'w-4 h-4')}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#f2eee9] truncate">
                          {lang === 'ru' ? ach.title_ru : ach.title_en}
                        </div>
                        <div className={`font-mono text-[9px] uppercase tracking-wider ${rMeta.textClass}`}>
                          {lang === 'ru' ? rMeta.labelRu : rMeta.labelEn}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* EXPANDED STATS STRIP (GAMES + SOCIAL + COLLECTION + ACHIEVEMENTS)    */}
      {/* ==================================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
        <div className={`p-3.5 rounded-xl border ${themeStyle.statBoxClass} space-y-1`}>
          <div className="text-[10px] uppercase tracking-wider text-[#736c64] flex items-center gap-1">
            <Music className="w-3 h-3 text-[#c49298]" />
            <span>{lang === 'ru' ? 'Угадай трек' : 'Guess Track'}</span>
          </div>
          <div className="text-lg text-[#f2eee9] font-semibold">
            {profile.guess_track_wins || 0}
            <span className="text-xs text-[#736c64] font-normal"> / {profile.guess_track_played || 0}</span>
          </div>
          <div className="text-[10px] text-[#8e877e]">{lang === 'ru' ? 'побед / игр' : 'wins / plays'}</div>
        </div>

        <div className={`p-3.5 rounded-xl border ${themeStyle.statBoxClass} space-y-1`}>
          <div className="text-[10px] uppercase tracking-wider text-[#736c64] flex items-center gap-1">
            <Gamepad2 className="w-3 h-3 text-[#c49298]" />
            <span>{lang === 'ru' ? 'Викторина' : 'Daily Quiz'}</span>
          </div>
          <div className="text-lg text-[#f2eee9] font-semibold">
            {profile.quiz_played || 0}
            {Boolean(profile.quiz_perfect_runs) && (
              <span className="text-xs text-[#6ee7b7] ml-1.5">★ {profile.quiz_perfect_runs}</span>
            )}
          </div>
          <div className="text-[10px] text-[#8e877e]">
            {lang === 'ru' ? `макс. счёт: ${profile.quiz_best_score || 0}` : `best: ${profile.quiz_best_score || 0}`}
          </div>
        </div>

        <div className={`p-3.5 rounded-xl border ${themeStyle.statBoxClass} space-y-1`}>
          <div className="text-[10px] uppercase tracking-wider text-[#736c64] flex items-center gap-1">
            <Award className="w-3 h-3 text-[#ebd197]" />
            <span>{lang === 'ru' ? 'Достижения' : 'Achievements'}</span>
          </div>
          <div className="text-lg text-[#f2eee9] font-semibold">
            {unlockedCount}
            <span className="text-xs text-[#736c64] font-normal"> / {totalAchCount}</span>
          </div>
          <div className="text-[10px] text-[#8e877e]">
            {totalAchCount > 0 ? Math.round((unlockedCount / totalAchCount) * 100) : 0}%
          </div>
        </div>

        <div className={`p-3.5 rounded-xl border ${themeStyle.statBoxClass} space-y-1`}>
          <div className="text-[10px] uppercase tracking-wider text-[#736c64] flex items-center gap-1">
            <Tag className="w-3 h-3 text-[#9ec5f0]" />
            <span>{lang === 'ru' ? 'Коллекция' : 'Collection'}</span>
          </div>
          <div className="text-lg text-[#f2eee9] font-semibold">{(profile.inventory || []).length}</div>
          <div className="text-[10px] text-[#8e877e]">{lang === 'ru' ? 'предметов' : 'items owned'}</div>
        </div>

        <div className={`p-3.5 rounded-xl border ${themeStyle.statBoxClass} space-y-1`}>
          <div className="text-[10px] uppercase tracking-wider text-[#736c64] flex items-center gap-1">
            <Flame className="w-3 h-3 text-[#821c2c]" />
            <span>{lang === 'ru' ? 'Серия' : 'Streak'}</span>
          </div>
          <div className="text-lg text-[#f2eee9] font-semibold">{profile.daily_streak || 0}</div>
          <div className="text-[10px] text-[#8e877e]">{lang === 'ru' ? 'дней подряд' : 'days active'}</div>
        </div>

        <div className={`p-3.5 rounded-xl border ${themeStyle.statBoxClass} space-y-1`}>
          <div className="text-[10px] uppercase tracking-wider text-[#736c64] flex items-center gap-1">
            <UserCheck className="w-3 h-3 text-[#a39b8b]" />
            <span>{lang === 'ru' ? 'Сообщество' : 'Community'}</span>
          </div>
          <div className="text-lg text-[#f2eee9] font-semibold">
            {profile.followers_count || 0}
            <span className="text-xs text-[#736c64] font-normal"> / {profile.following_count || 0}</span>
          </div>
          <div className="text-[10px] text-[#8e877e]">{lang === 'ru' ? 'подп. / читает' : 'fol. / ing'}</div>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* PROFILE TABS                                                         */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-3 font-mono text-xs">
        {([
          { id: 'achievements', icon: Award, label: lang === 'ru' ? `Достижения (${unlockedCount}/${totalAchCount})` : `Achievements (${unlockedCount}/${totalAchCount})` },
          { id: 'inventory', icon: ShoppingBag, label: lang === 'ru' ? `Коллекция (${(profile.inventory || []).length})` : `Collection (${(profile.inventory || []).length})` },
          { id: 'creations', icon: Brush, label: lang === 'ru' ? `Творчество (${profile.creations_count || 0})` : `Creations (${profile.creations_count || 0})` },
          { id: 'posts', icon: MessageCircle, label: lang === 'ru' ? `Посты (${profile.posts_count || 0})` : `Posts (${profile.posts_count || 0})` },
          { id: 'favorites', icon: Bookmark, label: lang === 'ru' ? `Избранное (${(profile.favoriteCreations || []).length})` : `Favorites (${(profile.favoriteCreations || []).length})` },
          { id: 'history', icon: Clock, label: lang === 'ru' ? 'История' : 'History' },
        ] as const).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white/[0.1] text-white border border-white/[0.16]'
                  : 'text-[#8e877e] hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: FULL ACHIEVEMENTS CATALOG (UNLOCKED + LOCKED + SHOWCASE PINNING) */}
      {activeTab === 'achievements' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              {([
                { id: 'all', ru: `Все (${totalAchCount})`, en: `All (${totalAchCount})` },
                { id: 'unlocked', ru: `Получены (${unlockedCount})`, en: `Unlocked (${unlockedCount})` },
                { id: 'locked', ru: `Закрыты (${Math.max(0, totalAchCount - unlockedCount)})`, en: `Locked (${Math.max(0, totalAchCount - unlockedCount)})` },
              ] as const).map((f) => (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setAchFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                    achFilter === f.id
                      ? 'bg-[#821c2c]/30 text-white border-[#821c2c]/70'
                      : 'bg-white/[0.03] text-[#8e877e] border-white/[0.06] hover:text-white'
                  }`}
                >
                  {lang === 'ru' ? f.ru : f.en}
                </button>
              ))}
            </div>

            {isOwnProfile && (
              <span className="font-mono text-[10px] text-[#8e877e]">
                {lang === 'ru'
                  ? 'Нажмите на значок булавки у полученного достижения, чтобы закрепить его на витрине (до 4).'
                  : 'Click the pin button on any unlocked achievement to feature it on your profile (up to 4).'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {visibleAchievements.map((ach: any) => {
              const unlocked = Boolean(ach.is_unlocked || ach.unlocked_at);
              const rarityKey = (ach.rarity || 'common') as ItemRarity;
              const rMeta = RARITY_CONFIG[rarityKey] || RARITY_CONFIG.common;
              const isPinned = featuredSlugs.includes(ach.slug);

              return (
                <div
                  key={ach.slug}
                  className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                    unlocked
                      ? `bg-[#121117] ${rMeta.borderClass}`
                      : 'bg-[#0c0b0f] border-white/[0.05] opacity-65'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
                          unlocked ? rMeta.badgeClass : 'bg-white/[0.03] border-white/[0.08] text-[#635c56]'
                        }`}
                      >
                        {unlocked ? renderAchievementIcon(ach.icon, 'w-5 h-5') : <Lock className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#f2eee9] leading-snug">
                          {lang === 'ru' ? ach.title_ru : ach.title_en}
                        </div>
                        <span
                          className={`inline-block mt-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${rMeta.badgeClass}`}
                        >
                          {lang === 'ru' ? rMeta.labelRu : rMeta.labelEn}
                        </span>
                      </div>
                    </div>

                    {isOwnProfile && unlocked && (
                      <button
                        type="button"
                        disabled={pinningSlug === ach.slug}
                        onClick={() => handleToggleFeaturedAchievement(ach.slug)}
                        title={
                          isPinned
                            ? lang === 'ru'
                              ? 'Убрать с витрины'
                              : 'Unpin from showcase'
                            : lang === 'ru'
                              ? 'Закрепить на витрине'
                              : 'Pin to showcase'
                        }
                        className={`p-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                          isPinned
                            ? 'bg-[#821c2c]/35 border-[#821c2c] text-[#f5c6cb]'
                            : 'bg-white/[0.04] border-white/[0.08] text-[#736c64] hover:text-white'
                        }`}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-[#9e968b] font-sans leading-relaxed">
                    {lang === 'ru' ? ach.desc_ru : ach.desc_en}
                  </p>

                  <div className="pt-2 border-t border-white/[0.05] flex items-center justify-between font-mono text-[10px]">
                    <span className="text-[#736c64] truncate">
                      {lang === 'ru' ? ach.condition_ru || ach.desc_ru : ach.condition_en || ach.desc_en}
                    </span>
                    {unlocked ? (
                      <span className="text-[#6ee7b7] shrink-0 ml-2">
                        {formatProfileDate(ach.unlocked_at)}
                      </span>
                    ) : (
                      <span className="text-[#635c56] uppercase shrink-0 ml-2">
                        {lang === 'ru' ? 'Закрыто' : 'Locked'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: OWNED COLLECTION WITH DIRECT EQUIP / UNEQUIP */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {isOwnProfile && (
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#100f13] border border-white/[0.07]">
              <div className="text-xs text-[#9e968b] font-sans">
                {lang === 'ru'
                  ? 'Управляйте всеми купленными рамками, фонами, темами, эффектами и значками прямо здесь или откройте магазин кастомизации.'
                  : 'Equip or unequip your owned frames, banners, themes, effects, and badges here or browse the customization shop.'}
              </div>
              <button
                type="button"
                onClick={() => setIsShopOpen(true)}
                className="shrink-0 ml-3 px-3.5 py-2 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-xs font-mono text-white cursor-pointer"
              >
                {lang === 'ru' ? 'Открыть магазин' : 'Open Shop'}
              </button>
            </div>
          )}

          {(!profile.inventory || profile.inventory.length === 0) ? (
            <div className="p-12 text-center bg-[#100f13] border border-white/[0.06] rounded-xl font-mono text-xs text-[#8e877e] space-y-3">
              <p>{lang === 'ru' ? 'Коллекция пока пуста.' : 'No customization items in collection yet.'}</p>
              {isOwnProfile && (
                <button
                  type="button"
                  onClick={() => setIsShopOpen(true)}
                  className="px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-white uppercase tracking-wider cursor-pointer"
                >
                  {lang === 'ru' ? 'Перейти в магазин XP' : 'Visit XP Shop'}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {profile.inventory.map((item: any) => {
                const rarityMeta = RARITY_CONFIG[(item.rarity || 'common') as ItemRarity] || RARITY_CONFIG.common;
                const catMeta = CATEGORY_LABELS[item.category as ShopCategory];
                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-xl bg-[#111015] border flex flex-col justify-between gap-3 ${
                      item.is_equipped ? 'border-[#c5c8cf]/45' : rarityMeta.borderClass
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-display text-sm uppercase tracking-wider text-[#f2eee9]">
                            {lang === 'ru' ? item.name_ru : item.name_en}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${rarityMeta.badgeClass}`}>
                              {lang === 'ru' ? rarityMeta.labelRu : rarityMeta.labelEn}
                            </span>
                            {catMeta && (
                              <span className="text-[9px] font-mono uppercase text-[#736c64]">
                                {lang === 'ru' ? catMeta.ru : catMeta.en}
                              </span>
                            )}
                          </div>
                        </div>
                        {Boolean(item.is_equipped) && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[#6ee7b7]">
                            <Check className="w-3 h-3" />
                            {lang === 'ru' ? 'Надето' : 'Active'}
                          </span>
                        )}
                      </div>

                      {item.category === 'badge' && <div>{renderEquippedBadge(item.preview_value, lang)}</div>}
                      {item.category === 'banner' && (
                        <div className={`h-6 w-full rounded bg-gradient-to-r ${item.preview_value} border border-white/10`} />
                      )}
                      {item.category === 'frame' && (
                        <div className={`w-8 h-8 rounded-full bg-[#1b1922] ${item.preview_value}`} />
                      )}
                      {item.category === 'name_style' && (
                        <div className={`text-sm font-display ${item.preview_value}`}>
                          {profile.display_name || profile.nickname}
                        </div>
                      )}
                      {item.category === 'effect' && (
                        <div className="relative h-8 w-full rounded overflow-hidden bg-[#121118] border border-white/[0.08]">
                          {renderProfileEffectOverlay(item.preview_value)}
                        </div>
                      )}
                    </div>

                    {isOwnProfile && (
                      <button
                        type="button"
                        disabled={equippingId === item.item_id}
                        onClick={() => handleEquipCollectionItem(item, !item.is_equipped)}
                        className={`w-full py-1.5 rounded-lg font-mono text-[11px] uppercase tracking-wider border transition-colors cursor-pointer ${
                          item.is_equipped
                            ? 'bg-white/[0.05] hover:bg-white/[0.1] border-white/15 text-[#ded8ce]'
                            : 'bg-[#5a1622] hover:bg-[#721b2b] border-[#821c2c] text-white'
                        }`}
                      >
                        {item.is_equipped ? t('shopUnequip') : t('shopEquip')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CREATIONS */}
      {activeTab === 'creations' && (
        <div>
          {(!profile.recentCreations || profile.recentCreations.length === 0) ? (
            <div className="p-12 text-center bg-[#100f13] border border-white/[0.06] rounded-xl font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Пока нет опубликованных работ.' : 'No creations published yet.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {profile.recentCreations.map((cr: any) => (
                <div key={cr.id} className="bg-[#100f13] border border-white/[0.07] rounded-xl overflow-hidden">
                  <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                    {cr.media_type === 'image' ? (
                      <img src={cr.media_url} alt={cr.title} className="w-full h-full object-cover" />
                    ) : cr.media_type === 'video' ? (
                      <Video className="w-8 h-8 text-[#736c64]" />
                    ) : (
                      <Music className="w-8 h-8 text-[#736c64]" />
                    )}
                  </div>
                  <div className="p-3.5 space-y-1">
                    <div className="text-sm font-medium text-[#f2eee9] truncate">{cr.title}</div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#8e877e]">
                      <span className="uppercase">{cr.category}</span>
                      <span className="inline-flex items-center gap-1 text-[#e8909c]">
                        <Heart className="w-3 h-3 fill-current" />
                        {cr.likes_count || 0}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: POSTS */}
      {activeTab === 'posts' && (
        <div className="space-y-3">
          {(!profile.recentPosts || profile.recentPosts.length === 0) ? (
            <div className="p-12 text-center bg-[#100f13] border border-white/[0.06] rounded-xl font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Пользователь ещё не создавал темы в сообществе.' : 'No community posts yet.'}
            </div>
          ) : (
            profile.recentPosts.map((post: any) => (
              <div key={post.id} className="p-4 bg-[#100f13] border border-white/[0.07] rounded-xl space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-[#f2eee9]">{post.title}</h3>
                  <span className="font-mono text-[10px] text-[#736c64] shrink-0">
                    {formatProfileDate(post.created_at)}
                  </span>
                </div>
                <p className="text-xs text-[#9e968b] line-clamp-2 font-sans">{post.content}</p>
                <div className="font-mono text-[10px] text-[#736c64] pt-1">
                  {lang === 'ru' ? post.category_name_ru : post.category_name_en} · {post.comments_count || 0}{' '}
                  {lang === 'ru' ? 'комм.' : 'comments'}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 5: FAVORITES */}
      {activeTab === 'favorites' && (
        <div>
          {(!profile.favoriteCreations || profile.favoriteCreations.length === 0) ? (
            <div className="p-12 text-center bg-[#100f13] border border-white/[0.06] rounded-xl font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Список избранных работ пуст.' : 'No favorite creations yet.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {profile.favoriteCreations.map((cr: any) => (
                <div key={cr.id} className="bg-[#100f13] border border-white/[0.07] rounded-xl overflow-hidden">
                  <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                    {cr.media_type === 'image' ? (
                      <img src={cr.media_url} alt={cr.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-8 h-8 text-[#736c64]" />
                    )}
                  </div>
                  <div className="p-3.5 space-y-1">
                    <div className="text-sm font-medium text-[#f2eee9] truncate">{cr.title}</div>
                    <div className="font-mono text-[10px] text-[#8e877e]">
                      {cr.author_name || cr.author_nickname} · {formatHandle(cr.author_nickname)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: ACTIVITY HISTORY */}
      {activeTab === 'history' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-[#100f13] border border-white/[0.07] rounded-xl p-5 space-y-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#f2eee9] flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#c49298]" />
              <span>{lang === 'ru' ? 'История XP' : 'XP Transactions'}</span>
            </h3>
            {historyTransactions.length === 0 ? (
              <div className="text-xs font-mono text-[#736c64] py-4">
                {lang === 'ru' ? 'Транзакций XP пока нет.' : 'No XP transactions yet.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {historyTransactions.map((tx: any) => (
                  <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-[#ded8ce] truncate">{tx.details || tx.source}</div>
                      <div className="font-mono text-[10px] text-[#736c64]">
                        {formatProfileDate(tx.created_at, true)}
                      </div>
                    </div>
                    <span
                      className={`font-mono font-semibold shrink-0 ${
                        tx.amount >= 0 ? 'text-[#6ee7b7]' : 'text-[#e8909c]'
                      }`}
                    >
                      {tx.amount >= 0 ? `+${tx.amount}` : tx.amount} XP
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#100f13] border border-white/[0.07] rounded-xl p-5 space-y-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#f2eee9] flex items-center gap-2">
              <Gamepad2 className="w-3.5 h-3.5 text-[#c49298]" />
              <span>{lang === 'ru' ? 'Игровые попытки' : 'Recent Game Runs'}</span>
            </h3>
            {historyAttempts.length === 0 ? (
              <div className="text-xs font-mono text-[#736c64] py-4">
                {lang === 'ru' ? 'Игровых попыток пока нет.' : 'No game attempts yet.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {historyAttempts.map((ga: any) => (
                  <div key={ga.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div>
                      <div className="text-[#ded8ce] font-mono uppercase text-[11px]">
                        {ga.game_id === 'guess-track'
                          ? lang === 'ru'
                            ? 'Угадай трек'
                            : 'Guess The Track'
                          : lang === 'ru'
                            ? 'Ежедневная викторина'
                            : 'Daily Quiz'}
                      </div>
                      <div className="font-mono text-[10px] text-[#736c64]">
                        {formatProfileDate(ga.created_at, true)}
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-[#f2eee9]">{ga.score} pts</div>
                      <div className="text-[10px] text-[#6ee7b7]">+{ga.xp_earned} XP</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* EDIT PROFILE MODAL (DISPLAY NAME, @USERNAME WITH COOLDOWN, AVATAR)   */}
      {/* ==================================================================== */}
      {editModalOpen && isOwnProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/82 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label={lang === 'ru' ? 'Редактирование профиля' : 'Edit Profile'}
        >
          <div className="relative w-full max-w-lg bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-6 sm:p-7 shadow-2xl space-y-5 my-auto">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="font-display text-lg uppercase tracking-wider text-[#f2eee9]">
                {lang === 'ru' ? 'Настройка профиля' : 'Profile Settings'}
              </h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                aria-label="Close settings"
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {saveFeedback && (
              <div className="p-3 rounded-lg bg-[#240b10] border border-[#721b2b] text-xs text-[#f2d2d7]">
                {saveFeedback}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Display Name */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-[#8e877e] mb-1">
                  {lang === 'ru' ? 'Отображаемое имя (Display Name)' : 'Display Name'}
                </label>
                <input
                  type="text"
                  required
                  maxLength={36}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>

              {/* Controlled @username change */}
              <div>
                <label className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[#8e877e] mb-1">
                  <span className="flex items-center gap-1">
                    <AtSign className="w-3 h-3" />
                    {lang === 'ru' ? 'Уникальный @username' : 'Unique @username'}
                  </span>
                  {!profile.username_change_allowed && profile.username_cooldown_days > 0 && (
                    <span className="text-[#c49298] normal-case">
                      {lang === 'ru'
                        ? `Доступно через ${profile.username_cooldown_days} дн.`
                        : `Available in ${profile.username_cooldown_days}d`}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  maxLength={20}
                  disabled={isMasterAdmin || profile.username_change_allowed === false}
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value.replace(/^@+/, ''))}
                  className="w-full px-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-white/30 disabled:opacity-45"
                />
                <p className="text-[10px] text-[#736c64] mt-1 font-sans">
                  {isMasterAdmin
                    ? lang === 'ru'
                      ? 'Главный @username администратора защищён от изменения.'
                      : 'Master administrator @username is locked.'
                    : lang === 'ru'
                      ? 'Смена @username доступна раз в 14 дней. Все посты, достижения и XP сохраняются.'
                      : 'You can change @username once every 14 days. All posts, achievements & XP remain linked.'}
                </p>
              </div>

              {/* Linked Email (read-only info for own profile) */}
              {profile.email && (
                <div className="p-2.5 rounded-lg bg-[#121117] border border-white/[0.06] flex items-center justify-between text-xs font-mono">
                  <span className="flex items-center gap-2 text-[#9e968b] truncate">
                    <Mail className="w-3.5 h-3.5 text-[#736c64] shrink-0" />
                    <span className="truncate">{profile.email}</span>
                  </span>
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/[0.05] text-[#8e877e] shrink-0 ml-2">
                    {lang === 'ru' ? 'Скрыт от других' : 'Private'}
                  </span>
                </div>
              )}

              {/* Custom Status */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-[#8e877e] mb-1">
                  {lang === 'ru' ? 'Личный статус' : 'Custom Status'}
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={customStatus}
                  onChange={(e) => setCustomStatus(e.target.value)}
                  placeholder={lang === 'ru' ? 'Например: слушаю nightmortan...' : 'e.g. listening to nightmortan...'}
                  className="w-full px-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-white/30"
                />
              </div>

              {/* Bio */}
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-[#8e877e] mb-1">
                  {lang === 'ru' ? 'О себе (Bio)' : 'About / Bio'}
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={lang === 'ru' ? 'Расскажите о любимых треках и себе...' : 'Tell the community about yourself...'}
                  className="w-full px-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-white/30 resize-none"
                />
              </div>

              {/* Avatar URL + Direct Upload */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-[#8e877e]">
                    {lang === 'ru' ? 'Аватар (ссылка или загрузка файла)' : 'Avatar (URL or File Upload)'}
                  </label>
                  <button
                    type="button"
                    disabled={uploadingAvatar}
                    onClick={() => avatarInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.08] hover:bg-white/[0.16] text-[10px] font-mono text-white cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                    <span>
                      {uploadingAvatar
                        ? lang === 'ru'
                          ? 'Загрузка...'
                          : 'Uploading...'
                        : lang === 'ru'
                          ? 'Загрузить фото'
                          : 'Upload Image'}
                    </span>
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleAvatarUpload(f);
                    }}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden border border-white/15 bg-black shrink-0">
                    <img
                      src={avatarUrl || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                      alt="Avatar preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <input
                    type="text"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://... или /uploads/..."
                    className="flex-1 px-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-white/30"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-[#ded8ce] cursor-pointer"
                >
                  {lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingProfile || uploadingAvatar}
                  className="px-5 py-2 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-xs font-mono uppercase tracking-wider text-white cursor-pointer disabled:opacity-50"
                >
                  {savingProfile
                    ? lang === 'ru'
                      ? 'Сохранение...'
                      : 'Saving...'
                    : lang === 'ru'
                      ? 'Сохранить'
                      : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
