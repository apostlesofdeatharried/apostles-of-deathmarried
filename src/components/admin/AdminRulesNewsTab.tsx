import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Megaphone,
  Send,
  BookOpen,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Users,
} from 'lucide-react';
import { authFetch } from '../../context/AuthContext.js';
import { safeJson } from '../../utils/logic.js';
import { CommunityRuleItem, CommunityRulesPayload } from '../../types/index.js';

interface CommonProps {
  lang: 'ru' | 'en';
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}

const NEWS_ROUTE_PRESETS = [
  { value: '', labelRu: 'Без перехода (просто прочитать)', labelEn: 'No navigation (read only)' },
  { value: '/', labelRu: 'Главная', labelEn: 'Home' },
  { value: '/archive', labelRu: 'Архив / Релизы', labelEn: 'Archive / Releases' },
  { value: '/games', labelRu: 'Игры и Викторина', labelEn: 'Games & Quiz' },
  { value: '/creations', labelRu: 'Творчество и Мемы', labelEn: 'Creations & Memes' },
  { value: '/community', labelRu: 'Форум / Сообщество', labelEn: 'Forum / Community' },
  { value: '/games?tab=leaderboard', labelRu: 'Рейтинг', labelEn: 'Leaderboard' },
  { value: '/profile?tab=inventory', labelRu: 'Профиль / Магазин', labelEn: 'Profile / Shop' },
  { value: '__custom__', labelRu: 'Свой путь вручную', labelEn: 'Custom path' },
] as const;

function formatNewsLinkLabel(linkValue: string | null | undefined, lang: 'ru' | 'en'): string {
  const clean = (linkValue || '').trim();
  if (!clean) {
    return lang === 'ru' ? 'Без перехода (просто прочитать)' : 'No navigation (read only)';
  }
  const preset = NEWS_ROUTE_PRESETS.find((p) => p.value !== '__custom__' && p.value === clean);
  if (preset) {
    return `${lang === 'ru' ? preset.labelRu : preset.labelEn} (${clean})`;
  }
  return clean;
}

export const AdminNewsTab: React.FC<CommonProps> = ({ lang, onNotify, onError }) => {
  const [newsList, setNewsList] = useState<any[]>([]);
  const [subscribersCount, setSubscribersCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [routePreset, setRoutePreset] = useState<string>('');
  const [customPath, setCustomPath] = useState<string>('');
  const [sending, setSending] = useState(false);

  const resolvedLink =
    routePreset === '__custom__'
      ? customPath.trim()
        ? customPath.trim().startsWith('/')
          ? customPath.trim()
          : `/${customPath.trim()}`
        : ''
      : routePreset;

  const loadNews = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/news', { cache: 'no-store' });
      const data = await safeJson<{ news?: any[]; subscribers_count?: number; error?: string }>(res, {});
      if (res.ok) {
        setNewsList(data.news || []);
        setSubscribersCount(Number(data.subscribers_count || 0));
      } else if (data.error) {
        onError(data.error);
      }
    } catch (e: any) {
      onError(e?.message || 'Failed to load site news');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNews();
  }, []);

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || !title.trim() || !message.trim()) return;
    if (routePreset === '__custom__' && !customPath.trim()) {
      onError(
        lang === 'ru'
          ? 'Укажите путь вручную или выберите раздел из списка.'
          : 'Enter a custom path or choose a preset destination.'
      );
      return;
    }
    setSending(true);
    try {
      const res = await authFetch('/api/admin/news/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          link: resolvedLink,
        }),
      });
      const data = await safeJson<{ ok?: boolean; sent_count?: number; error?: string }>(res, {});
      if (res.ok) {
        onNotify(
          lang === 'ru'
            ? `Новость разослана подписчикам (${data.sent_count ?? 0})`
            : `Broadcast sent to ${data.sent_count ?? 0} subscribers`
        );
        setTitle('');
        setMessage('');
        setRoutePreset('');
        setCustomPath('');
        window.dispatchEvent(new CustomEvent('aod-notifications-refresh'));
        await loadNews();
      } else {
        onError(data.error || 'Failed to broadcast news');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      key="news"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 lg:grid-cols-12 gap-6"
    >
      <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-3">
          <div>
            <h3 className="font-title text-xl text-ivory uppercase tracking-wide flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-[#c49298]" />
              <span>{lang === 'ru' ? 'Рассылка новостей сайта' : 'Site News Broadcast'}</span>
            </h3>
            <p className="text-xs text-ash mt-1">
              {lang === 'ru'
                ? 'Отправляет уведомление в колокольчик всем подписчикам новостей.'
                : 'Delivers an in-app notification to opted-in subscribers.'}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#181420] border border-white/10 font-mono text-[10px] text-bone shrink-0">
            <Users className="w-3 h-3 text-[#c49298]" />
            <span>{subscribersCount}</span>
          </span>
        </div>

        <form onSubmit={handleBroadcast} className="space-y-4 text-xs font-sans">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
              {lang === 'ru' ? 'Заголовок новости *' : 'Title *'}
            </label>
            <input
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={lang === 'ru' ? 'Обновление архива и режима викторины' : 'Archive & Quiz Update'}
              className="w-full px-3.5 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
              {lang === 'ru' ? 'Текст уведомления *' : 'Message *'}
            </label>
            <textarea
              required
              rows={4}
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={lang === 'ru' ? 'Коротко опишите, что изменилось...' : 'Brief summary...'}
              className="w-full px-3.5 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-white/30 resize-none"
            />
          </div>
          <div className="space-y-2.5">
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ash">
              {lang === 'ru' ? 'Куда перекинет при клике' : 'Click Destination'}
            </label>
            <select
              value={routePreset}
              onChange={(e) => setRoutePreset(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-white/30 cursor-pointer"
            >
              {NEWS_ROUTE_PRESETS.map((opt) => (
                <option key={opt.value || '__none__'} value={opt.value} className="bg-[#16151a] text-white">
                  {lang === 'ru' ? opt.labelRu : opt.labelEn}
                </option>
              ))}
            </select>

            {routePreset === '__custom__' && (
              <div className="space-y-1.5 pt-1">
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="/archive?album=alb_nightmortan"
                  className="w-full px-3.5 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono focus:outline-none focus:border-white/30"
                />
                <p className="text-[11px] text-ash/75 leading-snug">
                  {lang === 'ru'
                    ? 'Например: /archive, /games?tab=leaderboard или /community?post=ID'
                    : 'Example: /archive, /games?tab=leaderboard, or /community?post=ID'}
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={sending || !title.trim() || !message.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#821c2c] hover:bg-[#962537] border border-[#a4283c] text-white font-mono text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {sending
                ? lang === 'ru' ? 'Отправка...' : 'Sending...'
                : lang === 'ru' ? `Отправить (${subscribersCount})` : `Broadcast (${subscribersCount})`}
            </span>
          </button>
        </form>
      </div>

      <div className="lg:col-span-7 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <h3 className="font-title text-xl text-ivory uppercase tracking-wider border-b border-white/[0.06] pb-3">
          {lang === 'ru' ? 'История рассылок' : 'Broadcast History'} ({newsList.length})
        </h3>
        {loading ? (
          <div className="py-10 text-center font-mono text-xs text-ash">{lang === 'ru' ? 'Загрузка...' : 'Loading...'}</div>
        ) : newsList.length === 0 ? (
          <div className="py-10 text-center font-mono text-xs text-ash">{lang === 'ru' ? 'Рассылок ещё не было.' : 'No broadcasts sent yet.'}</div>
        ) : (
          <div className="divide-y divide-white/[0.05] max-h-[520px] overflow-y-auto pr-1">
            {newsList.map((n) => (
              <div key={n.id} className="py-3.5 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-ivory font-medium">{n.title}</span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/[0.06] text-bone">
                    {lang === 'ru' ? 'Получателей:' : 'Sent:'} {n.sent_count ?? 0}
                  </span>
                </div>
                <p className="text-xs text-ash leading-relaxed">{n.message}</p>
                <div className="font-mono text-[10px] text-ash/60 flex flex-wrap gap-2">
                  <span>{formatNewsLinkLabel(n.link, lang)}</span>
                  <span>·</span>
                  <span>@{n.author_nickname || 'admin'}</span>
                  <span>·</span>
                  <span>{new Date(n.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

interface RulesProps extends CommonProps {
  readOnly: boolean;
}

export const AdminRulesTab: React.FC<RulesProps> = ({ lang, readOnly, onNotify, onError }) => {
  const [rules, setRules] = useState<CommunityRulesPayload>({
    intro_ru: '',
    intro_en: '',
    footer_ru: '',
    footer_en: '',
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/rules', { cache: 'no-store' });
        const data = await safeJson<{ rules?: CommunityRulesPayload }>(res, {});
        if (active && res.ok && data.rules) {
          setRules(data.rules);
        }
      } catch {} finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const updateItem = (idx: number, patch: Partial<CommunityRuleItem>) => {
    setRules((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= rules.items.length) return;
    setRules((prev) => {
      const next = [...prev.items];
      const [removed] = next.splice(idx, 1);
      next.splice(target, 0, removed);
      return { ...prev, items: next };
    });
  };

  const removeItem = (idx: number) => {
    setRules((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  };

  const addItem = () => {
    setRules((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { title_ru: '', title_en: '', body_ru: '', body_en: '' },
      ],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || saving) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/admin/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const data = await safeJson<{ rules?: CommunityRulesPayload; error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || (lang === 'ru' ? 'Не удалось сохранить правила' : 'Failed to save rules'));
        return;
      }
      if (data.rules) setRules(data.rules);
      onNotify(lang === 'ru' ? 'Правила сообщества обновлены' : 'Community rules updated');
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-10 text-center font-mono text-xs text-ash">
        {lang === 'ru' ? 'Загрузка правил...' : 'Loading rules...'}
      </div>
    );
  }

  if (readOnly) {
    return (
      <motion.div
        key="rules-readonly"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-5 max-w-3xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <h3 className="font-title text-2xl text-ivory uppercase tracking-wide flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#c49298]" />
            <span>{lang === 'ru' ? 'Правила сообщества' : 'Community Rules'}</span>
          </h3>
          <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-white/[0.06] text-ash">
            {lang === 'ru' ? 'Только чтение' : 'Read Only'}
          </span>
        </div>

        <p className="text-sm text-bone leading-relaxed">
          {lang === 'ru' ? rules.intro_ru : rules.intro_en}
        </p>

        <div className="space-y-3">
          {rules.items.map((item, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-[#16151a] border border-white/[0.07] space-y-1">
              <div className="font-serif text-base text-ivory">
                {idx + 1}. {lang === 'ru' ? item.title_ru : item.title_en}
              </div>
              <p className="text-xs text-ash leading-relaxed">
                {lang === 'ru' ? item.body_ru : item.body_en}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs text-ash/80 border-t border-white/[0.06] pt-3">
          {lang === 'ru' ? rules.footer_ru : rules.footer_en}
        </p>
      </motion.div>
    );
  }

  return (
    <motion.form
      key="rules-admin"
      onSubmit={handleSave}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-[#c49298]" />
          <h3 className="font-title text-2xl text-ivory uppercase tracking-wide">
            {lang === 'ru' ? 'Редактор правил сообщества' : 'Community Rules Editor'}
          </h3>
        </div>
        <button
          type="button"
          onClick={addItem}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 font-mono text-[11px] uppercase text-white cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{lang === 'ru' ? 'Добавить пункт' : 'Add Rule'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div>
          <label className="block font-mono text-[10px] uppercase text-ash mb-1">Вступление (RU)</label>
          <textarea
            rows={2}
            value={rules.intro_ru}
            onChange={(e) => setRules((r) => ({ ...r, intro_ru: e.target.value }))}
            className="w-full px-3 py-2 bg-[#16151a] border border-white/10 rounded-lg text-white focus:outline-none"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase text-ash mb-1">Intro (EN)</label>
          <textarea
            rows={2}
            value={rules.intro_en}
            onChange={(e) => setRules((r) => ({ ...r, intro_en: e.target.value }))}
            className="w-full px-3 py-2 bg-[#16151a] border border-white/10 rounded-lg text-white focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-3">
        {rules.items.map((item, idx) => (
          <div key={idx} className="p-4 rounded-xl bg-[#16151a] border border-white/[0.08] space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase text-bone">
                {lang === 'ru' ? `Пункт #${idx + 1}` : `Rule #${idx + 1}`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveItem(idx, -1)}
                  className="p-1 rounded border border-white/10 text-ash hover:text-white disabled:opacity-30 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === rules.items.length - 1}
                  onClick={() => moveItem(idx, 1)}
                  className="p-1 rounded border border-white/10 text-ash hover:text-white disabled:opacity-30 cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="p-1 rounded border border-white/10 text-ash hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="text"
                required
                value={item.title_ru}
                onChange={(e) => updateItem(idx, { title_ru: e.target.value })}
                placeholder="Заголовок (RU) *"
                className="px-3 py-2 bg-[#111015] border border-white/10 rounded text-white"
              />
              <input
                type="text"
                value={item.title_en}
                onChange={(e) => updateItem(idx, { title_en: e.target.value })}
                placeholder="Title (EN)"
                className="px-3 py-2 bg-[#111015] border border-white/10 rounded text-white"
              />
              <textarea
                rows={2}
                required
                value={item.body_ru}
                onChange={(e) => updateItem(idx, { body_ru: e.target.value })}
                placeholder="Текст правила (RU) *"
                className="px-3 py-2 bg-[#111015] border border-white/10 rounded text-white"
              />
              <textarea
                rows={2}
                value={item.body_en}
                onChange={(e) => updateItem(idx, { body_en: e.target.value })}
                placeholder="Rule text (EN)"
                className="px-3 py-2 bg-[#111015] border border-white/10 rounded text-white"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div>
          <label className="block font-mono text-[10px] uppercase text-ash mb-1">Примечание внизу (RU)</label>
          <textarea
            rows={2}
            value={rules.footer_ru}
            onChange={(e) => setRules((r) => ({ ...r, footer_ru: e.target.value }))}
            className="w-full px-3 py-2 bg-[#16151a] border border-white/10 rounded-lg text-white focus:outline-none"
          />
        </div>
        <div>
          <label className="block font-mono text-[10px] uppercase text-ash mb-1">Footer Note (EN)</label>
          <textarea
            rows={2}
            value={rules.footer_en}
            onChange={(e) => setRules((r) => ({ ...r, footer_en: e.target.value }))}
            className="w-full px-3 py-2 bg-[#16151a] border border-white/10 rounded-lg text-white focus:outline-none"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || rules.items.length === 0}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#821c2c] hover:bg-[#962537] border border-[#a83145] text-white font-mono text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? (lang === 'ru' ? 'Сохранение...' : 'Saving...') : (lang === 'ru' ? 'Сохранить правила' : 'Save Rules')}</span>
        </button>
      </div>
    </motion.form>
  );
};
