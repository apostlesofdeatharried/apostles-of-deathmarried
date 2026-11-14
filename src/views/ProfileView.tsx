import React, { useState, useEffect } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { calculateLevelFromXp, safeJson } from '../utils/logic.js';
import { ShopModal } from '../components/ShopModal.js';
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
  Headphones,
  Play,
  Trophy,
  Clock,
  Bookmark,
  Video,
  Music,
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
  const [activeTab, setActiveTab] = useState<'creations' | 'posts' | 'favorites' | 'achievements' | 'inventory' | 'history'>('achievements');
  const [isShopOpen, setIsShopOpen] = useState(false);

  // History state
  const [historyTransactions, setHistoryTransactions] = useState<any[]>([]);
  const [historyAttempts, setHistoryAttempts] = useState<any[]>([]);

  // Edit profile modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [customStatus, setCustomStatus] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!editModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editModalOpen]);

  const formatProfileDate = (dateStr?: string, withTime = false) => {
    if (!dateStr) return '—';
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return dateStr;
    return withTime ? d.toLocaleString() : d.toLocaleDateString();
  };

  const fetchProfile = async () => {
    if (!targetNickname) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(`/api/profiles/${targetNickname}`);
      const data = await safeJson<{ profile?: any }>(res, {});
      if (res.ok && data.profile) {
        setProfile(data.profile);
        setDisplayName(data.profile.display_name || '');
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
      const res = await authFetch(`/api/profiles/${targetNickname}/history`);
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
    if (!profile) return;
    try {
      const res = await authFetch(`/api/profiles/${profile.nickname}/follow`, { method: 'POST' });
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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveFeedback(null);
    try {
      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim(),
          bio: bio.trim(),
          avatar_url: avatarUrl.trim() || undefined,
          custom_status: customStatus.trim() || undefined,
        }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (res.ok) {
        setEditModalOpen(false);
        fetchProfile();
        refresh();
      } else {
        setSaveFeedback(data.error || (lang === 'ru' ? 'Не удалось сохранить изменения' : 'Failed to save changes'));
      }
    } catch (e: any) {
      setSaveFeedback(e?.message || (lang === 'ru' ? 'Ошибка сети при сохранении' : 'Network error while saving'));
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
            ? (lang === 'ru' ? 'Войдите в аккаунт' : 'Sign in to view your profile')
            : (lang === 'ru' ? 'Пользователь не найден.' : 'User not found.')}
        </div>
        <p className="max-w-md mx-auto">
          {!targetNickname && !currentUser
            ? (lang === 'ru' ? 'Авторизуйтесь, чтобы просматривать достижения, коллекцию и историю XP.' : 'Sign in to view achievements, collection and XP history.')
            : (lang === 'ru' ? 'Проверьте правильность никнейма или войдите в аккаунт.' : 'Check the nickname or sign in to your account.')}
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

  const isSelf = currentUser?.id === profile.id;
  const levelInfo = calculateLevelFromXp(profile.total_xp || profile.xp || 0);

  const getAchievementIcon = (iconName: string) => {
    switch (iconName) {
      case 'headphones':
        return <Headphones className="w-4 h-4 text-[#821c2c]" />;
      case 'play':
        return <Play className="w-4 h-4 text-[#c5c8cf]" />;
      case 'award':
        return <Award className="w-4 h-4 text-[#ded8ce]" />;
      case 'calendar':
        return <Calendar className="w-4 h-4 text-[#8e877e]" />;
      case 'shield':
        return <Shield className="w-4 h-4 text-[#c5c8cf]" />;
      case 'sparkles':
        return <Sparkles className="w-4 h-4 text-[#821c2c]" />;
      case 'message-square':
        return <MessageCircle className="w-4 h-4 text-[#8e877e]" />;
      case 'trophy':
        return <Trophy className="w-4 h-4 text-[#ded8ce]" />;
      case 'tag':
        return <Tag className="w-4 h-4 text-[#821c2c]" />;
      default:
        return <Sparkles className="w-4 h-4 text-[#821c2c]" />;
    }
  };

  const bannerGradient = profile.equipped_banner || 'from-[#0e0d12] via-[#1a1722] to-[#0c0b0e]';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 animate-fadeIn">
      {/* XP Shop Modal */}
      <ShopModal isOpen={isShopOpen} onClose={() => { setIsShopOpen(false); fetchProfile(); }} />

      {/* Profile Header Banner with equipped cosmetic */}
      <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#100f13] shadow-2xl relative">
        <div className={`h-36 sm:h-44 w-full bg-gradient-to-r ${bannerGradient} relative`} />

        <div className="px-6 pb-6 pt-0 relative flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 -mt-16 sm:-mt-20">
          {/* Avatar with equipped frame cosmetic */}
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-black shrink-0 ${profile.equipped_frame || 'border-2 border-white/20'}`}>
              <img
                src={profile.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                alt={profile.display_name}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className={`font-display text-xl sm:text-2xl uppercase tracking-wider ${profile.equipped_name_style || 'text-white'}`}>
                  {profile.display_name || profile.nickname}
                </h1>
                {profile.equipped_badge && (
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/[0.08] border border-white/20 text-[#f2eee9]">
                    {profile.equipped_badge}
                  </span>
                )}
                <span className="font-mono text-xs text-[#8e877e]">
                  @{profile.nickname}
                </span>
              </div>

              {profile.custom_status && (
                <p className="text-xs text-[#ded8ce] italic font-sans">
                  {profile.custom_status}
                </p>
              )}

              {profile.bio && (
                <p className="text-xs text-[#8e877e] max-w-xl font-sans leading-relaxed">
                  {profile.bio}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end pt-2 sm:pt-0">
            {isSelf ? (
              <>
                <button
                  onClick={() => setIsShopOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-xs font-mono uppercase tracking-wider text-white transition-colors cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  {t('navShop')}
                </button>
                <button
                  onClick={() => setEditModalOpen(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#151419] hover:bg-[#1c1b22] border border-white/[0.08] text-xs font-mono uppercase tracking-wider text-[#ded8ce] transition-colors cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  {t('profileSettings')}
                </button>
              </>
            ) : (
              currentUser && (
                <button
                  onClick={handleFollowToggle}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                    profile.isFollowing
                      ? 'bg-white/[0.06] border border-white/10 text-[#8e877e] hover:text-white'
                      : 'bg-white/[0.1] hover:bg-white/[0.18] border border-white/[0.15] text-white'
                  }`}
                >
                  {profile.isFollowing ? (
                    <>
                      <UserCheck className="w-3.5 h-3.5 text-[#6ee7b7]" />
                      {lang === 'ru' ? 'Вы подписаны' : 'Following'}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      {t('followBtn')}
                    </>
                  )}
                </button>
              )
            )}
          </div>
        </div>

        {/* Level & XP Progress Bar */}
        <div className="px-6 py-4 border-t border-white/[0.06] bg-[#0c0b0e] space-y-2 font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-white">{t('level')} {levelInfo.level}</span>
              <span className="text-[#423d38]">·</span>
              <span className="text-[#8e877e]">
                {levelInfo.currentLevelXp} / {levelInfo.nextLevelXp} XP ({lang === 'ru' ? 'до следующего уровня' : 'to next level'})
              </span>
            </div>
            <div className="flex items-center gap-4 text-[#ded8ce]">
              <span>{lang === 'ru' ? 'Доступно' : 'Available'}: <strong className="text-white">{profile.xp || 0} XP</strong></span>
              <span className="text-[#423d38]">·</span>
              <span>{lang === 'ru' ? 'Всего' : 'Total'}: <strong className="text-white">{profile.total_xp || profile.xp || 0} XP</strong></span>
            </div>
          </div>

          <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#821c2c] to-[#c5c8cf] transition-all duration-500 rounded-full"
              style={{ width: `${levelInfo.progressPercent}%` }}
            />
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-white/[0.05] border-t border-white/[0.06] bg-[#0f0e13] font-mono text-center text-xs py-3">
          <div>
            <div className="text-sm font-semibold text-white">{profile.followers_count || 0}</div>
            <div className="text-[10px] text-[#736c64] uppercase tracking-wider">{t('followers')}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{profile.following_count || 0}</div>
            <div className="text-[10px] text-[#736c64] uppercase tracking-wider">{t('following')}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{profile.creations_count || 0}</div>
            <div className="text-[10px] text-[#736c64] uppercase tracking-wider">{lang === 'ru' ? 'Работ' : 'Works'}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{profile.posts_count || 0}</div>
            <div className="text-[10px] text-[#736c64] uppercase tracking-wider">{t('myPosts')}</div>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">{profile.games_played || 0}</div>
            <div className="text-[10px] text-[#736c64] uppercase tracking-wider">{lang === 'ru' ? 'Игр сыграно' : 'Games'}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-2 font-mono text-xs overflow-x-auto no-scrollbar w-full max-w-full">
        <button
          onClick={() => setActiveTab('achievements')}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'achievements'
              ? 'bg-white/[0.1] text-white border border-white/20'
              : 'text-[#8e877e] hover:text-white'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          {t('profileAchievements')} ({profile.achievements?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('creations')}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'creations'
              ? 'bg-white/[0.1] text-white border border-white/20'
              : 'text-[#8e877e] hover:text-white'
          }`}
        >
          <Brush className="w-3.5 h-3.5" />
          {t('profileCreations')} ({profile.recentCreations?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('posts')}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'posts'
              ? 'bg-white/[0.1] text-white border border-white/20'
              : 'text-[#8e877e] hover:text-white'
          }`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          {t('profileDiscussions')} ({profile.recentPosts?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('favorites')}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'favorites'
              ? 'bg-white/[0.1] text-white border border-white/20'
              : 'text-[#8e877e] hover:text-white'
          }`}
        >
          <Bookmark className="w-3.5 h-3.5" />
          {t('tabFavorites')} ({profile.favoriteCreations?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('inventory')}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'inventory'
              ? 'bg-white/[0.1] text-white border border-white/20'
              : 'text-[#8e877e] hover:text-white'
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          {t('profileInventory')} ({profile.inventory?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'history'
              ? 'bg-white/[0.1] text-white border border-white/20'
              : 'text-[#8e877e] hover:text-white'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {t('profileActivity')}
        </button>
      </div>

      {/* TAB: ACHIEVEMENTS */}
      {activeTab === 'achievements' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profile.achievements && profile.achievements.length > 0 ? (
            profile.achievements.map((ach: any) => (
              <div
                key={ach.slug}
                className="p-4 rounded-xl bg-[#100f13] border border-white/[0.08] flex items-start gap-3 shadow-md"
              >
                <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                  {getAchievementIcon(ach.icon)}
                </div>
                <div className="space-y-1">
                  <h3 className="font-display text-sm uppercase text-[#f2eee9] font-medium tracking-wide">
                    {lang === 'ru' ? ach.title_ru : ach.title_en}
                  </h3>
                  <p className="text-xs text-[#8e877e] font-sans leading-relaxed">
                    {lang === 'ru' ? ach.desc_ru : ach.desc_en}
                  </p>
                  <span className="font-mono text-[10px] text-[#736c64] block pt-1">
                    {t('unlockedOn')}: {formatProfileDate(ach.unlocked_at)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
              {t('noAchievements')}
            </div>
          )}
        </div>
      )}

      {/* TAB: CREATIONS */}
      {activeTab === 'creations' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profile.recentCreations && profile.recentCreations.length > 0 ? (
            profile.recentCreations.map((cr: any) => (
              <div
                key={cr.id}
                onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'creations' }))}
                className="rounded-xl overflow-hidden bg-[#100f13] border border-white/[0.08] hover:border-white/20 p-3 space-y-2 shadow-md cursor-pointer transition-colors"
              >
                <div className="aspect-video w-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
                  {cr.media_type === 'image' ? (
                    <img src={cr.media_url} alt={cr.title} className="w-full h-full object-cover" />
                  ) : cr.media_type === 'video' ? (
                    <div className="flex flex-col items-center gap-1 text-center font-mono text-xs text-[#8e877e]">
                      <Video className="w-6 h-6" />
                      <span>{t('videoLabel')}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-center font-mono text-xs text-[#8e877e]">
                      <Music className="w-6 h-6" />
                      <span>{t('audioTrackLabel')}</span>
                    </div>
                  )}
                </div>
                <h4 className="font-display text-sm text-[#f2eee9] truncate">{cr.title}</h4>
                <div className="flex items-center justify-between text-[11px] font-mono text-[#736c64]">
                  <span>{formatProfileDate(cr.created_at)}</span>
                  <span className="text-[#e8909c] flex items-center gap-1">
                    <Heart className="w-3 h-3 fill-current" />
                    {cr.likes_count || 0}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
              {t('noUserWorks')}
            </div>
          )}
        </div>
      )}

      {/* TAB: POSTS */}
      {activeTab === 'posts' && (
        <div className="space-y-3">
          {profile.recentPosts && profile.recentPosts.length > 0 ? (
            profile.recentPosts.map((post: any) => (
              <div
                key={post.id}
                onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'community' }))}
                className="p-4 rounded-xl bg-[#100f13] border border-white/[0.08] hover:border-white/20 space-y-1.5 shadow-md cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-[#8e877e] uppercase tracking-wider">
                    {lang === 'ru' ? post.category_name_ru : post.category_name_en}
                  </span>
                  <span className="font-mono text-[10px] text-[#736c64]">
                    {formatProfileDate(post.created_at)}
                  </span>
                </div>
                <h4 className="font-display text-base text-[#f2eee9]">{post.title}</h4>
                <p className="text-xs text-[#8e877e] line-clamp-2 font-sans">{post.content}</p>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
              {t('noUserPosts')}
            </div>
          )}
        </div>
      )}

      {/* TAB: FAVORITES */}
      {activeTab === 'favorites' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profile.favoriteCreations && profile.favoriteCreations.length > 0 ? (
            profile.favoriteCreations.map((cr: any) => (
              <div
                key={cr.id}
                onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'creations' }))}
                className="rounded-xl overflow-hidden bg-[#100f13] border border-white/[0.08] hover:border-white/20 p-3 space-y-2 shadow-md cursor-pointer transition-colors"
              >
                <div className="aspect-video w-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
                  {cr.media_type === 'image' ? (
                    <img src={cr.media_url} alt={cr.title} className="w-full h-full object-cover" />
                  ) : cr.media_type === 'video' ? (
                    <div className="flex flex-col items-center gap-1 text-center font-mono text-xs text-[#8e877e]">
                      <Video className="w-6 h-6" />
                      <span>{t('videoLabel')}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-center font-mono text-xs text-[#8e877e]">
                      <Music className="w-6 h-6" />
                      <span>{t('audioTrackLabel')}</span>
                    </div>
                  )}
                </div>
                <h4 className="font-display text-sm text-[#f2eee9] truncate">{cr.title}</h4>
                <div className="flex items-center justify-between text-[11px] font-mono text-[#736c64]">
                  <span className="truncate">{cr.author_name || `@${cr.author_nickname}`}</span>
                  <span className="text-[#e8909c] flex items-center gap-1 shrink-0">
                    <Heart className="w-3 h-3 fill-current" />
                    {cr.likes_count || 0}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
              {t('noFavorites')}
            </div>
          )}
        </div>
      )}

      {/* TAB: INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profile.inventory && profile.inventory.length > 0 ? (
            profile.inventory.map((inv: any) => (
              <div
                key={inv.id}
                className={`p-4 rounded-xl bg-[#100f13] border transition-all ${
                  inv.is_equipped ? 'border-[#c5c8cf]/40 shadow-lg' : 'border-white/[0.08]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-display text-base text-[#f2eee9] uppercase">
                      {lang === 'ru' ? inv.name_ru : inv.name_en}
                    </h4>
                    <span className="font-mono text-[10px] text-[#8e877e] uppercase">
                      {inv.category} • {inv.rarity}
                    </span>
                  </div>
                  {Boolean(inv.is_equipped) && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#6ee7b7]/10 text-[#6ee7b7] border border-[#6ee7b7]/20">
                      {t('equippedBadge')}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-12 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
              {lang === 'ru'
                ? 'Инвентарь пуст. Зайдите в Магазин XP, чтобы выбрать рамки, баннеры и значки!'
                : 'Collection is empty. Visit the XP Shop to unlock frames, banners and badges!'}
            </div>
          )}
        </div>
      )}

      {/* TAB: ACTIVITY HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4 shadow-md font-mono text-xs">
            <h3 className="font-display text-base uppercase text-[#f2eee9]">
              {lang === 'ru' ? 'Транзакции XP и активность' : 'XP Transactions & Activity'}
            </h3>

            {historyTransactions.length === 0 ? (
              <div className="text-center py-6 text-[#736c64]">
                {lang === 'ru' ? 'История транзакций XP пуста.' : 'XP transaction history is empty.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {historyTransactions.map((tx: any) => (
                  <div key={tx.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-white">{tx.details || tx.source}</span>
                      <span className="text-[10px] text-[#736c64] block">
                        {formatProfileDate(tx.created_at, true)}
                      </span>
                    </div>
                    <span className={`font-semibold shrink-0 ${tx.amount >= 0 ? 'text-[#6ee7b7]' : 'text-[#f87171]'}`}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount} XP
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4 shadow-md font-mono text-xs">
            <h3 className="font-display text-base uppercase text-[#f2eee9]">
              {lang === 'ru' ? 'История испытаний' : 'Challenge History'} ({historyAttempts.length})
            </h3>

            {historyAttempts.length === 0 ? (
              <div className="text-center py-6 text-[#736c64]">
                {lang === 'ru' ? 'Игровых попыток пока нет.' : 'No game attempts yet.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {historyAttempts.map((att: any) => (
                  <div key={att.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-white">
                        {att.game_id === 'guess-track'
                          ? t('gameGuessTrack')
                          : att.game_id === 'daily-quiz'
                          ? t('gameDailyQuiz')
                          : att.game_id}
                      </span>
                      <span className="text-[10px] text-[#736c64] block">
                        {formatProfileDate(att.created_at, true)} · {t('score')}: {att.score}
                      </span>
                    </div>
                    <span className="font-semibold text-[#6ee7b7] shrink-0">
                      +{att.xp_earned || 0} XP
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT PROFILE MODAL */}
      {editModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-md bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-6 space-y-4 shadow-2xl font-sans text-xs">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="font-display text-base tracking-wider uppercase text-[#f2eee9]">
                {t('editProfileTitle')}
              </h2>
              <button
                onClick={() => setEditModalOpen(false)}
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {saveFeedback && (
              <div className="p-2.5 rounded bg-[#3d1820] border border-[#8a2a38] text-xs text-white">
                {saveFeedback}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('displayName')}
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('customStatus')}
                </label>
                <input
                  type="text"
                  value={customStatus}
                  onChange={(e) => setCustomStatus(e.target.value)}
                  placeholder={lang === 'ru' ? 'например: на репите nightmortan...' : 'e.g. listening to nightmortan...'}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('bio')}
                </label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white focus:outline-none focus:border-white/25 resize-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('avatarUrl')}
                </label>
                <input
                  type="text"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 font-mono text-xs uppercase text-[#8e877e] hover:text-white cursor-pointer"
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-mono text-xs uppercase tracking-wider rounded-lg bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] text-white cursor-pointer"
                >
                  {t('saveBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
