import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { Comment } from '../types/index.js';
import { safeJson } from '../utils/logic.js';
import { formatHandle, renderEquippedBadge, renderEquippedTitle } from '../utils/cosmetics.js';
import { dispatchAchievementUnlocked } from './AchievementToast.js';
import { RulesModal, hasAcceptedRules } from './RulesModal.js';
import {
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Send,
  Reply,
  CornerDownRight,
  Trash2,
  EyeOff,
  Eye,
  X,
} from 'lucide-react';

interface ReleaseCommentsProps {
  releaseType: 'album' | 'single';
  releaseId: string;
  compact?: boolean;
  defaultOpen?: boolean;
}

const DEFAULT_AVATAR = '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg';

const formatCommentDate = (dateStr?: string) => {
  if (!dateStr) return '';
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export const ReleaseComments: React.FC<ReleaseCommentsProps> = ({
  releaseType,
  releaseId,
  compact = false,
  defaultOpen = true,
}) => {
  const { user, openAuth, refresh } = useAuth();
  const [expanded, setExpanded] = useState(defaultOpen);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const isStaff = Boolean(user && (user.role_id === 'admin' || user.role_id === 'moderator'));

  const loadComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/archive/${releaseType}/${encodeURIComponent(releaseId)}/comments`, {
        cache: 'no-store',
      });
      const data = await safeJson<{ comments?: Comment[] }>(res, { comments: [] });
      if (res.ok) {
        setComments(Array.isArray(data.comments) ? data.comments : []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [releaseType, releaseId]);

  useEffect(() => {
    loadComments();
    setReplyTo(null);
    setText('');
    setError(null);
  }, [loadComments]);

  const submitCommentNow = async () => {
    if (!user || !text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch(`/api/archive/${releaseType}/${encodeURIComponent(releaseId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text.trim(),
          parent_id: replyTo?.id || null,
        }),
      });
      const data = await safeJson<any>(res, {});
      if (res.ok) {
        setText('');
        setReplyTo(null);
        if (data?.newly_unlocked_achievements?.length > 0) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        refresh();
        await loadComments();
      } else {
        setError(data?.error || 'Не удалось отправить комментарий.');
      }
    } catch {
      setError('Ошибка сети при отправке комментария.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuth('login');
      return;
    }
    if (!text.trim()) return;
    if (!hasAcceptedRules(user)) {
      setRulesOpen(true);
      return;
    }
    submitCommentNow();
  };

  const handleToggleHide = async (commentId: string) => {
    try {
      const res = await authFetch(`/api/community/comments/${encodeURIComponent(commentId)}/hide`, {
        method: 'POST',
      });
      if (res.ok) {
        await loadComments();
      }
    } catch {}
  };

  const handleDelete = async (commentId: string) => {
    try {
      const res = await authFetch(`/api/community/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await loadComments();
      }
    } catch {}
  };

  const goToProfile = (nickname?: string) => {
    if (!nickname) return;
    window.dispatchEvent(new CustomEvent('navigate-profile', { detail: nickname }));
  };

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesFor = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

  return (
    <div className={`rounded-lg border border-white/[0.08] bg-[#100f13] ${compact ? 'p-4' : 'p-5 sm:p-6'} space-y-3 text-left`}>
      <RulesModal
        isOpen={rulesOpen}
        mode="accept"
        userId={user?.id}
        onClose={() => setRulesOpen(false)}
        onAccepted={() => {
          setRulesOpen(false);
          refresh();
          submitCommentNow();
        }}
      />

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer group"
      >
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-[#ded8ce] group-hover:text-white flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-[#8e877e]" />
          <span>Комментарии к релизу</span>
          <span className="text-[#736c64] tabular-nums">({comments.length})</span>
        </span>
        <span className="text-[#736c64] group-hover:text-white transition-colors">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-white/[0.06]">
          <form onSubmit={handleSubmit} className="space-y-2">
            {replyTo && (
              <div className="flex items-center justify-between px-2.5 py-1 rounded bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-[#a39b8b]">
                <span className="flex items-center gap-1.5 truncate">
                  <CornerDownRight className="w-3 h-3 shrink-0" />
                  <span>Ответ для {replyTo.author}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={1500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={!user || submitting}
                placeholder={
                  user
                    ? replyTo
                      ? 'Напишите ответ...'
                      : 'Поделитесь впечатлением о релизе...'
                    : 'Войдите, чтобы оставить комментарий...'
                }
                className="flex-1 bg-[#151419] border border-white/[0.08] rounded-md px-3 py-2 text-xs text-[#f2eee9] placeholder-[#6e675e] focus:outline-none focus:border-white/25"
              />
              {user ? (
                <button
                  type="submit"
                  disabled={!text.trim() || submitting}
                  aria-label="Отправить комментарий"
                  className="px-3.5 py-2 rounded-md bg-white/[0.09] hover:bg-white/[0.16] border border-white/[0.12] text-white disabled:opacity-40 transition-colors cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuth('login')}
                  className="px-3 py-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-[11px] font-mono text-[#f2eee9] cursor-pointer shrink-0"
                >
                  Войти
                </button>
              )}
            </div>
            {error && <p className="text-[11px] text-[#e28593]">{error}</p>}
          </form>

          {loading ? (
            <div className="py-4 text-center font-mono text-[11px] text-[#736c64]">
              Загрузка комментариев...
            </div>
          ) : comments.length === 0 ? (
            <div className="py-4 text-center text-xs text-[#736c64]">
              Пока никто не прокомментировал этот релиз.
            </div>
          ) : (
            <div className={`${compact ? 'max-h-56' : 'max-h-72'} overflow-y-auto pr-1 space-y-2.5`}>
              {topLevel.map((cm) => {
                const replies = repliesFor(cm.id);
                const hidden = Boolean(cm.is_hidden);
                return (
                  <div key={cm.id} className="space-y-2">
                    <div
                      className={`p-3 rounded-md border space-y-1.5 ${
                        hidden
                          ? 'bg-[#1a1115]/60 border-[#821c2c]/35 opacity-70'
                          : 'bg-[#141319] border-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => goToProfile(cm.author_nickname)}
                            className={`w-6 h-6 rounded-full overflow-hidden bg-black shrink-0 cursor-pointer ${cm.author_frame || 'border border-white/10'}`}
                          >
                            <img
                              src={cm.author_avatar || DEFAULT_AVATAR}
                              alt={cm.author_name}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => goToProfile(cm.author_nickname)}
                            className={`text-xs font-medium truncate hover:underline cursor-pointer ${cm.author_name_style || 'text-[#f2eee9]'}`}
                          >
                            {cm.author_name || cm.author_nickname}
                          </button>
                          <span className="font-mono text-[10px] text-[#736c64] hidden sm:inline">
                            {formatHandle(cm.author_nickname)}
                          </span>
                          {renderEquippedTitle(cm.author_title, 'ru', true)}
                          {renderEquippedBadge(cm.author_badge, 'ru', true)}
                          {hidden && (
                            <span className="font-mono text-[10px] text-[#e28593]">скрыт</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono text-[10px] text-[#6e675e] tabular-nums">
                            {formatCommentDate(cm.created_at)}
                          </span>
                          {isStaff && (
                            <button
                              type="button"
                              onClick={() => handleToggleHide(cm.id)}
                              className="p-1 text-[#736c64] hover:text-[#d4af68] transition-colors cursor-pointer"
                              title={hidden ? 'Показать комментарий' : 'Скрыть комментарий'}
                            >
                              {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                            </button>
                          )}
                          {user && (user.id === cm.user_id || isStaff) && (
                            <button
                              type="button"
                              onClick={() => handleDelete(cm.id)}
                              className="p-1 text-[#736c64] hover:text-[#e28593] transition-colors cursor-pointer"
                              title="Удалить комментарий"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-xs text-[#ded8ce] leading-relaxed pl-8 whitespace-pre-wrap break-words">
                        {cm.content}
                      </p>

                      <div className="pl-8 pt-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!user) openAuth('login');
                            else setReplyTo({ id: cm.id, author: cm.author_name || cm.author_nickname });
                          }}
                          className="inline-flex items-center gap-1 font-mono text-[10px] text-[#8e877e] hover:text-white cursor-pointer"
                        >
                          <Reply className="w-3 h-3" />
                          <span>Ответить</span>
                        </button>
                      </div>
                    </div>

                    {replies.length > 0 && (
                      <div className="pl-5 ml-3 border-l border-white/[0.06] space-y-1.5">
                        {replies.map((rep) => {
                          const repHidden = Boolean(rep.is_hidden);
                          return (
                            <div
                              key={rep.id}
                              className={`p-2.5 rounded-md border space-y-1 ${
                                repHidden
                                  ? 'bg-[#1a1115]/60 border-[#821c2c]/35 opacity-70'
                                  : 'bg-[#18171f] border-white/[0.04]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => goToProfile(rep.author_nickname)}
                                    className={`text-[11px] font-medium truncate hover:underline cursor-pointer ${rep.author_name_style || 'text-[#f2eee9]'}`}
                                  >
                                    {rep.author_name || rep.author_nickname}
                                  </button>
                                  {repHidden && (
                                    <span className="font-mono text-[10px] text-[#e28593]">скрыт</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="font-mono text-[10px] text-[#6e675e] tabular-nums">
                                    {formatCommentDate(rep.created_at)}
                                  </span>
                                  {isStaff && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleHide(rep.id)}
                                      className="p-0.5 text-[#736c64] hover:text-[#d4af68] cursor-pointer"
                                      title={repHidden ? 'Показать' : 'Скрыть'}
                                    >
                                      {repHidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                    </button>
                                  )}
                                  {user && (user.id === rep.user_id || isStaff) && (
                                    <button
                                      type="button"
                                      onClick={() => handleDelete(rep.id)}
                                      className="p-0.5 text-[#736c64] hover:text-[#e28593] cursor-pointer"
                                      title="Удалить"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-[#ded8ce] leading-relaxed whitespace-pre-wrap break-words">
                                {rep.content}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
