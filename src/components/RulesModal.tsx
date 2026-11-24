import React, { useState, useEffect } from 'react';
import { authFetch } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { safeJson } from '../utils/logic.js';
import { CommunityRulesPayload } from '../types/index.js';
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

const FALLBACK_RULES: CommunityRulesPayload = {
  intro_ru:
    'Тут общаются слушатели и авторы вокруг музыки deathmarried. Чтобы всем было комфортно, держимся простых правил:',
  intro_en:
    'Listeners and creators gather here around deathmarried music. To keep the space welcoming, we follow simple rules:',
  footer_ru:
    'За нарушения модераторы могут скрыть или удалить публикацию, а при повторах — ограничить доступ к аккаунту.',
  footer_en:
    'Moderators may hide or remove content that breaks the rules, and repeated violations can lead to account restrictions.',
  items: [
    {
      title_ru: 'Без 18+ и NSFW',
      title_en: 'No 18+ or NSFW',
      body_ru: 'Никакой порнографии, эротики и откровенного контента — ни в текстах, ни в картинках, ни в ссылках.',
      body_en: 'No pornography, erotica, or explicit adult content in text, images, or external links.',
    },
    {
      title_ru: 'Без насилия, крови и жести',
      title_en: 'No violence or gore',
      body_ru: 'Запрещены шок-контент, реальная кровь, расчленёнка, угрозы и любые призывы к причинению вреда.',
      body_en: 'Shock content, real gore, threats, and any calls to violence or self-harm are strictly forbidden.',
    },
    {
      title_ru: 'Без оскорблений и травли',
      title_en: 'No harassment or hate',
      body_ru: 'Спорить о музыке и вкусах — нормально. Переходить на личности, унижать участников или разжигать ненависть — нет.',
      body_en: 'Debating music and taste is welcome; personal attacks, bullying, and hate speech are not.',
    },
    {
      title_ru: 'Без спама и рекламы',
      title_en: 'No spam or promotion',
      body_ru: 'Никакого флуда, реферальных ссылок, рекламы чужих каналов/магазинов, ботов и скама.',
      body_en: 'No flooding, referral links, unsolicited promotion of external channels/stores, bots, or scams.',
    },
  ],
};

export const RulesModal: React.FC<RulesModalProps> = ({
  isOpen,
  mode,
  userId,
  onClose,
  onAccepted,
}) => {
  const { lang } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesData, setRulesData] = useState<CommunityRulesPayload>(FALLBACK_RULES);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetch('/api/rules', { cache: 'no-store' })
      .then((res) => safeJson<{ rules?: CommunityRulesPayload }>(res, {}))
      .then((data) => {
        if (active && data?.rules && Array.isArray(data.rules.items) && data.rules.items.length > 0) {
          setRulesData(data.rules);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

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
        setError(
          data.error ||
            (lang === 'ru' ? 'Не удалось сохранить согласие. Попробуйте ещё раз.' : 'Could not save acceptance. Try again.')
        );
      }
    } catch {
      setError(lang === 'ru' ? 'Ошибка сети. Попробуйте ещё раз.' : 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'ru' ? 'Правила сообщества' : 'Community Rules'}
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
                {lang === 'ru' ? 'Правила сообщества' : 'Community Rules'}
              </h2>
              <p className="text-[11px] text-[#8e877e] truncate">
                {lang === 'ru' ? 'Форум и творчество Apostles of deathmarried' : 'Apostles of deathmarried Forum & Gallery'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={lang === 'ru' ? 'Закрыть правила' : 'Close rules'}
            className="shrink-0 w-10 h-10 -mr-1.5 rounded-lg flex items-center justify-center text-[#c7c0b6] hover:text-white hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-3.5">
          <p className="text-xs text-[#c7c0b6] leading-relaxed">
            {lang === 'ru' ? rulesData.intro_ru : rulesData.intro_en || rulesData.intro_ru}
          </p>

          <ul className="space-y-2.5">
            {rulesData.items.map((rule, idx) => (
              <li
                key={`${rule.title_ru}_${idx}`}
                className="rounded-lg border border-white/[0.06] bg-[#14131a] px-3.5 py-2.5 space-y-0.5"
              >
                <div className="text-xs font-medium text-[#f2eee9]">
                  {idx + 1}. {lang === 'ru' ? rule.title_ru : rule.title_en || rule.title_ru}
                </div>
                <p className="text-[11px] text-[#8e877e] leading-relaxed">
                  {lang === 'ru' ? rule.body_ru : rule.body_en || rule.body_ru}
                </p>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-[#736c64] leading-relaxed">
            {lang === 'ru' ? rulesData.footer_ru : rulesData.footer_en || rulesData.footer_ru}
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
                {lang === 'ru' ? 'Отмена' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleAccept}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#f2eee9] hover:bg-white text-[#09090b] text-xs font-mono uppercase tracking-wider font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                {saving
                  ? lang === 'ru'
                    ? 'Сохранение...'
                    : 'Saving...'
                  : lang === 'ru'
                    ? 'Согласен'
                    : 'Accept'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-white/[0.1] hover:bg-white/[0.16] border border-white/[0.14] text-xs font-mono uppercase tracking-wider text-[#f2eee9] transition-colors cursor-pointer"
            >
              {lang === 'ru' ? 'Закрыть' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

