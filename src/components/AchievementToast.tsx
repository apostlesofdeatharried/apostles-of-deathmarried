import React, { useEffect, useState } from 'react';
import { Award, Crown, Disc, Eye, Flame, Moon, Sparkles, Tag, Trophy, X } from 'lucide-react';
import { useI18n } from '../context/I18nContext.js';

export interface UnlockedAchievementToastItem {
  id: string;
  slug: string;
  title_ru: string;
  title_en?: string;
  xp_reward?: number;
  rarity?: string;
  difficulty_tier?: string;
  icon?: string;
}

const EVENT_NAME = 'aod:achievement-unlocked';

export function dispatchAchievementUnlocked(
  items: UnlockedAchievementToastItem[] | null | undefined
): void {
  if (!Array.isArray(items) || items.length === 0 || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: items }));
}

function renderToastIcon(icon?: string) {
  switch (icon) {
    case 'moon':
      return <Moon className="w-4 h-4" />;
    case 'disc':
      return <Disc className="w-4 h-4" />;
    case 'eye':
      return <Eye className="w-4 h-4" />;
    case 'tag':
      return <Tag className="w-4 h-4" />;
    case 'crown':
      return <Crown className="w-4 h-4" />;
    case 'flame':
      return <Flame className="w-4 h-4" />;
    case 'sparkles':
      return <Sparkles className="w-4 h-4" />;
    case 'trophy':
      return <Trophy className="w-4 h-4" />;
    default:
      return <Award className="w-4 h-4" />;
  }
}

interface ToastEntry extends UnlockedAchievementToastItem {
  toastId: string;
}

export const AchievementToastContainer: React.FC = () => {
  const { lang } = useI18n();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const handleUnlock = (ev: Event) => {
      const custom = ev as CustomEvent<UnlockedAchievementToastItem[]>;
      const list = Array.isArray(custom.detail) ? custom.detail : [];
      if (list.length === 0) return;

      const entries: ToastEntry[] = list.map((item, idx) => ({
        ...item,
        toastId: `${item.slug}_${Date.now()}_${idx}`,
      }));

      setToasts((prev) => [...prev, ...entries].slice(-4));

      entries.forEach((entry, idx) => {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.toastId !== entry.toastId));
        }, 5600 + idx * 700);
      });
    };

    window.addEventListener(EVENT_NAME, handleUnlock);
    return () => window.removeEventListener(EVENT_NAME, handleUnlock);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-24 right-4 sm:right-6 z-[70] flex flex-col gap-2.5 max-w-xs w-[calc(100vw-2rem)] pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isSecret = toast.difficulty_tier === 'secret';
        const isLegendary = toast.rarity === 'legendary';
        const accentBorder = isSecret
          ? 'border-[#9c5de0]/45'
          : isLegendary
            ? 'border-[#d4af68]/45'
            : 'border-[#821c2c]/55';
        const iconBg = isSecret
          ? 'bg-[#211530] text-[#d0b4fa] border-[#9c5de0]/35'
          : isLegendary
            ? 'bg-[#262014] text-[#f0d599] border-[#d4af68]/35'
            : 'bg-[#221015] text-[#eb9aa7] border-[#821c2c]/40';

        return (
          <div
            key={toast.toastId}
            className={`pointer-events-auto relative overflow-hidden rounded-lg bg-[#0d0c11]/95 backdrop-blur-md border ${accentBorder} shadow-[0_14px_38px_rgba(0,0,0,0.75)] p-3.5 animate-fadeIn`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-md border flex items-center justify-center shrink-0 ${iconBg}`}>
                {renderToastIcon(toast.icon)}
              </div>
              <div className="min-w-0 flex-1 pr-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#a39b8b]">
                  {isSecret
                    ? lang === 'ru'
                      ? 'Секретное достижение'
                      : 'Secret Achievement'
                    : lang === 'ru'
                      ? 'Достижение получено'
                      : 'Achievement Unlocked'}
                </div>
                <div className="text-sm font-medium text-[#f2eee9] truncate mt-0.5">
                  {lang === 'ru' ? toast.title_ru : toast.title_en || toast.title_ru}
                </div>
                {Number(toast.xp_reward || 0) > 0 && (
                  <div className="font-mono text-[11px] text-[#7ed6a3] mt-1 tabular-nums">
                    +{toast.xp_reward} XP
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.toastId !== toast.toastId))}
                className="absolute top-2.5 right-2.5 p-1 text-[#736c64] hover:text-[#f2eee9] transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
