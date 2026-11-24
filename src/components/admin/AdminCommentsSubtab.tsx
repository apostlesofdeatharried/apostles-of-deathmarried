import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Trash2, Search, RotateCcw, MessageSquare } from 'lucide-react';
import { authFetch } from '../../context/AuthContext.js';
import { safeJson } from '../../utils/logic.js';

interface Props {
  lang: 'ru' | 'en';
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}

export const AdminCommentsSubtab: React.FC<Props> = ({ lang, onNotify, onError }) => {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'all' | 'releases' | 'forum' | 'creations'>('all');
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadComments = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        scope,
        filter,
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      const res = await authFetch(`/api/admin/comments?${qs.toString()}`, { cache: 'no-store' });
      const data = await safeJson<{ comments?: any[]; error?: string }>(res, {});
      if (res.ok) {
        setComments(data.comments || []);
      } else if (data.error) {
        onError(data.error);
      }
    } catch (e: any) {
      onError(e?.message || 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      loadComments();
    }, 150);
    return () => window.clearTimeout(t);
  }, [scope, filter, search]);

  const handleToggleHide = async (c: any) => {
    setBusyId(c.id);
    try {
      const res = await authFetch(`/api/community/comments/${c.id}/hide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: !c.is_hidden }),
      });
      if (res.ok) {
        onNotify(
          !c.is_hidden
            ? lang === 'ru' ? 'Комментарий скрыт' : 'Comment hidden'
            : lang === 'ru' ? 'Комментарий восстановлен' : 'Comment restored'
        );
        await loadComments();
      } else {
        const d = await safeJson<{ error?: string }>(res, {});
        onError(d.error || 'Error');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (c: any) => {
    setBusyId(c.id);
    try {
      const res = await authFetch(`/api/community/comments/${c.id}`, { method: 'DELETE' });
      if (res.ok) {
        onNotify(lang === 'ru' ? 'Комментарий удалён' : 'Comment deleted');
        await loadComments();
      } else {
        const d = await safeJson<{ error?: string }>(res, {});
        onError(d.error || 'Failed to delete comment');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setBusyId(null);
    }
  };

  const TARGET_LABELS: Record<string, { ru: string; en: string }> = {
    album: { ru: 'Альбом', en: 'Album' },
    single: { ru: 'Сингл', en: 'Single' },
    post: { ru: 'Форум', en: 'Forum' },
    creation: { ru: 'Творчество', en: 'Creation' },
    unknown: { ru: 'Другое', en: 'Other' },
  };

  return (
    <div className="space-y-4">
      <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          {([
            { id: 'all', label: lang === 'ru' ? 'Все' : 'All' },
            { id: 'releases', label: lang === 'ru' ? 'Релизы' : 'Releases' },
            { id: 'forum', label: lang === 'ru' ? 'Форум' : 'Forum' },
            { id: 'creations', label: lang === 'ru' ? 'Творчество' : 'Creations' },
          ] as const).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScope(s.id)}
              className={`px-3 py-1.5 rounded-lg uppercase cursor-pointer ${
                scope === s.id
                  ? 'bg-white/[0.12] text-white border border-white/20'
                  : 'text-ash hover:text-white border border-white/10'
              }`}
            >
              {s.label}
            </button>
          ))}

          <span className="text-white/15">|</span>

          {([
            { id: 'all', label: lang === 'ru' ? 'Любые' : 'Any' },
            { id: 'visible', label: lang === 'ru' ? 'Видимые' : 'Visible' },
            { id: 'hidden', label: lang === 'ru' ? 'Скрытые' : 'Hidden' },
          ] as const).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1.5 rounded-lg uppercase cursor-pointer ${
                filter === f.id
                  ? 'bg-[#821c2c]/40 text-white border border-[#821c2c]'
                  : 'text-ash hover:text-white border border-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-ash/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'ru' ? 'Поиск по тексту или автору...' : 'Search text or author...'}
              className="w-full pl-9 pr-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-xs font-mono text-white focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={loadComments}
            className="p-2 rounded-lg border border-white/10 text-ash hover:text-white cursor-pointer"
            title={lang === 'ru' ? 'Обновить' : 'Refresh'}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-10 text-center font-mono text-xs text-ash">
          {lang === 'ru' ? 'Загрузка комментариев...' : 'Loading comments...'}
        </div>
      ) : comments.length === 0 ? (
        <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-10 text-center font-mono text-xs text-ash">
          {lang === 'ru' ? 'Комментарии по выбранному фильтру не найдены.' : 'No comments match the selected filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const targetLabel = TARGET_LABELS[c.target_type]?.[lang] || c.target_type;
            return (
              <div
                key={c.id}
                className={`bg-[#100f13] border rounded-xl p-4 space-y-2.5 ${
                  c.is_hidden ? 'border-amber-800/50 opacity-75' : 'border-white/[0.08]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ash">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.06] text-bone uppercase">
                      <MessageSquare className="w-3 h-3" />
                      {targetLabel}
                    </span>
                    {c.target_title && (
                      <span className="text-ivory truncate max-w-[220px]">«{c.target_title}»</span>
                    )}
                    <span>·</span>
                    <strong className="text-white">@{c.author_nickname}</strong>
                    <span>·</span>
                    <span>{new Date(c.created_at).toLocaleString()}</span>
                    {Boolean(c.is_hidden) && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-200 uppercase">
                        {lang === 'ru' ? 'Скрыт' : 'Hidden'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase shrink-0">
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => handleToggleHide(c)}
                      className="px-2.5 py-1.5 rounded-lg border border-white/15 hover:bg-white/[0.08] text-bone cursor-pointer flex items-center gap-1 disabled:opacity-50"
                    >
                      {c.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      <span>{c.is_hidden ? (lang === 'ru' ? 'Показать' : 'Show') : (lang === 'ru' ? 'Скрыть' : 'Hide')}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === c.id}
                      onClick={() => handleDelete(c)}
                      className="px-2.5 py-1.5 rounded-lg border border-red-900/70 hover:bg-red-950/60 text-red-300 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{lang === 'ru' ? 'Удалить' : 'Delete'}</span>
                    </button>
                  </div>
                </div>

                <p className="text-xs text-bone font-sans whitespace-pre-line bg-[#16151a] p-3 rounded-lg border border-white/[0.04]">
                  {c.content}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
