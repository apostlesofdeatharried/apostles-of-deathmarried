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
    badgeClass: 'bg-white/[0.04] text-[#a39b8b] border-white/[0.12]',
    borderClass: 'border-white/[0.09]',
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
  mythic: {
    labelRu: 'Мифический',
    labelEn: 'Mythic',
    badgeClass: 'bg-gradient-to-r from-[#2e0c1a] via-[#1f1030] to-[#2e1e0c] text-[#f7d6e6] border-[#c95b84]',
    borderClass: 'border-[#c95b84]/85 shadow-[0_0_24px_rgba(201,91,132,0.18)]',
    textClass: 'text-[#f7c8dc]',
  },
};

export const CATEGORY_LABELS: Record<ShopCategory, { ru: string; en: string }> = {
  title: { ru: 'Шилды', en: 'Shields' },
  banner: { ru: 'Фоны профиля', en: 'Profile Banners' },
  frame: { ru: 'Рамки аватара', en: 'Avatar Frames' },
  effect: { ru: 'Эффекты', en: 'Profile Effects' },
  name_style: { ru: 'Стили имени', en: 'Name Styles' },
  badge: { ru: 'Иконки', en: 'Icons' },
  theme: { ru: 'Темы профиля', en: 'Profile Themes' },
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
  Sparkles: {
    labelRu: 'Искра',
    labelEn: 'Spark',
    pillClass: 'bg-white/[0.05] border-white/[0.14] text-[#d6d0c6]',
    icon: Sparkles,
  },
  Feather: {
    labelRu: 'Перо',
    labelEn: 'Quill',
    pillClass: 'bg-[#1a1816] border-[#5f584f]/70 text-[#dbd2c4]',
    icon: Feather,
  },
  Moon: {
    labelRu: 'Луна',
    labelEn: 'Moon',
    pillClass: 'bg-[#161421] border-[#4b4172]/70 text-[#c9bef0]',
    icon: Moon,
  },
  Headphones: {
    labelRu: 'Эфир',
    labelEn: 'Signal',
    pillClass: 'bg-[#111b23] border-[#345872]/75 text-[#b1d5ee]',
    icon: Headphones,
  },
  Shield: {
    labelRu: 'Щит',
    labelEn: 'Shield',
    pillClass: 'bg-[#161a24] border-[#3c5070]/70 text-[#b7cde8]',
    icon: Shield,
  },
  Disc: {
    labelRu: 'Винил',
    labelEn: 'Vinyl',
    pillClass: 'bg-[#231018] border-[#821c2c]/70 text-[#ebb2bc]',
    icon: Disc,
  },
  Flame: {
    labelRu: 'Огонь',
    labelEn: 'Flame',
    pillClass: 'bg-[#2b1214] border-[#a02835]/70 text-[#f3a6ad]',
    icon: Flame,
  },
  Eye: {
    labelRu: 'Взгляд',
    labelEn: 'Eye',
    pillClass: 'bg-[#1b1228] border-[#6c4aa3]/75 text-[#d7c2f8]',
    icon: Eye,
  },
  Crown: {
    labelRu: 'Корона',
    labelEn: 'Crown',
    pillClass: 'bg-[#281e10] border-[#a88234]/75 text-[#f0d8a1]',
    icon: Crown,
  },
  Gem: {
    labelRu: 'Кристалл',
    labelEn: 'Crystal',
    pillClass: 'bg-[#2a111f] border-[#a83b64]/75 text-[#f3b5cd]',
    icon: Gem,
  },
  Star: {
    labelRu: 'Звезда',
    labelEn: 'Star',
    pillClass: 'bg-gradient-to-r from-[#2c0e1d] via-[#1f1333] to-[#2c1d0d] border-[#d696b3]/85 text-[#f9e1bc]',
    icon: Star,
  },
};

type ShieldTier = 'common' | 'rare' | 'epic' | 'legendary';

interface ShieldMetaEntry {
  labelRu: string;
  labelEn: string;
  tier: ShieldTier;
  styleClass: string;
}

const TITLE_META: Record<string, ShieldMetaEntry> = {
  // Common (100–250 XP) — ultra-clean minimalist hairline, zero noise
  shield_novichok: {
    labelRu: 'новичок',
    labelEn: 'novichok',
    tier: 'common',
    styleClass: 'bg-white/[0.025] border-white/[0.11] text-[#9e978d]',
  },
  shield_slushatel: {
    labelRu: 'слушатель',
    labelEn: 'slushatel',
    tier: 'common',
    styleClass: 'bg-white/[0.03] border-white/[0.13] text-[#b2aba0]',
  },
  shield_v_teme: {
    labelRu: 'в теме',
    labelEn: 'v teme',
    tier: 'common',
    styleClass: 'bg-[#141317] border-white/[0.15] text-[#c2bbb0]',
  },
  shield_nochnoy: {
    labelRu: 'ночной',
    labelEn: 'nochnoy',
    tier: 'common',
    styleClass: 'bg-[#121218] border-[#383a47]/80 text-[#c5c7d4]',
  },

  // Rare (400–650 XP) — refined cold steel / slate plate with subtle inner crispness
  shield_tsenitel: {
    labelRu: 'ценитель',
    labelEn: 'tsenitel',
    tier: 'rare',
    styleClass: 'bg-[#11161f] border-[#344966]/80 text-[#aec7e8]',
  },
  shield_arkhivarius: {
    labelRu: 'архивариус',
    labelEn: 'arkhivarius',
    tier: 'rare',
    styleClass: 'bg-[#131720] border-[#4a5c78]/80 text-[#cad8eb]',
  },
  shield_svoy: {
    labelRu: 'свой',
    labelEn: 'svoy',
    tier: 'rare',
    styleClass: 'bg-[#11191a] border-[#2f5d57]/80 text-[#a9ddd4]',
  },
  shield_podzemka: {
    labelRu: 'подземка',
    labelEn: 'podzemka',
    tier: 'rare',
    styleClass: 'bg-[#15151c] border-[#666e80]/75 text-[#dcdfe8] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
  },

  // Epic (900–1300 XP) — dark carmine / smoked amethyst hairline & restrained depth
  shield_old: {
    labelRu: 'олд',
    labelEn: 'old',
    tier: 'epic',
    styleClass: 'bg-[#1d0e15] border-[#7a2233]/85 text-[#ebb0bc] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]',
  },
  shield_khranitel: {
    labelRu: 'хранитель',
    labelEn: 'khranitel',
    tier: 'epic',
    styleClass: 'bg-[#181126] border-[#614794]/85 text-[#d7c6fa] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
  },
  shield_veteran: {
    labelRu: 'ветеран',
    labelEn: 'veteran',
    tier: 'epic',
    styleClass: 'bg-gradient-to-r from-[#220d14] to-[#17121b] border-[#962a3d]/85 text-[#f2bcc6] shadow-[0_0_10px_rgba(130,28,44,0.2)]',
  },
  shield_apostol: {
    labelRu: 'апостол',
    labelEn: 'apostol',
    tier: 'epic',
    styleClass: 'bg-gradient-to-r from-[#270e18] via-[#1c0f22] to-[#1a1118] border-[#a8364d]/90 text-[#f8d0d8] shadow-[0_0_12px_rgba(168,54,77,0.25)]',
  },

  // Legendary (1800–2500 XP) — noble dark-gold / obsidian-crimson prestige gradient
  shield_izbrannyy: {
    labelRu: 'избранный',
    labelEn: 'izbrannyy',
    tier: 'legendary',
    styleClass:
      'bg-gradient-to-r from-[#231a0d] via-[#1a140e] to-[#241b0e] border-[#b89242]/85 text-[#f3daa2] shadow-[0_0_14px_rgba(184,146,66,0.2)]',
  },
  shield_legenda: {
    labelRu: 'легенда',
    labelEn: 'legenda',
    tier: 'legendary',
    styleClass:
      'bg-gradient-to-r from-[#1e1b18] via-[#2a2112] to-[#1c1a20] border-[#d6b267]/90 text-[#f9e7be] shadow-[0_0_16px_rgba(214,178,103,0.26)]',
  },
  shield_bog_apostolov: {
    labelRu: 'бог апостолов',
    labelEn: 'bog apostolov',
    tier: 'legendary',
    styleClass:
      'bg-gradient-to-r from-[#2b0d19] via-[#25180d] to-[#1e1026] border-[#d49a6a]/90 text-[#fce6d0] shadow-[0_0_18px_rgba(201,91,132,0.28)]',
  },

  // Silent legacy fallbacks (in case any cached payload still holds pre-migration keys)
  title_nocturne_listener: {
    labelRu: 'слушатель',
    labelEn: 'slushatel',
    tier: 'common',
    styleClass: 'bg-white/[0.03] border-white/[0.13] text-[#b2aba0]',
  },
  title_vinyl_collector: {
    labelRu: 'ночной',
    labelEn: 'nochnoy',
    tier: 'common',
    styleClass: 'bg-[#121218] border-[#383a47]/80 text-[#c5c7d4]',
  },
  title_cathedral_scribe: {
    labelRu: 'архивариус',
    labelEn: 'arkhivarius',
    tier: 'rare',
    styleClass: 'bg-[#131720] border-[#4a5c78]/80 text-[#cad8eb]',
  },
  title_nightmortan_witness: {
    labelRu: 'хранитель',
    labelEn: 'khranitel',
    tier: 'epic',
    styleClass: 'bg-[#181126] border-[#614794]/85 text-[#d7c6fa]',
  },
  title_velvet_phantom: {
    labelRu: 'ветеран',
    labelEn: 'veteran',
    tier: 'epic',
    styleClass: 'bg-gradient-to-r from-[#220d14] to-[#17121b] border-[#962a3d]/85 text-[#f2bcc6]',
  },
  title_obsidian_curator: {
    labelRu: 'избранный',
    labelEn: 'izbrannyy',
    tier: 'legendary',
    styleClass: 'bg-gradient-to-r from-[#231a0d] via-[#1a140e] to-[#241b0e] border-[#b89242]/85 text-[#f3daa2]',
  },
  title_gilded_apostle: {
    labelRu: 'легенда',
    labelEn: 'legenda',
    tier: 'legendary',
    styleClass: 'bg-gradient-to-r from-[#1e1b18] via-[#2a2112] to-[#1c1a20] border-[#d6b267]/90 text-[#f9e7be]',
  },
  title_sovereign_of_silence: {
    labelRu: 'бог апостолов',
    labelEn: 'bog apostolov',
    tier: 'legendary',
    styleClass: 'bg-gradient-to-r from-[#2b0d19] via-[#25180d] to-[#1e1026] border-[#d49a6a]/90 text-[#fce6d0]',
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
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/15 text-[#ded8ce] font-mono">
        <Award className="w-2.5 h-2.5 shrink-0" />
        <span>{badgeValue}</span>
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-mono tracking-wider shrink-0 ${
        compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'
      } ${meta.pillClass}`}
      title={lang === 'ru' ? meta.labelRu : meta.labelEn}
    >
      <Icon className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} />
      <span>{lang === 'ru' ? meta.labelRu : meta.labelEn}</span>
    </span>
  );
}

export function getEquippedTitleLabel(
  titleValue: string | null | undefined,
  lang: 'ru' | 'en' = 'ru'
): string | null {
  if (!titleValue) return null;
  const meta = TITLE_META[titleValue];
  return meta ? (lang === 'ru' ? meta.labelRu : meta.labelEn) : titleValue;
}

export function renderEquippedTitle(
  titleValue: string | null | undefined,
  lang: 'ru' | 'en' = 'ru',
  compact: boolean = false
): React.ReactNode {
  if (!titleValue) return null;
  const meta = TITLE_META[titleValue];
  const label = meta ? (lang === 'ru' ? meta.labelRu : meta.labelEn) : titleValue;
  const styleClass = meta ? meta.styleClass : 'bg-white/[0.03] border-white/[0.12] text-[#b8b0a4]';
  const tier = meta?.tier || 'common';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[5px] border font-mono tracking-[0.06em] leading-none shrink-0 select-none ${
        compact ? 'text-[10px] px-1.5 py-[3px]' : 'text-[11px] px-2 py-[4px]'
      } ${tier === 'legendary' ? 'font-medium' : 'font-normal'} ${styleClass}`}
      title={label}
    >
      {tier === 'legendary' && (
        <span aria-hidden="true" className="w-1.5 h-1.5 rotate-45 bg-current opacity-85 shrink-0" />
      )}
      {tier === 'epic' && (
        <span aria-hidden="true" className="w-1 h-1 rounded-full bg-current opacity-80 shrink-0" />
      )}
      <span>{label}</span>
    </span>
  );
}

/**
 * Returns true if the banner value represents a GPU-accelerated animated profile banner.
 */
export function isAnimatedBanner(bannerValue: string | null | undefined): boolean {
  return Boolean(bannerValue && bannerValue.startsWith('banner_anim_'));
}

const EMBER_SPECS = [
  { left: '8%', size: 3, delay: '0s', alt: false, color: '#e6556b' },
  { left: '19%', size: 2, delay: '-2.1s', alt: true, color: '#f3a183' },
  { left: '31%', size: 3, delay: '-4.4s', alt: false, color: '#c83249' },
  { left: '44%', size: 2, delay: '-1.3s', alt: true, color: '#d4ccc4' },
  { left: '57%', size: 3.5, delay: '-5.8s', alt: false, color: '#ef6b7e' },
  { left: '68%', size: 2, delay: '-3.2s', alt: true, color: '#f0b89e' },
  { left: '79%', size: 3, delay: '-0.8s', alt: false, color: '#b82a40' },
  { left: '91%', size: 2.5, delay: '-6.3s', alt: true, color: '#cfc5bd' },
];

/**
 * Renders the background layers of a profile banner (supports textured static banners,
 * GPU-accelerated animated banners, and backward-compatible legacy Tailwind `from-*` gradients).
 * Place inside a `relative overflow-hidden` container.
 */
export function renderProfileBanner(
  bannerValue: string | null | undefined,
  compact: boolean = false
): React.ReactNode {
  const val = bannerValue || 'from-[#0e0d12] via-[#1a1722] to-[#0c0b0e]';

  // Legacy Tailwind gradient strings (100% backward compatible)
  if (val.startsWith('from-')) {
    return (
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-gradient-to-r ${val}`}
      />
    );
  }

  switch (val) {
    // --- TEXTURED STATIC BANNERS ---
    case 'banner_tex_graphite_grain':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0b0b0e]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_25%,rgba(255,255,255,0.06),transparent_60%),linear-gradient(135deg,#08080a_0%,#15151a_52%,#09090c_100%)]" />
          <div className="absolute inset-0 opacity-45 bg-[radial-gradient(rgba(255,255,255,0.16)_0.6px,transparent_0.6px)] bg-[length:6px_6px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.65)_100%)]" />
        </div>
      );

    case 'banner_tex_arch_grid':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0c0d11]">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:24px_24px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_30%,rgba(148,163,184,0.12),transparent_62%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#08080b] to-transparent" />
        </div>
      );

    case 'banner_tex_slate_rain':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0d1117]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#121923_0%,#0c1016_100%)]" />
          <div className="absolute inset-0 opacity-40 bg-[repeating-linear-gradient(108deg,transparent_0px,transparent_14px,rgba(176,198,224,0.14)_14px,rgba(176,198,224,0.14)_15px)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(140,174,214,0.16),transparent_65%)]" />
        </div>
      );

    case 'banner_tex_forest_fog':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#091210]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#0c1a16_0%,#08100e_100%)]" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(4,9,8,0.55)_0px,rgba(4,9,8,0.55)_18px,transparent_18px,transparent_44px)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_100%,rgba(74,148,122,0.22),transparent_65%)]" />
        </div>
      );

    case 'banner_tex_moonlit_veil':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0c0d14]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_28%,rgba(220,232,250,0.26)_0%,rgba(130,150,192,0.1)_28%,transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_22%_85%,rgba(110,104,146,0.18),transparent_58%)]" />
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(rgba(235,240,255,0.25)_0.8px,transparent_0.8px)] bg-[length:22px_22px]" />
        </div>
      );

    case 'banner_tex_brushed_steel':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#13151b]">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.035)_0px,rgba(255,255,255,0.035)_1px,transparent_1px,transparent_3px)]" />
          <div className="absolute inset-0 bg-[linear-gradient(118deg,transparent_22%,rgba(224,230,242,0.14)_46%,rgba(255,255,255,0.2)_50%,rgba(224,230,242,0.08)_54%,transparent_76%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.58))]" />
        </div>
      );

    case 'banner_tex_gothic_mesh':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0a101e]">
          <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(125,164,232,0.09)_1px,transparent_1px),linear-gradient(-45deg,rgba(125,164,232,0.09)_1px,transparent_1px)] bg-[length:18px_18px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,rgba(56,96,172,0.28),transparent_68%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#070a12] to-transparent" />
        </div>
      );

    case 'banner_tex_crimson_velvet':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#1a0910]">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(112deg,rgba(0,0,0,0.52)_0px,rgba(98,18,36,0.24)_34px,rgba(0,0,0,0.58)_68px,rgba(138,28,50,0.22)_104px,rgba(0,0,0,0.5)_140px)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_35%,rgba(166,34,58,0.28),transparent_62%)]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#962a3d]/70 to-transparent" />
        </div>
      );

    case 'banner_tex_vinyl_grooves':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#100d1a]">
          <div className="absolute inset-0 bg-[repeating-radial-gradient(circle_at_82%_50%,rgba(190,170,245,0.11)_0px,rgba(190,170,245,0.11)_1px,transparent_1px,transparent_7px)]" />
          <div className="absolute inset-0 bg-[linear-gradient(125deg,transparent_25%,rgba(182,158,245,0.14)_48%,transparent_68%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_50%,rgba(110,74,178,0.3)_0%,transparent_48%)]" />
        </div>
      );

    case 'banner_tex_gold_eclipse':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#110e09]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_48%,rgba(212,170,88,0.24)_0%,rgba(132,96,34,0.12)_32%,transparent_64%)]" />
          <div
            className={`absolute rounded-full border border-[#d9b468]/45 shadow-[0_0_24px_rgba(212,175,104,0.25)] bg-[#0b0907]/90 ${
              compact ? 'w-14 h-14 right-5 top-1/2 -translate-y-1/2' : 'w-32 h-32 right-12 top-1/2 -translate-y-1/2'
            }`}
          />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#cfa859]/60 to-transparent" />
        </div>
      );

    case 'banner_tex_carmine_noir':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0d070a]">
          <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[#4a1020] via-[#240912] to-transparent" />
          <div className="absolute inset-x-0 top-[56%] h-px bg-gradient-to-r from-transparent via-[#df526e]/65 to-transparent" />
          <div className="absolute inset-0 opacity-35 bg-[radial-gradient(rgba(255,210,218,0.22)_0.7px,transparent_0.7px)] bg-[length:8px_8px]" />
        </div>
      );

    case 'banner_tex_obsidian_prism':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#0d0a12]">
          <div className="absolute inset-0 bg-[linear-gradient(132deg,rgba(201,91,132,0.2)_0%,transparent_34%,rgba(116,80,178,0.2)_64%,rgba(214,174,98,0.18)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(28deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(148deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:44px_44px]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_38%,rgba(6,5,9,0.68)_100%)]" />
        </div>
      );

    // --- 4 PREMIUM GPU-ACCELERATED ANIMATED BANNERS ---
    case 'banner_anim_dark_mist':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#090a0e]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#0c0d13_0%,#08080b_100%)]" />
          <div className="aod-mist-layer-a absolute -inset-x-1/4 -inset-y-8 bg-[radial-gradient(ellipse_55%_70%_at_30%_55%,rgba(156,168,192,0.24),transparent_68%),radial-gradient(ellipse_45%_65%_at_75%_40%,rgba(104,116,144,0.2),transparent_66%)]" />
          <div className="aod-mist-layer-b absolute -inset-x-1/4 -inset-y-8 bg-[radial-gradient(ellipse_50%_65%_at_65%_65%,rgba(184,188,204,0.16),transparent_68%),radial-gradient(ellipse_40%_60%_at_20%_35%,rgba(124,132,158,0.15),transparent_65%)]" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#08080b]/85 to-transparent" />
        </div>
      );

    case 'banner_anim_crimson_embers':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0e070a]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_115%,rgba(148,26,46,0.44)_0%,rgba(64,12,24,0.24)_48%,transparent_78%)]" />
          {(compact ? EMBER_SPECS.slice(0, 5) : EMBER_SPECS).map((ember, idx) => (
            <span
              key={idx}
              style={{
                left: ember.left,
                width: `${ember.size}px`,
                height: `${ember.size}px`,
                backgroundColor: ember.color,
                animationDelay: ember.delay,
              }}
              className={`absolute bottom-0 rounded-full ${ember.alt ? 'aod-ember-mote-alt' : 'aod-ember-mote'}`}
            />
          ))}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#b8324a]/75 to-transparent" />
        </div>
      );

    case 'banner_anim_digital_glitch':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#09090e]">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#0b0b12_0%,#15121d_55%,#0c0910_100%)]" />
          {/* Static crisp CRT scanlines */}
          <div className="absolute inset-0 opacity-40 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.05)_0px,rgba(255,255,255,0.05)_1px,transparent_1px,transparent_4px)]" />
          {/* Smooth moving vertical scan beam */}
          <div className="aod-glitch-scanline absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-[#b4c8f0]/18 to-transparent" />
          {/* Crisp periodic chromatic glitch slices */}
          <div
            style={{ top: '28%' }}
            className="aod-glitch-bar absolute inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-[#e04868]/75 to-transparent"
          />
          <div
            style={{ top: '64%', animationDelay: '-2.7s' }}
            className="aod-glitch-bar absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#7aa6f2]/70 to-transparent"
          />
        </div>
      );

    case 'banner_anim_abyss_pulse':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0b0710]">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#1b0b1c_0%,#09070d_78%)]" />
          <div
            className={`aod-abyss-core absolute left-1/2 top-1/2 rounded-full bg-[radial-gradient(circle,rgba(168,36,68,0.45)_0%,rgba(98,52,148,0.22)_46%,transparent_72%)] ${
              compact ? 'w-36 h-36' : 'w-80 h-80'
            }`}
          />
          <div
            className={`aod-abyss-ring absolute left-1/2 top-1/2 rounded-full border border-[#c95b84]/35 ${
              compact ? 'w-20 h-20' : 'w-44 h-44'
            }`}
          />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c95b84]/65 to-transparent" />
        </div>
      );

    default:
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0e0d12] via-[#1a1722] to-[#0c0b0e]"
        />
      );
  }
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
    case 'theme_ash_velvet':
      return {
        cardClass: 'border-[#6e675e]/45 shadow-[0_0_34px_rgba(110,103,94,0.12)] bg-[#11100f]',
        accentBarClass: 'bg-gradient-to-r from-[#4a453f] via-[#b8afa2] to-[#4a453f]',
        statBoxClass: 'border-[#6e675e]/25 bg-[#141312]',
      };
    case 'theme_obsidian_cathedral':
      return {
        cardClass: 'border-[#3d4d6b]/55 shadow-[0_0_42px_rgba(61,77,107,0.18)] bg-[#0b0e14]',
        accentBarClass: 'bg-gradient-to-r from-[#25344f] via-[#9ab5dc] to-[#25344f]',
        statBoxClass: 'border-[#3d4d6b]/30 bg-[#0e121a]',
      };
    case 'theme_crimson_eclipse':
      return {
        cardClass: 'border-[#c95b84]/65 shadow-[0_0_48px_rgba(201,91,132,0.22)] bg-[#120a11]',
        accentBarClass: 'bg-gradient-to-r from-[#821c2c] via-[#e2b96f] to-[#6e46a3]',
        statBoxClass: 'border-[#c95b84]/35 bg-[#160d15]',
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
    case 'effect_rim_glow':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#c7d6eb]/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#9cb4d6]/55 to-transparent" />
          <div className="absolute inset-0 shadow-[inset_0_0_24px_rgba(165,190,230,0.12)]" />
        </div>
      );
    case 'effect_drifting_ash':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {[
            { left: '14%', size: 2.5, delay: '0s', alt: false },
            { left: '34%', size: 2, delay: '-2.6s', alt: true },
            { left: '52%', size: 3, delay: '-4.8s', alt: false },
            { left: '72%', size: 2, delay: '-1.5s', alt: true },
            { left: '88%', size: 2.5, delay: '-5.9s', alt: false },
          ].map((mote, i) => (
            <span
              key={i}
              style={{
                left: mote.left,
                width: `${mote.size}px`,
                height: `${mote.size}px`,
                backgroundColor: 'rgba(218, 212, 204, 0.72)',
                animationDelay: mote.delay,
              }}
              className={`absolute bottom-0 rounded-full ${mote.alt ? 'aod-ember-mote-alt' : 'aod-ember-mote'}`}
            />
          ))}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_50%,rgba(10,10,13,0.45)_100%)]" />
        </div>
      );
    case 'effect_glitch_accent':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-25 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_1px,transparent_1px,transparent_4px)]" />
          <div
            style={{ top: '22%' }}
            className="aod-glitch-bar absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#e85d78]/80 to-transparent"
          />
          <div
            style={{ top: '76%', animationDelay: '-2.4s' }}
            className="aod-glitch-bar absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-[#7ca8f5]/75 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-[#e85d78]/40 via-white/30 to-[#7ca8f5]/40" />
        </div>
      );
    case 'effect_crimson_mist':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
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
    case 'effect_midnight_ash':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-45 bg-[radial-gradient(circle_at_20%_30%,rgba(210,202,190,0.22)_1px,transparent_1.5px),radial-gradient(circle_at_70%_60%,rgba(210,202,190,0.18)_1px,transparent_1.5px),radial-gradient(circle_at_45%_80%,rgba(210,202,190,0.15)_1px,transparent_1.5px)] bg-[length:64px_64px]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,rgba(12,11,14,0.65)_100%)]" />
        </div>
      );
    case 'effect_cathedral_stardust':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(122,94,196,0.24),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(184,154,240,0.18),transparent_55%)]" />
          <div className="absolute inset-0 opacity-50 bg-[radial-gradient(circle_at_15%_25%,rgba(225,212,255,0.45)_1px,transparent_1.5px),radial-gradient(circle_at_82%_35%,rgba(235,210,155,0.4)_1px,transparent_1.5px),radial-gradient(circle_at_55%_70%,rgba(225,212,255,0.35)_1px,transparent_1.5px)] bg-[length:80px_80px]" />
        </div>
      );
    case 'effect_apostle_aura':
      return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-80 h-44 rounded-full bg-[radial-gradient(ellipse,rgba(201,91,132,0.32),rgba(110,70,163,0.18)_45%,transparent_72%)]" />
          <div className="absolute inset-1.5 rounded-lg border border-[#d696b3]/25" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#e8c684]/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#c95b84]/80 to-transparent" />
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
