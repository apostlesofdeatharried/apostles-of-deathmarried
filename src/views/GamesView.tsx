import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { QuizQuestion, LeaderboardEntry } from '../types/index.js';
import { ShopModal } from '../components/ShopModal.js';
import { safeJson } from '../utils/logic.js';
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
  Sparkles,
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

export const GamesView: React.FC = () => {
  const { t, lang } = useI18n();
  const { user, refresh, openAuth } = useAuth();

  const [activeTab, setActiveTab] = useState<'guess' | 'quiz' | 'leaderboard'>('guess');
  const [isShopOpen, setIsShopOpen] = useState(false);

  // GAME 1: GUESS THE TRACK STATE
  const [guessRound, setGuessRound] = useState<{
    round_token: string;
    audio_url: string;
    snippet_start: number;
    snippet_duration: number;
    options: { id: string; title: string }[];
  } | null>(null);
  const [isSnippetPlaying, setIsSnippetPlaying] = useState(false);
  const [selectedGuessOption, setSelectedGuessOption] = useState<string | null>(null);
  const [guessResult, setGuessResult] = useState<{
    correct: boolean;
    correct_track_id: string;
    xp_earned: number;
    track: any;
  } | null>(null);
  const [guessLoading, setGuessLoading] = useState(false);
  const [guessError, setGuessError] = useState<string | null>(null);
  const snippetAudioRef = useRef<HTMLAudioElement | null>(null);
  const [guessStartTime, setGuessStartTime] = useState<number>(Date.now());

  // GAME 2: DAILY QUIZ STATE
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<{ [qId: string]: number }>({});
  const [quizStartTime, setQuizStartTime] = useState<number>(Date.now());
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [alreadyCompletedDaily, setAlreadyCompletedDaily] = useState(false);
  const [previousScore, setPreviousScore] = useState(0);
  const [previousXp, setPreviousXp] = useState(0);
  const [quizResult, setQuizResult] = useState<{
    total: number;
    correct_count: number;
    base_score: number;
    speed_bonus: number;
    total_xp: number;
    results: any[];
  } | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  // LEADERBOARD STATE
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [timeframe, setTimeframe] = useState<'all' | 'weekly' | 'monthly'>('all');
  const [leadersLoading, setLeadersLoading] = useState(false);

  // Load Guess Round with Anti-Cheat token
  const loadGuessRound = async () => {
    setGuessLoading(true);
    setGuessError(null);
    setGuessResult(null);
    setSelectedGuessOption(null);
    if (snippetAudioRef.current) {
      snippetAudioRef.current.pause();
      setIsSnippetPlaying(false);
    }
    try {
      const res = await authFetch('/api/games/guess-track/round');
      const data = await safeJson(res, null);
      if (res.ok && data) {
        setGuessRound(data);
        setGuessStartTime(Date.now());
      } else {
        setGuessRound(null);
        setGuessError(data?.error || (lang === 'ru' ? 'Не удалось загрузить аудиофрагмент.' : 'Failed to load audio round.'));
      }
    } catch (e: any) {
      setGuessRound(null);
      setGuessError(e?.message || 'Connection error');
    } finally {
      setGuessLoading(false);
    }
  };

  // Load Daily Quiz
  const loadDailyQuiz = async () => {
    setQuizLoading(true);
    setQuizSubmitted(false);
    setQuizResult(null);
    setQuizAnswers({});
    try {
      const res = await authFetch('/api/games/quiz/daily');
      const data = await safeJson(res, null);
      if (res.ok && data) {
        setQuizQuestions(data.questions || []);
        setAlreadyCompletedDaily(Boolean(data.already_completed));
        setPreviousScore(data.previous_score || 0);
        setPreviousXp(data.previous_xp || 0);
        setQuizStartTime(Date.now());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setQuizLoading(false);
    }
  };

  // Load Leaderboard
  const loadLeaderboard = async (tf: 'all' | 'weekly' | 'monthly') => {
    setLeadersLoading(true);
    try {
      const res = await fetch(`/api/games/leaderboard?timeframe=${tf}`);
      const data = await safeJson(res, null);
      if (res.ok && data) {
        setLeaderboard(data.leaders || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLeadersLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'guess') {
      loadGuessRound();
    } else if (activeTab === 'quiz') {
      loadDailyQuiz();
    } else if (activeTab === 'leaderboard') {
      loadLeaderboard(timeframe);
    }

    return () => {
      if (snippetAudioRef.current) {
        snippetAudioRef.current.pause();
      }
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      loadLeaderboard(timeframe);
    }
  }, [timeframe]);

  // Audio Snippet Play
  const toggleSnippetAudio = () => {
    if (!guessRound) return;
    setGuessError(null);
    if (!snippetAudioRef.current) {
      snippetAudioRef.current = new Audio(guessRound.audio_url);
      snippetAudioRef.current.onended = () => setIsSnippetPlaying(false);
      snippetAudioRef.current.onerror = () => {
        setIsSnippetPlaying(false);
        setGuessError(lang === 'ru' ? 'Ошибка воспроизведения аудиофайла.' : 'Audio playback error.');
      };
    } else if (new URL(snippetAudioRef.current.src, window.location.origin).pathname !== guessRound.audio_url) {
      snippetAudioRef.current.src = guessRound.audio_url;
    }

    if (isSnippetPlaying) {
      snippetAudioRef.current.pause();
      setIsSnippetPlaying(false);
    } else {
      snippetAudioRef.current.currentTime = guessRound.snippet_start || 0;
      snippetAudioRef.current
        .play()
        .then(() => setIsSnippetPlaying(true))
        .catch(() => {
          setIsSnippetPlaying(false);
          setGuessError(lang === 'ru' ? 'Браузер заблокировал воспроизведение или файл недоступен.' : 'Audio could not be played.');
        });
    }
  };

  // Verify Guess Track Answer with Server Authority
  const handleVerifyGuess = async (selectedId: string) => {
    if (!guessRound || guessResult) return;
    setSelectedGuessOption(selectedId);
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - guessStartTime) / 1000));

    try {
      const res = await authFetch('/api/games/guess-track/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          round_token: guessRound.round_token,
          selected_track_id: selectedId,
          time_spent: elapsedSeconds,
        }),
      });
      const data = await safeJson(res, null);
      if (res.ok && data) {
        setGuessResult(data);
        if (data.correct) {
          confetti({ particleCount: 35, spread: 55, origin: { y: 0.7 } });
        }
        if (user) refresh();
      } else {
        setGuessError(data?.error || (lang === 'ru' ? 'Не удалось проверить ответ.' : 'Failed to verify answer.'));
      }
    } catch (e: any) {
      setGuessError(e?.message || 'Connection error');
    }
  };

  // Submit Daily Quiz Answers
  const handleSubmitQuiz = async () => {
    if (Object.keys(quizAnswers).length < quizQuestions.length) return;
    setQuizError(null);
    const elapsedSeconds = Math.round((Date.now() - quizStartTime) / 1000);
    try {
      const res = await authFetch('/api/games/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: quizAnswers,
          time_spent_seconds: elapsedSeconds,
        }),
      });
      const data = await safeJson(res, null);
      if (res.ok && data) {
        setQuizResult(data);
        setQuizSubmitted(true);
        setAlreadyCompletedDaily(true);
        if (data.correct_count === data.total) {
          confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
        }
        if (user) refresh();
      } else {
        setQuizError(data?.error || (lang === 'ru' ? 'Не удалось отправить ответы.' : 'Failed to submit quiz.'));
      }
    } catch (e: any) {
      setQuizError(e?.message || 'Connection error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 animate-fadeIn">
      {/* XP Shop Modal */}
      <ShopModal isOpen={isShopOpen} onClose={() => setIsShopOpen(false)} />

      {/* Clean Music-Centric Header */}
      <div className="max-w-2xl mx-auto text-center space-y-2">
        <h1 className="font-display text-2xl sm:text-4xl tracking-[0.2em] uppercase text-[#f2eee9] font-medium">
          {t('gamesTitle')}
        </h1>
        <p className="text-xs sm:text-sm text-[#8e877e] leading-relaxed">
          {t('gamesSubtitle')}
        </p>

        {user ? (
          <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-3 px-4 py-2 bg-[#100f13] border border-white/[0.08] rounded-lg font-mono text-xs">
            <div className="text-[#ded8ce] font-semibold">{user.xp} XP</div>
            <span className="text-[#423d38]">·</span>
            <div className="text-[#8e877e]">{t('level').toUpperCase()} {user.level}</div>
            <span className="text-[#423d38]">·</span>
            <div className="text-[#8e877e] flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-[#821c2c]" />
              {user.daily_streak || 0} {lang === 'ru' ? 'ДНЕЙ' : 'DAYS'}
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

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-center gap-2 border-b border-white/[0.06] pb-3 font-mono text-xs">
        <button
          onClick={() => setActiveTab('guess')}
          className={`flex items-center gap-2 px-4 py-2 rounded uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === 'guess'
              ? 'bg-white/[0.08] text-white border border-white/[0.15]'
              : 'text-[#8e877e] hover:text-[#ded8ce]'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          {t('gameGuessTrack')}
        </button>

        <button
          onClick={() => setActiveTab('quiz')}
          className={`flex items-center gap-2 px-4 py-2 rounded uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === 'quiz'
              ? 'bg-white/[0.08] text-white border border-white/[0.15]'
              : 'text-[#8e877e] hover:text-[#ded8ce]'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          {t('gameDailyQuiz')}
        </button>

        <button
          onClick={() => setActiveTab('leaderboard')}
          className={`flex items-center gap-2 px-4 py-2 rounded uppercase tracking-wider transition-all cursor-pointer ${
            activeTab === 'leaderboard'
              ? 'bg-white/[0.08] text-white border border-white/[0.15]'
              : 'text-[#8e877e] hover:text-[#ded8ce]'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          {t('gameLeaderboard')}
        </button>
      </div>

      {/* TAB 1: GUESS THE TRACK */}
      {activeTab === 'guess' && (
        <div className="max-w-xl mx-auto bg-[#100f13] border border-white/[0.08] p-6 sm:p-8 rounded-xl shadow-2xl text-center space-y-6">
          <div className="space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8e877e]">
              {t('sonicTrial')}
            </span>
            <h2 className="font-display text-lg uppercase text-[#f2eee9] font-medium tracking-wide">
              {t('guessListenSnippet')}
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
                {t('tryAgain')}
              </button>
            </div>
          )}

          {guessRound ? (
            <div className="space-y-6">
              {/* Play Snippet Button & Animated Soundwave */}
              <div className="flex flex-col items-center">
                <button
                  onClick={toggleSnippetAudio}
                  className="w-16 h-16 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/[0.15] text-white flex items-center justify-center transition-all cursor-pointer hover:scale-105 shadow-lg"
                  aria-label={isSnippetPlaying ? 'Pause snippet' : 'Play audio snippet'}
                >
                  {isSnippetPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current ml-1" />
                  )}
                </button>

                {/* Animated Equalizer Soundwave */}
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

                <span className="font-mono text-xs text-[#8e877e] mt-2">
                  {isSnippetPlaying ? t('playingSnippet') : t('clickToHear')}
                </span>
              </div>

              {/* Multiple Choice Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {guessRound.options.map((opt) => {
                  let btnStyle = 'bg-[#151419] border-white/[0.08] text-[#ded8ce] hover:border-white/30 hover:bg-[#1a1921]';
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
                      key={opt.id}
                      disabled={!!guessResult}
                      onClick={() => handleVerifyGuess(opt.id)}
                      className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${btnStyle}`}
                    >
                      <span className="font-display text-base sm:text-lg tracking-wide font-normal line-clamp-2 block">{opt.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* Result Banner */}
              {guessResult && (
                <div className="p-4 rounded-lg bg-[#16151a] border border-white/[0.08] space-y-3 animate-fadeIn font-mono">
                  <div className="flex items-center justify-center gap-2 text-xs font-semibold">
                    {guessResult.correct ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-[#48bb78]" />
                        <span className="text-[#48bb78]">{t('correct')} +{guessResult.xp_earned} XP</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-[#e53e3e]" />
                        <span className="text-[#e53e3e]">
                          {t('wrong')} (+{guessResult.xp_earned} XP)
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-[#8e877e] flex flex-wrap items-center justify-center gap-1.5">
                    <span>{lang === 'ru' ? 'Правильный трек:' : 'Correct track:'}</span>
                    <span className="font-display text-base sm:text-lg tracking-wide text-[#f2eee9] font-normal">
                      {guessResult.track?.title}
                    </span>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={loadGuessRound}
                      className="font-mono text-xs tracking-wider uppercase px-5 py-2.5 bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] text-white rounded-lg transition-colors cursor-pointer"
                    >
                      {t('guessNextRound')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : guessLoading ? (
            <div className="py-12 font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Загрузка аудиофрагмента...' : 'Loading audio fragment...'}
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 2: DAILY QUIZ */}
      {activeTab === 'quiz' && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-[#100f13] border border-white/[0.08] p-4 rounded-lg flex items-center justify-between font-mono text-xs">
            <div className="flex items-center gap-2 text-[#ded8ce]">
              <Calendar className="w-4 h-4 text-[#8e877e]" />
              <span>{t('dailyQuizNotice')}</span>
            </div>
            <span className="text-[11px] text-[#8e877e]">
              {new Date().toISOString().split('T')[0]}
            </span>
          </div>

          {quizError && (
            <div className="p-3 rounded bg-[#240b10] border border-[#721b2b] text-xs text-[#e8909c]">
              {quizError}
            </div>
          )}

          {/* If already completed today */}
          {alreadyCompletedDaily && !quizResult ? (
            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-8 text-center space-y-4 font-mono">
              <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center mx-auto text-[#48bb78]">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display text-lg uppercase text-[#f2eee9] font-medium">
                  {t('dailyQuizComplete')}
                </h3>
                <p className="text-xs text-[#8e877e] mt-1 font-sans">
                  {t('returnTomorrow')}
                </p>
              </div>

              {previousXp > 0 && (
                <div className="inline-flex items-center gap-4 px-4 py-2 rounded bg-black/40 border border-white/[0.06] text-xs">
                  <span>{t('score')}: <strong className="text-white">{previousScore}</strong></span>
                  <span className="text-[#423d38]">|</span>
                  <span><strong className="text-[#6ee7b7]">+{previousXp} XP</strong></span>
                </div>
              )}

              <div className="pt-2">
                <button
                  onClick={() => setActiveTab('guess')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white uppercase tracking-wider transition-colors cursor-pointer"
                >
                  {t('gameGuessTrack')}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : quizLoading ? (
            <div className="py-12 text-center font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Загрузка вопросов викторины...' : 'Loading quiz questions...'}
            </div>
          ) : quizQuestions.length > 0 ? (
            <div className="space-y-6">
              {quizQuestions.map((q, idx) => {
                const questionText = lang === 'ru' ? q.question_ru : q.question_en;
                const resultItem = quizResult?.results?.find((r) => r.id === q.id);

                return (
                  <div
                    key={q.id}
                    className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded bg-white/[0.06] text-[#8e877e] font-mono text-xs flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <h3 className="text-sm font-medium text-[#f2eee9] leading-relaxed">
                        {questionText}
                      </h3>
                    </div>

                    <div className="space-y-2 pt-1 pl-9 font-mono">
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
                            key={optIdx}
                            disabled={quizSubmitted}
                            onClick={() =>
                              setQuizAnswers((prev) => ({ ...prev, [q.id]: optIdx }))
                            }
                            className={`w-full text-left p-3 rounded-lg border text-xs transition-colors flex items-center justify-between cursor-pointer ${optStyle}`}
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
                      <div className="pl-9 pt-2 text-xs text-[#8e877e] italic font-sans leading-relaxed">
                        {lang === 'ru' ? resultItem.explanation_ru : resultItem.explanation_en}
                      </div>
                    )}
                  </div>
                );
              })}

              {!quizSubmitted ? (
                <div className="text-center pt-2">
                  <button
                    onClick={handleSubmitQuiz}
                    disabled={Object.keys(quizAnswers).length < quizQuestions.length}
                    className="font-mono text-xs tracking-[0.2em] uppercase px-8 py-3 bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer"
                  >
                    {t('submitAnswers')} ({Object.keys(quizAnswers).length}/{quizQuestions.length})
                  </button>
                </div>
              ) : (
                quizResult && (
                  <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 text-center space-y-2 font-mono">
                    <h3 className="text-xs tracking-wider uppercase text-[#8e877e]">
                      {t('dailyQuizScore')}
                    </h3>
                    <div className="text-2xl font-bold text-white">
                      {quizResult.correct_count} / {quizResult.total}
                    </div>
                    <div className="text-xs text-[#6ee7b7]">
                      +{quizResult.total_xp} XP
                    </div>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="text-center py-8 font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Вопросы на сегодня не найдены.' : 'No questions available today.'}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LEADERBOARD WITH COSMETICS */}
      {activeTab === 'leaderboard' && (
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center justify-center gap-2 font-mono text-xs">
            {(['all', 'weekly', 'monthly'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-4 py-1.5 rounded transition-colors cursor-pointer uppercase tracking-wider ${
                  timeframe === tf
                    ? 'bg-white/[0.08] text-white border border-white/[0.15]'
                    : 'text-[#8e877e] hover:text-[#ded8ce]'
                }`}
              >
                {tf === 'all' ? t('allTime') : tf === 'weekly' ? t('weekly') : t('monthly')}
              </button>
            ))}
          </div>

          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden font-mono text-xs shadow-2xl">
            <div className="grid grid-cols-12 px-4 py-3 border-b border-white/[0.06] text-[10px] tracking-wider uppercase text-[#736c64]">
              <span className="col-span-2 sm:col-span-1">{t('rank')}</span>
              <span className="col-span-6 sm:col-span-7">{t('apostle')}</span>
              <span className="col-span-2 text-center">{t('level')}</span>
              <span className="col-span-2 text-right">{t('xp')}</span>
            </div>

            {leadersLoading ? (
              <div className="py-12 text-center text-xs text-[#8e877e]">
                {lang === 'ru' ? 'Загрузка таблицы лидеров...' : 'Loading leaderboard...'}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#8e877e]">
                {t('leaderboardEmpty')}
              </div>
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
                      <span className={`col-span-2 sm:col-span-1 font-bold ${
                        rankNum === 1 ? 'text-[#f2eee9]' : rankNum === 2 ? 'text-[#c5c8cf]' : rankNum === 3 ? 'text-[#a39b8b]' : 'text-[#736c64]'
                      }`}>
                        {rankNum < 10 ? `0${rankNum}` : rankNum}
                      </span>

                      <div className="col-span-6 sm:col-span-7 flex items-center gap-2.5 min-w-0">
                        {/* Avatar with equipped frame cosmetic */}
                        <div className={`w-7 h-7 rounded-full overflow-hidden bg-black shrink-0 ${lead.equipped_frame || 'border border-white/10'}`}>
                          <img
                            src={lead.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                            alt={lead.nickname}
                            className="w-full h-full object-cover"
                          />
                        </div>

                        {/* Name with equipped name style */}
                        <span className={`truncate font-medium ${lead.equipped_name_style || 'text-white'}`}>
                          {lead.display_name || lead.nickname}
                        </span>

                        {/* Equipped badge cosmetic */}
                        {lead.equipped_badge && (
                          <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.2 rounded bg-white/[0.06] border border-white/15 text-[#ded8ce]">
                            {lead.equipped_badge}
                          </span>
                        )}

                        {Boolean(lead.daily_streak && lead.daily_streak >= 3) && (
                          <span className="text-[10px] text-[#8e877e] flex items-center gap-0.5">
                            <Flame className="w-3 h-3 text-[#821c2c]" />
                            {lead.daily_streak}
                          </span>
                        )}
                      </div>

                      <span className="col-span-2 text-center text-[#8e877e]">
                        L{lead.level}
                      </span>
                      <span className="col-span-2 text-right font-semibold text-[#ded8ce]">
                        {lead.xp}
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
