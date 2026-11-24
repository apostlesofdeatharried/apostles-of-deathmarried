import React, { useState, useEffect } from 'react';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { ShopItem, ShopCategory, ItemRarity } from '../types/index.js';
import { dispatchAchievementUnlocked } from './AchievementToast.js';
import { safeJson } from '../utils/logic.js';
import {
  RARITY_CONFIG,
  CATEGORY_LABELS,
  renderEquippedBadge,
  renderEquippedTitle,
  renderProfileBanner,
  isAnimatedBanner,
  getProfileThemeStyle,
  renderProfileEffectOverlay,
  formatHandle,
} from '../utils/cosmetics.js';
import confetti from 'canvas-confetti';
import { X, Check, ShoppingBag, ShieldCheck, Filter, Eye, RotateCcw, Sparkles } from 'lucide-react';

interface ShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHOP_CATEGORIES: ShopCategory[] = ['title', 'banner', 'frame', 'effect', 'name_style', 'badge', 'theme'];
const RARITY_FILTERS: Array<'all' | ItemRarity> = ['all', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

type PinnedPreviewMap = Partial<Record<ShopCategory, { id: string; value: string; name: string }>>;
type HoverPreviewMap = Partial<Record<ShopCategory, string>>;

export const ShopModal: React.FC<ShopModalProps> = ({ isOpen, onClose }) => {
  const { user, refresh, openAuth } = useAuth();
  const { t, lang } = useI18n();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<ShopCategory>('title');
  const [rarityFilter, setRarityFilter] = useState<'all' | ItemRarity>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'owned' | 'available'>('all');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Supports both click-to-pin preview (mobile + desktop multi-layer mixing) and desktop hover preview
  const [pinnedPreviews, setPinnedPreviews] = useState<PinnedPreviewMap>({});
  const [hoverPreviews, setHoverPreviews] = useState<HoverPreviewMap>({});

  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/shop/items');
      const data = await safeJson<{ items?: ShopItem[] }>(res, { items: [] });
      if (res.ok) {
        setItems(data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadItems();
      setErrorMsg(null);
      setSuccessMsg(null);
      setPinnedPreviews({});
      setHoverPreviews({});
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredItems = items.filter((it) => {
    if (it.category !== activeCategory) return false;
    if (rarityFilter !== 'all' && it.rarity !== rarityFilter) return false;
    if (ownershipFilter === 'owned' && !it.is_owned) return false;
    if (ownershipFilter === 'available' && it.is_owned) return false;
    return true;
  });

  const ownedCount = items.filter((it) => it.is_owned).length;
  const pinnedList = Object.entries(pinnedPreviews).filter(([, v]) => Boolean(v)) as Array<
    [ShopCategory, { id: string; value: string; name: string }]
  >;

  const handleTogglePinPreview = (item: ShopItem) => {
    const label = lang === 'ru' ? item.name_ru : item.name_en;
    setPinnedPreviews((prev) => {
      if (prev[item.category]?.id === item.id) {
        const next = { ...prev };
        delete next[item.category];
        return next;
      }
      return {
        ...prev,
        [item.category]: { id: item.id, value: item.preview_value, name: label },
      };
    });
  };

  const handleBuy = async (item: ShopItem) => {
    if (!user) {
      onClose();
      openAuth('login');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setActionLoading(item.id);
    try {
      const res = await authFetch('/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      });
      const data = await safeJson<{ error?: string; newly_unlocked_achievements?: any[] }>(res, {});
      if (!res.ok) {
        setErrorMsg(data.error || (lang === 'ru' ? 'Не удалось купить предмет.' : 'Failed to purchase item.'));
      } else {
        confetti({ particleCount: 36, spread: 52, origin: { y: 0.6 } });
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        setSuccessMsg(
          lang === 'ru'
            ? `Предмет «${item.name_ru}» добавлен в вашу коллекцию!`
            : `«${item.name_en}» added to your collection!`
        );
        await refresh();
        await loadItems();
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error occurred');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEquipToggle = async (item: ShopItem, willEquip: boolean) => {
    if (!user) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setActionLoading(item.id);
    try {
      const res = await authFetch('/api/shop/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, equip: willEquip }),
      });
      const data = await safeJson<{ error?: string; newly_unlocked_achievements?: any[] }>(res, {});
      if (!res.ok) {
        setErrorMsg(data.error || (lang === 'ru' ? 'Не удалось обновить оформление.' : 'Failed to update equipment.'));
      } else {
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        setSuccessMsg(
          willEquip
            ? lang === 'ru'
              ? `Оформление «${item.name_ru}» применено к профилю`
              : `Equipped «${item.name_en}»`
            : lang === 'ru'
              ? `Оформление «${item.name_ru}» снято`
              : `Unequipped «${item.name_en}»`
        );
        // Clear pinned preview for that category so live card mirrors saved equipment
        setPinnedPreviews((prev) => {
          const next = { ...prev };
          delete next[item.category];
          return next;
        });
        await refresh();
        await loadItems();
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error occurred');
    } finally {
      setActionLoading(null);
    }
  };

  // Combined live preview layers: hover overrides pinned overrides equipped
  const activeFrame = hoverPreviews.frame ?? pinnedPreviews.frame?.value ?? user?.equipped_frame;
  const activeBanner =
    hoverPreviews.banner ??
    pinnedPreviews.banner?.value ??
    user?.equipped_banner ??
    'from-[#0e0d12] via-[#16141d] to-[#0c0b0e]';
  const activeNameStyle = hoverPreviews.name_style ?? pinnedPreviews.name_style?.value ?? user?.equipped_name_style;
  const activeBadge = hoverPreviews.badge ?? pinnedPreviews.badge?.value ?? user?.equipped_badge;
  const activeTitle = hoverPreviews.title ?? pinnedPreviews.title?.value ?? user?.equipped_title;
  const activeTheme = hoverPreviews.theme ?? pinnedPreviews.theme?.value ?? user?.equipped_theme;
  const activeEffect = hoverPreviews.effect ?? pinnedPreviews.effect?.value ?? user?.equipped_effect;
  const themeStyle = getProfileThemeStyle(activeTheme);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/82 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label={t('shopTitle')}
    >
      <div className="relative w-full max-w-5xl bg-[#0c0b0e] border border-white/[0.12] rounded-xl shadow-[0_24px_70px_rgba(0,0,0,0.92)] overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/[0.08] bg-[#111015]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#821c2c]/20 border border-[#821c2c]/45 flex items-center justify-center text-[#e8909c]">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg tracking-[0.14em] uppercase text-[#f2eee9] font-medium">
                {t('shopTitle')}
              </h2>
              <p className="text-[11px] text-[#8e877e] font-sans">
                {lang === 'ru'
                  ? `Кастомизация профиля · ${items.length} предметов · в коллекции: ${ownedCount}`
                  : `Profile customization · ${items.length} items · owned: ${ownedCount}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-black/55 border border-white/[0.08] rounded-lg text-xs font-mono tabular-nums">
                <span className="text-[#8e877e]">{t('balanceLabel')}:</span>
                <span className="text-[#f2eee9] font-semibold">{user.xp} XP</span>
                <span className="text-[#423d38]">·</span>
                <span className="text-[#8e877e]">{t('level')}:</span>
                <span className="text-[#ded8ce]">{user.level}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('closeBtn')}
              className="p-1.5 text-[#8e877e] hover:text-white rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Informational Bar */}
        <div className="px-5 sm:px-6 py-2 bg-[#141319] border-b border-white/[0.05] text-[11px] text-[#9e968b] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-[#a39b8b] shrink-0" />
            <span className="truncate sm:whitespace-normal">
              {lang === 'ru'
                ? 'Уровень и Total XP не снижаются. Нажмите «Примерка» или наведите на предмет, чтобы собрать образ.'
                : 'Lifetime level & Total XP never drop. Click Preview or hover any item to mix and test your look.'}
            </span>
          </div>
          {user && (
            <span className="sm:hidden text-xs text-[#f2eee9] font-mono font-semibold tabular-nums shrink-0">
              {user.xp} XP
            </span>
          )}
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="mx-5 sm:mx-6 mt-3 px-4 py-2 rounded-lg bg-[#3d1820] border border-[#8a2a38] text-xs text-white">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mx-5 sm:mx-6 mt-3 px-4 py-2 rounded-lg bg-[#162e1c] border border-[#2b6637] text-xs text-[#6ee7b7]">
            {successMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Interactive Live 7-Layer Profile Card Preview */}
          <div className={`rounded-xl overflow-hidden border transition-all duration-300 ${themeStyle.cardClass}`}>
            <div className="h-24 sm:h-28 w-full relative overflow-hidden bg-[#0c0b0e]">
              {renderProfileBanner(activeBanner)}
              {renderProfileEffectOverlay(activeEffect)}

              <div className="absolute top-2.5 right-3 z-10 flex items-center gap-2">
                {isAnimatedBanner(activeBanner) && (
                  <span className="inline-flex items-center gap-1 text-[9px] tracking-wider uppercase px-2 py-0.5 rounded bg-black/65 border border-[#c95b84]/45 text-[#f2b8cb] font-mono">
                    <Sparkles className="w-2.5 h-2.5" />
                    {lang === 'ru' ? 'Анимация' : 'Animated'}
                  </span>
                )}
                <span className="text-[10px] tracking-wider uppercase px-2 py-0.5 rounded bg-black/65 border border-white/10 text-[#a39b8b] font-mono">
                  {lang === 'ru' ? 'Предпросмотр' : 'Live Preview'}
                </span>
              </div>
            </div>

            <div className="px-4 sm:px-5 pb-4 pt-3 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div className="flex items-end gap-4 -mt-12 relative z-10 min-w-0">
                <div
                  className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-black shrink-0 ${
                    activeFrame || 'border border-white/20'
                  }`}
                >
                  <img
                    src={user?.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="pb-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-base sm:text-lg font-display tracking-wider truncate ${activeNameStyle || 'text-white'}`}>
                      {user?.display_name || user?.nickname || 'Night Apostle'}
                    </span>
                    {renderEquippedTitle(activeTitle, lang, true)}
                    {renderEquippedBadge(activeBadge, lang, true)}
                  </div>
                  <div className="text-[11px] text-[#9e968b] font-mono flex items-center gap-2 mt-1">
                    <span>{formatHandle(user?.nickname || 'night_apostle')}</span>
                    <span className="text-[#423d38]">·</span>
                    <span className="tabular-nums">
                      {t('level')} {user?.level || 1} · {user?.xp || 0} XP
                    </span>
                  </div>
                </div>
              </div>

              <div className="w-32 h-1.5 rounded-full bg-white/[0.06] overflow-hidden shrink-0 self-end sm:self-center">
                <div className={`h-full w-2/3 ${themeStyle.accentBarClass}`} />
              </div>
            </div>

            {/* Active Pinned Preview Strip */}
            {pinnedList.length > 0 && (
              <div className="px-4 sm:px-5 py-2 bg-black/45 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[#b8b1a5] min-w-0">
                  <span className="text-[#8e877e] uppercase text-[10px]">
                    {lang === 'ru' ? 'Примерка:' : 'Previewing:'}
                  </span>
                  {pinnedList.map(([cat, info], idx) => (
                    <span key={cat} className="text-[#f2eee9]">
                      {idx > 0 && <span className="text-[#5a534c] mr-2">·</span>}
                      {info.name}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setPinnedPreviews({})}
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#d4a5ac] hover:text-white cursor-pointer shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{lang === 'ru' ? 'Сбросить' : 'Reset'}</span>
                </button>
              </div>
            )}
          </div>

          {/* 7 Category Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.08] pb-3 font-mono text-[11px]">
            {SHOP_CATEGORIES.map((cat) => {
              const catCount = items.filter((it) => it.category === cat).length;
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    activeCategory === cat
                      ? 'bg-[#821c2c]/30 text-white border border-[#821c2c]/70'
                      : 'text-[#8e877e] hover:text-white bg-white/[0.03] border border-white/[0.06]'
                  }`}
                >
                  <span>{lang === 'ru' ? CATEGORY_LABELS[cat].ru : CATEGORY_LABELS[cat].en}</span>
                  <span className="text-[10px] opacity-65 tabular-nums">({catCount})</span>
                </button>
              );
            })}
          </div>

          {/* Rarity & Ownership Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[#736c64] uppercase tracking-wider flex items-center gap-1 mr-1">
                <Filter className="w-3 h-3" />
                {lang === 'ru' ? 'Редкость:' : 'Rarity:'}
              </span>
              {RARITY_FILTERS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRarityFilter(r)}
                  className={`px-2 py-1 rounded uppercase tracking-wider cursor-pointer border transition-colors ${
                    rarityFilter === r
                      ? 'bg-white/[0.12] text-white border-white/25'
                      : 'bg-transparent text-[#8e877e] border-white/[0.06] hover:text-white'
                  }`}
                >
                  {r === 'all'
                    ? lang === 'ru'
                      ? 'Все'
                      : 'All'
                    : lang === 'ru'
                      ? RARITY_CONFIG[r].labelRu
                      : RARITY_CONFIG[r].labelEn}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'all', ru: 'Все', en: 'All' },
                  { id: 'available', ru: 'Доступные', en: 'Unowned' },
                  { id: 'owned', ru: 'Купленные', en: 'Owned' },
                ] as const
              ).map((f) => (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => setOwnershipFilter(f.id)}
                  className={`px-2 py-1 rounded uppercase tracking-wider cursor-pointer border transition-colors ${
                    ownershipFilter === f.id
                      ? 'bg-white/[0.12] text-white border-white/25'
                      : 'text-[#8e877e] border-white/[0.06] hover:text-white'
                  }`}
                >
                  {lang === 'ru' ? f.ru : f.en}
                </button>
              ))}
            </div>
          </div>

          {/* Catalog Grid */}
          {loading ? (
            <div className="py-12 text-center text-xs text-[#8e877e] font-mono">
              {lang === 'ru' ? 'Загрузка каталога предметов...' : 'Loading catalog...'}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8e877e] font-mono">
              {lang === 'ru' ? 'По выбранным фильтрам предметов не найдено.' : 'No items match the selected filters.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const name = lang === 'ru' ? item.name_ru : item.name_en;
                const desc = lang === 'ru' ? item.description_ru : item.description_en;
                const canAfford = user ? user.xp >= item.cost_xp : false;
                const rarityMeta = RARITY_CONFIG[item.rarity] || RARITY_CONFIG.common;
                const isPinned = pinnedPreviews[item.category]?.id === item.id;
                const isHovered = hoverPreviews[item.category] === item.preview_value;
                const animatedBannerItem = item.category === 'banner' && isAnimatedBanner(item.preview_value);

                return (
                  <div
                    key={item.id}
                    onMouseEnter={() =>
                      setHoverPreviews((prev) => ({
                        ...prev,
                        [item.category]: item.preview_value,
                      }))
                    }
                    onMouseLeave={() =>
                      setHoverPreviews((prev) => {
                        const next = { ...prev };
                        delete next[item.category];
                        return next;
                      })
                    }
                    className={`p-4 rounded-xl bg-[#111015] border transition-all duration-200 flex flex-col justify-between ${
                      isPinned
                        ? 'border-[#d49a6a]/75 bg-[#16141b] shadow-[0_0_20px_rgba(212,154,106,0.14)]'
                        : item.is_equipped
                          ? 'border-[#c5c8cf]/45 shadow-[0_0_16px_rgba(197,200,207,0.1)]'
                          : isHovered
                            ? 'border-white/28 bg-[#15141b] -translate-y-0.5'
                            : `${rarityMeta.borderClass} hover:border-white/25`
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Header: Title + Unboxed Metadata + Tabular Price */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-display text-[15px] tracking-wide text-[#f2eee9] font-medium truncate">
                            {name}
                          </h3>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
                            <span className={rarityMeta.textClass}>
                              {lang === 'ru' ? rarityMeta.labelRu : rarityMeta.labelEn}
                            </span>
                            {animatedBannerItem && (
                              <>
                                <span className="text-[#4a443e]">·</span>
                                <span className="text-[#e89fb4]">
                                  {lang === 'ru' ? 'Анимация' : 'Animated'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-semibold font-mono tabular-nums text-[#f2eee9]">
                            {item.cost_xp} XP
                          </span>
                        </div>
                      </div>

                      {/* Visual Specimen Showcase */}
                      {item.category === 'title' && (
                        <div className="py-2.5 px-3 rounded-lg bg-[#0b0a0e] border border-white/[0.06] flex items-center justify-between gap-2">
                          <span className="text-xs text-[#ded8ce] font-display truncate">
                            {user?.display_name || user?.nickname || 'apostle'}
                          </span>
                          {renderEquippedTitle(item.preview_value, lang)}
                        </div>
                      )}

                      {item.category === 'banner' && (
                        <div className="relative h-14 w-full rounded-lg overflow-hidden border border-white/10 bg-[#0b0a0e]">
                          {renderProfileBanner(item.preview_value, true)}
                        </div>
                      )}

                      {item.category === 'frame' && (
                        <div className="py-2 px-3 rounded-lg bg-[#0b0a0e] border border-white/[0.06] flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full bg-[#1b1922] overflow-hidden shrink-0 ${item.preview_value}`}>
                            <img
                              src={user?.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                              alt=""
                              className="w-full h-full object-cover opacity-85"
                            />
                          </div>
                          <span className="text-[11px] font-mono text-[#8e877e]">
                            {lang === 'ru' ? 'Окантовка аватара' : 'Avatar frame'}
                          </span>
                        </div>
                      )}

                      {item.category === 'name_style' && (
                        <div className="py-2.5 px-3 rounded-lg bg-[#0b0a0e] border border-white/[0.06]">
                          <div className={`text-base font-display ${item.preview_value} truncate`}>
                            {user?.display_name || user?.nickname || 'Night Apostle'}
                          </div>
                        </div>
                      )}

                      {item.category === 'badge' && (
                        <div className="py-2.5 px-3 rounded-lg bg-[#0b0a0e] border border-white/[0.06] flex items-center gap-2">
                          <span className="text-xs text-[#ded8ce] font-display truncate">
                            {user?.display_name || user?.nickname || 'apostle'}
                          </span>
                          {renderEquippedBadge(item.preview_value, lang)}
                        </div>
                      )}

                      {item.category === 'theme' && (() => {
                        const ts = getProfileThemeStyle(item.preview_value);
                        return (
                          <div className={`p-2.5 rounded-lg border ${ts.cardClass} space-y-1.5`}>
                            <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                              <div className={`h-full w-3/4 ${ts.accentBarClass}`} />
                            </div>
                            <div className="text-[10px] font-mono text-[#8e877e]">
                              {lang === 'ru' ? 'Палитра карточки профиля' : 'Profile card surface'}
                            </div>
                          </div>
                        );
                      })()}

                      {item.category === 'effect' && (
                        <div className="relative h-12 w-full rounded-lg overflow-hidden bg-gradient-to-r from-[#0e0d12] via-[#1a1722] to-[#0c0b0e] border border-white/[0.08]">
                          {renderProfileEffectOverlay(item.preview_value)}
                        </div>
                      )}

                      <p className="text-[11px] text-[#8e877e] leading-relaxed font-sans min-h-[32px]">
                        {desc}
                      </p>
                    </div>

                    {/* Actions: Preview Toggle + Buy/Equip */}
                    <div className="pt-3 border-t border-white/[0.06] mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTogglePinPreview(item)}
                        title={lang === 'ru' ? 'Примерить в предпросмотре' : 'Pin in live preview'}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
                          isPinned
                            ? 'bg-[#821c2c]/30 border-[#c95b84]/60 text-[#fce3ef]'
                            : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.09] text-[#a39b8b] hover:text-white'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">
                          {isPinned
                            ? lang === 'ru'
                              ? 'В примере'
                              : 'Active'
                            : lang === 'ru'
                              ? 'Примерка'
                              : 'Try'}
                        </span>
                      </button>

                      {item.is_owned ? (
                        item.is_equipped ? (
                          <div className="flex items-center gap-2 flex-1 justify-between min-w-0">
                            <span className="inline-flex items-center gap-1 text-[11px] text-[#6ee7b7] font-mono truncate">
                              <Check className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{t('shopEquipped')}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleEquipToggle(item, false)}
                              disabled={actionLoading === item.id}
                              className="text-[11px] font-mono px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[#ded8ce] transition-colors cursor-pointer shrink-0"
                            >
                              {t('shopUnequip')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEquipToggle(item, true)}
                            disabled={actionLoading === item.id}
                            className="flex-1 text-[11px] font-mono uppercase tracking-wider py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.15] text-white transition-colors cursor-pointer"
                          >
                            {t('shopEquip')}
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleBuy(item)}
                          disabled={(Boolean(user) && !canAfford) || actionLoading === item.id}
                          className="flex-1 text-[11px] font-mono uppercase tracking-wider py-1.5 rounded-lg bg-[#5a1622]/85 hover:bg-[#721b2b] border border-[#821c2c] disabled:bg-white/[0.05] disabled:border-white/[0.08] disabled:opacity-45 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
                        >
                          {!user
                            ? lang === 'ru'
                              ? `Войти`
                              : `Sign in`
                            : canAfford
                              ? t('shopBuy')
                              : t('insufficientXp')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
