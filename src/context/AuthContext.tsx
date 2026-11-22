import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types/index.js';
import { safeJson } from '../utils/logic.js';

const TOKEN_KEY = 'apostle_auth_token';

export const getStoredToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};

export const setStoredToken = (token: string): void => {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {}
};

export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { credentials: 'include', cache: 'no-store', ...options, headers });
};

export interface RegisterPayload {
  username: string;
  display_name: string;
  email: string;
  password: string;
  confirm_password: string;
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  token: string | null;
  login: (loginInput: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (payload: RegisterPayload) => Promise<{ success: boolean; error?: string }>;
  bindAdmin: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  authModalOpen: boolean;
  authMode: 'login' | 'register';
  openAuth: (mode?: 'login' | 'register') => void;
  closeAuth: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  token: null,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  bindAdmin: async () => ({ success: false }),
  logout: async () => {},
  refresh: async () => {},
  authModalOpen: false,
  authMode: 'login',
  openAuth: () => {},
  closeAuth: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/api/auth/me');
      if (res.ok) {
        const data = await safeJson<{ user: UserProfile | null; token?: string }>(res, { user: null });
        setUser(data.user);
        if (data.user && data.token) {
          setToken(data.token);
          setStoredToken(data.token);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveSession = (authToken?: string, userData?: UserProfile) => {
    if (authToken) {
      setToken(authToken);
      setStoredToken(authToken);
    }
    if (userData) {
      setUser(userData);
    }
  };

  const login = async (loginInput: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginInput, nickname: loginInput, password }),
      });
      const data = await safeJson(res, { error: 'Ошибка ответа сервера.' });
      if (!res.ok) {
        return { success: false, error: data.error || 'Неверный логин или пароль.' };
      }
      saveSession(data.token, data.user);
      setAuthModalOpen(false);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка соединения.' };
    }
  };

  const register = async (payload: RegisterPayload) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await safeJson(res, { error: 'Ошибка ответа сервера.' });
      if (!res.ok) {
        return { success: false, error: data.error || 'Не удалось создать аккаунт.' };
      }
      saveSession(data.token, data.user);
      setAuthModalOpen(false);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Ошибка соединения.' };
    }
  };

  const bindAdmin = async () => {
    try {
      const res = await authFetch('/api/auth/bind-admin', { method: 'POST' });
      const data = await safeJson(res, { error: 'Invalid response from server' });
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to bind administrator role' };
      }
      setUser(data.user);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Connection error' };
    }
  };

  const logout = async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setStoredToken('');
    setToken(null);
    setUser(null);
  };

  const openAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuth = () => setAuthModalOpen(false);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        token,
        login,
        register,
        bindAdmin,
        logout,
        refresh,
        authModalOpen,
        authMode,
        openAuth,
        closeAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
