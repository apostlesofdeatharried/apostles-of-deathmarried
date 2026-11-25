import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  X,
  Upload,
  RotateCcw,
  Key,
  Save,
  Award,
  Package,
  Sparkles,
  Shield,
  Sliders,
  Eye,
  EyeOff,
  Check,
  Lock,
} from 'lucide-react';
import { authFetch } from '../../context/AuthContext.js';
import {
  calculateLevelFromXp,
  safeJson,
  parsePrivacySettings,
  buildCustomShieldValue,
  type PrivacySettings,
} from '../../utils/logic.js';
import { prepareAndUploadMedia } from '../../utils/mediaCompression.js';
import {
  formatHandle,
  RARITY_CONFIG,
  CATEGORY_LABELS,
  renderEquippedTitle,
} from '../../utils/cosmetics.js';
import { ItemRarity, ShopCategory } from '../../types/index.js';

export interface AdminUserDetailsPayload {
  user: any;
  achievements: any[];
  items: any[];
  cycle_id?: string;
  cycle_completions?: Array<{
    game_type: string;
    is_correct: number;
    score: number;
    xp_earned: number;
    created_at: string;
  }>;
}

interface Props {
  details: AdminUserDetailsPayload;
  currentAdminId: string;
  lang: 'ru' | 'en';
  onClose: () => void;
  onReloadDetails: (userId: string) => Promise<void>;
  onSaved: (meta?: { userId?: string; token?: string }) => Promise<void> | void;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}

const DEFAULT_AVATAR = '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg';

const GAME_LABELS: Record<string, { ru: string; en: string }> = {
  'guess-track': { ru: 'Угадай трек', en: 'Guess Track' },
  'daily-quiz': { ru: 'Викторина дня', en: 'Daily Quiz' },
  'guess-lyrics': { ru: 'Угадай строчку', en: 'Guess Lyrics' },
  'reverse-track': { ru: 'Реверс трека', en: 'Reverse Track' },
  'speed-track': { ru: '0.5x / 2.5x', en: '0.5x / 2.5x' },
};

export const AdminUserEditorModal: React.FC<Props> = ({
  details,
  currentAdminId,
  lang,
  onClose,
  onReloadDetails,
  onSaved,
  onNotify,
  onError,
}) => {
  const u = details.user;
  const isMaster =
    String(u.nickname || '').toLowerCase() === 'sushkanov097' ||
    String(u.email || '').toLowerCase() === 'sushkanov097@gmail.com';
  const isSelf = u.id === currentAdminId;

  const [tab, setTab] = useState<'profile' | 'progress' | 'achievements' | 'items'>('profile');

  // Profile & Auth fields
  const [nickname, setNickname] = useState(u.nickname || '');
  const [displayName, setDisplayName] = useState(u.display_name || u.nickname || '');
  const [email, setEmail] = useState(u.email || '');
  const [emailVerified, setEmailVerified] = useState(Boolean(u.email_verified));
  const [acceptedRules, setAcceptedRules] = useState(Boolean(u.accepted_rules));
  const [roleId, setRoleId] = useState(u.role_id || 'user');
  const [isBanned, setIsBanned] = useState(Boolean(u.is_banned));
  const [banReason, setBanReason] = useState(u.ban_reason || '');
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(u.avatar_url || '');
  const [bio, setBio] = useState(u.bio || '');
  const [customStatus, setCustomStatus] = useState(u.custom_status || '');
  const [favoriteTrack, setFavoriteTrack] = useState(u.favorite_track || '');
  const [isPrivate, setIsPrivate] = useState(Boolean(u.is_private));
  const [notifyFollows, setNotifyFollows] = useState(u.notify_follows !== 0);
  const [notifyNews, setNotifyNews] = useState(Boolean(u.notify_news));
  const [privacy, setPrivacy] = useState<PrivacySettings>(() => parsePrivacySettings(u.privacy_settings));

  // Progress & XP fields
  const [totalXp, setTotalXp] = useState(String(u.total_xp ?? u.xp ?? 0));
  const [spendableXp, setSpendableXp] = useState(String(u.xp ?? 0));
  const [manualLevel, setManualLevel] = useState(String(u.level || 1));
  const [autoRecalcLevel, setAutoRecalcLevel] = useState(true);
  const [dailyStreak, setDailyStreak] = useState(String(u.daily_streak ?? 0));

  // Actions state
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [resettingCycle, setResettingCycle] = useState(false);
  const [adjustAchXp, setAdjustAchXp] = useState(true);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [achFilter, setAchFilter] = useState<'all' | 'unlocked' | 'secret'>('all');
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('all');

  // Custom Shield inline creator
  const [csLabelRu, setCsLabelRu] = useState('');
  const [csLabelEn, setCsLabelEn] = useState('');
  const [csRarity, setCsRarity] = useState<ItemRarity>('legendary');
  const [csBg, setCsBg] = useState('#240e18');
  const [csBorder, setCsBorder] = useState('#a8364d');
  const [csText, setCsText] = useState('#f8d0d8');
  const [csGlow, setCsGlow] = useState('#821c2c');
  const [csAddToShop, setCsAddToShop] = useState(false);
  const [csCostXp, setCsCostXp] = useState('1500');
  const [creatingShield, setCreatingShield] = useState(false);

  const avatarFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cur = details.user;
    setNickname(cur.nickname || '');
    setDisplayName(cur.display_name || cur.nickname || '');
    setEmail(cur.email || '');
    setEmailVerified(Boolean(cur.email_verified));
    setAcceptedRules(Boolean(cur.accepted_rules));
    setRoleId(cur.role_id || 'user');
    setIsBanned(Boolean(cur.is_banned));
    setBanReason(cur.ban_reason || '');
    setAvatarUrl(cur.avatar_url || '');
    setBio(cur.bio || '');
    setCustomStatus(cur.custom_status || '');
    setFavoriteTrack(cur.favorite_track || '');
    setIsPrivate(Boolean(cur.is_private));
    setNotifyFollows(cur.notify_follows !== 0);
    setNotifyNews(Boolean(cur.notify_news));
    setPrivacy(parsePrivacySettings(cur.privacy_settings));
    setTotalXp(String(cur.total_xp ?? cur.xp ?? 0));
    setSpendableXp(String(cur.xp ?? 0));
    setManualLevel(String(cur.level || 1));
    setDailyStreak(String(cur.daily_streak ?? 0));
  }, [details]);

  const parsedTotalXp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const computedLevel = calculateLevelFromXp(parsedTotalXp).level;

  const handleUploadAvatar = async (file: File) => {
    setUploadingAvatar(true);
    try {
      const uploaded = await prepareAndUploadMedia(file, {
        imageMode: 'avatar',
        authFetch,
        lang,
        allowAudio: false,
        allowImage: true,
        allowVideo: false,
      });
      setAvatarUrl(uploaded.url);
      onNotify(
        lang === 'ru'
          ? 'Аватар сжат в WebP и загружен. Нажмите «Сохранить изменения».'
          : 'Avatar uploaded as WebP. Click Save Changes to apply.'
      );
    } catch (err: any) {
      onError(err?.message || (lang === 'ru' ? 'Ошибка загрузки аватара' : 'Avatar upload failed'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveFull = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        display_name: displayName.trim(),
        email: email.trim(),
        email_verified: emailVerified,
        accepted_rules: acceptedRules,
        role_id: roleId,
        is_banned: isBanned,
        ban_reason: banReason.trim(),
        avatar_url: avatarUrl.trim(),
        bio,
        custom_status: customStatus,
        favorite_track: favoriteTrack.trim(),
        is_private: isPrivate,
        notify_follows: notifyFollows,
        notify_news: notifyNews,
        privacy_settings: privacy,
        total_xp: parsedTotalXp,
        xp: Math.max(0, Math.floor(Number(spendableXp) || 0)),
        auto_recalc_level: autoRecalcLevel,
        level: autoRecalcLevel ? computedLevel : Math.max(1, Math.floor(Number(manualLevel) || 1)),
        daily_streak: Math.max(0, Math.floor(Number(dailyStreak) || 0)),
      };
      if (!isMaster && nickname.trim()) {
        payload.nickname = nickname.trim();
      }
      if (newPassword.trim()) {
        payload.new_password = newPassword;
      }

      const res = await authFetch(`/api/admin/users/${u.id}/full`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson<{ ok?: boolean; token?: string; error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || (lang === 'ru' ? 'Не удалось сохранить профиль' : 'Failed to save user'));
        return;
      }

      setNewPassword('');
      onNotify(lang === 'ru' ? 'Профиль и прогресс пользователя сохранены' : 'User profile & progress saved');
      await onSaved({ userId: u.id, token: data.token });
      await onReloadDetails(u.id);
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetCycle = async () => {
    if (resettingCycle) return;
    setResettingCycle(true);
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/reset-cycle`, { method: 'POST' });
      const data = await safeJson<{ ok?: boolean; cleared?: number; error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || (lang === 'ru' ? 'Не удалось сбросить цикл игр' : 'Failed to reset cycle'));
        return;
      }
      onNotify(
        lang === 'ru'
          ? `Блокировка игр текущего цикла снята (очищено записей: ${data.cleared ?? 0})`
          : `Current 12h cycle locks cleared (${data.cleared ?? 0})`
      );
      await onReloadDetails(u.id);
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setResettingCycle(false);
    }
  };

  const handleToggleAchievement = async (achId: string, currentlyUnlocked: boolean) => {
    setBusyAssetId(achId);
    try {
      const action = currentlyUnlocked ? 'revoke' : 'grant';
      const res = await authFetch(`/api/admin/users/${u.id}/achievements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          achievement_id: achId,
          action,
          adjust_xp: adjustAchXp,
        }),
      });
      const data = await safeJson<{ ok?: boolean; xp_changed?: number; error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to update achievement');
        return;
      }
      const xpSuffix =
        data.xp_changed && data.xp_changed !== 0
          ? ` (${data.xp_changed > 0 ? '+' : ''}${data.xp_changed} XP)`
          : '';
      onNotify(
        (action === 'grant'
          ? lang === 'ru'
            ? 'Достижение выдано'
            : 'Achievement granted'
          : lang === 'ru'
            ? 'Достижение отозвано'
            : 'Achievement revoked') + xpSuffix
      );
      await onReloadDetails(u.id);
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleToggleItem = async (itemId: string, currentlyOwned: boolean) => {
    setBusyAssetId(itemId);
    try {
      const action = currentlyOwned ? 'revoke' : 'grant';
      const res = await authFetch(`/api/admin/users/${u.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, action }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to update item');
        return;
      }
      onNotify(
        action === 'grant'
          ? lang === 'ru'
            ? 'Предмет выдан в коллекцию'
            : 'Item granted'
          : lang === 'ru'
            ? 'Предмет отозван'
            : 'Item revoked'
      );
      await onReloadDetails(u.id);
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleEquipItem = async (itemId: string, currentlyEquipped: boolean) => {
    setBusyAssetId(itemId);
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, equip: !currentlyEquipped }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to change equip state');
        return;
      }
      onNotify(
        !currentlyEquipped
          ? lang === 'ru'
            ? 'Предмет принудительно надет'
            : 'Item equipped'
          : lang === 'ru'
            ? 'Предмет снят'
            : 'Item unequipped'
      );
      await onReloadDetails(u.id);
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleClearCategorySlot = async (category: ShopCategory) => {
    setBusyAssetId(`clear_${category}`);
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, equip: false }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to clear slot');
        return;
      }
      onNotify(lang === 'ru' ? 'Слот кастомизации очищен' : 'Slot cleared');
      await onReloadDetails(u.id);
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleCreateCustomShield = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingShield || !csLabelRu.trim()) return;
    setCreatingShield(true);
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/custom-shield`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label_ru: csLabelRu.trim(),
          label_en: csLabelEn.trim() || csLabelRu.trim(),
          bg: csBg,
          border: csBorder,
          text: csText,
          glow: csGlow,
          rarity: csRarity,
          add_to_shop: csAddToShop,
          cost_xp: csAddToShop ? Math.max(0, Number(csCostXp) || 0) : 0,
        }),
      });
      const data = await safeJson<{ ok?: boolean; error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to create custom shield');
        return;
      }
      setCsLabelRu('');
      setCsLabelEn('');
      onNotify(
        lang === 'ru'
          ? 'Уникальный шилд создан, выдан и надет на профиль'
          : 'Custom shield created and equipped'
      );
      await onReloadDetails(u.id);
      await onSaved();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setCreatingShield(false);
    }
  };

  const shieldPreviewVal = buildCustomShieldValue({
    ru: csLabelRu.trim() || 'уникальный шилд',
    en: csLabelEn.trim() || csLabelRu.trim() || 'custom shield',
    bg: csBg,
    border: csBorder,
    text: csText,
    glow: csGlow,
  });

  const filteredAchievements = details.achievements.filter((a) => {
    if (achFilter === 'unlocked') return Boolean(a.is_unlocked);
    if (achFilter === 'secret') return Boolean(a.is_secret);
    return true;
  });

  const filteredItems = details.items.filter((it) => {
    if (itemCategoryFilter !== 'all' && it.category !== itemCategoryFilter) return false;
    return true;
  });

  const unlockedCount = details.achievements.filter((a) => a.is_unlocked).length;
  const ownedCount = details.items.filter((i) => i.is_owned).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="relative w-full max-w-4xl max-h-[92dvh] bg-[#121016] border border-white/15 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-[#16131c]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full bg-[#221d2b] border border-white/15 flex items-center justify-center font-title text-lg text-ivory uppercase overflow-hidden shrink-0">
              <img
                src={avatarUrl || DEFAULT_AVATAR}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-serif text-lg sm:text-xl text-ivory truncate">
                  {displayName || nickname}
                </h3>
                {isMaster && (
                  <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#821c2c]/40 text-[#f5c6cb] border border-[#821c2c]">
                    Master
                  </span>
                )}
                {isSelf && (
                  <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/10 text-bone">
                    {lang === 'ru' ? 'Вы' : 'You'}
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-ash/75 flex flex-wrap items-center gap-2">
                <span>{formatHandle(u.nickname)}</span>
                <span>·</span>
                <span className="truncate max-w-[200px]">{u.email || '—'}</span>
                <span>·</span>
                <span className="uppercase text-bone">{u.role_id}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ash hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Sub-tabs */}
        <div className="px-4 sm:px-5 pt-2.5 border-b border-white/[0.06] flex items-center gap-1.5 bg-[#141219] overflow-x-auto no-scrollbar">
          {[
            { id: 'profile' as const, label: lang === 'ru' ? 'Профиль и доступ' : 'Profile & Access', icon: Sliders },
            { id: 'progress' as const, label: lang === 'ru' ? 'Прогресс и циклы' : 'XP & Cycles', icon: Sparkles },
            {
              id: 'achievements' as const,
              label: `${lang === 'ru' ? 'Достижения' : 'Achievements'} (${unlockedCount}/${details.achievements.length})`,
              icon: Award,
            },
            {
              id: 'items' as const,
              label: `${lang === 'ru' ? 'Магазин и Шилды' : 'Shop & Shields'} (${ownedCount}/${details.items.length})`,
              icon: Package,
            },
          ].map((tItem) => {
            const Icon = tItem.icon;
            return (
              <button
                key={tItem.id}
                type="button"
                onClick={() => setTab(tItem.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider border-b-2 transition-colors cursor-pointer shrink-0 ${
                  tab === tItem.id
                    ? 'border-[#821c2c] text-ivory'
                    : 'border-transparent text-ash hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tItem.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-5">
          {/* TAB 1 & TAB 2 share the same Save form */}
          {(tab === 'profile' || tab === 'progress') && (
            <form onSubmit={handleSaveFull} className="space-y-5 text-xs font-sans">
              {tab === 'profile' && (
                <>
                  {/* Avatar block */}
                  <div className="p-4 rounded-xl bg-[#17141d] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <img
                        src={avatarUrl || DEFAULT_AVATAR}
                        alt=""
                        loading="lazy"
                        className="w-16 h-16 rounded-full object-cover border border-white/15 shrink-0 bg-black"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-bone">
                          {lang === 'ru' ? 'Аватар профиля (WebP)' : 'Profile Avatar (WebP)'}
                        </div>
                        <div className="font-mono text-[10px] text-ash/70 truncate max-w-[260px]">
                          {avatarUrl || DEFAULT_AVATAR}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0 font-mono text-[10px] uppercase">
                      <input
                        ref={avatarFileRef}
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleUploadAvatar(f);
                        }}
                      />
                      <button
                        type="button"
                        disabled={uploadingAvatar}
                        onClick={() => avatarFileRef.current?.click()}
                        className="px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-white cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{uploadingAvatar ? (lang === 'ru' ? 'Загрузка...' : 'Uploading...') : (lang === 'ru' ? 'Загрузить фото' : 'Upload Photo')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAvatarUrl('')}
                        className="px-3 py-2 rounded-lg bg-[#1c1620] hover:bg-red-950/60 border border-white/10 hover:border-red-800/70 text-ash hover:text-red-300 cursor-pointer flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{lang === 'ru' ? 'Сбросить' : 'Reset'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Identity & Credentials */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        @username {isMaster && <span className="text-[#c49298]">({lang === 'ru' ? 'защищён' : 'protected'})</span>}
                      </label>
                      <input
                        type="text"
                        value={nickname}
                        disabled={isMaster}
                        onChange={(e) => setNickname(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none focus:border-[#821c2c] disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Отображаемое имя' : 'Display Name'}
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-[#821c2c]"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none focus:border-[#821c2c]"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Роль' : 'Role'}
                      </label>
                      <select
                        value={roleId}
                        disabled={isMaster || isSelf}
                        onChange={(e) => setRoleId(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none disabled:opacity-50"
                      >
                        <option value="user">user</option>
                        <option value="moderator">moderator</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                  </div>

                  {/* Bio, Status, Favorite track, New Password */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Кастомный статус' : 'Custom Status'}
                      </label>
                      <input
                        type="text"
                        maxLength={120}
                        value={customStatus}
                        onChange={(e) => setCustomStatus(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Любимый трек (ID / название)' : 'Favorite Track'}
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={favoriteTrack}
                        onChange={(e) => setFavoriteTrack(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                      {lang === 'ru' ? 'О себе (Bio)' : 'Bio'}
                    </label>
                    <textarea
                      rows={2}
                      maxLength={500}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none resize-none"
                    />
                  </div>

                  {/* New Password (bcrypt) */}
                  {(!isMaster || isSelf) && (
                    <div className="p-3.5 rounded-lg bg-[#17141d] border border-amber-800/40 space-y-2">
                      <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-200">
                        <Key className="w-3.5 h-3.5" />
                        <span>{lang === 'ru' ? 'Сменить пароль (необязательно, мин. 8 символов)' : 'Reset Password (optional, min 8 chars)'}</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          autoComplete="new-password"
                          placeholder={lang === 'ru' ? 'Оставьте пустым, чтобы не менять пароль' : 'Leave blank to keep existing password'}
                          className="w-full px-3 py-2 pr-9 bg-[#121016] border border-white/10 rounded-lg text-white font-mono focus:outline-none focus:border-amber-600"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ash hover:text-white cursor-pointer"
                        >
                          {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Flags, Ban & Privacy */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3.5 rounded-lg bg-[#17141d] border border-white/[0.06] space-y-2.5">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-bone">
                        {lang === 'ru' ? 'Статус аккаунта и уведомления' : 'Account Flags & Notifications'}
                      </div>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={emailVerified}
                          onChange={(e) => setEmailVerified(e.target.checked)}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Email подтверждён (email_verified)' : 'Email Verified'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={acceptedRules}
                          onChange={(e) => setAcceptedRules(e.target.checked)}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Правила сообщества приняты' : 'Accepted Community Rules'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifyFollows}
                          onChange={(e) => setNotifyFollows(e.target.checked)}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Уведомления о подписках' : 'Notify Follows'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifyNews}
                          onChange={(e) => setNotifyNews(e.target.checked)}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Рассылка новостей сайта' : 'Site News Subscription'}</span>
                      </label>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#17141d] border border-white/[0.06] space-y-2.5">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-bone">
                        {lang === 'ru' ? 'Приватность профиля' : 'Profile Privacy'}
                      </div>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isPrivate}
                          onChange={(e) => setIsPrivate(e.target.checked)}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Закрытый профиль (is_private)' : 'Private Profile'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={privacy.hide_community}
                          onChange={(e) => setPrivacy((p) => ({ ...p, hide_community: e.target.checked }))}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Скрыть активность в сообществе' : 'Hide community activity'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={privacy.hide_streak}
                          onChange={(e) => setPrivacy((p) => ({ ...p, hide_streak: e.target.checked }))}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Скрыть стрик' : 'Hide streak'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={privacy.hide_xp_history}
                          onChange={(e) => setPrivacy((p) => ({ ...p, hide_xp_history: e.target.checked }))}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Скрыть историю XP' : 'Hide XP history'}</span>
                      </label>
                      <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={privacy.hide_game_stats}
                          onChange={(e) => setPrivacy((p) => ({ ...p, hide_game_stats: e.target.checked }))}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? 'Скрыть статистику игр' : 'Hide game stats'}</span>
                      </label>
                    </div>
                  </div>

                  {/* Ban Controls */}
                  {!isMaster && !isSelf && (
                    <div className="p-3.5 rounded-lg bg-[#1d1216] border border-red-900/40 space-y-2.5">
                      <label className="flex items-center gap-2 text-red-200 font-mono text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBanned}
                          onChange={(e) => setIsBanned(e.target.checked)}
                          className="accent-red-600"
                        />
                        <span>{lang === 'ru' ? 'Аккаунт заблокирован (is_banned)' : 'Account Banned'}</span>
                      </label>
                      {isBanned && (
                        <input
                          type="text"
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                          placeholder={lang === 'ru' ? 'Причина блокировки (опционально)' : 'Ban reason (optional)'}
                          className="w-full px-3 py-2 bg-[#121016] border border-red-900/50 rounded-lg text-white focus:outline-none"
                        />
                      )}
                    </div>
                  )}
                </>
              )}

              {tab === 'progress' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        Total XP
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={totalXp}
                        onChange={(e) => setTotalXp(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none focus:border-[#821c2c]"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Тратящийся баланс XP' : 'Spendable XP'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={spendableXp}
                        onChange={(e) => setSpendableXp(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-amber-300 font-mono focus:outline-none focus:border-[#821c2c]"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Уровень' : 'Level'}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        disabled={autoRecalcLevel}
                        value={autoRecalcLevel ? String(computedLevel) : manualLevel}
                        onChange={(e) => setManualLevel(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none disabled:opacity-60"
                      />
                      <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ash cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoRecalcLevel}
                          onChange={(e) => setAutoRecalcLevel(e.target.checked)}
                          className="accent-[#821c2c]"
                        />
                        <span>{lang === 'ru' ? `Авто из Total XP (L${computedLevel})` : `Auto from Total XP (L${computedLevel})`}</span>
                      </label>
                    </div>
                    <div>
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                        {lang === 'ru' ? 'Стрик (дней)' : 'Daily Streak'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={dailyStreak}
                        onChange={(e) => setDailyStreak(e.target.value)}
                        className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none focus:border-[#821c2c]"
                      />
                    </div>
                  </div>

                  {/* 5 Games Stats Summary */}
                  <div className="p-4 rounded-xl bg-[#17141d] border border-white/[0.07] space-y-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-bone">
                      {lang === 'ru' ? 'Статистика игр пользователя (все 5 режимов)' : 'User Game Statistics (All 5 Modes)'}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono text-xs">
                      <div className="p-2.5 rounded-lg bg-[#121016] border border-white/[0.05]">
                        <div className="text-[10px] text-ash/70">{lang === 'ru' ? 'Всего игр' : 'Total'}</div>
                        <div className="text-ivory text-base mt-0.5">{u.games_played || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#121016] border border-white/[0.05]">
                        <div className="text-[10px] text-ash/70">{lang === 'ru' ? 'Угадай трек' : 'Track'}</div>
                        <div className="text-ivory text-base mt-0.5">{u.guess_track_wins || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#121016] border border-white/[0.05]">
                        <div className="text-[10px] text-ash/70">{lang === 'ru' ? 'Викторина' : 'Quiz'}</div>
                        <div className="text-ivory text-base mt-0.5">{u.quiz_played || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#121016] border border-white/[0.05]">
                        <div className="text-[10px] text-ash/70">{lang === 'ru' ? 'Строчка' : 'Lyrics'}</div>
                        <div className="text-ivory text-base mt-0.5">{u.guess_lyrics_wins || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#121016] border border-white/[0.05]">
                        <div className="text-[10px] text-ash/70">{lang === 'ru' ? 'Реверс' : 'Reverse'}</div>
                        <div className="text-ivory text-base mt-0.5">{u.reverse_track_wins || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#121016] border border-white/[0.05]">
                        <div className="text-[10px] text-ash/70">0.5x / 2.5x</div>
                        <div className="text-ivory text-base mt-0.5">{u.speed_track_wins || 0}</div>
                      </div>
                    </div>
                  </div>

                  {/* Current 12h Cycle Lock Reset */}
                  <div className="p-4 rounded-xl bg-[#191319] border border-[#821c2c]/40 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-mono text-xs uppercase tracking-wider text-ivory flex items-center gap-2">
                          <RotateCcw className="w-4 h-4 text-[#c49298]" />
                          <span>
                            {lang === 'ru'
                              ? `Блокировки текущего 12-часового цикла (${details.cycle_id || '—'})`
                              : `Current 12h Cycle Locks (${details.cycle_id || '—'})`}
                          </span>
                        </div>
                        <p className="text-xs text-ash">
                          {lang === 'ru'
                            ? 'Позволяет игроку повторно пройти все 5 испытаний в текущем цикле без удаления его истории XP.'
                            : 'Allows the player to replay all 5 modes in the active 12h cycle without wiping historical XP.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={resettingCycle}
                        onClick={handleResetCycle}
                        className="px-3.5 py-2 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-white font-mono text-[11px] uppercase tracking-wider cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {resettingCycle
                          ? lang === 'ru' ? 'Сброс...' : 'Resetting...'
                          : lang === 'ru' ? 'Сбросить блокировку игр текущего цикла' : 'Reset Current Cycle Locks'}
                      </button>
                    </div>

                    {details.cycle_completions && details.cycle_completions.length > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-1 font-mono text-[10px]">
                        {details.cycle_completions.map((c, idx) => (
                          <span
                            key={`${c.game_type}-${idx}`}
                            className="px-2.5 py-1 rounded bg-[#121016] border border-white/10 text-bone"
                          >
                            {GAME_LABELS[c.game_type]?.[lang] || c.game_type}: {c.score} pts (+{c.xp_earned} XP)
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] text-ash/60">
                        {lang === 'ru' ? 'В текущем цикле сыгранных игр пока нет.' : 'No completed games in current cycle.'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-white/10 text-ash hover:text-white font-mono text-xs uppercase cursor-pointer"
                >
                  {lang === 'ru' ? 'Закрыть' : 'Close'}
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingAvatar}
                  className="px-5 py-2 rounded-lg bg-[#821c2c] hover:bg-[#962537] border border-[#a83145] text-white font-mono text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? (lang === 'ru' ? 'Сохранение...' : 'Saving...') : (lang === 'ru' ? 'Сохранить изменения' : 'Save Changes')}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: ACHIEVEMENTS (WITH SECRET UNMASKING & XP TOGGLE) */}
          {tab === 'achievements' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#17141d] border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-ivory cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adjustAchXp}
                    onChange={(e) => setAdjustAchXp(e.target.checked)}
                    className="accent-[#821c2c]"
                  />
                  <span>
                    {lang === 'ru'
                      ? 'Начислять / вычитать XP награду при выдаче или отзыве'
                      : 'Adjust XP reward when granting or revoking'}
                  </span>
                </label>

                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase">
                  {([
                    { id: 'all', label: lang === 'ru' ? 'Все' : 'All' },
                    { id: 'unlocked', label: lang === 'ru' ? 'Открытые' : 'Unlocked' },
                    { id: 'secret', label: lang === 'ru' ? 'Секретные' : 'Secret' },
                  ] as const).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setAchFilter(f.id)}
                      className={`px-2.5 py-1 rounded border cursor-pointer ${
                        achFilter === f.id
                          ? 'bg-[#821c2c]/35 border-[#821c2c] text-white'
                          : 'border-white/10 text-ash hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredAchievements.map((ach) => {
                  const rCfg = RARITY_CONFIG[ach.rarity as ItemRarity] || RARITY_CONFIG.common;
                  return (
                    <div
                      key={ach.id}
                      className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${
                        ach.is_unlocked
                          ? 'bg-[#1a1622] border-[#821c2c]/50'
                          : 'bg-[#15131a] border-white/[0.06] opacity-85'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Award className={`w-3.5 h-3.5 shrink-0 ${ach.is_unlocked ? 'text-amber-300' : 'text-ash/50'}`} />
                          <span className="font-sans text-xs text-ivory font-medium">
                            {lang === 'ru' ? ach.title_ru : ach.title_en}
                          </span>
                          {ach.is_secret && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-200 font-mono text-[9px] uppercase">
                              <Lock className="w-2.5 h-2.5" />
                              <span>{lang === 'ru' ? 'Секретное' : 'Secret'}</span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-ash/80 leading-snug">
                          {lang === 'ru' ? ach.desc_ru : ach.desc_en}
                        </div>
                        {(ach.condition_ru || ach.condition_en) && (
                          <div className="font-mono text-[10px] text-ash/60">
                            {lang === 'ru' ? ach.condition_ru : ach.condition_en}
                          </div>
                        )}
                        <div className="font-mono text-[10px] flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span
                            className={`px-1.5 py-0.5 rounded border ${
                              ach.difficulty_tier === 'hard'
                                ? 'border-[#d4af68]/35 bg-[#221b11] text-[#f0c784]'
                                : ach.difficulty_tier === 'medium'
                                  ? 'border-[#4d7cb8]/40 bg-[#111927] text-[#9ac2f2]'
                                  : 'border-white/[0.12] bg-white/[0.04] text-[#b5aea4]'
                            }`}
                          >
                            {ach.difficulty_tier === 'hard'
                              ? lang === 'ru'
                                ? 'Сложное'
                                : 'Hard'
                              : ach.difficulty_tier === 'medium'
                                ? lang === 'ru'
                                  ? 'Среднее'
                                  : 'Medium'
                                : lang === 'ru'
                                  ? 'Лёгкое'
                                  : 'Easy'}
                          </span>
                          <span className="text-ash/50">·</span>
                          <span className={rCfg.textClass}>{lang === 'ru' ? rCfg.labelRu : rCfg.labelEn}</span>
                          <span className="text-ash/50">·</span>
                          <span className="text-amber-300/90">+{ach.xp_reward || 0} XP</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={busyAssetId === ach.id}
                        onClick={() => handleToggleAchievement(ach.id, Boolean(ach.is_unlocked))}
                        className={`px-2.5 py-1.5 rounded font-mono text-[10px] uppercase border transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                          ach.is_unlocked
                            ? 'border-red-900/70 text-red-300 hover:bg-red-950/60'
                            : 'border-emerald-800/70 text-emerald-300 hover:bg-emerald-950/60'
                        }`}
                      >
                        {ach.is_unlocked
                          ? lang === 'ru' ? 'Отозвать' : 'Revoke'
                          : lang === 'ru' ? 'Выдать' : 'Grant'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: SHOP ITEMS, FORCE EQUIP & CUSTOM SHIELD CREATOR */}
          {tab === 'items' && (
            <div className="space-y-5">
              {/* Inline Custom Shield Creator */}
              <form
                onSubmit={handleCreateCustomShield}
                className="p-4 rounded-xl bg-[#18131d] border border-[#821c2c]/45 space-y-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-xs uppercase tracking-wider text-ivory flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#c49298]" />
                    <span>{lang === 'ru' ? 'Создать и выдать уникальный шилд' : 'Create & Grant Custom Shield'}</span>
                  </div>
                  <div>{renderEquippedTitle(shieldPreviewVal, lang)}</div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={csLabelRu}
                    onChange={(e) => setCsLabelRu(e.target.value)}
                    placeholder={lang === 'ru' ? 'Текст шилда (RU) *' : 'Shield Label (RU) *'}
                    className="px-3 py-2 bg-[#121016] border border-white/10 rounded-lg text-white focus:outline-none"
                  />
                  <input
                    type="text"
                    maxLength={32}
                    value={csLabelEn}
                    onChange={(e) => setCsLabelEn(e.target.value)}
                    placeholder={lang === 'ru' ? 'Текст шилда (EN)' : 'Shield Label (EN)'}
                    className="px-3 py-2 bg-[#121016] border border-white/10 rounded-lg text-white focus:outline-none"
                  />
                  <select
                    value={csRarity}
                    onChange={(e) => setCsRarity(e.target.value as ItemRarity)}
                    className="px-3 py-2 bg-[#121016] border border-white/10 rounded-lg text-white font-mono focus:outline-none"
                  >
                    <option value="common">common</option>
                    <option value="uncommon">uncommon</option>
                    <option value="rare">rare</option>
                    <option value="epic">epic</option>
                    <option value="legendary">legendary</option>
                    <option value="mythic">mythic</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-[10px]">
                  <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#121016] border border-white/10 text-ash">
                    <span>{lang === 'ru' ? 'Фон' : 'Bg'}</span>
                    <input type="color" value={csBg} onChange={(e) => setCsBg(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#121016] border border-white/10 text-ash">
                    <span>{lang === 'ru' ? 'Рамка' : 'Border'}</span>
                    <input type="color" value={csBorder} onChange={(e) => setCsBorder(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#121016] border border-white/10 text-ash">
                    <span>{lang === 'ru' ? 'Текст' : 'Text'}</span>
                    <input type="color" value={csText} onChange={(e) => setCsText(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" />
                  </label>
                  <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#121016] border border-white/10 text-ash">
                    <span>{lang === 'ru' ? 'Свечение' : 'Glow'}</span>
                    <input type="color" value={csGlow} onChange={(e) => setCsGlow(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" />
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={csAddToShop}
                        onChange={(e) => setCsAddToShop(e.target.checked)}
                        className="accent-[#821c2c]"
                      />
                      <span>{lang === 'ru' ? 'Также добавить в витрину магазина' : 'Also publish to shop'}</span>
                    </label>
                    {csAddToShop && (
                      <input
                        type="number"
                        min={0}
                        value={csCostXp}
                        onChange={(e) => setCsCostXp(e.target.value)}
                        placeholder="XP"
                        className="w-24 px-2.5 py-1 bg-[#121016] border border-white/10 rounded font-mono text-white"
                      />
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={creatingShield || !csLabelRu.trim()}
                    className="px-4 py-2 rounded-lg bg-[#821c2c] hover:bg-[#962537] border border-[#a83145] text-white font-mono text-[11px] uppercase tracking-wider cursor-pointer disabled:opacity-50"
                  >
                    {creatingShield
                      ? lang === 'ru' ? 'Создание...' : 'Creating...'
                      : lang === 'ru' ? 'Выдать и надеть шилд' : 'Grant & Equip Shield'}
                  </button>
                </div>
              </form>

              {/* Category Filter + Clear Slot Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase">
                  <button
                    type="button"
                    onClick={() => setItemCategoryFilter('all')}
                    className={`px-2.5 py-1 rounded border cursor-pointer ${
                      itemCategoryFilter === 'all'
                        ? 'bg-white/[0.12] border-white/25 text-white'
                        : 'border-white/10 text-ash hover:text-white'
                    }`}
                  >
                    {lang === 'ru' ? 'Все' : 'All'}
                  </button>
                  {(Object.keys(CATEGORY_LABELS) as ShopCategory[]).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setItemCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded border cursor-pointer ${
                        itemCategoryFilter === cat
                          ? 'bg-white/[0.12] border-white/25 text-white'
                          : 'border-white/10 text-ash hover:text-white'
                      }`}
                    >
                      {CATEGORY_LABELS[cat][lang]}
                    </button>
                  ))}
                </div>

                {itemCategoryFilter !== 'all' && (
                  <button
                    type="button"
                    disabled={busyAssetId === `clear_${itemCategoryFilter}`}
                    onClick={() => handleClearCategorySlot(itemCategoryFilter as ShopCategory)}
                    className="px-2.5 py-1 rounded border border-white/15 bg-white/[0.04] hover:bg-white/[0.1] font-mono text-[10px] uppercase text-ash hover:text-white cursor-pointer"
                  >
                    {lang === 'ru' ? 'Снять слот' : 'Clear Slot'}
                  </button>
                )}
              </div>

              {/* Shop Items Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredItems.map((it) => {
                  const rCfg = RARITY_CONFIG[it.rarity as ItemRarity] || RARITY_CONFIG.common;
                  const catLabel = CATEGORY_LABELS[it.category as ShopCategory];
                  const isBusy = busyAssetId === it.id;

                  return (
                    <div
                      key={it.id}
                      className={`p-3 rounded-lg border flex flex-col justify-between gap-2.5 ${
                        it.is_owned
                          ? 'bg-[#1a1622] border-amber-700/40'
                          : 'bg-[#15131a] border-white/[0.06] opacity-85'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Package className={`w-3.5 h-3.5 shrink-0 ${it.is_owned ? 'text-amber-300' : 'text-ash/50'}`} />
                            <span className="font-sans text-xs text-ivory font-medium">
                              {lang === 'ru' ? it.name_ru : it.name_en}
                            </span>
                            {it.is_equipped && (
                              <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60">
                                <Check className="w-2.5 h-2.5" />
                                {lang === 'ru' ? 'Надето' : 'Equipped'}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] mt-1 flex flex-wrap items-center gap-1.5">
                            <span className={rCfg.textClass}>{lang === 'ru' ? rCfg.labelRu : rCfg.labelEn}</span>
                            <span className="text-ash/50">·</span>
                            <span className="text-ash/70">{catLabel ? catLabel[lang] : it.category}</span>
                            <span className="text-ash/50">·</span>
                            <span className="text-ash/70">{it.cost_xp} XP</span>
                          </div>
                          {it.category === 'title' && it.preview_value && (
                            <div className="mt-1.5">{renderEquippedTitle(it.preview_value, lang, true)}</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 font-mono text-[10px] uppercase">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleEquipItem(it.id, Boolean(it.is_equipped))}
                          className={`px-2.5 py-1 rounded border cursor-pointer disabled:opacity-50 ${
                            it.is_equipped
                              ? 'border-amber-700/70 text-amber-200 hover:bg-amber-950/50'
                              : 'border-white/15 text-bone hover:bg-white/[0.08]'
                          }`}
                        >
                          {it.is_equipped
                            ? lang === 'ru' ? 'Снять' : 'Unequip'
                            : lang === 'ru' ? 'Надеть' : 'Equip'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleItem(it.id, Boolean(it.is_owned))}
                          className={`px-2.5 py-1 rounded border cursor-pointer disabled:opacity-50 ${
                            it.is_owned
                              ? 'border-red-900/70 text-red-300 hover:bg-red-950/60'
                              : 'border-emerald-800/70 text-emerald-300 hover:bg-emerald-950/60'
                          }`}
                        >
                          {it.is_owned
                            ? lang === 'ru' ? 'Отозвать' : 'Revoke'
                            : lang === 'ru' ? 'Выдать' : 'Grant'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
