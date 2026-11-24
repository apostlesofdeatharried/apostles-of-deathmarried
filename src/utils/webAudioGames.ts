/**
 * Web Audio API engine for Reverse Track (5s) and Speed Track (0.5x / 2.5x, 5s).
 * Designed for rock-solid reliability on Vercel and iOS Safari:
 * - Always creates/resumes AudioContext synchronously inside a user click gesture.
 * - Fetches audio strictly via same-origin paths (/uploads/... or /audio/...) to avoid CORS errors.
 * - Uses Promise + callback decodeAudioData wrapper for older Safari versions.
 * - Caches decoded AudioBuffers in memory so replays are instantaneous.
 */

let sharedAudioCtx: AudioContext | null = null;
const decodedBufferCache = new Map<string, AudioBuffer>();
const MAX_CACHE_ENTRIES = 6;

export interface ActiveAudioPlayback {
  stop: () => void;
  durationSeconds: number;
}

/**
 * Must be called synchronously inside a user click/tap handler (critical for iPhone/iOS Safari).
 */
export function unlockAudioContext(): AudioContext {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new Error('Ваш браузер не поддерживает Web Audio API.');
  }
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === 'suspended') {
    // Trigger resume synchronously inside the click gesture
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function normalizeSameOriginUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) throw new Error('Аудиофайл недоступен.');
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/audio/')) {
    return trimmed;
  }
  // If an absolute URL points to our own origin, keep its path
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}`;
    }
    // Proxy Supabase Storage media URLs through same-origin /uploads/<file>
    const uploadMatch = parsed.pathname.match(/\/([^/]+\.(?:mp3|wav|ogg|m4a|flac|aac))$/i);
    if (uploadMatch) {
      return `/uploads/${encodeURIComponent(uploadMatch[1])}`;
    }
  } catch {}
  return trimmed;
}

function decodeAudioDataCompat(ctx: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = ctx.decodeAudioData(
        arrayBuffer,
        (decoded) => resolve(decoded),
        (err) => reject(err || new Error('Не удалось декодировать аудиофайл.'))
      );
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

export async function fetchAndDecodeAudio(url: string, ctx: AudioContext): Promise<AudioBuffer> {
  const safeUrl = normalizeSameOriginUrl(url);
  const cached = decodedBufferCache.get(safeUrl);
  if (cached) return cached;

  const response = await fetch(safeUrl, {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить аудио (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength < 64) {
    throw new Error('Аудиофайл пуст или повреждён.');
  }

  // Clone buffer before decoding because decodeAudioData detaches the ArrayBuffer
  const copy = arrayBuffer.slice(0);
  const decoded = await decodeAudioDataCompat(ctx, copy);

  if (decodedBufferCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = decodedBufferCache.keys().next().value;
    if (oldestKey) decodedBufferCache.delete(oldestKey);
  }
  decodedBufferCache.set(safeUrl, decoded);
  return decoded;
}

/**
 * Slices a snippet window from an AudioBuffer and reverses every channel's PCM samples,
 * with a gentle 15ms fade-in/fade-out to avoid audio clicks.
 */
function buildReversedSnippetBuffer(
  ctx: AudioContext,
  sourceBuffer: AudioBuffer,
  requestedStartSec: number,
  requestedStartRatio: number,
  targetDurationSec: number
): AudioBuffer {
  const sampleRate = sourceBuffer.sampleRate;
  const totalDur = sourceBuffer.duration;
  const effectiveDur = Math.max(0.5, Math.min(targetDurationSec, totalDur));

  let startSec = Math.max(0, requestedStartSec);
  if (startSec + effectiveDur > totalDur) {
    const maxStart = Math.max(0, totalDur - effectiveDur);
    const ratio = Number.isFinite(requestedStartRatio)
      ? Math.max(0, Math.min(0.999999, requestedStartRatio))
      : 0.25;
    startSec = Math.max(0, Math.min(maxStart, maxStart * ratio));
  }

  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const frameCount = Math.max(
    1,
    Math.min(Math.floor(effectiveDur * sampleRate), sourceBuffer.length - startSample)
  );
  const channels = sourceBuffer.numberOfChannels;
  const reversed = ctx.createBuffer(channels, frameCount, sampleRate);
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.015), Math.floor(frameCount / 4));

  for (let ch = 0; ch < channels; ch++) {
    const src = sourceBuffer.getChannelData(ch);
    const dst = reversed.getChannelData(ch);
    const endIdx = startSample + frameCount - 1;
    for (let i = 0; i < frameCount; i++) {
      let sample = src[endIdx - i];
      if (fadeSamples > 0) {
        if (i < fadeSamples) {
          sample *= i / fadeSamples;
        } else if (i > frameCount - fadeSamples) {
          sample *= (frameCount - i) / fadeSamples;
        }
      }
      dst[i] = sample;
    }
  }

  return reversed;
}

/**
 * Plays a 5-second reversed audio snippet using Web Audio API.
 */
export function playReversedSnippet(params: {
  ctx: AudioContext;
  buffer: AudioBuffer;
  snippetStart: number;
  snippetStartRatio?: number;
  durationSeconds?: number;
  onProgress?: (elapsedSec: number, totalSec: number) => void;
  onEnded?: () => void;
}): ActiveAudioPlayback {
  const {
    ctx,
    buffer,
    snippetStart,
    snippetStartRatio = 0.25,
    durationSeconds = 5,
    onProgress,
    onEnded,
  } = params;

  const reversedBuffer = buildReversedSnippetBuffer(
    ctx,
    buffer,
    snippetStart,
    snippetStartRatio,
    durationSeconds
  );
  const actualDuration = reversedBuffer.duration;

  const source = ctx.createBufferSource();
  source.buffer = reversedBuffer;
  source.connect(ctx.destination);

  let stopped = false;
  let rafId: number | null = null;
  const startedAtCtxTime = ctx.currentTime;

  const cleanup = (notifyEnded: boolean) => {
    if (stopped) return;
    stopped = true;
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    try {
      source.onended = null;
      source.stop();
    } catch {}
    try {
      source.disconnect();
    } catch {}
    if (notifyEnded) onEnded?.();
  };

  source.onended = () => cleanup(true);

  const tick = () => {
    if (stopped) return;
    const elapsed = Math.max(0, ctx.currentTime - startedAtCtxTime);
    if (elapsed >= actualDuration) {
      onProgress?.(actualDuration, actualDuration);
      cleanup(true);
      return;
    }
    onProgress?.(elapsed, actualDuration);
    rafId = window.requestAnimationFrame(tick);
  };

  source.start(0);
  rafId = window.requestAnimationFrame(tick);

  return {
    durationSeconds: actualDuration,
    stop: () => cleanup(false),
  };
}

/**
 * Plays a snippet with pitch-shifted playbackRate (0.5x slowed or 2.5x sped up)
 * for exactly `listenDurationSeconds` (default 5s) of REAL listening time.
 */
export function playSpeedSnippet(params: {
  ctx: AudioContext;
  buffer: AudioBuffer;
  snippetStart: number;
  snippetStartRatio?: number;
  playbackRate: 0.5 | 2.5;
  listenDurationSeconds?: number;
  onProgress?: (elapsedSec: number, totalSec: number) => void;
  onEnded?: () => void;
}): ActiveAudioPlayback {
  const {
    ctx,
    buffer,
    snippetStart,
    snippetStartRatio = 0.25,
    playbackRate,
    listenDurationSeconds = 5,
    onProgress,
    onEnded,
  } = params;

  const totalDur = buffer.duration;
  // How many seconds of original source audio are consumed during 5s of real listening time:
  // at 0.5x => 2.5s of source; at 2.5x => 12.5s of source
  const neededSourceSec = listenDurationSeconds * playbackRate;
  const actualSourceSec = Math.min(totalDur, neededSourceSec);
  const actualListenSec = Math.max(0.5, actualSourceSec / playbackRate);

  let offsetSec = Math.max(0, snippetStart);
  if (offsetSec + actualSourceSec > totalDur) {
    const maxOffset = Math.max(0, totalDur - actualSourceSec);
    const ratio = Number.isFinite(snippetStartRatio)
      ? Math.max(0, Math.min(0.999999, snippetStartRatio))
      : 0.25;
    offsetSec = Math.max(0, Math.min(maxOffset, maxOffset * ratio));
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Web Audio AudioBufferSourceNode naturally shifts pitch with playbackRate
  source.playbackRate.value = playbackRate;

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(1, now + 0.02);
  gain.gain.setValueAtTime(1, now + Math.max(0.02, actualListenSec - 0.03));
  gain.gain.linearRampToValueAtTime(0.0001, now + actualListenSec);

  source.connect(gain);
  gain.connect(ctx.destination);

  let stopped = false;
  let rafId: number | null = null;
  const startedAtCtxTime = now;

  const cleanup = (notifyEnded: boolean) => {
    if (stopped) return;
    stopped = true;
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    try {
      source.onended = null;
      source.stop();
    } catch {}
    try {
      source.disconnect();
      gain.disconnect();
    } catch {}
    if (notifyEnded) onEnded?.();
  };

  source.onended = () => cleanup(true);

  const tick = () => {
    if (stopped) return;
    const elapsed = Math.max(0, ctx.currentTime - startedAtCtxTime);
    if (elapsed >= actualListenSec) {
      onProgress?.(actualListenSec, actualListenSec);
      cleanup(true);
      return;
    }
    onProgress?.(elapsed, actualListenSec);
    rafId = window.requestAnimationFrame(tick);
  };

  // Start at offsetSec for actualSourceSec (in source buffer time)
  source.start(now, offsetSec, actualSourceSec);
  rafId = window.requestAnimationFrame(tick);

  return {
    durationSeconds: actualListenSec,
    stop: () => cleanup(false),
  };
}
