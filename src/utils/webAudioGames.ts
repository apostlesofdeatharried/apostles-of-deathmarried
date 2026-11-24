/**
 * Web Audio API engine for Reverse Track (5s) and Speed Track (0.5x / 2.5x, 5s).
 * Designed for rock-solid reliability on Vercel and iOS Safari:
 * - Always creates/resumes AudioContext synchronously inside a user click gesture.
 * - Fetches audio strictly via same-origin paths (/uploads/... or /audio/...) to avoid CORS errors.
 * - Uses Promise + callback decodeAudioData wrapper for older Safari versions.
 * - Caches decoded AudioBuffers in memory so replays are instantaneous.
 */

export const AUDIO_CHUNK_SIZE_BYTES = 1572864; // 1.5 MiB per request (well below Vercel 4.5 MB cap)
export const AUDIO_REVERSE_FAST_CHUNK_BYTES = 1310720; // 1.25 MiB fast chunk for 5s reverse snippets
export const AUDIO_MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB ceiling for huge files

interface CachedAudioEntry {
  raw: ArrayBuffer;
  ctx?: AudioContext;
  decoded?: AudioBuffer;
}

let sharedAudioCtx: AudioContext | null = null;
const audioCache = new Map<string, CachedAudioEntry>();
const MAX_CACHE_ENTRIES = 6;

export interface ActiveAudioPlayback {
  stop: () => void;
  durationSeconds: number;
}

export interface UnlockedAudioContextResult {
  ctx: AudioContext;
  resumePromise: Promise<void>;
}

/**
 * Must be called synchronously inside a user click/tap handler (critical for iPhone/iOS Safari).
 * Triggers a silent 1-sample node + ctx.resume() inside the gesture stack so Web Audio unlocks reliably.
 */
export function unlockAudioContextWithResume(): UnlockedAudioContextResult {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new Error('Ваш браузер не поддерживает Web Audio API.');
  }
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new Ctor();
  }
  const ctx = sharedAudioCtx;

  // iOS Safari unlock: play an inaudible 1-sample buffer synchronously inside the user gesture
  try {
    const silentBuffer = ctx.createBuffer(1, 1, 22050);
    const silentSource = ctx.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(ctx.destination);
    silentSource.start(0);
  } catch {}

  const resumePromise =
    ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve();

  return { ctx, resumePromise };
}

export function unlockAudioContext(): AudioContext {
  return unlockAudioContextWithResume().ctx;
}

export async function closeWebAudioContext(): Promise<void> {
  const ctx = sharedAudioCtx;
  sharedAudioCtx = null;
  for (const entry of audioCache.values()) {
    if (entry.ctx === ctx) {
      entry.ctx = undefined;
      entry.decoded = undefined;
    }
  }
  if (ctx && ctx.state !== 'closed') {
    try {
      await ctx.close();
    } catch {}
  }
}

export function normalizeSameOriginUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) throw new Error('Аудиофайл недоступен.');
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/audio/')) {
    return trimmed;
  }
  const baseOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';
  try {
    const parsed = new URL(trimmed, baseOrigin);
    if (parsed.origin === baseOrigin) {
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

/**
 * Downloads audio via sequential 1.5 MB HTTP Range chunks (capped at 4 MB for large files),
 * staying safely below Vercel's 4.5 MB Serverless payload limit.
 */
export async function fetchAudioBufferInChunks(
  url: string,
  options?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    chunkSizeBytes?: number;
    maxDownloadBytes?: number;
  }
): Promise<ArrayBuffer> {
  const safeUrl = normalizeSameOriginUrl(url);
  const fetchFn = options?.fetchImpl || fetch;
  const signal = options?.signal;
  const chunkSize = Math.max(1024, options?.chunkSizeBytes || AUDIO_CHUNK_SIZE_BYTES);
  const maxBytes = Math.max(chunkSize, options?.maxDownloadBytes || AUDIO_MAX_DOWNLOAD_BYTES);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  let totalReceived = 0;

  while (offset < maxBytes) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const end = Math.min(offset + chunkSize - 1, maxBytes - 1);
    const requestedLength = end - offset + 1;
    const response = await fetchFn(safeUrl, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Range: `bytes=${offset}-${end}`,
      },
      signal,
    });

    if (response.status === 416) {
      if (chunks.length > 0) break;
      throw new Error('Аудиофайл не найден или пуст.');
    }

    if (response.status === 200) {
      const fullBuffer = await response.arrayBuffer();
      if (!fullBuffer || fullBuffer.byteLength < 64) {
        throw new Error('Аудиофайл пуст или повреждён.');
      }
      if (chunks.length === 0) {
        return fullBuffer;
      }
      break;
    }

    if (!response.ok) {
      throw new Error(`Не удалось загрузить аудио (${response.status}).`);
    }

    const contentRange = response.headers.get('content-range') || '';
    const crMatch = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(contentRange);
    const totalFileBytes = crMatch && crMatch[3] !== '*' ? Number(crMatch[3]) : null;

    const chunkBuffer = await response.arrayBuffer();
    const chunkBytes = new Uint8Array(chunkBuffer);
    if (chunkBytes.byteLength === 0) {
      break;
    }

    chunks.push(chunkBytes);
    totalReceived += chunkBytes.byteLength;
    offset += chunkBytes.byteLength;

    if (totalFileBytes !== null && offset >= totalFileBytes) {
      break;
    }
    if (totalFileBytes === null && chunkBytes.byteLength < requestedLength) {
      break;
    }
  }

  if (totalReceived < 64) {
    throw new Error('Аудиофайл пуст или повреждён.');
  }

  const merged = new Uint8Array(totalReceived);
  let writeOffset = 0;
  for (const part of chunks) {
    merged.set(part, writeOffset);
    writeOffset += part.byteLength;
  }
  return merged.buffer;
}

export interface FetchDecodeAudioOptions {
  signal?: AbortSignal;
  snippetStart?: number;
  chunkSizeBytes?: number;
  maxDownloadBytes?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAndDecodeAudio(
  url: string,
  ctx: AudioContext,
  signalOrOptions?: AbortSignal | FetchDecodeAudioOptions
): Promise<AudioBuffer> {
  const safeUrl = normalizeSameOriginUrl(url);
  const opts: FetchDecodeAudioOptions =
    signalOrOptions && typeof (signalOrOptions as AbortSignal).aborted === 'boolean'
      ? { signal: signalOrOptions as AbortSignal }
      : (signalOrOptions as FetchDecodeAudioOptions | undefined) || {};

  const signal = opts.signal;
  const snippetStart = typeof opts.snippetStart === 'number' && Number.isFinite(opts.snippetStart)
    ? Math.max(0, opts.snippetStart)
    : undefined;

  const chunkSizeBytes = Math.max(
    1024,
    opts.chunkSizeBytes || AUDIO_REVERSE_FAST_CHUNK_BYTES
  );
  const defaultMaxBytes =
    snippetStart !== undefined && snippetStart > 35
      ? chunkSizeBytes * 2
      : chunkSizeBytes;
  const targetMaxBytes = Math.max(chunkSizeBytes, opts.maxDownloadBytes || defaultMaxBytes);

  const existing = audioCache.get(safeUrl);
  if (
    existing?.decoded &&
    existing.ctx === ctx &&
    ctx.state !== 'closed' &&
    (snippetStart === undefined ||
      existing.decoded.duration >= snippetStart + 5 ||
      existing.raw.byteLength >= targetMaxBytes)
  ) {
    return existing.decoded;
  }

  let rawBuffer =
    existing?.raw && existing.raw.byteLength >= targetMaxBytes ? existing.raw : undefined;
  if (!rawBuffer) {
    rawBuffer = await fetchAudioBufferInChunks(safeUrl, {
      signal,
      fetchImpl: opts.fetchImpl,
      chunkSizeBytes,
      maxDownloadBytes: targetMaxBytes,
    });
    if (audioCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = audioCache.keys().next().value;
      if (oldestKey) audioCache.delete(oldestKey);
    }
    audioCache.set(safeUrl, { raw: rawBuffer });
  }

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let decoded: AudioBuffer;
  try {
    // Clone buffer before decoding because decodeAudioData detaches the ArrayBuffer
    const copy = rawBuffer.slice(0);
    decoded = await decodeAudioDataCompat(ctx, copy);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    const fallbackMaxBytes = Math.max(targetMaxBytes, AUDIO_CHUNK_SIZE_BYTES * 2);
    if (rawBuffer.byteLength < fallbackMaxBytes) {
      const expandedBuffer = await fetchAudioBufferInChunks(safeUrl, {
        signal,
        fetchImpl: opts.fetchImpl,
        chunkSizeBytes: AUDIO_CHUNK_SIZE_BYTES,
        maxDownloadBytes: fallbackMaxBytes,
      });
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        decoded = await decodeAudioDataCompat(ctx, expandedBuffer.slice(0));
        rawBuffer = expandedBuffer;
      } catch (retryErr: any) {
        if (retryErr?.name === 'AbortError') throw retryErr;
        throw new Error('Не удалось декодировать аудиофайл. Попробуйте ещё раз.');
      }
    } else {
      throw new Error('Не удалось декодировать аудиофайл. Попробуйте ещё раз.');
    }
  }

  audioCache.set(safeUrl, { raw: rawBuffer, ctx, decoded });
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
