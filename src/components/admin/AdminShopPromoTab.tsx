import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Ticket,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  Shield,
  Package,
  Power,
  Lock,
} from 'lucide-react';
import { authFetch } from '../../context/AuthContext.js';
import { safeJson, buildCustomShieldValue, parseCustomShieldValue } from '../../utils/logic.js';
import {
  CATEGORY_LABELS,
  RARITY_CONFIG,
  renderEquippedTitle,
} from '../../utils/cosmetics.js';
import { ItemRarity, PromoCodeAdminItem, ShopCategory } from '../../types/index.js';

interface CommonProps {
  lang: 'ru' | 'en';
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}

const PROTECTED_PROMOS = new Set(['apostles', 'deathmarried']);

export const AdminPromosTab: React.FC<CommonProps> = ({ lang, onNotify, onError }) => {
  const [promos, setPromos] = useState<PromoCodeAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [xpReward, setXpReward] = useState('100');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPromos = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/promos', { cache: 'no-store' });
      const data = await safeJson<{ promos?: PromoCodeAdminItem[]; error?: string }>(res, {});
      if (res.ok) {
        setPromos(data.promos || []);
      } else if (data.error) {
        onError(data.error);
      }
    } catch (e: any) {
      onError(e?.message || 'Failed to load promo codes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPromos();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setCode('');
    setXpReward('100');
    setMaxUses('');
    setExpiresAt('');
    setIsActive(true);
  };

  const handleEdit = (p: PromoCodeAdminItem) => {
    setEditingId(p.id);
    setCode(p.code);
    setXpReward(String(p.xp_reward));
    setMaxUses(p.max_uses != null ? String(p.max_uses) : '');
    setExpiresAt(p.expires_at ? p.expires_at.slice(0, 16) : '');
    setIsActive(Boolean(p.is_active));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !code.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        xp_reward: Math.max(1, Number(xpReward) || 50),
        max_uses: maxUses.trim() ? Math.max(1, Number(maxUses)) : null,
        expires_at: expiresAt.trim() ? new Date(expiresAt).toISOString() : null,
        is_active: isActive,
      };
      const res = editingId
        ? await authFetch(`/api/admin/promos/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch('/api/admin/promos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to save promo code');
        return;
      }
      onNotify(editingId ? (lang === 'ru' ? 'Промокод обновлён' : 'Promo updated') : (lang === 'ru' ? 'Промокод создан' : 'Promo created'));
      resetForm();
      await loadPromos();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: PromoCodeAdminItem) => {
    try {
      const res = await authFetch(`/api/admin/promos/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !p.is_active }),
      });
      if (res.ok) {
        await loadPromos();
      } else {
        const d = await safeJson<{ error?: string }>(res, {});
        onError(d.error || 'Error');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    }
  };

  const handleDelete = async (p: PromoCodeAdminItem) => {
    try {
      const res = await authFetch(`/api/admin/promos/${p.id}`, { method: 'DELETE' });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to delete promo');
        return;
      }
      if (editingId === p.id) resetForm();
      onNotify(lang === 'ru' ? `Промокод «${p.code}» удалён` : `Promo "${p.code}" deleted`);
      await loadPromos();
    } catch (e: any) {
      onError(e?.message || 'Network error');
    }
  };

  const editingIsProtected = editingId
    ? PROTECTED_PROMOS.has(String(promos.find((x) => x.id === editingId)?.code || '').toLowerCase())
    : false;

  return (
    <motion.div
      key="promos"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 lg:grid-cols-12 gap-6"
    >
      <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h3 className="font-title text-xl text-ivory uppercase tracking-wider flex items-center gap-2">
            <Ticket className="w-5 h-5 text-[#c49298]" />
            <span>
              {editingId
                ? lang === 'ru' ? 'Редактировать промокод' : 'Edit Promo Code'
                : lang === 'ru' ? 'Новый промокод' : 'New Promo Code'}
            </span>
          </h3>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="font-mono text-[10px] uppercase text-ash hover:text-white flex items-center gap-1 cursor-pointer px-2 py-1 bg-white/[0.04] rounded"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{lang === 'ru' ? 'Сброс' : 'Reset'}</span>
            </button>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-3.5 text-xs font-sans">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
              {lang === 'ru' ? 'Код (2–64 символа)' : 'Code'} *
            </label>
            <input
              type="text"
              required
              disabled={editingIsProtected}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="nocturne2026"
              className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                {lang === 'ru' ? 'Награда (XP)' : 'XP Reward'} *
              </label>
              <input
                type="number"
                required
                min={1}
                value={xpReward}
                onChange={(e) => setXpReward(e.target.value)}
                className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-amber-300 font-mono focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                {lang === 'ru' ? 'Лимит активаций' : 'Max Uses'}
              </label>
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder={lang === 'ru' ? 'Без лимита' : 'Unlimited'}
                className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
              {lang === 'ru' ? 'Действует до (опционально)' : 'Expires At (optional)'}
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-ash hover:text-white cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-[#821c2c]"
            />
            <span>{lang === 'ru' ? 'Промокод активен' : 'Promo code is active'}</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-[#821c2c] hover:bg-[#962537] border border-[#a83145] text-white font-mono text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50"
          >
            {saving
              ? lang === 'ru' ? 'Сохранение...' : 'Saving...'
              : editingId
                ? lang === 'ru' ? 'Сохранить изменения' : 'Update Promo'
                : lang === 'ru' ? 'Создать промокод' : 'Create Promo'}
          </button>
        </form>
      </div>

      <div className="lg:col-span-7 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h3 className="font-title text-xl text-ivory uppercase tracking-wider">
            {lang === 'ru' ? 'Список промокодов' : 'Promo Codes'} ({promos.length})
          </h3>
        </div>

        {loading ? (
          <div className="py-10 text-center font-mono text-xs text-ash">
            {lang === 'ru' ? 'Загрузка...' : 'Loading...'}
          </div>
        ) : promos.length === 0 ? (
          <div className="py-10 text-center font-mono text-xs text-ash">
            {lang === 'ru' ? 'Промокодов пока нет.' : 'No promo codes yet.'}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {promos.map((p) => {
              const isProtected = PROTECTED_PROMOS.has(String(p.code || '').toLowerCase());
              return (
                <div key={p.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="text-ivory font-semibold uppercase tracking-wider">{p.code}</span>
                      <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-700/50 text-amber-200 text-[10px]">
                        +{p.xp_reward} XP
                      </span>
                      {isProtected && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.06] text-ash text-[9px] uppercase">
                          <Lock className="w-2.5 h-2.5" />
                          {lang === 'ru' ? 'Базовый' : 'System'}
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] uppercase border ${
                          p.is_active
                            ? 'bg-[#1a3820]/60 border-[#388548] text-[#6ee7b7]'
                            : 'bg-red-950/50 border-red-800/60 text-red-300'
                        }`}
                      >
                        {p.is_active ? (lang === 'ru' ? 'Активен' : 'Active') : (lang === 'ru' ? 'Отключён' : 'Disabled')}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-ash/70 flex flex-wrap gap-2.5">
                      <span>
                        {lang === 'ru' ? 'Использовано' : 'Uses'}: {p.uses_count ?? 0}
                        {p.max_uses ? ` / ${p.max_uses}` : ' / ∞'}
                      </span>
                      {p.expires_at && (
                        <span>
                          · {lang === 'ru' ? 'До' : 'Expires'}: {new Date(p.expires_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(p)}
                      className="p-1.5 rounded border border-white/10 hover:bg-white/[0.08] text-ash hover:text-white cursor-pointer"
                      title={p.is_active ? (lang === 'ru' ? 'Отключить' : 'Disable') : (lang === 'ru' ? 'Включить' : 'Enable')}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(p)}
                      className="p-1.5 rounded border border-white/10 hover:bg-white/[0.08] text-ash hover:text-white cursor-pointer"
                      title={lang === 'ru' ? 'Редактировать' : 'Edit'}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {!isProtected && (
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        className="p-1.5 rounded border border-white/10 hover:bg-red-950/60 text-ash hover:text-red-400 cursor-pointer"
                        title={lang === 'ru' ? 'Удалить' : 'Delete'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const AdminShopTab: React.FC<CommonProps> = ({ lang, onNotify, onError }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<ShopCategory>('title');
  const [nameRu, setNameRu] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descRu, setDescRu] = useState('');
  const [descEn, setDescEn] = useState('');
  const [costXp, setCostXp] = useState('400');
  const [rarity, setRarity] = useState<ItemRarity>('rare');
  const [previewValue, setPreviewValue] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Custom shield studio fields when category === 'title' & shieldStudio === true
  const [useShieldStudio, setUseShieldStudio] = useState(true);
  const [csLabelRu, setCsLabelRu] = useState('');
  const [csLabelEn, setCsLabelEn] = useState('');
  const [csBg, setCsBg] = useState('#220d14');
  const [csBorder, setCsBorder] = useState('#962a3d');
  const [csText, setCsText] = useState('#f2bcc6');
  const [csGlow, setCsGlow] = useState('#821c2c');

  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/shop/items', { cache: 'no-store' });
      const data = await safeJson<{ items?: any[]; error?: string }>(res, {});
      if (res.ok) {
        setItems(data.items || []);
      } else if (data.error) {
        onError(data.error);
      }
    } catch (e: any) {
      onError(e?.message || 'Failed to load shop items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setCategory('title');
    setNameRu('');
    setNameEn('');
    setDescRu('');
    setDescEn('');
    setCostXp('400');
    setRarity('rare');
    setPreviewValue('');
    setIsActive(true);
    setUseShieldStudio(true);
    setCsLabelRu('');
    setCsLabelEn('');
    setCsBg('#220d14');
    setCsBorder('#962a3d');
    setCsText('#f2bcc6');
    setCsGlow('#821c2c');
  };

  const handleEdit = (it: any) => {
    setEditingId(it.id);
    setCategory(it.category as ShopCategory);
    setNameRu(it.name_ru || '');
    setNameEn(it.name_en || '');
    setDescRu(it.description_ru || '');
    setDescEn(it.description_en || '');
    setCostXp(String(it.cost_xp ?? 0));
    setRarity((it.rarity || 'common') as ItemRarity);
    setPreviewValue(it.preview_value || '');
    setIsActive(Boolean(it.is_active));

    const parsedShield = parseCustomShieldValue(it.preview_value);
    if (it.category === 'title' && parsedShield) {
      setUseShieldStudio(true);
      setCsLabelRu(parsedShield.ru);
      setCsLabelEn(parsedShield.en);
      setCsBg(parsedShield.bg);
      setCsBorder(parsedShield.border);
      setCsText(parsedShield.text);
      setCsGlow(parsedShield.glow);
    } else {
      setUseShieldStudio(false);
    }
  };

  const computedShieldValue = buildCustomShieldValue({
    ru: csLabelRu.trim() || nameRu.trim() || 'шилд',
    en: csLabelEn.trim() || nameEn.trim() || csLabelRu.trim() || 'shield',
    bg: csBg,
    border: csBorder,
    text: csText,
    glow: csGlow,
  });

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !nameRu.trim()) return;
    const effectivePreview =
      category === 'title' && useShieldStudio ? computedShieldValue : previewValue.trim();

    if (!effectivePreview) {
      onError(lang === 'ru' ? 'Укажите ключ стиля или настройте шилд' : 'Specify preview value or configure shield');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name_ru: nameRu.trim(),
        name_en: nameEn.trim() || nameRu.trim(),
        description_ru: descRu.trim(),
        description_en: descEn.trim() || descRu.trim(),
        category,
        cost_xp: Math.max(0, Math.floor(Number(costXp) || 0)),
        rarity,
        preview_value: effectivePreview,
        is_active: isActive,
      };
      const res = editingId
        ? await authFetch(`/api/admin/shop/items/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch('/api/admin/shop/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to save shop item');
        return;
      }
      onNotify(editingId ? (lang === 'ru' ? 'Товар обновлён' : 'Item updated') : (lang === 'ru' ? 'Товар добавлен' : 'Item added'));
      resetForm();
      await loadItems();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (it: any) => {
    try {
      const res = await authFetch(`/api/admin/shop/items/${it.id}`, { method: 'DELETE' });
      const data = await safeJson<{ error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || 'Failed to delete item');
        return;
      }
      if (editingId === it.id) resetForm();
      onNotify(lang === 'ru' ? `Товар «${it.name_ru}» удалён` : `Item "${it.name_en}" deleted`);
      await loadItems();
    } catch (e: any) {
      onError(e?.message || 'Network error');
    }
  };

  const filteredItems = items.filter((it) => filterCategory === 'all' || it.category === filterCategory);

  return (
    <motion.div
      key="shop"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 lg:grid-cols-12 gap-6"
    >
      <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <h3 className="font-title text-xl text-ivory uppercase tracking-wider flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#c49298]" />
            <span>
              {editingId
                ? lang === 'ru' ? 'Редактировать товар' : 'Edit Item'
                : lang === 'ru' ? 'Конструктор магазина и шилдов' : 'Shop & Shields Studio'}
            </span>
          </h3>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="font-mono text-[10px] uppercase text-ash hover:text-white flex items-center gap-1 cursor-pointer px-2 py-1 bg-white/[0.04] rounded"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{lang === 'ru' ? 'Сброс' : 'Reset'}</span>
            </button>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-3.5 text-xs font-sans">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase text-ash mb-1">
                {lang === 'ru' ? 'Категория' : 'Category'}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ShopCategory)}
                className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none"
              >
                {(Object.keys(CATEGORY_LABELS) as ShopCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat][lang]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[10px] uppercase text-ash mb-1">
                {lang === 'ru' ? 'Редкость' : 'Rarity'}
              </label>
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value as ItemRarity)}
                className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none"
              >
                <option value="common">common</option>
                <option value="uncommon">uncommon</option>
                <option value="rare">rare</option>
                <option value="epic">epic</option>
                <option value="legendary">legendary</option>
                <option value="mythic">mythic</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={nameRu}
              onChange={(e) => setNameRu(e.target.value)}
              placeholder={lang === 'ru' ? 'Название (RU) *' : 'Name (RU) *'}
              className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
            />
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder={lang === 'ru' ? 'Название (EN)' : 'Name (EN)'}
              className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
            />
          </div>

          <input
            type="text"
            value={descRu}
            onChange={(e) => setDescRu(e.target.value)}
            placeholder={lang === 'ru' ? 'Описание (RU)' : 'Description (RU)'}
            className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[10px] uppercase text-ash mb-1">
                {lang === 'ru' ? 'Цена (XP)' : 'Cost (XP)'}
              </label>
              <input
                type="number"
                min={0}
                value={costXp}
                onChange={(e) => setCostXp(e.target.value)}
                className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-amber-300 font-mono focus:outline-none"
              />
            </div>
            <label className="flex items-end pb-2 gap-2 text-ash hover:text-white cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="accent-[#821c2c]"
              />
              <span>{lang === 'ru' ? 'Виден в магазине' : 'Visible in shop'}</span>
            </label>
          </div>

          {category === 'title' && (
            <div className="p-3.5 rounded-lg bg-[#17131c] border border-[#821c2c]/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-ivory cursor-pointer font-mono text-[11px] uppercase">
                  <input
                    type="checkbox"
                    checked={useShieldStudio}
                    onChange={(e) => setUseShieldStudio(e.target.checked)}
                    className="accent-[#821c2c]"
                  />
                  <span>{lang === 'ru' ? 'Конструктор кастомного шилда' : 'Custom Shield Studio'}</span>
                </label>
                {useShieldStudio && <div>{renderEquippedTitle(computedShieldValue, lang)}</div>}
              </div>

              {useShieldStudio && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      maxLength={32}
                      value={csLabelRu}
                      onChange={(e) => setCsLabelRu(e.target.value)}
                      placeholder={lang === 'ru' ? 'Текст шилда (RU)' : 'Label (RU)'}
                      className="px-2.5 py-1.5 bg-[#111015] border border-white/10 rounded text-white"
                    />
                    <input
                      type="text"
                      maxLength={32}
                      value={csLabelEn}
                      onChange={(e) => setCsLabelEn(e.target.value)}
                      placeholder={lang === 'ru' ? 'Текст шилда (EN)' : 'Label (EN)'}
                      className="px-2.5 py-1.5 bg-[#111015] border border-white/10 rounded text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                    <label className="flex items-center justify-between px-2 py-1 rounded bg-[#111015] border border-white/10 text-ash">
                      <span>{lang === 'ru' ? 'Фон' : 'Bg'}</span>
                      <input type="color" value={csBg} onChange={(e) => setCsBg(e.target.value)} className="w-5 h-5 bg-transparent cursor-pointer" />
                    </label>
                    <label className="flex items-center justify-between px-2 py-1 rounded bg-[#111015] border border-white/10 text-ash">
                      <span>{lang === 'ru' ? 'Рамка' : 'Border'}</span>
                      <input type="color" value={csBorder} onChange={(e) => setCsBorder(e.target.value)} className="w-5 h-5 bg-transparent cursor-pointer" />
                    </label>
                    <label className="flex items-center justify-between px-2 py-1 rounded bg-[#111015] border border-white/10 text-ash">
                      <span>{lang === 'ru' ? 'Текст' : 'Text'}</span>
                      <input type="color" value={csText} onChange={(e) => setCsText(e.target.value)} className="w-5 h-5 bg-transparent cursor-pointer" />
                    </label>
                    <label className="flex items-center justify-between px-2 py-1 rounded bg-[#111015] border border-white/10 text-ash">
                      <span>{lang === 'ru' ? 'Свечение' : 'Glow'}</span>
                      <input type="color" value={csGlow} onChange={(e) => setCsGlow(e.target.value)} className="w-5 h-5 bg-transparent cursor-pointer" />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {!(category === 'title' && useShieldStudio) && (
            <div>
              <label className="block font-mono text-[10px] uppercase text-ash mb-1">
                preview_value *
              </label>
              <input
                type="text"
                required
                value={previewValue}
                onChange={(e) => setPreviewValue(e.target.value)}
                placeholder="frame_crimson / Crown / cshield:{...}"
                className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-[#821c2c] hover:bg-[#962537] border border-[#a83145] text-white font-mono text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>
              {saving
                ? lang === 'ru' ? 'Сохранение...' : 'Saving...'
                : editingId
                  ? lang === 'ru' ? 'Сохранить товар' : 'Update Item'
                  : lang === 'ru' ? 'Добавить в магазин' : 'Create Item'}
            </span>
          </button>
        </form>
      </div>

      <div className="lg:col-span-7 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <h3 className="font-title text-xl text-ivory uppercase tracking-wider">
            {lang === 'ru' ? 'Каталог магазина' : 'Shop Catalog'} ({filteredItems.length})
          </h3>
          <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase">
            <button
              type="button"
              onClick={() => setFilterCategory('all')}
              className={`px-2 py-1 rounded border cursor-pointer ${
                filterCategory === 'all' ? 'bg-white/[0.12] border-white/25 text-white' : 'border-white/10 text-ash hover:text-white'
              }`}
            >
              {lang === 'ru' ? 'Все' : 'All'}
            </button>
            {(Object.keys(CATEGORY_LABELS) as ShopCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFilterCategory(cat)}
                className={`px-2 py-1 rounded border cursor-pointer ${
                  filterCategory === cat ? 'bg-white/[0.12] border-white/25 text-white' : 'border-white/10 text-ash hover:text-white'
                }`}
              >
                {CATEGORY_LABELS[cat][lang]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center font-mono text-xs text-ash">{lang === 'ru' ? 'Загрузка...' : 'Loading...'}</div>
        ) : (
          <div className="divide-y divide-white/[0.05] max-h-[560px] overflow-y-auto pr-1">
            {filteredItems.map((it) => {
              const rCfg = RARITY_CONFIG[it.rarity as ItemRarity] || RARITY_CONFIG.common;
              return (
                <div key={it.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-[#c49298] shrink-0" />
                      <span className="text-xs text-white font-medium">{lang === 'ru' ? it.name_ru : it.name_en}</span>
                      {!it.is_active && (
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-ash font-mono text-[9px] uppercase">
                          {lang === 'ru' ? 'Скрыт' : 'Hidden'}
                        </span>
                      )}
                    </div>
                    {it.category === 'title' && it.preview_value && (
                      <div className="pt-0.5">{renderEquippedTitle(it.preview_value, lang, true)}</div>
                    )}
                    <div className="font-mono text-[10px] text-ash/70 flex flex-wrap gap-2">
                      <span className={rCfg.textClass}>{lang === 'ru' ? rCfg.labelRu : rCfg.labelEn}</span>
                      <span>·</span>
                      <span>{CATEGORY_LABELS[it.category as ShopCategory]?.[lang] || it.category}</span>
                      <span>·</span>
                      <span className="text-amber-300/90">{it.cost_xp} XP</span>
                      <span>·</span>
                      <span>{lang === 'ru' ? 'Владельцев' : 'Owners'}: {it.owners_count ?? 0}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEdit(it)}
                      className="p-1.5 rounded border border-white/10 hover:bg-white/[0.08] text-ash hover:text-white cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(it)}
                      className="p-1.5 rounded border border-white/10 hover:bg-red-950/60 text-ash hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};
