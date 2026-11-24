import { RawQuizQuestion, deterministicShuffle } from './dailyGames.js';

export interface DiscographyAlbum {
  id: string;
  title: string;
  release_year: number;
  release_date?: string | null;
  format_type?: string | null;
  track_count?: number;
}

export interface DiscographyTrack {
  id: string;
  album_id: string;
  title: string;
  track_number: number;
  duration_seconds: number;
  lyrics?: string | null;
}

export interface DiscographySingle {
  id: string;
  title: string;
  release_year: number;
  release_date?: string | null;
  duration_seconds?: number;
}

const PLACEHOLDER_LYRICS_PATTERNS = [
  /^track from\b/i,
  /^archived canon track/i,
  /^official single/i,
  /^no lyrics/i,
  /^instrumental$/i,
];

function formatDurationMmSs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function isRealLyricLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 18 || trimmed.length > 110) return false;
  if (PLACEHOLDER_LYRICS_PATTERNS.some((re) => re.test(trimmed))) return false;
  // Must have at least 3 words to be a meaningful lyric clue
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function pickUniqueDistractors(
  correctValue: string,
  candidates: string[],
  count: number,
  seed: string,
  secret: string
): string[] {
  const seen = new Set<string>([correctValue.trim().toLowerCase()]);
  const unique: string[] = [];
  for (const c of candidates) {
    const clean = c.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(clean);
  }
  return deterministicShuffle(unique, seed, secret).slice(0, count);
}

/**
 * Generates a large pool of challenging, 100% factual quiz questions strictly
 * derived from real discography rows in SQLite (albums, tracks, singles, real lyrics).
 * NEVER invents biography claims, genres, or unverified facts.
 */
export function generateDiscographyQuizQuestions(params: {
  albums: DiscographyAlbum[];
  tracks: DiscographyTrack[];
  singles: DiscographySingle[];
  secret: string;
}): RawQuizQuestion[] {
  const { albums, tracks, singles, secret } = params;
  const generated: RawQuizQuestion[] = [];

  const sortedAlbums = [...albums]
    .filter((a) => a && a.id && a.title?.trim())
    .sort((a, b) => a.id.localeCompare(b.id));
  const albumById = new Map(sortedAlbums.map((a) => [a.id, a]));

  const sortedTracks = [...tracks]
    .filter((t) => t && t.id && t.title?.trim() && albumById.has(t.album_id))
    .sort((a, b) => a.album_id.localeCompare(b.album_id) || a.track_number - b.track_number || a.id.localeCompare(b.id));

  const sortedSingles = [...singles]
    .filter((s) => s && s.id && s.title?.trim())
    .sort((a, b) => a.id.localeCompare(b.id));

  const tracksByAlbum = new Map<string, DiscographyTrack[]>();
  for (const t of sortedTracks) {
    const list = tracksByAlbum.get(t.album_id) || [];
    list.push(t);
    tracksByAlbum.set(t.album_id, list);
  }

  const allTrackTitles = sortedTracks.map((t) => t.title.trim());
  const allSingleTitles = sortedSingles.map((s) => s.title.trim());
  const allAlbumTitles = sortedAlbums.map((a) => a.title.trim());
  const allReleaseTitles = [...allAlbumTitles, ...allSingleTitles];

  // 1. "Из какого альбома / EP трек X?" (uses albums + singles as distractors if < 4 albums)
  if (sortedAlbums.length >= 2) {
    const releaseDistractorPool = sortedAlbums.length >= 4 ? allAlbumTitles : allReleaseTitles;
    for (const trk of sortedTracks) {
      const alb = albumById.get(trk.album_id)!;
      const distractors = pickUniqueDistractors(
        alb.title,
        releaseDistractorPool,
        3,
        `gen:trk_album:${trk.id}`,
        secret
      );
      if (distractors.length < 3) continue;
      generated.push({
        id: `gen_trk_album_${trk.id}`,
        question_ru: `В какой релиз deathmarried входит композиция «${trk.title.trim()}»?`,
        question_en: `Which deathmarried release includes the track "${trk.title.trim()}"?`,
        options_json: JSON.stringify([alb.title.trim(), ...distractors]),
        correct_index: 0,
        explanation_ru: `Композиция «${trk.title.trim()}» входит в релиз «${alb.title.trim()}» (${alb.release_year}) под номером ${trk.track_number}.`,
        explanation_en: `"${trk.title.trim()}" appears as track #${trk.track_number} on "${alb.title.trim()}" (${alb.release_year}).`,
        difficulty: 2,
        is_active: 1,
      });
    }
  }

  // 2. Track order / sequence inside each album/EP
  for (const alb of sortedAlbums) {
    const albTracks = (tracksByAlbum.get(alb.id) || []).sort((a, b) => a.track_number - b.track_number);
    if (albTracks.length < 3) continue;

    // 2a. Opening track
    const opener = albTracks[0];
    const openerDistractors = pickUniqueDistractors(
      opener.title,
      albTracks.length >= 4 ? albTracks.map((t) => t.title) : allTrackTitles,
      3,
      `gen:opener:${alb.id}`,
      secret
    );
    if (openerDistractors.length === 3) {
      generated.push({
        id: `gen_alb_opener_${alb.id}`,
        question_ru: `Какой трек открывает релиз «${alb.title.trim()}»?`,
        question_en: `Which track opens the release "${alb.title.trim()}"?`,
        options_json: JSON.stringify([opener.title.trim(), ...openerDistractors]),
        correct_index: 0,
        explanation_ru: `Релиз «${alb.title.trim()}» открывается композицией «${opener.title.trim()}» (трек #${opener.track_number}).`,
        explanation_en: `"${alb.title.trim()}" opens with "${opener.title.trim()}" (track #${opener.track_number}).`,
        difficulty: 2,
        is_active: 1,
      });
    }

    // 2b. Closing track
    const closer = albTracks[albTracks.length - 1];
    const closerDistractors = pickUniqueDistractors(
      closer.title,
      albTracks.length >= 4 ? albTracks.map((t) => t.title) : allTrackTitles,
      3,
      `gen:closer:${alb.id}`,
      secret
    );
    if (closerDistractors.length === 3 && closer.id !== opener.id) {
      generated.push({
        id: `gen_alb_closer_${alb.id}`,
        question_ru: `Какая композиция завершает треклист релиза «${alb.title.trim()}»?`,
        question_en: `Which track closes the tracklist of "${alb.title.trim()}"?`,
        options_json: JSON.stringify([closer.title.trim(), ...closerDistractors]),
        correct_index: 0,
        explanation_ru: `Финальной композицией релиза «${alb.title.trim()}» является «${closer.title.trim()}» (трек #${closer.track_number}).`,
        explanation_en: `"${closer.title.trim()}" is the closing track (#${closer.track_number}) of "${alb.title.trim()}".`,
        difficulty: 2,
        is_active: 1,
      });
    }

    // 2c. Exact track count
    const exactCount = albTracks.length;
    const countChoices = Array.from(
      new Set([exactCount, Math.max(2, exactCount - 2), Math.max(2, exactCount - 1), exactCount + 1, exactCount + 2, exactCount + 3])
    )
      .filter((n) => n !== exactCount)
      .map((n) => `${n}`);
    const countDistractors = deterministicShuffle(countChoices, `gen:count:${alb.id}`, secret).slice(0, 3);
    if (countDistractors.length === 3) {
      generated.push({
        id: `gen_alb_count_${alb.id}`,
        question_ru: `Сколько композиций входит в релиз «${alb.title.trim()}»?`,
        question_en: `How many tracks are on the release "${alb.title.trim()}"?`,
        options_json: JSON.stringify([String(exactCount), ...countDistractors]),
        correct_index: 0,
        explanation_ru: `В релизе «${alb.title.trim()}» ровно ${exactCount} композиций.`,
        explanation_en: `"${alb.title.trim()}" contains exactly ${exactCount} tracks.`,
        difficulty: 2,
        is_active: 1,
      });
    }

    // 2d. "Which track comes immediately after X in album Y?" (Challenging!)
    for (let i = 0; i < albTracks.length - 1; i++) {
      const curr = albTracks[i];
      const next = albTracks[i + 1];
      const pool = albTracks
        .filter((t) => t.id !== curr.id && t.id !== next.id)
        .map((t) => t.title);
      const fallbackPool = pool.length >= 3 ? pool : [...pool, ...allTrackTitles.filter((title) => title !== curr.title)];
      const distractors = pickUniqueDistractors(next.title, fallbackPool, 3, `gen:next:${curr.id}`, secret);
      if (distractors.length < 3) continue;
      generated.push({
        id: `gen_trk_next_${curr.id}`,
        question_ru: `Какой трек следует сразу после «${curr.title.trim()}» в релизе «${alb.title.trim()}»?`,
        question_en: `Which track immediately follows "${curr.title.trim()}" on "${alb.title.trim()}"?`,
        options_json: JSON.stringify([next.title.trim(), ...distractors]),
        correct_index: 0,
        explanation_ru: `В релизе «${alb.title.trim()}» за треком #${curr.track_number} «${curr.title.trim()}» сразу идёт трек #${next.track_number} «${next.title.trim()}».`,
        explanation_en: `On "${alb.title.trim()}", track #${next.track_number} "${next.title.trim()}" immediately follows #${curr.track_number} "${curr.title.trim()}".`,
        difficulty: 3,
        is_active: 1,
      });
    }

    // 2e. Track number question for mid-album tracks
    for (const trk of albTracks) {
      if (albTracks.length < 4 || trk.track_number <= 1 || trk.track_number >= albTracks.length) continue;
      const numDistractors = albTracks
        .filter((other) => other.track_number !== trk.track_number)
        .map((other) => `#${other.track_number}`);
      const chosenNums = pickUniqueDistractors(`#${trk.track_number}`, numDistractors, 3, `gen:pos:${trk.id}`, secret);
      if (chosenNums.length < 3) continue;
      generated.push({
        id: `gen_trk_pos_${trk.id}`,
        question_ru: `Под каким порядковым номером идёт трек «${trk.title.trim()}» в релизе «${alb.title.trim()}»?`,
        question_en: `What track number is "${trk.title.trim()}" on "${alb.title.trim()}"?`,
        options_json: JSON.stringify([`#${trk.track_number}`, ...chosenNums]),
        correct_index: 0,
        explanation_ru: `Композиция «${trk.title.trim()}» занимает позицию #${trk.track_number} в треклисте «${alb.title.trim()}».`,
        explanation_en: `"${trk.title.trim()}" is track #${trk.track_number} on "${alb.title.trim()}".`,
        difficulty: 3,
        is_active: 1,
      });
    }

    // 2f. Longest & shortest track in album (only when strictly unique max/min)
    const timedTracks = albTracks.filter((t) => Number.isFinite(t.duration_seconds) && t.duration_seconds > 0);
    if (timedTracks.length >= 4) {
      const byDurDesc = [...timedTracks].sort((a, b) => b.duration_seconds - a.duration_seconds);
      if (byDurDesc[0].duration_seconds > byDurDesc[1].duration_seconds) {
        const longest = byDurDesc[0];
        const distractors = pickUniqueDistractors(
          longest.title,
          timedTracks.map((t) => t.title),
          3,
          `gen:longest:${alb.id}`,
          secret
        );
        if (distractors.length === 3) {
          generated.push({
            id: `gen_alb_longest_${alb.id}`,
            question_ru: `Какой трек является самым длинным по хронометражу в релизе «${alb.title.trim()}»?`,
            question_en: `Which track has the longest runtime on "${alb.title.trim()}"?`,
            options_json: JSON.stringify([longest.title.trim(), ...distractors]),
            correct_index: 0,
            explanation_ru: `Самый длинный трек в «${alb.title.trim()}» — «${longest.title.trim()}» (${formatDurationMmSs(longest.duration_seconds)}).`,
            explanation_en: `The longest track on "${alb.title.trim()}" is "${longest.title.trim()}" (${formatDurationMmSs(longest.duration_seconds)}).`,
            difficulty: 3,
            is_active: 1,
          });
        }
      }

      const byDurAsc = [...timedTracks].sort((a, b) => a.duration_seconds - b.duration_seconds);
      if (byDurAsc[0].duration_seconds < byDurAsc[1].duration_seconds) {
        const shortest = byDurAsc[0];
        const distractors = pickUniqueDistractors(
          shortest.title,
          timedTracks.map((t) => t.title),
          3,
          `gen:shortest:${alb.id}`,
          secret
        );
        if (distractors.length === 3) {
          generated.push({
            id: `gen_alb_shortest_${alb.id}`,
            question_ru: `Какой трек является самым коротким в релизе «${alb.title.trim()}»?`,
            question_en: `Which track is the shortest on "${alb.title.trim()}"?`,
            options_json: JSON.stringify([shortest.title.trim(), ...distractors]),
            correct_index: 0,
            explanation_ru: `Самый короткий трек в «${alb.title.trim()}» — «${shortest.title.trim()}» (${formatDurationMmSs(shortest.duration_seconds)}).`,
            explanation_en: `The shortest track on "${alb.title.trim()}" is "${shortest.title.trim()}" (${formatDurationMmSs(shortest.duration_seconds)}).`,
            difficulty: 3,
            is_active: 1,
          });
        }
      }
    }
  }

  // 3. Real lyrics questions (ONLY from verified non-placeholder lyrics lines in DB!)
  for (const trk of sortedTracks) {
    if (!trk.lyrics || typeof trk.lyrics !== 'string') continue;
    const rawLines = trk.lyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(isRealLyricLine);
    if (rawLines.length === 0) continue;

    // Avoid trivial lines that contain the track title verbatim
    const nonTrivialLines = rawLines.filter(
      (line) => !line.toLowerCase().includes(trk.title.trim().toLowerCase())
    );
    const chosenLine = nonTrivialLines[0] || rawLines[0];
    const alb = albumById.get(trk.album_id)!;
    const distractors = pickUniqueDistractors(
      trk.title,
      allTrackTitles,
      3,
      `gen:lyric:${trk.id}`,
      secret
    );
    if (distractors.length < 3) continue;

    generated.push({
      id: `gen_trk_lyric_${trk.id}`,
      question_ru: `Из какой композиции deathmarried взята строка: «${chosenLine}»?`,
      question_en: `Which deathmarried track features the line: "${chosenLine}"?`,
      options_json: JSON.stringify([trk.title.trim(), ...distractors]),
      correct_index: 0,
      explanation_ru: `Эта строка из трека «${trk.title.trim()}» (релиз «${alb.title.trim()}»).`,
      explanation_en: `This lyric comes from "${trk.title.trim()}" on "${alb.title.trim()}".`,
      difficulty: 3,
      is_active: 1,
    });
  }

  // 4. Singles release year & comparison questions (strictly from singles table)
  const yearsInDb = Array.from(
    new Set([
      ...sortedAlbums.map((a) => a.release_year),
      ...sortedSingles.map((s) => s.release_year),
    ].filter((y) => Number.isInteger(y) && y >= 2018 && y <= 2030))
  ).sort((a, b) => a - b);

  for (const sng of sortedSingles) {
    if (!Number.isInteger(sng.release_year)) continue;
    const candidateYears = Array.from(
      new Set([
        ...yearsInDb,
        sng.release_year - 2,
        sng.release_year - 1,
        sng.release_year + 1,
      ].filter((y) => y >= 2020 && y <= 2027 && y !== sng.release_year))
    ).map(String);

    const distractors = deterministicShuffle(candidateYears, `gen:sng_year:${sng.id}`, secret).slice(0, 3);
    if (distractors.length === 3) {
      generated.push({
        id: `gen_sng_year_${sng.id}`,
        question_ru: `В каком году вышел официальный сингл deathmarried «${sng.title.trim()}»?`,
        question_en: `In what year was the official deathmarried single "${sng.title.trim()}" released?`,
        options_json: JSON.stringify([String(sng.release_year), ...distractors]),
        correct_index: 0,
        explanation_ru: `Сингл «${sng.title.trim()}» датирован ${sng.release_year} годом${sng.release_date ? ` (${sng.release_date})` : ''}.`,
        explanation_en: `The single "${sng.title.trim()}" was released in ${sng.release_year}${sng.release_date ? ` (${sng.release_date})` : ''}.`,
        difficulty: 2,
        is_active: 1,
      });
    }
  }

  // 5. "Which release is a single (not an album track)?" / "Which single came out in year X?"
  for (const year of yearsInDb) {
    const singlesInYear = sortedSingles.filter((s) => s.release_year === year);
    const singlesOtherYears = sortedSingles.filter((s) => s.release_year !== year);
    if (singlesInYear.length >= 1 && singlesOtherYears.length >= 3) {
      const targetSingle = singlesInYear[0];
      const distractors = pickUniqueDistractors(
        targetSingle.title,
        singlesOtherYears.map((s) => s.title),
        3,
        `gen:year_single:${year}`,
        secret
      );
      if (distractors.length === 3) {
        generated.push({
          id: `gen_year_single_${year}`,
          question_ru: `Какой из перечисленных официальных синглов deathmarried вышел в ${year} году?`,
          question_en: `Which of these official deathmarried singles was released in ${year}?`,
          options_json: JSON.stringify([targetSingle.title.trim(), ...distractors]),
          correct_index: 0,
          explanation_ru: `Сингл «${targetSingle.title.trim()}» вышел в ${year} году.`,
          explanation_en: `"${targetSingle.title.trim()}" was released in ${year}.`,
          difficulty: 2,
          is_active: 1,
        });
      }
    }
  }

  // 6. Distinguish single vs album/EP track
  if (sortedSingles.length >= 3 && sortedTracks.length >= 3) {
    for (const alb of sortedAlbums) {
      const albTracks = tracksByAlbum.get(alb.id) || [];
      if (albTracks.length === 0) continue;
      const sampleTrack = albTracks[Math.floor(albTracks.length / 2)];
      const singleDistractors = pickUniqueDistractors(
        sampleTrack.title,
        allSingleTitles,
        3,
        `gen:not_single:${alb.id}`,
        secret
      );
      if (singleDistractors.length === 3) {
        generated.push({
          id: `gen_not_single_${alb.id}`,
          question_ru: `Какой из этих треков входит в релиз «${alb.title.trim()}», а не является отдельным синглом?`,
          question_en: `Which of these tracks belongs to "${alb.title.trim()}" rather than being a standalone single?`,
          options_json: JSON.stringify([sampleTrack.title.trim(), ...singleDistractors]),
          correct_index: 0,
          explanation_ru: `«${sampleTrack.title.trim()}» — композиция из релиза «${alb.title.trim()}» (трек #${sampleTrack.track_number}), остальные варианты — отдельные синглы.`,
          explanation_en: `"${sampleTrack.title.trim()}" is track #${sampleTrack.track_number} on "${alb.title.trim()}", while the others are standalone singles.`,
          difficulty: 2,
          is_active: 1,
        });
      }
    }
  }

  return generated;
}
