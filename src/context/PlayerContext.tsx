import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Track } from '../types/index.js';

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isVisible: boolean;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: 'none' | 'all' | 'one';
  queue: Track[];
  queueOpen: boolean;
  playTrack: (track: Track, newQueue?: Track[]) => void;
  togglePlay: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seek: (seconds: number) => void;
  setVolume: (val: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setQueueOpen: (open: boolean) => void;
  removeFromQueue: (index: number) => void;
  hidePlayer: () => void;
}

const PlayerContext = createContext<PlayerContextType>({
  currentTrack: null,
  isPlaying: false,
  isVisible: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  isMuted: false,
  shuffle: false,
  repeatMode: 'none',
  queue: [],
  queueOpen: false,
  playTrack: () => {},
  togglePlay: () => {},
  nextTrack: () => {},
  prevTrack: () => {},
  seek: () => {},
  setVolume: () => {},
  toggleMute: () => {},
  toggleShuffle: () => {},
  toggleRepeat: () => {},
  setQueueOpen: () => {},
  removeFromQueue: () => {},
  hidePlayer: () => {},
});

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'none' | 'all' | 'one'>('all');
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const nextTrackRef = useRef<() => void>(() => {});

  // Initialize audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setProgress(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      nextTrackRef.current();
    };

    const onError = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
    };
  }, []);

  const playTrack = useCallback((track: Track, newQueue?: Track[]) => {
    if (!audioRef.current) return;
    const audio = audioRef.current;

    setCurrentTrack(track);
    setIsVisible(true);

    if (newQueue && newQueue.length > 0) {
      setQueue(newQueue);
    } else {
      setQueue((prev) => {
        if (!prev.some((t) => t.id === track.id)) {
          return [...prev, track];
        }
        return prev;
      });
    }

    audio.src = track.audio_url;
    audio.volume = isMuted ? 0 : volume;
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch((e) => {
        console.warn('Playback error or blocked by policy', e);
        setIsPlaying(false);
      });
  }, [isMuted, volume]);

  const togglePlay = () => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const nextTrack = useCallback(() => {
    if (queue.length === 0 || !currentTrack) return;

    if (repeatMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
      return;
    }

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    let nextIndex = currentIndex + 1;

    if (shuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      if (repeatMode === 'all') {
        nextIndex = 0;
      } else {
        setIsPlaying(false);
        return;
      }
    }

    const next = queue[nextIndex];
    if (next) {
      playTrack(next);
    }
  }, [queue, currentTrack, repeatMode, shuffle, playTrack]);

  useEffect(() => {
    nextTrackRef.current = nextTrack;
  }, [nextTrack]);

  const prevTrack = useCallback(() => {
    if (!audioRef.current || queue.length === 0 || !currentTrack) return;

    if (audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    const prevIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;
    const prev = queue[prevIndex];
    if (prev) {
      playTrack(prev);
    }
  }, [queue, currentTrack, playTrack]);

  const seek = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setProgress(seconds);
  };

  const setVolume = (val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : clamped;
    }
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      setIsMuted(false);
      audioRef.current.volume = volume;
    } else {
      setIsMuted(true);
      audioRef.current.volume = 0;
    }
  };

  const toggleShuffle = () => setShuffle((prev) => !prev);

  const toggleRepeat = () => {
    setRepeatMode((prev) => {
      if (prev === 'none') return 'all';
      if (prev === 'all') return 'one';
      return 'none';
    });
  };

  const removeFromQueue = (index: number) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  };

  const hidePlayer = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setIsVisible(false);
  };

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        isVisible,
        progress,
        duration,
        volume,
        isMuted,
        shuffle,
        repeatMode,
        queue,
        queueOpen,
        playTrack,
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
        hidePlayer,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => useContext(PlayerContext);
