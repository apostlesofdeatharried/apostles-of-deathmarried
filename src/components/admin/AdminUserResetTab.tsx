import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, AlertTriangle, Search, ShieldAlert, CheckSquare, X } from 'lucide-react';
import { authFetch } from '../../context/AuthContext.js';
import { safeJson } from '../../utils/logic.js';
import { formatHandle } from '../../utils/cosmetics.js';

interface Props {
  usersList: any[];
  lang: 'ru' | 'en';
  onResetComplete: () => Promise<void> | void;
  onNotify: (msg: string) => void;
  onError: (msg: string) => void;
}

export const AdminUserResetTab: React.FC<Props> = ({
  usersList,
  lang,
  onResetComplete,
  onNotify,
  onError,
}) => {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [userSearch, setUserSearch] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [skipAdmins, setSkipAdmins] = useState(true);
  const [scopes, setScopes] = useState({
    xp: true,
    achievements: false,
    cosmetics: false,
    games: true,
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter(
      (u) =>
        String(u.nickname || '').toLowerCase().includes(q) ||
        String(u.display_name || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q)
    );
  }, [usersList, userSearch]);

  const selectedUser = useMemo(
    () => usersList.find((u) => u.id === targetUserId) || null,
    [usersList, targetUserId]
  );

  const anyScopeSelected = scopes.xp || scopes.achievements || scopes.cosmetics || scopes.games;
  const allScopesSelected = scopes.xp && scopes.achievements && scopes.cosmetics && scopes.games;

  const toggleAllScopes = () => {
    const next = !allScopesSelected;
    setScopes({ xp: next, achievements: next, cosmetics: next, games: next });
  };

  const handleOpenConfirm = () => {
    if (!anyScopeSelected) {
      onError(lang === 'ru' ? 'Выберите хотя бы одну категорию данных для сброса.' : 'Select at least one data scope.');
      return;
    }
    if (mode === 'single' && !targetUserId) {
      onError(lang === 'ru' ? 'Выберите пользователя для сброса.' : 'Select a user first.');
      return;
    }
    setConfirmText('');
    setConfirmOpen(true);
  };

  const handleExecuteReset = async () => {
    if (submitting) return;
    if (mode === 'bulk' && confirmText.trim() !== 'СБРОСИТЬ') {
      onError(lang === 'ru' ? 'Введите точное слово СБРОСИТЬ для подтверждения.' : 'Type СБРОСИТЬ to confirm.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch('/api/admin/users/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          target_user_id: mode === 'single' ? targetUserId : undefined,
          skip_admins: skipAdmins,
          confirm_text: mode === 'bulk' ? confirmText.trim() : undefined,
          scopes,
        }),
      });
      const data = await safeJson<{ ok?: boolean; affected_users?: number; error?: string }>(res, {});
      if (!res.ok) {
        onError(data.error || (lang === 'ru' ? 'Не удалось выполнить сброс' : 'Reset failed'));
        return;
      }
      setConfirmOpen(false);
      setConfirmText('');
      onNotify(
        lang === 'ru'
          ? `Сброс выполнен. Затронуто аккаунтов: ${data.affected_users ?? 0}`
          : `Reset complete. Affected accounts: ${data.affected_users ?? 0}`
      );
      await onResetComplete();
    } catch (err: any) {
      onError(err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      key="user_reset"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="bg-[#100f13] border border-red-900/40 rounded-xl p-5 sm:p-6 space-y-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800/70 flex items-center justify-center text-red-300 shrink-0">
            <RotateCcw className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="font-title text-2xl text-ivory uppercase tracking-wide">
              {lang === 'ru' ? 'Сброс прогресса пользователей' : 'User Progress Reset'}
            </h3>
            <p className="text-xs text-ash leading-relaxed font-sans">
              {lang === 'ru'
                ? 'Ручной инструмент выборочного обнуления прогресса. Сами учётные записи (логины, пароли, роли и посты) никогда не удаляются.'
                : 'Manual selective reset tool. Accounts (usernames, passwords, roles, and posts) are never deleted.'}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`px-4 py-2 rounded-lg border uppercase cursor-pointer transition-colors ${
              mode === 'single'
                ? 'bg-white/[0.12] border-white/25 text-white'
                : 'bg-[#16151a] border-white/10 text-ash hover:text-white'
            }`}
          >
            {lang === 'ru' ? 'Один пользователь' : 'Single User'}
          </button>
          <button
            type="button"
            onClick={() => setMode('bulk')}
            className={`px-4 py-2 rounded-lg border uppercase cursor-pointer transition-colors ${
              mode === 'bulk'
                ? 'bg-[#821c2c]/40 border-[#821c2c] text-[#f5c6cb]'
                : 'bg-[#16151a] border-white/10 text-ash hover:text-white'
            }`}
          >
            {lang === 'ru' ? 'Массовый сброс' : 'Bulk Reset'}
          </button>
        </div>

        {/* Target Selection */}
        {mode === 'single' ? (
          <div className="p-4 rounded-xl bg-[#16151a] border border-white/[0.07] space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-ash/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={lang === 'ru' ? 'Быстрый поиск по @username или email...' : 'Search by @username or email...'}
                className="w-full pl-9 pr-3 py-2 bg-[#111015] border border-white/10 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#821c2c]"
              />
            </div>

            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#111015] border border-white/10 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#821c2c]"
            >
              <option value="">
                {lang === 'ru' ? '— Выберите пользователя —' : '— Select User —'}
              </option>
              {filteredUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatHandle(u.nickname)} ({u.display_name || u.nickname}) · L{u.level || 1} · {u.xp || 0} XP · {u.role_id}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-[#1d1216] border border-red-900/50 space-y-3">
            <div className="flex items-start gap-2.5 text-xs text-red-200">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>
                {lang === 'ru'
                  ? 'Массовый сброс применится сразу ко всем пользователям базы (с учётом настройки исключения администраторов).'
                  : 'Bulk reset applies immediately to all matching accounts in the database.'}
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs text-ivory cursor-pointer">
              <input
                type="checkbox"
                checked={skipAdmins}
                onChange={(e) => setSkipAdmins(e.target.checked)}
                className="accent-[#821c2c]"
              />
              <span>
                {lang === 'ru' ? 'Не трогать аккаунты с ролью admin' : 'Skip accounts with admin role'}
              </span>
            </label>
          </div>
        )}

        {/* Scopes Checkboxes */}
        <div className="p-4 rounded-xl bg-[#16151a] border border-white/[0.07] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-bone">
              {lang === 'ru' ? 'Что именно сбросить' : 'Data Scopes to Reset'}
            </span>
            <button
              type="button"
              onClick={toggleAllScopes}
              className="font-mono text-[10px] uppercase text-[#c49298] hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{allScopesSelected ? (lang === 'ru' ? 'Снять все' : 'Clear All') : (lang === 'ru' ? 'Выбрать всё' : 'Select All')}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="p-3 rounded-lg bg-[#111015] border border-white/[0.06] flex items-start gap-2.5 cursor-pointer hover:border-white/15">
              <input
                type="checkbox"
                checked={scopes.xp}
                onChange={(e) => setScopes((s) => ({ ...s, xp: e.target.checked }))}
                className="accent-[#821c2c] mt-0.5"
              />
              <div>
                <div className="text-ivory font-medium">{lang === 'ru' ? 'Опыт и уровень (XP)' : 'XP & Level'}</div>
                <div className="text-[11px] text-ash/75">
                  {lang === 'ru' ? 'Обнулит total_xp, баланс XP, уровень → 1 и историю xp_transactions.' : 'Resets total_xp, spendable xp, level → 1 and XP history.'}
                </div>
              </div>
            </label>

            <label className="p-3 rounded-lg bg-[#111015] border border-white/[0.06] flex items-start gap-2.5 cursor-pointer hover:border-white/15">
              <input
                type="checkbox"
                checked={scopes.achievements}
                onChange={(e) => setScopes((s) => ({ ...s, achievements: e.target.checked }))}
                className="accent-[#821c2c] mt-0.5"
              />
              <div>
                <div className="text-ivory font-medium">{lang === 'ru' ? 'Достижения и секретные флаги' : 'Achievements & Secret Flags'}</div>
                <div className="text-[11px] text-ash/75">
                  {lang === 'ru' ? 'Снимет все достижения, витрину и счётчики прослушиваний/чтения.' : 'Removes all unlocked badges, showcase, and secret progress.'}
                </div>
              </div>
            </label>

            <label className="p-3 rounded-lg bg-[#111015] border border-white/[0.06] flex items-start gap-2.5 cursor-pointer hover:border-white/15">
              <input
                type="checkbox"
                checked={scopes.cosmetics}
                onChange={(e) => setScopes((s) => ({ ...s, cosmetics: e.target.checked }))}
                className="accent-[#821c2c] mt-0.5"
              />
              <div>
                <div className="text-ivory font-medium">{lang === 'ru' ? 'Инвентарь и косметика' : 'Inventory & Cosmetics'}</div>
                <div className="text-[11px] text-ash/75">
                  {lang === 'ru' ? 'Удалит купленные предметы и снимет рамки, фоны и шилды.' : 'Clears owned shop items and equipped frames/banners/shields.'}
                </div>
              </div>
            </label>

            <label className="p-3 rounded-lg bg-[#111015] border border-white/[0.06] flex items-start gap-2.5 cursor-pointer hover:border-white/15">
              <input
                type="checkbox"
                checked={scopes.games}
                onChange={(e) => setScopes((s) => ({ ...s, games: e.target.checked }))}
                className="accent-[#821c2c] mt-0.5"
              />
              <div>
                <div className="text-ivory font-medium">{lang === 'ru' ? 'Игры, стрик и циклы' : 'Games, Streak & Cycles'}</div>
                <div className="text-[11px] text-ash/75">
                  {lang === 'ru' ? 'Обнулит daily_streak, историю попыток во всех 5 играх и блокировки.' : 'Resets streak, all 5 game attempt tables and cycle locks.'}
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleOpenConfirm}
            className="px-5 py-2.5 rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-100 font-mono text-xs uppercase tracking-wider cursor-pointer flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>
              {mode === 'bulk'
                ? lang === 'ru' ? 'Запустить массовый сброс...' : 'Run Bulk Reset...'
                : lang === 'ru' ? 'Сбросить выбранного пользователя...' : 'Reset Selected User...'}
            </span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmOpen && (
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !submitting && setConfirmOpen(false)}
              className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-[#141217] border border-red-800/70 rounded-xl p-6 space-y-4 z-10 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 text-red-300">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <h4 className="font-title text-xl text-ivory uppercase">
                    {lang === 'ru' ? 'Подтверждение сброса' : 'Confirm Progress Reset'}
                  </h4>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                  className="text-ash hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 rounded-lg bg-[#1a171f] border border-white/[0.06] text-xs text-bone space-y-1.5">
                {mode === 'single' ? (
                  <div>
                    {lang === 'ru' ? 'Цель:' : 'Target:'}{' '}
                    <strong className="text-white">
                      {selectedUser ? `${formatHandle(selectedUser.nickname)} (${selectedUser.display_name || selectedUser.nickname})` : targetUserId}
                    </strong>
                  </div>
                ) : (
                  <div>
                    {lang === 'ru' ? 'Массовый сброс:' : 'Bulk Reset:'}{' '}
                    <strong className="text-red-300">
                      {skipAdmins
                        ? lang === 'ru' ? 'все пользователи, кроме admin' : 'all users except admin'
                        : lang === 'ru' ? 'ВСЕ пользователи, включая admin' : 'ALL users including admin'}
                    </strong>
                  </div>
                )}
                <div className="font-mono text-[11px] text-ash">
                  {[
                    scopes.xp && 'XP',
                    scopes.achievements && (lang === 'ru' ? 'Достижения' : 'Achievements'),
                    scopes.cosmetics && (lang === 'ru' ? 'Косметика' : 'Cosmetics'),
                    scopes.games && (lang === 'ru' ? 'Игры и стрик' : 'Games & Streak'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>

              {mode === 'bulk' && (
                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-red-200">
                    {lang === 'ru' ? 'Для подтверждения введите слово СБРОСИТЬ:' : 'Type СБРОСИТЬ to confirm:'}
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="СБРОСИТЬ"
                    className="w-full px-3 py-2 bg-[#1a1820] border border-red-800/60 rounded-lg text-white font-mono text-sm focus:outline-none"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 text-ash hover:text-white font-mono text-xs uppercase cursor-pointer"
                >
                  {lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={submitting || (mode === 'bulk' && confirmText.trim() !== 'СБРОСИТЬ')}
                  onClick={handleExecuteReset}
                  className="px-4 py-2 rounded-lg bg-red-900 hover:bg-red-800 border border-red-600 text-white font-mono text-xs uppercase cursor-pointer disabled:opacity-45"
                >
                  {submitting
                    ? lang === 'ru' ? 'Сброс...' : 'Resetting...'
                    : lang === 'ru' ? 'Выполнить сброс' : 'Confirm Reset'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
