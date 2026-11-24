import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { AppNotification } from '../types/index.js';
import { safeJson } from '../utils/logic.js';
import { Bell, BellRing, CheckCheck, ChevronDown, ChevronUp, MessageSquare, X } from 'lucide-react';

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
      <div className={`text-[11px] text-[#8e877e] leading-snug ${compact ? 'px-3 py-2 border-t border-white/[0.06]' : ''}`}>
        Уведомления приходят прямо в колокольчик на сайте.
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
        <span>Уведомления браузера включены (приходят, пока открыт сайт)</span>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={`text-[11px] text-[#c49298] leading-snug ${compact ? 'px-3 py-2 border-t border-white/[0.06]' : ''}`}>
        Уведомления браузера отключены в настройках браузера. Все оповещения по-прежнему приходят в колокольчик на сайте.
      </div>
    );
  }

  return (
    <div className={compact ? 'border-t border-white/[0.06]' : 'space-y-1.5'}>
      <button
        type="button"
        onClick={handleEnable}
        disabled={requesting}
        className={
          compact
            ? 'w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.08] text-[11px] font-mono text-[#ded8ce] hover:text-white transition-colors cursor-pointer disabled:opacity-50'
            : 'inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.12] text-xs font-mono text-[#f2eee9] transition-colors cursor-pointer disabled:opacity-50'
        }
      >
        <BellRing className="w-3.5 h-3.5 text-[#c96075] shrink-0" />
        <span>{requesting ? 'Запрос разрешения...' : 'Включить уведомления браузера'}</span>
      </button>
      <p className={`text-[10px] text-[#736c64] ${compact ? 'px-3 pb-2 text-center' : ''}`}>
        Приходят, пока открыт сайт
      </p>
    </div>
  );
};

function loadShownToastIds(userId: string): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(`aod_shown_notif_toasts_v1:${userId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string'));
    }
  } catch {}
  return new Set();
}

function persistShownToastId(userId: string, notifId: string) {
  try {
    const current = loadShownToastIds(userId);
    current.add(notifId);
    const trimmed = Array.from(current).slice(-60);
    window.sessionStorage.setItem(`aod_shown_notif_toasts_v1:${userId}`, JSON.stringify(trimmed));
  } catch {}
}

function isLongNotificationContent(n: Pick<AppNotification, 'target_title' | 'excerpt'>): boolean {
  const excerpt = (n.excerpt || '').trim();
  const title = (n.target_title || '').trim();
  const lineCount = excerpt ? excerpt.split('\n').length : 0;
  return excerpt.length > 115 || lineCount > 2 || title.length > 68;
}

export const NotificationCenter: React.FC = () => {
  const { user, refresh } = useAuth();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastNotif, setToastNotif] = useState<AppNotification | null>(null);
  const [toastExpanded, setToastExpanded] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [notifyFollows, setNotifyFollows] = useState<boolean>(user?.notify_follows === 0 ? false : true);
  const [notifyNews, setNotifyNews] = useState<boolean>(Boolean(user?.notify_news));
  const [prefsSaving, setPrefsSaving] = useState<'follows' | 'news' | null>(null);

  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const optimisticReadIdsRef = useRef<Set<string>>(new Set());
  const optimisticReadAllRef = useRef<boolean>(false);
  const initializedRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const toggleExpandedId = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    setToastExpanded(false);
  }, [toastNotif?.id]);

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

  const dismissToastOnly = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (toastNotif && user?.id) {
      persistShownToastId(user.id, toastNotif.id);
    }
    setToastNotif(null);
  }, [toastNotif, user?.id]);

  const openNotificationTarget = useCallback(async (n: AppNotification) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (user?.id) {
      persistShownToastId(user.id, n.id);
    }
    setToastNotif(null);

    if (!n.is_read) {
      optimisticReadIdsRef.current.add(n.id);
      setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: 1 } : item)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        const res = await authFetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: n.id }),
        });
        if (res.ok) {
          const data = await safeJson<{ unreadCount?: number }>(res, {});
          if (typeof data.unreadCount === 'number') {
            setUnreadCount(data.unreadCount);
          }
        }
      } catch {}
    }

    const hasNewsNavLink = Boolean(n.target_link && n.target_link.trim() && n.target_link.trim() !== 'none');
    if (n.target_type === 'news' && !hasNewsNavLink) {
      setOpen(true);
      return;
    }

    setOpen(false);
    window.dispatchEvent(
      new CustomEvent('navigate-notification', {
        detail: {
          targetType: n.target_type,
          targetId: n.target_id,
          targetLink: n.target_link,
        },
      })
    );
  }, [user?.id]);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      // Strictly GET polling (never triggers CloudSync upload)
      const res = await authFetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await safeJson<{ notifications?: AppNotification[]; unreadCount?: number }>(res, {});
      const rawList = Array.isArray(data.notifications) ? data.notifications : [];

      // Deduplicate by id while preserving server ordering
      const seenIds = new Set<string>();
      const dedupedList: AppNotification[] = [];
      for (const item of rawList) {
        if (!item?.id || seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        if (item.is_read) {
          optimisticReadIdsRef.current.delete(item.id);
        }
        const markedLocally =
          optimisticReadAllRef.current || optimisticReadIdsRef.current.has(item.id);
        dedupedList.push(markedLocally ? { ...item, is_read: 1 } : item);
      }

      const serverUnread = Number(data.unreadCount ?? dedupedList.filter((i) => !i.is_read).length);
      let effectiveUnread = optimisticReadAllRef.current
        ? 0
        : Math.max(
            0,
            serverUnread -
              rawList.filter((i) => i && !i.is_read && optimisticReadIdsRef.current.has(i.id)).length
          );
      if (!optimisticReadAllRef.current && effectiveUnread === 0) {
        const localUnreadCount = dedupedList.filter((i) => !i.is_read).length;
        if (localUnreadCount > 0) effectiveUnread = localUnreadCount;
      }

      const shownToasts = loadShownToastIds(user.id);

      if (initializedRef.current) {
        const freshUnread = dedupedList.filter(
          (item) => !item.is_read && !knownIdsRef.current.has(item.id) && !shownToasts.has(item.id)
        );
        if (freshUnread.length > 0) {
          const preferred = freshUnread.find((item) => item.type === 'news') || freshUnread[0];
          persistShownToastId(user.id, preferred.id);
          setToastNotif(preferred);
          showNativeBrowserNotification(preferred, () => openNotificationTarget(preferred));
        }
      } else {
        initializedRef.current = true;
        const unreadNews = dedupedList.find(
          (item) => item.type === 'news' && !item.is_read && !shownToasts.has(item.id)
        );
        if (unreadNews) {
          persistShownToastId(user.id, unreadNews.id);
          setToastNotif(unreadNews);
        }
      }

      for (const item of dedupedList) {
        knownIdsRef.current.add(item.id);
      }

      setNotifications(dedupedList);
      setUnreadCount(effectiveUnread);
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
      optimisticReadIdsRef.current = new Set();
      optimisticReadAllRef.current = false;
      initializedRef.current = false;
      return;
    }

    setNotifyFollows(user?.notify_follows === 0 ? false : true);
    setNotifyNews(Boolean(user?.notify_news));
    fetchNotifications();
    fetchPreferences();

    const handleForceRefresh = () => {
      fetchNotifications();
    };
    window.addEventListener('aod-notifications-refresh', handleForceRefresh);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    }, 35000);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('aod-notifications-refresh', handleForceRefresh);
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
    optimisticReadAllRef.current = true;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    try {
      await authFetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } finally {
      optimisticReadAllRef.current = false;
    }
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
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#d92638] ring-2 ring-[#0a0a0d] text-white font-mono text-[10px] font-bold tabular-nums flex items-center justify-center shadow-[0_0_8px_rgba(217,38,56,0.55)]">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="fixed left-2 right-2 top-[4.25rem] w-auto max-h-[calc(100dvh-5.5rem)] flex flex-col sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 sm:max-h-[78dvh] rounded-xl bg-[#100f14] border border-white/[0.1] shadow-2xl overflow-hidden z-50 animate-fadeIn">
            <div className="shrink-0 flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.07] bg-[#14131a]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[#f2eee9]">
                  {lang === 'ru' ? 'Уведомления' : 'Notifications'}
                </span>
                {unreadCount > 0 && (
                  <span className="font-mono text-[10px] text-[#e28593] tabular-nums">
                    {unreadCount} {lang === 'ru' ? 'новых' : 'new'}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-[#8e877e] hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>{lang === 'ru' ? 'Прочитать все' : 'Mark all read'}</span>
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 max-h-80 sm:max-h-96 overflow-y-auto overscroll-contain divide-y divide-white/[0.05]">
              {notifications.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-1.5">
                  <MessageSquare className="w-5 h-5 text-[#57514b] mx-auto" />
                  <p className="text-xs text-[#8e877e]">
                    {lang === 'ru' ? 'Пока нет уведомлений' : 'No notifications yet'}
                  </p>
                  <p className="text-[11px] text-[#635c54]">
                    {lang === 'ru'
                      ? 'Когда кто-то ответит на вашу тему, работу или комментарий, это появится здесь.'
                      : 'Replies to your threads, works, or comments will appear here.'}
                  </p>
                </div>
              ) : (
                notifications.map((n) => {
                  const meta = getNotificationActionText(n);
                  const isLong = isLongNotificationContent(n);
                  const isExpanded = Boolean(expandedIds[n.id]);
                  return (
                    <div
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openNotificationTarget(n)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openNotificationTarget(n);
                        }
                      }}
                      className={`w-full text-left px-3.5 py-3 transition-colors hover:bg-white/[0.04] cursor-pointer space-y-1 focus:outline-none focus-visible:bg-white/[0.06] ${
                        n.is_read ? 'opacity-70' : 'bg-[#17121a]/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-[#f2eee9] truncate min-w-0">
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
                      <div
                        className={`text-[11px] text-[#a39b8b] ${
                          isExpanded ? 'whitespace-normal break-words' : 'truncate'
                        }`}
                      >
                        {targetTypeLabel(n.target_type)} · {n.target_title}
                      </div>
                      {n.excerpt && (
                        <p
                          className={`text-xs text-[#ded8ce] leading-snug break-words ${
                            isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
                          }`}
                        >
                          «{n.excerpt}»
                        </p>
                      )}
                      {isLong && (
                        <div className="pt-0.5">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpandedId(n.id);
                            }}
                            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#e28593] hover:text-white transition-colors cursor-pointer py-0.5"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3 h-3" />
                                <span>{lang === 'ru' ? 'Свернуть' : 'Collapse'}</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" />
                                <span>{lang === 'ru' ? 'Ещё' : 'Show more'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="shrink-0 px-3.5 py-2.5 border-t border-white/[0.06] bg-[#131218] space-y-2">
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

            <div className="shrink-0">
              <BrowserNotificationsControl compact />
            </div>
          </div>
        )}
      </div>

      {/* Live In-App News / Reply Toast Widget */}
      {toastNotif && (
        <div className="fixed bottom-28 sm:bottom-24 left-3 right-3 sm:left-auto sm:right-4 z-[60] w-auto sm:w-80 sm:max-w-[calc(100vw-2rem)] rounded-xl bg-[#121017] border border-[#d92638]/55 shadow-2xl p-3.5 animate-fadeIn space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 text-left space-y-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#e28593]">
                <Bell className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {toastNotif.type === 'news'
                    ? (lang === 'ru' ? 'Новости сайта' : 'Site News')
                    : `${toastNotif.actor_name} · ${targetTypeLabel(toastNotif.target_type)}`}
                </span>
              </div>
              <div
                className={
                  toastExpanded
                    ? 'max-h-[42dvh] overflow-y-auto overscroll-contain pr-1 space-y-1.5'
                    : 'space-y-1'
                }
              >
                <div
                  className={`text-xs font-medium text-[#f2eee9] break-words ${
                    toastExpanded ? 'whitespace-normal' : 'line-clamp-2'
                  }`}
                >
                  {toastNotif.target_title}
                </div>
                {toastNotif.excerpt && (
                  <p
                    className={`text-[11px] text-[#c7c0b6] leading-snug break-words ${
                      toastExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
                    }`}
                  >
                    «{toastNotif.excerpt}»
                  </p>
                )}
              </div>
              {isLongNotificationContent(toastNotif) && (
                <button
                  type="button"
                  aria-expanded={toastExpanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    setToastExpanded((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#e28593] hover:text-white transition-colors cursor-pointer pt-0.5"
                >
                  {toastExpanded ? (
                    <>
                      <ChevronUp className="w-3 h-3" />
                      <span>{lang === 'ru' ? 'Свернуть' : 'Collapse'}</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      <span>{lang === 'ru' ? 'Ещё' : 'Show more'}</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={dismissToastOnly}
              aria-label={lang === 'ru' ? 'Закрыть уведомление' : 'Dismiss notification'}
              className="p-1 text-[#736c64] hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={dismissToastOnly}
              className="px-2.5 py-1 rounded-md border border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.08] text-[11px] font-mono text-[#b5aea4] hover:text-white transition-colors cursor-pointer"
            >
              {lang === 'ru' ? 'Закрыть' : 'Close'}
            </button>
            <button
              type="button"
              onClick={() => openNotificationTarget(toastNotif)}
              className="px-2.5 py-1 rounded-md bg-[#821c2c] hover:bg-[#9b2336] text-[11px] font-mono text-white transition-colors cursor-pointer"
            >
              {lang === 'ru' ? 'Открыть' : 'Open'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
