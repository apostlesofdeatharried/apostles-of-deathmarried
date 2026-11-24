import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Upload,
  RotateCcw,
  Edit2,
  Trash2,
  Shuffle,
  Check,
  Power,
} from 'lucide-react';
import { authFetch } from '../../context/AuthContext.js';
import { safeJson } from '../../utils/logic.js';

interface Props {
  lang: 'ru' | 'en';
  quizQuestionsList: any[];
  quizPoolMeta: {
    custom_active_count: number;
    generated_pool_count: number;
    total_pool_count: number;
  } | null;
  onRefresh: () => Promise<void> | void;
  onRequestDeleteQuiz: (q: { id: string; question_ru: string }) => void;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}

export const AdminQuizTab: React.FC<Props> = ({
  lang,
  quizQuestionsList,
  quizPoolMeta,
  onRefresh,
  onRequestDeleteQuiz,
  onNotify,
  onError,
}) => {
  const [quizEnabled, setQuizEnabled] = useState(true);
  const [activeQuizIds, setActiveQuizIds] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  // Form state
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [quizQuestionRu, setQuizQuestionRu] = useState('');
  const [quizQuestionEn, setQuizQuestionEn] = useState('');
  const [quizOpt0, setQuizOpt0] = useState('');
  const [quizOpt1, setQuizOpt1] = useState('');
  const [quizOpt2, setQuizOpt2] = useState('');
  const [quizOpt3, setQuizOpt3] = useState('');
  const [quizCorrectIndex, setQuizCorrectIndex] = useState('0');
  const [quizExplanationRu, setQuizExplanationRu] = useState('');
  const [quizDifficulty, setQuizDifficulty] = useState('1');
  const [savingQuiz, setSavingQuiz] = useState(false);

  // Bulk import
  const [bulkQuizOpen, setBulkQuizOpen] = useState(false);
  const [bulkQuizText, setBulkQuizText] = useState('');
  const [importingBulkQuiz, setImportingBulkQuiz] = useState(false);

  const loadSettings = async () => {
    try {
      const res = await authFetch('/api/admin/quiz/settings', { cache: 'no-store' });
      const data = await safeJson<{ quiz_enabled?: boolean; active_quiz_ids?: string[] }>(res, {});
      if (res.ok) {
        if (typeof data.quiz_enabled === 'boolean') setQuizEnabled(data.quiz_enabled);
        if (Array.isArray(data.active_quiz_ids)) setActiveQuizIds(data.active_quiz_ids);
      }
    } catch {}
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleToggleQuizEnabled = async () => {
    if (savingSettings) return;
    const nextVal = !quizEnabled;
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/admin/quiz/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_enabled: nextVal }),
      });
      const data = await safeJson<{ quiz_enabled?: boolean; error?: string }>(res, {});
      if (res.ok) {
        setQuizEnabled(Boolean(data.quiz_enabled ?? nextVal));
        onNotify(
          nextVal
            ? lang === 'ru' ? 'Викторина дня включена' : 'Daily Quiz enabled'
            : lang === 'ru' ? 'Викторина дня временно отключена' : 'Daily Quiz disabled'
        );
      } else {
        onError(data.error || 'Failed to update quiz status');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSavePinnedIds = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/admin/quiz/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_quiz_ids: activeQuizIds }),
      });
      const data = await safeJson<{ active_quiz_ids?: string[]; error?: string }>(res, {});
      if (res.ok) {
        setActiveQuizIds(data.active_quiz_ids || []);
        onNotify(
          (data.active_quiz_ids || []).length > 0
            ? lang === 'ru'
              ? `Сохранена ручная подборка (${data.active_quiz_ids?.length} вопр.)`
              : `Saved manual set (${data.active_quiz_ids?.length} questions)`
            : lang === 'ru'
              ? 'Включён автоматический ежедневный подбор'
              : 'Switched to automatic daily selection'
        );
      } else {
        onError(data.error || 'Failed to save active quiz questions');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRandomize = async (mode: 'pick5' | 'auto') => {
    if (savingSettings) return;
    setSavingSettings(true);
    try {
      const res = await authFetch('/api/admin/quiz/randomize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await safeJson<{ active_quiz_ids?: string[]; error?: string }>(res, {});
      if (res.ok) {
        setActiveQuizIds(data.active_quiz_ids || []);
        onNotify(
          mode === 'pick5'
            ? lang === 'ru'
              ? `Случайно выбраны ${data.active_quiz_ids?.length || 0} вопросов для текущего цикла`
              : `Randomly selected ${data.active_quiz_ids?.length || 0} questions`
            : lang === 'ru'
              ? 'Сброшено в авто-режим (5 случайных вопросов по расписанию)'
              : 'Reset to auto-rotation mode'
        );
      } else {
        onError(data.error || 'Failed to randomize quiz');
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleActiveQuizId = (id: string) => {
    setActiveQuizIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id].slice(0, 20)
    );
  };

  const resetQuizForm = () => {
    setEditingQuizId(null);
    setQuizQuestionRu('');
    setQuizQuestionEn('');
    setQuizOpt0('');
    setQuizOpt1('');
    setQuizOpt2('');
    setQuizOpt3('');
    setQuizCorrectIndex('0');
    setQuizExplanationRu('');
    setQuizDifficulty('1');
  };

  const handleEditQuizQuestion = (q: any) => {
    let parsedOpts: string[] = [];
    try {
      parsedOpts = Array.isArray(q.options) ? q.options : JSON.parse(q.options_json || '[]');
    } catch {
      parsedOpts = [];
    }
    setEditingQuizId(q.id);
    setQuizQuestionRu(q.question_ru || '');
    setQuizQuestionEn(q.question_en || '');
    setQuizOpt0(parsedOpts[0] || '');
    setQuizOpt1(parsedOpts[1] || '');
    setQuizOpt2(parsedOpts[2] || '');
    setQuizOpt3(parsedOpts[3] || '');
    setQuizCorrectIndex(String(q.correct_index ?? 0));
    setQuizExplanationRu(q.explanation_ru || '');
    setQuizDifficulty(String(q.difficulty ?? 1));
  };

  const handleSaveQuizQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingQuiz) return;
    const opts = [quizOpt0.trim(), quizOpt1.trim(), quizOpt2.trim(), quizOpt3.trim()].filter(Boolean);
    if (!quizQuestionRu.trim() || opts.length < 2) {
      onError(lang === 'ru' ? 'Введите вопрос и минимум 2 варианта ответа' : 'Provide question and at least 2 options');
      return;
    }
    const payload = {
      question_ru: quizQuestionRu.trim(),
      question_en: quizQuestionEn.trim() || quizQuestionRu.trim(),
      options: opts,
      correct_index: Math.min(parseInt(quizCorrectIndex, 10) || 0, opts.length - 1),
      explanation_ru: quizExplanationRu.trim(),
      explanation_en: quizExplanationRu.trim(),
      difficulty: parseInt(quizDifficulty, 10) || 1,
    };
    setSavingQuiz(true);
    try {
      const res = editingQuizId
        ? await authFetch(`/api/admin/quiz-questions/${editingQuizId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch('/api/admin/quiz-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (res.ok) {
        onNotify(
          editingQuizId
            ? lang === 'ru' ? 'Вопрос викторины обновлён' : 'Quiz question updated'
            : lang === 'ru' ? 'Вопрос викторины добавлен' : 'Quiz question added'
        );
        resetQuizForm();
        await onRefresh();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        onError(data.error || (lang === 'ru' ? 'Не удалось сохранить вопрос' : 'Failed to save question'));
      }
    } catch (e: any) {
      onError(e?.message || 'Network error');
    } finally {
      setSavingQuiz(false);
    }
  };

  const handleBulkImportQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (importingBulkQuiz || !bulkQuizText.trim()) return;
    setImportingBulkQuiz(true);
    try {
      const res = await authFetch('/api/admin/quiz-questions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: bulkQuizText }),
      });
      const data = await safeJson<{
        imported_count?: number;
        skipped_count?: number;
        error?: string;
      }>(res, {});
      if (res.ok) {
        onNotify(
          lang === 'ru'
            ? `Импортировано вопросов: ${data.imported_count || 0}`
            : `Imported ${data.imported_count || 0} questions`
        );
        setBulkQuizText('');
        setBulkQuizOpen(false);
        await onRefresh();
      } else {
        onError(data.error || (lang === 'ru' ? 'Ошибка импорта' : 'Import failed'));
      }
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setImportingBulkQuiz(false);
    }
  };

  return (
    <motion.div
      key="quiz"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Quiz Controls Header */}
      <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-white">
              <Sparkles className="w-4 h-4 text-[#c49298]" />
              <span className="uppercase tracking-wider font-medium">
                {lang === 'ru' ? 'Управление викториной' : 'Daily Quiz Control'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ash">
              <span className="px-2 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-white">
                {lang === 'ru' ? 'Всего в пуле' : 'Total pool'}: {quizPoolMeta?.total_pool_count ?? quizQuestionsList.length}
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1a3820]/50 border border-[#388548]/50 text-[#6ee7b7]">
                {lang === 'ru' ? 'Авто из дискографии' : 'Auto from discography'}: {quizPoolMeta?.generated_pool_count ?? 0}
              </span>
              <span className="px-2 py-0.5 rounded bg-[#821c2c]/25 border border-[#821c2c]/50 text-[#f5c6cb]">
                {lang === 'ru' ? 'Ручных в БД' : 'Custom in DB'}: {quizPoolMeta?.custom_active_count ?? quizQuestionsList.length}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-700/50 text-amber-200">
                {activeQuizIds.length > 0
                  ? lang === 'ru' ? `Закреплено: ${activeQuizIds.length}` : `Pinned: ${activeQuizIds.length}`
                  : lang === 'ru' ? 'Режим: Авто-ротация' : 'Mode: Auto-rotation'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <button
              type="button"
              disabled={savingSettings}
              onClick={handleToggleQuizEnabled}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border uppercase tracking-wider cursor-pointer disabled:opacity-50 ${
                quizEnabled
                  ? 'bg-[#1a3820] border-[#388548] text-[#6ee7b7]'
                  : 'bg-red-950/60 border-red-800 text-red-200'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>
                {quizEnabled
                  ? lang === 'ru' ? 'Викторина ВКЛ' : 'Quiz ON'
                  : lang === 'ru' ? 'Викторина ВЫКЛ' : 'Quiz OFF'}
              </span>
            </button>

            <button
              type="button"
              disabled={savingSettings}
              onClick={() => handleRandomize('pick5')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-white uppercase tracking-wider cursor-pointer disabled:opacity-50"
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>{lang === 'ru' ? 'Рандом 5' : 'Random 5'}</span>
            </button>

            <button
              type="button"
              disabled={savingSettings}
              onClick={() => handleRandomize('auto')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-bone uppercase tracking-wider cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{lang === 'ru' ? 'Авто-режим' : 'Auto Mode'}</span>
            </button>

            <button
              type="button"
              onClick={() => setBulkQuizOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.14] text-white uppercase tracking-wider cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'ru' ? 'Массовый импорт' : 'Bulk Import'}</span>
            </button>
          </div>
        </div>

        {bulkQuizOpen && (
          <form onSubmit={handleBulkImportQuiz} className="pt-3 border-t border-white/[0.08] space-y-3">
            <div className="text-[11px] text-ash font-sans leading-relaxed">
              {lang === 'ru'
                ? 'Вставьте список вопросов — по одному на строку в формате «Вопрос | Вариант A | Вариант B | Вариант C | Вариант D | Номер правильного (1-4) | Пояснение | Сложность (1-3)» или JSON-массив.'
                : 'Paste one question per line as "Question | Option A | Option B | Option C | Option D | Correct (1-4) | Explanation | Difficulty (1-3)" or JSON array.'}
            </div>
            <textarea
              rows={5}
              value={bulkQuizText}
              onChange={(e) => setBulkQuizText(e.target.value)}
              placeholder="В каком году вышел альбом «deathmarried»? | 2024 | 2025 | 2026 | 2023 | 2 | Альбом вышел в 2025 году | 1"
              className="w-full px-3 py-2.5 bg-[#16151a] border border-white/[0.12] rounded-lg text-xs font-mono text-white placeholder:text-ash/40 focus:outline-none focus:border-[#821c2c]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkQuizOpen(false)}
                className="px-3.5 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-ash hover:text-white cursor-pointer"
              >
                {lang === 'ru' ? 'Отмена' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={importingBulkQuiz || !bulkQuizText.trim()}
                className="px-4 py-2 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-xs font-mono uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer"
              >
                {importingBulkQuiz
                  ? lang === 'ru' ? 'Импорт...' : 'Importing...'
                  : lang === 'ru' ? 'Импортировать' : 'Import'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Add/Edit + Pinned Selection List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <h3 className="font-title text-xl text-ivory font-light uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#c49298]" />
              <span>
                {editingQuizId
                  ? lang === 'ru' ? 'Редактировать вопрос' : 'Edit Question'
                  : lang === 'ru' ? 'Добавить вопрос викторины' : 'Add Quiz Question'}
              </span>
            </h3>
            {editingQuizId && (
              <button
                type="button"
                onClick={resetQuizForm}
                className="font-mono text-[10px] uppercase text-ash hover:text-white flex items-center gap-1 cursor-pointer px-2 py-1 bg-white/[0.04] rounded"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{lang === 'ru' ? 'Сброс' : 'Reset'}</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSaveQuizQuestion} className="space-y-3 text-xs font-sans">
            <input
              type="text"
              required
              value={quizQuestionRu}
              onChange={(e) => setQuizQuestionRu(e.target.value)}
              placeholder={lang === 'ru' ? 'Текст вопроса (RU) *' : 'Question text (RU) *'}
              className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
            />
            <input
              type="text"
              value={quizQuestionEn}
              onChange={(e) => setQuizQuestionEn(e.target.value)}
              placeholder={lang === 'ru' ? 'Текст вопроса (EN, опционально)' : 'Question text (EN, optional)'}
              className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required value={quizOpt0} onChange={(e) => setQuizOpt0(e.target.value)} placeholder="A *" className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded text-white" />
              <input type="text" required value={quizOpt1} onChange={(e) => setQuizOpt1(e.target.value)} placeholder="B *" className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded text-white" />
              <input type="text" value={quizOpt2} onChange={(e) => setQuizOpt2(e.target.value)} placeholder="C" className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded text-white" />
              <input type="text" value={quizOpt3} onChange={(e) => setQuizOpt3(e.target.value)} placeholder="D" className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded text-white" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-mono text-[10px] text-ash mb-1 uppercase">
                  {lang === 'ru' ? 'Правильный ответ' : 'Correct Option'}
                </label>
                <select value={quizCorrectIndex} onChange={(e) => setQuizCorrectIndex(e.target.value)} className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded text-white font-mono">
                  <option value="0">A</option>
                  <option value="1">B</option>
                  <option value="2">C</option>
                  <option value="3">D</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] text-ash mb-1 uppercase">
                  {lang === 'ru' ? 'Сложность' : 'Difficulty'}
                </label>
                <select value={quizDifficulty} onChange={(e) => setQuizDifficulty(e.target.value)} className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded text-white font-mono">
                  <option value="1">{lang === 'ru' ? '1 — Обычная' : '1 — Normal'}</option>
                  <option value="2">{lang === 'ru' ? '2 — Средняя' : '2 — Medium'}</option>
                  <option value="3">{lang === 'ru' ? '3 — Сложная' : '3 — Hard'}</option>
                </select>
              </div>
            </div>
            <input
              type="text"
              value={quizExplanationRu}
              onChange={(e) => setQuizExplanationRu(e.target.value)}
              placeholder={lang === 'ru' ? 'Пояснение (опционально)' : 'Explanation (optional)'}
              className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
            />
            <button
              type="submit"
              disabled={savingQuiz}
              className="w-full py-2.5 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.2] disabled:opacity-50 text-white border border-white/20 rounded-lg cursor-pointer"
            >
              {savingQuiz
                ? lang === 'ru' ? 'Сохранение...' : 'Saving...'
                : editingQuizId
                  ? lang === 'ru' ? 'Сохранить' : 'Save'
                  : lang === 'ru' ? 'Добавить вопрос' : 'Add Question'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
            <div>
              <h3 className="font-title text-xl text-ivory font-light uppercase tracking-wider">
                {lang === 'ru' ? 'Банк вопросов викторины' : 'Quiz Questions Bank'} ({quizQuestionsList.length})
              </h3>
              <p className="font-mono text-[10px] text-ash/70">
                {lang === 'ru'
                  ? 'Отметьте чекбоксы, чтобы закрепить вопросы вручную, или нажмите «Авто-режим».'
                  : 'Check questions to pin manually, or switch back to Auto Mode.'}
              </p>
            </div>
            <button
              type="button"
              disabled={savingSettings}
              onClick={handleSavePinnedIds}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a3820] hover:bg-[#234b2b] border border-[#388548] text-[#6ee7b7] font-mono text-[10px] uppercase cursor-pointer disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{lang === 'ru' ? `Сохранить выбор (${activeQuizIds.length})` : `Save Selection (${activeQuizIds.length})`}</span>
            </button>
          </div>

          <div className="divide-y divide-white/[0.05] max-h-[500px] overflow-y-auto pr-1">
            {quizQuestionsList.map((q) => {
              let qOpts: string[] = [];
              try {
                qOpts = Array.isArray(q.options) ? q.options : JSON.parse(q.options_json || '[]');
              } catch {
                qOpts = [];
              }
              const isPinned = activeQuizIds.includes(q.id);
              return (
                <div key={q.id} className="py-3 flex items-start justify-between gap-3">
                  <label className="pt-0.5 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={isPinned}
                      onChange={() => toggleActiveQuizId(q.id)}
                      className="accent-[#821c2c]"
                      title={lang === 'ru' ? 'Закрепить в активной подборке' : 'Pin in active set'}
                    />
                  </label>
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="text-xs text-white font-sans font-medium">
                      {lang === 'ru' ? q.question_ru : q.question_en}
                    </div>
                    {qOpts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                        {qOpts.map((opt, idx) => (
                          <span
                            key={idx}
                            className={`px-2 py-0.5 rounded border ${
                              idx === Number(q.correct_index)
                                ? 'bg-[#1a3820]/70 border-[#388548] text-[#6ee7b7]'
                                : 'bg-white/[0.03] border-white/[0.08] text-ash/80'
                            }`}
                          >
                            {String.fromCharCode(65 + idx)}: {opt}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="font-mono text-[10px] text-ash/65">
                      {lang === 'ru' ? 'Сложность' : 'Difficulty'}: {q.difficulty || 1}
                      {isPinned && (
                        <span className="ml-2 text-amber-300 uppercase">
                          · {lang === 'ru' ? 'Закреплён' : 'Pinned'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditQuizQuestion(q)}
                      className="p-1.5 rounded hover:bg-white/[0.08] text-ash hover:text-white transition-colors cursor-pointer"
                      title={lang === 'ru' ? 'Редактировать' : 'Edit'}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteQuiz({ id: q.id, question_ru: q.question_ru })}
                      className="p-1.5 rounded hover:bg-red-950/60 text-ash hover:text-red-400 transition-colors cursor-pointer"
                      title={lang === 'ru' ? 'Удалить' : 'Delete'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
