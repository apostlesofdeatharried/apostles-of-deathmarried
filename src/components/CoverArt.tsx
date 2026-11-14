import React, { useState, useEffect } from 'react';

interface CoverArtProps {
  title: string;
  coverUrl?: string | null;
  format?: 'album' | 'ep' | 'single' | string;
  year?: number | string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'full';
}

export const CoverArt: React.FC<CoverArtProps> = ({
  title,
  coverUrl,
  format,
  year,
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [coverUrl]);

  const hasValidArtwork = Boolean(
    coverUrl &&
    coverUrl.trim().length > 0 &&
    !coverUrl.includes('photo_2026-09-21') &&
    !coverUrl.includes('8c854c0f') &&
    !imgError
  );

  // If real cover is available, render the artwork
  if (hasValidArtwork && coverUrl) {
    return (
      <div className={`relative overflow-hidden bg-black/60 select-none border border-white/[0.08] ${className}`}>
        <img
          src={coverUrl}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover select-none transition-transform duration-700 hover:scale-105"
        />
        <div className="absolute inset-0 ring-1 ring-inset ring-white/10 pointer-events-none" />
        {format && (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 border border-white/15 text-[10px] tracking-wider text-[#ded8ce] uppercase pointer-events-none backdrop-blur-xs font-sans">
            {format}
          </span>
        )}
      </div>
    );
  }

  // Neat minimalist dark vinyl sleeve placeholder (NOT the site logo)
  return (
    <div
      className={`relative overflow-hidden flex flex-col justify-between p-4 select-none border border-white/[0.08] bg-[#0d0c11] ${className}`}
      style={{
        background: 'radial-gradient(circle at 50% 50%, #15131a 0%, #09080c 100%)',
      }}
    >
      {/* Concentric vinyl groove watermark */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-25">
        <div className="w-[85%] h-[85%] rounded-full border border-white/[0.06]" />
        <div className="absolute w-[60%] h-[60%] rounded-full border border-white/[0.05]" />
        <div className="absolute w-[36%] h-[36%] rounded-full border border-white/[0.05]" />
        <div className="absolute w-[14%] h-[14%] rounded-full border border-white/[0.08] bg-black/50" />
      </div>

      {/* Top Header */}
      <div className="relative z-10 flex items-center justify-between w-full">
        <span className="font-sans text-[10px] tracking-[0.2em] uppercase text-ash/80 font-medium">
          deathmarried
        </span>
        {format && (
          <span className="font-sans text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-white/10 bg-black/50 text-ash/90">
            {format}
          </span>
        )}
      </div>

      {/* Center Release Title in Cormorant Garamond */}
      <div className="relative z-10 my-auto text-center px-2 py-3">
        <h4 className="font-title text-base sm:text-lg font-light tracking-wider text-[#f0ede6] leading-tight drop-shadow-sm uppercase">
          {title}
        </h4>
        <div className="w-6 h-[1px] bg-wine-muted/80 mx-auto mt-2" />
      </div>

      {/* Bottom Year */}
      <div className="relative z-10 flex items-center justify-end w-full pt-1 border-t border-white/[0.05]">
        {year && (
          <span className="font-sans text-[10px] tracking-widest text-ash/70">
            {year}
          </span>
        )}
      </div>

      <div className="absolute inset-0 ring-1 ring-inset ring-white/[0.06] pointer-events-none" />
    </div>
  );
};

