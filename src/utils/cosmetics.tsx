import React from 'react';
import {
  Shield,
  Disc,
  Sparkles,
  Crown,
  Flame,
  Moon,
  Feather,
  Music,
  Award,
  Calendar,
  MessageSquare,
  Trophy,
  Tag,
  Play,
  Headphones,
  Star,
  Eye,
  Compass,
  Gem,
  BookOpen,
  Users,
  Zap,
  Lock,
  Layers,
} from 'lucide-react';
import { ItemRarity, ShopCategory } from '../types/index.js';

export const RARITY_CONFIG: Record<
  ItemRarity,
  {
    labelRu: string;
    labelEn: string;
    badgeClass: string;
    borderClass: string;
    textClass: string;
  }
> = {
  common: {
    labelRu: 'Обычный',
    labelEn: 'Common',
    badgeClass: 'bg-white/[0.05] text-[#a39b8b] border-white/[0.12]',
    borderClass: 'border-white/[0.1]',
    textClass: 'text-[#a39b8b]',
  },
  uncommon: {
    labelRu: 'Необычный',
    labelEn: 'Uncommon',
    badgeClass: 'bg-[#10221c] text-[#7ed6b2] border-[#1f5c46]',
    borderClass: 'border-[#1f5c46]/60',
    textClass: 'text-[#7ed6b2]',
  },
  rare: {
    labelRu: 'Редкий',
    labelEn: 'Rare',
    badgeClass: 'bg-[#121a28] text-[#9ec5f0] border-[#294872]',
    borderClass: 'border-[#294872]/70',
    textClass: 'text-[#9ec5f0]',
  },
  epic: {
    labelRu: 'Эпический',
    labelEn: 'Epic',
    badgeClass: 'bg-[#2a1019] text-[#eba0ad] border-[#821c2c]',
    borderClass: 'border-[#821c2c]/75',
    textClass: 'text-[#eba0ad]',
  },
  legendary: {
    labelRu: 'Легендарный',
    labelEn: 'Legendary',
    badgeClass: 'bg-[#261d0f] text-[#ebd197] border-[#96702a]',
    borderClass: 'border-[#96702a]/80',
    textClass: 'text-[#ebd197]',
  },
};

export const CATEGORY_LABELS: Record<ShopCategory, { ru: string; en: string }> = {
  frame: { ru: 'Рамки аватара', en: 'Avatar Frames' },
  banner: { ru: 'Фоны профиля', en: 'Profile Banners' },
  name_style: { ru: 'Стили имени', en: 'Name Styles' },
  badge: { ru: 'Значки', en: 'Badges' },
  theme: { ru: 'Темы профиля', en: 'Profile Themes' },
  effect: { ru: 'Эффекты', en: 'Profile Effects' },
};

const BADGE_META: Record<
  string,
  {
    labelRu: string;
    labelEn: string;
    pillClass: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  Shield: {
    labelRu: 'Хранитель',
    labelEn: 'Archivist',
    pillClass: 'bg-[#161a24] border-[#384b6b]/70 text-[#b7cde8]',
    icon: Shield,
  },
  Disc: {
    labelRu: 'Аудиофил',
    labelEn: 'Audiophile',
    pillClass: 'bg-[#231018] border-[#821c2c]/70 text-[#ebb2bc]',
    icon: Disc,
  },
  Sparkles: {
    labelRu: 'Странник',
    labelEn: 'Wanderer',
    pillClass: 'bg-white/[0.06] border-white/[0.16] text-[#ded8ce]',
    icon: Sparkles,
  },
  Crown: {
    labelRu: 'Венец ночи',
    labelEn: 'Night Crown',
    pillClass: 'bg-[#281e10] border-[#a88234]/75 text-[#f0d8a1]',
    icon: Crown,
  },
  Moon: {
    labelRu: 'Полуночник',
    labelEn: 'Nocturne',
    pillClass: 'bg-[#171422] border-[#4d4278]/70 text-[#cbbff0]',
    icon: Moon,
  },
  Flame: {
    labelRu: 'Пламя',
    labelEn: 'Ember',
    pillClass: 'bg-[#2b1214] border-[#a02835]/70 text-[#f3a6ad]',
    icon: Flame,
  },
};

export function renderEquippedBadge(
  badgeValue: string | null | undefined,
  lang: 'ru' | 'en' = 'ru',
  compact: boolean = false
): React.ReactNode {
  if (!badgeValue) return null;
  const meta = BADGE_META[badgeValue];
  if (!meta) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-white/[0.06] border border-white/15 text-[#ded8ce] font-mono">
        <Award className="w-2.5 h-2.5 shrink-0" />
        <span>{badgeValue}</span>
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-mono uppercase tracking-wider shrink-0 ${
        compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'
      } ${meta.pillClass}`}
      title={lang === 'ru' ? meta.labelRu : meta.labelEn}
    >
      <Icon className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} />
      <span>{lang === 'ru' ? meta.labelRu : meta.labelEn}</span>
    </span>
  );
}

/**
 * Profile theme visual styles (applied to main profile hero card & surface borders)
 */
export function getProfileThemeStyle(themeValue: string | null | undefined): {
  cardClass: string;
  accentBarClass: string;
  statBoxClass: string;
} {
  switch (themeValue) {
    case 'theme_crimson_sanctum':
      return {
        cardClass: 'border-[#821c2c]/55 shadow-[0_0_40px_rgba(130,28,44,0.16)] bg-[#110c0f]',
        accentBarClass: 'bg-gradient-to-r from-[#821c2c] via-[#b83247] to-[#821c2c]',
        statBoxClass: 'border-[#821c2c]/30 bg-[#140e12]',
      };
    case 'theme_silver_cathedral':
      return {
        cardClass: 'border-[#c5c8cf]/40 shadow-[0_0_36px_rgba(197,200,207,0.12)] bg-[#101116]',
        accentBarClass: 'bg-gradient-to-r from-[#8f96a6] via-[#e2e5ed] to-[#8f96a6]',
        statBoxClass: 'border-[#c5c8cf]/20 bg-[#121319]',
      };
    case 'theme_gilded_reliquary':
      return {
        cardClass: 'border-[#9e7a34]/55 shadow-[0_0_42px_rgba(184,142,60,0.16)] bg-[#12100d]',
        accentBarClass: 'bg-gradient-to-r from-[#7c5c22] via-[#e0bf77] to-[#7c5c22]',
        statBoxClass: 'border-[#9e7a34]/30 bg-[#15120e]',
      };
    case 'theme_obsidian_monolith':
      return {
        cardClass: 'border-white/[0.16] shadow-[0_0_34px_rgba(0,0,0,0.85)] bg-[#09090b]',
        accentBarClass: 'bg-gradient-to-r from-[#2c2a30] via-[#8e877e] to-[#2c2a30]',
        statBoxClass: 'border-white/[0.1] bg-[#0d0c10]',
      };
    case 'theme_midnight_violet':
      return {
        cardClass: 'border-[#5a468c]/55 shadow-[0_0_40px_rgba(90,70,140,0.18)] bg-[#0f0d16]',
        accentBarClass: 'bg-gradient-to-r from-[#4b3878] via-[#a088db] to-[#4b3878]',
        statBoxClass: 'border-[#5a468c]/30 bg-[#12101b]',
      };
    default:
      return {
        cardClass: 'border-white/[0.08] bg-[#100f13]',
        accentBarClass: 'bg-[#821c2c]',
        statBoxClass: 'border-white/[0.06] bg-[#100f13]',
      };
  }
}

/**
 * Profile decorative atmospheric effect overlay (rendered inside the profile header banner/card)
 */
export function renderProfileEffectOverlay(effectValue: string | null | undefined): React.ReactNode {
  if (!effectValue) return null;
  switch (effectValue) {
    case 'effect_crimson_mist':
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute -inset-8 bg-[radial-gradient(ellipse_at_top_right,rgba(130,28,44,0.34),transparent_58%),radial-gradient(ellipse_at_bottom_left,rgba(90,14,28,0.28),transparent_60%)]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c74258]/70 to-transparent" />
        </div>
      );
    case 'effect_silver_filigree':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-2 border border-[#d6dae4]/20 rounded-lg" />
          <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#d6dae4]/55 rounded-tl" />
          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#d6dae4]/55 rounded-tr" />
          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#d6dae4]/55 rounded-bl" />
          <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#d6dae4]/55 rounded-br" />
        </div>
      );
    case 'effect_cathedral_light':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.09)_0%,transparent_28%,transparent_55%,rgba(220,190,130,0.09)_72%,transparent_100%)]" />
          <div className="absolute top-0 left-1/4 w-1/2 h-px bg-gradient-to-r from-transparent via-[#ebd197]/65 to-transparent" />
        </div>
      );
    case 'effect_vinyl_grain':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-35 bg-[repeating-radial-gradient(circle_at_85%_20%,rgba(255,255,255,0.07)_0px,rgba(255,255,255,0.07)_1px,transparent_1px,transparent_9px)]" />
        </div>
      );
    case 'effect_eclipse_halo':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-16 right-8 w-52 h-52 rounded-full border border-[#d4af68]/30 bg-[radial-gradient(circle,rgba(212,175,104,0.16),transparent_68%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.45)_100%)]" />
        </div>
      );
    default:
      return null;
  }
}

export function renderAchievementIcon(iconName: string, className: string = 'w-4 h-4'): React.ReactNode {
  switch (iconName) {
    case 'play':
      return <Play className={className} />;
    case 'headphones':
      return <Headphones className={className} />;
    case 'award':
      return <Award className={className} />;
    case 'calendar':
      return <Calendar className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    case 'message-square':
      return <MessageSquare className={className} />;
    case 'trophy':
      return <Trophy className={className} />;
    case 'tag':
      return <Tag className={className} />;
    case 'music':
      return <Music className={className} />;
    case 'disc':
      return <Disc className={className} />;
    case 'crown':
      return <Crown className={className} />;
    case 'flame':
      return <Flame className={className} />;
    case 'moon':
      return <Moon className={className} />;
    case 'feather':
      return <Feather className={className} />;
    case 'star':
      return <Star className={className} />;
    case 'eye':
      return <Eye className={className} />;
    case 'compass':
      return <Compass className={className} />;
    case 'gem':
      return <Gem className={className} />;
    case 'book-open':
      return <BookOpen className={className} />;
    case 'users':
      return <Users className={className} />;
    case 'zap':
      return <Zap className={className} />;
    case 'layers':
      return <Layers className={className} />;
    case 'lock':
      return <Lock className={className} />;
    default:
      return <Award className={className} />;
  }
}

export function formatHandle(nickname?: string | null): string {
  if (!nickname) return '@unknown';
  const clean = nickname.replace(/^@+/, '');
  return `@${clean}`;
}
