import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { X, Lock, User as UserIcon, AlertCircle } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const { authModalOpen, authMode, closeAuth, openAuth, login, register } = useAuth();
  const { t, lang } = useI18n();

  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authModalOpen) {
      setError(null);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuth();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authModalOpen, closeAuth]);

  if (!authModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (authMode === 'login') {
      const res = await login(nickname, password);
      if (!res.success) {
        setError(res.error || 'Failed to sign in');
      } else {
        setPassword('');
      }
    } else {
      const res = await register(nickname, password);
      if (!res.success) {
        setError(res.error || 'Failed to register');
      } else {
        setPassword('');
      }
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md bg-[#0c0b0e] border border-white/[0.12] p-6 sm:p-8 shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={closeAuth}
          className="absolute top-4 right-4 text-[#827a74] hover:text-[#ded8ce] transition-colors cursor-pointer"
          aria-label="Close authentication modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full overflow-hidden border border-white/[0.15] bg-[#060608]">
            <img
              src="/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg"
              alt="Apostles of deathmarried"
              className="w-full h-full object-cover filter brightness-95"
            />
          </div>
          <h2 id="auth-modal-title" className="font-editorial text-2xl text-[#ded8ce] font-semibold tracking-tight">
            {authMode === 'login' ? t('authTitleLogin') : t('authTitleRegister')}
          </h2>
          <p className="font-monostamp text-[10px] text-[#827a74] uppercase tracking-widest mt-1">
            {t('noEmailNote')}
          </p>
        </div>

        {/* Error alert */}
        {error && (
          <div className="mb-4 p-3 bg-[#240b10] border border-[#721b2b] text-xs text-[#ded8ce] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#a84450]" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-sans uppercase tracking-wider text-[#827a74] mb-1.5 font-medium">
              {t('nicknameLabel')}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                <UserIcon className="w-4 h-4" />
              </span>
              <input
                type="text"
                required
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={lang === 'ru' ? 'никнейм или email@...' : 'nickname or email@...'}
                className="w-full pl-9 pr-3 py-2 bg-[#141318] border border-white/[0.1] text-xs text-[#ded8ce] placeholder-[#635c56] focus:outline-none focus:border-white/[0.25] transition-colors rounded"
              />
            </div>
          </div>

          <div>
            <label className="block font-monostamp text-[10px] uppercase tracking-widest text-[#827a74] mb-1.5">
              {t('passwordLabel')}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-[#141318] border border-white/[0.1] text-xs text-[#ded8ce] placeholder-[#635c56] focus:outline-none focus:border-white/[0.25] transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-xs font-semibold tracking-wider uppercase bg-[#5a1622] hover:bg-[#721b2b] text-[#ded8ce] border border-[#721b2b] transition-colors disabled:opacity-50 cursor-pointer mt-2"
          >
            {loading ? '...' : authMode === 'login' ? t('loginBtn') : t('registerBtn')}
          </button>
        </form>

        {/* Switch mode */}
        <div className="mt-4 pt-4 border-t border-white/[0.08] text-center">
          <button
            type="button"
            onClick={() => {
              setError(null);
              openAuth(authMode === 'login' ? 'register' : 'login');
            }}
            className="text-xs text-[#827a74] hover:text-[#ded8ce] transition-colors cursor-pointer"
          >
            {authMode === 'login' ? t('switchRegister') : t('switchLogin')}
          </button>
        </div>
      </div>
    </div>
  );
};

