import React, { useState, useEffect, useRef } from 'react';
import {
  renderShareCardToBlob,
  blobToDataUrl,
  ShareCardContext,
  ShareCardFormat,
} from '../utils/shareCardGenerator.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { safeJson } from '../utils/logic.js';
import { dispatchAchievementUnlocked } from './AchievementToast.js';
import {
  Download,
  Share2,
  Check,
  X,
  Loader2,
  Smartphone,
  Square,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';

interface ShareCardModalProps {
  isOpen: boolean;
  context: ShareCardContext | null;
  onClose: () => void;
}

function buildShareFileName(context: ShareCardContext, format: ShareCardFormat): string {
  const rawSlug =
    context.type === 'game'
      ? 'game-result'
      : context.type === 'profile'
        ? `profile-${context.nickname}`
        : `lyrics-${context.trackTitle}`;
  const cleanSlug = rawSlug
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'card';
  return `apostles-${cleanSlug}-${format}.png`;
}

function buildShareTitle(context: ShareCardContext): string {
  if (context.type === 'game') {
    return `${context.gameTitle} — Apostles of deathmarried`;
  }
  if (context.type === 'profile') {
    return `@${context.nickname} — Apostles of deathmarried`;
  }
  return `«${context.lines[0] || context.trackTitle}» — deathmarried`;
}

function triggerDesktopBlobDownload(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    try {
      document.body.removeChild(link);
    } catch {}
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {}
  }, 5000);
}

export const ShareCardModal: React.FC<ShareCardModalProps> = ({ isOpen, context, onClose }) => {
  const { user, refresh } = useAuth();
  const [format, setFormat] = useState<ShareCardFormat>('story');
  const [pngBlob, setPngBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [iosFallbackDataUrl, setIosFallbackDataUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const shareAchTrackedRef = useRef<Set<string>>(new Set());

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const contextRef = useRef(context);
  contextRef.current = context;
  const contextKey = context ? JSON.stringify(context) : '';

  const trackShareCardEvent = async () => {
    if (!user || !context) return;
    const targetKey =
      context.type === 'game'
        ? `game:${context.gameTitle}`
        : context.type === 'profile'
          ? `profile:${context.nickname}`
          : `lyrics:${context.trackTitle}`;
    const cleanTargetId = targetKey.replace(/[^a-zA-Z0-9_:.-]/g, '_').slice(0, 100) || 'general';
    const dedupeKey = `${user.id}:${cleanTargetId}`;
    if (shareAchTrackedRef.current.has(dedupeKey)) return;
    shareAchTrackedRef.current.add(dedupeKey);
    try {
      const res = await authFetch('/api/achievements/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'share_card', target_id: cleanTargetId }),
      });
      const data = await safeJson<any>(res, {});
      if (data?.newly_unlocked_achievements?.length) {
        dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        refresh().catch(() => {});
      }
    } catch {}
  };

  useEffect(() => {
    const activeContext = contextRef.current;
    if (!isOpen || !activeContext || !contextKey) return;
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    setRendering(true);
    setSaveError(null);
    setIosFallbackDataUrl(null);
    setPngBlob(null);
    setPreviewUrl(null);

    renderShareCardToBlob(activeContext, format)
      .then((blob) => {
        if (cancelled) return;
        createdObjectUrl = URL.createObjectURL(blob);
        setPngBlob(blob);
        setPreviewUrl(createdObjectUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setPngBlob(null);
        setPreviewUrl(null);
        setSaveError(
          err instanceof Error && err.message
            ? `Не удалось сгенерировать карточку: ${err.message}`
            : 'Не удалось сгенерировать PNG-карточку. Попробуйте ещё раз.'
        );
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      if (createdObjectUrl) {
        try {
          URL.revokeObjectURL(createdObjectUrl);
        } catch {}
      }
    };
  }, [isOpen, contextKey, format]);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  if (!isOpen || !context) return null;

  const shareUrl = context.shareUrl || window.location.href;
  const shareTitle = buildShareTitle(context);

  const handleDownload = async () => {
    if (saving || rendering) return;
    setSaving(true);
    setSaveError(null);

    try {
      const activeBlob = pngBlob || (await renderShareCardToBlob(context, format));
      if (!activeBlob || activeBlob.size === 0) {
        throw new Error('Пустой PNG-файл');
      }

      const fileName = buildShareFileName(context, format);
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
      const isIos =
        /iPad|iPhone|iPod/i.test(ua) ||
        (typeof navigator !== 'undefined' &&
          navigator.platform === 'MacIntel' &&
          navigator.maxTouchPoints > 1);
      const isAndroid = /Android/i.test(ua);
      const isTelegram = /Telegram/i.test(ua);
      const isMobile = isIos || isAndroid || isTelegram;

      // 1. Mobile Web Share API (Level 2 files) -> native "Save Image" / Instagram / Telegram share sheet
      if (
        isMobile &&
        typeof File !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function'
      ) {
        const file = new File([activeBlob], fileName, { type: 'image/png' });
        const canShareFiles =
          typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

        if (canShareFiles) {
          try {
            await navigator.share({
              files: [file],
              title: shareTitle,
            });
            setSaveSuccess(true);
            window.setTimeout(() => setSaveSuccess(false), 2200);
            trackShareCardEvent();
            return;
          } catch (shareErr: any) {
            // User explicitly cancelled system share sheet
            if (shareErr?.name === 'AbortError') {
              return;
            }
            // Otherwise fall through to inline fallback or desktop download
          }
        }
      }

      // 2. iOS Safari / Telegram WebView fallback where <a download> is blocked:
      // Show crisp full-size PNG inside modal for instant long-press "Save to Photos"
      if (isIos || isTelegram) {
        const fallbackUrl = await blobToDataUrl(activeBlob);
        setIosFallbackDataUrl(fallbackUrl);
        trackShareCardEvent();
        return;
      }

      // 3. Desktop & Android Chrome standard Blob download
      triggerDesktopBlobDownload(activeBlob, fileName);
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2200);
      trackShareCardEvent();
    } catch (err) {
      console.error('[ShareCardModal] PNG download failed:', err);
      // Last-resort attempt to expose inline long-press image if blob already exists
      if (pngBlob) {
        try {
          const fallbackUrl = await blobToDataUrl(pngBlob);
          setIosFallbackDataUrl(fallbackUrl);
          return;
        } catch {}
      }
      setSaveError('Не удалось сохранить PNG. Попробуйте нажать «Поделиться ссылкой» или обновить страницу.');
    } finally {
      setSaving(false);
    }
  };

  const handleShareLink = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareTitle,
          url: shareUrl,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        // Fallback to clipboard if share failed
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
              {iosFallbackDataUrl ? 'Сохранить в Фото' : 'Поделиться карточкой'}
            </h2>
            <p className="text-[11px] text-[#8e877e] truncate">
              {iosFallbackDataUrl
                ? 'Зажмите картинку, чтобы сохранить в Фото'
                : 'PNG высокого качества для сторис и соцсетей'}
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

        {/* Format Switcher (hidden in iOS long-press fallback view) */}
        {!iosFallbackDataUrl && (
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
        )}

        {/* Preview Stage / Long-press iOS & Telegram Fallback */}
        <div className="flex-1 min-h-0 px-4 py-3 flex flex-col items-center justify-center overflow-hidden">
          {iosFallbackDataUrl ? (
            <div className="w-full flex flex-col items-center gap-3">
              <img
                src={iosFallbackDataUrl}
                alt="Готовая PNG-карточка — зажмите для сохранения"
                className="max-h-[50dvh] w-auto max-w-full object-contain mx-auto rounded-lg border border-white/[0.16] shadow-2xl select-all"
              />
              <p className="text-center text-xs font-mono text-[#e8dfd4] bg-white/[0.06] border border-white/[0.12] px-3.5 py-2 rounded-lg">
                Зажмите картинку, чтобы сохранить в Фото
              </p>
            </div>
          ) : rendering ? (
            <div className="h-[42dvh] w-full flex flex-col items-center justify-center gap-2 text-[#8e877e] font-mono text-xs">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Генерация PNG...</span>
            </div>
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt="Предпросмотр карточки"
              className="max-h-[42dvh] w-auto max-w-full object-contain mx-auto rounded-lg border border-white/[0.1] shadow-xl"
            />
          ) : (
            <div className="h-[42dvh] w-full flex flex-col items-center justify-center gap-2 text-[#d98490] font-mono text-xs text-center px-4">
              <AlertCircle className="w-5 h-5" />
              <span>{saveError || 'Не удалось отобразить предпросмотр карточки.'}</span>
            </div>
          )}

          {saveError && previewUrl && (
            <div className="mt-2 w-full flex items-center gap-2 rounded-lg border border-[#821c2c]/60 bg-[#821c2c]/20 px-3 py-2 text-[11px] text-[#f2c4cb]">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
        </div>

        {/* Fixed Footer Actions */}
        <div className="shrink-0 px-4 sm:px-5 py-3.5 border-t border-white/[0.08] bg-[#131218] grid grid-cols-1 sm:grid-cols-2 gap-2">
          {iosFallbackDataUrl ? (
            <>
              <button
                type="button"
                onClick={() => setIosFallbackDataUrl(null)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[#f2eee9] font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Назад к формату</span>
              </button>
              <button
                type="button"
                onClick={handleShareLink}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#f2eee9] hover:bg-white text-[#09090b] font-mono text-xs uppercase tracking-wider font-semibold transition-colors cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-[#166534]" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Ссылка скопирована' : 'Поделиться ссылкой'}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDownload}
                disabled={rendering || saving || !pngBlob}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#f2eee9] hover:bg-white disabled:opacity-40 text-[#09090b] font-mono text-xs uppercase tracking-wider font-semibold transition-colors cursor-pointer"
              >
                {saving || rendering ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{rendering ? 'Генерация...' : 'Сохранение...'}</span>
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#166534]" />
                    <span>Сохранено</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать PNG</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleShareLink}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[#f2eee9] font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-[#7ed6a3]" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Ссылка скопирована' : 'Поделиться ссылкой'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
