import React, { useState, useEffect } from 'react';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { ShopItem } from '../types/index.js';
import { safeJson } from '../utils/logic.js';
import confetti from 'canvas-confetti';
import { X, Sparkles, Check, ShoppingBag, ShieldCheck, Tag, Flame } from 'lucide-react';

interface ShopModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShopModal: React.FC<ShopModalProps> = ({ isOpen, onClose }) => {
  const { user, refresh } = useAuth();
  const { t, lang } = useI18n();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<'frame' | 'banner' | 'name_style' | 'badge'>('frame');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Live preview override state
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [previewBanner, setPreviewBanner] = useState<string | null>(null);
  const [previewNameStyle, setPreviewNameStyle] = useState<string | null>(null);
  const [previewBadge, setPreviewBadge] = useState<string | null>(null);

  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shop/items');
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
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredItems = items.filter((it) => it.category === activeCategory);

  const handleBuy = async (item: ShopItem) => {
    if (!user) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setActionLoading(item.id);
    try {
      const res = await authFetch('/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to purchase item');
      } else {
        confetti({ particleCount: 45, spread: 60, origin: { y: 0.6 } });
        setSuccessMsg(lang === 'ru' ? `Предмет «${item.name_ru}» успешно приобретён!` : `Purchased «${item.name_en}»!`);
        refresh();
        loadItems();
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
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to update equipment');
      } else {
        setSuccessMsg(willEquip ? (lang === 'ru' ? 'Предмет экипирован' : 'Item equipped') : (lang === 'ru' ? 'Предмет снят' : 'Item unequipped'));
        refresh();
        loadItems();
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Error occurred');
    } finally {
      setActionLoading(null);
    }
  };

  // Live preview values
  const activeFrame = previewFrame ?? user?.equipped_frame;
  const activeBanner = previewBanner ?? user?.equipped_banner ?? 'from-[#0e0d12] via-[#16141d] to-[#0c0b0e]';
  const activeNameStyle = previewNameStyle ?? user?.equipped_name_style;
  const activeBadge = previewBadge ?? user?.equipped_badge;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label={t('shopTitle')}
    >
      <div className="relative w-full max-w-4xl bg-[#0c0b0e] border border-white/[0.12] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#111015]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-[#c5c8cf]">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-lg tracking-[0.16em] uppercase text-[#f2eee9] font-medium">
                {t('shopTitle')}
              </h2>
              <p className="text-[11px] text-[#8e877e] font-sans">
                {t('shopSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <div className="hidden sm:flex items-center gap-3 px-3 py-1 bg-black/50 border border-white/[0.08] rounded text-xs font-mono">
                <span className="text-[#8e877e]">{t('balanceLabel')}:</span>
                <span className="text-[#f2eee9] font-semibold">{user.xp} XP</span>
                <span className="text-[#423d38]">|</span>
                <span className="text-[#8e877e]">{t('level')}:</span>
                <span className="text-[#ded8ce]">{user.level}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('closeBtn')}
              className="p-1.5 text-[#8e877e] hover:text-white rounded hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Informational Alert */}
        <div className="px-6 py-2.5 bg-[#15141b] border-b border-white/[0.05] text-[11px] text-[#9e968b] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#a39b8b]" />
            <span>
              {lang === 'ru'
                ? 'Покупки списывают только доступный баланс XP. Ваш уровень рассчитывается из общего опыта и не уменьшается.'
                : 'Purchases spend available XP balance only. Your lifetime level never decreases.'}
            </span>
          </div>
          {user && (
            <span className="sm:hidden text-xs text-[#f2eee9] font-mono font-medium">
              {user.xp} XP
            </span>
          )}
        </div>

        {/* Messages */}
        {errorMsg && (
          <div className="mx-6 mt-3 px-4 py-2 rounded bg-[#3d1820] border border-[#8a2a38] text-xs text-white">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 px-4 py-2 rounded bg-[#162e1c] border border-[#2b6637] text-xs text-[#6ee7b7]">
            {successMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Live Profile Card Preview */}
          <div className="rounded-lg overflow-hidden border border-white/[0.08] shadow-lg">
            <div className={`h-24 sm:h-28 w-full bg-gradient-to-r ${activeBanner} relative flex items-end p-4 transition-all duration-500`}>
              <div className="absolute top-2 right-3 text-[10px] tracking-wider uppercase px-2 py-0.5 rounded bg-black/60 border border-white/10 text-[#a39b8b] font-mono">
                {t('previewItem')}
              </div>

              <div className="flex items-center gap-4 translate-y-6">
                {/* Avatar with live frame preview */}
                <div className={`relative w-16 h-16 sm:w-18 sm:h-18 rounded-full overflow-hidden bg-black shrink-0 ${activeFrame || 'border border-white/20'}`}>
                  <img
                    src={user?.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Name with live name_style preview */}
                <div className="pt-6">
                  <div className="flex items-center gap-2">
                    <span className={`text-base sm:text-lg font-display tracking-wider ${activeNameStyle || 'text-white'}`}>
                      {user?.display_name || user?.nickname || t('apostle')}
                    </span>
                    {activeBadge && (
                      <span className="text-xs px-2 py-0.5 rounded bg-white/[0.08] border border-white/20 text-[#f2eee9] font-mono">
                        {activeBadge}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#8e877e] font-sans">
                    {t('level')} {user?.level || 1} • {user?.xp || 0} XP
                  </div>
                </div>
              </div>
            </div>
            <div className="h-10 bg-[#121117]" />
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 border-b border-white/[0.08] pb-3 font-mono text-xs w-full max-w-full">
            <button
              onClick={() => setActiveCategory('frame')}
              className={`shrink-0 px-3 sm:px-3.5 py-1.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                activeCategory === 'frame'
                  ? 'bg-white/[0.1] text-white border border-white/20'
                  : 'text-[#8e877e] hover:text-white'
              }`}
            >
              {t('shopFrames')}
            </button>
            <button
              onClick={() => setActiveCategory('banner')}
              className={`shrink-0 px-3 sm:px-3.5 py-1.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                activeCategory === 'banner'
                  ? 'bg-white/[0.1] text-white border border-white/20'
                  : 'text-[#8e877e] hover:text-white'
              }`}
            >
              {t('shopBanners')}
            </button>
            <button
              onClick={() => setActiveCategory('name_style')}
              className={`shrink-0 px-3 sm:px-3.5 py-1.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                activeCategory === 'name_style'
                  ? 'bg-white/[0.1] text-white border border-white/20'
                  : 'text-[#8e877e] hover:text-white'
              }`}
            >
              {t('shopNameStyles')}
            </button>
            <button
              onClick={() => setActiveCategory('badge')}
              className={`shrink-0 px-3 sm:px-3.5 py-1.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                activeCategory === 'badge'
                  ? 'bg-white/[0.1] text-white border border-white/20'
                  : 'text-[#8e877e] hover:text-white'
              }`}
            >
              {t('shopBadges')}
            </button>
          </div>

          {/* Catalog Grid */}
          {loading ? (
            <div className="py-12 text-center text-xs text-[#8e877e] font-mono">
              {lang === 'ru' ? 'Загрузка каталога предметов...' : 'Loading catalog...'}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8e877e]">
              {lang === 'ru' ? 'В этой категории пока нет предметов.' : 'No items in this category yet.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredItems.map((item) => {
                const name = lang === 'ru' ? item.name_ru : item.name_en;
                const desc = lang === 'ru' ? item.description_ru : item.description_en;
                const canAfford = user ? user.xp >= item.cost_xp : false;

                const isHovered =
                  (activeCategory === 'frame' && previewFrame === item.preview_value) ||
                  (activeCategory === 'banner' && previewBanner === item.preview_value) ||
                  (activeCategory === 'name_style' && previewNameStyle === item.preview_value) ||
                  (activeCategory === 'badge' && previewBadge === item.preview_value);

                return (
                  <div
                    key={item.id}
                    onMouseEnter={() => {
                      if (item.category === 'frame') setPreviewFrame(item.preview_value);
                      else if (item.category === 'banner') setPreviewBanner(item.preview_value);
                      else if (item.category === 'name_style') setPreviewNameStyle(item.preview_value);
                      else if (item.category === 'badge') setPreviewBadge(item.preview_value);
                    }}
                    onMouseLeave={() => {
                      setPreviewFrame(null);
                      setPreviewBanner(null);
                      setPreviewNameStyle(null);
                      setPreviewBadge(null);
                    }}
                    className={`p-4 rounded-lg bg-[#111015] border transition-all duration-200 flex flex-col justify-between ${
                      item.is_equipped
                        ? 'border-[#c5c8cf]/40 shadow-[0_0_15px_rgba(197,200,207,0.1)]'
                        : isHovered
                        ? 'border-white/30 bg-[#16151c]'
                        : 'border-white/[0.07] hover:border-white/20'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display text-base tracking-wider uppercase text-[#f2eee9] font-medium">
                            {name}
                          </h3>
                          <span className="text-[10px] tracking-wider uppercase font-mono px-2 py-0.5 rounded bg-white/[0.04] text-[#8e877e]">
                            {item.rarity}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold font-mono text-[#f2eee9]">
                            {item.cost_xp} XP
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-[#8e877e] leading-relaxed">
                        {desc}
                      </p>

                      {/* Small visual snippet of cosmetic */}
                      {item.category === 'frame' && (
                        <div className="flex items-center gap-2 pt-1">
                          <div className={`w-8 h-8 rounded-full bg-[#1b1922] ${item.preview_value}`} />
                          <span className="text-[10px] font-mono text-[#736c64]">
                            {lang === 'ru' ? 'Пример окантовки' : 'Frame preview'}
                          </span>
                        </div>
                      )}
                      {item.category === 'banner' && (
                        <div className={`h-6 w-full rounded bg-gradient-to-r ${item.preview_value} border border-white/10`} />
                      )}
                      {item.category === 'name_style' && (
                        <div className={`text-sm ${item.preview_value} pt-1`}>
                          {user?.nickname || 'deathmarried'}
                        </div>
                      )}
                      {item.category === 'badge' && (
                        <div className="pt-1">
                          <span className="text-xs px-2 py-0.5 rounded bg-white/[0.08] border border-white/20 text-[#f2eee9] font-mono">
                            {item.preview_value}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="pt-4 border-t border-white/[0.05] mt-3 flex items-center justify-between">
                      {item.is_owned ? (
                        item.is_equipped ? (
                          <div className="flex items-center gap-2 w-full justify-between">
                            <span className="inline-flex items-center gap-1.5 text-xs text-[#6ee7b7] font-mono">
                              <Check className="w-3.5 h-3.5" />
                              {t('shopEquipped')}
                            </span>
                            <button
                              onClick={() => handleEquipToggle(item, false)}
                              disabled={actionLoading === item.id}
                              className="text-xs font-mono px-3 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[#ded8ce] transition-colors cursor-pointer"
                            >
                              {t('shopUnequip')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleEquipToggle(item, true)}
                            disabled={actionLoading === item.id}
                            className="w-full text-xs font-mono uppercase tracking-wider py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.15] text-white transition-colors cursor-pointer"
                          >
                            {t('shopEquip')}
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => handleBuy(item)}
                          disabled={!canAfford || actionLoading === item.id}
                          className="w-full text-xs font-mono uppercase tracking-wider py-1.5 rounded bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
                        >
                          {canAfford ? `${t('shopBuy')} (${item.cost_xp} XP)` : `${t('insufficientXp')} (${item.cost_xp} XP)`}
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
