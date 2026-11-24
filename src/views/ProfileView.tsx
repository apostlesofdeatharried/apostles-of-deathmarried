import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch, setStoredToken } from '../context/AuthContext.js';
import { ShopModal } from '../components/ShopModal.js';
import { ShareCardModal } from '../components/ShareCardModal.js';
import { BrowserNotificationsControl } from '../components/NotificationCenter.js';
import { dispatchAchievementUnlocked } from '../components/AchievementToast.js';
import {
  calculateLevelFromXp,
  safeJson,
  parsePrivacySettings,
  formatXpTransactionLabel,
  getStreakBonusPercent,
  type PrivacySettings,
} from '../utils/logic.js';
import { prepareAndUploadMedia } from '../utils/mediaCompression.js';
import {
  RARITY_CONFIG,
  CATEGORY_LABELS,
  formatHandle,
  getEquippedTitleLabel,
  renderEquippedBadge,
  renderEquippedTitle,
  renderProfileBanner,
  renderProfileEffectOverlay,
  getProfileThemeStyle,
  renderAchievementIcon,
} from '../utils/cosmetics.js';
import {
  AlertCircle,
  BellRing,
  Check,
  CheckCircle2,
  Flame,
  Gamepad2,
  Heart,
  History,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Pin,
  Save,
  Settings,
  Share2,
  Shield,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trophy,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';

interface ProfileViewProps {
  targetNickname?: string;
}

type ProfileTab = 'overview' | 'achievements' | 'community' | 'history' | 'inventory' | 'settings';
type AchTierFilter = 'all' | 'easy' | 'hard' | 'secret';
type AchStatusFilter = 'all' | 'unlocked' | 'locked';

const DEFAULT_AVATAR = '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg';

const HiddenSectionCard: React.FC<{ nickname: string; label?: string }> = ({ nickname, label }) => (
  <div className="rounded-lg border border-white/[0.08] bg-[#0d0c11] px-5 py-8 flex flex-col items-center justify-center text-center gap-2.5">
    <div className="w-10 h-10 rounded-md border border-white/[0.1] bg-[#14131a] flex items-center justify-center text-[#8e877e]">
      <Lock className="w-4 h-4" />
    </div>
    <div className="text-sm font-medium text-[#ded8ce]">«{nickname} скрыл»</div>
    {label && <div className="text-xs text-[#736c64] max-w-xs">{label}</div>}
  </div>
);

export const ProfileView: React.FC<ProfileViewProps> = ({ targetNickname }) => {
  const { lang } = useI18n();
  const { user, openAuth, refresh } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'overview' || p === 'achievements' || p === 'community' || p === 'history' || p === 'inventory' || p === 'settings') {
        return p;
      }
    } catch {}
    return 'overview';
  });
  const [isShopOpen, setIsShopOpen] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('shop') === '1';
    } catch {
      return false;
    }
  });

  // History state
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHidden, setHistoryHidden] = useState(false);
  const [xpTransactions, setXpTransactions] = useState<any[]>([]);
  const [gameAttempts, setGameAttempts] = useState<any[]>([]);

  // Achievement filters
  const [achTier, setAchTier] = useState<AchTierFilter>('all');
  const [achStatus, setAchStatus] = useState<AchStatusFilter>('all');
  const [pinSaving, setPinSaving] = useState<string | null>(null);

  // Inventory & Promo Code state
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoSuccess, setPromoSuccess] = useState<string | null>(null);
  const [equipLoadingId, setEquipLoadingId] = useState<string | null>(null);

  // Settings & Privacy state
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editFavoriteTrack, setEditFavoriteTrack] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [privacyForm, setPrivacyForm] = useState<PrivacySettings>(parsePrivacySettings(null));
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [notifyFollows, setNotifyFollows] = useState(true);
  const [notifyNews, setNotifyNews] = useState(false);
  const [notifPrefSaving, setNotifPrefSaving] = useState<'follows' | 'news' | null>(null);
  const [notifPrefMsg, setNotifPrefMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Email verification inside Settings tab
  const [verifyEmailInput, setVerifyEmailInput] = useState('');
  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [verifySending, setVerifySending] = useState(false);
  const [verifyConfirming, setVerifyConfirming] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Social / Share
  const [followLoading, setFollowLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const lookupNickname = targetNickname || user?.nickname;
  const isOwnProfile = Boolean(user && profile && user.id === profile.id);

  const fetchProfile = useCallback(async () => {
    if (!lookupNickname) {
      setLoading(false);
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(lookupNickname)}`, {
        cache: 'no-store',
      });
      const data = await safeJson<{ profile?: any; error?: string }>(res, {});
      if (!res.ok || !data.profile) {
        setProfile(null);
        setError(data.error || (lang === 'ru' ? 'Профиль не найден.' : 'Profile not found.'));
      } else {
        const p = data.profile;
        setProfile(p);
        setEditDisplayName(p.display_name || p.nickname || '');
        setEditUsername(p.nickname || '');
        setEditBio(p.bio || '');
        setEditStatus(p.custom_status || '');
        setEditFavoriteTrack(p.favorite_track || '');
        setEditAvatar(p.avatar_url || DEFAULT_AVATAR);
        setVerifyEmailInput(p.email || '');
        setNotifyFollows(p.notify_follows === 0 ? false : true);
        setNotifyNews(Boolean(p.notify_news));
        if (p.privacy_settings) {
          setPrivacyForm(parsePrivacySettings(p.privacy_settings));
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Connection error');
    } finally {
      setLoading(false);
    }
  }, [lookupNickname, lang]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Listen for notification / external profile subtab deep links
  useEffect(() => {
    const handleOpenSection = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string | null; shop?: boolean }>).detail || {};
      const nextTab = detail.tab;
      if (
        nextTab === 'overview' ||
        nextTab === 'achievements' ||
        nextTab === 'community' ||
        nextTab === 'history' ||
        nextTab === 'inventory' ||
        nextTab === 'settings'
      ) {
        setActiveTab(nextTab);
      }
      if (detail.shop) {
        setIsShopOpen(true);
      }
    };
    window.addEventListener('open-profile-section', handleOpenSection);
    return () => window.removeEventListener('open-profile-section', handleOpenSection);
  }, []);

  // Reset owner-only tabs when viewing another user's profile
  useEffect(() => {
    if (profile && !isOwnProfile && (activeTab === 'inventory' || activeTab === 'settings')) {
      setActiveTab('overview');
    }
  }, [profile, isOwnProfile, activeTab]);

  // Load XP history when opening History tab
  const fetchHistory = useCallback(async () => {
    if (!profile?.nickname) return;
    if (!isOwnProfile && profile.hidden_sections?.xp_history) {
      setHistoryHidden(true);
      setXpTransactions([]);
      setGameAttempts([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(profile.nickname)}/history`, {
        cache: 'no-store',
      });
      const data = await safeJson<any>(res, null);
      if (res.ok && data) {
        setHistoryHidden(Boolean(data.hidden));
        setXpTransactions(Array.isArray(data.xpTransactions) ? data.xpTransactions : []);
        setGameAttempts(Array.isArray(data.gameAttempts) ? data.gameAttempts : []);
      }
    } catch {
      // ignore transient error
    } finally {
      setHistoryLoading(false);
    }
  }, [profile?.nickname, profile?.hidden_sections?.xp_history, isOwnProfile]);

  useEffect(() => {
    if (activeTab === 'history' && profile) {
      fetchHistory();
    }
  }, [activeTab, profile, fetchHistory]);

  const handleToggleFollow = async () => {
    if (!user) {
      openAuth('login');
      return;
    }
    if (!profile || isOwnProfile || followLoading) return;
    setFollowLoading(true);
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(profile.nickname)}/follow`, {
        method: 'POST',
      });
      const data = await safeJson<any>(res, {});
      if (res.ok) {
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        await fetchProfile();
        refresh();
      }
    } finally {
      setFollowLoading(false);
    }
  };

  const handleCopyProfileLink = () => {
    if (!profile?.nickname) return;
    const url = `${window.location.origin}/profile/${encodeURIComponent(profile.nickname)}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  };

  const handleToggleFeaturedAchievement = async (slug: string) => {
    if (!isOwnProfile || !profile || pinSaving) return;
    const current: string[] = Array.isArray(profile.featured_achievements) ? profile.featured_achievements : [];
    const exists = current.includes(slug);
    const next = exists ? current.filter((s) => s !== slug) : [...current, slug].slice(-3);

    setPinSaving(slug);
    try {
      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured_achievements: next }),
      });
      if (res.ok) {
        await fetchProfile();
      }
    } finally {
      setPinSaving(null);
    }
  };

  const handleRedeemPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = promoCodeInput.trim();
    if (!code || promoLoading) return;
    setPromoLoading(true);
    setPromoError(null);
    setPromoSuccess(null);
    try {
      const res = await authFetch('/api/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await safeJson<any>(res, {});
      if (!res.ok) {
        setPromoError(data.error || (lang === 'ru' ? 'Неверный промокод.' : 'Invalid promo code.'));
      } else {
        setPromoSuccess(
          lang === 'ru'
            ? `Промокод «${data.code}» активирован: +${data.xp_reward} XP`
            : `Promo «${data.code}» redeemed: +${data.xp_reward} XP`
        );
        setPromoCodeInput('');
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        await refresh();
        await fetchProfile();
      }
    } catch (err: any) {
      setPromoError(err?.message || 'Error');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleInventoryEquip = async (itemId: string, currentlyEquipped: boolean) => {
    if (!isOwnProfile || equipLoadingId) return;
    setEquipLoadingId(itemId);
    try {
      const res = await authFetch('/api/shop/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, equip: !currentlyEquipped }),
      });
      const data = await safeJson<any>(res, {});
      if (res.ok) {
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        await refresh();
        await fetchProfile();
      }
    } finally {
      setEquipLoadingId(null);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setSettingsMsg(null);
    try {
      const data = await prepareAndUploadMedia(file, {
        imageMode: 'avatar',
        authFetch,
        lang,
        allowAudio: false,
        allowVideo: false,
        allowImage: true,
      });
      setEditAvatar(data.url);
      setSettingsMsg({
        type: 'ok',
        text: lang === 'ru' ? 'Аватар загружен — нажмите «Сохранить профиль».' : 'Avatar uploaded — click Save Profile.',
      });
    } catch (err: any) {
      setSettingsMsg({
        type: 'err',
        text: err?.message || (lang === 'ru' ? 'Ошибка загрузки аватара.' : 'Failed to upload avatar.'),
      });
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleSaveProfileSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnProfile || settingsSaving) return;
    setSettingsSaving(true);
    setSettingsMsg(null);
    try {
      const payload: Record<string, any> = {
        display_name: editDisplayName.trim(),
        bio: editBio.trim(),
        custom_status: editStatus.trim(),
        favorite_track: editFavoriteTrack.trim(),
        avatar_url: editAvatar.trim() || DEFAULT_AVATAR,
      };
      if (editUsername.trim() && editUsername.trim().toLowerCase() !== String(profile.nickname).toLowerCase()) {
        payload.username = editUsername.trim();
      }
      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson<any>(res, {});
      if (!res.ok) {
        setSettingsMsg({ type: 'err', text: data.error || 'Не удалось сохранить изменения.' });
      } else {
        if (data.token) {
          setStoredToken(data.token);
        }
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        setSettingsMsg({ type: 'ok', text: lang === 'ru' ? 'Профиль обновлён.' : 'Profile updated.' });
        await refresh();
        if (data.nickname && data.nickname !== profile.nickname) {
          window.dispatchEvent(new CustomEvent('navigate-profile', { detail: data.nickname }));
        } else {
          await fetchProfile();
        }
      }
    } catch (err: any) {
      setSettingsMsg({ type: 'err', text: err?.message || 'Connection error' });
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleSavePrivacy = async () => {
    if (!isOwnProfile || privacySaving) return;
    setPrivacySaving(true);
    setPrivacyMsg(null);
    try {
      const res = await authFetch('/api/profiles/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacy_settings: privacyForm }),
      });
      const data = await safeJson<any>(res, {});
      if (!res.ok) {
        setPrivacyMsg({ type: 'err', text: data.error || 'Не удалось сохранить настройки приватности.' });
      } else {
        setPrivacyMsg({
          type: 'ok',
          text: lang === 'ru' ? 'Настройки приватности сохранены.' : 'Privacy settings saved.',
        });
        await fetchProfile();
      }
    } catch (err: any) {
      setPrivacyMsg({ type: 'err', text: err?.message || 'Connection error' });
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleToggleNotificationPref = async (field: 'follows' | 'news') => {
    if (!isOwnProfile || notifPrefSaving) return;
    const prevFollows = notifyFollows;
    const prevNews = notifyNews;
    const nextFollows = field === 'follows' ? !notifyFollows : notifyFollows;
    const nextNews = field === 'news' ? !notifyNews : notifyNews;

    setNotifyFollows(nextFollows);
    setNotifyNews(nextNews);
    setNotifPrefSaving(field);
    setNotifPrefMsg(null);
    try {
      const res = await authFetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          field === 'follows' ? { notify_follows: nextFollows } : { notify_news: nextNews }
        ),
      });
      if (!res.ok) {
        setNotifyFollows(prevFollows);
        setNotifyNews(prevNews);
        setNotifPrefMsg({ type: 'err', text: 'Не удалось обновить настройки уведомлений.' });
      } else {
        setNotifPrefMsg({
          type: 'ok',
          text: lang === 'ru' ? 'Настройка уведомлений сохранена.' : 'Notification preference updated.',
        });
        await refresh();
      }
    } catch {
      setNotifyFollows(prevFollows);
      setNotifyNews(prevNews);
      setNotifPrefMsg({ type: 'err', text: 'Ошибка соединения.' });
    } finally {
      setNotifPrefSaving(null);
    }
  };

  const handleSendVerifyEmailCode = async () => {
    if (!verifyEmailInput.trim() || verifySending) return;
    setVerifySending(true);
    setVerifyMsg(null);
    try {
      const res = await authFetch('/api/auth/email/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verifyEmailInput.trim(), purpose: 'verify_existing' }),
      });
      const data = await safeJson<any>(res, {});
      if (!res.ok) {
        setVerifyMsg({ type: 'err', text: data.error || 'Не удалось отправить код.' });
      } else {
        setVerifyToken(data.verification_token || null);
        setVerifyMsg({
          type: 'ok',
          text: lang === 'ru'
            ? '6-значный код отправлен на почту. Проверьте входящие и папку «Спам».'
            : '6-digit code sent. Check your inbox and Spam folder.',
        });
      }
    } catch {
      setVerifyMsg({
        type: 'err',
        text: lang === 'ru' ? 'Ошибка соединения при отправке кода.' : 'Network error sending code.',
      });
    } finally {
      setVerifySending(false);
    }
  };

  const handleConfirmVerifyEmail = async () => {
    if (!verifyToken || !verifyCodeInput.trim() || verifyConfirming) return;
    setVerifyConfirming(true);
    setVerifyMsg(null);
    try {
      const res = await authFetch('/api/auth/email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: verifyEmailInput.trim(),
          code: verifyCodeInput.trim(),
          verification_token: verifyToken,
        }),
      });
      const data = await safeJson<any>(res, {});
      if (!res.ok) {
        setVerifyMsg({ type: 'err', text: data.error || 'Неверный код подтверждения.' });
      } else {
        setVerifyCodeInput('');
        setVerifyToken(null);
        setVerifyMsg({ type: 'ok', text: lang === 'ru' ? 'Почта успешно подтверждена.' : 'Email verified.' });
        await refresh();
        await fetchProfile();
      }
    } catch {
      setVerifyMsg({
        type: 'err',
        text: lang === 'ru' ? 'Ошибка соединения при подтверждении почты.' : 'Network error verifying email.',
      });
    } finally {
      setVerifyConfirming(false);
    }
  };

  // Guest / Not logged in viewing own /profile
  if (!lookupNickname) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-5">
        <div className="w-12 h-12 rounded-lg bg-[#121118] border border-white/[0.08] flex items-center justify-center mx-auto text-[#8e877e]">
          <Lock className="w-5 h-5" />
        </div>
        <h1 className="font-display text-2xl tracking-[0.14em] uppercase text-[#f2eee9]">
          {lang === 'ru' ? 'Личный профиль' : 'Personal Profile'}
        </h1>
        <p className="text-sm text-[#8e877e]">
          {lang === 'ru'
            ? 'Войдите или создайте аккаунт, чтобы отслеживать опыт, серию дней, достижения и кастомизацию.'
            : 'Sign in or create an account to track XP, daily streaks, achievements, and profile customization.'}
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => openAuth('login')}
            className="px-5 py-2.5 rounded-md bg-white text-[#09090b] text-xs font-mono uppercase tracking-wider font-medium hover:bg-[#e8e3dc] transition-colors cursor-pointer"
          >
            {lang === 'ru' ? 'Войти' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => openAuth('register')}
            className="px-5 py-2.5 rounded-md border border-white/[0.15] text-[#f2eee9] text-xs font-mono uppercase tracking-wider hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            {lang === 'ru' ? 'Регистрация' : 'Register'}
          </button>
        </div>
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 flex items-center justify-center gap-2.5 text-[#8e877e] font-mono text-xs">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{lang === 'ru' ? 'Загрузка профиля...' : 'Loading profile...'}</span>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-[#c94a5e] mx-auto" />
        <p className="text-sm text-[#ded8ce]">{error || 'Профиль не найден.'}</p>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'home' }))}
          className="px-4 py-2 rounded-md border border-white/[0.12] text-xs font-mono uppercase tracking-wider text-[#ded8ce] hover:bg-white/[0.06] cursor-pointer"
        >
          {lang === 'ru' ? 'На главную' : 'Return Home'}
        </button>
      </div>
    );
  }

  const levelInfo = calculateLevelFromXp(Number(profile.total_xp || 0));
  const hidden = profile.hidden_sections || {
    community: false,
    streak: false,
    xp_history: false,
    game_stats: false,
  };
  const streakDays = typeof profile.daily_streak === 'number' ? profile.daily_streak : 0;
  const streakBonusPct = typeof profile.streak_bonus_percent === 'number'
    ? profile.streak_bonus_percent
    : getStreakBonusPercent(streakDays);

  const allAchievements: any[] = Array.isArray(profile.allAchievements) ? profile.allAchievements : [];
  const unlockedCount = allAchievements.filter((a) => a.is_unlocked).length;
  const easyCount = allAchievements.filter((a) => a.difficulty_tier === 'easy').length;
  const hardCount = allAchievements.filter((a) => a.difficulty_tier === 'hard').length;
  const secretCount = allAchievements.filter((a) => a.difficulty_tier === 'secret').length;

  const filteredAchievements = allAchievements.filter((a) => {
    if (achTier !== 'all' && a.difficulty_tier !== achTier) return false;
    if (achStatus === 'unlocked' && !a.is_unlocked) return false;
    if (achStatus === 'locked' && a.is_unlocked) return false;
    return true;
  });

  const featuredList: any[] = Array.isArray(profile.featuredAchievements) ? profile.featuredAchievements : [];
  const featuredSlugs: string[] = Array.isArray(profile.featured_achievements) ? profile.featured_achievements : [];

  const tabs: Array<{ id: ProfileTab; label: string; icon: React.ReactNode; ownerOnly?: boolean }> = [
    {
      id: 'overview',
      label: lang === 'ru' ? 'Обзор и статистика' : 'Overview & Stats',
      icon: <Gamepad2 className="w-3.5 h-3.5" />,
    },
    {
      id: 'achievements',
      label: `${lang === 'ru' ? 'Достижения' : 'Achievements'} (${unlockedCount}/${allAchievements.length})`,
      icon: <Trophy className="w-3.5 h-3.5" />,
    },
    {
      id: 'community',
      label: lang === 'ru' ? 'Сообщество' : 'Community',
      icon: <MessageSquare className="w-3.5 h-3.5" />,
    },
    {
      id: 'history',
      label: lang === 'ru' ? 'История XP' : 'XP History',
      icon: <History className="w-3.5 h-3.5" />,
    },
    {
      id: 'inventory',
      label: lang === 'ru' ? 'Инвентарь / Промо' : 'Inventory / Promo',
      icon: <ShoppingBag className="w-3.5 h-3.5" />,
      ownerOnly: true,
    },
    {
      id: 'settings',
      label: lang === 'ru' ? 'Настройки' : 'Settings',
      icon: <Settings className="w-3.5 h-3.5" />,
      ownerOnly: true,
    },
  ];

  const visibleTabs = tabs.filter((tb) => !tb.ownerOnly || isOwnProfile);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-7 space-y-5 animate-fadeIn">
      {isOwnProfile && (
        <ShopModal
          isOpen={isShopOpen}
          onClose={() => {
            setIsShopOpen(false);
            refresh().catch(() => {});
            fetchProfile();
          }}
        />
      )}

      <ShareCardModal
        isOpen={shareModalOpen}
        context={{
          type: 'profile',
          displayName: profile.display_name || profile.nickname,
          nickname: profile.nickname,
          avatarUrl: profile.avatar_url || DEFAULT_AVATAR,
          shieldTitle: getEquippedTitleLabel(profile.equipped_title, 'ru'),
          level: levelInfo.level,
          totalXp: Number(profile.total_xp || 0),
          streakDays: hidden.streak ? 0 : streakDays,
          favoriteTrack: profile.favorite_track || null,
          bannerKey: profile.equipped_banner || null,
          shareUrl: `${window.location.origin}/profile/${encodeURIComponent(profile.nickname)}`,
        }}
        onClose={() => setShareModalOpen(false)}
      />

      {/* COMPACT PROFILE HERO CARD */}
      <section
        className={`relative overflow-hidden rounded-xl border ${
          getProfileThemeStyle(profile.equipped_theme).cardClass
        }`}
      >
        {/* Banner */}
        <div className="relative h-28 sm:h-36 w-full overflow-hidden border-b border-white/[0.07]">
          {renderProfileBanner(profile.equipped_banner)}
          {renderProfileEffectOverlay(profile.equipped_effect)}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0e0d12] via-[#0e0d12]/35 to-transparent" />
        </div>

        {/* Hero Content Row */}
        <div className="relative px-4 sm:px-6 pb-5 -mt-10 sm:-mt-12">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            {/* Avatar + Name + Identity */}
            <div className="flex items-end gap-3.5 min-w-0">
              <div
                className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-[#15141b] shrink-0 ${
                  profile.equipped_frame || 'border-2 border-white/20'
                }`}
              >
                <img
                  src={profile.avatar_url || DEFAULT_AVATAR}
                  alt={profile.display_name || profile.nickname}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR;
                  }}
                />
              </div>

              <div className="min-w-0 pb-0.5 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1
                    className={`text-lg sm:text-2xl font-medium truncate ${
                      profile.equipped_name_style || 'text-[#f2eee9]'
                    }`}
                  >
                    {profile.display_name || profile.nickname}
                  </h1>
                  {renderEquippedBadge(profile.equipped_badge)}
                  {renderEquippedTitle(profile.equipped_title)}
                  {(profile.role_id === 'admin' || profile.role_id === 'moderator') && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#271217] border border-[#821c2c]/50 font-mono text-[10px] uppercase tracking-wider text-[#f0a3b0]">
                      <Shield className="w-2.5 h-2.5" />
                      {profile.role_id === 'admin' ? 'Admin' : 'Mod'}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[#8e877e]">
                  <span>{formatHandle(profile.nickname)}</span>
                  <span className="text-[#3e3934]">·</span>
                  <span className="text-[#ded8ce]">
                    {lang === 'ru' ? `Уровень ${levelInfo.level}` : `Level ${levelInfo.level}`}
                  </span>
                  {!hidden.streak && (
                    <>
                      <span className="text-[#3e3934]">·</span>
                      <span className="inline-flex items-center gap-1 text-[#ded8ce] tabular-nums">
                        <Flame className="w-3.5 h-3.5 text-[#c94a5e]" />
                        {streakDays} {lang === 'ru' ? 'дн.' : 'd'}
                        {streakBonusPct > 0 && (
                          <span className="text-[10px] text-[#7ed6a3] ml-0.5">+{streakBonusPct}% XP</span>
                        )}
                      </span>
                    </>
                  )}
                </div>

                {profile.custom_status && (
                  <p className="text-xs text-[#b5aea4] truncate max-w-md">{profile.custom_status}</p>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!isOwnProfile && (
                <button
                  type="button"
                  onClick={handleToggleFollow}
                  disabled={followLoading}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                    profile.isFollowing
                      ? 'bg-[#1a1922] border border-white/[0.15] text-[#ded8ce] hover:border-white/30'
                      : 'bg-[#f2eee9] text-[#09090b] hover:bg-white font-medium'
                  }`}
                >
                  {profile.isFollowing ? (
                    <>
                      <UserCheck className="w-3.5 h-3.5" />
                      {lang === 'ru' ? 'Вы подписаны' : 'Following'}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      {lang === 'ru' ? 'Подписаться' : 'Follow'}
                    </>
                  )}
                </button>
              )}

              {isOwnProfile && (
                <button
                  type="button"
                  onClick={() => setIsShopOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#191620] hover:bg-[#231f2d] border border-white/[0.14] text-[#f2eee9] text-xs font-mono uppercase tracking-wider transition-colors cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5 text-[#d4af68]" />
                  {lang === 'ru' ? 'Магазин XP' : 'XP Shop'}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShareModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#131218] hover:bg-[#1a1922] border border-white/[0.09] text-[#b5aea4] hover:text-white text-xs font-mono transition-colors cursor-pointer"
                title={lang === 'ru' ? 'Поделиться карточкой профиля' : 'Share profile card'}
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {lang === 'ru' ? 'Поделиться' : 'Share'}
                </span>
              </button>
            </div>
          </div>

          {/* Compact XP Progress Bar */}
          <div className="mt-4 pt-3.5 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                <span className="text-[#a39b8b]">
                  {lang === 'ru' ? `Опыт уровня ${levelInfo.level}` : `Level ${levelInfo.level} XP`}
                </span>
                <span className="text-[#ded8ce]">
                  {levelInfo.currentLevelXp} / {levelInfo.nextLevelXp} XP
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#821c2c] to-[#c96075] transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, levelInfo.progressPercent))}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-4 font-mono text-xs tabular-nums shrink-0 sm:pl-4 sm:border-l sm:border-white/[0.07]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                  {lang === 'ru' ? 'Баланс' : 'Balance'}
                </div>
                <div className="text-[#f2eee9] font-semibold">{profile.xp} XP</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                  {lang === 'ru' ? 'Достижения' : 'Badges'}
                </div>
                <div className="text-[#ded8ce]">
                  {unlockedCount}/{allAchievements.length}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                  {lang === 'ru' ? 'Подписчики' : 'Followers'}
                </div>
                <div className="text-[#ded8ce]">{profile.followers_count || 0}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLEAN PROFILE TABS BAR */}
      <nav
        aria-label="Profile sections"
        className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto pb-1 border-b border-white/[0.07]"
      >
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 lg:px-3 py-2 rounded-md font-mono text-[11px] sm:text-xs whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-white/[0.09] text-[#f2eee9] border border-white/[0.14]'
                  : 'text-[#8e877e] hover:text-[#ded8ce] hover:bg-white/[0.03] border border-transparent'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* TAB 1: ОБЗОР И СТАТИСТИКА */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {profile.bio && (
            <div className="rounded-lg border border-white/[0.07] bg-[#0e0d12] px-4 py-3.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#736c64] mb-1">
                {lang === 'ru' ? 'О себе' : 'About'}
              </div>
              <p className="text-sm text-[#d4cec5] leading-relaxed whitespace-pre-line">{profile.bio}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Game Statistics Card */}
            <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                  <Gamepad2 className="w-3.5 h-3.5 text-[#c96075]" />
                  {lang === 'ru' ? 'Игровая статистика' : 'Game Statistics'}
                </h2>
              </div>

              {hidden.game_stats ? (
                <HiddenSectionCard
                  nickname={profile.nickname}
                  label={lang === 'ru' ? 'Подробная игровая статистика скрыта настройками приватности.' : 'Game stats are hidden.'}
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono tabular-nums">
                  <div className="rounded-md border border-white/[0.06] bg-[#131218] p-3">
                    <div className="text-[10px] uppercase text-[#736c64]">
                      {lang === 'ru' ? 'Всего игр' : 'Total Games'}
                    </div>
                    <div className="text-lg font-semibold text-[#f2eee9] mt-0.5">{profile.games_played ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-white/[0.06] bg-[#131218] p-3">
                    <div className="text-[10px] uppercase text-[#736c64]">
                      {lang === 'ru' ? 'Угадай трек' : 'Guess Track'}
                    </div>
                    <div className="text-lg font-semibold text-[#f2eee9] mt-0.5">
                      {profile.guess_track_wins ?? 0}
                      <span className="text-xs font-normal text-[#736c64]"> / {profile.guess_track_played ?? 0}</span>
                    </div>
                  </div>
                  <div className="rounded-md border border-white/[0.06] bg-[#131218] p-3">
                    <div className="text-[10px] uppercase text-[#736c64]">
                      {lang === 'ru' ? 'Викторина (5/5)' : 'Quiz (5/5)'}
                    </div>
                    <div className="text-lg font-semibold text-[#f2eee9] mt-0.5">
                      {profile.quiz_played ?? 0}
                      <span className="text-xs font-normal text-[#7ed6a3]"> ({profile.quiz_perfect_runs ?? 0})</span>
                    </div>
                  </div>
                  <div className="rounded-md border border-white/[0.06] bg-[#131218] p-3">
                    <div className="text-[10px] uppercase text-[#736c64]">
                      {lang === 'ru' ? 'Угадай строчку' : 'Guess Lyric'}
                    </div>
                    <div className="text-lg font-semibold text-[#f2eee9] mt-0.5">
                      {profile.guess_lyrics_wins ?? 0}
                      <span className="text-xs font-normal text-[#736c64]"> / {profile.guess_lyrics_played ?? 0}</span>
                    </div>
                  </div>
                  <div className="rounded-md border border-white/[0.06] bg-[#131218] p-3">
                    <div className="text-[10px] uppercase text-[#736c64]">
                      {lang === 'ru' ? 'Задом наперёд' : 'Reverse Track'}
                    </div>
                    <div className="text-lg font-semibold text-[#f2eee9] mt-0.5">
                      {profile.reverse_track_wins ?? 0}
                      <span className="text-xs font-normal text-[#736c64]"> / {profile.reverse_track_played ?? 0}</span>
                    </div>
                  </div>
                  <div className="rounded-md border border-white/[0.06] bg-[#131218] p-3">
                    <div className="text-[10px] uppercase text-[#736c64]">
                      {lang === 'ru' ? '0.5x / 2.5x' : '0.5x / 2.5x'}
                    </div>
                    <div className="text-lg font-semibold text-[#f2eee9] mt-0.5">
                      {profile.speed_track_wins ?? 0}
                      <span className="text-xs font-normal text-[#736c64]"> / {profile.speed_track_played ?? 0}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Daily Streak & Multiplier Card */}
            <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                  <Flame className="w-3.5 h-3.5 text-[#c94a5e]" />
                  {lang === 'ru' ? 'Серия дней (МСК)' : 'Daily Streak (MSK)'}
                </h2>
                {!hidden.streak && (
                  <span className="font-mono text-[11px] text-[#7ed6a3] border border-[#2f5e42] bg-[#102016] px-2 py-0.5 rounded tabular-nums">
                    +{streakBonusPct}% XP
                  </span>
                )}
              </div>

              {hidden.streak ? (
                <HiddenSectionCard
                  nickname={profile.nickname}
                  label={lang === 'ru' ? 'Серия активности скрыта настройками приватности.' : 'Streak is hidden.'}
                />
              ) : (
                <div className="rounded-md border border-white/[0.06] bg-[#131218] p-4 space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-3xl font-semibold text-[#f2eee9] tabular-nums">
                        {streakDays}
                      </span>
                      <span className="font-mono text-xs text-[#8e877e] uppercase">
                        {lang === 'ru' ? 'дней подряд' : 'days in a row'}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-[#a39b8b] tabular-nums">
                      {Math.min(10, streakDays)}/10 {lang === 'ru' ? 'до макс. бонуса' : 'to max bonus'}
                    </span>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#821c2c] to-[#e06d53] transition-all duration-500"
                      style={{ width: `${Math.min(100, (streakBonusPct / 50) * 100)}%` }}
                    />
                  </div>

                  <p className="text-xs text-[#8e877e] leading-relaxed">
                    {lang === 'ru'
                      ? 'Заходите и проходите минимум одну игру или викторину в день по МСК (UTC+3). Каждый день серии даёт +5% к XP в играх (до +50%).'
                      : 'Complete at least one daily game or quiz per Moscow day (UTC+3). Each streak day grants +5% game XP (up to +50%).'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Featured Showcase Achievements */}
          <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#d4af68]" />
                {lang === 'ru' ? 'Витрина достижений' : 'Featured Achievements'}
              </h2>
              <button
                type="button"
                onClick={() => setActiveTab('achievements')}
                className="font-mono text-[11px] text-[#a39b8b] hover:text-white transition-colors cursor-pointer"
              >
                {lang === 'ru' ? 'Все достижения →' : 'All achievements →'}
              </button>
            </div>

            {featuredList.length === 0 ? (
              <p className="text-xs text-[#736c64] py-2">
                {lang === 'ru'
                  ? 'Пока нет открытых достижений для витрины.'
                  : 'No unlocked achievements yet.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {featuredList.slice(0, 3).map((ach: any) => (
                  <div
                    key={ach.slug}
                    className="rounded-md border border-white/[0.07] bg-[#131218] p-3 flex items-start gap-2.5"
                  >
                    <div className="w-8 h-8 rounded bg-[#1d1720] border border-[#821c2c]/35 flex items-center justify-center text-[#eb9aa7] shrink-0">
                      {renderAchievementIcon(ach.icon, 'w-4 h-4')}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#f2eee9] truncate">
                        {lang === 'ru' ? ach.title_ru : ach.title_en}
                      </div>
                      <div className="text-[11px] text-[#8e877e] line-clamp-2 mt-0.5">
                        {lang === 'ru' ? ach.condition_ru || ach.desc_ru : ach.condition_en || ach.desc_en}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ДОСТИЖЕНИЯ */}
      {activeTab === 'achievements' && (
        <div className="space-y-4">
          {/* Tier Filter Sub-tabs + Status Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0e0d12] p-3">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
              {(
                [
                  { id: 'all', label: lang === 'ru' ? `Все (${allAchievements.length})` : `All (${allAchievements.length})` },
                  { id: 'easy', label: lang === 'ru' ? `Лёгкие (${easyCount})` : `Easy (${easyCount})` },
                  { id: 'hard', label: lang === 'ru' ? `Сложные (${hardCount})` : `Hard (${hardCount})` },
                  { id: 'secret', label: lang === 'ru' ? `Секретные (${secretCount})` : `Secret (${secretCount})` },
                ] as Array<{ id: AchTierFilter; label: string }>
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAchTier(f.id)}
                  className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                    achTier === f.id
                      ? 'bg-[#821c2c]/30 text-[#f2eee9] border border-[#c96075]/45'
                      : 'text-[#8e877e] hover:text-[#ded8ce] border border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 font-mono text-[11px]">
              {(
                [
                  { id: 'all', label: lang === 'ru' ? 'Все' : 'All' },
                  { id: 'unlocked', label: lang === 'ru' ? 'Открытые' : 'Unlocked' },
                  { id: 'locked', label: lang === 'ru' ? 'В процессе' : 'In Progress' },
                ] as Array<{ id: AchStatusFilter; label: string }>
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setAchStatus(st.id)}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    achStatus === st.id
                      ? 'bg-white/[0.1] text-white'
                      : 'text-[#736c64] hover:text-[#ded8ce]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Achievements Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredAchievements.map((ach: any) => {
              const isUnlocked = Boolean(ach.is_unlocked);
              const isSecret = ach.difficulty_tier === 'secret' || Boolean(ach.is_secret);
              const isSecretLocked = isSecret && !isUnlocked;
              const isPinned = featuredSlugs.includes(ach.slug);
              const progCurrent = Number(ach.progress?.current ?? (isUnlocked ? 1 : 0));
              const progTarget = Math.max(1, Number(ach.progress?.target ?? 1));
              const progPct = isSecretLocked ? 0 : Math.min(100, Math.round((progCurrent / progTarget) * 100));

              const tierBadge =
                ach.difficulty_tier === 'secret'
                  ? { label: lang === 'ru' ? 'Секретное' : 'Secret', cls: 'text-[#d0b4fa] border-[#9c5de0]/40 bg-[#1c1329]' }
                  : ach.difficulty_tier === 'hard'
                    ? { label: lang === 'ru' ? 'Сложное' : 'Hard', cls: 'text-[#f0c784] border-[#d4af68]/35 bg-[#221b11]' }
                    : { label: lang === 'ru' ? 'Лёгкое' : 'Easy', cls: 'text-[#b5aea4] border-white/[0.12] bg-white/[0.04]' };

              return (
                <div
                  key={ach.slug}
                  className={`rounded-lg border p-3.5 transition-colors flex flex-col justify-between gap-3 ${
                    isUnlocked
                      ? 'border-white/[0.13] bg-[#121118]'
                      : 'border-white/[0.06] bg-[#0c0b10]/90 opacity-85'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-md border flex items-center justify-center shrink-0 ${
                        isUnlocked
                          ? isSecret
                            ? 'bg-[#211530] border-[#9c5de0]/40 text-[#d0b4fa]'
                            : 'bg-[#221117] border-[#821c2c]/45 text-[#eb9aa7]'
                          : 'bg-[#15141c] border-white/[0.08] text-[#635d54]'
                      }`}
                    >
                      {isSecretLocked ? <Lock className="w-4 h-4" /> : renderAchievementIcon(ach.icon, 'w-4 h-4')}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-sm font-medium truncate ${isUnlocked ? 'text-[#f2eee9]' : 'text-[#b5aea4]'}`}>
                            {lang === 'ru' ? ach.title_ru : ach.title_en}
                          </span>
                          {isUnlocked && <CheckCircle2 className="w-3.5 h-3.5 text-[#7ed6a3] shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                          <span className={`px-1.5 py-0.5 rounded border ${tierBadge.cls}`}>
                            {tierBadge.label}
                          </span>
                          {Number(ach.xp_reward || 0) > 0 && (
                            <span className="px-1.5 py-0.5 rounded border border-[#2f5e42] bg-[#102016] text-[#7ed6a3] tabular-nums">
                              +{ach.xp_reward} XP
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-[#9c9488] leading-relaxed">
                        {isSecretLocked
                          ? '???'
                          : lang === 'ru'
                            ? ach.desc_ru
                            : ach.desc_en}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar & Owner Pin Action */}
                  <div className="space-y-1.5 pt-1 border-t border-white/[0.05]">
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#8e877e] tabular-nums">
                      <span className="truncate pr-2">
                        {isSecretLocked
                          ? lang === 'ru'
                            ? 'Условие: ???'
                            : 'Condition: ???'
                          : lang === 'ru'
                            ? ach.condition_ru || ach.desc_ru
                            : ach.condition_en || ach.desc_en}
                      </span>
                      <span className={isUnlocked ? 'text-[#7ed6a3] shrink-0' : 'text-[#a39b8b] shrink-0'}>
                        {isSecretLocked ? '???' : `${progCurrent} / ${progTarget}`}
                      </span>
                    </div>

                    <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isUnlocked ? 'bg-[#4fb37a]' : 'bg-[#821c2c]'
                        }`}
                        style={{ width: `${progPct}%` }}
                      />
                    </div>

                    {isOwnProfile && isUnlocked && (
                      <div className="flex items-center justify-between pt-1">
                        <span className="font-mono text-[10px] text-[#6e675e]">
                          {ach.unlocked_at ? new Date(ach.unlocked_at).toLocaleDateString('ru-RU') : ''}
                        </span>
                        <button
                          type="button"
                          disabled={pinSaving === ach.slug}
                          onClick={() => handleToggleFeaturedAchievement(ach.slug)}
                          className={`inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            isPinned
                              ? 'border-[#d4af68]/45 bg-[#241d11] text-[#f0d599]'
                              : 'border-white/[0.09] text-[#8e877e] hover:text-white'
                          }`}
                        >
                          <Pin className="w-2.5 h-2.5" />
                          {isPinned
                            ? lang === 'ru'
                              ? 'В витрине'
                              : 'Pinned'
                            : lang === 'ru'
                              ? 'На витрину'
                              : 'Pin'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: СООБЩЕСТВО (COMPACT, STABLE, REAL DB STATS) */}
      {activeTab === 'community' && (
        <div className="space-y-4">
          {hidden.community ? (
            <HiddenSectionCard
              nickname={profile.nickname}
              label={
                lang === 'ru'
                  ? 'Активность в сообществе скрыта настройками приватности.'
                  : 'Community activity is hidden by privacy settings.'
              }
            />
          ) : (
            <>
              {/* Compact 4-Stat Community Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-3.5">
                  <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                    {lang === 'ru' ? 'Ответов в темах' : 'Replies Posted'}
                  </div>
                  <div className="text-xl font-semibold text-[#f2eee9] mt-1">{profile.comments_count ?? 0}</div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-3.5">
                  <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                    {lang === 'ru' ? 'Прочитано тем' : 'Topics Read'}
                  </div>
                  <div className="text-xl font-semibold text-[#f2eee9] mt-1">{profile.posts_read_count ?? 0}</div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-3.5">
                  <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                    {lang === 'ru' ? 'Создано тем' : 'Topics Created'}
                  </div>
                  <div className="text-xl font-semibold text-[#f2eee9] mt-1">{profile.posts_count ?? 0}</div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-3.5">
                  <div className="text-[10px] uppercase tracking-wider text-[#736c64]">
                    {lang === 'ru' ? 'Подписчики / Подписки' : 'Followers / Following'}
                  </div>
                  <div className="text-xl font-semibold text-[#f2eee9] mt-1">
                    {profile.followers_count ?? 0}
                    <span className="text-xs font-normal text-[#736c64]"> / {profile.following_count ?? 0}</span>
                  </div>
                </div>
              </div>

              {/* Compact 2-Column Activity Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Recent Topics */}
                <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-[#c96075]" />
                      {lang === 'ru' ? 'Последние темы' : 'Recent Topics'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'community' }))}
                      className="font-mono text-[11px] text-[#8e877e] hover:text-white cursor-pointer"
                    >
                      {lang === 'ru' ? 'Форум →' : 'Forum →'}
                    </button>
                  </div>

                  {!profile.recentPosts || profile.recentPosts.length === 0 ? (
                    <p className="text-xs text-[#736c64] py-4 text-center">
                      {lang === 'ru' ? 'Пользователь ещё не создавал тем.' : 'No topics created yet.'}
                    </p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {profile.recentPosts.map((post: any) => (
                        <button
                          key={post.id}
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'community' }))}
                          className="w-full py-2.5 text-left hover:bg-white/[0.02] transition-colors flex items-start justify-between gap-3 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[#f2eee9] truncate">{post.title}</div>
                            <div className="font-mono text-[10px] text-[#736c64] mt-0.5">
                              {lang === 'ru' ? post.category_name_ru : post.category_name_en} ·{' '}
                              {post.created_at ? new Date(post.created_at).toLocaleDateString('ru-RU') : ''}
                            </div>
                          </div>
                          <div className="font-mono text-[10px] text-[#8e877e] shrink-0 tabular-nums">
                            {post.comments_count || 0} отв. · {post.views_count || 0} просм.
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Creations & Favorites */}
                <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                      <Heart className="w-3.5 h-3.5 text-[#c96075]" />
                      {lang === 'ru' ? 'Творчество и избранное' : 'Creations & Favorites'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'creations' }))}
                      className="font-mono text-[11px] text-[#8e877e] hover:text-white cursor-pointer"
                    >
                      {lang === 'ru' ? 'Галерея →' : 'Gallery →'}
                    </button>
                  </div>

                  {(!profile.recentCreations || profile.recentCreations.length === 0) &&
                  (!profile.favoriteCreations || profile.favoriteCreations.length === 0) ? (
                    <p className="text-xs text-[#736c64] py-4 text-center">
                      {lang === 'ru' ? 'Пока нет опубликованных или избранных работ.' : 'No creations or favorites yet.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5">
                      {[...(profile.recentCreations || []), ...(profile.favoriteCreations || [])]
                        .slice(0, 4)
                        .map((cr: any) => (
                          <button
                            key={cr.id}
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'creations' }))}
                            className="rounded-md border border-white/[0.07] bg-[#131218] p-2.5 text-left hover:border-white/[0.2] transition-colors cursor-pointer"
                          >
                            <div className="text-xs font-medium text-[#f2eee9] truncate">{cr.title}</div>
                            <div className="font-mono text-[10px] text-[#736c64] mt-0.5 truncate">
                              {cr.type || 'art'} · ♥ {cr.likes_count || 0}
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 4: ИСТОРИЯ XP (100% RUSSIAN + PRIVACY DEFAULT HIDDEN) */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {!isOwnProfile && (hidden.xp_history || historyHidden) ? (
            <HiddenSectionCard
              nickname={profile.nickname}
              label={
                lang === 'ru'
                  ? 'По умолчанию история XP доступна только владельцу профиля.'
                  : 'XP history is private by default.'
              }
            />
          ) : historyLoading ? (
            <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] py-12 flex items-center justify-center gap-2 font-mono text-xs text-[#8e877e]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{lang === 'ru' ? 'Загрузка истории XP...' : 'Loading XP history...'}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* XP Transactions (2/3 width) */}
              <div className="lg:col-span-2 rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce]">
                    {lang === 'ru' ? 'История начислений и трат XP' : 'XP Transactions'}
                  </h2>
                  {isOwnProfile && privacyForm.hide_xp_history && (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#8e877e]">
                      <Lock className="w-3 h-3" />
                      {lang === 'ru' ? 'Видно только вам' : 'Only visible to you'}
                    </span>
                  )}
                </div>

                {xpTransactions.length === 0 ? (
                  <p className="text-xs text-[#736c64] py-6 text-center">
                    {lang === 'ru' ? 'История операций пока пуста.' : 'No XP transactions yet.'}
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {xpTransactions.map((tx: any) => {
                      const amount = Number(tx.amount || 0);
                      const formatted = formatXpTransactionLabel(tx.source, tx.details, lang);
                      return (
                        <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[#f2eee9] truncate">{formatted.title}</div>
                            <div className="text-[11px] text-[#8e877e] truncate mt-0.5">
                              {formatted.subtitle ? `${formatted.subtitle} · ` : ''}
                              {tx.created_at
                                ? new Date(tx.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : ''}
                            </div>
                          </div>
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                              amount >= 0 ? 'text-[#7ed6a3]' : 'text-[#e28593]'
                            }`}
                          >
                            {amount >= 0 ? `+${amount}` : amount} XP
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Game Attempts (1/3 width) */}
              <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce]">
                  {lang === 'ru' ? 'Последние игры' : 'Recent Games'}
                </h2>
                {hidden.game_stats && !isOwnProfile ? (
                  <HiddenSectionCard nickname={profile.nickname} />
                ) : gameAttempts.length === 0 ? (
                  <p className="text-xs text-[#736c64] py-6 text-center">
                    {lang === 'ru' ? 'Игровых попыток пока нет.' : 'No game attempts yet.'}
                  </p>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {gameAttempts.slice(0, 12).map((att: any) => {
                      const gameTitle =
                        att.game_id === 'daily-quiz'
                          ? lang === 'ru'
                            ? 'Ежедневная викторина'
                            : 'Daily Quiz'
                          : lang === 'ru'
                            ? 'Угадай трек'
                            : 'Guess The Track';
                      return (
                        <div key={att.id} className="py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs text-[#ded8ce] truncate">{gameTitle}</div>
                            <div className="font-mono text-[10px] text-[#736c64]">
                              {lang === 'ru' ? `Очки: ${att.score}` : `Score: ${att.score}`} ·{' '}
                              {att.created_at ? new Date(att.created_at).toLocaleDateString('ru-RU') : ''}
                            </div>
                          </div>
                          <span className="font-mono text-xs text-[#7ed6a3] tabular-nums shrink-0">
                            +{att.xp_earned} XP
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: ИНВЕНТАРЬ / ПРОМОКОДЫ (OWNER ONLY) */}
      {activeTab === 'inventory' && isOwnProfile && (
        <div className="space-y-4">
          {/* Promo Code Block */}
          <div className="rounded-lg border border-white/[0.09] bg-[#0e0d12] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                <Ticket className="w-3.5 h-3.5 text-[#d4af68]" />
                {lang === 'ru' ? 'Активация промокода' : 'Redeem Promo Code'}
              </h2>
              <button
                type="button"
                onClick={() => setIsShopOpen(true)}
                className="inline-flex items-center gap-1.5 font-mono text-xs text-[#f0d599] hover:text-white transition-colors cursor-pointer"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                {lang === 'ru' ? `Открыть магазин (${profile.xp} XP)` : `Open Shop (${profile.xp} XP)`}
              </button>
            </div>

            <form onSubmit={handleRedeemPromo} className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value)}
                placeholder={lang === 'ru' ? 'Введите промокод...' : 'Enter promo code...'}
                className="flex-1 px-3.5 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-sm text-[#f2eee9] placeholder:text-[#635d54] focus:outline-none focus:border-white/30 font-mono"
              />
              <button
                type="submit"
                disabled={promoLoading || !promoCodeInput.trim()}
                className="px-5 py-2 rounded-md bg-[#f2eee9] hover:bg-white disabled:opacity-40 text-[#09090b] text-xs font-mono uppercase tracking-wider font-medium transition-colors cursor-pointer"
              >
                {promoLoading
                  ? lang === 'ru'
                    ? 'Проверка...'
                    : 'Checking...'
                  : lang === 'ru'
                    ? 'Активировать'
                    : 'Redeem'}
              </button>
            </form>

            {promoError && <p className="text-xs text-[#e28593]">{promoError}</p>}
            {promoSuccess && <p className="text-xs text-[#7ed6a3]">{promoSuccess}</p>}
          </div>

          {/* Owned Cosmetics Collection */}
          <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce]">
                {lang === 'ru'
                  ? `Мой инвентарь (${profile.inventory?.length || 0})`
                  : `My Inventory (${profile.inventory?.length || 0})`}
              </h2>
            </div>

            {!profile.inventory || profile.inventory.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-xs text-[#736c64]">
                  {lang === 'ru'
                    ? 'В инвентаре пока пусто. Загляните в магазин XP за шилдами, фонами и рамками.'
                    : 'Your inventory is empty. Visit the XP Shop for shields, banners, and frames.'}
                </p>
                <button
                  type="button"
                  onClick={() => setIsShopOpen(true)}
                  className="px-4 py-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-xs font-mono uppercase tracking-wider text-white cursor-pointer"
                >
                  {lang === 'ru' ? 'Перейти в магазин' : 'Open XP Shop'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {profile.inventory.map((item: any) => {
                  const rarityMeta = RARITY_CONFIG[item.rarity as keyof typeof RARITY_CONFIG] || RARITY_CONFIG.common;
                  const catMeta = CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS];
                  const equipped = Boolean(item.is_equipped);
                  return (
                    <div
                      key={item.id}
                      className={`rounded-md border p-3 flex flex-col justify-between gap-2.5 ${
                        equipped ? 'border-[#c96075]/50 bg-[#17121a]' : 'border-white/[0.07] bg-[#131218]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] uppercase text-[#8e877e]">
                            {catMeta ? (lang === 'ru' ? catMeta.ru : catMeta.en) : item.category}
                          </span>
                          <span className={`font-mono text-[10px] ${rarityMeta.textClass}`}>
                            {lang === 'ru' ? rarityMeta.labelRu : rarityMeta.labelEn}
                          </span>
                        </div>
                        <div className="text-xs font-medium text-[#f2eee9]">
                          {lang === 'ru' ? item.name_ru : item.name_en}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={equipLoadingId === item.item_id}
                        onClick={() => handleInventoryEquip(item.item_id, equipped)}
                        className={`w-full py-1.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                          equipped
                            ? 'bg-[#2a151c] border border-[#821c2c]/60 text-[#f2b8c3] hover:bg-[#381b25]'
                            : 'bg-white/[0.07] border border-white/[0.1] text-[#ded8ce] hover:bg-white/[0.13]'
                        }`}
                      >
                        {equipLoadingId === item.item_id
                          ? '...'
                          : equipped
                            ? lang === 'ru'
                              ? 'Снять'
                              : 'Unequip'
                            : lang === 'ru'
                              ? 'Надеть'
                              : 'Equip'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: НАСТРОЙКИ И ПРИВАТНОСТЬ (OWNER ONLY) */}
      {activeTab === 'settings' && isOwnProfile && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT: PRIVACY SETTINGS */}
          <div className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 sm:p-5 space-y-4">
            <div className="space-y-1">
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-[#c96075]" />
                {lang === 'ru' ? 'Приватность профиля' : 'Profile Privacy'}
              </h2>
              <p className="text-xs text-[#8e877e]">
                {lang === 'ru'
                  ? `Скрытые разделы будут отображаться другим участникам как «${profile.nickname} скрыл».`
                  : `Hidden sections appear to other visitors as «${profile.nickname} скрыл».`}
              </p>
            </div>

            <div className="space-y-2.5">
              {(
                [
                  {
                    key: 'hide_community' as const,
                    title: lang === 'ru' ? 'Скрыть вкладку «Сообщество»' : 'Hide «Community» tab',
                    desc:
                      lang === 'ru'
                        ? 'Скрывает ваши ответы, прочитанные и созданные темы, а также творчество'
                        : 'Hides your replies, read topics, created topics, and creations',
                  },
                  {
                    key: 'hide_streak' as const,
                    title: lang === 'ru' ? 'Скрыть вин-стрик' : 'Hide daily streak',
                    desc:
                      lang === 'ru'
                        ? 'Скрывает текущую серию дней и множитель бонуса XP от других'
                        : 'Hides your daily streak count and XP bonus from visitors',
                  },
                  {
                    key: 'hide_xp_history' as const,
                    title: lang === 'ru' ? 'Скрыть историю XP' : 'Hide XP history',
                    desc:
                      lang === 'ru'
                        ? 'Включено по умолчанию — ваши начисления и покупки видите только вы'
                        : 'Enabled by default — only you can view XP transactions',
                  },
                  {
                    key: 'hide_game_stats' as const,
                    title: lang === 'ru' ? 'Скрыть подробную игровую статистику' : 'Hide detailed game stats',
                    desc:
                      lang === 'ru'
                        ? 'Скрывает статистику игр, побед в «Угадай трек» и викторинах'
                        : 'Hides total games played, wins, and quiz stats',
                  },
                ]
              ).map((item) => {
                const checked = Boolean(privacyForm[item.key]);
                return (
                  <label
                    key={item.key}
                    className="flex items-start justify-between gap-3 rounded-md border border-white/[0.07] bg-[#131218] p-3 cursor-pointer hover:border-white/[0.15] transition-colors"
                  >
                    <div className="space-y-0.5 pr-2">
                      <div className="text-xs font-medium text-[#f2eee9]">{item.title}</div>
                      <div className="text-[11px] text-[#736c64] leading-snug">{item.desc}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      onClick={() =>
                        setPrivacyForm((prev) => ({
                          ...prev,
                          [item.key]: !prev[item.key],
                        }))
                      }
                      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 cursor-pointer ${
                        checked ? 'bg-[#821c2c]' : 'bg-white/[0.12]'
                      }`}
                    >
                      <span
                        className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                          checked ? 'translate-x-5.5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </label>
                );
              })}
            </div>

            {privacyMsg && (
              <p className={`text-xs ${privacyMsg.type === 'ok' ? 'text-[#7ed6a3]' : 'text-[#e28593]'}`}>
                {privacyMsg.text}
              </p>
            )}

            <button
              type="button"
              onClick={handleSavePrivacy}
              disabled={privacySaving}
              className="w-full py-2.5 rounded-md bg-[#f2eee9] hover:bg-white disabled:opacity-50 text-[#09090b] text-xs font-mono uppercase tracking-wider font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {privacySaving
                ? lang === 'ru'
                  ? 'Сохранение...'
                  : 'Saving...'
                : lang === 'ru'
                  ? 'Сохранить приватность'
                  : 'Save Privacy'}
            </button>

            {/* Email Verification Box */}
            <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider text-[#ded8ce] flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#8e877e]" />
                  {lang === 'ru' ? 'Почта аккаунта' : 'Account Email'}
                </span>
                {profile.email_verified ? (
                  <span className="font-mono text-[10px] text-[#7ed6a3] flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {lang === 'ru' ? 'Подтверждена' : 'Verified'}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-[#d4af68]">
                    {lang === 'ru' ? 'Не подтверждена' : 'Unverified'}
                  </span>
                )}
              </div>

              {!profile.email_verified ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={verifyEmailInput}
                      onChange={(e) => setVerifyEmailInput(e.target.value)}
                      placeholder="name@example.com"
                      className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-xs text-[#f2eee9] focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="button"
                      disabled={verifySending || !verifyEmailInput.trim()}
                      onClick={handleSendVerifyEmailCode}
                      className="px-3 py-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-[11px] font-mono text-[#f2eee9] cursor-pointer disabled:opacity-40 shrink-0"
                    >
                      {verifySending ? '...' : lang === 'ru' ? 'Код' : 'Send'}
                    </button>
                  </div>

                  {verifyToken && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={verifyCodeInput}
                        onChange={(e) => setVerifyCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-значный код"
                        className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-xs font-mono tracking-widest text-[#f2eee9] focus:outline-none focus:border-white/30"
                      />
                      <button
                        type="button"
                        disabled={verifyConfirming || verifyCodeInput.length !== 6}
                        onClick={handleConfirmVerifyEmail}
                        className="px-3 py-2 rounded-md bg-[#f2eee9] hover:bg-white text-[#09090b] text-[11px] font-mono uppercase font-medium cursor-pointer disabled:opacity-40 shrink-0"
                      >
                        {verifyConfirming ? '...' : lang === 'ru' ? 'Ок' : 'Verify'}
                      </button>
                    </div>
                  )}

                  {verifyMsg && (
                    <p className={`text-xs ${verifyMsg.type === 'ok' ? 'text-[#7ed6a3]' : 'text-[#e28593]'}`}>
                      {verifyMsg.text}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#8e877e] font-mono">{profile.email}</p>
              )}
            </div>

            {/* Notification Preferences + Browser Notifications Box */}
            <div className="pt-4 border-t border-white/[0.07] space-y-3">
              <div className="space-y-0.5">
                <span className="font-mono text-xs uppercase tracking-wider text-[#ded8ce] flex items-center gap-1.5">
                  <BellRing className="w-3.5 h-3.5 text-[#c96075]" />
                  {lang === 'ru' ? 'Уведомления' : 'Notifications'}
                </span>
                <p className="text-[11px] text-[#736c64] leading-snug">
                  {lang === 'ru'
                    ? 'Выберите, какие оповещения приходят в колокольчик на сайте.'
                    : 'Choose which alerts appear in your notification bell.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-start justify-between gap-3 rounded-md border border-white/[0.07] bg-[#131218] p-3 cursor-pointer hover:border-white/[0.15] transition-colors">
                  <div className="space-y-0.5 pr-2">
                    <div className="text-xs font-medium text-[#f2eee9]">
                      {lang === 'ru' ? 'Уведомления от подписок' : 'Subscription Alerts'}
                    </div>
                    <div className="text-[11px] text-[#736c64] leading-snug">
                      {lang === 'ru'
                        ? 'Оповещать о новых темах, работах, мемах и комментариях от тех, на кого вы подписаны'
                        : 'Notify on new topics, creations, memes, and comments from authors you follow'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifyFollows}
                    disabled={notifPrefSaving === 'follows'}
                    onClick={() => handleToggleNotificationPref('follows')}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 cursor-pointer disabled:opacity-50 ${
                      notifyFollows ? 'bg-[#821c2c]' : 'bg-white/[0.12]'
                    }`}
                  >
                    <span
                      className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        notifyFollows ? 'translate-x-5.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </label>

                <label className="flex items-start justify-between gap-3 rounded-md border border-white/[0.07] bg-[#131218] p-3 cursor-pointer hover:border-white/[0.15] transition-colors">
                  <div className="space-y-0.5 pr-2">
                    <div className="text-xs font-medium text-[#f2eee9]">
                      {lang === 'ru' ? 'Новости и обновления сайта' : 'Site News & Updates'}
                    </div>
                    <div className="text-[11px] text-[#736c64] leading-snug">
                      {lang === 'ru'
                        ? 'Получать важные объявления от администрации (выключено по умолчанию)'
                        : 'Receive official announcements and platform updates (off by default)'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notifyNews}
                    disabled={notifPrefSaving === 'news'}
                    onClick={() => handleToggleNotificationPref('news')}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 cursor-pointer disabled:opacity-50 ${
                      notifyNews ? 'bg-[#821c2c]' : 'bg-white/[0.12]'
                    }`}
                  >
                    <span
                      className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                        notifyNews ? 'translate-x-5.5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </label>
              </div>

              {notifPrefMsg && (
                <p className={`text-xs ${notifPrefMsg.type === 'ok' ? 'text-[#7ed6a3]' : 'text-[#e28593]'}`}>
                  {notifPrefMsg.text}
                </p>
              )}

              <BrowserNotificationsControl />
            </div>
          </div>

          {/* RIGHT: PROFILE DETAILS EDIT */}
          <form
            onSubmit={handleSaveProfileSettings}
            className="rounded-lg border border-white/[0.08] bg-[#0e0d12] p-4 sm:p-5 space-y-3.5"
          >
            <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-[#ded8ce] flex items-center gap-2">
              <Settings className="w-3.5 h-3.5 text-[#8e877e]" />
              {lang === 'ru' ? 'Данные профиля' : 'Profile Details'}
            </h2>

            {/* Avatar Upload Row */}
            <div className="flex items-center gap-3.5">
              <img
                src={editAvatar || DEFAULT_AVATAR}
                alt="Avatar preview"
                loading="lazy"
                className="w-14 h-14 rounded-full object-cover border border-white/[0.14] bg-[#14131a] shrink-0"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR;
                }}
              />
              <div className="flex-1 space-y-1.5">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={avatarUploading}
                    onClick={() => avatarInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-xs font-mono text-[#f2eee9] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {avatarUploading
                      ? lang === 'ru'
                        ? 'Загрузка...'
                        : 'Uploading...'
                      : lang === 'ru'
                        ? 'Загрузить аватар'
                        : 'Upload Avatar'}
                  </button>
                  {editAvatar !== DEFAULT_AVATAR && (
                    <button
                      type="button"
                      onClick={() => setEditAvatar(DEFAULT_AVATAR)}
                      className="p-1.5 rounded text-[#736c64] hover:text-white cursor-pointer"
                      title={lang === 'ru' ? 'Сбросить аватар' : 'Reset avatar'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#736c64]">JPG, PNG, WEBP, GIF</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-[#8e877e]">
                {lang === 'ru' ? 'Отображаемое имя' : 'Display Name'}
              </label>
              <input
                type="text"
                maxLength={36}
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-sm text-[#f2eee9] focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="font-mono text-[10px] uppercase tracking-wider text-[#8e877e]">
                  @username
                </label>
                {profile.username_change_allowed === false && (
                  <span className="font-mono text-[10px] text-[#d4af68]">
                    {lang === 'ru'
                      ? `Смена через ${profile.username_cooldown_days} дн.`
                      : `Cooldown: ${profile.username_cooldown_days}d`}
                  </span>
                )}
              </div>
              <input
                type="text"
                maxLength={20}
                disabled={profile.username_change_allowed === false || String(profile.nickname).toLowerCase() === 'sushkanov097'}
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-sm font-mono text-[#f2eee9] disabled:opacity-50 focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-[#8e877e]">
                {lang === 'ru' ? 'Короткий статус' : 'Status'}
              </label>
              <input
                type="text"
                maxLength={120}
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                placeholder={lang === 'ru' ? 'Например: слушаю nightmortan' : 'e.g. listening to nightmortan'}
                className="w-full px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-sm text-[#f2eee9] placeholder:text-[#57514b] focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-[#8e877e]">
                {lang === 'ru' ? 'Любимый трек (для карточки профиля)' : 'Favorite Track (for share card)'}
              </label>
              <input
                type="text"
                maxLength={100}
                value={editFavoriteTrack}
                onChange={(e) => setEditFavoriteTrack(e.target.value)}
                placeholder={lang === 'ru' ? 'Например: я останусь тут' : 'e.g. nightmortan'}
                className="w-full px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-sm text-[#f2eee9] placeholder:text-[#57514b] focus:outline-none focus:border-white/30"
              />
            </div>

            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-[#8e877e]">
                {lang === 'ru' ? 'О себе' : 'Bio'}
              </label>
              <textarea
                rows={3}
                maxLength={500}
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder={lang === 'ru' ? 'Расскажите немного о себе...' : 'Tell something about yourself...'}
                className="w-full px-3 py-2 rounded-md bg-[#14131a] border border-white/[0.1] text-sm text-[#f2eee9] placeholder:text-[#57514b] focus:outline-none focus:border-white/30 resize-none"
              />
            </div>

            {settingsMsg && (
              <p className={`text-xs ${settingsMsg.type === 'ok' ? 'text-[#7ed6a3]' : 'text-[#e28593]'}`}>
                {settingsMsg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={settingsSaving}
              className="w-full py-2.5 rounded-md bg-[#f2eee9] hover:bg-white disabled:opacity-50 text-[#09090b] text-xs font-mono uppercase tracking-wider font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {settingsSaving
                ? lang === 'ru'
                  ? 'Сохранение...'
                  : 'Saving...'
                : lang === 'ru'
                  ? 'Сохранить профиль'
                  : 'Save Profile'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
