export type ShareCardFormat = 'story' | 'square';

export type ShareCardContext =
  | {
      type: 'game';
      gameTitle: string;
      /** Large primary metric or result (e.g. "5 / 5", "Угадан", "Не угадан") */
      resultPrimary?: string;
      /** Legacy alias kept for compatibility */
      scoreLabel?: string;
      /** Short status line underneath (e.g. "Идеальный результат · +75 XP" or track title) */
      statusLine?: string;
      /** Legacy alias kept for compatibility */
      headline?: string;
      xpEarned?: number;
      streakDays?: number;
      /** Raw username without @ (e.g. "sushkanov097") — strictly rendered as @username only */
      username?: string | null;
      /** Legacy fallback — sanitized to @handle only if username omitted */
      subtitle?: string;
      shareUrl?: string;
    }
  | {
      type: 'profile';
      displayName?: string;
      nickname: string;
      avatarUrl?: string | null;
      shieldTitle?: string | null;
      level: number;
      totalXp?: number;
      streakDays?: number;
      favoriteTrack?: string | null;
      bannerKey?: string | null;
      shareUrl?: string;
    }
  | {
      type: 'lyrics';
      trackTitle: string;
      releaseTitle?: string;
      coverUrl?: string | null;
      lines: string[];
      shareUrl?: string;
    };

const FALLBACK_SANS =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function getPrimarySansFontFamily(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return FALLBACK_SANS;
  }
  try {
    const computed = window.getComputedStyle(document.body).fontFamily?.trim();
    if (computed && !/serif|georgia|times/i.test(computed.split(',')[0] || '')) {
      return computed;
    }
  } catch {}
  return FALLBACK_SANS;
}

interface LoadedImageResult {
  img: HTMLImageElement;
  objectUrl?: string;
}

function decodeImageElement(src: string, crossOrigin?: string, timeoutMs = 5000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) {
      img.crossOrigin = crossOrigin;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(img);
      }
    };
    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    };
    img.src = src;
  });
}

async function loadImageSafe(src?: string | null): Promise<LoadedImageResult | null> {
  if (!src || !src.trim() || typeof window === 'undefined') {
    return null;
  }

  const trimmed = src.trim();
  if (trimmed.startsWith('data:')) {
    const img = await decodeImageElement(trimmed);
    return img ? { img } : null;
  }

  let resolvedUrl = trimmed;
  let isSameOrigin = false;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'blob:') {
      return null;
    }
    resolvedUrl = parsed.href;
    isSameOrigin = parsed.origin === window.location.origin;
  } catch {
    return null;
  }

  // Primary strategy: fetch as Blob -> same-origin ObjectURL (never taints canvas)
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? window.setTimeout(() => controller.abort(), 5500) : null;
    const response = await fetch(resolvedUrl, {
      mode: isSameOrigin ? 'same-origin' : 'cors',
      credentials: isSameOrigin ? 'same-origin' : 'omit',
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (response.ok) {
      const blob = await response.blob();
      if (blob && blob.size > 0 && blob.type.startsWith('image/')) {
        const objectUrl = URL.createObjectURL(blob);
        const img = await decodeImageElement(objectUrl);
        if (img) {
          return { img, objectUrl };
        }
        URL.revokeObjectURL(objectUrl);
      }
    }
  } catch {
    // Fall through to crossOrigin img attempt
  }

  // Fallback strategy: standard anonymous CORS image load
  const fallbackImg = await decodeImageElement(resolvedUrl, 'anonymous');
  return fallbackImg ? { img: fallbackImg } : null;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read PNG blob as data URL'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error while converting PNG'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = /data:([^;]+)/.exec(header || '');
  const mime = mimeMatch?.[1] || 'image/png';
  const binary = atob(base64 || '');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 0) {
              resolve(blob);
              return;
            }
            try {
              const fallbackDataUrl = canvas.toDataURL('image/png');
              resolve(dataUrlToBlob(fallbackDataUrl));
            } catch (fallbackErr) {
              reject(fallbackErr);
            }
          },
          'image/png',
          1.0
        );
      } else {
        const fallbackDataUrl = canvas.toDataURL('image/png');
        resolve(dataUrlToBlob(fallbackDataUrl));
      }
    } catch (err) {
      reject(err);
    }
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Truncates a single string with an ellipsis so its measured width never exceeds maxWidth.
 */
function truncateSingleLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (ctx.measureText(clean).width <= maxWidth) return clean;
  let cut = clean;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1).trimEnd();
  }
  return `${cut}…`;
}

/**
 * Strict word-wrapping with long-word breaking and guaranteed maxLines truncation.
 */
function wrapTextStrict(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  const pushOverflowWord = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (ctx.measureText(chunk + ch).width <= maxWidth) {
        chunk += ch;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
        if (lines.length >= maxLines) return;
      }
    }
    current = chunk;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else if (!current) {
      pushOverflowWord(word);
      if (lines.length >= maxLines) {
        current = '';
        break;
      }
    } else {
      lines.push(current);
      if (lines.length >= maxLines) {
        // Append remaining indicator to last line safely
        const remaining = words.slice(i).join(' ');
        if (remaining) {
          lines[maxLines - 1] = truncateSingleLine(
            ctx,
            `${lines[maxLines - 1]} ${remaining}`,
            maxWidth
          );
        }
        return lines.slice(0, maxLines);
      }
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        current = '';
        pushOverflowWord(word);
        if (lines.length >= maxLines) {
          current = '';
          break;
        }
      }
    }
  }

  if (current) {
    if (lines.length < maxLines) {
      lines.push(current);
    } else {
      lines[maxLines - 1] = truncateSingleLine(ctx, `${lines[maxLines - 1]} ${current}`, maxWidth);
    }
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = truncateSingleLine(ctx, lines[maxLines - 1], maxWidth);
  }

  return lines.map((line) =>
    ctx.measureText(line).width > maxWidth ? truncateSingleLine(ctx, line, maxWidth) : line
  );
}

/**
 * Formats a clean @username handle, stripping any parenthetical role annotations or display text.
 */
function formatCleanHandle(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/^@+/, '')
    .trim();
  if (!cleaned) return null;
  // Prefer a single handle token without spaces
  const token = cleaned.split(/\s+/)[0] || '';
  return token ? `@${token}` : null;
}

/**
 * Draws the clean dark atmospheric background (Spotify / Genius Share Card style).
 * Zero nested borders, zero cliché headers.
 */
function drawAtmosphericBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  accentRgb: [number, number, number] = [154, 34, 54]
) {
  const [r, g, b] = accentRgb;

  const baseGrad = ctx.createLinearGradient(0, 0, W * 0.35, H);
  baseGrad.addColorStop(0, '#121017');
  baseGrad.addColorStop(0.55, '#0b0a0e');
  baseGrad.addColorStop(1, '#070609');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, W, H);

  // Soft upper ambient glow
  const glow1 = ctx.createRadialGradient(W * 0.22, H * 0.16, 20, W * 0.22, H * 0.16, W * 0.82);
  glow1.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.28)`);
  glow1.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.09)`);
  glow1.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, W, H);

  // Subtle lower counter-glow
  const glow2 = ctx.createRadialGradient(W * 0.84, H * 0.84, 10, W * 0.84, H * 0.84, W * 0.65);
  glow2.addColorStop(0, 'rgba(92, 68, 128, 0.13)');
  glow2.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);
}

/**
 * Draws the minimal watermark strictly at the very bottom center.
 */
function drawBottomWatermark(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  fontFamily: string
) {
  ctx.save();
  ctx.font = `500 24px ${fontFamily}`;
  ctx.fillStyle = 'rgba(242, 238, 233, 0.42)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('apostlesofdeathmarried.ru', W / 2, H - 56);
  ctx.restore();
}

async function renderShareCardToCanvas(
  context: ShareCardContext,
  format: ShareCardFormat = 'story',
  allowRemoteImages = true
): Promise<HTMLCanvasElement> {
  // Wait for site web fonts to finish loading so Canvas uses exact site typography
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }

  const fontFamily = getPrimarySansFontFamily();
  const isStory = format === 'story';
  const W = 1080;
  const H = isStory ? 1920 : 1080;
  const PIXEL_SCALE = 2;
  const PAD_X = 88;
  const CONTENT_W = W - PAD_X * 2; // 904px safe horizontal area

  const canvas = document.createElement('canvas');
  canvas.width = W * PIXEL_SCALE;
  canvas.height = H * PIXEL_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.scale(PIXEL_SCALE, PIXEL_SCALE);
  ctx.textBaseline = 'top';

  const loadedObjectUrls: string[] = [];
  const loadSafeTracked = async (url?: string | null): Promise<HTMLImageElement | null> => {
    if (!allowRemoteImages) return null;
    const loaded = await loadImageSafe(url);
    if (!loaded) return null;
    if (loaded.objectUrl) loadedObjectUrls.push(loaded.objectUrl);
    return loaded.img;
  };

  try {
    // =========================================================================
    // 1. LYRICS CARD (Spotify / Genius minimal style)
    // Cover + track title + "deathmarried" + 1-4 lyric lines + bottom watermark
    // =========================================================================
    if (context.type === 'lyrics') {
      drawAtmosphericBackground(ctx, W, H, [162, 36, 58]);

      const coverImg = await loadSafeTracked(context.coverUrl);

      // Subtle blurred cover tint behind the card if cover loaded
      if (coverImg) {
        ctx.save();
        ctx.globalAlpha = 0.14;
        if ('filter' in ctx) {
          try {
            ctx.filter = 'blur(54px)';
          } catch {}
        }
        drawImageCover(ctx, coverImg, -80, -80, W + 160, H + 160);
        ctx.restore();

        // Re-darken softly so lyrics stay ultra legible
        const veil = ctx.createLinearGradient(0, 0, 0, H);
        veil.addColorStop(0, 'rgba(9, 8, 12, 0.45)');
        veil.addColorStop(0.5, 'rgba(9, 8, 12, 0.62)');
        veil.addColorStop(1, 'rgba(7, 6, 9, 0.85)');
        ctx.fillStyle = veil;
        ctx.fillRect(0, 0, W, H);
      }

      const cleanLines = context.lines
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 4);
      const linesToDraw = cleanLines.length > 0 ? cleanLines : ['…'];

      // Header: Cover + Track Title + deathmarried
      const coverSize = isStory ? 132 : 104;
      const headerY = isStory ? 156 : 86;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetY = 12;
      drawRoundedRect(ctx, PAD_X, headerY, coverSize, coverSize, 20);
      ctx.fillStyle = '#181620';
      ctx.fill();
      ctx.restore();

      if (coverImg) {
        ctx.save();
        drawRoundedRect(ctx, PAD_X, headerY, coverSize, coverSize, 20);
        ctx.clip();
        drawImageCover(ctx, coverImg, PAD_X, headerY, coverSize, coverSize);
        ctx.restore();
      } else {
        // Minimal emblem fallback
        ctx.save();
        drawRoundedRect(ctx, PAD_X, headerY, coverSize, coverSize, 20);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(242, 238, 233, 0.35)';
        ctx.font = `600 ${Math.round(coverSize * 0.34)}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('dm', PAD_X + coverSize / 2, headerY + coverSize / 2);
        ctx.restore();
      }

      const metaX = PAD_X + coverSize + 30;
      const metaMaxW = W - PAD_X - metaX;

      // Auto-scale track title for long titles
      let titleFontSize = isStory ? 44 : 38;
      ctx.font = `700 ${titleFontSize}px ${fontFamily}`;
      if (ctx.measureText(context.trackTitle).width > metaMaxW) {
        titleFontSize = isStory ? 36 : 32;
        ctx.font = `700 ${titleFontSize}px ${fontFamily}`;
      }
      const titleFitted = truncateSingleLine(ctx, context.trackTitle, metaMaxW);

      const textBlockCenterY = headerY + coverSize / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f5f1ec';
      ctx.fillText(titleFitted, metaX, textBlockCenterY - 4);

      ctx.font = `500 ${isStory ? 30 : 26}px ${fontFamily}`;
      ctx.fillStyle = 'rgba(242, 238, 233, 0.56)';
      ctx.fillText('deathmarried', metaX, textBlockCenterY + (isStory ? 36 : 30));

      // Lyrics block: dynamically scale font so 1–4 lines fit cleanly inside vertical bounds
      const lyricsTopLimit = headerY + coverSize + (isStory ? 110 : 72);
      const lyricsBottomLimit = H - (isStory ? 185 : 130);
      const availableLyricsH = lyricsBottomLimit - lyricsTopLimit;

      const totalChars = linesToDraw.reduce((sum, l) => sum + l.length, 0);
      let lyricFontSize = isStory
        ? totalChars > 180
          ? 44
          : totalChars > 110
            ? 52
            : 62
        : totalChars > 160
          ? 36
          : totalChars > 95
            ? 44
            : 52;

      let wrappedEntries: string[][] = [];
      let lineHeight = 0;
      let paragraphGap = 0;
      let totalBlockH = 0;

      while (lyricFontSize >= 28) {
        ctx.font = `700 ${lyricFontSize}px ${fontFamily}`;
        lineHeight = Math.round(lyricFontSize * 1.32);
        paragraphGap = Math.round(lyricFontSize * 0.42);
        wrappedEntries = linesToDraw.map((line) => wrapTextStrict(ctx, line, CONTENT_W, 3));
        const totalWrappedLines = wrappedEntries.reduce((s, arr) => s + arr.length, 0);
        totalBlockH =
          totalWrappedLines * lineHeight + Math.max(0, wrappedEntries.length - 1) * paragraphGap;
        if (totalBlockH <= availableLyricsH) break;
        lyricFontSize -= 4;
      }

      // Center lyrics vertically inside the spacious body area
      let cursorY = lyricsTopLimit + Math.max(0, Math.floor((availableLyricsH - totalBlockH) / 2));

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${lyricFontSize}px ${fontFamily}`;
      ctx.fillStyle = '#f8f5f0';

      for (let i = 0; i < wrappedEntries.length; i++) {
        for (const subline of wrappedEntries[i]) {
          if (cursorY + lineHeight <= lyricsBottomLimit + 8) {
            ctx.fillText(subline, PAD_X, cursorY);
            cursorY += lineHeight;
          }
        }
        if (i < wrappedEntries.length - 1) {
          cursorY += paragraphGap;
        }
      }

      drawBottomWatermark(ctx, W, H, fontFamily);
      return canvas;
    }

    // =========================================================================
    // 2. GAME RESULT CARD
    // Game title (ONCE) + large result + short status + @username ONLY + watermark
    // =========================================================================
    if (context.type === 'game') {
      drawAtmosphericBackground(ctx, W, H, [156, 32, 54]);

      const handle = formatCleanHandle(context.username ?? context.subtitle);
      const primaryResult = (context.resultPrimary || context.scoreLabel || context.headline || 'Готово').trim();
      const statusParts: string[] = [];
      if (context.statusLine && context.statusLine.trim()) {
        statusParts.push(context.statusLine.trim());
      } else if (
        context.headline &&
        context.headline.trim() &&
        context.headline.trim().toLowerCase() !== primaryResult.toLowerCase()
      ) {
        statusParts.push(context.headline.trim());
      }
      if (typeof context.xpEarned === 'number' && context.xpEarned > 0) {
        statusParts.push(`+${context.xpEarned} XP`);
      }
      const statusText = statusParts.join(' · ');

      // Subtle accent bar at top of content cluster
      const centerX = W / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Measure vertical layout so the entire result sits optically centered
      let titleSize = isStory ? 42 : 36;
      ctx.font = `600 ${titleSize}px ${fontFamily}`;
      if (ctx.measureText(context.gameTitle).width > CONTENT_W) {
        titleSize = isStory ? 34 : 30;
        ctx.font = `600 ${titleSize}px ${fontFamily}`;
      }
      const fittedGameTitle = truncateSingleLine(ctx, context.gameTitle, CONTENT_W);

      // Dynamic sizing for the large primary result
      let bigFontSize = isStory ? 136 : 112;
      ctx.font = `800 ${bigFontSize}px ${fontFamily}`;
      while (bigFontSize > 52 && ctx.measureText(primaryResult).width > CONTENT_W) {
        bigFontSize -= 6;
        ctx.font = `800 ${bigFontSize}px ${fontFamily}`;
      }
      const resultLines = wrapTextStrict(ctx, primaryResult, CONTENT_W, 2);
      const resultLineH = Math.round(bigFontSize * 1.16);

      const statusFontSize = isStory ? 36 : 30;
      ctx.font = `500 ${statusFontSize}px ${fontFamily}`;
      const statusLines = statusText ? wrapTextStrict(ctx, statusText, CONTENT_W, 2) : [];
      const statusLineH = Math.round(statusFontSize * 1.38);

      const handleFontSize = isStory ? 34 : 28;

      const totalClusterH =
        8 + // accent bar
        34 +
        titleSize +
        (isStory ? 72 : 48) +
        resultLines.length * resultLineH +
        (statusLines.length > 0 ? (isStory ? 38 : 26) + statusLines.length * statusLineH : 0) +
        (handle ? (isStory ? 76 : 52) + handleFontSize : 0);

      const usableTop = isStory ? 160 : 90;
      const usableBottom = H - (isStory ? 160 : 120);
      let y = usableTop + Math.max(0, Math.floor((usableBottom - usableTop - totalClusterH) / 2));

      // Minimal crimson hairline accent
      ctx.fillStyle = '#b42b42';
      drawRoundedRect(ctx, centerX - 36, y, 72, 6, 3);
      ctx.fill();
      y += 40;

      // Game title (shown ONCE)
      ctx.font = `600 ${titleSize}px ${fontFamily}`;
      ctx.fillStyle = 'rgba(242, 238, 233, 0.72)';
      ctx.fillText(fittedGameTitle, centerX, y);
      y += titleSize + (isStory ? 72 : 48);

      // Large clean result
      ctx.font = `800 ${bigFontSize}px ${fontFamily}`;
      ctx.fillStyle = '#ffffff';
      for (const rLine of resultLines) {
        ctx.fillText(rLine, centerX, y);
        y += resultLineH;
      }

      // Short status line
      if (statusLines.length > 0) {
        y += isStory ? 32 : 22;
        ctx.font = `500 ${statusFontSize}px ${fontFamily}`;
        ctx.fillStyle = 'rgba(242, 238, 233, 0.68)';
        for (const sLine of statusLines) {
          ctx.fillText(sLine, centerX, y);
          y += statusLineH;
        }
      }

      // Clean @username ONLY
      if (handle) {
        y += isStory ? 72 : 48;
        ctx.font = `600 ${handleFontSize}px ${fontFamily}`;
        ctx.fillStyle = 'rgba(242, 238, 233, 0.88)';
        ctx.fillText(truncateSingleLine(ctx, handle, CONTENT_W), centerX, y);
      }

      drawBottomWatermark(ctx, W, H, fontFamily);
      return canvas;
    }

    // =========================================================================
    // 3. PROFILE CARD (Minimalist & Clean)
    // Avatar + @username ONLY + shield/title + level + favorite track + watermark
    // =========================================================================
    drawAtmosphericBackground(ctx, W, H, [146, 30, 52]);

    const avatarImg = await loadSafeTracked(context.avatarUrl);
    const handle = formatCleanHandle(context.nickname) || '@apostle';
    const shield = context.shieldTitle?.trim() || null;
    const favTrack = context.favoriteTrack?.trim() || null;

    const centerX = W / 2;
    const avatarR = isStory ? 132 : 98;
    const handleSize = isStory ? 60 : 48;
    const levelSize = isStory ? 34 : 28;
    const shieldFontSize = isStory ? 26 : 22;
    const favLabelSize = isStory ? 22 : 19;
    const favValueSize = isStory ? 34 : 28;

    // Compute total height so content is cleanly centered vertically
    let clusterH = avatarR * 2 + (isStory ? 44 : 30) + handleSize;
    if (shield) clusterH += (isStory ? 24 : 18) + (isStory ? 52 : 44);
    clusterH += (isStory ? 40 : 28) + levelSize;
    if (favTrack) clusterH += (isStory ? 64 : 44) + favLabelSize + 12 + favValueSize;

    const usableTop = isStory ? 160 : 84;
    const usableBottom = H - (isStory ? 160 : 120);
    let y = usableTop + Math.max(0, Math.floor((usableBottom - usableTop - clusterH) / 2));

    // Avatar circle with subtle atmospheric halo
    const avatarCy = y + avatarR;
    ctx.save();
    const halo = ctx.createRadialGradient(centerX, avatarCy, avatarR * 0.8, centerX, avatarCy, avatarR * 1.45);
    halo.addColorStop(0, 'rgba(180, 43, 66, 0.35)');
    halo.addColorStop(1, 'rgba(180, 43, 66, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(centerX, avatarCy, avatarR * 1.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centerX, avatarCy, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#15141b';
    ctx.fillRect(centerX - avatarR, avatarCy - avatarR, avatarR * 2, avatarR * 2);
    if (avatarImg) {
      drawImageCover(ctx, avatarImg, centerX - avatarR, avatarCy - avatarR, avatarR * 2, avatarR * 2);
    } else {
      ctx.fillStyle = 'rgba(242, 238, 233, 0.5)';
      ctx.font = `700 ${Math.round(avatarR * 0.72)}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(handle.slice(1, 2).toUpperCase(), centerX, avatarCy + 2);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(centerX, avatarCy, avatarR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    y += avatarR * 2 + (isStory ? 44 : 30);

    // @username ONLY
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let actualHandleSize = handleSize;
    ctx.font = `700 ${actualHandleSize}px ${fontFamily}`;
    while (actualHandleSize > 34 && ctx.measureText(handle).width > CONTENT_W) {
      actualHandleSize -= 4;
      ctx.font = `700 ${actualHandleSize}px ${fontFamily}`;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncateSingleLine(ctx, handle, CONTENT_W), centerX, y);
    y += actualHandleSize;

    // Optional shield / title badge
    if (shield) {
      y += isStory ? 24 : 18;
      ctx.font = `600 ${shieldFontSize}px ${fontFamily}`;
      const fittedShield = truncateSingleLine(ctx, shield, CONTENT_W - 72);
      const pillW = Math.min(CONTENT_W, Math.ceil(ctx.measureText(fittedShield).width) + 52);
      const pillH = isStory ? 52 : 44;

      drawRoundedRect(ctx, centerX - pillW / 2, y, pillW, pillH, pillH / 2);
      ctx.fillStyle = 'rgba(180, 43, 66, 0.2)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(218, 92, 114, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#f4dce0';
      ctx.textBaseline = 'middle';
      ctx.fillText(fittedShield, centerX, y + pillH / 2 + 1);
      ctx.textBaseline = 'top';
      y += pillH;
    }

    // Clean Level line
    y += isStory ? 40 : 28;
    ctx.font = `600 ${levelSize}px ${fontFamily}`;
    ctx.fillStyle = 'rgba(242, 238, 233, 0.72)';
    ctx.fillText(`Уровень ${Math.max(1, Number(context.level) || 1)}`, centerX, y);
    y += levelSize;

    // Favorite Track (if set)
    if (favTrack) {
      y += isStory ? 60 : 42;
      ctx.font = `500 ${favLabelSize}px ${fontFamily}`;
      ctx.fillStyle = 'rgba(242, 238, 233, 0.44)';
      ctx.fillText('Любимый трек', centerX, y);
      y += favLabelSize + 12;

      ctx.font = `700 ${favValueSize}px ${fontFamily}`;
      ctx.fillStyle = '#f5f1ec';
      ctx.fillText(truncateSingleLine(ctx, favTrack, CONTENT_W), centerX, y);
    }

    drawBottomWatermark(ctx, W, H, fontFamily);
    return canvas;
  } finally {
    for (const url of loadedObjectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
  }
}

export async function renderShareCardToBlob(
  context: ShareCardContext,
  format: ShareCardFormat = 'story'
): Promise<Blob> {
  const canvas = await renderShareCardToCanvas(context, format, true);
  try {
    return await canvasToPngBlob(canvas);
  } catch (err) {
    const isSecurityErr =
      (err instanceof DOMException && err.name === 'SecurityError') ||
      (err instanceof Error && /tainted|security/i.test(err.message));
    if (!isSecurityErr) throw err;
    // Fallback re-render without remote bitmaps so tainted canvas can never block PNG export
    const safeCanvas = await renderShareCardToCanvas(context, format, false);
    return await canvasToPngBlob(safeCanvas);
  }
}

export async function renderShareCardToDataUrl(
  context: ShareCardContext,
  format: ShareCardFormat = 'story'
): Promise<string> {
  const blob = await renderShareCardToBlob(context, format);
  return blobToDataUrl(blob);
}
