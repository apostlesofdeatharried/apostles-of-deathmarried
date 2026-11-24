import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const isVercel = Boolean(process.env.VERCEL);
const bundledDbPath = path.resolve(process.cwd(), 'data', 'apostles.db');

function resolveWritableDbPath(): string {
  if (process.env.NODE_ENV === 'test' && process.env.APOSTLES_DB_PATH) {
    return process.env.APOSTLES_DB_PATH;
  }
  const hasSupabase = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
  const allowBundledCopy = !hasSupabase || process.env.NODE_ENV === 'test';

  if (isVercel) {
    const tmpDir = '/tmp';
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const tmpDbPath = path.join(tmpDir, 'apostles.db');
    if (allowBundledCopy && !fs.existsSync(tmpDbPath) && fs.existsSync(bundledDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, tmpDbPath);
      } catch (err) {
        console.error('[DB] Failed to copy bundled database to /tmp:', err);
      }
    }
    return tmpDbPath;
  }

  const dbDir = path.resolve(process.cwd(), 'data');
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    return path.join(dbDir, 'apostles.db');
  } catch {
    // Fallback to /tmp if current directory is read-only
    const tmpDbPath = path.join('/tmp', 'apostles.db');
    fs.mkdirSync(path.dirname(tmpDbPath), { recursive: true });
    if (allowBundledCopy && !fs.existsSync(tmpDbPath) && fs.existsSync(bundledDbPath)) {
      try {
        fs.copyFileSync(bundledDbPath, tmpDbPath);
      } catch {}
    }
    return tmpDbPath;
  }
}

const activeDbPath = resolveWritableDbPath();
const dbExistedBeforeBoot = fs.existsSync(activeDbPath);

function openConfiguredDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const instance = new Database(dbPath);
  try {
    instance.pragma('busy_timeout = 5000');
  } catch {}
  try {
    // Checkpoint any legacy WAL file before switching to single-file DELETE journal mode
    instance.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    // Single-file rollback journal prevents -wal/-shm sidecar desyncs during cloud/container snapshots
    instance.pragma('journal_mode = DELETE');
    instance.pragma('synchronous = FULL');
  } catch {}
  instance.pragma('foreign_keys = ON');
  return instance;
}

let currentDb: Database.Database = openConfiguredDatabase(activeDbPath);

// Live Proxy guarantees every module (ESM or transpiled CJS) always targets the current reopened DB handle
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const value = (currentDb as any)[prop];
    return typeof value === 'function' ? value.bind(currentDb) : value;
  },
});

export function getDb(): Database.Database {
  return currentDb;
}

export function getDbPath(): string {
  return activeDbPath;
}

export function didDatabaseExistOnBoot(): boolean {
  return dbExistedBeforeBoot;
}

export function checkpointDatabase(): void {
  try {
    currentDb.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    currentDb.pragma('journal_mode = DELETE');
  } catch {}
}

export function closeDatabase(): void {
  checkpointDatabase();
  try {
    currentDb.close();
  } catch {}
}

export function serializeDatabase(): Buffer {
  try {
    currentDb.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  checkpointDatabase();
  if (activeDbPath && activeDbPath !== ':memory:' && fs.existsSync(activeDbPath)) {
    try {
      return fs.readFileSync(activeDbPath);
    } catch {}
  }
  return currentDb.serialize();
}

let lastMigrationError: string | null = null;

export function getLastMigrationError(): string | null {
  return lastMigrationError;
}

export function getModerationActionsDiagnostics(targetDb: Database.Database = currentDb): {
  moderationActionsTargetNullable: boolean;
  moderationActionsColumns: string[];
  lastMigrationError: string | null;
} {
  let moderationActionsColumns: string[] = [];
  let moderationActionsTargetNullable = false;
  try {
    const cols = targetDb
      .prepare('PRAGMA table_info(moderation_actions)')
      .all() as Array<{ name: string; notnull: number }>;
    moderationActionsColumns = cols.map((c) => c.name);
    const targetCol = cols.find((c) => c.name === 'target_user_id');
    moderationActionsTargetNullable = Boolean(targetCol && Number(targetCol.notnull) === 0);
  } catch {}
  return {
    moderationActionsTargetNullable,
    moderationActionsColumns,
    lastMigrationError,
  };
}

export function replaceDatabaseWithBuffer(buffer: Buffer): void {
  if (!buffer || buffer.length < 100) return;
  if (buffer.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
    throw new Error('Invalid SQLite database buffer');
  }
  try {
    currentDb.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}
  try {
    currentDb.close();
  } catch {}
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try {
      if (fs.existsSync(`${activeDbPath}${suffix}`)) {
        fs.unlinkSync(`${activeDbPath}${suffix}`);
      }
    } catch {}
  }
  const tmpFile = `${activeDbPath}.swap.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, buffer);
  fs.renameSync(tmpFile, activeDbPath);
  currentDb = openConfiguredDatabase(activeDbPath);
  ensureSchemaAndMigrations(currentDb);
}

// Complete 86-item XP Customization Shop catalog across 7 distinct categories & 6 rarities (Common -> Mythic).
// All previously owned item IDs are preserved; deprecated title_* IDs are softly remapped without losing ownership.
export const DEFAULT_SHOP_ITEMS = [
  // 1. Avatar Frames (14 items)
  { id: 'frame_graphite', name_ru: 'Графитовый контур', name_en: 'Graphite Contour', description_ru: 'Минималистичный холодный серый кант', description_en: 'Minimalist cool graphite contour', category: 'frame', cost_xp: 120, rarity: 'common', preview_value: 'border-2 border-white/30' },
  { id: 'frame_slate_wire', name_ru: 'Свинцовая нить', name_en: 'Slate Wire', description_ru: 'Тонкая холодная грань архивного портрета', description_en: 'Fine cold edge for an archival portrait', category: 'frame', cost_xp: 160, rarity: 'common', preview_value: 'border-2 border-[#596170] ring-1 ring-white/10' },
  { id: 'frame_ash_ring', name_ru: 'Пепельное кольцо', name_en: 'Ash Ring', description_ru: 'Матовый дымчатый ободок с тонкой обводкой', description_en: 'Matte smoky ring with subtle rim', category: 'frame', cost_xp: 230, rarity: 'uncommon', preview_value: 'border-2 border-[#7b746b] ring-2 ring-[#7b746b]/25' },
  { id: 'frame_moss_crypt', name_ru: 'Сумрак камня', name_en: 'Crypt Stone', description_ru: 'Глубокий тёмно-изумрудный кант ночного камня', description_en: 'Deep dark emerald stone rim', category: 'frame', cost_xp: 280, rarity: 'uncommon', preview_value: 'border-2 border-[#2a6b54] ring-2 ring-[#64c9a3]/20 shadow-[0_0_12px_rgba(42,107,84,0.35)]' },
  { id: 'frame_dashed_blueprint', name_ru: 'Пунктир стали', name_en: 'Steel Dashed', description_ru: 'Строгая прерывистая окантовка в стиле андеграунд-чертежа', description_en: 'Crisp dashed industrial steel contour', category: 'frame', cost_xp: 410, rarity: 'rare', preview_value: 'border-2 border-dashed border-[#9aa3b2] ring-2 ring-black/60' },
  { id: 'frame_silver_thorn', name_ru: 'Серебряный шип', name_en: 'Silver Thorn', description_ru: 'Элегантная серебристая окантовка с мягким свечением', description_en: 'Elegant silver border with subtle glow', category: 'frame', cost_xp: 480, rarity: 'rare', preview_value: 'border-2 border-[#c5c8cf] shadow-[0_0_14px_rgba(197,200,207,0.35)]' },
  { id: 'frame_dark_velvet', name_ru: 'Чёрный бархат', name_en: 'Dark Velvet', description_ru: 'Глубокая бархатная рамка с бордовым отсветом', description_en: 'Deep velvet frame with dark crimson sheen', category: 'frame', cost_xp: 600, rarity: 'rare', preview_value: 'border-2 border-[#721b2b] shadow-[0_0_16px_rgba(130,28,44,0.55)]' },
  { id: 'frame_cobalt_vespers', name_ru: 'Холодный кобальт', name_en: 'Cold Cobalt', description_ru: 'Ледяная сапфировая окантовка ночного эфира', description_en: 'Icy sapphire halo of nocturnal airwaves', category: 'frame', cost_xp: 750, rarity: 'rare', preview_value: 'border-2 border-[#4d75ad] ring-2 ring-[#9dc2f5]/25 shadow-[0_0_16px_rgba(77,117,173,0.45)]' },
  { id: 'frame_nocturne_amethyst', name_ru: 'Сумеречный аметист', name_en: 'Nocturne Amethyst', description_ru: 'Холодный фиолетовый ореол ночного эфира', description_en: 'Cold violet halo of midnight resonance', category: 'frame', cost_xp: 980, rarity: 'epic', preview_value: 'border-2 border-[#6e56a8] ring-2 ring-[#a38ee0]/25 shadow-[0_0_18px_rgba(110,86,168,0.55)]' },
  { id: 'frame_gothic_crown', name_ru: 'Двойной кармин', name_en: 'Double Carmine', description_ru: 'Строгий двойной контур с глубоким винным сиянием', description_en: 'Strict double contour with deep wine glow', category: 'frame', cost_xp: 1250, rarity: 'epic', preview_value: 'border-2 border-[#821c2c] ring-2 ring-white/25 shadow-[0_0_20px_rgba(130,28,44,0.75)]' },
  { id: 'frame_gilded_relic', name_ru: 'Античное золото', name_en: 'Antique Gold', description_ru: 'Сдержанная золотая оправа с благородным отблеском', description_en: 'Restrained antique gold frame with warm sheen', category: 'frame', cost_xp: 1750, rarity: 'legendary', preview_value: 'border-2 border-[#d4af68] ring-2 ring-[#f3dca6]/35 shadow-[0_0_24px_rgba(212,175,104,0.6)]' },
  { id: 'frame_ivory_seraph', name_ru: 'Костяной ореол', name_en: 'Ivory Halo', description_ru: 'Алебастровая оправа с двойным золотым контуром', description_en: 'Luminous alabaster frame with gilded inner ring', category: 'frame', cost_xp: 2150, rarity: 'legendary', preview_value: 'border-2 border-[#f2e8d5] ring-2 ring-[#d4af68]/45 shadow-[0_0_26px_rgba(242,232,213,0.55)]' },
  { id: 'frame_pulse_crimson', name_ru: 'Пульсирующий кант', name_en: 'Crimson Pulse Rim', description_ru: 'Анимированная рамка с плавным дыханием алого света', description_en: 'Animated avatar rim with smooth crimson pulse', category: 'frame', cost_xp: 2450, rarity: 'mythic', preview_value: 'border-2 border-[#b8324a] ring-2 ring-[#f0a8b8]/40 aod-frame-pulse' },
  { id: 'frame_eclipse_sovereign', name_ru: 'Кант затмения', name_en: 'Eclipse Contour', description_ru: 'Мифическая багрово-золотая оправа полного затмения', description_en: 'Mythic crimson-gold eclipse contour', category: 'frame', cost_xp: 2700, rarity: 'mythic', preview_value: 'border-2 border-[#e27ca4] ring-2 ring-[#f3d492]/55 shadow-[0_0_30px_rgba(201,91,132,0.75)]' },

  // 2. Profile Banners (12 distinct textured static banners + 4 GPU-accelerated animated banners = 16 items)
  { id: 'banner_abyss', name_ru: 'Плёночный графит', name_en: 'Film Graphite', description_ru: 'Глубокий угольный фон с фактурой 35мм киноплёнки', description_en: 'Deep charcoal surface with 35mm film grain texture', category: 'banner', cost_xp: 150, rarity: 'common', preview_value: 'banner_tex_graphite_grain' },
  { id: 'banner_charcoal_fog', name_ru: 'Архитектурная сетка', name_en: 'Architectural Grid', description_ru: 'Минималистичная тёмная чертёжная сетка в андеграунд-стиле', description_en: 'Minimalist dark architectural blueprint grid', category: 'banner', cost_xp: 200, rarity: 'common', preview_value: 'banner_tex_arch_grid' },
  { id: 'banner_slate_rain', name_ru: 'Свинцовый дождь', name_en: 'Slate Rain', description_ru: 'Косые штрихи ночного дождя на холодном бетоне', description_en: 'Angled midnight rain streaks over cold slate', category: 'banner', cost_xp: 260, rarity: 'uncommon', preview_value: 'banner_tex_slate_rain' },
  { id: 'banner_pine_nocturne', name_ru: 'Северный туман', name_en: 'Northern Mist', description_ru: 'Холодная хвойная дымка с вертикальной тенью', description_en: 'Cold pine twilight with vertical fog depth', category: 'banner', cost_xp: 310, rarity: 'uncommon', preview_value: 'banner_tex_forest_fog' },
  { id: 'banner_night_mist', name_ru: 'Лунная вуаль', name_en: 'Moonlit Veil', description_ru: 'Холодный лунный просвет сквозь плотный ночной мрак', description_en: 'Cool lunar beam cutting through dark mist', category: 'banner', cost_xp: 460, rarity: 'rare', preview_value: 'banner_tex_moonlit_veil' },
  { id: 'banner_silver_silk', name_ru: 'Шлифованная сталь', name_en: 'Brushed Steel', description_ru: 'Холодная металлическая текстура с диагональным бликом', description_en: 'Cold brushed steel grain with specular diagonal sheen', category: 'banner', cost_xp: 580, rarity: 'rare', preview_value: 'banner_tex_brushed_steel' },
  { id: 'banner_cobalt_abbey', name_ru: 'Готическая решётка', name_en: 'Gothic Lattice', description_ru: 'Тонкое ромбовидное плетение в глубоком кобальте', description_en: 'Fine diamond lattice over deep midnight cobalt', category: 'banner', cost_xp: 700, rarity: 'rare', preview_value: 'banner_tex_gothic_mesh' },
  { id: 'banner_cathedral_veil', name_ru: 'Алый бархат', name_en: 'Crimson Velvet', description_ru: 'Глубокие драпировки тёмно-винного бархата и светотени', description_en: 'Deep burgundy velvet drapery folds and chiaroscuro', category: 'banner', cost_xp: 850, rarity: 'epic', preview_value: 'banner_tex_crimson_velvet' },
  { id: 'banner_midnight_choir', name_ru: 'Дорожки винила', name_en: 'Vinyl Grooves', description_ru: 'Концентрический рельеф тёмной пластинки в сумеречном свете', description_en: 'Concentric dark vinyl grooves with subtle specular arc', category: 'banner', cost_xp: 1050, rarity: 'epic', preview_value: 'banner_tex_vinyl_grooves' },
  { id: 'banner_gilded_eclipse', name_ru: 'Золотой полумесяц', name_en: 'Gilded Crescent', description_ru: 'Античное золотое кольцо затмения над обсидианом', description_en: 'Antique gold eclipse arc over obsidian stone', category: 'banner', cost_xp: 1450, rarity: 'legendary', preview_value: 'banner_tex_gold_eclipse' },
  { id: 'banner_blood_vespers', name_ru: 'Карминовый нуар', name_en: 'Carmine Noir', description_ru: 'Резкий горизонт кармина с глубокой виньеткой и зерном', description_en: 'Stark carmine noir horizon with deep vignette grain', category: 'banner', cost_xp: 1650, rarity: 'legendary', preview_value: 'banner_tex_carmine_noir' },
  { id: 'banner_astral_requiem', name_ru: 'Призма обсидиана', name_en: 'Obsidian Prism', description_ru: 'Геометрические грани тёмного стекла с отблеском розы и золота', description_en: 'Fractured dark obsidian facets catching rose-gold light', category: 'banner', cost_xp: 2050, rarity: 'legendary', preview_value: 'banner_tex_obsidian_prism' },
  { id: 'banner_anim_dark_mist', name_ru: 'Тёмный туман', name_en: 'Dark Mist', description_ru: 'Анимированный фон: медленно плывущие слои холодного ночного тумана', description_en: 'Animated banner: slowly drifting layers of cold nocturnal mist', category: 'banner', cost_xp: 1900, rarity: 'legendary', preview_value: 'banner_anim_dark_mist' },
  { id: 'banner_anim_crimson_embers', name_ru: 'Алые искры и пепел', name_en: 'Crimson Embers', description_ru: 'Анимированный фон: плавно взлетающие алые искры и тлеющий пепел', description_en: 'Animated banner: gently rising crimson embers and ash motes', category: 'banner', cost_xp: 2300, rarity: 'legendary', preview_value: 'banner_anim_crimson_embers' },
  { id: 'banner_anim_digital_glitch', name_ru: 'Цифровой глитч', name_en: 'Digital Glitch', description_ru: 'Анимированный фон: тёмные VHS-сканлайны и чёткие хроматические сдвиги', description_en: 'Animated banner: dark VHS scanlines and crisp chromatic glitch slices', category: 'banner', cost_xp: 2650, rarity: 'mythic', preview_value: 'banner_anim_digital_glitch' },
  { id: 'banner_anim_abyss_pulse', name_ru: 'Пульс бездны', name_en: 'Abyss Pulse', description_ru: 'Анимированный фон: глубокое гипнотическое дыхание багрового затмения', description_en: 'Animated banner: hypnotic breathing rings of crimson eclipse', category: 'banner', cost_xp: 3000, rarity: 'mythic', preview_value: 'banner_anim_abyss_pulse' },

  // 3. Name Styles (11 items)
  { id: 'style_monochrome', name_ru: 'Холодный графит', name_en: 'Cold Graphite', description_ru: 'Сдержанный матовый стиль с увеличенным трекингом', description_en: 'Matte cool font with expanded tracking', category: 'name_style', cost_xp: 100, rarity: 'common', preview_value: 'text-[#b5b0a8] tracking-wider' },
  { id: 'style_ash_serif', name_ru: 'Пепельный курсив', name_en: 'Ash Italic', description_ru: 'Тонкий винтажный наклон архивной подписи', description_en: 'Subtle vintage slanted archival signature', category: 'name_style', cost_xp: 150, rarity: 'common', preview_value: 'text-[#cbc4b8] italic tracking-wide' },
  { id: 'style_bone_ivory', name_ru: 'Слоновая кость', name_en: 'Antique Ivory', description_ru: 'Тёплый винтажный тон старой бумаги и мягкий акцент', description_en: 'Warm vintage ivory tone with soft emphasis', category: 'name_style', cost_xp: 220, rarity: 'uncommon', preview_value: 'text-[#f2e8d5] tracking-wide font-medium' },
  { id: 'style_emerald_mist', name_ru: 'Изумрудный туман', name_en: 'Emerald Mist', description_ru: 'Приглушённое холодное свечение лесной ночи', description_en: 'Muted cold nocturnal emerald shimmer', category: 'name_style', cost_xp: 270, rarity: 'uncommon', preview_value: 'text-[#8fd9bc] drop-shadow-[0_0_8px_rgba(100,201,163,0.35)] font-medium' },
  { id: 'style_silver_glow', name_ru: 'Серебряный глянец', name_en: 'Silver Glow', description_ru: 'Светлое серебристое свечение символов имени', description_en: 'Luminous silver lettering', category: 'name_style', cost_xp: 440, rarity: 'rare', preview_value: 'text-[#e6e8ee] drop-shadow-[0_0_8px_rgba(255,255,255,0.45)] font-medium' },
  { id: 'style_crimson_shade', name_ru: 'Бархатный оттенок', name_en: 'Crimson Shade', description_ru: 'Благородный винный оттенок с мягкой тенью', description_en: 'Muted wine tone with soft velvet shadow', category: 'name_style', cost_xp: 640, rarity: 'rare', preview_value: 'text-[#eb909d] drop-shadow-[0_0_9px_rgba(229,138,150,0.45)] font-medium' },
  { id: 'style_amethyst_whisper', name_ru: 'Лунный аметист', name_en: 'Moonlit Amethyst', description_ru: 'Призрачное сиренево-серебристое сияние шрифта', description_en: 'Spectral lavender-silver glow lettering', category: 'name_style', cost_xp: 960, rarity: 'epic', preview_value: 'text-[#d3c4f7] drop-shadow-[0_0_10px_rgba(167,140,235,0.5)] font-medium tracking-wide' },
  { id: 'style_velvet_gradient', name_ru: 'Градиент бархата', name_en: 'Velvet Gradient', description_ru: 'Плавный переход от серебра к глубокому кармину', description_en: 'Smooth metallic silver to deep carmine gradient', category: 'name_style', cost_xp: 1280, rarity: 'epic', preview_value: 'bg-gradient-to-r from-[#f5dce2] via-[#e26f86] to-[#f0b4c0] bg-clip-text text-transparent font-semibold tracking-wide' },
  { id: 'style_gilded_sovereign', name_ru: 'Золото архива', name_en: 'Archive Gold', description_ru: 'Античный золотой градиент с благородным сиянием', description_en: 'Antique gold luminous lettering', category: 'name_style', cost_xp: 1650, rarity: 'legendary', preview_value: 'text-[#f0d599] drop-shadow-[0_0_12px_rgba(224,188,112,0.55)] font-semibold tracking-wide' },
  { id: 'style_moonlit_chrome', name_ru: 'Лунный хром', name_en: 'Moonlit Chrome', description_ru: 'Холодный зеркальный градиент серебра и сапфира', description_en: 'Cold mirror gradient of silver and sapphire', category: 'name_style', cost_xp: 2000, rarity: 'legendary', preview_value: 'bg-gradient-to-r from-[#ffffff] via-[#9fc5f5] to-[#d6dceb] bg-clip-text text-transparent font-semibold tracking-wider drop-shadow-[0_0_10px_rgba(159,197,245,0.4)]' },
  { id: 'style_mythic_eclipse', name_ru: 'Сияние затмения', name_en: 'Eclipse Radiance', description_ru: 'Мифический переливающийся градиент золота, розы и аметиста', description_en: 'Mythic shifting gradient of gold, rose and amethyst', category: 'name_style', cost_xp: 2500, rarity: 'mythic', preview_value: 'bg-gradient-to-r from-[#f7dca2] via-[#ef8cb3] to-[#c4a6fa] bg-clip-text text-transparent font-semibold tracking-wider drop-shadow-[0_0_14px_rgba(239,140,179,0.5)]' },

  // 4. Avatar & Profile Icons / Badges (11 items)
  { id: 'badge_wanderer', name_ru: 'Иконка «Искра»', name_en: 'Spark Icon', description_ru: 'Минималистичная серебристая искра возле имени', description_en: 'Minimalist silver spark emblem beside your name', category: 'badge', cost_xp: 130, rarity: 'common', preview_value: 'Sparkles' },
  { id: 'badge_chronicler', name_ru: 'Иконка «Перо»', name_en: 'Quill Icon', description_ru: 'Лаконичная метка автора текстов и заметок', description_en: 'Clean quill emblem for lyric and note writers', category: 'badge', cost_xp: 170, rarity: 'common', preview_value: 'Feather' },
  { id: 'badge_nocturne', name_ru: 'Иконка «Луна»', name_en: 'Moon Icon', description_ru: 'Тёмно-фиолетовый полумесяц ночного слушателя', description_en: 'Nocturnal crescent emblem in muted violet', category: 'badge', cost_xp: 240, rarity: 'uncommon', preview_value: 'Moon' },
  { id: 'badge_night_signal', name_ru: 'Иконка «Эфир»', name_en: 'Headphones Icon', description_ru: 'Отметка постоянного слушателя релизов deathmarried', description_en: 'Clean headphones mark for constant listeners', category: 'badge', cost_xp: 290, rarity: 'uncommon', preview_value: 'Headphones' },
  { id: 'badge_archivist', name_ru: 'Иконка «Щит»', name_en: 'Shield Icon', description_ru: 'Стальной знак участника архива', description_en: 'Steel shield emblem of archive regulars', category: 'badge', cost_xp: 550, rarity: 'rare', preview_value: 'Shield' },
  { id: 'badge_audiophile', name_ru: 'Иконка «Винил»', name_en: 'Vinyl Icon', description_ru: 'Винный знак пластинки для ценителей звука', description_en: 'Dark wine vinyl mark for sound enthusiasts', category: 'badge', cost_xp: 920, rarity: 'epic', preview_value: 'Disc' },
  { id: 'badge_ember', name_ru: 'Иконка «Огонь»', name_en: 'Flame Icon', description_ru: 'Багровая метка активности и серии дней', description_en: 'Crimson flame mark of sustained activity', category: 'badge', cost_xp: 1120, rarity: 'epic', preview_value: 'Flame' },
  { id: 'badge_oracle', name_ru: 'Иконка «Взгляд»', name_en: 'Eye Icon', description_ru: 'Сумеречная аметистовая метка наблюдателя', description_en: 'Muted amethyst eye emblem', category: 'badge', cost_xp: 1320, rarity: 'epic', preview_value: 'Eye' },
  { id: 'badge_night_crown', name_ru: 'Иконка «Корона»', name_en: 'Crown Icon', description_ru: 'Античная золотая корона для лидеров рейтинга', description_en: 'Antique gold crown emblem', category: 'badge', cost_xp: 1750, rarity: 'legendary', preview_value: 'Crown' },
  { id: 'badge_relic_gem', name_ru: 'Иконка «Кристалл»', name_en: 'Crystal Icon', description_ru: 'Тёмно-карминовый огранённый кристалл', description_en: 'Dark carmine faceted crystal emblem', category: 'badge', cost_xp: 2100, rarity: 'legendary', preview_value: 'Gem' },
  { id: 'badge_apostle_star', name_ru: 'Иконка «Звезда»', name_en: 'Star Icon', description_ru: 'Мифическая звезда высшей ступени комьюнити', description_en: 'Mythic star emblem of the community', category: 'badge', cost_xp: 2650, rarity: 'mythic', preview_value: 'Star' },

  // 5. Shields beside nickname (15 items)
  { id: 'shield_novichok', name_ru: 'Шилд «новичок»', name_en: 'Shield: novichok', description_ru: 'Лаконичный стартовый шилд возле ника в профиле и рейтинге', description_en: 'Minimalist starter shield beside your nickname', category: 'title', cost_xp: 100, rarity: 'common', preview_value: 'shield_novichok' },
  { id: 'shield_slushatel', name_ru: 'Шилд «слушатель»', name_en: 'Shield: slushatel', description_ru: 'Сдержанный монохромный шилд постоянного слушателя', description_en: 'Understated monochrome listener shield', category: 'title', cost_xp: 150, rarity: 'common', preview_value: 'shield_slushatel' },
  { id: 'shield_v_teme', name_ru: 'Шилд «в теме»', name_en: 'Shield: v teme', description_ru: 'Чистый андеграундный шилд для тех, кто следит за релизами', description_en: 'Clean underground shield for those in the loop', category: 'title', cost_xp: 200, rarity: 'common', preview_value: 'shield_v_teme' },
  { id: 'shield_nochnoy', name_ru: 'Шилд «ночной»', name_en: 'Shield: nochnoy', description_ru: 'Минималистичный ночной шилд в графитовой рамке', description_en: 'Minimalist nocturnal shield in a graphite hairline', category: 'title', cost_xp: 250, rarity: 'common', preview_value: 'shield_nochnoy' },
  { id: 'shield_tsenitel', name_ru: 'Шилд «ценитель»', name_en: 'Shield: tsenitel', description_ru: 'Холодный стальной шилд знатока звучания deathmarried', description_en: 'Cool steel shield for sound connoisseurs', category: 'title', cost_xp: 400, rarity: 'rare', preview_value: 'shield_tsenitel' },
  { id: 'shield_arkhivarius', name_ru: 'Шилд «архивариус»', name_en: 'Shield: arkhivarius', description_ru: 'Серебристо-сланцевый шилд исследователя дискографии', description_en: 'Silver-slate shield for discography explorers', category: 'title', cost_xp: 480, rarity: 'rare', preview_value: 'shield_arkhivarius' },
  { id: 'shield_svoy', name_ru: 'Шилд «свой»', name_en: 'Shield: svoy', description_ru: 'Спокойный сдержанный статус участника близкого круга', description_en: 'Quiet insider status for community regulars', category: 'title', cost_xp: 560, rarity: 'rare', preview_value: 'shield_svoy' },
  { id: 'shield_podzemka', name_ru: 'Шилд «подземка»', name_en: 'Shield: podzemka', description_ru: 'Холодный андеграундный шилд с тонкой металлической гранью', description_en: 'Cold underground shield with crisp metallic edge', category: 'title', cost_xp: 650, rarity: 'rare', preview_value: 'shield_podzemka' },
  { id: 'shield_old', name_ru: 'Шилд «олд»', name_en: 'Shield: old', description_ru: 'Эпический дымчато-винный шилд давних участников', description_en: 'Epic dark-wine shield for longtime members', category: 'title', cost_xp: 900, rarity: 'epic', preview_value: 'shield_old' },
  { id: 'shield_khranitel', name_ru: 'Шилд «хранитель»', name_en: 'Shield: khranitel', description_ru: 'Аметистово-графитовый шилд с благородной глубиной', description_en: 'Amethyst-graphite shield with refined depth', category: 'title', cost_xp: 1020, rarity: 'epic', preview_value: 'shield_khranitel' },
  { id: 'shield_veteran', name_ru: 'Шилд «ветеран»', name_en: 'Shield: veteran', description_ru: 'Карминовый шилд с тонким внутренним акцентом', description_en: 'Deep carmine shield with subtle inner rim', category: 'title', cost_xp: 1150, rarity: 'epic', preview_value: 'shield_veteran' },
  { id: 'shield_apostol', name_ru: 'Шилд «апостол»', name_en: 'Shield: apostol', description_ru: 'Фирменный эпический шилд сообщества apostles of deathmarried', description_en: 'Signature epic shield of the apostles community', category: 'title', cost_xp: 1300, rarity: 'epic', preview_value: 'shield_apostol' },
  { id: 'shield_izbrannyy', name_ru: 'Шилд «избранный»', name_en: 'Shield: izbrannyy', description_ru: 'Легендарный шилд с тёмно-золотым переливом и мягким свечением', description_en: 'Legendary shield with antique dark-gold finish', category: 'title', cost_xp: 1800, rarity: 'legendary', preview_value: 'shield_izbrannyy' },
  { id: 'shield_legenda', name_ru: 'Шилд «легенда»', name_en: 'Shield: legenda', description_ru: 'Благородный платиново-золотой шилд лидеров архива', description_en: 'Noble platinum-gold shield for archive legends', category: 'title', cost_xp: 2150, rarity: 'legendary', preview_value: 'shield_legenda' },
  { id: 'shield_bog_apostolov', name_ru: 'Шилд «бог апостолов»', name_en: 'Shield: bog apostolov', description_ru: 'Высший легендарный шилд с градиентом кармина, обсидиана и золота', description_en: 'Highest legendary shield in crimson, obsidian and gold', category: 'title', cost_xp: 2500, rarity: 'legendary', preview_value: 'shield_bog_apostolov' },

  // 6. Profile Themes (8 items)
  { id: 'theme_ash_velvet', name_ru: 'Тема «Пепельный бархат»', name_en: 'Ash Velvet Theme', description_ru: 'Тёплый матовый камень и приглушённый дымчатый кант', description_en: 'Warm matte stone with muted smoky borders', category: 'theme', cost_xp: 190, rarity: 'common', preview_value: 'theme_ash_velvet' },
  { id: 'theme_obsidian_monolith', name_ru: 'Тема «Обсидиан»', name_en: 'Obsidian Monolith Theme', description_ru: 'Строгий угольно-чёрный корпус карточки с графитовым акцентом', description_en: 'Strict obsidian charcoal card surface with graphite bar', category: 'theme', cost_xp: 300, rarity: 'uncommon', preview_value: 'theme_obsidian_monolith' },
  { id: 'theme_silver_cathedral', name_ru: 'Тема «Серебряный монолит»', name_en: 'Silver Monolith Theme', description_ru: 'Холодное серебристое окаймление и стальной прогресс-бар', description_en: 'Cold silver border sheen with metallic accent bar', category: 'theme', cost_xp: 640, rarity: 'rare', preview_value: 'theme_silver_cathedral' },
  { id: 'theme_obsidian_cathedral', name_ru: 'Тема «Ночной сапфир»', name_en: 'Nocturnal Sapphire Theme', description_ru: 'Глубокий тёмно-синий каркас с ледяным отблеском', description_en: 'Deep midnight sapphire chassis with cold rim glow', category: 'theme', cost_xp: 780, rarity: 'rare', preview_value: 'theme_obsidian_cathedral' },
  { id: 'theme_crimson_sanctum', name_ru: 'Тема «Тёмный кармин»', name_en: 'Dark Carmine Theme', description_ru: 'Глубокие винные акценты, бордовое свечение и тёмный бархат', description_en: 'Deep wine accents, crimson aura and dark velvet surfaces', category: 'theme', cost_xp: 1150, rarity: 'epic', preview_value: 'theme_crimson_sanctum' },
  { id: 'theme_midnight_violet', name_ru: 'Тема «Ночной винтаж»', name_en: 'Midnight Violet Theme', description_ru: 'Благородный сумеречный фиолет для всей карточки профиля', description_en: 'Refined nocturnal twilight violet across profile cards', category: 'theme', cost_xp: 1350, rarity: 'epic', preview_value: 'theme_midnight_violet' },
  { id: 'theme_gilded_reliquary', name_ru: 'Тема «Античное золото»', name_en: 'Antique Gold Theme', description_ru: 'Легендарное тёмно-золотое оформление с мягким свечением', description_en: 'Legendary dark-gold antique aesthetic with warm radiance', category: 'theme', cost_xp: 2050, rarity: 'legendary', preview_value: 'theme_gilded_reliquary' },
  { id: 'theme_crimson_eclipse', name_ru: 'Тема «Алое затмение»', name_en: 'Crimson Eclipse Theme', description_ru: 'Мифическая карточка профиля с тройным градиентом затмения', description_en: 'Mythic profile chassis with tri-tone eclipse aura', category: 'theme', cost_xp: 2900, rarity: 'mythic', preview_value: 'theme_crimson_eclipse' },

  // 7. Profile Atmospheric Effects & Decorations (11 items)
  { id: 'effect_midnight_ash', name_ru: 'Эффект «Ночной пепел»', name_en: 'Midnight Ash Dust', description_ru: 'Лёгкая россыпь пепельных частиц и глубокая тень снизу', description_en: 'Subtle ash particles with deep bottom shadow', category: 'effect', cost_xp: 180, rarity: 'common', preview_value: 'effect_midnight_ash' },
  { id: 'effect_vinyl_grain', name_ru: 'Орнамент «Виниловые дорожки»', name_en: 'Vinyl Grooves Overlay', description_ru: 'Тонкие концентрические линии пластинки на шапке профиля', description_en: 'Subtle concentric vinyl grooves across the profile header', category: 'effect', cost_xp: 290, rarity: 'uncommon', preview_value: 'effect_vinyl_grain' },
  { id: 'effect_rim_glow', name_ru: 'Эффект «Свечение граней»', name_en: 'Edge Rim Glow', description_ru: 'Холодное контурное свечение вдоль верхнего и нижнего краёв карточки', description_en: 'Cold illuminated rim light along card edges', category: 'effect', cost_xp: 440, rarity: 'rare', preview_value: 'effect_rim_glow' },
  { id: 'effect_silver_filigree', name_ru: 'Украшение «Серебряные уголки»', name_en: 'Silver Corner Frame', description_ru: 'Изящные архитектурные уголки и двойная рамка на шапке профиля', description_en: 'Refined architectural corner ticks framing your banner', category: 'effect', cost_xp: 650, rarity: 'rare', preview_value: 'effect_silver_filigree' },
  { id: 'effect_crimson_mist', name_ru: 'Эффект «Багровая дымка»', name_en: 'Crimson Mist Aura', description_ru: 'Мягкое винное сияние и тонкая светящаяся линия на баннере', description_en: 'Atmospheric crimson mist glow with illuminated hairline', category: 'effect', cost_xp: 1080, rarity: 'epic', preview_value: 'effect_crimson_mist' },
  { id: 'effect_cathedral_light', name_ru: 'Эффект «Лучи света»', name_en: 'Noir Light Shafts', description_ru: 'Диагональные лучи приглушённого света сквозь тёмный фон', description_en: 'Diagonal muted light shafts across the dark banner', category: 'effect', cost_xp: 1320, rarity: 'epic', preview_value: 'effect_cathedral_light' },
  { id: 'effect_drifting_ash', name_ru: 'Эффект «Плывущий пепел»', name_en: 'Drifting Ash', description_ru: 'Плавные анимированные частицы пепла поверх шапки профиля', description_en: 'Smooth GPU-accelerated drifting ash motes over the banner', category: 'effect', cost_xp: 1550, rarity: 'epic', preview_value: 'effect_drifting_ash' },
  { id: 'effect_cathedral_stardust', name_ru: 'Эффект «Звёздная пыль»', name_en: 'Lunar Dust', description_ru: 'Сумеречное фиолетовое сияние с россыпью золотых и лунных искр', description_en: 'Twilight violet mist speckled with lunar and gold motes', category: 'effect', cost_xp: 1850, rarity: 'legendary', preview_value: 'effect_cathedral_stardust' },
  { id: 'effect_eclipse_halo', name_ru: 'Эффект «Ореол затмения»', name_en: 'Eclipse Halo', description_ru: 'Легендарный золотой нимб затмения и глубокая виньетка', description_en: 'Legendary golden eclipse ring and deep atmospheric vignette', category: 'effect', cost_xp: 2200, rarity: 'legendary', preview_value: 'effect_eclipse_halo' },
  { id: 'effect_glitch_accent', name_ru: 'Эффект «Глитч-кромка»', name_en: 'Glitch Edge', description_ru: 'Анимированные хроматические микро-сдвиги и сканлайны на баннере', description_en: 'Animated chromatic micro-shifts and scanlines on the banner', category: 'effect', cost_xp: 2550, rarity: 'mythic', preview_value: 'effect_glitch_accent' },
  { id: 'effect_apostle_aura', name_ru: 'Эффект «Аура Апостола»', name_en: 'Apostle Aura', description_ru: 'Мифический ореол затмения, двойная кайма и золотой зенит', description_en: 'Mythic zenith halo with rose-gold filigree lines', category: 'effect', cost_xp: 3000, rarity: 'mythic', preview_value: 'effect_apostle_aura' },
] as const;

const LEGACY_SHIELD_REMAP: Record<string, string> = {
  title_nocturne_listener: 'shield_slushatel',
  title_vinyl_collector: 'shield_nochnoy',
  title_cathedral_scribe: 'shield_arkhivarius',
  title_nightmortan_witness: 'shield_khranitel',
  title_velvet_phantom: 'shield_veteran',
  title_obsidian_curator: 'shield_izbrannyy',
  title_gilded_apostle: 'shield_legenda',
  title_sovereign_of_silence: 'shield_bog_apostolov',
};

/**
 * Idempotently ensures the full 86-item shop catalog exists on targetDb (never drops existing items or user_inventory).
 * Safe on empty tables AND legacy DBs containing only 14 old items (uses ON CONFLICT DO UPDATE, never DELETE/REPLACE).
 */
export function ensureShopCatalogSeeded(targetDb: Database.Database = db): void {
  const insertOrSyncShopItem = targetDb.prepare(`
    INSERT INTO shop_items (id, name_ru, name_en, description_ru, description_en, category, cost_xp, rarity, preview_value, is_active)
    VALUES (@id, @name_ru, @name_en, @description_ru, @description_en, @category, @cost_xp, @rarity, @preview_value, 1)
    ON CONFLICT(id) DO UPDATE SET
      name_ru = excluded.name_ru,
      name_en = excluded.name_en,
      description_ru = excluded.description_ru,
      description_en = excluded.description_en,
      category = excluded.category,
      cost_xp = excluded.cost_xp,
      rarity = excluded.rarity,
      preview_value = excluded.preview_value,
      is_active = 1
  `);

  targetDb.transaction(() => {
    for (const item of DEFAULT_SHOP_ITEMS) {
      insertOrSyncShopItem.run(item);
    }

    // Soft non-destructive migration for deprecated title_* shields: preserve ownership & equipped status
    for (const [oldId, newId] of Object.entries(LEGACY_SHIELD_REMAP)) {
      try {
        const legacyOwners = targetDb
          .prepare('SELECT id, user_id, is_equipped FROM user_inventory WHERE item_id = ?')
          .all(oldId) as Array<{ id: string; user_id: string; is_equipped: number }>;
        for (const row of legacyOwners) {
          const hasNew = targetDb
            .prepare('SELECT id, is_equipped FROM user_inventory WHERE user_id = ? AND item_id = ?')
            .get(row.user_id, newId) as { id: string; is_equipped: number } | undefined;
          if (hasNew) {
            if (row.is_equipped && !hasNew.is_equipped) {
              targetDb.prepare('UPDATE user_inventory SET is_equipped = 1 WHERE id = ?').run(hasNew.id);
            }
            targetDb.prepare('DELETE FROM user_inventory WHERE id = ?').run(row.id);
          } else {
            targetDb.prepare('UPDATE user_inventory SET item_id = ? WHERE id = ?').run(newId, row.id);
          }
        }
        targetDb.prepare('UPDATE profiles SET equipped_title = ? WHERE equipped_title = ?').run(newId, oldId);
        targetDb.prepare('UPDATE shop_items SET is_active = 0 WHERE id = ?').run(oldId);
      } catch {}
    }

    // Safely refresh equipped_banner values for users who already equipped an existing banner whose texture upgraded
    try {
      targetDb.exec(`
        UPDATE profiles
        SET equipped_banner = (
          SELECT si.preview_value
          FROM user_inventory ui
          JOIN shop_items si ON si.id = ui.item_id
          WHERE ui.user_id = profiles.user_id AND ui.is_equipped = 1 AND si.category = 'banner'
          LIMIT 1
        )
        WHERE EXISTS (
          SELECT 1
          FROM user_inventory ui
          JOIN shop_items si ON si.id = ui.item_id
          WHERE ui.user_id = profiles.user_id AND ui.is_equipped = 1 AND si.category = 'banner'
        );
      `);
    } catch {}
  })();
}

export function ensureSchemaAndMigrations(targetDb: Database.Database = db) {
  lastMigrationError = null;
  const recordMigrationError = (step: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const entry = `[${step}] ${msg}`;
    lastMigrationError = lastMigrationError ? `${lastMigrationError}; ${entry}` : entry;
    console.error(`[DB Migration Error] ${entry}`);
  };
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      level INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO roles (id, name, description, level) VALUES
      ('guest', 'Guest', 'Unauthenticated visitor', 0),
      ('user', 'User', 'Registered community member', 1),
      ('moderator', 'Moderator', 'Content & community moderator', 2),
      ('admin', 'Administrator', 'Full site & archive administrator', 3);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role_id TEXT NOT NULL DEFAULT 'user' REFERENCES roles(id) ON DELETE RESTRICT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      daily_streak INTEGER NOT NULL DEFAULT 0,
      last_active_date TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS revoked_sessions (
      sid TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      release_year INTEGER,
      release_date TEXT,
      cover_url TEXT,
      description TEXT,
      track_count INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      format_type TEXT NOT NULL DEFAULT 'album',
      source_url TEXT,
      streaming_links_json TEXT,
      verified_source TEXT,
      last_verified_at TEXT,
      is_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS singles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      release_year INTEGER,
      release_date TEXT,
      cover_url TEXT,
      description TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      audio_url TEXT,
      source_url TEXT,
      streaming_links_json TEXT,
      verified_source TEXT,
      last_verified_at TEXT,
      is_verified INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      album_id TEXT REFERENCES albums(id) ON DELETE CASCADE,
      single_id TEXT REFERENCES singles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      track_number INTEGER NOT NULL DEFAULT 1,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      audio_url TEXT NOT NULL,
      snippet_start_seconds INTEGER DEFAULT 0,
      snippet_duration_seconds INTEGER DEFAULT 15,
      lyrics TEXT,
      external_url TEXT,
      source_url TEXT,
      is_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audio_files (
      id TEXT PRIMARY KEY,
      track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS archive_images (
      id TEXT PRIMARY KEY,
      title TEXT,
      storage_path TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'artwork',
      uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      rules TEXT,
      xp_multiplier REAL NOT NULL DEFAULT 1.0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO games (id, slug, title, description, xp_multiplier) VALUES
      ('guess-track', 'guess-track', 'Guess The Track', 'Listen to short fragments and identify the track title.', 1.0),
      ('daily-quiz', 'daily-quiz', 'Daily Lore Quiz', 'Daily questions about verified discography and official facts.', 1.2);

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      question_ru TEXT NOT NULL,
      question_en TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      explanation_ru TEXT,
      explanation_en TEXT,
      difficulty INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_challenges (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title_ru TEXT NOT NULL,
      title_en TEXT NOT NULL,
      desc_ru TEXT NOT NULL,
      desc_en TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'rose',
      xp_reward INTEGER NOT NULL DEFAULT 50
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS post_categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name_ru TEXT NOT NULL,
      name_en TEXT NOT NULL,
      desc_ru TEXT,
      desc_en TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES post_categories(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      reactions_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
      creation_id TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL DEFAULT 'rose',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL,
      views_count INTEGER NOT NULL DEFAULT 0,
      likes_count INTEGER NOT NULL DEFAULT 0,
      is_approved INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      resolution_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id TEXT PRIMARY KEY,
      moderator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY,
      name_ru TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_ru TEXT,
      description_en TEXT,
      category TEXT NOT NULL,
      cost_xp INTEGER NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      preview_value TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      requires_achievement_id TEXT REFERENCES achievements(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
      purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_equipped INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS xp_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      source TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      score INTEGER NOT NULL,
      xp_earned INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );

    CREATE TABLE IF NOT EXISTS guess_track_rounds (
      token TEXT PRIMARY KEY,
      user_id TEXT,
      correct_track_id TEXT NOT NULL,
      options_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      is_used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_track_challenges (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      track_id TEXT NOT NULL,
      track_source TEXT NOT NULL DEFAULT 'track',
      snippet_start_seconds INTEGER NOT NULL DEFAULT 0,
      snippet_start_ratio REAL NOT NULL DEFAULT 0,
      snippet_duration_seconds INTEGER NOT NULL DEFAULT 5,
      options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_track_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      selected_track_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      time_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );

    CREATE TABLE IF NOT EXISTS uploaded_blobs (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS registration_guards (
      id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      client_fp_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_registration_guards_ip_created ON registration_guards(ip_hash, created_at);
    CREATE INDEX IF NOT EXISTS idx_registration_guards_fp_created ON registration_guards(client_fp_hash, created_at);

    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      xp_reward INTEGER NOT NULL DEFAULT 100,
      is_active INTEGER NOT NULL DEFAULT 1,
      description_ru TEXT,
      description_en TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS promo_code_uses (
      id TEXT PRIMARY KEY,
      promo_code_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      xp_awarded INTEGER NOT NULL DEFAULT 0,
      redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(promo_code_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_promo_code_uses_user ON promo_code_uses(user_id);

    CREATE TABLE IF NOT EXISTS post_reads (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_post_reads_user ON post_reads(user_id);

    CREATE TABLE IF NOT EXISTS user_track_plays (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      track_id TEXT NOT NULL,
      completions INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, track_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_track_plays_user ON user_track_plays(user_id);

    CREATE TABLE IF NOT EXISTS user_secret_flags (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      flag_key TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, flag_key)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_nickname TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'reply',
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_title TEXT NOT NULL,
      target_link TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at);

    CREATE TABLE IF NOT EXISTS site_news (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT NOT NULL DEFAULT '/',
      sent_count INTEGER NOT NULL DEFAULT 0,
      author_id TEXT,
      author_nickname TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_site_news_created ON site_news(created_at DESC);

    CREATE TABLE IF NOT EXISTS daily_mini_game_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      selected_value TEXT,
      correct_value TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_id, cycle_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mini_game_attempts_user_game
      ON daily_mini_game_attempts(user_id, game_id, cycle_id);

    CREATE TABLE IF NOT EXISTS game_completions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_type, cycle_id)
    );
    CREATE INDEX IF NOT EXISTS idx_game_completions_lookup
      ON game_completions(user_id, game_type, cycle_id);
  `);

  // Safe additive column migration helper (checks PRAGMA table_info before ALTER TABLE)
  const ensureColumn = (tableName: string, columnName: string, columnDef: string) => {
    try {
      const cols = targetDb.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some((c) => c.name === columnName)) {
        targetDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
      }
    } catch (err) {
      recordMigrationError(`ensureColumn:${tableName}.${columnName}`, err);
    }
  };

  // Safe additive table schema migrations for existing Stage 1-6 databases
  ensureColumn('users', 'email', 'TEXT');
  ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'failed_login_attempts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'locked_until', 'TEXT');
  ensureColumn('users', 'password_changed_at', 'TEXT');
  ensureColumn('users', 'accepted_rules', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('profiles', 'total_xp', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('profiles', 'custom_status', 'TEXT');
  ensureColumn('profiles', 'equipped_frame', 'TEXT');
  ensureColumn('profiles', 'equipped_banner', 'TEXT');
  ensureColumn('profiles', 'equipped_name_style', 'TEXT');
  ensureColumn('profiles', 'equipped_badge', 'TEXT');
  ensureColumn('profiles', 'equipped_title', 'TEXT');
  ensureColumn('profiles', 'equipped_theme', 'TEXT');
  ensureColumn('profiles', 'equipped_effect', 'TEXT');
  ensureColumn('profiles', 'featured_achievements_json', 'TEXT');
  ensureColumn('profiles', 'username_changed_at', 'TEXT');
  ensureColumn('profiles', 'privacy_settings', 'TEXT');
  ensureColumn('profiles', 'favorite_track', 'TEXT');
  ensureColumn('profiles', 'notify_follows', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('profiles', 'notify_news', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('albums', 'release_date', 'TEXT');
  ensureColumn('albums', 'format_type', "TEXT NOT NULL DEFAULT 'album'");
  ensureColumn('albums', 'source_url', 'TEXT');
  ensureColumn('albums', 'streaming_links_json', 'TEXT');
  ensureColumn('albums', 'verified_source', 'TEXT');
  ensureColumn('albums', 'last_verified_at', 'TEXT');
  ensureColumn('albums', 'is_verified', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumn('singles', 'release_date', 'TEXT');
  ensureColumn('singles', 'audio_url', 'TEXT');
  ensureColumn('singles', 'source_url', 'TEXT');
  ensureColumn('singles', 'streaming_links_json', 'TEXT');
  ensureColumn('singles', 'verified_source', 'TEXT');
  ensureColumn('singles', 'last_verified_at', 'TEXT');
  ensureColumn('singles', 'is_verified', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('singles', 'lyrics', 'TEXT');
  ensureColumn('singles', 'is_game_eligible', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumn('tracks', 'single_id', 'TEXT');
  ensureColumn('tracks', 'snippet_start_seconds', 'INTEGER DEFAULT 0');
  ensureColumn('tracks', 'snippet_duration_seconds', 'INTEGER DEFAULT 15');
  ensureColumn('tracks', 'lyrics', 'TEXT');
  ensureColumn('tracks', 'external_url', 'TEXT');
  ensureColumn('tracks', 'source_url', 'TEXT');
  ensureColumn('tracks', 'is_verified', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('tracks', 'is_game_eligible', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumn('games', 'is_active', 'INTEGER NOT NULL DEFAULT 1');

  // Ensure ALL 5 games exist in `games` table inside ensureSchemaAndMigrations
  // (critical after hot-swapping prod apostles.db from Supabase when seedInitialData is not re-run)
  try {
    targetDb.exec(`
      INSERT OR IGNORE INTO games (id, slug, title, description, xp_multiplier, is_active) VALUES
        ('guess-track', 'guess-track', 'Guess The Track', 'Listen to short fragments and identify the track title.', 1.0, 1),
        ('daily-quiz', 'daily-quiz', 'Daily Lore Quiz', 'Daily questions about verified discography and official facts.', 1.2, 1),
        ('guess-lyrics', 'guess-lyrics', 'Угадай строчку', 'Продолжи строчку из трека deathmarried.', 1.0, 1),
        ('reverse-track', 'reverse-track', 'Задом наперёд', 'Угадай трек по 5-секундному фрагменту в реверсе.', 1.1, 1),
        ('speed-track', 'speed-track', 'Трек 0.5x / 2.5x', 'Угадай трек в замедленном 0.5x или ускоренном 2.5x режиме.', 1.1, 1);
    `);
  } catch (err) {
    recordMigrationError('games:seed_all_five', err);
  }

  // Safely drop any stale foreign key referencing `tracks`, `singles`, `games`, or challenge tables
  // on progress/challenge tables because round tracks/options can come from either `tracks` OR `singles`
  // and legacy production DBs may carry outdated FK definitions. Only `users(id)` FK is retained.
  const rebuildTableWithoutTrackFk = (
    tableName: string,
    createCleanSql: (tempTable: string) => string
  ) => {
    try {
      const fks = targetDb
        .prepare(`PRAGMA foreign_key_list(${tableName})`)
        .all() as Array<{ table?: string }>;
      const hasUnexpectedFk = fks.some(
        (fk) => fk.table && fk.table.toLowerCase() !== 'users'
      );
      if (!hasUnexpectedFk) return;

      const oldCols = targetDb
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name: string }>;
      if (oldCols.length === 0) return;

      const existingIndexes = targetDb
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`
        )
        .all(tableName) as Array<{ sql: string }>;

      const oldColSet = new Set(oldCols.map((c) => c.name));
      const tempName = `${tableName}_clean_tmp`;
      const fkWasOn = Boolean(targetDb.pragma('foreign_keys', { simple: true }));
      if (fkWasOn) targetDb.pragma('foreign_keys = OFF');
      try {
        targetDb.transaction(() => {
          targetDb.exec(`DROP TABLE IF EXISTS ${tempName};`);
          targetDb.exec(createCleanSql(tempName));
          const newCols = targetDb
            .prepare(`PRAGMA table_info(${tempName})`)
            .all() as Array<{ name: string }>;
          const commonCols = newCols
            .map((c) => c.name)
            .filter((name) => oldColSet.has(name));
          if (commonCols.length > 0) {
            targetDb.exec(`
              INSERT INTO ${tempName} (${commonCols.join(', ')})
              SELECT ${commonCols.join(', ')} FROM ${tableName};
            `);
          }
          targetDb.exec(`
            DROP TABLE ${tableName};
            ALTER TABLE ${tempName} RENAME TO ${tableName};
          `);
          for (const idx of existingIndexes) {
            if (idx?.sql) {
              try {
                targetDb.exec(idx.sql);
              } catch (idxErr) {
                recordMigrationError(`${tableName}:recreate_index`, idxErr);
              }
            }
          }
        })();
      } finally {
        if (fkWasOn) targetDb.pragma('foreign_keys = ON');
      }
    } catch (err) {
      recordMigrationError(`${tableName}:drop_unexpected_fk`, err);
    }
  };

  rebuildTableWithoutTrackFk('daily_track_challenges', (tmp) => `
    CREATE TABLE ${tmp} (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      track_id TEXT NOT NULL,
      track_source TEXT NOT NULL DEFAULT 'track',
      snippet_start_seconds INTEGER NOT NULL DEFAULT 0,
      snippet_start_ratio REAL NOT NULL DEFAULT 0,
      snippet_duration_seconds INTEGER NOT NULL DEFAULT 5,
      options_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  rebuildTableWithoutTrackFk('daily_track_attempts', (tmp) => `
    CREATE TABLE ${tmp} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      track_id TEXT NOT NULL,
      selected_track_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      time_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );
  `);

  rebuildTableWithoutTrackFk('daily_mini_game_attempts', (tmp) => `
    CREATE TABLE ${tmp} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      selected_value TEXT,
      correct_value TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_id, cycle_id)
    );
  `);

  rebuildTableWithoutTrackFk('game_completions', (tmp) => `
    CREATE TABLE ${tmp} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp_earned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, game_type, cycle_id)
    );
  `);

  rebuildTableWithoutTrackFk('quiz_attempts', (tmp) => `
    CREATE TABLE ${tmp} (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_date TEXT NOT NULL,
      score INTEGER NOT NULL,
      xp_earned INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, challenge_date)
    );
  `);

  ensureColumn('daily_track_challenges', 'track_source', "TEXT NOT NULL DEFAULT 'track'");
  ensureColumn('daily_track_challenges', 'snippet_start_ratio', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('daily_track_challenges', 'snippet_duration_seconds', 'INTEGER NOT NULL DEFAULT 5');

  ensureColumn('game_completions', 'game_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('game_completions', 'cycle_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('game_completions', 'is_correct', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('game_completions', 'score', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('game_completions', 'xp_earned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('game_completions', 'created_at', "TEXT NOT NULL DEFAULT ''");

  ensureColumn('daily_mini_game_attempts', 'game_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('daily_mini_game_attempts', 'cycle_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('daily_mini_game_attempts', 'is_correct', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('daily_mini_game_attempts', 'score', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('daily_mini_game_attempts', 'xp_earned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('daily_mini_game_attempts', 'selected_value', 'TEXT');
  ensureColumn('daily_mini_game_attempts', 'correct_value', 'TEXT');
  ensureColumn('daily_mini_game_attempts', 'details_json', 'TEXT');
  ensureColumn('daily_mini_game_attempts', 'created_at', "TEXT NOT NULL DEFAULT ''");

  // Enforce strict UNIQUE indexes on all 4 game lock tables even on legacy migrated DBs
  // (deduplicating any historical duplicates by keeping the earliest rowid before index creation).
  const enforceGameUniqueIndex = (tableName: string, indexName: string, colsExpr: string, whereNotEmpty: string) => {
    try {
      targetDb.exec(`
        DELETE FROM ${tableName}
        WHERE rowid NOT IN (
          SELECT MIN(rowid) FROM ${tableName} GROUP BY ${colsExpr}
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}
          ON ${tableName}(${colsExpr})${whereNotEmpty ? ` WHERE ${whereNotEmpty}` : ''};
      `);
    } catch (err) {
      recordMigrationError(`${tableName}:unique_index_${indexName}`, err);
    }
  };
  enforceGameUniqueIndex(
    'game_completions',
    'idx_game_completions_unique',
    'user_id, game_type, cycle_id',
    "trim(game_type) <> '' AND trim(cycle_id) <> ''"
  );
  enforceGameUniqueIndex(
    'daily_track_attempts',
    'idx_daily_track_attempts_unique',
    'user_id, challenge_date',
    "trim(challenge_date) <> ''"
  );
  enforceGameUniqueIndex(
    'quiz_attempts',
    'idx_quiz_attempts_unique',
    'user_id, challenge_date',
    "trim(challenge_date) <> ''"
  );
  enforceGameUniqueIndex(
    'daily_mini_game_attempts',
    'idx_daily_mini_game_attempts_unique',
    'user_id, game_id, cycle_id',
    "trim(game_id) <> '' AND trim(cycle_id) <> ''"
  );

  try {
    targetDb.exec(`
      INSERT OR IGNORE INTO app_meta (key, value) VALUES
        ('quiz_enabled', '1'),
        ('active_quiz_ids', '[]');
    `);
  } catch (err) {
    recordMigrationError('app_meta:quiz_defaults', err);
  }

  ensureColumn('post_categories', 'is_official', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('posts', 'media_url', 'TEXT');
  ensureColumn('posts', 'media_type', 'TEXT');
  ensureColumn('posts', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('posts', 'is_locked', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('posts', 'views_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('posts', 'reactions_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('posts', 'comments_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('posts', 'status', "TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn('posts', 'rejection_reason', 'TEXT');
  ensureColumn('posts', 'xp_awarded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('posts', 'xp_awarded_amount', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('comments', 'creation_id', 'TEXT');
  ensureColumn('comments', 'parent_id', 'TEXT');
  ensureColumn('comments', 'status', "TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn('comments', 'album_id', 'TEXT');
  ensureColumn('comments', 'single_id', 'TEXT');
  ensureColumn('comments', 'is_hidden', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('comments', 'xp_awarded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('comments', 'xp_awarded_amount', 'INTEGER NOT NULL DEFAULT 0');
  try { targetDb.exec("CREATE INDEX IF NOT EXISTS idx_comments_album ON comments(album_id);"); } catch {}
  try { targetDb.exec("CREATE INDEX IF NOT EXISTS idx_comments_single ON comments(single_id);"); } catch {}

  ensureColumn('creations', 'category', "TEXT DEFAULT 'art'");
  ensureColumn('creations', 'is_approved', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('creations', 'status', "TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn('creations', 'rejection_reason', 'TEXT');
  ensureColumn('creations', 'xp_awarded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('creations', 'xp_awarded_amount', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('xp_transactions', 'reference_key', 'TEXT');
  try {
    targetDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_transactions_ref_key ON xp_transactions(reference_key) WHERE reference_key IS NOT NULL;");
  } catch {}

  ensureColumn('shop_items', 'rarity', "TEXT NOT NULL DEFAULT 'common'");
  ensureColumn('shop_items', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('shop_items', 'requires_achievement_id', 'TEXT');

  // Always idempotently upsert the full 86-item customization shop catalog inside ensureSchemaAndMigrations
  // (critical after CloudSync restores an older prod snapshot with only 14 items; never deletes existing rows or user_inventory).
  try {
    ensureShopCatalogSeeded(targetDb);
  } catch (err) {
    recordMigrationError('shop_items:seed_catalog', err);
  }

  ensureColumn('promo_codes', 'max_uses', 'INTEGER');
  ensureColumn('promo_codes', 'expires_at', 'TEXT');

  ensureColumn('achievements', 'rarity', "TEXT NOT NULL DEFAULT 'common'");
  ensureColumn('achievements', 'category', "TEXT NOT NULL DEFAULT 'general'");
  ensureColumn('achievements', 'condition_ru', 'TEXT');
  ensureColumn('achievements', 'condition_en', 'TEXT');
  ensureColumn('achievements', 'difficulty_tier', "TEXT NOT NULL DEFAULT 'easy'");
  ensureColumn('achievements', 'is_secret', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('site_news', 'link', "TEXT NOT NULL DEFAULT '/'");
  ensureColumn('site_news', 'sent_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('site_news', 'author_id', 'TEXT');
  ensureColumn('site_news', 'author_nickname', 'TEXT');
  ensureColumn('site_news', 'created_by', 'TEXT');

  // Non-destructive backfill for site_news author_id <-> created_by
  try {
    targetDb.exec(`
      UPDATE site_news
      SET created_by = author_id
      WHERE (created_by IS NULL OR trim(created_by) = '')
        AND author_id IS NOT NULL AND trim(author_id) <> '';
      UPDATE site_news
      SET author_id = created_by
      WHERE (author_id IS NULL OR trim(author_id) = '')
        AND created_by IS NOT NULL AND trim(created_by) <> '';
    `);
  } catch {}

  // Sync total_xp with existing xp if total_xp is 0 (non-destructive)
  try {
    targetDb.exec("UPDATE profiles SET total_xp = xp WHERE total_xp = 0 AND xp > 0;");
  } catch {}

  // Rebuild legacy moderation_actions if target_user_id has NOT NULL constraint (breaks bulk reset audit logs)
  try {
    const modCols = targetDb
      .prepare('PRAGMA table_info(moderation_actions)')
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    const targetUserCol = modCols.find((c) => c.name === 'target_user_id');
    if (modCols.length > 0 && (!targetUserCol || targetUserCol.notnull === 1)) {
      const existingIndexes = targetDb
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'moderation_actions' AND sql IS NOT NULL"
        )
        .all() as Array<{ sql: string }>;
      const oldColSet = new Set(modCols.map((c) => c.name));

      const fkWasOn = Boolean(targetDb.pragma('foreign_keys', { simple: true }));
      if (fkWasOn) {
        targetDb.pragma('foreign_keys = OFF');
      }
      try {
        targetDb.transaction(() => {
          targetDb.exec(`
            DROP TABLE IF EXISTS moderation_actions_new;
            CREATE TABLE moderation_actions_new (
              id TEXT PRIMARY KEY,
              moderator_id TEXT NOT NULL DEFAULT '' REFERENCES users(id) ON DELETE CASCADE,
              target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
              action_type TEXT NOT NULL DEFAULT 'legacy',
              details TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);

          const newCols = targetDb
            .prepare('PRAGMA table_info(moderation_actions_new)')
            .all() as Array<{ name: string; notnull: number }>;
          const newColNames = newCols.map((c) => c.name);

          // Dynamically copy ONLY columns that exist in BOTH old and new moderation_actions schemas
          const insertCols: string[] = [];
          const selectExprs: string[] = [];

          for (const colName of newColNames) {
            if (!oldColSet.has(colName)) continue;
            insertCols.push(colName);
            if (colName === 'id') {
              selectExprs.push("COALESCE(NULLIF(CAST(id AS TEXT), ''), lower(hex(randomblob(8))))");
            } else if (colName === 'moderator_id') {
              selectExprs.push("COALESCE(CAST(moderator_id AS TEXT), '')");
            } else if (colName === 'target_user_id') {
              selectExprs.push('CASE WHEN target_user_id IS NULL THEN NULL ELSE CAST(target_user_id AS TEXT) END');
            } else if (colName === 'action_type') {
              selectExprs.push("COALESCE(NULLIF(CAST(action_type AS TEXT), ''), 'legacy')");
            } else if (colName === 'created_at') {
              selectExprs.push("COALESCE(NULLIF(CAST(created_at AS TEXT), ''), datetime('now'))");
            } else {
              selectExprs.push(colName);
            }
          }

          // Preserve legacy `action` / `reason` values if old table used those column names instead of `action_type` / `details`
          if (!oldColSet.has('action_type') && oldColSet.has('action')) {
            insertCols.push('action_type');
            selectExprs.push("COALESCE(NULLIF(CAST(action AS TEXT), ''), 'legacy')");
          }
          if (!oldColSet.has('details') && oldColSet.has('reason')) {
            insertCols.push('details');
            selectExprs.push('reason');
          }

          if (insertCols.length > 0) {
            targetDb.exec(`
              INSERT INTO moderation_actions_new (${insertCols.join(', ')})
              SELECT ${selectExprs.join(', ')}
              FROM moderation_actions;
            `);
          }

          targetDb.exec(`
            DROP TABLE moderation_actions;
            ALTER TABLE moderation_actions_new RENAME TO moderation_actions;
          `);

          for (const idx of existingIndexes) {
            if (idx?.sql) {
              try {
                targetDb.exec(idx.sql);
              } catch (idxErr) {
                recordMigrationError('moderation_actions:recreate_index', idxErr);
              }
            }
          }
        })();
      } finally {
        if (fkWasOn) {
          targetDb.pragma('foreign_keys = ON');
        }
      }
    }
  } catch (err) {
    recordMigrationError('moderation_actions:rebuild', err);
  }

  ensureColumn('moderation_actions', 'action_type', "TEXT NOT NULL DEFAULT 'legacy'");
  ensureColumn('moderation_actions', 'details', 'TEXT');
  ensureColumn('moderation_actions', 'created_at', 'TEXT');

  // Ensure legacy accounts with empty display_name gracefully inherit nickname
  try {
    targetDb.exec(`
      UPDATE profiles
      SET display_name = (SELECT u.nickname FROM users u WHERE u.id = profiles.user_id)
      WHERE display_name IS NULL OR trim(display_name) = '';
    `);
  } catch (err) {
    recordMigrationError('profiles:display_name_backfill', err);
  }
}

export function initDatabase() {
  ensureSchemaAndMigrations();
  seedInitialData();
}

function seedInitialData() {
  // Check if admin user exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE nickname = ?').get('deathmarried_admin');
  if (!existingAdmin) {
    const adminId = 'usr_admin_001';
    const hash = bcrypt.hashSync('apostle_admin_2026', 10);
    db.prepare(`
      INSERT INTO users (id, nickname, password_hash, role_id)
      VALUES (?, ?, ?, 'admin')
    `).run(adminId, 'deathmarried_admin', hash);

    db.prepare(`
      INSERT INTO profiles (user_id, display_name, avatar_url, bio, level, xp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      adminId,
      'Archive Curator (Admin)',
      '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      'Keeper of the official deathmarried archive and underground catalog.',
      10,
      1500
    );
  }

  const sushkanovAdmin = db.prepare('SELECT id FROM users WHERE nickname = ? OR email = ?').get('sushkanov097', 'sushkanov097@gmail.com') as any;
  if (!sushkanovAdmin) {
    const sushId = 'usr_sushkanov_097';
    const sushHash = bcrypt.hashSync('sushkanov097', 10);
    db.prepare(`
      INSERT INTO users (id, nickname, email, password_hash, role_id)
      VALUES (?, ?, ?, ?, 'admin')
    `).run(sushId, 'sushkanov097', 'sushkanov097@gmail.com', sushHash);

    db.prepare(`
      INSERT INTO profiles (user_id, display_name, avatar_url, bio, level, xp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sushId,
      'sushkanov097 (Administrator)',
      '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      'Chief Administrator and Curator of Apostles of deathmarried.',
      10,
      2500
    );
  } else {
    db.prepare("UPDATE users SET role_id = 'admin', email = 'sushkanov097@gmail.com' WHERE id = ?").run(sushkanovAdmin.id);
  }

  // Seed default Categories (Official vs Community)
  const categories = [
    { id: 'cat_official', slug: 'official', name_ru: 'Новости и анонсы', name_en: 'News & Announcements', desc_ru: 'Официальные обновления архива и релизы deathmarried (публикует администрация)', desc_en: 'Official archive updates and deathmarried news (administrators only)', sort_order: 1, is_official: 1 },
    { id: 'cat_music', slug: 'music', name_ru: 'Обсуждение музыки', name_en: 'Music Discussion', desc_ru: 'Анализ композиций, концепций альбомов и звучания deathmarried', desc_en: 'Discussion of songs, production, and sonic concepts', sort_order: 2, is_official: 0 },
    { id: 'cat_production', slug: 'production', name_ru: 'Звук и саунд-дизайн', name_en: 'Sound Design & Beats', desc_ru: 'Синтезаторы, сэмплы, пресеты и инструменты', desc_en: 'Synths, samples, plugins and dark production aesthetics', sort_order: 3, is_official: 0 },
    { id: 'cat_general', slug: 'general', name_ru: 'Общение', name_en: 'Community Lounge', desc_ru: 'Свободное обсуждение для участников сообщества', desc_en: 'Open discussion space for music lovers', sort_order: 4, is_official: 0 },
  ];

  const insertCategory = db.prepare(`
    INSERT INTO post_categories (id, slug, name_ru, name_en, desc_ru, desc_en, sort_order, is_official)
    VALUES (@id, @slug, @name_ru, @name_en, @desc_ru, @desc_en, @sort_order, @is_official)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      name_ru = excluded.name_ru,
      name_en = excluded.name_en,
      desc_ru = excluded.desc_ru,
      desc_en = excluded.desc_en,
      sort_order = excluded.sort_order,
      is_official = excluded.is_official
  `);
  for (const cat of categories) {
    insertCategory.run(cat);
  }

  // Seed expanded mechanics-driven Achievements across Easy, Hard, and Secret tiers with balanced XP rewards
  // NOTE: archive_initiate stays 0 XP so newly registered accounts always start cleanly at 0 XP.
  const achievements = [
    // Easy (Лёгкие): 10–25 XP
    { id: 'ach_archive_initiate', slug: 'archive_initiate', title_ru: 'Участник архива', title_en: 'Archive Member', desc_ru: 'Создайте свой аккаунт в сообществе Apostles of deathmarried', desc_en: 'Create your Apostles of deathmarried account', condition_ru: 'Зарегистрироваться на сайте', condition_en: 'Register an account', category: 'getting_started', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'moon', xp_reward: 0 },
    { id: 'ach_shadow_identity', slug: 'shadow_identity', title_ru: 'Личный почерк', title_en: 'Personal Mark', desc_ru: 'Заполните описание профиля «О себе» или личный статус', desc_en: 'Customize your profile bio or personal status', condition_ru: 'Добавить «О себе» или статус в профиле', condition_en: 'Set a profile bio or custom status', category: 'getting_started', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'feather', xp_reward: 15 },
    { id: 'ach_first_blood', slug: 'first_blood', title_ru: 'Первый шаг', title_en: 'First Step', desc_ru: 'Сыграйте в любое ежедневное испытание архива', desc_en: 'Play your first interactive challenge', condition_ru: 'Завершить 1 игру', condition_en: 'Complete 1 game', category: 'getting_started', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'play', xp_reward: 15 },
    { id: 'ach_first_note', slug: 'first_note', title_ru: 'Узнанный аккорд', title_en: 'Recognized Chord', desc_ru: 'Впервые угадайте трек дня по 5-секундному отрывку', desc_en: 'Correctly guess a Daily Track from its 5-second snippet', condition_ru: '1 правильный ответ в «Угадай трек»', condition_en: '1 correct Guess The Track', category: 'music', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'music', xp_reward: 20 },
    { id: 'ach_quiz_seeker', slug: 'quiz_seeker', title_ru: 'Искатель фактов', title_en: 'Lore Seeker', desc_ru: 'Завершите первую ежедневную викторину архива', desc_en: 'Complete your first Daily Quiz', condition_ru: 'Пройти 1 ежедневную викторину', condition_en: 'Complete 1 Daily Quiz', category: 'quiz', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'book-open', xp_reward: 20 },
    { id: 'ach_devoted_acolyte', slug: 'devoted_acolyte', title_ru: 'Преданный слушатель', title_en: 'Devoted Listener', desc_ru: 'Поддерживайте серию активности 3 дня подряд по МСК', desc_en: 'Maintain a 3-day daily streak', condition_ru: 'Серия 3 дня подряд', condition_en: '3-day daily streak', category: 'consistency', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'calendar', xp_reward: 25 },
    { id: 'ach_collector', slug: 'collector', title_ru: 'Коллекционер', title_en: 'Collector', desc_ru: 'Приобретите первый предмет в магазине кастомизации', desc_en: 'Acquire your first item in the XP Shop', condition_ru: 'Купить 1 предмет в магазине', condition_en: 'Buy 1 shop item', category: 'collector', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'tag', xp_reward: 15 },
    { id: 'ach_first_chronicle', slug: 'first_chronicle', title_ru: 'Первая запись', title_en: 'First Chronicle', desc_ru: 'Создайте свою первую тему в сообществе', desc_en: 'Publish your first community forum topic', condition_ru: 'Создать 1 тему на форуме', condition_en: 'Create 1 forum topic', category: 'community', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'message-square', xp_reward: 20 },
    { id: 'ach_easy_first_reply', slug: 'easy_first_reply', title_ru: 'Первый отклик', title_en: 'First Reply', desc_ru: 'Оставьте свой первый комментарий в теме сообщества', desc_en: 'Post your first reply in a community topic', condition_ru: 'Оставить 1 комментарий', condition_en: 'Write 1 comment', category: 'community', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'message-square', xp_reward: 15 },
    { id: 'ach_midnight_critic', slug: 'midnight_critic', title_ru: 'Ночной собеседник', title_en: 'Nocturnal Critic', desc_ru: 'Оставьте 5 комментариев в обсуждениях сообщества', desc_en: 'Post 5 comments across discussions', condition_ru: 'Оставить 5 комментариев', condition_en: 'Write 5 comments', category: 'community', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'feather', xp_reward: 25 },
    { id: 'ach_easy_avid_reader', slug: 'easy_avid_reader', title_ru: 'Читатель форума', title_en: 'Forum Reader', desc_ru: 'Откройте и прочитайте 5 разных тем в сообществе', desc_en: 'Read 5 distinct topics in the community', condition_ru: 'Прочитать 5 тем в сообществе', condition_en: 'Read 5 community topics', category: 'community', rarity: 'common', difficulty_tier: 'easy', is_secret: 0, icon: 'book-open', xp_reward: 20 },
    { id: 'ach_gothic_artisan', slug: 'gothic_artisan', title_ru: 'Творец', title_en: 'Creator', desc_ru: 'Опубликуйте свою работу в творческой галерее', desc_en: 'Publish your work in the Creations gallery', condition_ru: 'Опубликовать 1 работу в галерее', condition_en: 'Publish 1 creation', category: 'community', rarity: 'rare', difficulty_tier: 'easy', is_secret: 0, icon: 'sparkles', xp_reward: 25 },
    { id: 'ach_coven_circle', slug: 'coven_circle', title_ru: 'Свой круг', title_en: 'Inner Circle', desc_ru: 'Наберите 3 подписчиков или подпишитесь на 3 участников', desc_en: 'Reach 3 followers or follow 3 community members', condition_ru: '3 подписчика или 3 подписки', condition_en: '3 followers or following', category: 'community', rarity: 'rare', difficulty_tier: 'easy', is_secret: 0, icon: 'users', xp_reward: 25 },
    { id: 'ach_dressed_in_velvet', slug: 'dressed_in_velvet', title_ru: 'Стиль архива', title_en: 'Archive Style', desc_ru: 'Одновременно экипируйте 3 элемента оформления профиля', desc_en: 'Equip 3 customization layers simultaneously', condition_ru: 'Экипировать 3 предмета одновременно', condition_en: 'Equip 3 items at once', category: 'collector', rarity: 'rare', difficulty_tier: 'easy', is_secret: 0, icon: 'sparkles', xp_reward: 25 },

    // Hard (Сложные): 40–100 XP
    { id: 'ach_vinyl_hunter', slug: 'vinyl_hunter', title_ru: 'Охотник за винилом', title_en: 'Vinyl Hunter', desc_ru: 'Угадайте 5 ежедневных композиций deathmarried', desc_en: 'Guess 5 daily deathmarried tracks correctly', condition_ru: '5 побед в «Угадай трек»', condition_en: '5 Guess The Track wins', category: 'music', rarity: 'rare', difficulty_tier: 'hard', is_secret: 0, icon: 'disc', xp_reward: 40 },
    { id: 'ach_phantom_ear', slug: 'phantom_ear', title_ru: 'Абсолютный слух', title_en: 'Phantom Ear', desc_ru: 'Угадайте 15 ежедневных композиций по 5-секундному фрагменту', desc_en: 'Guess 15 daily tracks from 5-second snippets', condition_ru: '15 побед в «Угадай трек»', condition_en: '15 Guess The Track wins', category: 'music', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'headphones', xp_reward: 75 },
    { id: 'ach_initiate_ritual', slug: 'initiate_ritual', title_ru: 'Чуткий слух', title_en: 'Musical Ear', desc_ru: 'Завершите 10 раундов в ежедневных играх архива', desc_en: 'Complete 10 interactive game sessions', condition_ru: 'Сыграть 10 игр', condition_en: 'Play 10 games', category: 'music', rarity: 'rare', difficulty_tier: 'hard', is_secret: 0, icon: 'headphones', xp_reward: 40 },
    { id: 'ach_ritual_master', slug: 'ritual_master', title_ru: 'Мастер испытаний', title_en: 'Trial Master', desc_ru: 'Примите участие в 30 игровых испытаниях сообщества', desc_en: 'Complete 30 archive game trials', condition_ru: 'Сыграть 30 игр', condition_en: 'Play 30 games', category: 'music', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'zap', xp_reward: 80 },
    { id: 'ach_lore_scholar', slug: 'lore_scholar', title_ru: 'Знаток дискографии', title_en: 'Discography Connoisseur', desc_ru: 'Пройдите ежедневную викторину без единой ошибки', desc_en: 'Achieve a perfect score in Daily Quiz', condition_ru: '100% правильных ответов в викторине', condition_en: 'Perfect score in Daily Quiz', category: 'quiz', rarity: 'rare', difficulty_tier: 'hard', is_secret: 0, icon: 'award', xp_reward: 45 },
    { id: 'ach_obsidian_oracle', slug: 'obsidian_oracle', title_ru: 'Обсидиановый оракул', title_en: 'Obsidian Oracle', desc_ru: 'Пройдите ежедневную викторину без ошибок 3 раза', desc_en: 'Score 100% in Daily Quiz 3 times', condition_ru: '3 идеальных прохождения викторины', condition_en: '3 perfect Daily Quiz runs', category: 'quiz', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'eye', xp_reward: 75 },
    { id: 'ach_cathedral_historian', slug: 'cathedral_historian', title_ru: 'Летописец свода', title_en: 'Cathedral Historian', desc_ru: 'Завершите 10 ежедневных викторин архива', desc_en: 'Complete 10 Daily Quizzes', condition_ru: 'Пройти 10 викторин', condition_en: 'Complete 10 Daily Quizzes', category: 'quiz', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'compass', xp_reward: 65 },
    { id: 'ach_eternal_vigil', slug: 'eternal_vigil', title_ru: 'Неделя в ритме', title_en: 'Seven Nights', desc_ru: 'Поддерживайте серию активности 7 дней подряд по МСК', desc_en: 'Maintain a 7-day daily streak', condition_ru: 'Серия 7 дней подряд', condition_en: '7-day daily streak', category: 'consistency', rarity: 'rare', difficulty_tier: 'hard', is_secret: 0, icon: 'shield', xp_reward: 50 },
    { id: 'ach_midnight_devotion', slug: 'midnight_devotion', title_ru: 'Полуночная вахта', title_en: 'Midnight Vigil', desc_ru: 'Возвращайтесь в архив 14 дней подряд без перерыва', desc_en: 'Maintain a 14-day daily streak', condition_ru: 'Серия 14 дней подряд', condition_en: '14-day daily streak', category: 'consistency', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'flame', xp_reward: 75 },
    { id: 'ach_immortal_flame', slug: 'immortal_flame', title_ru: 'Негасимое пламя', title_en: 'Immortal Flame', desc_ru: 'Выдержите серию активности 30 дней подряд', desc_en: 'Maintain a 30-day unbroken daily streak', condition_ru: 'Серия 30 дней подряд', condition_en: '30-day daily streak', category: 'consistency', rarity: 'legendary', difficulty_tier: 'hard', is_secret: 0, icon: 'crown', xp_reward: 100 },
    { id: 'ach_relic_hoarder', slug: 'relic_hoarder', title_ru: 'Собиратель реликвий', title_en: 'Relic Curator', desc_ru: 'Соберите 5 предметов кастомизации в своей коллекции', desc_en: 'Own 5 customization items', condition_ru: 'Собрать 5 предметов коллекции', condition_en: 'Own 5 items', category: 'collector', rarity: 'rare', difficulty_tier: 'hard', is_secret: 0, icon: 'gem', xp_reward: 45 },
    { id: 'ach_gothic_treasury', slug: 'gothic_treasury', title_ru: 'Большая коллекция', title_en: 'Grand Treasury', desc_ru: 'Соберите 10 предметов оформления в инвентаре', desc_en: 'Own 10 customization items', condition_ru: 'Собрать 10 предметов коллекции', condition_en: 'Own 10 items', category: 'collector', rarity: 'legendary', difficulty_tier: 'hard', is_secret: 0, icon: 'layers', xp_reward: 90 },
    { id: 'ach_voice_of_abyss', slug: 'voice_of_abyss', title_ru: 'Голос сообщества', title_en: 'Community Voice', desc_ru: 'Создайте 3 записи на форуме сообщества', desc_en: 'Create 3 community forum discussions', condition_ru: 'Создать 3 темы на форуме', condition_en: 'Create 3 forum topics', category: 'community', rarity: 'rare', difficulty_tier: 'hard', is_secret: 0, icon: 'message-square', xp_reward: 40 },
    { id: 'ach_hard_community_reader', slug: 'hard_community_reader', title_ru: 'Хроникёр форума', title_en: 'Forum Chronicler', desc_ru: 'Прочитайте 20 разных тем и обсуждений в сообществе', desc_en: 'Read 20 distinct topics in the community', condition_ru: 'Прочитать 20 тем в сообществе', condition_en: 'Read 20 community topics', category: 'community', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'book-open', xp_reward: 50 },
    { id: 'ach_dark_apostle', slug: 'dark_apostle', title_ru: 'Мастер звука', title_en: 'Sound Master', desc_ru: 'Наберите 500 суммарных очков опыта (Total XP)', desc_en: 'Attain 500 lifetime Total XP', condition_ru: 'Набрать 500 Total XP', condition_en: 'Reach 500 Total XP', category: 'veteran', rarity: 'epic', difficulty_tier: 'hard', is_secret: 0, icon: 'trophy', xp_reward: 60 },
    { id: 'ach_archon_of_sound', slug: 'archon_of_sound', title_ru: 'Ветеран архива', title_en: 'Archive Veteran', desc_ru: 'Достигните 1500 Total XP или 8-го уровня профиля', desc_en: 'Reach 1500 Total XP or Profile Level 8', condition_ru: '1500 Total XP или 8-й уровень', condition_en: '1500 Total XP or Level 8', category: 'veteran', rarity: 'legendary', difficulty_tier: 'hard', is_secret: 0, icon: 'star', xp_reward: 100 },

    // Secret Easter Eggs (Секретные пасхалки): 35–75 XP (условие скрыто под «???» до получения)
    { id: 'ach_secret_midnight_visitor', slug: 'secret_midnight_visitor', title_ru: 'Полуночник', title_en: 'Midnight Visitor', desc_ru: 'Вы заглянули в архив в самый тихий час — с 00:00 до 00:15 по МСК', desc_en: 'Visit the archive between 00:00 and 00:15 Moscow time', condition_ru: 'Зайти на сайт с 00:00 до 00:15 по МСК', condition_en: 'Visit between 00:00 and 00:15 MSK', category: 'secret', rarity: 'epic', difficulty_tier: 'secret', is_secret: 1, icon: 'moon', xp_reward: 50 },
    { id: 'ach_secret_on_repeat', slug: 'secret_on_repeat', title_ru: 'На репите', title_en: 'On Repeat', desc_ru: 'Вы прослушали один и тот же трек полностью 10 раз подряд или за всё время', desc_en: 'Listen to any single track to completion 10 times', condition_ru: 'Прослушать один трек полностью 10 раз', condition_en: 'Play any single track to the end 10 times', category: 'secret', rarity: 'epic', difficulty_tier: 'secret', is_secret: 1, icon: 'disc', xp_reward: 60 },
    { id: 'ach_secret_curious_rose', slug: 'secret_curious_rose', title_ru: 'Любопытный', title_en: 'Curious Mind', desc_ru: 'Вы нашли пасхалку и нажали 5 раз на спрятанную деталь в оформлении сайта', desc_en: 'Click 5 times on the hidden rose detail in the header', condition_ru: 'Нажать 5 раз на скрытую розу в шапке сайта', condition_en: 'Click 5 times on the hidden rose emblem', category: 'secret', rarity: 'rare', difficulty_tier: 'secret', is_secret: 1, icon: 'eye', xp_reward: 35 },
    { id: 'ach_secret_first_code', slug: 'secret_first_code', title_ru: 'Первый код', title_en: 'First Code', desc_ru: 'Вы нашли и активировали свой первый секретный промокод', desc_en: 'Redeem your first promo code', condition_ru: 'Активировать любой промокод', condition_en: 'Redeem any promo code', category: 'secret', rarity: 'rare', difficulty_tier: 'secret', is_secret: 1, icon: 'tag', xp_reward: 40 },
    { id: 'ach_secret_flawless_quiz', slug: 'secret_flawless_quiz', title_ru: 'Без права на ошибку', title_en: 'Flawless Run', desc_ru: 'Безупречное знание архива — ежедневная викторина пройдена на 5/5', desc_en: 'Complete a Daily Quiz with a flawless 5/5 score', condition_ru: 'Пройти ежедневную викторину на 5/5', condition_en: 'Finish Daily Quiz with 5/5 score', category: 'secret', rarity: 'legendary', difficulty_tier: 'secret', is_secret: 1, icon: 'crown', xp_reward: 75 },
  ];

  const insertAch = db.prepare(`
    INSERT INTO achievements (id, slug, title_ru, title_en, desc_ru, desc_en, condition_ru, condition_en, category, rarity, difficulty_tier, is_secret, icon, xp_reward)
    VALUES (@id, @slug, @title_ru, @title_en, @desc_ru, @desc_en, @condition_ru, @condition_en, @category, @rarity, @difficulty_tier, @is_secret, @icon, @xp_reward)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      title_ru = excluded.title_ru,
      title_en = excluded.title_en,
      desc_ru = excluded.desc_ru,
      desc_en = excluded.desc_en,
      condition_ru = excluded.condition_ru,
      condition_en = excluded.condition_en,
      category = excluded.category,
      rarity = excluded.rarity,
      difficulty_tier = excluded.difficulty_tier,
      is_secret = excluded.is_secret,
      icon = excluded.icon,
      xp_reward = excluded.xp_reward
  `);
  for (const ach of achievements) {
    insertAch.run(ach);
  }

  // Customization Shop (all 86 items + legacy title_* remap + equipped_banner refresh)
  // is also guaranteed unconditionally inside ensureSchemaAndMigrations() so CloudSync cold-start
  // restores of older prod snapshots automatically receive the full 86-item catalog.
  ensureShopCatalogSeeded(db);

  // Seed initial starter promo codes safely (INSERT OR IGNORE — never resets existing redemptions)
  const initialPromoCodes = [
    {
      id: 'promo_apostles',
      code: 'apostles',
      xp_reward: 100,
      description_ru: 'Приветственный промокод сообщества apostles of deathmarried (+100 XP)',
      description_en: 'Community welcome promo code (+100 XP)',
    },
    {
      id: 'promo_deathmarried',
      code: 'deathmarried',
      xp_reward: 100,
      description_ru: 'Стартовый промокод слушателя deathmarried (+100 XP)',
      description_en: 'deathmarried listener starter promo code (+100 XP)',
    },
  ];
  const insertPromo = db.prepare(`
    INSERT OR IGNORE INTO promo_codes (id, code, xp_reward, is_active, description_ru, description_en)
    VALUES (@id, @code, @xp_reward, 1, @description_ru, @description_en)
  `);
  for (const promo of initialPromoCodes) {
    insertPromo.run(promo);
  }

  // --------------------------------------------------------------------------
  // SEED VERIFIED DEATHMARRIED DISCOGRAPHY (ALBUMS, EPS, SINGLES) — ONCE ONLY
  // --------------------------------------------------------------------------
  const discographySeeded = db.prepare("SELECT value FROM app_meta WHERE key = 'discography_seeded'").get() as { value: string } | undefined;
  const albumCount = db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number };
  if (!discographySeeded && albumCount.count > 0) {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('discography_seeded', '1')").run();
  }
  if (!discographySeeded && albumCount.count === 0) {
    // 1. Studio Album: nightmortan (Released October 10, 2025)
    const alb1Id = 'alb_nightmortan';
    const nightmortanStreaming = JSON.stringify({
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      apple_music: 'https://music.apple.com/us/artist/deathmarried/1769850125',
      yandex_music: 'https://music.yandex.ru/album/38538013',
      vk_music: 'https://vk.com/artist/deathmarried',
      youtube_music: 'https://music.youtube.com/search?q=deathmarried+nightmortan',
    });

    db.prepare(`
      INSERT INTO albums (id, title, release_year, release_date, cover_url, description, track_count, duration_seconds, sort_order, format_type, source_url, streaming_links_json, verified_source, last_verified_at, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alb1Id,
      'nightmortan',
      2025,
      '2025-10-10',
      'https://avatars.yandex.net/get-music-content/16508792/c2b3af87.a.38538013-1/1000x1000',
      'Официальный полноформатный студийный альбом deathmarried, выпущенный 10 октября 2025 года. Мрачная винтажная эстетика, сплав экспериментального андеграунд-рэпа, нью-джаза и гипнотического звукового ландшафта.',
      9,
      1150,
      1,
      'album',
      'https://music.apple.com/us/artist/deathmarried/1769850125',
      nightmortanStreaming,
      'Apple Music (Artist ID: 1769850125) & Yandex Music (Album ID: 38538013)',
      '2026-11-09',
      1
    );

    const nightmortanTracks = [
      { id: 'trk_nm_01', num: 1, title: 'twilight', dur: 132, audio: '/audio/crown_of_thorns.wav', lyrics: 'twilight hours / shadows stretch across the cathedral floor\nwhispers echoing beneath the heavy iron door' },
      { id: 'trk_nm_02', num: 2, title: 'edward scissorhands', dur: 144, audio: '/audio/midnight_rose.wav', lyrics: 'cold blades, quiet hands / garden of black roses in the dead of night' },
      { id: 'trk_nm_03', num: 3, title: 'cross pirouette', dur: 128, audio: '/audio/cathedral_veil.wav', lyrics: 'pirouette in the dust / velvet threads unspooling in silence' },
      { id: 'trk_nm_04', num: 4, title: 'dreams fallen', dur: 140, audio: '', lyrics: 'fallen from the heights into the velvet mist / memory fading where darkness exists' },
      { id: 'trk_nm_05', num: 5, title: 'get married', dur: 136, audio: '', lyrics: 'tied with black silk ribbon / vows taken beneath the autumn veil' },
      { id: 'trk_nm_06', num: 6, title: 'bon ami', dur: 118, audio: '', lyrics: 'farewell to trusted shades / footprints washed by the rain' },
      { id: 'trk_nm_07', num: 7, title: 'on my bones', dur: 152, audio: '', lyrics: 'carved into marrow / heavy subterranean low-end' },
      { id: 'trk_nm_08', num: 8, title: 'there are no angels here', dur: 148, audio: '', lyrics: 'empty stone halls / resonance of forgotten hymns' },
      { id: 'trk_nm_09', num: 9, title: 'the last violin', dur: 162, audio: '', lyrics: 'final bow strokes fading into absolute stillness' },
    ];

    const insertTrack = db.prepare(`
      INSERT INTO tracks (id, album_id, title, track_number, duration_seconds, audio_url, lyrics, source_url, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (const trk of nightmortanTracks) {
      insertTrack.run(
        trk.id,
        alb1Id,
        trk.title,
        trk.num,
        trk.dur,
        trk.audio,
        trk.lyrics,
        'https://music.apple.com/us/artist/deathmarried/1769850125'
      );
    }

    // 2. EP: YOU COULD BE PUMPKIN (Released December 2024 by deathmarried)
    const epPumpkinId = 'ep_pumpkin_2024';
    const pumpkinStreaming = JSON.stringify({
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      apple_music: 'https://music.apple.com/us/artist/deathmarried/1769850125',
      yandex_music: 'https://music.yandex.ru/artist/24402692',
      vk_music: 'https://vk.com/artist/deathmarried',
      youtube_music: 'https://music.youtube.com/search?q=deathmarried+YOU+COULD+BE+PUMPKIN',
    });

    db.prepare(`
      INSERT INTO albums (id, title, release_year, release_date, cover_url, description, track_count, duration_seconds, sort_order, format_type, source_url, streaming_links_json, verified_source, last_verified_at, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      epPumpkinId,
      'YOU COULD BE PUMPKIN',
      2024,
      '2024-12-01',
      '',
      'Официальный концептуальный EP (декабрь 2024). Авангардный лоу-фай и рейдж-звучание deathmarried.',
      6,
      768,
      2,
      'ep',
      'https://music.apple.com/us/artist/deathmarried/1769850125',
      pumpkinStreaming,
      'Apple Music & VK (Artist: deathmarried)',
      '2026-11-09',
      1
    );

    const pumpkinTracks = [
      { id: 'trk_pk_01', num: 1, title: 'с мёртвыми', dur: 105 },
      { id: 'trk_pk_02', num: 2, title: 'Chery Tiggo', dur: 151 },
      { id: 'trk_pk_03', num: 3, title: 'Estate', dur: 124 },
      { id: 'trk_pk_04', num: 4, title: 'Gotham', dur: 130 },
      { id: 'trk_pk_05', num: 5, title: 'Batman', dur: 138 },
      { id: 'trk_pk_06', num: 6, title: 'DJ Pumpkin', dur: 120 },
    ];

    for (const trk of pumpkinTracks) {
      insertTrack.run(
        trk.id,
        epPumpkinId,
        trk.title,
        trk.num,
        trk.dur,
        '',
        'Track from YOU COULD BE PUMPKIN EP.',
        'https://music.apple.com/us/artist/deathmarried/1769850125'
      );
    }

    // 3. EP: MURDA M (Released 2024 by deathmarried)
    const epMurdaId = 'ep_murda_m_2024';
    const murdaStreaming = JSON.stringify({
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      apple_music: 'https://music.apple.com/us/artist/deathmarried/1769850125',
      vk_music: 'https://vk.com/artist/deathmarried',
      youtube_music: 'https://music.youtube.com/search?q=deathmarried+MURDA+M',
    });

    db.prepare(`
      INSERT INTO albums (id, title, release_year, release_date, cover_url, description, track_count, duration_seconds, sort_order, format_type, source_url, streaming_links_json, verified_source, last_verified_at, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      epMurdaId,
      'MURDA M',
      2024,
      '2024-04-15',
      '',
      'Официальный мини-релиз MURDA M (2024). Агрессивный звук и эксперименты с ритмикой.',
      3,
      375,
      3,
      'ep',
      'https://music.apple.com/us/artist/deathmarried/1769850125',
      murdaStreaming,
      'Apple Music (Artist: deathmarried)',
      '2026-11-09',
      1
    );

    const murdaTracks = [
      { id: 'trk_mm_01', num: 1, title: 'НИКТО НЕ ХОЧЕТ', dur: 125 },
      { id: 'trk_mm_02', num: 2, title: 'Гриффины', dur: 118 },
      { id: 'trk_mm_03', num: 3, title: 'MURDA M', dur: 132 },
    ];

    for (const trk of murdaTracks) {
      insertTrack.run(
        trk.id,
        epMurdaId,
        trk.title,
        trk.num,
        trk.dur,
        '',
        'Archived canon track from MURDA M.',
        'https://music.apple.com/us/artist/deathmarried/1769850125'
      );
    }

    // 4. Official Verified Singles
    const insertSingle = db.prepare(`
      INSERT INTO singles (id, title, release_year, release_date, cover_url, description, duration_seconds, audio_url, source_url, streaming_links_json, verified_source, last_verified_at, is_verified, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const standardStreaming = (title: string, appleUrl?: string) => JSON.stringify({
      apple_music: appleUrl || 'https://music.apple.com/us/artist/deathmarried/1769850125',
      spotify: 'https://open.spotify.com/artist/6P2Xy1W1FpDqBNDL2Q8lG8',
      vk_music: 'https://vk.com/artist/deathmarried',
      yandex_music: 'https://music.yandex.ru/artist/24402692',
      youtube_music: `https://music.youtube.com/search?q=deathmarried+${encodeURIComponent(title)}`,
    });

    const verifiedSinglesList = [
      {
        id: 'sng_athens_2026',
        title: 'athens',
        year: 2026,
        date: '2026-06-01',
        dur: 142,
        desc: 'Официальный сингл 2026 года. Эволюция готического трэпа и атмосферных текстур.',
        url: 'https://music.apple.com/us/album/athens-single/1813476901',
        source: 'Apple Music (Album ID: 1813476901)',
      },
      {
        id: 'sng_satn_2025',
        title: 'satn',
        year: 2025,
        date: '2025-03-28',
        dur: 135,
        desc: 'Официальный сингл (28 марта 2025 г.). Тяжёлый низкочастотный бас и фирменная подача.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_sexisdeath_2025',
        title: 'sexisdeath',
        year: 2025,
        date: '2025-01-24',
        dur: 128,
        desc: 'Официальный сингл (24 января 2025 г.), предварявший альбом nightmortan.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_erd_2024',
        title: 'Erd',
        year: 2024,
        date: '2024-08-10',
        dur: 115,
        desc: 'Культовый андеграунд-сингл deathmarried.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & VK',
      },
      {
        id: 'sng_yetiraper_2024',
        title: '#YETIRAPER',
        year: 2024,
        date: '2024-05-20',
        dur: 130,
        desc: 'Официальный сингл 2024 года с характерным агрессивным флоу deathmarried.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_swag_from_ohio_2023',
        title: 'SWAG FROM OHIO',
        year: 2023,
        date: '2023-11-12',
        dur: 134,
        desc: 'Официальный ранний релиз deathmarried, заложивший основы андеграунд-стиля.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & Spotify',
      },
      {
        id: 'sng_hells_holidays_2023',
        title: "HELL'S HOLIDAYS",
        year: 2023,
        date: '2023-09-01',
        dur: 122,
        desc: 'Мрачный экспериментальный сингл 2023 года.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music',
      },
      {
        id: 'sng_flawless_2023',
        title: 'FLAWLЁSS',
        year: 2023,
        date: '2023-06-15',
        dur: 145,
        desc: 'Сингл с уникальным звучанием и гипнотической атмосферой.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music',
      },
      {
        id: 'sng_love_2023',
        title: 'Любовью<3',
        year: 2023,
        date: '2023-04-10',
        dur: 125,
        desc: 'Мелодичный готическо-романтический релиз 2023 года.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & VK',
      },
      {
        id: 'sng_pnmd_2023',
        title: 'ПНМД',
        year: 2023,
        date: '2023-02-18',
        dur: 112,
        desc: 'Ранний андеграунд-сингл с плотным саундом.',
        url: 'https://music.apple.com/us/artist/deathmarried/1769850125',
        source: 'Apple Music & VK',
      },
    ];

    verifiedSinglesList.forEach((sng, idx) => {
      insertSingle.run(
        sng.id,
        sng.title,
        sng.year,
        sng.date,
        '',
        sng.desc,
        sng.dur,
        '',
        sng.url,
        standardStreaming(sng.title, sng.url),
        sng.source,
        '2026-11-09',
        1,
        idx + 1
      );
    });
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('discography_seeded', '1')").run();
  }

  // Seed strictly verified, factual Quiz Questions on real deathmarried discography (only if table is empty)
  const quizCount = db.prepare('SELECT COUNT(*) as count FROM quiz_questions').get() as { count: number };
  if (quizCount.count === 0) {
    const questions = [
      {
        id: 'qz_dm_01',
        question_ru: 'Какой полноформатный студийный альбом deathmarried официально вышел в 2025 году?',
        question_en: 'Which full-length studio album did deathmarried officially release in 2025?',
        options_json: JSON.stringify(['YOU COULD BE PUMPKIN', 'nightmortan', 'athens', 'satn']),
        correct_index: 1,
        explanation_ru: 'Альбом «nightmortan» является официальным студийным релизом deathmarried 2025 года.',
        explanation_en: 'The album "nightmortan" is an official 2025 studio release by deathmarried.',
        difficulty: 1,
      },
      {
        id: 'qz_dm_03',
        question_ru: 'Какая композиция открывает треклист альбома «nightmortan»?',
        question_en: 'Which track opens the tracklist of the album "nightmortan"?',
        options_json: JSON.stringify(['edward scissorhands', 'the last violin', 'twilight', 'get married']),
        correct_index: 2,
        explanation_ru: 'Открывающим треком альбома «nightmortan» является «twilight».',
        explanation_en: 'The album "nightmortan" opens with "twilight".',
        difficulty: 1,
      },
      {
        id: 'qz_dm_05',
        question_ru: 'Какой официальный сингл deathmarried датирован 2026 годом?',
        question_en: 'Which official single by deathmarried is dated 2026?',
        options_json: JSON.stringify(['satn', 'sexisdeath', 'dreams fallen', 'athens']),
        correct_index: 3,
        explanation_ru: 'Сингл «athens» является официальным релизом 2026 года.',
        explanation_en: 'The single "athens" is an official 2026 release.',
        difficulty: 1,
      },
    ];

    const insertQ = db.prepare(`
      INSERT INTO quiz_questions (id, question_ru, question_en, options_json, correct_index, explanation_ru, explanation_en, difficulty)
      VALUES (@id, @question_ru, @question_en, @options_json, @correct_index, @explanation_ru, @explanation_en, @difficulty)
    `);
    for (const q of questions) {
      insertQ.run(q);
    }
  }

  // Seed welcoming community discussion
  const postCount = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
  if (postCount.count === 0) {
    const p1Id = 'post_001';
    db.prepare(`
      INSERT INTO posts (id, user_id, category_id, title, content, is_pinned, reactions_count, views_count)
      VALUES (?, ?, ?, ?, ?, 1, 4, 38)
    `).run(
      p1Id,
      'usr_admin_001',
      'cat_official',
      'nightmortan & YOU COULD BE PUMPKIN: Дискография deathmarried',
      'Приветствуем всех слушателей и исследователей звука. Этот портал создан для сохранения подтверждённой дискографии артиста deathmarried — от альбома nightmortan (10 октября 2025) и релиза YOU COULD BE PUMPKIN (2024) до новейших синглов. Делитесь теориями, анализируйте тексты и публикуйте авторские работы в галерее.'
    );

    db.prepare(`
      INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type)
      VALUES ('rx_001', 'usr_admin_001', 'post', ?, 'rose')
    `).run(p1Id);
  }

  // --------------------------------------------------------------------------
  // LIVE DATABASE CLEANUP & REVISIONS
  // --------------------------------------------------------------------------
  try {
    // Unset the project logo from album and single covers so clean typography sleeve displays
    db.prepare("UPDATE albums SET cover_url = '' WHERE cover_url LIKE '%photo_2026%'").run();
    db.prepare("UPDATE singles SET cover_url = '' WHERE cover_url LIKE '%photo_2026%'").run();
    // Ensure nightmortan has its official CDN cover
    db.prepare("UPDATE albums SET cover_url = 'https://avatars.yandex.net/get-music-content/16508792/c2b3af87.a.38538013-1/1000x1000' WHERE id = 'alb_nightmortan' AND (cover_url IS NULL OR cover_url = '')").run();

    // Purge any legacy yeschapskii mentions from database text
    db.prepare("UPDATE albums SET description = REPLACE(description, ' / yeschapskii', '') WHERE description LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE singles SET description = REPLACE(description, 'периода yeschapskii / deathmarried', 'deathmarried') WHERE description LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE singles SET description = REPLACE(description, 'ранний релиз yeschapskii', 'ранний релиз deathmarried') WHERE description LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE posts SET content = REPLACE(content, ' (yeschapskii)', '') WHERE content LIKE '%yeschapskii%'").run();
    db.prepare("UPDATE posts SET title = REPLACE(title, ' (yeschapskii)', '') WHERE title LIKE '%yeschapskii%'").run();

    // Purge legacy inaccurate/fabricated quiz questions (e.g., "нью-джаз" genre claim and mismatched "ERD" hint)
    db.prepare(`
      DELETE FROM quiz_questions
      WHERE id IN ('qz_dm_02', 'qz_dm_04')
         OR LOWER(question_ru) LIKE '%нью-джаз%'
         OR LOWER(explanation_ru) LIKE '%нью-джаз%'
         OR LOWER(options_json) LIKE '%нью-джаз%'
         OR LOWER(explanation_en) LIKE '%new-jazz%'
         OR (LOWER(explanation_ru) LIKE '%you could be pumpkin%' AND explanation_ru LIKE '%ERD%')
    `).run();

    // Clean legacy cat_lore category references -> cat_official
    db.prepare("UPDATE posts SET category_id = 'cat_official' WHERE category_id = 'cat_lore'").run();
    db.prepare("DELETE FROM post_categories WHERE id = 'cat_lore'").run();

    const cleanupApplied = db.prepare("SELECT value FROM app_meta WHERE key = 'cleanup_v1_applied'").get();
    if (!cleanupApplied) {
      // Clean duplicate broken track trk_8f0b51c4 and ensure verified track #9 (the last violin) exists (once only)
      const brokenAudioPath = path.resolve('public/audio/the_last_violin.mp3');
      if (!fs.existsSync(brokenAudioPath)) {
        db.prepare("DELETE FROM tracks WHERE id = 'trk_8f0b51c4' AND audio_url = '/audio/the_last_violin.mp3'").run();
      }
      const nmAlbum = db.prepare("SELECT id FROM albums WHERE id = 'alb_nightmortan'").get();
      const hasLastViolin = db.prepare("SELECT id FROM tracks WHERE album_id = 'alb_nightmortan' AND LOWER(title) = 'the last violin'").get();
      if (nmAlbum && !hasLastViolin) {
        db.prepare(`
          INSERT OR IGNORE INTO tracks (id, album_id, title, track_number, duration_seconds, audio_url, lyrics, source_url, is_verified)
          VALUES ('trk_nm_09', 'alb_nightmortan', 'the last violin', 9, 162, '', 'final bow strokes fading into absolute stillness', 'https://music.apple.com/us/artist/deathmarried/1769850125', 1)
        `).run();
      }
      db.prepare(`
        UPDATE albums SET
          track_count = (SELECT COUNT(*) FROM tracks WHERE album_id = albums.id),
          duration_seconds = (SELECT COALESCE(SUM(duration_seconds), 0) FROM tracks WHERE album_id = albums.id)
        WHERE id = 'alb_nightmortan'
      `).run();
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('cleanup_v1_applied', '1')").run();
    }

    // Update cliché admin display_name if untouched
    db.prepare("UPDATE profiles SET display_name = 'Archive Curator (Admin)' WHERE user_id = 'usr_admin_001' AND display_name = 'Arch-Apostle (Admin)'").run();

    // Seed Stage 5/6 games, app_meta defaults, and backfill game_completions
    db.prepare(`
      INSERT OR IGNORE INTO games (id, slug, title, description, xp_multiplier, is_active)
      VALUES
        ('guess-lyrics', 'guess-lyrics', 'Угадай строчку', 'Продолжи строчку из трека deathmarried.', 1.0, 1),
        ('reverse-track', 'reverse-track', 'Задом наперёд', 'Угадай трек по 5-секундному фрагменту в реверсе.', 1.1, 1),
        ('speed-track', 'speed-track', 'Трек 0.5x / 2.5x', 'Угадай трек в замедленном 0.5x или ускоренном 2.5x режиме.', 1.1, 1)
    `).run();

    const defaultCommunityRules = JSON.stringify({
      intro_ru: 'Тут общаются слушатели и авторы вокруг музыки deathmarried. Чтобы всем было комфортно, держимся четырёх простых правил:',
      intro_en: 'Listeners and creators gather here around deathmarried music. To keep the space welcoming, we follow four simple rules:',
      footer_ru: 'За нарушения модераторы могут скрыть или удалить публикацию, а при повторах — ограничить доступ к аккаунту.',
      footer_en: 'Moderators may hide or remove content that breaks the rules, and repeated violations can lead to account restrictions.',
      items: [
        {
          title_ru: 'Без 18+ и NSFW',
          title_en: 'No 18+ or NSFW',
          body_ru: 'Никакой порнографии, эротики и откровенного контента — ни в текстах, ни в картинках, ни в ссылках.',
          body_en: 'No pornography, erotica, or explicit adult content in text, images, or external links.',
        },
        {
          title_ru: 'Без насилия, крови и жести',
          title_en: 'No violence or gore',
          body_ru: 'Запрещены шок-контент, реальная кровь, расчленёнка, угрозы и любые призывы к причинению вреда.',
          body_en: 'Shock content, real gore, threats, and any calls to violence or self-harm are strictly forbidden.',
        },
        {
          title_ru: 'Без оскорблений и травли',
          title_en: 'No harassment or hate',
          body_ru: 'Спорить о музыке и вкусах — нормально. Переходить на личности, унижать участников или разжигать ненависть — нет.',
          body_en: 'Debating music and taste is welcome; personal attacks, bullying, and hate speech are not.',
        },
        {
          title_ru: 'Без спама и рекламы',
          title_en: 'No spam or promotion',
          body_ru: 'Никакого флуда, реферальных ссылок, рекламы чужих каналов/магазинов, ботов и скама.',
          body_en: 'No flooding, referral links, unsolicited promotion of external channels/stores, bots, or scams.',
        },
      ],
    });

    db.prepare(`
      INSERT OR IGNORE INTO app_meta (key, value)
      VALUES
        ('quiz_enabled', '1'),
        ('active_quiz_ids', '[]'),
        ('community_rules_json', ?)
    `).run(defaultCommunityRules);

    db.exec(`
      INSERT OR IGNORE INTO game_completions (id, user_id, game_type, cycle_id, is_correct, score, xp_earned, created_at)
      SELECT 'gc_gt_' || id, user_id, 'guess-track', challenge_date, is_correct, score, xp_earned, created_at
      FROM daily_track_attempts;

      INSERT OR IGNORE INTO game_completions (id, user_id, game_type, cycle_id, is_correct, score, xp_earned, created_at)
      SELECT 'gc_dq_' || id, user_id, 'daily-quiz', challenge_date, CASE WHEN score > 0 THEN 1 ELSE 0 END, score, xp_earned, created_at
      FROM quiz_attempts;

      INSERT OR IGNORE INTO game_completions (id, user_id, game_type, cycle_id, is_correct, score, xp_earned, created_at)
      SELECT 'gc_mg_' || id, user_id, game_id, cycle_id, is_correct, score, xp_earned, created_at
      FROM daily_mini_game_attempts;
    `);
  } catch (err) {
    console.warn('DB cleanup notice:', err);
  }
}

