import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import {
  X,
  Lock,
  User as UserIcon,
  AlertCircle,
  Mail,
  AtSign,
  Eye,
  EyeOff,
  Send,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';

export const AuthModal: React.FC = () => {
  const { authModalOpen, authMode, closeAuth, openAuth, login, register } = useAuth();
  const { t, lang } = useI18n();

  const [loginInput, setLoginInput] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authModalOpen) {
      setError(null);
      setShowRecovery(false);
      setShowPassword(false);
      setShowConfirmPassword(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAuth();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authModalOpen, closeAuth]);

  if (!authModalOpen) return null;

  const cleanUsernamePreview = username.trim().replace(/^@+/, '').toLowerCase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (authMode === 'login') {
      if (!loginInput.trim() || !password) {
        setError(lang === 'ru' ? 'Введите @username или email и пароль.' : 'Enter your @username or email and password.');
        return;
      }
      setLoading(true);
      const res = await login(loginInput.trim(), password);
      if (!res.success) {
        setError(res.error || (lang === 'ru' ? 'Неверный логин или пароль.' : 'Invalid username or password.'));
      } else {
        setPassword('');
        setLoginInput('');
      }
      setLoading(false);
      return;
    }

    // Registration client-side pre-validation (authoritatively re-checked on server)
    const normalizedU = username.trim().replace(/^@+/, '').toLowerCase();
    if (!normalizedU || normalizedU.length < 3 || normalizedU.length > 20 || !/^[a-z0-9][a-z0-9_-]*$/.test(normalizedU)) {
      setError(
        lang === 'ru'
          ? 'Username должен быть от 3 до 20 символов (латинские буквы, цифры, _ или -, начинается с буквы/цифры).'
          : 'Username must be 3–20 chars (Latin letters, numbers, _ or -, starting with a letter/number).'
      );
      return;
    }
    if (!displayName.trim() || displayName.trim().length < 2 || displayName.trim().length > 36) {
      setError(
        lang === 'ru'
          ? 'Укажите отображаемое имя (от 2 до 36 символов).'
          : 'Enter a Display Name (2–36 characters).'
      );
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(lang === 'ru' ? 'Введите корректный адрес электронной почты.' : 'Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError(lang === 'ru' ? 'Пароль должен содержать минимум 8 символов.' : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError(lang === 'ru' ? 'Пароли не совпадают.' : 'Passwords do not match.');
      return;
    }

    setLoading(true);
    const res = await register({
      username: normalizedU,
      display_name: displayName.trim(),
      email: email.trim().toLowerCase(),
      password,
      confirm_password: confirmPassword,
    });
    if (!res.success) {
      setError(res.error || (lang === 'ru' ? 'Не удалось создать аккаунт.' : 'Failed to register.'));
    } else {
      setUsername('');
      setDisplayName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="relative w-full max-w-md bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-6 sm:p-8 shadow-2xl my-auto">
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
          <h2 id="auth-modal-title" className="font-editorial text-2xl text-[#f2eee9] font-semibold tracking-tight">
            {showRecovery
              ? lang === 'ru'
                ? 'Восстановление доступа'
                : 'Account Recovery'
              : authMode === 'login'
                ? t('authTitleLogin')
                : t('authTitleRegister')}
          </h2>
          <p className="font-mono text-[10px] text-[#8e877e] uppercase tracking-widest mt-1">
            {showRecovery
              ? 'APOSTLES OF DEATHMARRIED'
              : authMode === 'login'
                ? lang === 'ru'
                  ? 'Вход по @username или email'
                  : 'Sign in with @username or email'
                : lang === 'ru'
                  ? 'Создайте личный профиль в архиве · старт 0 XP'
                  : 'Create your archive profile · starts at 0 XP'}
          </p>
        </div>

        {/* PASSWORD RECOVERY VIEW (TELEGRAM ADMIN) */}
        {showRecovery ? (
          <div className="space-y-5 animate-fadeIn">
            <div className="p-4 rounded-xl bg-[#141219] border border-[#821c2c]/45 space-y-3 text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-[#821c2c]/25 border border-[#821c2c]/60 flex items-center justify-center text-[#e8909c]">
                <Send className="w-4 h-4" />
              </div>
              <p className="text-sm text-[#ded8ce] font-sans leading-relaxed">
                {lang === 'ru'
                  ? 'Забыли пароль? Напишите администратору в Telegram, чтобы восстановить доступ к аккаунту'
                  : 'Forgot your password? Message the administrator on Telegram to recover access to your account.'}
              </p>
              <p className="text-[11px] font-mono text-[#8e877e]">
                {lang === 'ru'
                  ? 'Укажите ваш @username и email, привязанный к профилю. Администратор установит временный пароль.'
                  : 'Include your @username and linked email. The administrator will set a temporary reset password.'}
              </p>
            </div>

            <a
              href="https://t.me/thenightmortan"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 px-4 rounded-lg bg-[#5a1622] hover:bg-[#721b2b] border border-[#821c2c] text-[#f2eee9] font-mono text-xs uppercase tracking-wider font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Send className="w-4 h-4" />
              <span>Telegram · @thenightmortan</span>
            </a>

            <button
              type="button"
              onClick={() => {
                setShowRecovery(false);
                setError(null);
              }}
              className="w-full py-2 text-xs font-mono text-[#8e877e] hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{lang === 'ru' ? 'Вернуться ко входу' : 'Back to sign in'}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Error alert */}
            {error && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-lg bg-[#240b10] border border-[#721b2b] text-xs text-[#f2d2d7] flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-[#d9777f] mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* LOGIN FORM */}
            {authMode === 'login' ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="auth-login-input"
                    className="block font-mono text-[10px] uppercase tracking-widest text-[#8e877e] mb-1.5"
                  >
                    {lang === 'ru' ? '@username или Email' : '@username or Email'}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                      <UserIcon className="w-4 h-4" />
                    </span>
                    <input
                      id="auth-login-input"
                      type="text"
                      required
                      autoComplete="username"
                      value={loginInput}
                      onChange={(e) => setLoginInput(e.target.value)}
                      placeholder={lang === 'ru' ? '@username или email@example.com' : '@username or email@example.com'}
                      className="w-full pl-9 pr-3 py-2.5 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-[#f2eee9] placeholder-[#635c56] focus:outline-none focus:border-white/[0.28] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="auth-login-password"
                      className="block font-mono text-[10px] uppercase tracking-widest text-[#8e877e]"
                    >
                      {t('passwordLabel')}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setShowRecovery(true);
                      }}
                      className="text-[11px] font-sans text-[#c49298] hover:text-[#f2eee9] transition-colors cursor-pointer"
                    >
                      {lang === 'ru' ? 'Забыли пароль?' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      id="auth-login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-10 py-2.5 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-[#f2eee9] placeholder-[#635c56] focus:outline-none focus:border-white/[0.28] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#736c64] hover:text-[#ded8ce] cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-xs font-mono font-semibold tracking-wider uppercase bg-[#5a1622] hover:bg-[#721b2b] text-[#f2eee9] border border-[#821c2c] transition-colors disabled:opacity-50 cursor-pointer mt-2"
                >
                  {loading ? (lang === 'ru' ? 'Вход...' : 'Signing in...') : t('loginBtn')}
                </button>
              </form>
            ) : (
              /* REGISTRATION FORM (5 FULL FIELDS) */
              <form onSubmit={handleSubmit} className="space-y-3.5">
                {/* 1. Unique @username */}
                <div>
                  <label
                    htmlFor="auth-reg-username"
                    className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-[#8e877e] mb-1"
                  >
                    <span>{lang === 'ru' ? 'Уникальный @username *' : 'Unique @username *'}</span>
                    {cleanUsernamePreview && (
                      <span className="text-[#c49298] normal-case">@{cleanUsernamePreview}</span>
                    )}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8e877e]">
                      <AtSign className="w-3.5 h-3.5" />
                    </span>
                    <input
                      id="auth-reg-username"
                      type="text"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/^@+/, ''))}
                      placeholder="night_apostle"
                      maxLength={20}
                      className="w-full pl-9 pr-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs font-mono text-[#f2eee9] placeholder-[#635c56] focus:outline-none focus:border-white/[0.28] transition-colors"
                    />
                  </div>
                  <p className="text-[10px] text-[#736c64] mt-1 font-sans">
                    {lang === 'ru'
                      ? 'Латиница, цифры, _ или - (3–20 символов). Используется в ссылке на профиль.'
                      : 'Latin letters, numbers, _ or - (3–20 chars). Used in your profile link.'}
                  </p>
                </div>

                {/* 2. Display Name */}
                <div>
                  <label
                    htmlFor="auth-reg-displayname"
                    className="block font-mono text-[10px] uppercase tracking-widest text-[#8e877e] mb-1"
                  >
                    {lang === 'ru' ? 'Отображаемое имя (Display Name) *' : 'Display Name *'}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                      <UserIcon className="w-4 h-4" />
                    </span>
                    <input
                      id="auth-reg-displayname"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={lang === 'ru' ? 'Ночной Странник' : 'Midnight Wanderer'}
                      maxLength={36}
                      className="w-full pl-9 pr-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-[#f2eee9] placeholder-[#635c56] focus:outline-none focus:border-white/[0.28] transition-colors"
                    />
                  </div>
                </div>

                {/* 3. Email */}
                <div>
                  <label
                    htmlFor="auth-reg-email"
                    className="block font-mono text-[10px] uppercase tracking-widest text-[#8e877e] mb-1"
                  >
                    {lang === 'ru' ? 'Электронная почта (Email) *' : 'Email Address *'}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                      <Mail className="w-4 h-4" />
                    </span>
                    <input
                      id="auth-reg-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full pl-9 pr-3 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-[#f2eee9] placeholder-[#635c56] focus:outline-none focus:border-white/[0.28] transition-colors"
                    />
                  </div>
                </div>

                {/* 4. Password */}
                <div>
                  <label
                    htmlFor="auth-reg-password"
                    className="block font-mono text-[10px] uppercase tracking-widest text-[#8e877e] mb-1"
                  >
                    {lang === 'ru' ? 'Пароль (минимум 8 символов) *' : 'Password (min 8 chars) *'}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      id="auth-reg-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-10 py-2 bg-[#141318] border border-white/[0.1] rounded-lg text-xs text-[#f2eee9] placeholder-[#635c56] focus:outline-none focus:border-white/[0.28] transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#736c64] hover:text-[#ded8ce] cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* 5. Confirm Password */}
                <div>
                  <label
                    htmlFor="auth-reg-confirm-password"
                    className="block font-mono text-[10px] uppercase tracking-widest text-[#8e877e] mb-1"
                  >
                    {lang === 'ru' ? 'Подтверждение пароля *' : 'Confirm Password *'}
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#635c56]">
                      <ShieldCheck className="w-4 h-4" />
                    </span>
                    <input
                      id="auth-reg-confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`w-full pl-9 pr-10 py-2 bg-[#141318] border rounded-lg text-xs text-[#f2eee9] placeholder-[#635c56] focus:outline-none transition-colors ${
                        confirmPassword && confirmPassword !== password
                          ? 'border-[#a83242]'
                          : 'border-white/[0.1] focus:border-white/[0.28]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#736c64] hover:text-[#ded8ce] cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {confirmPassword && confirmPassword !== password && (
                    <p className="text-[10px] text-[#e8909c] mt-1 font-sans">
                      {lang === 'ru' ? 'Пароли не совпадают.' : 'Passwords do not match.'}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-xs font-mono font-semibold tracking-wider uppercase bg-[#5a1622] hover:bg-[#721b2b] text-[#f2eee9] border border-[#821c2c] transition-colors disabled:opacity-50 cursor-pointer mt-2"
                >
                  {loading ? (lang === 'ru' ? 'Создание...' : 'Creating account...') : t('registerBtn')}
                </button>
              </form>
            )}

            {/* Switch mode */}
            <div className="mt-5 pt-4 border-t border-white/[0.08] text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setShowRecovery(false);
                  openAuth(authMode === 'login' ? 'register' : 'login');
                }}
                className="text-xs text-[#8e877e] hover:text-[#f2eee9] transition-colors cursor-pointer"
              >
                {authMode === 'login' ? t('switchRegister') : t('switchLogin')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
