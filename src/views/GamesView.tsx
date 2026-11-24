import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { QuizQuestion, LeaderboardEntry } from '../types/index.js';
import { ShopModal } from '../components/ShopModal.js';
import { ShareCardModal } from '../components/ShareCardModal.js';
import type { ShareCardContext } from '../utils/shareCardGenerator.js';
import { dispatchAchievementUnlocked } from '../components/AchievementToast.js';
import { safeJson, getStreakBonusPercent } from '../utils/logic.js';
import { formatHandle, renderEquippedBadge, renderEquippedTitle } from '../utils/cosmetics.js';
import {
  unlockAudioContext,
  fetchAndDecodeAudio,
  playReversedSnippet,
  playSpeedSnippet,
  type ActiveAudioPlayback,
} from '../utils/webAudioGames.js';
import confetti from 'canvas-confetti';
import {
  Trophy,
  HelpCircle,
  Music,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  Flame,
  Calendar,
  ShoppingBag,
  ArrowRight,
  Clock,
  Share2,
  Quote,
  RotateCcw,
  Gauge,
  Loader2,
  AlertCircle,
} from 'lucide-react';

type GameTabId = 'guess' | 'quiz' | 'lyrics' | 'reverse' | 'speed' | 'leaderboard';
type LeaderboardGameFilter =
  | 'all'
  | 'guess-track'
  | 'daily-quiz'
  | 'guess-lyrics'
  | 'reverse-track'
  | 'speed-track';

interface GuessResultState {
  correct: boolean;
  correct_track_id: string;
  selected_track_id?: string;
  score?: number;
  base_xp?: number;
  streak_bonus_percent?: number;
  xp_earned: number;
  speed_mode?: 0.5 | 2.5;
  track: any;
}

interface DailyTrackRound {
  challenge_date: string;
  next_reset_at: string;
  round_token: string;
  audio_url: string;
  snippet_start: number;
  snippet_start_ratio?: number;
  snippet_duration: number;
  speed_mode?: 0.5 | 2.5;
  options: { id: string; title: string }[];
  completed?: boolean;
  already_completed?: boolean;
  previous_attempt?: GuessResultState | null;
}

interface LyricsResultState {
  correct: boolean;
  selected_option_id?: string;
  correct_option_id: string;
  correct_line: string;
  score?: number;
  base_xp?: number;
  streak_bonus_percent?: number;
  xp_earned: number;
  track: any;
}

interface DailyLyricsRound {
  challenge_date: string;
  next_reset_at: string;
  round_token: string;
  prompt_line: string;
  options: { id: string; text: string }[];
  completed?: boolean;
  already_completed?: boolean;
  previous_attempt?: LyricsResultState | null;
}

const GUEST_STORAGE_KEYS = {
  guess: 'apostles_guest_daily_track_v2',
  lyrics: 'apostles_guest_daily_lyrics_v1',
  reverse: 'apostles_guest_daily_reverse_v1',
  speed: 'apostles_guest_daily_speed_v1',
} as const;

function formatCountdown(nextResetIso: string | null, nowMs: number): string {
  if (!nextResetIso) return '--:--:--';
  const targetMs = Date.parse(nextResetIso);
  if (Number.isNaN(targetMs)) return '--:--:--';
  const remainingSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const hours = Math.floor(remainingSec / 3600);
  const mins = Math.floor((remainingSec % 3600) / 60);
  const secs = remainingSec % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatMskCycleLabel(cycleId?: string | null): string {
  if (!cycleId) return 'МСК';
  if (cycleId.endsWith('-AM')) return `${cycleId.slice(0, 10)} · 00:00 МСК`;
  if (cycleId.endsWith('-PM')) return `${cycleId.slice(0, 10)} · 12:00 МСК`;
  return `${cycleId} МСК`;
}

function readGuestAttempt<T>(key: string, challengeDate: string): { result: T; selected: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.challenge_date === challengeDate && parsed.result) {
      return { result: parsed.result as T, selected: String(parsed.selected || '') };
    }
  } catch {}
  return null;
}

function saveGuestAttempt<T>(key: string, challengeDate: string, selected: string, result: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ challenge_date: challengeDate, selected, result }));
  } catch {}
}

function getDifficultyBadge(difficulty?: number) {
  if (difficulty === 3) {
    return {
      label: 'Сложный · 25 XP',
      className: 'bg-[#2a1018] border-[#821c2c]/60 text-[#f2a8b5]',
    };
  }
  if (difficulty === 2) {
    return {
      label: 'Средний · 15 XP',
      className: 'bg-[#251d10] border-[#8c6424]/50 text-[#e8c68a]',
    };
  }
  return {
    label: 'Лёгкий · 10 XP',
    className: 'bg-[#122018] border-[#2e5d40]/50 text-[#8ad8a8]',
  };
}

export const GamesView: React.FC = () => {
  const { t, lang } = useI18n();
  const { user, refresh, openAuth } = useAuth();

  const [activeTab, setActiveTab] = useState<GameTabId>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'guess' || p === 'quiz' || p === 'lyrics' || p === 'reverse' || p === 'speed' || p === 'leaderboard') {
        return p;
      }
    } catch {}
    return 'guess';
  });
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [shareContext, setShareContext] = useState<ShareCardContext | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // -------------------------------------------------------------------------
  // GAME 1: GUESS THE TRACK (5s snippet, 12h MSK)
  // -------------------------------------------------------------------------
  const [guessRound, setGuessRound] = useState<DailyTrackRound | null>(null);
  const [isSnippetPlaying, setIsSnippetPlaying] = useState(false);
  const [snippetElapsed, setSnippetElapsed] = useState(0);
  const [snippetEffectiveDuration, setSnippetEffectiveDuration] = useState(5);
  const [selectedGuessOption, setSelectedGuessOption] = useState<string | null>(null);
  const [guessResult, setGuessResult] = useState<GuessResultState | null>(null);
  const [guessCompleted, setGuessCompleted] = useState(false);
  const [guessLoading, setGuessLoading] = useState(false);
  const [guessSubmitting, setGuessSubmitting] = useState(false);
  const [guessError, setGuessError] = useState<string | null>(null);
  const [guessStartTime, setGuessStartTime] = useState<number>(Date.now());

  const snippetAudioRef = useRef<HTMLAudioElement | null>(null);
  const snippetTimerRef = useRef<number | null>(null);
  const snippetBoundsRef = useRef<{ start: number; duration: number }>({ start: 0, duration: 5 });

  // -------------------------------------------------------------------------
  // GAME 2: DAILY QUIZ (12h MSK + quiz_enabled + difficulty XP)
  // -------------------------------------------------------------------------
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizDisabled, setQuizDisabled] = useState(false);
  const [quizDisabledMessage, setQuizDisabledMessage] = useState('');
  const [quizChallengeDate, setQuizChallengeDate] = useState<string>('');
  const [quizNextResetAt, setQuizNextResetAt] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<{ [qId: string]: number }>({});
  const [quizStartTime, setQuizStartTime] = useState<number>(Date.now());
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [alreadyCompletedDaily, setAlreadyCompletedDaily] = useState(false);
  const [previousScore, setPreviousScore] = useState(0);
  const [previousXp, setPreviousXp] = useState(0);
  const [quizResult, setQuizResult] = useState<{
    total: number;
    correct_count: number;
    base_score: number;
    base_xp?: number;
    speed_bonus: number;
    streak_bonus_percent?: number;
    streak_bonus_xp?: number;
    total_xp: number;
    results: any[];
  } | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // GAME 3: GUESS THE LYRIC (12h MSK)
  // -------------------------------------------------------------------------
  const [lyricsRound, setLyricsRound] = useState<DailyLyricsRound | null>(null);
  const [selectedLyricOption, setSelectedLyricOption] = useState<string | null>(null);
  const [lyricsResult, setLyricsResult] = useState<LyricsResultState | null>(null);
  const [lyricsCompleted, setLyricsCompleted] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsSubmitting, setLyricsSubmitting] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // GAME 4: REVERSE TRACK (5s Web Audio reversed, 12h MSK)
  // -------------------------------------------------------------------------
  const [reverseRound, setReverseRound] = useState<DailyTrackRound | null>(null);
  const [selectedReverseOption, setSelectedReverseOption] = useState<string | null>(null);
  const [reverseResult, setReverseResult] = useState<GuessResultState | null>(null);
  const [reverseCompleted, setReverseCompleted] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [reverseAudioDecoding, setReverseAudioDecoding] = useState(false);
  const [reversePlaying, setReversePlaying] = useState(false);
  const [reverseElapsed, setReverseElapsed] = useState(0);
  const [reverseDuration, setReverseDuration] = useState(5);
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // GAME 5: SPEED TRACK 0.5x / 2.5x (5s Web Audio pitch-shifted, 12h MSK)
  // -------------------------------------------------------------------------
  const [speedRound, setSpeedRound] = useState<DailyTrackRound | null>(null);
  const [selectedSpeedOption, setSelectedSpeedOption] = useState<string | null>(null);
  const [speedResult, setSpeedResult] = useState<GuessResultState | null>(null);
  const [speedCompleted, setSpeedCompleted] = useState(false);
  const [speedLoading, setSpeedLoading] = useState(false);
  const [speedAudioDecoding, setSpeedAudioDecoding] = useState(false);
  const [speedPlaying, setSpeedPlaying] = useState(false);
  const [speedElapsed, setSpeedElapsed] = useState(0);
  const [speedDuration, setSpeedDuration] = useState(5);
  const [speedSubmitting, setSpeedSubmitting] = useState(false);
  const [speedError, setSpeedError] = useState<string | null>(null);

  const webAudioPlaybackRef = useRef<ActiveAudioPlayback | null>(null);
  const autoReloadedCycleRef = useRef<Record<string, string>>({});

  // -------------------------------------------------------------------------
  // LEADERBOARD
  // -------------------------------------------------------------------------
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [timeframe, setTimeframe] = useState<'all' | 'weekly' | 'monthly'>('all');
  const [leaderboardGame, setLeaderboardGame] = useState<LeaderboardGameFilter>('all');
  const [leadersLoading, setLeadersLoading] = useState(false);

  // Live 1s clock for MSK countdown
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const stopWebAudioPlayback = useCallback(() => {
    if (webAudioPlaybackRef.current) {
      webAudioPlaybackRef.current.stop();
      webAudioPlaybackRef.current = null;
    }
    setReversePlaying(false);
    setReverseElapsed(0);
    setSpeedPlaying(false);
    setSpeedElapsed(0);
  }, []);

  const stopSnippetPlayback = useCallback((resetToStart = true) => {
    if (snippetTimerRef.current !== null) {
      window.clearInterval(snippetTimerRef.current);
      snippetTimerRef.current = null;
    }
    const audio = snippetAudioRef.current;
    if (audio) {
      audio.pause();
      if (resetToStart) {
        try {
          audio.currentTime = snippetBoundsRef.current.start;
        } catch {}
      }
    }
    setIsSnippetPlaying(false);
    setSnippetElapsed(0);
  }, []);

  const destroySnippetAudio = useCallback(() => {
    stopSnippetPlayback(false);
    if (snippetAudioRef.current) {
      snippetAudioRef.current.onended = null;
      snippetAudioRef.current.onerror = null;
      snippetAudioRef.current.ontimeupdate = null;
      snippetAudioRef.current.onseeking = null;
      snippetAudioRef.current.src = '';
      snippetAudioRef.current = null;
    }
  }, [stopSnippetPlayback]);

  // -------------------------------------------------------------------------
  // LOADERS
  // -------------------------------------------------------------------------
  const loadGuessRound = useCallback(async () => {
    setGuessLoading(true);
    setGuessError(null);
    setGuessResult(null);
    setGuessCompleted(false);
    setSelectedGuessOption(null);
    destroySnippetAudio();

    try {
      const res = await authFetch('/api/games/guess-track/round', { cache: 'no-store' });
      const data = await safeJson<DailyTrackRound & { error?: string }>(res, null as any);
      if (res.ok && data) {
        const clampedDur = Math.min(5, Math.max(1, Number(data.snippet_duration) || 5));
        snippetBoundsRef.current = {
          start: Math.max(0, Number(data.snippet_start) || 0),
          duration: clampedDur,
        };
        setSnippetEffectiveDuration(clampedDur);
        setGuessRound(data);
        setGuessStartTime(Date.now());

        if (data.completed || data.already_completed) {
          setGuessCompleted(true);
          if (data.previous_attempt) {
            setGuessResult(data.previous_attempt);
            setSelectedGuessOption(data.previous_attempt.selected_track_id || null);
          }
        } else if (!user && data.challenge_date) {
          const guestSaved = readGuestAttempt<GuessResultState>(GUEST_STORAGE_KEYS.guess, data.challenge_date);
          if (guestSaved) {
            setGuessCompleted(true);
            setGuessResult(guestSaved.result);
            setSelectedGuessOption(guestSaved.selected || null);
          }
        }
      } else {
        setGuessRound(null);
        setGuessError(data?.error || 'Не удалось загрузить аудиофрагмент.');
      }
    } catch (e: any) {
      setGuessRound(null);
      setGuessError(e?.message || 'Ошибка соединения');
    } finally {
      setGuessLoading(false);
    }
  }, [destroySnippetAudio, user]);

  const loadDailyQuiz = useCallback(async () => {
    setQuizLoading(true);
    setQuizError(null);
    setQuizDisabled(false);
    setQuizDisabledMessage('');
    setQuizSubmitted(false);
    setQuizResult(null);
    setQuizAnswers({});
    try {
      const res = await authFetch('/api/games/quiz/daily', { cache: 'no-store' });
      const data = await safeJson<any>(res, null);
      if (res.ok && data) {
        setQuizChallengeDate(data.challenge_date || '');
        setQuizNextResetAt(data.next_reset_at || null);
        if (data.disabled) {
          setQuizDisabled(true);
          setQuizDisabledMessage(data.message || 'Зайдите позже, добавляются новые вопросы');
          setQuizQuestions([]);
        } else {
          setQuizQuestions(data.questions || []);
          setAlreadyCompletedDaily(Boolean(data.completed || data.already_completed));
          setPreviousScore(data.previous_score || 0);
          setPreviousXp(data.previous_xp || 0);
          setQuizStartTime(Date.now());
        }
      } else {
        setQuizError(data?.error || 'Не удалось загрузить викторину.');
      }
    } catch (e: any) {
      setQuizError(e?.message || 'Ошибка соединения');
    } finally {
      setQuizLoading(false);
    }
  }, []);

  const loadLyricsRound = useCallback(async () => {
    setLyricsLoading(true);
    setLyricsError(null);
    setLyricsResult(null);
    setLyricsCompleted(false);
    setSelectedLyricOption(null);

    try {
      const res = await authFetch('/api/games/guess-lyrics/round', { cache: 'no-store' });
      const data = await safeJson<DailyLyricsRound & { error?: string }>(res, null as any);
      if (res.ok && data) {
        setLyricsRound(data);
        if (data.completed || data.already_completed) {
          setLyricsCompleted(true);
          if (data.previous_attempt) {
            setLyricsResult(data.previous_attempt);
            setSelectedLyricOption(data.previous_attempt.selected_option_id || null);
          }
        } else if (!user && data.challenge_date) {
          const guestSaved = readGuestAttempt<LyricsResultState>(GUEST_STORAGE_KEYS.lyrics, data.challenge_date);
          if (guestSaved) {
            setLyricsCompleted(true);
            setLyricsResult(guestSaved.result);
            setSelectedLyricOption(guestSaved.selected || null);
          }
        }
      } else {
        setLyricsRound(null);
        setLyricsError(data?.error || 'Не удалось загрузить игру «Угадай строчку».');
      }
    } catch (e: any) {
      setLyricsRound(null);
      setLyricsError(e?.message || 'Ошибка соединения');
    } finally {
      setLyricsLoading(false);
    }
  }, [user]);

  const loadReverseRound = useCallback(async () => {
    setReverseLoading(true);
    setReverseError(null);
    setReverseResult(null);
    setReverseCompleted(false);
    setSelectedReverseOption(null);
    stopWebAudioPlayback();

    try {
      const res = await authFetch('/api/games/reverse-track/round', { cache: 'no-store' });
      const data = await safeJson<DailyTrackRound & { error?: string }>(res, null as any);
      if (res.ok && data) {
        setReverseRound(data);
        setReverseDuration(Math.min(5, Math.max(1, Number(data.snippet_duration) || 5)));
        if (data.completed || data.already_completed) {
          setReverseCompleted(true);
          if (data.previous_attempt) {
            setReverseResult(data.previous_attempt);
            setSelectedReverseOption(data.previous_attempt.selected_track_id || null);
          }
        } else if (!user && data.challenge_date) {
          const guestSaved = readGuestAttempt<GuessResultState>(GUEST_STORAGE_KEYS.reverse, data.challenge_date);
          if (guestSaved) {
            setReverseCompleted(true);
            setReverseResult(guestSaved.result);
            setSelectedReverseOption(guestSaved.selected || null);
          }
        }
      } else {
        setReverseRound(null);
        setReverseError(data?.error || 'Не удалось загрузить раунд «Задом наперёд».');
      }
    } catch (e: any) {
      setReverseRound(null);
      setReverseError(e?.message || 'Ошибка соединения');
    } finally {
      setReverseLoading(false);
    }
  }, [stopWebAudioPlayback, user]);

  const loadSpeedRound = useCallback(async () => {
    setSpeedLoading(true);
    setSpeedError(null);
    setSpeedResult(null);
    setSpeedCompleted(false);
    setSelectedSpeedOption(null);
    stopWebAudioPlayback();

    try {
      const res = await authFetch('/api/games/speed-track/round', { cache: 'no-store' });
      const data = await safeJson<DailyTrackRound & { error?: string }>(res, null as any);
      if (res.ok && data) {
        setSpeedRound(data);
        setSpeedDuration(Math.min(5, Math.max(1, Number(data.snippet_duration) || 5)));
        if (data.completed || data.already_completed) {
          setSpeedCompleted(true);
          if (data.previous_attempt) {
            setSpeedResult(data.previous_attempt);
            setSelectedSpeedOption(data.previous_attempt.selected_track_id || null);
          }
        } else if (!user && data.challenge_date) {
          const guestSaved = readGuestAttempt<GuessResultState>(GUEST_STORAGE_KEYS.speed, data.challenge_date);
          if (guestSaved) {
            setSpeedCompleted(true);
            setSpeedResult(guestSaved.result);
            setSelectedSpeedOption(guestSaved.selected || null);
          }
        }
      } else {
        setSpeedRound(null);
        setSpeedError(data?.error || 'Не удалось загрузить раунд «0.5x / 2.5x».');
      }
    } catch (e: any) {
      setSpeedRound(null);
      setSpeedError(e?.message || 'Ошибка соединения');
    } finally {
      setSpeedLoading(false);
    }
  }, [stopWebAudioPlayback, user]);

  const loadLeaderboard = useCallback(async (tf: 'all' | 'weekly' | 'monthly', game: LeaderboardGameFilter) => {
    setLeadersLoading(true);
    try {
      const res = await fetch(
        `/api/games/leaderboard?timeframe=${encodeURIComponent(tf)}&game=${encodeURIComponent(game)}`,
        { cache: 'no-store' }
      );
      const data = await safeJson<any>(res, null);
      if (res.ok && data) {
        setLeaderboard(data.leaders || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLeadersLoading(false);
    }
  }, []);

  useEffect(() => {
    stopSnippetPlayback(false);
    stopWebAudioPlayback();

    if (activeTab === 'guess') loadGuessRound();
    else if (activeTab === 'quiz') loadDailyQuiz();
    else if (activeTab === 'lyrics') loadLyricsRound();
    else if (activeTab === 'reverse') loadReverseRound();
    else if (activeTab === 'speed') loadSpeedRound();
    else if (activeTab === 'leaderboard') loadLeaderboard(timeframe, leaderboardGame);

    return () => {
      stopSnippetPlayback(false);
      stopWebAudioPlayback();
    };
  }, [activeTab, user?.id]);

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      loadLeaderboard(timeframe, leaderboardGame);
    }
  }, [timeframe, leaderboardGame, activeTab, loadLeaderboard]);

  useEffect(() => {
    const handleOpenGamesTab = (ev: Event) => {
      const next = (ev as CustomEvent<string>).detail;
      if (next === 'guess' || next === 'quiz' || next === 'lyrics' || next === 'reverse' || next === 'speed' || next === 'leaderboard') {
        setActiveTab(next);
      }
    };
    window.addEventListener('open-games-tab', handleOpenGamesTab);
    return () => {
      window.removeEventListener('open-games-tab', handleOpenGamesTab);
      destroySnippetAudio();
      stopWebAudioPlayback();
    };
  }, [destroySnippetAudio, stopWebAudioPlayback]);

  // Auto-reload active tab when the 12-hour MSK reset boundary passes
  useEffect(() => {
    const checkReset = (tabKey: GameTabId, nextReset: string | null | undefined, cycleId: string | undefined, loading: boolean, reload: () => void) => {
      if (activeTab !== tabKey || loading || !nextReset || !cycleId) return;
      const targetMs = Date.parse(nextReset);
      if (Number.isNaN(targetMs)) return;
      if (nowMs >= targetMs + 1200 && autoReloadedCycleRef.current[tabKey] !== cycleId) {
        autoReloadedCycleRef.current[tabKey] = cycleId;
        reload();
      }
    };
    checkReset('guess', guessRound?.next_reset_at, guessRound?.challenge_date, guessLoading, loadGuessRound);
    checkReset('quiz', quizNextResetAt, quizChallengeDate, quizLoading, loadDailyQuiz);
    checkReset('lyrics', lyricsRound?.next_reset_at, lyricsRound?.challenge_date, lyricsLoading, loadLyricsRound);
    checkReset('reverse', reverseRound?.next_reset_at, reverseRound?.challenge_date, reverseLoading, loadReverseRound);
    checkReset('speed', speedRound?.next_reset_at, speedRound?.challenge_date, speedLoading, loadSpeedRound);
  }, [
    activeTab,
    nowMs,
    guessRound,
    guessLoading,
    loadGuessRound,
    quizNextResetAt,
    quizChallengeDate,
    quizLoading,
    loadDailyQuiz,
    lyricsRound,
    lyricsLoading,
    loadLyricsRound,
    reverseRound,
    reverseLoading,
    loadReverseRound,
    speedRound,
    speedLoading,
    loadSpeedRound,
  ]);

  // -------------------------------------------------------------------------
  // AUDIO PLAYBACK HANDLERS
  // -------------------------------------------------------------------------
  const computeEffectiveSnippetBounds = (audio: HTMLAudioElement, round: DailyTrackRound) => {
    const realDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const requestedDur = Math.min(5, Math.max(1, Number(round.snippet_duration) || 5));
    if (realDur <= 0) {
      return { start: Math.max(0, Number(round.snippet_start) || 0), duration: requestedDur };
    }
    const effectiveDur = Math.min(5, Math.min(requestedDur, realDur));
    if (realDur <= effectiveDur) return { start: 0, duration: realDur };
    const requestedStart = Math.max(0, Number(round.snippet_start) || 0);
    if (requestedStart + effectiveDur <= realDur) {
      return { start: requestedStart, duration: effectiveDur };
    }
    const ratio = Number.isFinite(Number(round.snippet_start_ratio))
      ? Math.max(0, Math.min(0.999999, Number(round.snippet_start_ratio)))
      : 0;
    const clampedStart = Math.max(0, Math.min(realDur - effectiveDur, Math.floor(ratio * (realDur - effectiveDur))));
    return { start: clampedStart, duration: effectiveDur };
  };

  const toggleSnippetAudio = () => {
    if (!guessRound) return;
    setGuessError(null);
    if (isSnippetPlaying) {
      stopSnippetPlayback(true);
      return;
    }

    let audio = snippetAudioRef.current;
    const resolvedTargetSrc = new URL(guessRound.audio_url, window.location.origin).href;
    if (!audio || audio.src !== resolvedTargetSrc) {
      destroySnippetAudio();
      audio = new Audio(guessRound.audio_url);
      audio.preload = 'none';
      snippetAudioRef.current = audio;
    }

    const enforceBounds = () => {
      if (!audio) return;
      const { start, duration } = snippetBoundsRef.current;
      const end = start + duration;
      const elapsed = audio.currentTime - start;
      if (audio.currentTime >= end - 0.04) {
        stopSnippetPlayback(true);
        return;
      }
      setSnippetElapsed(Math.max(0, Math.min(duration, elapsed)));
    };

    audio.onended = () => stopSnippetPlayback(true);
    audio.onerror = () => {
      stopSnippetPlayback(false);
      setGuessError('Ошибка воспроизведения аудиофайла.');
    };
    audio.ontimeupdate = enforceBounds;

    const startPlayback = () => {
      if (!audio) return;
      const bounds = computeEffectiveSnippetBounds(audio, guessRound);
      snippetBoundsRef.current = bounds;
      setSnippetEffectiveDuration(bounds.duration);
      try {
        audio.currentTime = bounds.start;
      } catch {}

      audio
        .play()
        .then(() => {
          setIsSnippetPlaying(true);
          setSnippetElapsed(0);
          if (snippetTimerRef.current !== null) window.clearInterval(snippetTimerRef.current);
          snippetTimerRef.current = window.setInterval(enforceBounds, 50);
        })
        .catch(() => {
          stopSnippetPlayback(false);
          setGuessError('Браузер заблокировал воспроизведение или файл недоступен.');
        });
    };

    if (audio.readyState >= 1) {
      startPlayback();
    } else {
      const onLoaded = () => {
        audio?.removeEventListener('loadedmetadata', onLoaded);
        startPlayback();
      };
      audio.addEventListener('loadedmetadata', onLoaded);
      audio.load();
    }
  };

  // Reverse Track Web Audio handler (unlocks AudioContext synchronously inside click for iOS Safari)
  const toggleReverseAudio = async () => {
    if (!reverseRound) return;
    setReverseError(null);
    if (reversePlaying) {
      stopWebAudioPlayback();
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = unlockAudioContext();
    } catch (err: any) {
      setReverseError(err?.message || 'Web Audio API недоступен в этом браузере.');
      return;
    }

    setReverseAudioDecoding(true);
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const buffer = await fetchAndDecodeAudio(reverseRound.audio_url, ctx);
      stopWebAudioPlayback();
      const handle = playReversedSnippet({
        ctx,
        buffer,
        snippetStart: reverseRound.snippet_start,
        snippetStartRatio: reverseRound.snippet_start_ratio,
        durationSeconds: 5,
        onProgress: (elapsed, total) => {
          setReverseElapsed(elapsed);
          setReverseDuration(total);
        },
        onEnded: () => {
          webAudioPlaybackRef.current = null;
          setReversePlaying(false);
          setReverseElapsed(0);
        },
      });
      webAudioPlaybackRef.current = handle;
      setReverseDuration(handle.durationSeconds);
      setReversePlaying(true);
    } catch (err: any) {
      stopWebAudioPlayback();
      setReverseError(err?.message || 'Не удалось воспроизвести реверс-фрагмент.');
    } finally {
      setReverseAudioDecoding(false);
    }
  };

  // Speed Track 0.5x / 2.5x Web Audio handler (unlocks AudioContext synchronously inside click for iOS Safari)
  const toggleSpeedAudio = async () => {
    if (!speedRound) return;
    setSpeedError(null);
    if (speedPlaying) {
      stopWebAudioPlayback();
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = unlockAudioContext();
    } catch (err: any) {
      setSpeedError(err?.message || 'Web Audio API недоступен в этом браузере.');
      return;
    }

    const rate: 0.5 | 2.5 = speedRound.speed_mode === 2.5 ? 2.5 : 0.5;
    setSpeedAudioDecoding(true);
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const buffer = await fetchAndDecodeAudio(speedRound.audio_url, ctx);
      stopWebAudioPlayback();
      const handle = playSpeedSnippet({
        ctx,
        buffer,
        snippetStart: speedRound.snippet_start,
        snippetStartRatio: speedRound.snippet_start_ratio,
        playbackRate: rate,
        listenDurationSeconds: 5,
        onProgress: (elapsed, total) => {
          setSpeedElapsed(elapsed);
          setSpeedDuration(total);
        },
        onEnded: () => {
          webAudioPlaybackRef.current = null;
          setSpeedPlaying(false);
          setSpeedElapsed(0);
        },
      });
      webAudioPlaybackRef.current = handle;
      setSpeedDuration(handle.durationSeconds);
      setSpeedPlaying(true);
    } catch (err: any) {
      stopWebAudioPlayback();
      setSpeedError(err?.message || 'Не удалось воспроизвести ускоренный/замедленный фрагмент.');
    } finally {
      setSpeedAudioDecoding(false);
    }
  };

  // -------------------------------------------------------------------------
  // SUBMIT / VERIFY HANDLERS
  // -------------------------------------------------------------------------
  const handleVerifyGuess = async (selectedId: string) => {
    if (!guessRound || guessCompleted || guessResult || guessSubmitting) return;
    setGuessSubmitting(true);
    setGuessError(null);
    setSelectedGuessOption(selectedId);
    stopSnippetPlayback(true);
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - guessStartTime) / 1000));

    try {
      const res = await authFetch('/api/games/guess-track/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_token: guessRound.round_token,
          challenge_date: guessRound.challenge_date,
          selected_track_id: selectedId,
          time_spent: elapsedSeconds,
        }),
      });
      const data = await safeJson<any>(res, null);
      if (res.status === 409 && data?.code === 'DAILY_ROLLOVER') {
        setGuessError(data.error || 'Начался новый 12-часовой раунд (МСК) — загружаем новый трек!');
        await loadGuessRound();
        return;
      }
      if (res.ok && data) {
        const resultObj: GuessResultState = {
          correct: Boolean(data.correct),
          correct_track_id: data.correct_track_id,
          selected_track_id: selectedId,
          score: data.score,
          base_xp: data.base_xp,
          streak_bonus_percent: data.streak_bonus_percent,
          xp_earned: Number(data.xp_earned) || 0,
          track: data.track,
        };
        setGuessResult(resultObj);
        setGuessCompleted(true);
        if (!user && guessRound.challenge_date) {
          saveGuestAttempt(GUEST_STORAGE_KEYS.guess, guessRound.challenge_date, selectedId, resultObj);
        }
        if (data.correct) confetti({ particleCount: 35, spread: 55, origin: { y: 0.7 } });
        if (data.newly_unlocked_achievements?.length > 0) dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        if (user) refresh();
      } else {
        setSelectedGuessOption(null);
        setGuessError(data?.error || 'Не удалось проверить ответ.');
        if (res.status === 409 || data?.already_completed) {
          setGuessCompleted(true);
          await loadGuessRound();
        }
      }
    } catch (e: any) {
      setSelectedGuessOption(null);
      setGuessError(e?.message || 'Ошибка соединения');
    } finally {
      setGuessSubmitting(false);
    }
  };

  const handleSubmitQuiz = async () => {
    if (quizSubmitting || quizSubmitted || alreadyCompletedDaily || Object.keys(quizAnswers).length < quizQuestions.length) return;
    setQuizSubmitting(true);
    setQuizError(null);
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - quizStartTime) / 1000));
    try {
      const res = await authFetch('/api/games/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: quizAnswers,
          time_spent_seconds: elapsedSeconds,
          challenge_date: quizChallengeDate,
        }),
      });
      const data = await safeJson<any>(res, null);
      if (res.status === 409 && data?.code === 'DAILY_ROLLOVER') {
        setQuizError(data.error || 'Начался новый раунд (МСК) — загружаем свежую викторину!');
        await loadDailyQuiz();
        return;
      }
      if (res.ok && data) {
        setQuizResult(data);
        setQuizSubmitted(true);
        setAlreadyCompletedDaily(true);
        if (data.correct_count === data.total) confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
        if (data.newly_unlocked_achievements?.length > 0) dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        if (user) refresh();
      } else {
        setQuizError(data?.error || 'Не удалось отправить ответы.');
        if (res.status === 409 || data?.already_completed) {
          setAlreadyCompletedDaily(true);
          await loadDailyQuiz();
        }
      }
    } catch (e: any) {
      setQuizError(e?.message || 'Ошибка соединения');
    } finally {
      setQuizSubmitting(false);
    }
  };

  const handleVerifyLyrics = async (optionId: string) => {
    if (!lyricsRound || lyricsCompleted || lyricsResult || lyricsSubmitting) return;
    setLyricsSubmitting(true);
    setLyricsError(null);
    setSelectedLyricOption(optionId);

    try {
      const res = await authFetch('/api/games/guess-lyrics/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_date: lyricsRound.challenge_date,
          selected_option_id: optionId,
        }),
      });
      const data = await safeJson<any>(res, null);
      if (res.status === 409 && data?.code === 'DAILY_ROLLOVER') {
        setLyricsError(data.error || 'Начался новый раунд (МСК) — загружаем новую строчку!');
        await loadLyricsRound();
        return;
      }
      if (res.ok && data) {
        const resObj: LyricsResultState = {
          correct: Boolean(data.correct),
          selected_option_id: optionId,
          correct_option_id: data.correct_option_id,
          correct_line: data.correct_line,
          score: data.score,
          base_xp: data.base_xp,
          streak_bonus_percent: data.streak_bonus_percent,
          xp_earned: Number(data.xp_earned) || 0,
          track: data.track,
        };
        setLyricsResult(resObj);
        setLyricsCompleted(true);
        if (!user && lyricsRound.challenge_date) {
          saveGuestAttempt(GUEST_STORAGE_KEYS.lyrics, lyricsRound.challenge_date, optionId, resObj);
        }
        if (data.correct) confetti({ particleCount: 35, spread: 55, origin: { y: 0.7 } });
        if (data.newly_unlocked_achievements?.length > 0) dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        if (user) refresh();
      } else {
        setSelectedLyricOption(null);
        setLyricsError(data?.error || 'Не удалось проверить ответ.');
        if (res.status === 409 || data?.already_completed) {
          setLyricsCompleted(true);
          await loadLyricsRound();
        }
      }
    } catch (e: any) {
      setSelectedLyricOption(null);
      setLyricsError(e?.message || 'Ошибка соединения');
    } finally {
      setLyricsSubmitting(false);
    }
  };

  const handleVerifyReverse = async (selectedId: string) => {
    if (!reverseRound || reverseCompleted || reverseResult || reverseSubmitting) return;
    setReverseSubmitting(true);
    setReverseError(null);
    setSelectedReverseOption(selectedId);
    stopWebAudioPlayback();

    try {
      const res = await authFetch('/api/games/reverse-track/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_date: reverseRound.challenge_date,
          selected_track_id: selectedId,
        }),
      });
      const data = await safeJson<any>(res, null);
      if (res.status === 409 && data?.code === 'DAILY_ROLLOVER') {
        setReverseError(data.error || 'Начался новый раунд (МСК) — загружаем свежий трек!');
        await loadReverseRound();
        return;
      }
      if (res.ok && data) {
        const resObj: GuessResultState = {
          correct: Boolean(data.correct),
          correct_track_id: data.correct_track_id,
          selected_track_id: selectedId,
          score: data.score,
          base_xp: data.base_xp,
          streak_bonus_percent: data.streak_bonus_percent,
          xp_earned: Number(data.xp_earned) || 0,
          track: data.track,
        };
        setReverseResult(resObj);
        setReverseCompleted(true);
        if (!user && reverseRound.challenge_date) {
          saveGuestAttempt(GUEST_STORAGE_KEYS.reverse, reverseRound.challenge_date, selectedId, resObj);
        }
        if (data.correct) confetti({ particleCount: 40, spread: 60, origin: { y: 0.7 } });
        if (data.newly_unlocked_achievements?.length > 0) dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        if (user) refresh();
      } else {
        setSelectedReverseOption(null);
        setReverseError(data?.error || 'Не удалось проверить ответ.');
        if (res.status === 409 || data?.already_completed) {
          setReverseCompleted(true);
          await loadReverseRound();
        }
      }
    } catch (e: any) {
      setSelectedReverseOption(null);
      setReverseError(e?.message || 'Ошибка соединения');
    } finally {
      setReverseSubmitting(false);
    }
  };

  const handleVerifySpeed = async (selectedId: string) => {
    if (!speedRound || speedCompleted || speedResult || speedSubmitting) return;
    setSpeedSubmitting(true);
    setSpeedError(null);
    setSelectedSpeedOption(selectedId);
    stopWebAudioPlayback();

    try {
      const res = await authFetch('/api/games/speed-track/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_date: speedRound.challenge_date,
          selected_track_id: selectedId,
        }),
      });
      const data = await safeJson<any>(res, null);
      if (res.status === 409 && data?.code === 'DAILY_ROLLOVER') {
        setSpeedError(data.error || 'Начался новый раунд (МСК) — загружаем свежий трек!');
        await loadSpeedRound();
        return;
      }
      if (res.ok && data) {
        const resObj: GuessResultState = {
          correct: Boolean(data.correct),
          correct_track_id: data.correct_track_id,
          selected_track_id: selectedId,
          score: data.score,
          base_xp: data.base_xp,
          streak_bonus_percent: data.streak_bonus_percent,
          xp_earned: Number(data.xp_earned) || 0,
          speed_mode: data.speed_mode || speedRound.speed_mode,
          track: data.track,
        };
        setSpeedResult(resObj);
        setSpeedCompleted(true);
        if (!user && speedRound.challenge_date) {
          saveGuestAttempt(GUEST_STORAGE_KEYS.speed, speedRound.challenge_date, selectedId, resObj);
        }
        if (data.correct) confetti({ particleCount: 40, spread: 60, origin: { y: 0.7 } });
        if (data.newly_unlocked_achievements?.length > 0) dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        if (user) refresh();
      } else {
        setSelectedSpeedOption(null);
        setSpeedError(data?.error || 'Не удалось проверить ответ.');
        if (res.status === 409 || data?.already_completed) {
          setSpeedCompleted(true);
          await loadSpeedRound();
        }
      }
    } catch (e: any) {
      setSelectedSpeedOption(null);
      setSpeedError(e?.message || 'Ошибка соединения');
    } finally {
      setSpeedSubmitting(false);
    }
  };

  const snippetPercent =
    snippetEffectiveDuration > 0
      ? Math.min(100, Math.max(0, (snippetElapsed / snippetEffectiveDuration) * 100))
      : 0;
  const reversePercent =
    reverseDuration > 0 ? Math.min(100, Math.max(0, (reverseElapsed / reverseDuration) * 100)) : 0;
  const speedPercent =
    speedDuration > 0 ? Math.min(100, Math.max(0, (speedElapsed / speedDuration) * 100)) : 0;

  const guessCountdown = formatCountdown(guessRound?.next_reset_at || null, nowMs);
  const quizCountdown = formatCountdown(quizNextResetAt, nowMs);
  const lyricsCountdown = formatCountdown(lyricsRound?.next_reset_at || null, nowMs);
  const reverseCountdown = formatCountdown(reverseRound?.next_reset_at || null, nowMs);
  const speedCountdown = formatCountdown(speedRound?.next_reset_at || null, nowMs);

  const tabs: Array<{ id: GameTabId; label: string; icon: React.ReactNode }> = [
    { id: 'guess', label: 'Угадай трек', icon: <Music className="w-3.5 h-3.5" /> },
    { id: 'quiz', label: 'Викторина', icon: <HelpCircle className="w-3.5 h-3.5" /> },
    { id: 'lyrics', label: 'Угадай строчку', icon: <Quote className="w-3.5 h-3.5" /> },
    { id: 'reverse', label: 'Задом наперёд', icon: <RotateCcw className="w-3.5 h-3.5" /> },
    { id: 'speed', label: '0.5x / 2.5x', icon: <Gauge className="w-3.5 h-3.5" /> },
    { id: 'leaderboard', label: 'Рейтинг', icon: <Trophy className="w-3.5 h-3.5" /> },
  ];

  const renderScheduleBar = (title: string, cycleId?: string | null, countdown?: string) => (
    <div className="bg-[#100f13] border border-white/[0.08] px-4 py-3 rounded-lg flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
      <div className="flex items-center gap-2 text-[#ded8ce]">
        <Calendar className="w-3.5 h-3.5 text-[#8e877e] shrink-0" />
        <span>{title} · 00:00 / 12:00 МСК</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[#8e877e]">
        <span>{formatMskCycleLabel(cycleId)}</span>
        <span className="text-[#423d38]">·</span>
        <span className="inline-flex items-center gap-1 text-[#ded8ce] tabular-nums">
          <Clock className="w-3 h-3 text-[#821c2c]" />
          {countdown || '--:--:--'}
        </span>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 animate-fadeIn">
      <ShopModal isOpen={isShopOpen} onClose={() => setIsShopOpen(false)} />
      <ShareCardModal
        isOpen={shareContext !== null}
        context={shareContext}
        onClose={() => setShareContext(null)}
      />

      {/* Header */}
      <div className="max-w-2xl mx-auto text-center space-y-2">
        <h1 className="font-display text-2xl sm:text-4xl tracking-[0.2em] uppercase text-[#f2eee9] font-medium">
          {t('gamesTitle')}
        </h1>
        <p className="text-xs sm:text-sm text-[#8e877e] leading-relaxed">
          {t('gamesSubtitle')}
        </p>

        {user ? (
          <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-3 px-4 py-2 bg-[#100f13] border border-white/[0.08] rounded-lg font-mono text-xs tabular-nums">
            <div className="text-[#ded8ce] font-semibold">{user.xp} XP</div>
            <span className="text-[#423d38]">·</span>
            <div className="text-[#8e877e]">
              {t('level').toUpperCase()} {user.level}
            </div>
            <span className="text-[#423d38]">·</span>
            <div
              className="text-[#ded8ce] flex items-center gap-1.5"
              title="Серия дней по МСК (UTC+3): +5% к XP за каждый день (до +50%)"
            >
              <Flame className="w-3.5 h-3.5 text-[#c94a5e]" />
              <span>{user.daily_streak || 0} дн.</span>
              {getStreakBonusPercent(user.daily_streak || 0) > 0 && (
                <span className="text-[10px] text-[#7ed6a3] border border-[#2f5e42] bg-[#102016] px-1.5 py-0.5 rounded">
                  +{getStreakBonusPercent(user.daily_streak || 0)}% XP
                </span>
              )}
            </div>
            <span className="text-[#423d38]">·</span>
            <button
              onClick={() => setIsShopOpen(true)}
              className="inline-flex items-center gap-1.5 text-white hover:text-[#ded8ce] transition-colors cursor-pointer font-medium underline"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {t('shopTitle')}
            </button>
          </div>
        ) : (
          <div className="mt-3">
            <button
              onClick={() => openAuth('register')}
              className="font-mono text-xs text-[#8e877e] hover:text-white transition-colors cursor-pointer hover:underline"
            >
              {t('signInToSaveScore')}
            </button>
          </div>
        )}
      </div>

      {/* Responsive Game Tabs */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 border-b border-white/[0.06] pb-3 font-mono text-[11px] sm:text-xs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'bg-white/[0.1] text-white border border-white/[0.18]'
                : 'text-[#8e877e] hover:text-[#ded8ce] border border-transparent'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ===================================================================
          TAB 1: GUESS THE TRACK (5s, 12h MSK)
          =================================================================== */}
      {activeTab === 'guess' && (
        <div className="max-w-xl mx-auto space-y-4">
          {renderScheduleBar('Обновление каждые 12ч', guessRound?.challenge_date, guessCountdown)}

          <div className="bg-[#100f13] border border-white/[0.08] p-6 sm:p-8 rounded-xl shadow-2xl text-center space-y-6">
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8e877e]">
                Аудио-испытание · 5 сек
              </span>
              <h2 className="font-display text-lg uppercase text-[#f2eee9] font-medium tracking-wide">
                Угадай трек по фрагменту
              </h2>
            </div>

            {guessError && (
              <div className="p-3 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c] space-y-2">
                <p>{guessError}</p>
                <button
                  type="button"
                  onClick={loadGuessRound}
                  className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded text-[11px] font-mono uppercase cursor-pointer"
                >
                  Повторить
                </button>
              </div>
            )}

            {guessRound ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={toggleSnippetAudio}
                    className="w-16 h-16 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.15] text-white flex items-center justify-center transition-all cursor-pointer hover:scale-105 shadow-lg"
                    aria-label={isSnippetPlaying ? 'Пауза' : 'Слушать 5-секундный фрагмент'}
                  >
                    {isSnippetPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-1" />
                    )}
                  </button>

                  <div className="flex items-center gap-1 mt-4 h-6">
                    {[40, 75, 55, 90, 60, 85, 45, 95, 50, 70, 80, 65, 45].map((h, i) => (
                      <span
                        key={i}
                        className={`w-1 rounded-full bg-[#821c2c] transition-all duration-300 ${
                          isSnippetPlaying ? 'animate-pulse' : 'opacity-30'
                        }`}
                        style={{
                          height: isSnippetPlaying ? `${Math.max(15, h * 0.25)}px` : '4px',
                          animationDelay: `${i * 70}ms`,
                        }}
                      />
                    ))}
                  </div>

                  <div className="w-full max-w-xs mt-3 space-y-1.5">
                    <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                      <div
                        className="h-full bg-[#821c2c] transition-all duration-75"
                        style={{ width: `${snippetPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#8e877e] tabular-nums">
                      <span>{snippetElapsed.toFixed(1)}s</span>
                      <span>{isSnippetPlaying ? 'Воспроизведение...' : 'Фрагмент 5 сек'}</span>
                      <span>{snippetEffectiveDuration.toFixed(1)}s</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {guessRound.options.map((opt) => {
                    let btnStyle =
                      'bg-[#151419] border-white/[0.08] text-[#ded8ce] hover:border-white/30 hover:bg-[#1a1921]';
                    if (guessResult) {
                      if (opt.id === guessResult.correct_track_id) {
                        btnStyle = 'bg-[#1a3820] border-[#388548] text-white font-medium';
                      } else if (opt.id === selectedGuessOption) {
                        btnStyle = 'bg-[#3d1820] border-[#8a2a38] text-white';
                      } else {
                        btnStyle = 'bg-[#100f13] border-white/[0.04] text-[#635d54] opacity-40';
                      }
                    }

                    return (
                      <button
                        type="button"
                        key={opt.id}
                        disabled={guessCompleted || !!guessResult || guessSubmitting}
                        onClick={() => handleVerifyGuess(opt.id)}
                        className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer disabled:cursor-default disabled:opacity-65 ${btnStyle}`}
                      >
                        <span className="font-display text-base sm:text-lg tracking-wide font-normal line-clamp-2 block">
                          {opt.title}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {guessResult && (
                  <div className="p-4 rounded-lg bg-[#16151a] border border-white/[0.08] space-y-3 animate-fadeIn font-mono">
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
                      {guessResult.correct ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-[#48bb78]" />
                          <span className="text-[#48bb78]">
                            Верно {user ? `+${guessResult.xp_earned} XP` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-[#e53e3e]" />
                          <span className="text-[#e53e3e]">
                            Неверно {user ? `(+${guessResult.xp_earned} XP)` : ''}
                          </span>
                        </>
                      )}
                      {user && Number(guessResult.streak_bonus_percent || 0) > 0 && (
                        <span className="text-[10px] font-normal text-[#7ed6a3] border border-[#2f5e42] bg-[#102016] px-1.5 py-0.5 rounded">
                          серия +{guessResult.streak_bonus_percent}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#8e877e] flex flex-wrap items-center justify-center gap-1.5">
                      <span>Трек раунда:</span>
                      <span className="font-display text-base sm:text-lg tracking-wide text-[#f2eee9]">
                        {guessResult.track?.title}
                      </span>
                    </div>
                    {guessCompleted && (
                      <div className="text-[11px] text-[#8e877e]">
                        Следующий раунд через {guessCountdown} (00:00 / 12:00 МСК)
                      </div>
                    )}
                    {!user && (
                      <div>
                        <button
                          type="button"
                          onClick={() => openAuth('login')}
                          className="text-[11px] text-[#ded8ce] hover:text-white underline cursor-pointer"
                        >
                          {t('signInToSaveScore')}
                        </button>
                      </div>
                    )}
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShareContext({
                            type: 'game',
                            gameTitle: 'Угадай трек',
                            resultPrimary: guessResult.correct ? 'Угадан' : 'Не угадан',
                            statusLine: guessResult.track?.title || undefined,
                            xpEarned: guessResult.xp_earned,
                            username: user?.nickname || null,
                            shareUrl: `${window.location.origin}/games`,
                          })
                        }
                        className="inline-flex items-center gap-2 font-mono text-xs tracking-wider uppercase px-4 py-2.5 bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-[#f2eee9] rounded-lg transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Поделиться</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('lyrics')}
                        className="inline-flex items-center gap-2 font-mono text-xs tracking-wider uppercase px-5 py-2.5 bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] text-white rounded-lg transition-colors cursor-pointer"
                      >
                        Угадай строчку
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : guessLoading ? (
              <div className="py-12 font-mono text-xs text-[#8e877e]">Загрузка аудиофрагмента...</div>
            ) : null}
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 2: DAILY QUIZ (12h MSK, quiz_enabled, difficulty badges)
          =================================================================== */}
      {activeTab === 'quiz' && (
        <div className="max-w-2xl mx-auto space-y-5">
          {renderScheduleBar('Обновление каждые 12ч', quizChallengeDate, quizCountdown)}

          {quizError && (
            <div className="p-3 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c]">
              {quizError}
            </div>
          )}

          {quizDisabled ? (
            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-8 sm:p-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.1] flex items-center justify-center mx-auto text-[#c94a5e]">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-display text-lg uppercase tracking-wider text-[#f2eee9]">
                  Викторина временно на паузе
                </h3>
                <p className="text-sm text-[#c7c0b6]">
                  {quizDisabledMessage || 'Зайдите позже, добавляются новые вопросы'}
                </p>
              </div>
              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('lyrics')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs font-mono uppercase tracking-wider text-white transition-colors cursor-pointer"
                >
                  Угадай строчку
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('reverse')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-xs font-mono uppercase tracking-wider text-[#ded8ce] transition-colors cursor-pointer"
                >
                  Задом наперёд
                </button>
              </div>
            </div>
          ) : alreadyCompletedDaily && !quizResult ? (
            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-8 text-center space-y-4 font-mono">
              <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-[#48bb78]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display text-lg uppercase text-[#f2eee9] font-medium">
                  Викторина пройдена
                </h3>
                <p className="text-xs text-[#8e877e] mt-1 font-sans">
                  Следующий набор вопросов откроется через {quizCountdown} (00:00 / 12:00 МСК)
                </p>
              </div>

              {previousXp > 0 && (
                <div className="inline-flex items-center gap-4 px-4 py-2 rounded bg-black/40 border border-white/[0.06] text-xs">
                  <span>
                    Счёт: <strong className="text-white">{previousScore}</strong>
                  </span>
                  <span className="text-[#423d38]">|</span>
                  <span>
                    <strong className="text-[#6ee7b7]">+{previousXp} XP</strong>
                  </span>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setShareContext({
                      type: 'game',
                      gameTitle: 'Викторина',
                      resultPrimary: previousScore > 0 ? `${previousScore}` : 'Пройдено',
                      statusLine: 'Раунд завершён',
                      xpEarned: previousXp,
                      username: user?.nickname || null,
                      shareUrl: `${window.location.origin}/games`,
                    })
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-xs text-[#f2eee9] uppercase tracking-wider transition-colors cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Поделиться</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('guess')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Угадай трек
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : quizLoading ? (
            <div className="py-12 text-center font-mono text-xs text-[#8e877e]">
              Загрузка вопросов викторины...
            </div>
          ) : quizQuestions.length > 0 ? (
            <div className="space-y-5">
              {quizQuestions.map((q, idx) => {
                const questionText = lang === 'ru' ? q.question_ru : q.question_en;
                const resultItem = quizResult?.results?.find((r) => r.id === q.id);
                const diffBadge = getDifficultyBadge(q.difficulty);

                return (
                  <div
                    key={q.id}
                    className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="w-6 h-6 rounded bg-white/[0.06] text-[#8e877e] font-mono text-xs flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <h3 className="text-sm font-medium text-[#f2eee9] leading-relaxed">
                          {questionText}
                        </h3>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded border font-mono text-[10px] tracking-wide ${diffBadge.className}`}
                      >
                        {diffBadge.label}
                      </span>
                    </div>

                    <div className="space-y-2 pt-1 pl-0 sm:pl-9 font-mono">
                      {q.options.map((opt: string, optIdx: number) => {
                        const isSelected = quizAnswers[q.id] === optIdx;
                        let optStyle = isSelected
                          ? 'bg-white/[0.08] border-white/30 text-white'
                          : 'bg-[#151419] border-white/[0.06] text-[#8e877e] hover:border-white/20';

                        if (resultItem) {
                          if (optIdx === resultItem.correct_index) {
                            optStyle = 'bg-[#1a3820] border-[#388548] text-white font-medium';
                          } else if (isSelected && !resultItem.is_correct) {
                            optStyle = 'bg-[#3d1820] border-[#8a2a38] text-white';
                          }
                        }

                        return (
                          <button
                            type="button"
                            key={optIdx}
                            disabled={quizSubmitted || quizSubmitting}
                            onClick={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: optIdx }))}
                            className={`w-full text-left p-3 rounded-lg border text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${optStyle}`}
                          >
                            <span>{opt}</span>
                            {resultItem && optIdx === resultItem.correct_index && (
                              <CheckCircle2 className="w-4 h-4 text-[#48bb78] shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {resultItem && (
                      <div className="sm:pl-9 pt-2 text-xs text-[#8e877e] italic font-sans leading-relaxed">
                        {lang === 'ru' ? resultItem.explanation_ru : resultItem.explanation_en}
                      </div>
                    )}
                  </div>
                );
              })}

              {!quizSubmitted ? (
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={handleSubmitQuiz}
                    disabled={quizSubmitting || Object.keys(quizAnswers).length < quizQuestions.length}
                    className="font-mono text-xs tracking-[0.2em] uppercase px-8 py-3 bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    {quizSubmitting
                      ? 'Сохранение...'
                      : `Проверить ответы (${Object.keys(quizAnswers).length}/${quizQuestions.length})`}
                  </button>
                </div>
              ) : (
                quizResult && (
                  <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 text-center space-y-2.5 font-mono">
                    <h3 className="text-xs tracking-wider uppercase text-[#8e877e]">Результат викторины</h3>
                    <div className="text-2xl font-bold text-white">
                      {quizResult.correct_count} / {quizResult.total}
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-[#6ee7b7]">
                      <span>+{quizResult.total_xp} XP</span>
                      {Number(quizResult.streak_bonus_percent || 0) > 0 && (
                        <span className="text-[10px] border border-[#2f5e42] bg-[#102016] px-1.5 py-0.5 rounded">
                          серия +{quizResult.streak_bonus_percent}%
                        </span>
                      )}
                    </div>
                    {quizNextResetAt && (
                      <div className="text-[11px] text-[#8e877e]">
                        Новые вопросы откроются через {quizCountdown} (00:00 / 12:00 МСК)
                      </div>
                    )}
                    <div className="pt-2 flex justify-center">
                      <button
                        type="button"
                        onClick={() =>
                          setShareContext({
                            type: 'game',
                            gameTitle: 'Викторина',
                            resultPrimary: `${quizResult.correct_count} / ${quizResult.total}`,
                            statusLine:
                              quizResult.correct_count === quizResult.total
                                ? 'Идеальный результат'
                                : 'Викторина пройдена',
                            xpEarned: quizResult.total_xp,
                            username: user?.nickname || null,
                            shareUrl: `${window.location.origin}/games`,
                          })
                        }
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-xs text-[#f2eee9] uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Поделиться результатом</span>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="text-center py-8 font-mono text-xs text-[#8e877e]">
              Вопросы пока не найдены.
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          TAB 3: GUESS THE LYRIC (12h MSK)
          =================================================================== */}
      {activeTab === 'lyrics' && (
        <div className="max-w-xl mx-auto space-y-4">
          {renderScheduleBar('Обновление каждые 12ч', lyricsRound?.challenge_date, lyricsCountdown)}

          <div className="bg-[#100f13] border border-white/[0.08] p-6 sm:p-8 rounded-xl shadow-2xl space-y-6">
            <div className="text-center space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8e877e]">
                Тексты deathmarried
              </span>
              <h2 className="font-display text-lg uppercase text-[#f2eee9] font-medium tracking-wide">
                Продолжи строчку из трека
              </h2>
            </div>

            {lyricsError && (
              <div className="p-3 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c] text-center space-y-2">
                <p>{lyricsError}</p>
                <button
                  type="button"
                  onClick={loadLyricsRound}
                  className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded text-[11px] font-mono uppercase cursor-pointer"
                >
                  Повторить
                </button>
              </div>
            )}

            {lyricsRound ? (
              <div className="space-y-5">
                {/* Prompt Lyric Card */}
                <div className="rounded-xl bg-[#15141b] border border-white/[0.09] px-5 py-6 text-center space-y-2">
                  <p className="text-base sm:text-lg font-medium text-[#f5f1ec] leading-relaxed">
                    «{lyricsRound.prompt_line}»
                  </p>
                  <p className="font-mono text-xs text-[#8e877e] tracking-widest">...</p>
                </div>

                {/* 4 Shuffled Lyric Options */}
                <div className="space-y-2.5">
                  {lyricsRound.options.map((opt) => {
                    let style =
                      'bg-[#151419] border-white/[0.08] text-[#ded8ce] hover:border-white/30 hover:bg-[#1a1921]';
                    if (lyricsResult) {
                      if (opt.id === lyricsResult.correct_option_id) {
                        style = 'bg-[#1a3820] border-[#388548] text-white font-medium';
                      } else if (opt.id === selectedLyricOption) {
                        style = 'bg-[#3d1820] border-[#8a2a38] text-white';
                      } else {
                        style = 'bg-[#100f13] border-white/[0.04] text-[#635d54] opacity-40';
                      }
                    }

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={lyricsCompleted || !!lyricsResult || lyricsSubmitting}
                        onClick={() => handleVerifyLyrics(opt.id)}
                        className={`w-full p-3.5 rounded-lg border text-left text-sm transition-all cursor-pointer disabled:cursor-default disabled:opacity-65 flex items-center justify-between gap-2 ${style}`}
                      >
                        <span className="leading-snug">{opt.text}</span>
                        {lyricsResult && opt.id === lyricsResult.correct_option_id && (
                          <CheckCircle2 className="w-4 h-4 text-[#48bb78] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Result Banner */}
                {lyricsResult && (
                  <div className="p-4 rounded-lg bg-[#16151a] border border-white/[0.08] space-y-3 text-center animate-fadeIn font-mono">
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
                      {lyricsResult.correct ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-[#48bb78]" />
                          <span className="text-[#48bb78]">
                            Точно в цель {user ? `+${lyricsResult.xp_earned} XP` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-[#e53e3e]" />
                          <span className="text-[#e53e3e]">
                            Не угадано {user ? `(+${lyricsResult.xp_earned} XP)` : ''}
                          </span>
                        </>
                      )}
                      {user && Number(lyricsResult.streak_bonus_percent || 0) > 0 && (
                        <span className="text-[10px] font-normal text-[#7ed6a3] border border-[#2f5e42] bg-[#102016] px-1.5 py-0.5 rounded">
                          серия +{lyricsResult.streak_bonus_percent}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#8e877e] flex flex-wrap items-center justify-center gap-1.5">
                      <span>Трек:</span>
                      <span className="font-display text-base text-[#f2eee9]">
                        {lyricsResult.track?.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8e877e]">
                      Новая строчка через {lyricsCountdown} (00:00 / 12:00 МСК)
                    </div>
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShareContext({
                            type: 'game',
                            gameTitle: 'Угадай строчку',
                            resultPrimary: lyricsResult.correct ? 'Угадано' : 'Не угадано',
                            statusLine: lyricsResult.track?.title || undefined,
                            xpEarned: lyricsResult.xp_earned,
                            username: user?.nickname || null,
                            shareUrl: `${window.location.origin}/games`,
                          })
                        }
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-xs text-[#f2eee9] uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Поделиться</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('reverse')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] text-xs text-white uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Задом наперёд
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : lyricsLoading ? (
              <div className="py-12 text-center font-mono text-xs text-[#8e877e]">Загрузка строчки...</div>
            ) : null}
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 4: REVERSE TRACK (5s Web Audio reversed, 12h MSK)
          =================================================================== */}
      {activeTab === 'reverse' && (
        <div className="max-w-xl mx-auto space-y-4">
          {renderScheduleBar('Обновление каждые 12ч', reverseRound?.challenge_date, reverseCountdown)}

          <div className="bg-[#100f13] border border-white/[0.08] p-6 sm:p-8 rounded-xl shadow-2xl text-center space-y-6">
            <div className="space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8e877e]">
                Реверс-испытание · 5 сек
              </span>
              <h2 className="font-display text-lg uppercase text-[#f2eee9] font-medium tracking-wide">
                Угадай трек задом наперёд
              </h2>
            </div>

            {reverseError && (
              <div className="p-3 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c] space-y-2">
                <p>{reverseError}</p>
                <button
                  type="button"
                  onClick={loadReverseRound}
                  className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded text-[11px] font-mono uppercase cursor-pointer"
                >
                  Повторить
                </button>
              </div>
            )}

            {reverseRound ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    disabled={reverseAudioDecoding}
                    onClick={toggleReverseAudio}
                    className="w-16 h-16 rounded-full bg-[#241018] hover:bg-[#341520] border border-[#962337]/60 text-white flex items-center justify-center transition-all cursor-pointer hover:scale-105 shadow-lg disabled:opacity-60"
                    aria-label={reversePlaying ? 'Остановить реверс' : 'Слушать трек задом наперёд'}
                  >
                    {reverseAudioDecoding ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : reversePlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-1" />
                    )}
                  </button>

                  <div className="flex items-center gap-1 mt-4 h-6">
                    {[50, 85, 45, 95, 65, 75, 40, 90, 55, 80, 60, 70, 50].map((h, i) => (
                      <span
                        key={i}
                        className={`w-1 rounded-full bg-[#c94a5e] transition-all duration-300 ${
                          reversePlaying ? 'animate-pulse' : 'opacity-30'
                        }`}
                        style={{
                          height: reversePlaying ? `${Math.max(15, h * 0.25)}px` : '4px',
                          animationDelay: `${i * 65}ms`,
                        }}
                      />
                    ))}
                  </div>

                  <div className="w-full max-w-xs mt-3 space-y-1.5">
                    <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                      <div
                        className="h-full bg-[#c94a5e] transition-all duration-75"
                        style={{ width: `${reversePercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#8e877e] tabular-nums">
                      <span>{reverseElapsed.toFixed(1)}s</span>
                      <span>
                        {reverseAudioDecoding
                          ? 'Декодирование аудио...'
                          : reversePlaying
                            ? 'Играет задом наперёд...'
                            : 'Нажмите, чтобы слушать'}
                      </span>
                      <span>{reverseDuration.toFixed(1)}s</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {reverseRound.options.map((opt) => {
                    let btnStyle =
                      'bg-[#151419] border-white/[0.08] text-[#ded8ce] hover:border-white/30 hover:bg-[#1a1921]';
                    if (reverseResult) {
                      if (opt.id === reverseResult.correct_track_id) {
                        btnStyle = 'bg-[#1a3820] border-[#388548] text-white font-medium';
                      } else if (opt.id === selectedReverseOption) {
                        btnStyle = 'bg-[#3d1820] border-[#8a2a38] text-white';
                      } else {
                        btnStyle = 'bg-[#100f13] border-white/[0.04] text-[#635d54] opacity-40';
                      }
                    }

                    return (
                      <button
                        type="button"
                        key={opt.id}
                        disabled={reverseCompleted || !!reverseResult || reverseSubmitting}
                        onClick={() => handleVerifyReverse(opt.id)}
                        className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer disabled:cursor-default disabled:opacity-65 ${btnStyle}`}
                      >
                        <span className="font-display text-base sm:text-lg tracking-wide font-normal line-clamp-2 block">
                          {opt.title}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {reverseResult && (
                  <div className="p-4 rounded-lg bg-[#16151a] border border-white/[0.08] space-y-3 animate-fadeIn font-mono">
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
                      {reverseResult.correct ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-[#48bb78]" />
                          <span className="text-[#48bb78]">
                            Верно {user ? `+${reverseResult.xp_earned} XP` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-[#e53e3e]" />
                          <span className="text-[#e53e3e]">
                            Неверно {user ? `(+${reverseResult.xp_earned} XP)` : ''}
                          </span>
                        </>
                      )}
                      {user && Number(reverseResult.streak_bonus_percent || 0) > 0 && (
                        <span className="text-[10px] font-normal text-[#7ed6a3] border border-[#2f5e42] bg-[#102016] px-1.5 py-0.5 rounded">
                          серия +{reverseResult.streak_bonus_percent}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#8e877e] flex flex-wrap items-center justify-center gap-1.5">
                      <span>Трек раунда:</span>
                      <span className="font-display text-base sm:text-lg text-[#f2eee9]">
                        {reverseResult.track?.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8e877e]">
                      Новый трек через {reverseCountdown} (00:00 / 12:00 МСК)
                    </div>
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShareContext({
                            type: 'game',
                            gameTitle: 'Задом наперёд',
                            resultPrimary: reverseResult.correct ? 'Угадан' : 'Не угадан',
                            statusLine: reverseResult.track?.title || undefined,
                            xpEarned: reverseResult.xp_earned,
                            username: user?.nickname || null,
                            shareUrl: `${window.location.origin}/games`,
                          })
                        }
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-xs text-[#f2eee9] uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Поделиться</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('speed')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] text-xs text-white uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        0.5x / 2.5x
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : reverseLoading ? (
              <div className="py-12 font-mono text-xs text-[#8e877e]">Загрузка реверс-раунда...</div>
            ) : null}
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 5: SPEED TRACK 0.5x / 2.5x (5s real time, pitch-shifted, 12h MSK)
          =================================================================== */}
      {activeTab === 'speed' && (
        <div className="max-w-xl mx-auto space-y-4">
          {renderScheduleBar('Обновление каждые 12ч', speedRound?.challenge_date, speedCountdown)}

          <div className="bg-[#100f13] border border-white/[0.08] p-6 sm:p-8 rounded-xl shadow-2xl text-center space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-white/[0.12] bg-white/[0.05] font-mono text-[11px] uppercase tracking-wider text-[#f2eee9]">
                <Gauge className="w-3.5 h-3.5 text-[#c94a5e]" />
                <span>
                  {speedRound?.speed_mode === 2.5
                    ? 'Режим 2.5x · Ускорено'
                    : 'Режим 0.5x · Замедленно'}
                </span>
              </div>
              <h2 className="font-display text-lg uppercase text-[#f2eee9] font-medium tracking-wide">
                Угадай трек на изменённой скорости
              </h2>
            </div>

            {speedError && (
              <div className="p-3 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c] space-y-2">
                <p>{speedError}</p>
                <button
                  type="button"
                  onClick={loadSpeedRound}
                  className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.14] text-white rounded text-[11px] font-mono uppercase cursor-pointer"
                >
                  Повторить
                </button>
              </div>
            )}

            {speedRound ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    disabled={speedAudioDecoding}
                    onClick={toggleSpeedAudio}
                    className="w-16 h-16 rounded-full bg-[#1a1524] hover:bg-[#251d33] border border-white/[0.18] text-white flex items-center justify-center transition-all cursor-pointer hover:scale-105 shadow-lg disabled:opacity-60"
                    aria-label={speedPlaying ? 'Остановить' : 'Слушать 5-секундный фрагмент'}
                  >
                    {speedAudioDecoding ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : speedPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current ml-1" />
                    )}
                  </button>

                  <div className="flex items-center gap-1 mt-4 h-6">
                    {[35, 70, 55, 95, 60, 85, 50, 90, 45, 75, 65, 80, 40].map((h, i) => (
                      <span
                        key={i}
                        className={`w-1 rounded-full bg-[#b42b42] transition-all duration-300 ${
                          speedPlaying ? 'animate-pulse' : 'opacity-30'
                        }`}
                        style={{
                          height: speedPlaying ? `${Math.max(15, h * 0.25)}px` : '4px',
                          animationDelay: `${i * (speedRound.speed_mode === 2.5 ? 35 : 110)}ms`,
                        }}
                      />
                    ))}
                  </div>

                  <div className="w-full max-w-xs mt-3 space-y-1.5">
                    <div className="h-1 w-full rounded-full bg-white/[0.07] overflow-hidden">
                      <div
                        className="h-full bg-[#b42b42] transition-all duration-75"
                        style={{ width: `${speedPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between font-mono text-[10px] text-[#8e877e] tabular-nums">
                      <span>{speedElapsed.toFixed(1)}s</span>
                      <span>
                        {speedAudioDecoding
                          ? 'Декодирование аудио...'
                          : speedPlaying
                            ? `Играет в ${speedRound.speed_mode === 2.5 ? '2.5x' : '0.5x'}...`
                            : '5 секунд звучания'}
                      </span>
                      <span>{speedDuration.toFixed(1)}s</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  {speedRound.options.map((opt) => {
                    let btnStyle =
                      'bg-[#151419] border-white/[0.08] text-[#ded8ce] hover:border-white/30 hover:bg-[#1a1921]';
                    if (speedResult) {
                      if (opt.id === speedResult.correct_track_id) {
                        btnStyle = 'bg-[#1a3820] border-[#388548] text-white font-medium';
                      } else if (opt.id === selectedSpeedOption) {
                        btnStyle = 'bg-[#3d1820] border-[#8a2a38] text-white';
                      } else {
                        btnStyle = 'bg-[#100f13] border-white/[0.04] text-[#635d54] opacity-40';
                      }
                    }

                    return (
                      <button
                        type="button"
                        key={opt.id}
                        disabled={speedCompleted || !!speedResult || speedSubmitting}
                        onClick={() => handleVerifySpeed(opt.id)}
                        className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer disabled:cursor-default disabled:opacity-65 ${btnStyle}`}
                      >
                        <span className="font-display text-base sm:text-lg tracking-wide font-normal line-clamp-2 block">
                          {opt.title}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {speedResult && (
                  <div className="p-4 rounded-lg bg-[#16151a] border border-white/[0.08] space-y-3 animate-fadeIn font-mono">
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold">
                      {speedResult.correct ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-[#48bb78]" />
                          <span className="text-[#48bb78]">
                            Верно {user ? `+${speedResult.xp_earned} XP` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-[#e53e3e]" />
                          <span className="text-[#e53e3e]">
                            Неверно {user ? `(+${speedResult.xp_earned} XP)` : ''}
                          </span>
                        </>
                      )}
                      {user && Number(speedResult.streak_bonus_percent || 0) > 0 && (
                        <span className="text-[10px] font-normal text-[#7ed6a3] border border-[#2f5e42] bg-[#102016] px-1.5 py-0.5 rounded">
                          серия +{speedResult.streak_bonus_percent}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#8e877e] flex flex-wrap items-center justify-center gap-1.5">
                      <span>Трек раунда:</span>
                      <span className="font-display text-base sm:text-lg text-[#f2eee9]">
                        {speedResult.track?.title}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#8e877e]">
                      Новый трек через {speedCountdown} (00:00 / 12:00 МСК)
                    </div>
                    <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setShareContext({
                            type: 'game',
                            gameTitle:
                              (speedResult.speed_mode || speedRound.speed_mode) === 2.5
                                ? 'Трек в 2.5x'
                                : 'Трек в 0.5x',
                            resultPrimary: speedResult.correct ? 'Угадан' : 'Не угадан',
                            statusLine: speedResult.track?.title || undefined,
                            xpEarned: speedResult.xp_earned,
                            username: user?.nickname || null,
                            shareUrl: `${window.location.origin}/games`,
                          })
                        }
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#821c2c]/30 hover:bg-[#821c2c]/50 border border-[#a4283c]/70 text-xs text-[#f2eee9] uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Поделиться</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('leaderboard')}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] text-xs text-white uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Рейтинг
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : speedLoading ? (
              <div className="py-12 font-mono text-xs text-[#8e877e]">Загрузка раунда...</div>
            ) : null}
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB 6: LEADERBOARD
          =================================================================== */}
      {activeTab === 'leaderboard' && (
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="flex flex-col items-center justify-center gap-3 font-mono text-xs">
            <div className="flex items-center gap-1.5">
              {(['all', 'weekly', 'monthly'] as const).map((tf) => (
                <button
                  type="button"
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-3.5 py-1.5 rounded transition-colors cursor-pointer uppercase tracking-wider ${
                    timeframe === tf
                      ? 'bg-white/[0.08] text-white border border-white/[0.15]'
                      : 'text-[#8e877e] hover:text-[#ded8ce]'
                  }`}
                >
                  {tf === 'all' ? t('allTime') : tf === 'weekly' ? t('weekly') : t('monthly')}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'Все игры' },
                  { id: 'guess-track', label: 'Угадай трек' },
                  { id: 'daily-quiz', label: 'Викторина' },
                  { id: 'guess-lyrics', label: 'Строчка' },
                  { id: 'reverse-track', label: 'Реверс' },
                  { id: 'speed-track', label: '0.5x / 2.5x' },
                ] as const
              ).map((g) => (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => setLeaderboardGame(g.id)}
                  className={`px-3 py-1.5 rounded transition-colors cursor-pointer uppercase tracking-wider text-[11px] ${
                    leaderboardGame === g.id
                      ? 'bg-[#821c2c]/30 text-[#f5c6cb] border border-[#821c2c]/60'
                      : 'text-[#8e877e] hover:text-[#ded8ce]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden font-mono text-xs shadow-2xl">
            <div className="grid grid-cols-12 px-4 py-3 border-b border-white/[0.06] text-[10px] tracking-wider uppercase text-[#736c64]">
              <span className="col-span-2 sm:col-span-1">{t('rank')}</span>
              <span className="col-span-6 sm:col-span-7">{t('apostle')}</span>
              <span className="col-span-2 text-center">{t('level')}</span>
              <span className="col-span-2 text-right">
                {timeframe === 'all' && leaderboardGame === 'all'
                  ? lang === 'ru' ? 'Всего XP' : 'Total XP'
                  : t('xp')}
              </span>
            </div>

            {leadersLoading ? (
              <div className="py-12 text-center text-xs text-[#8e877e]">Загрузка таблицы лидеров...</div>
            ) : leaderboard.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#8e877e]">{t('leaderboardEmpty')}</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {leaderboard.map((lead, idx) => {
                  const rankNum = idx + 1;
                  return (
                    <button
                      type="button"
                      key={lead.id}
                      onClick={() => window.dispatchEvent(new CustomEvent('navigate-profile', { detail: lead.nickname }))}
                      className={`w-full text-left grid grid-cols-12 items-center px-4 py-3 transition-colors cursor-pointer ${
                        user?.id === lead.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <span
                        className={`col-span-2 sm:col-span-1 font-bold ${
                          rankNum === 1
                            ? 'text-[#f2eee9]'
                            : rankNum === 2
                              ? 'text-[#c5c8cf]'
                              : rankNum === 3
                                ? 'text-[#a39b8b]'
                                : 'text-[#736c64]'
                        }`}
                      >
                        {rankNum < 10 ? `0${rankNum}` : rankNum}
                      </span>

                      <div className="col-span-6 sm:col-span-7 flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-full overflow-hidden bg-black shrink-0 ${
                            lead.equipped_frame || 'border border-white/10'
                          }`}
                        >
                          <img
                            src={lead.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                            alt={lead.nickname}
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        </div>

                        <div className="min-w-0 flex flex-col">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className={`truncate font-medium ${lead.equipped_name_style || 'text-white'}`}>
                              {lead.display_name || lead.nickname}
                            </span>
                            {lead.equipped_badge && renderEquippedBadge(lead.equipped_badge, lang, true)}
                            {lead.equipped_title && renderEquippedTitle(lead.equipped_title, lang, true)}
                          </div>
                          <span className="text-[10px] text-[#736c64] truncate">
                            {formatHandle(lead.nickname)}
                          </span>
                        </div>

                        {Boolean(lead.daily_streak && lead.daily_streak >= 3) && (
                          <span className="text-[10px] text-[#8e877e] flex items-center gap-0.5 shrink-0">
                            <Flame className="w-3 h-3 text-[#821c2c]" />
                            {lead.daily_streak}
                          </span>
                        )}
                      </div>

                      <span className="col-span-2 text-center font-bold text-[#f2eee9]">L{lead.level}</span>
                      <span className="col-span-2 text-right font-semibold text-[#ded8ce] tabular-nums">
                        {timeframe === 'all' && leaderboardGame === 'all'
                          ? lead.total_xp ?? lead.xp
                          : lead.xp}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
