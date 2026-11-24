import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { AppNotification } from '../types/index.js';
import { safeJson } from '../utils/logic.js';
import { Bell, BellRing, CheckCheck, MessageSquare, X } from 'lucide-react';

export type BrowserNotifStatus = 'unsupported' | 'default' | 'granted' | 'denied';

export function getBrowserNotificationStatus(): BrowserNotifStatus {
  try {
    if (typeof window === 'undefined' || !('Notification' in window) || typeof window.Notification === 'undefined') {
      return 'unsupported';
    }
    const perm = window.Notification.permission;
    if (perm === 'granted' || perm === 'denied' || perm === 'default') return perm;
    return 'default';
  } catch {
    return 'unsupported';
  }
}

export async function requestBrowserNotifications(): Promise<BrowserNotifStatus> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window) || typeof window.Notification === 'undefined') {
      return 'unsupported';
    }
    if (window.Notification.permission === 'granted') return 'granted';
    if (window.Notification.permission === 'denied') return 'denied';
    const result = await window.Notification.requestPermission();
    return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'default';
  } catch {
    return 'unsupported';
  }
}

function getNotificationActionText(n: AppNotification): { nativeTitle: string; verb: string; hideActorPrefix?: boolean } {
  switch (n.type) {
    case 'new_post':
      return { nativeTitle: `${n.actor_name} опубликовал тему`, verb: 'опубликовал новую тему' };
    case 'new_creation':
      return { nativeTitle: `${n.actor_name} опубликовал работу`, verb: 'опубликовал работу' };
    case 'new_comment':
      return { nativeTitle: `${n.actor_name} оставил комментарий`, verb: 'оставил комментарий' };
    case 'news':
      return { nativeTitle: `Новости сайта: ${n.target_title}`, verb: 'Новости и обновления сайта', hideActorPrefix: true };
    default:
      return { nativeTitle: `${n.actor_name} ответил вам`, verb: 'ответил' };
  }
}

function showNativeBrowserNotification(n: AppNotification, onOpen: () => void) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window) || window.Notification.permission !== 'granted') {
      return;
    }
    const { nativeTitle } = getNotificationActionText(n);
    const body = n.excerpt ? `«${n.excerpt}» · ${n.target_title}` : n.target_title;
    const nativeNotif = new window.Notification(nativeTitle, {
      body,
      icon: '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg',
      tag: n.id,
    });
    nativeNotif.onclick = () => {
      try {
        window.focus();
      } catch {}
      onOpen();
      nativeNotif.close();
    };
  } catch {
    // Gracefully ignore restricted browser environments (e.g. iOS Safari / iframe sandbox)
  }
}

function formatNotifTime(dateStr: string): string {
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return 'только что';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ч назад`;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function targetTypeLabel(type: AppNotification['target_type']): string {
  switch (type) {
    case 'post':
      return 'Форум';
    case 'creation':
      return 'Творчество';
    case 'album':
      return 'Альбом';
    case 'single':
      return 'Сингл';
    case 'news':
      return 'Новости';
    default:
      return 'Ответ';
  }
}

export const BrowserNotificationsControl: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [status, setStatus] = useState<BrowserNotifStatus>(() => getBrowserNotificationStatus());
  const [requesting, setRequesting] = useState(false);

  const handleEnable = async () => {
    setRequesting(true);
    try {
      const next = await requestBrowserNotifications();
      setStatus(next);
    } finally {
      setRequesting(false);
    }
  };

  if (status === 'unsupported') {
    return (
      <div className={`text-[11px] text-[#736c64] ${compact ? 'px-3 py-2 border-t border-white/[0.06]' : ''}`}>
        Системные уведомления не поддерживаются этим браузером.
      </div>
    );
  }

  if (status === 'granted') {
    return (
      <div
        className={`flex items-center gap-2 text-[11px] text-[#7ed6a3] ${
          compact ? 'px-3 py-2 border-t border-white/[0.06] bg-[#0e1511]/60' : ''
        }`}
      >
        <BellRing className="w-3.5 h-3.5 shrink-0" />
        <span>Уведомления в браузере включены</span>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={`text-[11px] text-[#c49298] ${compact ? 'px-3 py-2 border-t border-white/[0.06]' : ''}`}>
        Уведомления заблокированы в настройках браузера.
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleEnable}
      disabled={requesting}
      className={
        compact
          ? 'w-full flex items-center justify-center gap-1.5 px-3 py-2 border-t border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.08] text-[11px] font-mono text-[#ded8ce] hover:text-white transition-colors cursor-pointer disabled:opacity-50'
          : 'inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.12] text-xs font-mono text-[#f2eee9] transition-colors cursor-pointer disabled:opacity-50'
      }
    >
      <BellRing className="w-3.5 h-3.5 text-[#c96075] shrink-0" />
      <span>{requesting ? 'Запрос разрешения...' : 'Включить уведомления в браузере'}</span>
    </button>
  );
};

export const NotificationCenter: React.FC = () => {
  const { user, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastNotif, setToastNotif] = useState<AppNotification | null>(null);
  const [notifyFollows, setNotifyFollows] = useState<boolean>(user?.notify_follows === 0 ? false : true);
  const [notifyNews, setNotifyNews] = useState<boolean>(Boolean(user?.notify_news));
  const [prefsSaving, setPrefsSaving] = useState<'follows' | 'news' | null>(null);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const fetchPreferences = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await authFetch('/api/notifications/preferences', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await safeJson<{ notify_follows?: boolean; notify_news?: boolean }>(res, {});
      if (typeof data.notify_follows === 'boolean') setNotifyFollows(data.notify_follows);
      if (typeof data.notify_news === 'boolean') setNotifyNews(data.notify_news);
    } catch {}
  }, [user?.id]);

  const handleTogglePreference = async (field: 'follows' | 'news') => {
    if (!user?.id || prefsSaving) return;
    const nextFollows = field === 'follows' ? !notifyFollows : notifyFollows;
    const nextNews = field === 'news' ? !notifyNews : notifyNews;
    const prevFollows = notifyFollows;
    const prevNews = notifyNews;

    setNotifyFollows(nextFollows);
    setNotifyNews(nextNews);
    setPrefsSaving(field);
    try {
      const res = await authFetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          field === 'follows' ? { notify_follows: nextFollows } : { notify_news: nextNews }
        ),
      });
      if (res.ok) {
        refresh().catch(() => {});
      } else {
        setNotifyFollows(prevFollows);
        setNotifyNews(prevNews);
      }
    } catch {
      setNotifyFollows(prevFollows);
      setNotifyNews(prevNews);
    } finally {
      setPrefsSaving(null);
    }
  };

  const openNotificationTarget = useCallback(async (n: AppNotification) => {
    setOpen(false);
    setToastNotif(null);

    if (!n.is_read) {
      setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: 1 } : item)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      authFetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }

    const hasNewsNavLink = Boolean(n.target_link && n.target_link.trim() && n.target_link.trim() !== 'none');
    if (n.target_type === 'news' && !hasNewsNavLink) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent('navigate-notification', {
        detail: {
          targetType: n.target_type,
          targetId: n.target_id,
          targetLink: n.target_link,
        },
      })
    );
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      // Strictly GET polling (never triggers CloudSync upload)
      const res = await authFetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await safeJson<{ notifications?: AppNotification[]; unreadCount?: number }>(res, {});
      const list = Array.isArray(data.notifications) ? data.notifications : [];
      const unread = Number(data.unreadCount || 0);

      if (initializedRef.current) {
        const freshUnread = list.filter((item) => !item.is_read && !knownIdsRef.current.has(item.id));
        if (freshUnread.length > 0) {
          const newest = freshUnread[0];
          setToastNotif(newest);
          if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
          toastTimerRef.current = window.setTimeout(() => setToastNotif(null), 7000);
          showNativeBrowserNotification(newest, () => openNotificationTarget(newest));
        }
      } else {
        initializedRef.current = true;
      }

      for (const item of list) {
        knownIdsRef.current.add(item.id);
      }

      setNotifications(list);
      setUnreadCount(unread);
    } catch {
      // Silent retry on next interval
    }
  }, [user?.id, openNotificationTarget]);

  // Reset state on user switch / logout
  useEffect(() => {
    if (!user?.id) {
      setNotifications([]);
      setUnreadCount(0);
      setOpen(false);
      setToastNotif(null);
      knownIdsRef.current = new Set();
      initializedRef.current = false;
      return;
    }

    setNotifyFollows(user?.notify_follows === 0 ? false : true);
    setNotifyNews(Boolean(user?.notify_news));
    fetchNotifications();
    fetchPreferences();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    }, 35000);

    return () => {
      window.clearInterval(intervalId);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [user?.id, fetchNotifications, fetchPreferences]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    await authFetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  };

  if (!user) return null;

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) {
              fetchNotifications();
              fetchPreferences();
            }
          }}
          className="relative p-1.5 rounded-lg border border-white/[0.08] bg-[#100f13] hover:border-white/20 text-[#ded8ce] hover:text-white transition-colors cursor-pointer"
          aria-label="Уведомления"
          title="Уведомления"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#821c2c] text-white font-mono text-[9px] font-semibold tabular-nums flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-[#100f14] border border-white/[0.1] shadow-2xl overflow-hidden z-50 animate-fadeIn">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.07] bg-[#14131a]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#f2eee9]">
                  Уведомления
                </span>
                {unreadCount > 0 && (
                  <span className="font-mono text-[10px] text-[#e28593] tabular-nums">
                    {unreadCount} новых
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-[#8e877e] hover:text-white transition-colors cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Прочитать все</span>
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.05]">
              {notifications.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-1.5">
                  <MessageSquare className="w-5 h-5 text-[#57514b] mx-auto" />
                  <p className="text-xs text-[#8e877e]">Пока нет уведомлений</p>
                  <p className="text-[11px] text-[#635c54]">
                    Когда кто-то ответит на вашу тему, работу или комментарий, это появится здесь.
                  </p>
                </div>
              ) : (
                notifications.map((n) => {
                  const meta = getNotificationActionText(n);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => openNotificationTarget(n)}
                      className={`w-full text-left px-3.5 py-3 transition-colors hover:bg-white/[0.04] cursor-pointer space-y-1 ${
                        n.is_read ? 'opacity-70' : 'bg-[#17121a]/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-[#f2eee9] truncate">
                          {meta.hideActorPrefix ? (
                            <span className="text-[#e28593]">{meta.verb}</span>
                          ) : (
                            <>
                              {n.actor_name}{' '}
                              <span className="font-normal text-[#8e877e]">{meta.verb}</span>
                            </>
                          )}
                        </span>
                        <span className="font-mono text-[10px] text-[#736c64] shrink-0 tabular-nums">
                          {formatNotifTime(n.created_at)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#a39b8b] truncate">
                        {targetTypeLabel(n.target_type)} · {n.target_title}
                      </div>
                      {n.excerpt && (
                        <p className="text-xs text-[#ded8ce] line-clamp-2 leading-snug">
                          «{n.excerpt}»
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-3.5 py-2.5 border-t border-white/[0.06] bg-[#131218] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#ded8ce]">Уведомления от подписок</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifyFollows}
                  disabled={prefsSaving === 'follows'}
                  onClick={() => handleTogglePreference('follows')}
                  className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
                    notifyFollows ? 'bg-[#821c2c]' : 'bg-white/[0.14]'
                  }`}
                >
                  <span
                    className={`block w-3 h-3 rounded-full bg-white transition-transform ${
                      notifyFollows ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#ded8ce]">Новости и обновления сайта</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={notifyNews}
                  disabled={prefsSaving === 'news'}
                  onClick={() => handleTogglePreference('news')}
                  className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-50 ${
                    notifyNews ? 'bg-[#821c2c]' : 'bg-white/[0.14]'
                  }`}
                >
                  <span
                    className={`block w-3 h-3 rounded-full bg-white transition-transform ${
                      notifyNews ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>

            <BrowserNotificationsControl compact />
          </div>
        )}
      </div>

      {/* Live In-App Reply Toast Widget */}
      {toastNotif && (
        <div className="fixed bottom-24 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-[#121017] border border-[#821c2c]/60 shadow-2xl p-3.5 animate-fadeIn">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => openNotificationTarget(toastNotif)}
              className="flex-1 text-left space-y-1 cursor-pointer min-w-0"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#e28593]">
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {toastNotif.actor_name} · {targetTypeLabel(toastNotif.target_type)}
                </span>
              </div>
              <div className="text-xs font-medium text-[#f2eee9] truncate">
                {toastNotif.target_title}
              </div>
              <p className="text-[11px] text-[#c7c0b6] line-clamp-2 leading-snug">
                «{toastNotif.excerpt}»
              </p>
            </button>
            <button
              type="button"
              onClick={() => setToastNotif(null)}
              aria-label="Закрыть уведомление"
              className="p-1 text-[#736c64] hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
