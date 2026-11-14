import React from 'react';
import { useI18n } from '../context/I18nContext.js';
import { Disc3, Trophy, MessageSquare, Sparkles, ArrowUpRight } from 'lucide-react';

interface HomeViewProps {
  onNavigate: (tab: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const { t, lang } = useI18n();

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex flex-col justify-center items-center text-center px-3 sm:px-6 py-10 md:py-16 overflow-hidden select-none">
      {/* 1. LAYER: Gothic Black Lace & Tulle Fabric Texture Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-25 sm:opacity-30 mix-blend-screen pointer-events-none transition-opacity duration-1000"
        style={{
          backgroundImage: "url('/assets/gothic_lace_texture.jpg')",
          maskImage: 'radial-gradient(ellipse 90% 85% at 50% 45%, black 40%, rgba(0,0,0,0.6) 70%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 85% at 50% 45%, black 40%, rgba(0,0,0,0.6) 70%, transparent 100%)',
        }}
        aria-hidden="true"
      />

      {/* 2. LAYER: Fine Gothic Tulle Mesh Weave */}
      <div className="absolute inset-0 gothic-tulle-mesh opacity-40 pointer-events-none" aria-hidden="true" />

      {/* 3. LAYER: Translucent Fabric Folds & Drapery Shadows */}
      <div className="absolute inset-0 gothic-fabric-folds opacity-50 mix-blend-multiply pointer-events-none" aria-hidden="true" />

      {/* 4. LAYER: Repeating Rose Lace Embroidery Borders (Left & Right Side Drapery) */}
      <div
        className="hidden md:block absolute left-0 top-0 bottom-0 w-28 lg:w-36 pointer-events-none opacity-20 mix-blend-lighten"
        style={{
          backgroundImage: "url('/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg')",
          backgroundRepeat: 'repeat-y',
          backgroundSize: '80px',
          backgroundPosition: 'left center',
          filter: 'grayscale(100%) contrast(150%) brightness(70%)',
          maskImage: 'linear-gradient(to right, black 20%, transparent 95%)',
          WebkitMaskImage: 'linear-gradient(to right, black 20%, transparent 95%)',
        }}
        aria-hidden="true"
      />
      <div
        className="hidden md:block absolute right-0 top-0 bottom-0 w-28 lg:w-36 pointer-events-none opacity-20 mix-blend-lighten"
        style={{
          backgroundImage: "url('/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg')",
          backgroundRepeat: 'repeat-y',
          backgroundSize: '80px',
          backgroundPosition: 'right center',
          filter: 'grayscale(100%) contrast(150%) brightness(70%)',
          maskImage: 'linear-gradient(to left, black 20%, transparent 95%)',
          WebkitMaskImage: 'linear-gradient(to left, black 20%, transparent 95%)',
        }}
        aria-hidden="true"
      />

      {/* 5. Ambient Vignette Glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(65,20,30,0.22)_0%,rgba(16,14,19,0.45)_52%,rgba(8,8,10,0.92)_90%)] pointer-events-none" aria-hidden="true" />

      {/* Hero Content Canvas */}
      <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col items-center">
        {/* Original Velvet Rose - Seamlessly dissolved into textured lace backdrop via mix-blend-lighten + soft radial feather */}
        <div className="relative w-56 h-56 sm:w-72 sm:h-72 md:w-88 md:h-88 -mb-4 sm:-mb-6 pointer-events-none flex items-center justify-center">
          {/* Subtle soft crimson-graphite atmospheric glow behind rose */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(105,28,42,0.32)_0%,rgba(45,14,22,0.12)_42%,transparent_72%)] blur-2xl scale-125 pointer-events-none" />

          {/* Organic soft-blended velvet rose canvas: pure #000000 becomes transparent over lace backdrop */}
          <div
            className="w-full h-full relative mix-blend-lighten overflow-visible flex items-center justify-center"
            style={{
              maskImage: 'radial-gradient(circle at 50% 50%, black 22%, rgba(0,0,0,0.72) 44%, rgba(0,0,0,0.22) 62%, transparent 76%)',
              WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 22%, rgba(0,0,0,0.72) 44%, rgba(0,0,0,0.22) 62%, transparent 76%)',
            }}
          >
            <img
              src="/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg"
              alt="Velvet Rose"
              className="w-full h-full object-contain scale-[1.35] filter contrast-[1.18] brightness-[0.96] saturate-[0.95] transition-all duration-1000"
            />
          </div>
        </div>

        {/* Master Project Title in Cormorant Garamond with Responsive Mobile Padding */}
        <div className="relative z-20 flex flex-col items-center mb-8 sm:mb-10 w-full max-w-full px-2">
          <h1 className="font-display text-2xl sm:text-4xl md:text-5xl lg:text-6xl tracking-[0.10em] sm:tracking-[0.20em] text-[#f2eee9] font-light uppercase break-words text-center max-w-full drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)]">
            Apostles of deathmarried
          </h1>

          {/* Mobile-safe sub-navigation breadcrumbs with wrap protection */}
          <div className="flex flex-wrap items-center justify-center gap-x-2 sm:gap-x-3 gap-y-1 mt-3 text-[10px] sm:text-xs tracking-[0.14em] sm:tracking-[0.22em] text-[#8e877e] uppercase font-sans max-w-full px-2">
            <span>{lang === 'ru' ? 'Каталог' : 'Discography'}</span>
            <span className="w-1 h-1 rounded-full bg-[#524a45]" aria-hidden="true" />
            <span>{lang === 'ru' ? 'Испытания' : 'Challenges'}</span>
            <span className="w-1 h-1 rounded-full bg-[#524a45]" aria-hidden="true" />
            <span>{lang === 'ru' ? 'Сообщество' : 'Community'}</span>
            <span className="w-1 h-1 rounded-full bg-[#524a45]" aria-hidden="true" />
            <span>{lang === 'ru' ? 'Творчество' : 'Creations'}</span>
          </div>
        </div>

        {/* Refined Asymmetric Gothic Portal Navigation */}
        <div className="relative z-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 w-full max-w-4xl px-2">
          {/* 1. Archive */}
          <button
            type="button"
            onClick={() => onNavigate('archive')}
            className="group relative flex flex-col items-start p-4 sm:p-5 rounded-lg bg-[#0e0d12]/92 backdrop-blur-sm border border-white/[0.08] hover:border-[#c5c8cf]/35 hover:bg-[#15131b] transition-all duration-300 text-left shadow-[0_8px_24px_rgba(0,0,0,0.6)] cursor-pointer"
          >
            <div className="absolute top-3.5 right-3.5 text-[#5e5852] group-hover:text-[#ded8ce] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="w-10 h-10 rounded flex items-center justify-center bg-white/[0.03] border border-white/[0.06] text-[#9c9488] group-hover:text-white group-hover:border-[#c5c8cf]/25 mb-4 transition-all">
              <Disc3 className="w-5 h-5 group-hover:rotate-45 transition-transform duration-500" />
            </div>
            <span className="font-display text-base sm:text-lg tracking-[0.14em] text-[#ded8ce] group-hover:text-white uppercase mb-1">
              {t('navArchive')}
            </span>
            <p className="text-xs text-[#7d766e] group-hover:text-[#9e968b] leading-relaxed line-clamp-2 safe-text-wrap">
              {lang === 'ru'
                ? 'Дискография, альбомы, синглы, неизданные дорожки и lossless аудио'
                : 'Discography, albums, singles, unreleased tracks and lossless audio'}
            </p>
          </button>

          {/* 2. Interactive Challenges (Games) */}
          <button
            type="button"
            onClick={() => onNavigate('games')}
            className="group relative flex flex-col items-start p-4 sm:p-5 rounded-lg bg-[#0e0d12]/92 backdrop-blur-sm border border-white/[0.08] hover:border-[#821c2c]/45 hover:bg-[#161016] transition-all duration-300 text-left shadow-[0_8px_24px_rgba(0,0,0,0.6)] cursor-pointer"
          >
            <div className="absolute top-3.5 right-3.5 text-[#5e5852] group-hover:text-[#ded8ce] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="w-10 h-10 rounded flex items-center justify-center bg-white/[0.03] border border-white/[0.06] text-[#9c9488] group-hover:text-[#e8909c] group-hover:border-[#821c2c]/35 mb-4 transition-all">
              <Trophy className="w-5 h-5 group-hover:scale-110 transition-transform duration-300" />
            </div>
            <span className="font-display text-base sm:text-lg tracking-[0.14em] text-[#ded8ce] group-hover:text-white uppercase mb-1">
              {t('navGames')}
            </span>
            <p className="text-xs text-[#7d766e] group-hover:text-[#9e968b] leading-relaxed line-clamp-2 safe-text-wrap">
              {lang === 'ru'
                ? 'Угадай трек по звуку, ежедневная викторина, XP и таблица лидеров'
                : 'Guess the track by audio snippet, daily quiz, XP and leaderboard'}
            </p>
          </button>

          {/* 3. Community Forum */}
          <button
            type="button"
            onClick={() => onNavigate('community')}
            className="group relative flex flex-col items-start p-4 sm:p-5 rounded-lg bg-[#0e0d12]/92 backdrop-blur-sm border border-white/[0.08] hover:border-[#c5c8cf]/35 hover:bg-[#15131b] transition-all duration-300 text-left shadow-[0_8px_24px_rgba(0,0,0,0.6)] cursor-pointer"
          >
            <div className="absolute top-3.5 right-3.5 text-[#5e5852] group-hover:text-[#ded8ce] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="w-10 h-10 rounded flex items-center justify-center bg-white/[0.03] border border-white/[0.06] text-[#9c9488] group-hover:text-white group-hover:border-[#c5c8cf]/25 mb-4 transition-all">
              <MessageSquare className="w-5 h-5 group-hover:scale-105 transition-transform duration-300" />
            </div>
            <span className="font-display text-base sm:text-lg tracking-[0.14em] text-[#ded8ce] group-hover:text-white uppercase mb-1">
              {t('navCommunity')}
            </span>
            <p className="text-xs text-[#7d766e] group-hover:text-[#9e968b] leading-relaxed line-clamp-2 safe-text-wrap">
              {lang === 'ru'
                ? 'Официальные новости архива, обсуждение музыки и саунд-дизайна'
                : 'Official archive updates, music discussions and sound design threads'}
            </p>
          </button>

          {/* 4. Creations Gallery */}
          <button
            type="button"
            onClick={() => onNavigate('creations')}
            className="group relative flex flex-col items-start p-4 sm:p-5 rounded-lg bg-[#0e0d12]/92 backdrop-blur-sm border border-white/[0.08] hover:border-[#c5c8cf]/35 hover:bg-[#15131b] transition-all duration-300 text-left shadow-[0_8px_24px_rgba(0,0,0,0.6)] cursor-pointer"
          >
            <div className="absolute top-3.5 right-3.5 text-[#5e5852] group-hover:text-[#ded8ce] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="w-10 h-10 rounded flex items-center justify-center bg-white/[0.03] border border-white/[0.06] text-[#9c9488] group-hover:text-[#ded8ce] group-hover:border-[#c5c8cf]/25 mb-4 transition-all">
              <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
            </div>
            <span className="font-display text-base sm:text-lg tracking-[0.14em] text-[#ded8ce] group-hover:text-white uppercase mb-1">
              {t('navCreations')}
            </span>
            <p className="text-xs text-[#7d766e] group-hover:text-[#9e968b] leading-relaxed line-clamp-2 safe-text-wrap">
              {lang === 'ru'
                ? 'Артворки, каверы, видеомонтаж, биты и визуальные работы авторов'
                : 'Artworks, covers, video edits, beats and community creative works'}
            </p>
          </button>
        </div>
      </div>
    </div>
  );
};
