/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MotionConfig } from 'motion/react';
import { I18nProvider, useI18n } from './context/I18nContext.js';
import { AuthProvider, useAuth, authFetch } from './context/AuthContext.js';
import { PlayerProvider, usePlayer } from './context/PlayerContext.js';
import { Navbar } from './components/Navbar.js';
import { MusicPlayer } from './components/MusicPlayer.js';
import { Footer } from './components/Footer.js';
import { AuthModal } from './components/AuthModal.js';
import { IntroAnimation } from './components/IntroAnimation.js';
import { AchievementToastContainer, dispatchAchievementUnlocked } from './components/AchievementToast.js';
import { parseRoute, buildPath, safeJson, AppTab, ParsedRoute } from './utils/logic.js';

import { HomeView } from './views/HomeView.js';
import { ArchiveView } from './views/ArchiveView.js';
import { GamesView } from './views/GamesView.js';
import { CommunityView } from './views/CommunityView.js';
import { CreationsView } from './views/CreationsView.js';
import { ProfileView } from './views/ProfileView.js';
import { AdminView } from './views/AdminView.js';

const TAB_TITLES: Record<AppTab, string> = {
  home: 'Apostles of deathmarried',
  archive: 'Дискография — Apostles of deathmarried',
  games: 'Игры — Apostles of deathmarried',
  community: 'Сообщество — Apostles of deathmarried',
  creations: 'Творчество — Apostles of deathmarried',
  profile: 'Профиль — Apostles of deathmarried',
  admin: 'Админ-панель — Apostles of deathmarried',
};

function MainApp() {
  const { t } = useI18n();
  const { user, loading: authLoading, refresh } = useAuth();
  const { isVisible: playerVisible } = usePlayer();
  const isAdminOrMod = Boolean(user && (user.role_id === 'admin' || user.role_id === 'moderator'));

  // Check secret Moscow midnight visitor achievement (00:00-00:15 MSK) once per hour per session
  useEffect(() => {
    if (!user?.id) return;
    const key = `aod_msk_visit_${user.id}_${new Date().toISOString().slice(0, 13)}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {}

    authFetch('/api/achievements/check-visit', { method: 'POST' })
      .then((res) => (res.ok ? safeJson<any>(res, null) : null))
      .then((data) => {
        if (data?.newly_unlocked_achievements?.length > 0) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
          refresh();
        }
      })
      .catch(() => {});
  }, [user?.id, refresh]);

  const [route, setRoute] = useState<ParsedRoute>(() => parseRoute(window.location.pathname));
  const [introSeen, setIntroSeen] = useState<boolean>(() => {
    const initial = parseRoute(window.location.pathname);
    if (initial.tab !== 'home' || initial.notFound) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') return true;
    try {
      if (sessionStorage.getItem('apostles_intro_seen') === '1') return true;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    } catch {}
    return false;
  });

  const navigate = useCallback((tab: AppTab | string, profileNickname?: string) => {
    const requestedTab = (['home', 'archive', 'games', 'community', 'creations', 'profile', 'admin'].includes(tab)
      ? tab
      : 'home') as AppTab;
    const safeTab = requestedTab === 'admin' && !isAdminOrMod ? 'home' : requestedTab;
    const targetPath = buildPath(safeTab, profileNickname);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ tab: safeTab, profileNickname }, '', targetPath);
    }
    setRoute({ tab: safeTab, profileNickname });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [isAdminOrMod]);

  const isUnauthorizedAdminRoute = route.tab === 'admin' && !authLoading && !isAdminOrMod;
  const showNotFound = Boolean(route.notFound || isUnauthorizedAdminRoute);

  useEffect(() => {
    const nextTitle = showNotFound
      ? `404 — Apostles of deathmarried`
      : route.profileNickname
        ? `${route.profileNickname} — Apostles of deathmarried`
        : route.tab === 'admin' && !isAdminOrMod
          ? 'Apostles of deathmarried'
          : TAB_TITLES[route.tab];
    document.title = nextTitle;

    const canonicalUrl = `https://apostlesofdeathmarried.ru${showNotFound ? '/' : buildPath(route.tab, route.profileNickname)}`;
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    if (canonicalEl) canonicalEl.setAttribute('href', canonicalUrl);
    const ogUrlEl = document.querySelector('meta[property="og:url"]');
    if (ogUrlEl) ogUrlEl.setAttribute('content', canonicalUrl);
    const ogTitleEl = document.querySelector('meta[property="og:title"]');
    if (ogTitleEl) ogTitleEl.setAttribute('content', nextTitle);
  }, [route, showNotFound, isAdminOrMod]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseRoute(window.location.pathname));
    };
    const handleNavTab = (e: CustomEvent<string>) => {
      if (e.detail) navigate(e.detail);
    };
    const handleNavProfile = (e: CustomEvent<string>) => {
      if (e.detail) navigate('profile', e.detail);
    };
    const handleNavNotification = (
      e: CustomEvent<{ targetType?: string; targetId?: string; targetLink?: string }>
    ) => {
      const detail = e.detail;
      if (!detail) return;
      const targetType = detail.targetType;
      const targetId = detail.targetId;
      const rawLink = typeof detail.targetLink === 'string' ? detail.targetLink.trim() : '';

      if (targetType === 'news' && (!rawLink || rawLink === 'none')) {
        return;
      }

      const fallbackTab: AppTab =
        targetType === 'post'
          ? 'community'
          : targetType === 'creation'
            ? 'creations'
            : targetType === 'album' || targetType === 'single'
              ? 'archive'
              : 'home';

      let tab: AppTab = fallbackTab;
      let profileNickname: string | undefined;
      let targetUrl = buildPath(fallbackTab);
      let searchParams = new URLSearchParams();

      if (rawLink.startsWith('/')) {
        try {
          const parsedUrl = new URL(rawLink, window.location.origin);
          const parsedRoute = parseRoute(parsedUrl.pathname);
          if (!parsedRoute.notFound) {
            tab = parsedRoute.tab === 'admin' && !isAdminOrMod ? 'home' : parsedRoute.tab;
            profileNickname = parsedRoute.profileNickname;
            targetUrl = `${buildPath(tab, profileNickname)}${parsedUrl.search}`;
            searchParams = parsedUrl.searchParams;
          }
        } catch {
          targetUrl = buildPath(fallbackTab);
        }
      }

      window.history.pushState({ tab, profileNickname }, '', targetUrl);
      setRoute({ tab, profileNickname });
      window.scrollTo({ top: 0, behavior: 'smooth' });

      const subTab = searchParams.get('tab');
      const openShop = searchParams.get('shop') === '1';
      const postId = searchParams.get('post') || (targetType === 'post' ? targetId : '');
      const creationId = searchParams.get('creation') || (targetType === 'creation' ? targetId : '');
      const albumId = searchParams.get('album') || (targetType === 'album' ? targetId : '');
      const singleId = searchParams.get('single') || (targetType === 'single' ? targetId : '');

      window.setTimeout(() => {
        if (tab === 'games' && subTab) {
          window.dispatchEvent(new CustomEvent('open-games-tab', { detail: subTab }));
        } else if (tab === 'profile' && (subTab || openShop)) {
          window.dispatchEvent(new CustomEvent('open-profile-section', { detail: { tab: subTab, shop: openShop } }));
        }
        if (tab === 'community' && postId) {
          window.dispatchEvent(new CustomEvent('open-community-post', { detail: postId }));
        } else if (tab === 'creations' && creationId) {
          window.dispatchEvent(new CustomEvent('open-creation', { detail: creationId }));
        } else if (tab === 'archive' && (albumId || singleId)) {
          window.dispatchEvent(
            new CustomEvent('open-archive-release', {
              detail: {
                releaseType: singleId ? 'single' : 'album',
                releaseId: singleId || albumId,
              },
            })
          );
        }
      }, 80);
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('navigate-tab', handleNavTab as EventListener);
    window.addEventListener('navigate-profile', handleNavProfile as EventListener);
    window.addEventListener('navigate-notification', handleNavNotification as EventListener);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('navigate-tab', handleNavTab as EventListener);
      window.removeEventListener('navigate-profile', handleNavProfile as EventListener);
      window.removeEventListener('navigate-notification', handleNavNotification as EventListener);
    };
  }, [navigate]);

  const handleIntroComplete = () => {
    setIntroSeen(true);
    try {
      sessionStorage.setItem('apostles_intro_seen', '1');
    } catch {}
  };

  return (
    <div className="min-h-dvh bg-[#08080a] text-[#ded9d2] flex flex-col font-sans selection:bg-[#4d161f] selection:text-[#f7f4ee] relative overflow-x-hidden">
      {/* Short cinematic prologue running on initial home load */}
      {!introSeen && <IntroAnimation onComplete={handleIntroComplete} />}

      {/* Editorial Minimalist Navbar */}
      <Navbar currentTab={showNotFound ? '' : route.tab} onSelectTab={(tab) => navigate(tab)} />

      {/* Active Tab View or 404 */}
      <main className={`flex-1 ${playerVisible ? 'pb-32 sm:pb-28' : 'pb-16 sm:pb-24'}`}>
        {showNotFound ? (
          <div className="max-w-2xl mx-auto px-6 py-28 text-center">
            <p className="text-[11px] font-ui uppercase tracking-[0.35em] text-[#8c857b] mb-3">404</p>
            <h1 className="font-display text-3xl sm:text-5xl text-[#f0ede6] tracking-[0.12em] uppercase mb-4">
              {t('notFoundTitle')}
            </h1>
            <p className="text-sm text-[#a69f95] max-w-md mx-auto mb-8 leading-relaxed">
              {t('notFoundSubtitle')}
            </p>
            <button
              type="button"
              onClick={() => navigate('home')}
              className="px-6 py-3 bg-[#f0ede6] hover:bg-white text-[#08080a] text-xs uppercase tracking-[0.22em] font-semibold transition-colors cursor-pointer"
            >
              {t('returnHome')}
            </button>
          </div>
        ) : (
          <>
            {route.tab === 'home' && <HomeView onNavigate={(tab) => navigate(tab)} />}
            {route.tab === 'archive' && <ArchiveView />}
            {route.tab === 'games' && <GamesView />}
            {route.tab === 'community' && <CommunityView />}
            {route.tab === 'creations' && <CreationsView />}
            {route.tab === 'profile' && <ProfileView targetNickname={route.profileNickname} />}
            {route.tab === 'admin' && isAdminOrMod && <AdminView />}
          </>
        )}
      </main>

      {/* Bottom Vintage Audio Player (continuous during navigation) */}
      <MusicPlayer />

      {/* Vintage Archival Footer */}
      <Footer />

      {/* Authentication Modal */}
      <AuthModal />

      {/* Global Achievement Unlock Notifications */}
      <AchievementToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <I18nProvider>
        <AuthProvider>
          <PlayerProvider>
            <MainApp />
          </PlayerProvider>
        </AuthProvider>
      </I18nProvider>
    </MotionConfig>
  );
}

