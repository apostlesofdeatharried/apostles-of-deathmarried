import React, { useState, useEffect } from 'react';
import { authFetch } from '../context/AuthContext.js';
import { safeJson } from '../utils/logic.js';
import { ShieldAlert, X, Check } from 'lucide-react';

const RULES_STORAGE_PREFIX = 'aod_accepted_rules_v1_';

export function hasAcceptedRules(user?: { id?: string; accepted_rules?: number } | null): boolean {
  if (!user?.id) return false;
  if (Number(user.accepted_rules || 0) === 1) return true;
  try {
    return localStorage.getItem(`${RULES_STORAGE_PREFIX}${user.id}`) === '1';
  } catch {
    return false;
  }
}

export function markRulesAcceptedLocally(userId: string) {
  try {
    localStorage.setItem(`${RULES_STORAGE_PREFIX}${userId}`, '1');
  } catch {}
}

interface RulesModalProps {
  isOpen: boolean;
  mode: 'accept' | 'view';
  userId?: string;
  onClose: () => void;
  onAccepted?: () => void;
}

const RULES_LIST = [
  {
    title: 'Без 18+ и NSFW',
    body: 'Никакой порнографии, эротики и откровенного контента — ни в текстах, ни в картинках, ни в ссылках.',
  },
  {
    title: 'Без насилия, крови и жести',
    body: 'Запрещены шок-контент, реальная кровь, расчленёнка, угрозы и любые призывы к причинению вреда.',
  },
  {
    title: 'Без оскорблений и травли',
    body: 'Спорить о музыке и вкусах — нормально. Переходить на личности, унижать участников или разжигать ненависть — нет.',
  },
  {
    title: 'Без спама и рекламы',
    body: 'Никакого флуда, реферальных ссылок, рекламы чужих каналов/магазинов, ботов и скама.',
  },
];

export const RulesModal: React.FC<RulesModalProps> = ({
  isOpen,
  mode,
  userId,
  onClose,
  onAccepted,
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose, saving]);

  if (!isOpen) return null;

  const handleAccept = async () => {
    if (!userId) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/rules/accept', { method: 'POST' });
      const data = await safeJson<{ ok?: boolean; error?: string }>(res, {});
      if (res.ok && data.ok) {
        markRulesAcceptedLocally(userId);
        onAccepted?.();
      } else {
        setError(data.error || 'Не удалось сохранить согласие. Попробуйте ещё раз.');
      }
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Правила сообщества"
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/82 backdrop-blur-sm animate-fadeIn"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="w-full max-w-md max-h-[85dvh] flex flex-col overflow-hidden rounded-xl border border-white/[0.12] bg-[#0e0d12] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Fixed Header */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-white/[0.08] bg-[#131218]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-[#261018] border border-[#821c2c]/50 flex items-center justify-center text-[#e28593] shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-sm sm:text-base tracking-wider uppercase text-[#f2eee9] truncate">
                Правила сообщества
              </h2>
              <p className="text-[11px] text-[#8e877e] truncate">
                Форум и творчество Apostles of deathmarried
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть правила"
            className="shrink-0 w-10 h-10 -mr-1.5 rounded-lg flex items-center justify-center text-[#c7c0b6] hover:text-white hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-3.5">
          <p className="text-xs text-[#c7c0b6] leading-relaxed">
            Тут общаются слушатели и авторы вокруг музыки deathmarried. Чтобы всем было комфортно, держимся четырёх простых правил:
          </p>

          <ul className="space-y-2.5">
            {RULES_LIST.map((rule, idx) => (
              <li
                key={rule.title}
                className="rounded-lg border border-white/[0.06] bg-[#14131a] px-3.5 py-2.5 space-y-0.5"
              >
                <div className="text-xs font-medium text-[#f2eee9]">
                  {idx + 1}. {rule.title}
                </div>
                <p className="text-[11px] text-[#8e877e] leading-relaxed">{rule.body}</p>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-[#736c64] leading-relaxed">
            За нарушения модераторы могут скрыть или удалить публикацию, а при повторах — ограничить доступ к аккаунту.
          </p>

          {error && (
            <div className="p-2.5 rounded-md bg-[#2a1016] border border-[#821c2c] text-xs text-[#f2b8c3]">
              {error}
            </div>
          )}
        </div>

        {/* 3. Fixed Footer */}
        <div className="shrink-0 flex items-center justify-end gap-2.5 px-4 sm:px-5 py-3.5 border-t border-white/[0.08] bg-[#131218]">
          {mode === 'accept' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider text-[#8e877e] hover:text-white transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleAccept}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#f2eee9] hover:bg-white text-[#09090b] text-xs font-mono uppercase tracking-wider font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Сохранение...' : 'Согласен'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-white/[0.1] hover:bg-white/[0.16] border border-white/[0.14] text-xs font-mono uppercase tracking-wider text-[#f2eee9] transition-colors cursor-pointer"
            >
              Закрыть
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
