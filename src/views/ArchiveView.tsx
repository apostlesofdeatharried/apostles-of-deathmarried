import React, { useState, useEffect } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { usePlayer } from '../context/PlayerContext.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { Album, Single, Track, StreamingLinks } from '../types/index.js';
import { formatDuration, safeJson } from '../utils/logic.js';
import { CoverArt } from '../components/CoverArt.js';
import { ReleaseComments } from '../components/ReleaseComments.js';
import { ShareCardModal } from '../components/ShareCardModal.js';
import type { ShareCardContext } from '../utils/shareCardGenerator.js';
import {
  Play,
  Disc,
  Music,
  ChevronLeft,
  Plus,
  X,
  ExternalLink,
  Disc3,
  Search,
  Radio,
  Share2,
} from 'lucide-react';

export const StreamingBadges: React.FC<{ links?: StreamingLinks; compact?: boolean; titleLabel?: string }> = ({ links, compact, titleLabel }) => {
  if (!links) return null;

  const platforms = [
    { key: 'spotify', label: 'Spotify', url: links.spotify, color: 'hover:text-[#1db954] hover:border-[#1db954]/40' },
    { key: 'apple_music', label: 'Apple Music', url: links.apple_music, color: 'hover:text-[#fa586a] hover:border-[#fa586a]/40' },
    { key: 'yandex_music', label: 'Яндекс Музыка', url: links.yandex_music, color: 'hover:text-[#ffcc00] hover:border-[#ffcc00]/40' },
    { key: 'vk_music', label: 'VK Музыка', url: links.vk_music, color: 'hover:text-[#0077ff] hover:border-[#0077ff]/40' },
    { key: 'youtube_music', label: 'YouTube Music', url: links.youtube_music, color: 'hover:text-[#ff0000] hover:border-[#ff0000]/40' },
    { key: 'soundcloud', label: 'SoundCloud', url: links.soundcloud, color: 'hover:text-[#ff5500] hover:border-[#ff5500]/40' },
  ].filter((p) => Boolean(p.url));

  if (platforms.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        {platforms.map((p) => (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded border border-white/[0.08] bg-black/40 text-ash/80 transition-all flex items-center gap-1 ${p.color}`}
            title={`Open on ${p.label}`}
          >
            <span>{p.label}</span>
            <ExternalLink className="w-2 h-2" />
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 pt-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ash/60">
        {titleLabel || 'STREAMING PLATFORMS'}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {platforms.map((p) => (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border border-white/[0.1] bg-[#141318] text-bone transition-all ${p.color}`}
          >
            <span>{p.label}</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        ))}
      </div>
    </div>
  );
};

export const ArchiveView: React.FC = () => {
  const { t, lang } = useI18n();
  const { playTrack, currentTrack } = usePlayer();
  const { user } = useAuth();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [singles, setSingles] = useState<Single[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedSingle, setSelectedSingle] = useState<Single | null>(null);
  const [selectedLyricsTrack, setSelectedLyricsTrack] = useState<Track | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'albums' | 'eps' | 'singles'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // New Album modal state for admin
  const [newAlbumModal, setNewAlbumModal] = useState(false);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumYear, setNewAlbumYear] = useState('2025');
  const [newAlbumDate, setNewAlbumDate] = useState('');
  const [newAlbumFormat, setNewAlbumFormat] = useState<'album' | 'ep'>('album');
  const [newAlbumDesc, setNewAlbumDesc] = useState('');
  const [newAlbumSource, setNewAlbumSource] = useState('https://music.apple.com/us/artist/deathmarried/1769850125');
  const [newAlbumError, setNewAlbumError] = useState<string | null>(null);

  const [streamingToast, setStreamingToast] = useState<{
    title: string;
    links?: StreamingLinks;
  } | null>(null);

  // Interactive lyric quote selection (1-4 lines) & Share Card modal
  const [selectedLyricIndices, setSelectedLyricIndices] = useState<number[]>([]);
  const [shareContext, setShareContext] = useState<ShareCardContext | null>(null);

  const fetchArchive = async () => {
    try {
      const [resAlb, resSng] = await Promise.all([
        fetch('/api/archive/albums', { cache: 'no-store' }),
        fetch('/api/archive/singles', { cache: 'no-store' }),
      ]);
      const dataAlb = await safeJson(resAlb, { albums: [] });
      const dataSng = await safeJson(resSng, { singles: [] });
      setAlbums(dataAlb.albums || []);
      setSingles(dataSng.singles || []);
    } catch (e) {
      console.error('Failed to load archive', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchive();
  }, []);

  // Reset selected lyric lines whenever active lyrics target changes
  useEffect(() => {
    setSelectedLyricIndices([]);
  }, [selectedLyricsTrack?.id, selectedSingle?.id]);

  // Deep-link from URL query (?album=... / ?single=...) or notification click
  useEffect(() => {
    if (albums.length === 0 && singles.length === 0) return;

    const openTarget = (releaseType: string, releaseId: string) => {
      if (releaseType === 'album') {
        const found = albums.find((a) => a.id === releaseId);
        if (found) {
          setSelectedSingle(null);
          setSelectedAlbum(found);
        }
      } else if (releaseType === 'single') {
        const found = singles.find((s) => s.id === releaseId);
        if (found) {
          setSelectedSingle(found);
        }
      }
    };

    const params = new URLSearchParams(window.location.search);
    const qAlbum = params.get('album');
    const qSingle = params.get('single');
    if (qAlbum) openTarget('album', qAlbum);
    else if (qSingle) openTarget('single', qSingle);

    const handleOpenReleaseEvent = (e: CustomEvent<{ releaseType?: string; releaseId?: string }>) => {
      if (e.detail?.releaseType && e.detail?.releaseId) {
        openTarget(e.detail.releaseType, e.detail.releaseId);
      }
    };
    window.addEventListener('open-archive-release', handleOpenReleaseEvent as EventListener);
    return () => {
      window.removeEventListener('open-archive-release', handleOpenReleaseEvent as EventListener);
    };
  }, [albums, singles]);

  const toggleLyricLine = (idx: number) => {
    setSelectedLyricIndices((prev) => {
      if (prev.includes(idx)) return prev.filter((n) => n !== idx);
      if (prev.length >= 4) return prev;
      return [...prev, idx].sort((a, b) => a - b);
    });
  };

  const renderInteractiveLyrics = (
    rawLyrics: string,
    meta: {
      trackTitle: string;
      releaseTitle?: string;
      coverUrl?: string | null;
      shareUrl: string;
      compact?: boolean;
    }
  ) => {
    const lines = rawLyrics.split(/\r?\n/);
    const selectedTexts = selectedLyricIndices
      .map((i) => (lines[i] || '').trim())
      .filter((s) => s.length > 0);

    const handleShareQuote = () => {
      const picked =
        selectedTexts.length > 0
          ? selectedTexts
          : lines
              .map((l) => l.trim())
              .filter((l) => l.length > 0 && !l.startsWith('['))
              .slice(0, 2);
      if (picked.length === 0) return;
      setShareContext({
        type: 'lyrics',
        trackTitle: meta.trackTitle,
        releaseTitle: meta.releaseTitle,
        coverUrl: meta.coverUrl,
        lines: picked,
        shareUrl: meta.shareUrl,
      });
    };

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06] font-mono text-[10px] text-[#8e877e]">
          <span>
            {selectedTexts.length > 0
              ? `Выбрано строк: ${selectedTexts.length}/4`
              : 'Нажмите на 1–4 любимые строчки для карточки'}
          </span>
          <div className="flex items-center gap-2">
            {selectedTexts.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedLyricIndices([])}
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                Сбросить
              </button>
            )}
            <button
              type="button"
              onClick={handleShareQuote}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-[#f2eee9] transition-colors cursor-pointer"
            >
              <Share2 className="w-3 h-3" />
              <span>Поделиться строчкой</span>
            </button>
          </div>
        </div>

        <div
          className={`${
            meta.compact ? 'max-h-52 text-xs text-left p-2.5 bg-black/40 rounded border border-white/[0.04]' : 'text-sm sm:text-base text-center'
          } overflow-y-auto space-y-1 font-sans`}
        >
          {lines.map((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed) {
              return <div key={idx} className="h-2.5" />;
            }
            const isSectionHeader = trimmed.startsWith('[') && trimmed.endsWith(']');
            if (isSectionHeader) {
              return (
                <div
                  key={idx}
                  className="font-mono text-[10px] uppercase tracking-widest text-[#736c64] pt-2 pb-0.5 select-none"
                >
                  {trimmed}
                </div>
              );
            }
            const isSelected = selectedLyricIndices.includes(idx);
            const limitReached = !isSelected && selectedLyricIndices.length >= 4;
            return (
              <button
                key={idx}
                type="button"
                disabled={limitReached}
                onClick={() => toggleLyricLine(idx)}
                className={`block w-full px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  meta.compact ? 'text-left' : 'text-center'
                } ${
                  isSelected
                    ? 'bg-[#821c2c]/30 border border-[#c96075]/60 text-white font-medium'
                    : limitReached
                      ? 'text-bone/45 cursor-not-allowed'
                      : 'text-bone/85 hover:bg-white/[0.05] hover:text-white border border-transparent'
                }`}
              >
                {line}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (shareContext) setShareContext(null);
      else if (streamingToast) setStreamingToast(null);
      else if (selectedLyricsTrack) setSelectedLyricsTrack(null);
      else if (selectedSingle) setSelectedSingle(null);
      else if (newAlbumModal) setNewAlbumModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shareContext, streamingToast, selectedLyricsTrack, selectedSingle, newAlbumModal]);

  const handlePlayAlbum = (album: Album) => {
    if (!album.tracks || album.tracks.length === 0) return;
    const playable = album.tracks.filter((t) => t.has_local_audio || (t.audio_url && t.audio_url.trim().length > 0));
    if (playable.length === 0) {
      setStreamingToast({
        title: album.title,
        links: album.streaming_links,
      });
      return;
    }
    const formattedTracks = playable.map((trk) => ({
      ...trk,
      album_title: album.title,
      cover_url: album.cover_url,
    }));
    playTrack(formattedTracks[0], formattedTracks);
  };

  const handlePlayTrack = (track: Track, album?: Album) => {
    const hasAudio = track.has_local_audio || (track.audio_url && track.audio_url.trim().length > 0);
    if (!hasAudio) {
      setStreamingToast({
        title: track.title,
        links: album?.streaming_links,
      });
      return;
    }
    playTrack({
      ...track,
      album_title: album ? album.title : 'deathmarried',
      cover_url: album ? album.cover_url : undefined,
    });
  };

  const handlePlaySingle = (single: Single) => {
    const hasAudio = single.has_local_audio || (single.audio_url && single.audio_url.trim().length > 0);
    if (!hasAudio) {
      setStreamingToast({
        title: single.title,
        links: single.streaming_links,
      });
      return;
    }
    playTrack({
      id: single.id,
      title: single.title,
      duration_seconds: single.duration_seconds,
      audio_url: single.audio_url,
      album_title: 'Single',
      cover_url: single.cover_url,
      lyrics: single.lyrics,
      has_local_audio: true,
    });
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlbumTitle.trim()) return;
    setNewAlbumError(null);
    try {
      const yr = parseInt(newAlbumYear, 10) || new Date().getFullYear();
      const res = await authFetch('/api/archive/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newAlbumTitle.trim(),
          release_year: yr,
          release_date: newAlbumDate.trim() || `${yr}-01-01`,
          format_type: newAlbumFormat,
          description: newAlbumDesc.trim(),
          source_url: newAlbumSource.trim(),
        }),
      });
      const data = await safeJson(res, {});
      if (res.ok) {
        setNewAlbumModal(false);
        setNewAlbumTitle('');
        setNewAlbumDate('');
        setNewAlbumDesc('');
        fetchArchive();
      } else {
        setNewAlbumError(data.error || 'Failed to create release');
      }
    } catch (e: any) {
      setNewAlbumError(e.message || 'Connection error');
    }
  };

  const isAdminOrMod = user?.role_id === 'admin' || user?.role_id === 'moderator';

  const studioAlbums = albums.filter((a) => a.format_type === 'album' || !a.format_type);
  const eps = albums.filter((a) => a.format_type === 'ep');

  const q = searchQuery.toLowerCase().trim();
  const filteredStudioAlbums = studioAlbums.filter(
    (a) => !q || a.title.toLowerCase().includes(q) || a.tracks?.some((t) => t.title.toLowerCase().includes(q))
  );
  const filteredEps = eps.filter(
    (a) => !q || a.title.toLowerCase().includes(q) || a.tracks?.some((t) => t.title.toLowerCase().includes(q))
  );
  const filteredSingles = singles.filter((s) => !q || s.title.toLowerCase().includes(q));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="max-w-2xl mx-auto text-center space-y-3">
        <h1 className="font-title text-3xl sm:text-5xl tracking-wide text-ivory font-light uppercase">
          {t('archiveTitle')}
        </h1>
        <p className="font-sans text-sm sm:text-base text-ash/90 leading-relaxed font-normal">
          {t('archiveSubtitle')}
        </p>
      </div>

      {/* SELECTED ALBUM VIEW */}
      {selectedAlbum ? (
        <div className="space-y-8 animate-fadeIn">
          <button
            onClick={() => setSelectedAlbum(null)}
            className="flex items-center gap-2 font-mono text-[11px] tracking-wider uppercase text-ash hover:text-ivory transition-colors py-1.5 px-3 rounded border border-white/[0.08] bg-[#100f13] cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t('backToDiscography')}
          </button>

          {/* Album Overview Hero */}
          <div className="flex flex-col md:flex-row items-center md:items-start gap-8 bg-[#100f13] border border-white/[0.08] p-6 sm:p-8 rounded-lg shadow-2xl">
            <CoverArt
              title={selectedAlbum.title}
              coverUrl={selectedAlbum.cover_url}
              format={selectedAlbum.format_type === 'ep' ? 'EP' : 'LP'}
              year={selectedAlbum.release_year}
              className="w-56 h-56 sm:w-64 sm:h-64 rounded shrink-0 shadow-2xl aspect-square"
            />
            <div className="flex-1 text-center md:text-left space-y-4">
              <div className="flex items-center justify-center md:justify-start gap-2 text-[10px] font-mono tracking-[0.2em] text-ash/70 uppercase">
                <span>{selectedAlbum.format_type === 'ep' ? 'EP' : 'STUDIO ALBUM'}</span>
                <span>·</span>
                <span>{selectedAlbum.release_date || selectedAlbum.release_year}</span>
              </div>

              <h2 className="font-title text-3xl sm:text-5xl text-ivory font-light uppercase tracking-wider">
                {selectedAlbum.title}
              </h2>

              <p className="font-sans text-sm sm:text-base text-bone/90 leading-relaxed max-w-2xl font-normal">
                {selectedAlbum.description}
              </p>

              {selectedAlbum.verified_source && (
                <div className="font-mono text-[10px] text-ash/70 space-y-0.5 border-l-2 border-white/[0.1] pl-3 text-left">
                  <div>
                    <span className="text-ash uppercase">{t('verifiedSource')}:</span> {selectedAlbum.verified_source}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 font-mono text-[11px] text-ash/70 pt-1">
                <span>{selectedAlbum.tracks?.length || 0} {t('tracksCount')}</span>
                <span>·</span>
                <span>{formatDuration(selectedAlbum.duration_seconds)}</span>
                {selectedAlbum.source_url && (
                  <>
                    <span>·</span>
                    <a
                      href={selectedAlbum.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-bone hover:text-white flex items-center gap-1 hover:underline font-mono text-[10px]"
                    >
                      <span>{t('officialSourceBtn')}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>

              <StreamingBadges links={selectedAlbum.streaming_links} titleLabel={t('streamingPlatforms')} />

              <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                <button
                  onClick={() => handlePlayAlbum(selectedAlbum)}
                  className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase px-6 py-2.5 bg-white/[0.08] hover:bg-white/[0.14] text-ivory border border-white/[0.16] rounded transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {t('playAll')}
                </button>
              </div>
            </div>
          </div>

          {/* Tracklist Table */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-lg p-5 sm:p-7">
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.06] mb-4">
              <h3 className="font-mono text-xs tracking-[0.2em] uppercase text-bone font-semibold flex items-center gap-2">
                <Disc className="w-4 h-4 text-ash" />
                {t('tracklist')}
              </h3>
              <span className="font-mono text-[10px] text-ash">
                {selectedAlbum.tracks?.length || 0} {t('tracksCount').toUpperCase()}
              </span>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {selectedAlbum.tracks && selectedAlbum.tracks.length > 0 ? (
                selectedAlbum.tracks.map((trk, idx) => {
                  const isCur = currentTrack?.id === trk.id;
                  const hasAudio = trk.has_local_audio || Boolean(trk.audio_url && trk.audio_url.trim().length > 0);

                  return (
                    <div
                      key={trk.id}
                      className={`py-3.5 px-3 flex items-center justify-between gap-4 transition-colors rounded ${
                        isCur ? 'bg-white/[0.06]' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <span className="font-mono text-xs text-ash/60 w-5 text-right shrink-0">
                          {trk.track_number || idx + 1}
                        </span>

                        <button
                          onClick={() => handlePlayTrack(trk, selectedAlbum)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all cursor-pointer shrink-0 ${
                            isCur
                              ? 'bg-bone text-black border-bone'
                              : hasAudio
                              ? 'border-white/20 text-bone hover:border-white/50 hover:bg-white/10'
                              : 'border-white/10 text-ash/60 hover:border-white/30 hover:text-bone'
                          }`}
                          title={hasAudio ? t('playTrack') : t('streamTrack')}
                        >
                          {hasAudio ? (
                            <Play className="w-3 h-3 fill-current ml-0.5" />
                          ) : (
                            <Radio className="w-3 h-3" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium truncate ${isCur ? 'text-white' : 'text-bone'}`}>
                              {trk.title}
                            </span>
                            {!hasAudio && (
                              <span className="font-mono text-[9px] uppercase px-1.5 py-0.2 rounded border border-white/10 text-ash/60 shrink-0">
                                {t('playerStreamOnly')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {trk.lyrics && (
                          <button
                            onClick={() => setSelectedLyricsTrack(trk)}
                            className="font-mono text-[10px] uppercase text-ash hover:text-white px-2 py-1 rounded border border-white/[0.08] hover:border-white/20 transition-colors cursor-pointer"
                          >
                            {t('viewLyrics')}
                          </button>
                        )}
                        <span className="font-mono text-xs text-ash/70">
                          {formatDuration(trk.duration_seconds)}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 font-mono text-xs text-ash/60">
                  {t('noReleasesFound')}
                </div>
              )}
            </div>
          </div>

          {/* Album Comments Section */}
          <ReleaseComments releaseType="album" releaseId={selectedAlbum.id} />
        </div>
      ) : (
        /* MAIN ARCHIVE GRID */
        <div className="space-y-12">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
              {[
                { id: 'all', label: lang === 'ru' ? 'Все релизы' : 'All Releases' },
                { id: 'albums', label: t('studioAlbums') },
                { id: 'eps', label: t('epsSection') },
                { id: 'singles', label: t('singlesSection') },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterType(tab.id as any)}
                  className={`font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded transition-all cursor-pointer ${
                    filterType === tab.id
                      ? 'bg-white/[0.12] text-white border border-white/20 font-semibold'
                      : 'text-ash hover:text-white border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ash/60" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('searchArchive')}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#121116] border border-white/[0.08] rounded text-xs text-bone placeholder-ash/50 focus:outline-none focus:border-white/20 font-sans"
                />
              </div>

              {isAdminOrMod && (
                <button
                  onClick={() => {
                    setNewAlbumError(null);
                    setNewAlbumModal(true);
                  }}
                  className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase px-3 py-1.5 rounded border border-white/[0.12] hover:border-white/30 text-bone hover:text-white transition-colors shrink-0 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{t('newReleaseBtn')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Section: Studio Albums */}
          {(filterType === 'all' || filterType === 'albums') && filteredStudioAlbums.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
                <Disc3 className="w-4 h-4 text-ash" />
                <h2 className="font-title text-xl tracking-wider uppercase text-ivory font-light">
                  {t('studioAlbums')}
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
                {filteredStudioAlbums.map((album) => (
                  <div
                    key={album.id}
                    onClick={() => setSelectedAlbum(album)}
                    className="group bg-[#100f13] border border-white/[0.06] hover:border-white/20 rounded-lg overflow-hidden transition-all duration-300 shadow-xl cursor-pointer flex flex-col"
                  >
                    <div className="relative aspect-square overflow-hidden bg-black">
                      <CoverArt
                        title={album.title}
                        coverUrl={album.cover_url}
                        format="LP"
                        year={album.release_year}
                        hideBottomMeta
                        className="w-full h-full aspect-square"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-60 pointer-events-none" />
                      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] tracking-wider text-bone bg-black/80 px-2 py-0.5 rounded border border-white/[0.1] min-w-0 truncate">
                          LP · {album.release_date || album.release_year}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAlbum(album);
                          }}
                          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-105 cursor-pointer shrink-0"
                          aria-label={`Play ${album.title}`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div>
                        <h3 className="font-title text-xl tracking-wider text-ivory font-light group-hover:text-white transition-colors truncate uppercase">
                          {album.title}
                        </h3>
                        <p className="font-sans text-xs text-ash/80 line-clamp-2 mt-1 leading-relaxed">
                          {album.description}
                        </p>
                      </div>

                      <StreamingBadges links={album.streaming_links} compact />

                      <div className="flex items-center justify-between font-mono text-[10px] text-ash/60 pt-2 border-t border-white/[0.04]">
                        <span>{album.track_count || album.tracks?.length || 0} {t('tracksCount')}</span>
                        <span>{formatDuration(album.duration_seconds)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: EPs & Mini-Albums */}
          {(filterType === 'all' || filterType === 'eps') && filteredEps.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
                <Disc className="w-4 h-4 text-ash" />
                <h2 className="font-title text-xl tracking-wider uppercase text-ivory font-light">
                  {t('epsSection')}
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7">
                {filteredEps.map((ep) => (
                  <div
                    key={ep.id}
                    onClick={() => setSelectedAlbum(ep)}
                    className="group bg-[#100f13] border border-white/[0.06] hover:border-white/20 rounded-lg overflow-hidden transition-all duration-300 shadow-xl cursor-pointer flex flex-col"
                  >
                    <div className="relative aspect-square overflow-hidden bg-black">
                      <CoverArt
                        title={ep.title}
                        coverUrl={ep.cover_url}
                        format="EP"
                        year={ep.release_year}
                        hideBottomMeta
                        className="w-full h-full aspect-square"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-60 pointer-events-none" />
                      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] tracking-wider text-bone bg-black/80 px-2 py-0.5 rounded border border-white/[0.1] min-w-0 truncate">
                          EP · {ep.release_year}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAlbum(ep);
                          }}
                          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-sm transition-transform hover:scale-105 cursor-pointer shrink-0"
                          aria-label={`Play ${ep.title}`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div>
                        <h3 className="font-title text-xl tracking-wider text-ivory font-light group-hover:text-white transition-colors truncate uppercase">
                          {ep.title}
                        </h3>
                        <p className="font-sans text-xs text-ash/80 line-clamp-2 mt-1 leading-relaxed">
                          {ep.description}
                        </p>
                      </div>

                      <StreamingBadges links={ep.streaming_links} compact />

                      <div className="flex items-center justify-between font-mono text-[10px] text-ash/60 pt-2 border-t border-white/[0.04]">
                        <span>{ep.track_count || ep.tracks?.length || 0} {t('tracksCount')}</span>
                        <span>{formatDuration(ep.duration_seconds)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: Singles (Interactive Grid) */}
          {(filterType === 'all' || filterType === 'singles') && filteredSingles.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
                <Music className="w-4 h-4 text-ash" />
                <h2 className="font-title text-xl tracking-wider uppercase text-ivory font-light">
                  {t('singlesSection')} ({filteredSingles.length})
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSingles.map((single) => {
                  const hasAudio = single.has_local_audio || Boolean(single.audio_url && single.audio_url.trim().length > 0);
                  const isCur = currentTrack?.id === single.id;

                  return (
                    <div
                      key={single.id}
                      onClick={() => setSelectedSingle(single)}
                      className="bg-[#100f13] border border-white/[0.06] hover:border-white/20 rounded-lg p-3.5 transition-all group flex flex-col justify-between gap-3 cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <CoverArt
                          title={single.title}
                          coverUrl={single.cover_url}
                          format="SINGLE"
                          year={single.release_year}
                          className="w-16 h-16 rounded overflow-hidden shrink-0 aspect-square"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[9px] uppercase tracking-wider text-ash/70">
                              SINGLE · {single.release_year}
                            </span>
                            {hasAudio && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlaySingle(single);
                                }}
                                className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                                  isCur ? 'bg-bone text-black border-bone' : 'border-white/20 text-bone hover:bg-white/10'
                                }`}
                                title={t('playTrack')}
                              >
                                <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                              </button>
                            )}
                          </div>
                          <div className="font-title text-base text-ivory tracking-wider truncate group-hover:text-white uppercase transition-colors">
                            {single.title}
                          </div>
                          <div className="font-sans text-[11px] text-ash/70 line-clamp-1 leading-normal">
                            {single.description || (lang === 'ru' ? 'Официальный сингл deathmarried' : 'deathmarried official single')}
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/[0.04]">
                        <StreamingBadges links={single.streaming_links} compact />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SELECTED SINGLE DETAIL MODAL */}
      {selectedSingle && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label={selectedSingle.title}
        >
          <div className="relative w-full max-w-lg bg-[#100f13] border border-white/[0.12] rounded-lg p-6 sm:p-8 max-h-[90vh] overflow-y-auto space-y-6 shadow-2xl">
            <button
              onClick={() => setSelectedSingle(null)}
              className="absolute top-4 right-4 text-ash hover:text-white cursor-pointer p-1"
              aria-label={t('closeBtn')}
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-3">
              <CoverArt
                title={selectedSingle.title}
                coverUrl={selectedSingle.cover_url}
                format="SINGLE"
                year={selectedSingle.release_year}
                className="w-48 h-48 sm:w-56 sm:h-56 rounded mx-auto shadow-2xl aspect-square"
              />

              <div className="space-y-1 pt-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-ash/70">
                  deathmarried · SINGLE · {selectedSingle.release_date || selectedSingle.release_year}
                </span>
                <h3 className="font-title text-2xl sm:text-3xl text-ivory font-light uppercase tracking-wider">
                  {selectedSingle.title}
                </h3>
              </div>

              {selectedSingle.description && (
                <p className="font-sans text-xs sm:text-sm text-bone/90 leading-relaxed max-w-md mx-auto">
                  {selectedSingle.description}
                </p>
              )}

              {/* Playback action */}
              <div className="pt-2 flex justify-center">
                {selectedSingle.has_local_audio || (selectedSingle.audio_url && selectedSingle.audio_url.trim().length > 0) ? (
                  <button
                    onClick={() => handlePlaySingle(selectedSingle)}
                    className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest px-6 py-2.5 rounded bg-white/[0.1] hover:bg-white/[0.18] text-white border border-white/20 transition-all cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{t('playTrack')}</span>
                  </button>
                ) : (
                  <div className="text-center space-y-1">
                    <span className="font-mono text-[10px] uppercase text-ash/60">
                      {t('noAudioNotice')}
                    </span>
                  </div>
                )}
              </div>

              {/* Streaming Links */}
              <div className="pt-3 border-t border-white/[0.06]">
                <StreamingBadges links={selectedSingle.streaming_links} titleLabel={t('streamingPlatforms')} />
              </div>

              {/* Lyrics if available (interactive line selection for quote card) */}
              {selectedSingle.lyrics && (
                <div className="pt-4 border-t border-white/[0.06] text-left space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ash/70">
                    {t('lyricsFor')}
                  </div>
                  {renderInteractiveLyrics(selectedSingle.lyrics, {
                    trackTitle: selectedSingle.title,
                    releaseTitle: `Сингл · ${selectedSingle.release_year}`,
                    coverUrl: selectedSingle.cover_url,
                    shareUrl: `${window.location.origin}/archive?single=${encodeURIComponent(selectedSingle.id)}`,
                    compact: true,
                  })}
                </div>
              )}

              {/* Compact Single Comments */}
              <div className="pt-3 border-t border-white/[0.06]">
                <ReleaseComments
                  releaseType="single"
                  releaseId={selectedSingle.id}
                  compact
                  defaultOpen={false}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lyrics Modal */}
      {selectedLyricsTrack && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label={selectedLyricsTrack.title}
        >
          <div className="relative w-full max-w-lg bg-[#100f13] border border-white/[0.1] rounded-lg p-6 sm:p-8 max-h-[85vh] overflow-y-auto space-y-6">
            <button
              onClick={() => setSelectedLyricsTrack(null)}
              className="absolute top-4 right-4 text-ash hover:text-white cursor-pointer"
              aria-label={t('closeBtn')}
            >
              <X className="w-5 h-5" />
            </button>
            <div className="text-center space-y-1">
              <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-ash">
                {t('lyricsFor')}
              </span>
              <h3 className="font-title text-2xl uppercase text-ivory font-light tracking-wider">
                {selectedLyricsTrack.title}
              </h3>
              <div className="font-mono text-[10px] text-ash/60 uppercase">deathmarried</div>
            </div>
            <div className="border-t border-white/[0.06] pt-5">
              {selectedLyricsTrack.lyrics ? (
                renderInteractiveLyrics(selectedLyricsTrack.lyrics, {
                  trackTitle: selectedLyricsTrack.title,
                  releaseTitle: selectedAlbum?.title || 'deathmarried',
                  coverUrl: selectedAlbum?.cover_url || null,
                  shareUrl: selectedAlbum
                    ? `${window.location.origin}/archive?album=${encodeURIComponent(selectedAlbum.id)}`
                    : `${window.location.origin}/archive`,
                })
              ) : (
                <div className="font-sans text-sm text-bone/70 text-center py-4">
                  {t('noLyrics')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Add Album Modal */}
      {newAlbumModal && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label={t('newAlbumBtn')}
        >
          <div className="relative w-full max-w-md bg-[#100f13] border border-white/[0.1] rounded-lg p-6 space-y-4">
            <button
              onClick={() => setNewAlbumModal(false)}
              className="absolute top-4 right-4 text-ash hover:text-white cursor-pointer"
              aria-label={t('closeBtn')}
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-title text-xl tracking-wider uppercase text-white font-light">
              {t('newAlbumBtn')}
            </h3>
            {newAlbumError && (
              <div className="p-2.5 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c]">
                {newAlbumError}
              </div>
            )}
            <form onSubmit={handleCreateAlbum} className="space-y-4 font-mono text-xs">
              <div>
                <label className="block text-ash mb-1">{t('workTitle')}</label>
                <input
                  type="text"
                  required
                  value={newAlbumTitle}
                  onChange={(e) => setNewAlbumTitle(e.target.value)}
                  placeholder="nightmortan"
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.08] rounded text-white focus:outline-none focus:border-white/30 font-sans"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-ash mb-1">{lang === 'ru' ? 'Формат' : 'Format'}</label>
                  <select
                    value={newAlbumFormat}
                    onChange={(e) => setNewAlbumFormat(e.target.value as any)}
                    className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.08] rounded text-white focus:outline-none"
                  >
                    <option value="album">{lang === 'ru' ? 'Студийный альбом' : 'Studio Album'}</option>
                    <option value="ep">EP / Mini-Album</option>
                  </select>
                </div>
                <div>
                  <label className="block text-ash mb-1">{t('year')}</label>
                  <input
                    type="number"
                    value={newAlbumYear}
                    onChange={(e) => setNewAlbumYear(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.08] rounded text-white focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-ash mb-1">{t('releaseDate')}</label>
                <input
                  type="text"
                  value={newAlbumDate}
                  onChange={(e) => setNewAlbumDate(e.target.value)}
                  placeholder="2025-10-10"
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.08] rounded text-white focus:outline-none focus:border-white/30 font-sans"
                />
              </div>
              <div>
                <label className="block text-ash mb-1">{t('officialSourceBtn')}</label>
                <input
                  type="text"
                  value={newAlbumSource}
                  onChange={(e) => setNewAlbumSource(e.target.value)}
                  placeholder="https://music.apple.com/..."
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.08] rounded text-white focus:outline-none focus:border-white/30 font-sans"
                />
              </div>
              <div>
                <label className="block text-ash mb-1">{t('workDescription')}</label>
                <textarea
                  rows={3}
                  value={newAlbumDesc}
                  onChange={(e) => setNewAlbumDesc(e.target.value)}
                  placeholder={lang === 'ru' ? 'История и звучание релиза...' : 'Release background and sonic characteristics...'}
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.08] rounded text-white focus:outline-none focus:border-white/30 font-sans"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 font-mono text-xs tracking-wider uppercase bg-white/[0.1] hover:bg-white/[0.2] text-white rounded transition-colors cursor-pointer"
              >
                {t('saveBtn')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Streaming Platform Notice Modal */}
      {streamingToast && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label={streamingToast.title}
        >
          <div className="bg-[#121116] border border-white/[0.12] rounded-lg max-w-md w-full p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setStreamingToast(null)}
              className="absolute top-4 right-4 text-ash hover:text-white p-1 cursor-pointer"
              aria-label={t('closeBtn')}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ash/70">
                {t('streamNoticeHeader')}
              </span>
              <h3 className="font-title text-xl text-ivory font-light uppercase tracking-wider">
                {streamingToast.title}
              </h3>
            </div>

            <p className="font-sans text-xs text-bone/80 leading-relaxed">
              {t('noAudioNotice')}
            </p>

            <div className="pt-2">
              <StreamingBadges links={streamingToast.links} titleLabel={t('streamingPlatforms')} />
            </div>

            <div className="pt-3 flex justify-end">
              <button
                onClick={() => setStreamingToast(null)}
                className="font-mono text-xs uppercase tracking-wider px-4 py-2 rounded bg-white/[0.08] hover:bg-white/[0.14] text-bone cursor-pointer"
              >
                {t('closeBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viral Quote Share Card Modal */}
      <ShareCardModal
        isOpen={shareContext !== null}
        context={shareContext}
        onClose={() => setShareContext(null)}
      />
    </div>
  );
};
