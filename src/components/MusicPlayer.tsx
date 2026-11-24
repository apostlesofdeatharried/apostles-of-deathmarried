import React from 'react';
import { usePlayer } from '../context/PlayerContext.js';
import { useI18n } from '../context/I18nContext.js';
import { formatDuration } from '../utils/logic.js';
import { CoverArt } from './CoverArt.js';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  X,
  ChevronDown,
  AlertCircle,
} from 'lucide-react';

export const MusicPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    isVisible,
    playbackError,
    progress,
    duration,
    volume,
    isMuted,
    shuffle,
    repeatMode,
    queue,
    queueOpen,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    setQueueOpen,
    removeFromQueue,
    clearPlaybackError,
    playTrack,
    hidePlayer,
  } = usePlayer();
  const { t, lang } = useI18n();

  if (!isVisible || !currentTrack) return null;

  return (
    <>
      {/* Slide-up Queue Panel */}
      {queueOpen && (
        <div className="fixed bottom-24 sm:bottom-20 left-3 right-3 sm:left-auto sm:right-8 z-40 w-auto sm:w-80 max-h-[60dvh] bg-[#100f13] border border-white/[0.1] rounded-lg shadow-2xl p-4 flex flex-col font-title">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] mb-2">
            <span className="font-title text-sm tracking-widest uppercase text-[#ded8ce] font-medium flex items-center gap-2">
              <ListMusic className="w-3.5 h-3.5 text-[#8c857b]" />
              {t('playerQueue')} ({queue.length})
            </span>
            <button
              onClick={() => setQueueOpen(false)}
              className="text-[#8c857b] hover:text-white cursor-pointer"
              aria-label="Close queue"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto space-y-1 flex-1 pr-1 font-title">
            {queue.map((track, idx) => {
              const isCurrent = track.id === currentTrack.id;
              return (
                <div
                  key={`${track.id}-${idx}`}
                  className={`flex items-center justify-between p-2 rounded text-sm transition-colors group ${
                    isCurrent ? 'bg-white/[0.06] text-white font-medium' : 'text-[#8c857b] hover:bg-white/[0.02]'
                  }`}
                >
                  <button
                    onClick={() => playTrack(track)}
                    className="flex items-center gap-2 text-left truncate flex-1 min-w-0 focus:outline-none cursor-pointer"
                  >
                    <span className="text-xs text-[#5c564e] w-4 shrink-0">{idx + 1}.</span>
                    <span className="truncate tracking-wide">{track.title}</span>
                  </button>
                  <button
                    onClick={() => removeFromQueue(idx)}
                    className="opacity-75 sm:opacity-0 sm:group-hover:opacity-100 text-[#706a62] hover:text-[#d9777f] p-1 transition-opacity cursor-pointer shrink-0"
                    aria-label={`Remove ${track.title} from queue`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Persistent Bottom Bar - Audio Player Console */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 bg-[#0c0b0e]/95 backdrop-blur-md border-t border-white/[0.08] text-[#ded8ce] px-2.5 sm:px-4 pt-2 pb-[calc(0.6rem+env(safe-area-inset-bottom))] transition-transform"
        role="region"
        aria-label="Audio Console"
      >
        <div className="max-w-7xl mx-auto flex flex-col gap-1.5">
          {playbackError && (
            <div className="flex items-center justify-between gap-2 px-3 py-1 rounded bg-[#2a1116] border border-[#721b2b]/60 text-[11px] text-[#f2b8c0] font-sans">
              <span className="flex items-center gap-1.5 truncate">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#e8909c]" />
                <span className="truncate">
                  {lang === 'ru'
                    ? 'Аудиофайл временно недоступен или не удалось загрузить трек.'
                    : playbackError}
                </span>
              </span>
              <button
                type="button"
                onClick={clearPlaybackError}
                className="text-[#d9a3ab] hover:text-white cursor-pointer shrink-0"
                aria-label="Dismiss audio error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            {/* Left: Track Info & Cover */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 w-[30%] sm:w-1/4 shrink-0">
              <div className="relative w-9 h-9 sm:w-12 sm:h-12 rounded overflow-hidden shrink-0 border border-white/[0.1] bg-black">
                <CoverArt
                  title={currentTrack.title}
                  coverUrl={currentTrack.cover_url}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1 truncate">
                <div className="text-xs sm:text-base font-light text-[#f0ede6] truncate tracking-wider uppercase font-title">
                  {currentTrack.title}
                </div>
                <div className="font-sans text-[10px] sm:text-[11px] tracking-wider uppercase text-ash/75 truncate">
                  deathmarried
                </div>
              </div>
            </div>

            {/* Center: Playback Controls */}
            <div className="flex flex-col items-center gap-1 flex-1 min-w-0 max-w-md">
              <div className="flex items-center gap-1.5 sm:gap-5">
                <button
                  onClick={toggleShuffle}
                  className={`hidden sm:inline-flex p-1.5 rounded transition-colors cursor-pointer ${
                    shuffle ? 'text-white' : 'text-[#706a62] hover:text-[#ded8ce]'
                  }`}
                  aria-label="Toggle shuffle"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={prevTrack}
                  className="p-1.5 text-[#8c857b] hover:text-white transition-colors cursor-pointer"
                  aria-label="Previous track"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={togglePlay}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/[0.1] hover:bg-white/[0.2] text-white flex items-center justify-center border border-white/[0.15] transition-all cursor-pointer shrink-0"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  )}
                </button>
                <button
                  onClick={nextTrack}
                  className="p-1.5 text-[#8c827a] hover:text-white transition-colors cursor-pointer"
                  aria-label="Next track"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
                <button
                  onClick={toggleRepeat}
                  className={`hidden sm:inline-flex p-1.5 rounded transition-colors cursor-pointer ${
                    repeatMode !== 'none' ? 'text-white' : 'text-[#706a62] hover:text-[#ded8ce]'
                  }`}
                  aria-label="Toggle repeat mode"
                >
                  {repeatMode === 'one' ? <Repeat1 className="w-3.5 h-3.5" /> : <Repeat className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Progress Slider */}
              <div className="w-full flex items-center gap-1.5 sm:gap-2 font-sans text-[10px] sm:text-xs tracking-wider text-ash/80 tabular-nums">
                <span className="w-7 sm:w-8 text-right font-sans shrink-0">{formatDuration(progress)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={progress}
                  onChange={(e) => seek(parseFloat(e.target.value))}
                  className="w-full min-w-0 h-1 bg-white/[0.08] rounded-lg appearance-none cursor-pointer accent-[#a39b8b]"
                  aria-label="Audio progress slider"
                />
                <span className="w-7 sm:w-8 font-sans shrink-0">{formatDuration(duration)}</span>
              </div>
            </div>

            {/* Right: Volume & Queue Tools */}
            <div className="flex items-center justify-end gap-1 sm:gap-3 shrink-0 sm:w-1/4">
              <button
                onClick={() => setQueueOpen(!queueOpen)}
                className={`p-1.5 rounded transition-colors relative cursor-pointer ${
                  queueOpen ? 'text-white bg-white/[0.08]' : 'text-[#8c857b] hover:text-white'
                }`}
                aria-label="Toggle queue panel"
              >
                <ListMusic className="w-3.5 h-3.5" />
                {queue.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white/20 text-[#f0ede6] text-[9px] font-title rounded-full flex items-center justify-center font-bold">
                    {queue.length}
                  </span>
                )}
              </button>

              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  onClick={toggleMute}
                  className="text-[#8c857b] hover:text-white p-1 cursor-pointer"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-16 h-1 bg-white/[0.08] rounded appearance-none cursor-pointer accent-[#a39b8b]"
                  aria-label="Volume slider"
                />
              </div>

              <button
                onClick={hidePlayer}
                className="text-[#5c564e] hover:text-white p-1 cursor-pointer"
                aria-label="Dismiss player"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
