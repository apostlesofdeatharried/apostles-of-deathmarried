import React, { useState, useEffect } from 'react';
import { renderShareCardToDataUrl, ShareCardContext, ShareCardFormat } from '../utils/shareCardGenerator.js';
import { Download, Share2, Check, X, Loader2, Smartphone, Square } from 'lucide-react';

interface ShareCardModalProps {
  isOpen: boolean;
  context: ShareCardContext | null;
  onClose: () => void;
}

export const ShareCardModal: React.FC<ShareCardModalProps> = ({ isOpen, context, onClose }) => {
  const [format, setFormat] = useState<ShareCardFormat>('story');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!isOpen || !context) return;
    let cancelled = false;
    setRendering(true);
    renderShareCardToDataUrl(context, format)
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, context, format]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !context) return null;

  const shareUrl = context.shareUrl || window.location.href;

  const handleDownload = () => {
    if (!dataUrl) return;
    const slug =
      context.type === 'game'
        ? 'game-result'
        : context.type === 'profile'
          ? `profile-${context.nickname}`
          : `lyrics-${context.trackTitle.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').slice(0, 28)}`;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `apostles-${slug}-${format}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShareLink = async () => {
    const shareTitle =
      context.type === 'game'
        ? `${context.gameTitle} — Apostles of deathmarried`
        : context.type === 'profile'
          ? `@${context.nickname} — Apostles of deathmarried`
          : `«${context.lines[0] || context.trackTitle}» — deathmarried`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareTitle,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or Web Share unavailable -> fallback to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 2200);
      } catch {}
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Поделиться карточкой"
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90dvh] rounded-xl border border-white/[0.12] bg-[#0e0d12] shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 border-b border-white/[0.08] bg-[#131218]">
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base uppercase tracking-wider text-[#f2eee9] truncate">
              Поделиться карточкой
            </h2>
            <p className="text-[11px] text-[#8e877e] truncate">
              PNG высокого качества для сторис и соцсетей
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="shrink-0 w-9 h-9 -mr-1 rounded-lg flex items-center justify-center text-[#c7c0b6] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format Switcher */}
        <div className="shrink-0 px-4 pt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setFormat('story')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-wider border transition-colors cursor-pointer ${
              format === 'story'
                ? 'bg-white/[0.12] border-white/25 text-white'
                : 'bg-[#14131a] border-white/[0.07] text-[#8e877e] hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Сторис 9:16</span>
          </button>
          <button
            type="button"
            onClick={() => setFormat('square')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md font-mono text-[11px] uppercase tracking-wider border transition-colors cursor-pointer ${
              format === 'square'
                ? 'bg-white/[0.12] border-white/25 text-white'
                : 'bg-[#14131a] border-white/[0.07] text-[#8e877e] hover:text-white'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span>Карточка 1:1</span>
          </button>
        </div>

        {/* Non-scrolling, fully contained Preview Stage */}
        <div className="flex-1 min-h-0 px-4 py-3 flex items-center justify-center overflow-hidden">
          {rendering || !dataUrl ? (
            <div className="h-[42dvh] w-full flex flex-col items-center justify-center gap-2 text-[#8e877e] font-mono text-xs">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Генерация PNG...</span>
            </div>
          ) : (
            <img
              src={dataUrl}
              alt="Предпросмотр карточки"
              loading="lazy"
              className="max-h-[42dvh] w-auto max-w-full object-contain mx-auto rounded-lg border border-white/[0.1] shadow-xl"
            />
          )}
        </div>

        {/* Fixed Footer Actions */}
        <div className="shrink-0 px-4 sm:px-5 py-3.5 border-t border-white/[0.08] bg-[#131218] grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!dataUrl || rendering}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#f2eee9] hover:bg-white disabled:opacity-40 text-[#09090b] font-mono text-xs uppercase tracking-wider font-semibold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать PNG</span>
          </button>
          <button
            type="button"
            onClick={handleShareLink}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[#f2eee9] font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-[#7ed6a3]" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Ссылка скопирована' : 'Поделиться ссылкой'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
