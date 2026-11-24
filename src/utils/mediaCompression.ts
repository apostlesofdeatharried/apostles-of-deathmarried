export const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB
export const ALLOWED_AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.m4a'] as const;
export const AUDIO_ACCEPT_ATTR = '.mp3,.ogg,.m4a,audio/mpeg,audio/ogg,audio/mp4,audio/x-m4a';

const ALLOWED_AUDIO_EXT_SET = new Set<string>(ALLOWED_AUDIO_EXTENSIONS);
const ALLOWED_AUDIO_MIME_SET = new Set<string>([
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'application/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
]);

const KNOWN_AUDIO_EXT_PATTERN = /\.(mp3|wav|wave|ogg|m4a|flac|aac|aiff|wma)$/i;
const KNOWN_IMAGE_EXT_PATTERN = /\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i;
const KNOWN_VIDEO_EXT_PATTERN = /\.(mp4|webm|mov)$/i;

export type ImageCompressionMode = 'avatar' | 'artwork';

export function getFileExtension(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  return dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
}

export function isAudioUploadFile(file: File): boolean {
  const ext = getFileExtension(file.name || '');
  const mime = (file.type || '').toLowerCase().trim();
  return mime.startsWith('audio/') || mime === 'application/ogg' || KNOWN_AUDIO_EXT_PATTERN.test(ext);
}

export function isImageUploadFile(file: File): boolean {
  const ext = getFileExtension(file.name || '');
  const mime = (file.type || '').toLowerCase().trim();
  if (mime === 'image/svg+xml' || ext === '.svg') return false;
  return mime.startsWith('image/') || KNOWN_IMAGE_EXT_PATTERN.test(ext);
}

export function isVideoUploadFile(file: File): boolean {
  const ext = getFileExtension(file.name || '');
  const mime = (file.type || '').toLowerCase().trim();
  return mime.startsWith('video/') || KNOWN_VIDEO_EXT_PATTERN.test(ext);
}

export function validateAudioUploadFile(
  file: File,
  lang: 'ru' | 'en' = 'ru'
): { valid: boolean; error?: string } {
  const ext = getFileExtension(file.name || '');
  const mime = (file.type || '').toLowerCase().trim();

  const hasValidExt = ALLOWED_AUDIO_EXT_SET.has(ext);
  const hasValidMime = !ext && ALLOWED_AUDIO_MIME_SET.has(mime);

  if (!hasValidExt && !hasValidMime) {
    return {
      valid: false,
      error:
        lang === 'ru'
          ? 'Разрешены только аудиофайлы форматов MP3, OGG и M4A (до 12 МБ).'
          : 'Only MP3, OGG, and M4A audio files (up to 12 MB) are accepted.',
    };
  }

  if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
    return {
      valid: false,
      error:
        lang === 'ru'
          ? 'Размер аудиофайла превышает лимит 12 МБ.'
          : 'Audio file exceeds the 12 MB size limit.',
    };
  }

  return { valid: true };
}

function replaceExtensionWithWebp(filename: string): string {
  const trimmed = (filename || 'image').trim();
  const dotIdx = trimmed.lastIndexOf('.');
  const base = dotIdx > 0 ? trimmed.slice(0, dotIdx) : trimmed;
  return `${base || 'image'}.webp`;
}

/**
 * Compresses and resizes an image client-side via HTML5 <canvas> to WebP (quality 0.82):
 * - 'avatar': max 400x400px
 * - 'artwork': max 1200px along the longest side
 */
export async function compressImageToWebp(
  file: File,
  options: { mode: ImageCompressionMode; quality?: number }
): Promise<File> {
  if (!isImageUploadFile(file)) {
    return file;
  }

  const maxSide = options.mode === 'avatar' ? 400 : 1200;
  const quality = options.quality ?? 0.82;
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image for compression'));
      el.src = objectUrl;
    });

    const srcWidth = img.naturalWidth || img.width;
    const srcHeight = img.naturalHeight || img.height;
    if (!srcWidth || !srcHeight) {
      return file;
    }

    const scale = Math.min(maxSide / srcWidth, maxSide / srcHeight, 1);
    const targetWidth = Math.max(1, Math.round(srcWidth * scale));
    const targetHeight = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const webpBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
    });

    if (!webpBlob || webpBlob.size === 0 || webpBlob.type !== 'image/webp') {
      return file;
    }

    return new File([webpBlob], replaceExtensionWithWebp(file.name), {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export interface UploadedMediaResult {
  url: string;
  filename: string;
  mimetype: string;
  size: number;
  is_audio?: boolean;
  is_image?: boolean;
  is_video?: boolean;
}

/**
 * Validates audio (MP3/OGG/M4A <= 12MB), compresses images to WebP via <canvas>,
 * and uploads via Supabase signed-url (with automatic /api/upload fallback).
 */
export async function prepareAndUploadMedia(
  rawFile: File,
  options: {
    imageMode: ImageCompressionMode;
    authFetch: (url: string, init?: RequestInit) => Promise<Response>;
    lang?: 'ru' | 'en';
    allowAudio?: boolean;
    allowVideo?: boolean;
    allowImage?: boolean;
  }
): Promise<UploadedMediaResult> {
  const lang = options.lang ?? 'ru';
  if (!rawFile || rawFile.size === 0) {
    throw new Error(lang === 'ru' ? 'Выбран пустой файл.' : 'Selected file is empty.');
  }

  const isAudio = isAudioUploadFile(rawFile);
  const isImage = isImageUploadFile(rawFile);
  const isVideo = isVideoUploadFile(rawFile);

  if (isAudio) {
    if (options.allowAudio === false) {
      throw new Error(
        lang === 'ru' ? 'В этом поле разрешены только изображения.' : 'Only images are allowed here.'
      );
    }
    const check = validateAudioUploadFile(rawFile, lang);
    if (!check.valid) {
      throw new Error(check.error || 'Invalid audio file.');
    }
  } else if (isImage) {
    if (options.allowImage === false) {
      throw new Error(
        lang === 'ru'
          ? 'В этом поле разрешены только аудиофайлы MP3, OGG или M4A.'
          : 'Only MP3, OGG, or M4A audio files are allowed here.'
      );
    }
  } else if (isVideo) {
    if (options.allowVideo === false) {
      throw new Error(
        lang === 'ru' ? 'Видео не поддерживается в этом поле.' : 'Video is not supported here.'
      );
    }
    if (rawFile.size > 100 * 1024 * 1024) {
      throw new Error(lang === 'ru' ? 'Файл превышает лимит 100 МБ.' : 'File exceeds 100 MB limit.');
    }
  } else {
    throw new Error(
      lang === 'ru'
        ? 'Неподдерживаемый формат файла.'
        : 'Unsupported file format.'
    );
  }

  const fileToUpload = isImage
    ? await compressImageToWebp(rawFile, { mode: options.imageMode, quality: 0.82 })
    : rawFile;

  const mimeType = fileToUpload.type || 'application/octet-stream';

  // Step 1: Try direct signed Supabase Storage upload first (bypasses Vercel 4.5MB limit)
  let uploadedToCloudStorage = false;
  try {
    const signRes = await options.authFetch('/api/upload/signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: fileToUpload.name,
        mimetype: mimeType,
        size: fileToUpload.size,
      }),
    });
    const signData = (await signRes.json().catch(() => ({}))) as {
      direct?: boolean;
      signedUrl?: string;
      storedFilename?: string;
      error?: string;
    };

    if (!signRes.ok) {
      throw new Error(
        signData.error || (lang === 'ru' ? 'Формат файла не поддерживается.' : 'File rejected.')
      );
    }

    if (signData.direct && signData.signedUrl && signData.storedFilename) {
      const putRes = await fetch(signData.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'x-upsert': 'true',
        },
        body: fileToUpload,
      });
      if (!putRes.ok) {
        throw new Error(
          lang === 'ru'
            ? `Ошибка облачного хранилища (HTTP ${putRes.status}).`
            : `Cloud storage upload failed (HTTP ${putRes.status}).`
        );
      }
      uploadedToCloudStorage = true;

      const completeRes = await options.authFetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storedFilename: signData.storedFilename,
          originalName: fileToUpload.name,
          mimetype: mimeType,
          size: fileToUpload.size,
        }),
      });
      const completeData = (await completeRes.json().catch(() => ({}))) as Partial<UploadedMediaResult> & {
        error?: string;
      };
      if (!completeRes.ok || !completeData.url) {
        throw new Error(
          completeData.error ||
            (lang === 'ru'
              ? `Файл загружен в Supabase, но не удалось зарегистрировать запись (HTTP ${completeRes.status}).`
              : `Uploaded to Supabase, but failed to register metadata (HTTP ${completeRes.status}).`)
        );
      }
      return {
        url: completeData.url,
        filename: completeData.filename || fileToUpload.name,
        mimetype: completeData.mimetype || mimeType,
        size: completeData.size ?? fileToUpload.size,
        is_audio: completeData.is_audio ?? isAudio,
        is_image: completeData.is_image ?? isImage,
        is_video: completeData.is_video ?? isVideo,
      };
    }
  } catch (directErr: any) {
    if (uploadedToCloudStorage || fileToUpload.size > 4 * 1024 * 1024) {
      throw directErr;
    }
  }

  // Fallback: standard multipart POST to /api/upload
  const fd = new FormData();
  fd.append('file', fileToUpload);
  const res = await options.authFetch('/api/upload', {
    method: 'POST',
    body: fd,
  });

  if (res.status === 413) {
    throw new Error(
      lang === 'ru'
        ? 'Файл слишком большой для прямого серверного запроса (лимит хостинга ~4.5 МБ).'
        : 'File exceeds direct serverless upload limit (~4.5 MB).'
    );
  }

  const data = (await res.json().catch(() => ({}))) as Partial<UploadedMediaResult> & { error?: string };
  if (!res.ok || !data.url) {
    throw new Error(
      data.error || (lang === 'ru' ? `Ошибка загрузки (HTTP ${res.status})` : `Upload error (HTTP ${res.status})`)
    );
  }

  return {
    url: data.url,
    filename: data.filename || fileToUpload.name,
    mimetype: data.mimetype || mimeType,
    size: data.size ?? fileToUpload.size,
    is_audio: data.is_audio ?? isAudio,
    is_image: data.is_image ?? isImage,
    is_video: data.is_video ?? isVideo,
  };
}
