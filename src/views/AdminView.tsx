import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, authFetch, setStoredToken } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { usePlayer } from '../context/PlayerContext.js';
import { CoverArt } from '../components/CoverArt.js';
import { formatDuration, safeJson } from '../utils/logic.js';
import { prepareAndUploadMedia, AUDIO_ACCEPT_ATTR } from '../utils/mediaCompression.js';
import { formatHandle } from '../utils/cosmetics.js';
import {
  AdminUserEditorModal,
  AdminUserDetailsPayload,
} from '../components/admin/AdminUserEditorModal.js';
import { AdminUserResetTab } from '../components/admin/AdminUserResetTab.js';
import { AdminQuizTab } from '../components/admin/AdminQuizTab.js';
import { AdminPromosTab, AdminShopTab } from '../components/admin/AdminShopPromoTab.js';
import { AdminNewsTab, AdminRulesTab } from '../components/admin/AdminRulesNewsTab.js';
import { AdminCommentsSubtab } from '../components/admin/AdminCommentsSubtab.js';
import {
  Shield,
  Users,
  Disc,
  Trash2,
  Activity,
  Plus,
  Upload,
  Music,
  Image,
  ExternalLink,
  Edit2,
  Check,
  Play,
  RotateCcw,
  X,
  Copy,
  CheckCheck,
  AlertCircle,
  Key,
  UserCheck,
  ShieldAlert,
  Volume2,
  Library,
  Sparkles,
  Pin,
  Lock,
  Unlock,
  Trophy,
  Search,
  Clock,
  Eye,
  EyeOff,
  Sliders,
  Megaphone,
  Ticket,
  BookOpen,
  MessageSquare,
  Store,
} from 'lucide-react';

interface DeleteModalState {
  type: 'track' | 'album' | 'single' | 'file' | 'post' | 'creation' | 'quiz' | 'leaderboard_clear' | 'leaderboard_user_reset';
  id: string;
  name: string;
  subtext?: string;
  scope?: string;
}

const formatAdminDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
};

const formatAdminDateTime = (dateStr?: string | null) => {
  if (!dateStr) return '—';
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const AdminView: React.FC = () => {
  const { user, bindAdmin, openAuth, refresh } = useAuth();
  const { t, lang } = useI18n();
  const { playTrack } = usePlayer();

  const isAdmin = user?.role_id === 'admin';
  const isModerator = user?.role_id === 'moderator';

  type AdminTabId =
    | 'discography'
    | 'singles'
    | 'media'
    | 'gametracks'
    | 'quiz'
    | 'leaderboard'
    | 'moderation'
    | 'users'
    | 'user_reset'
    | 'news'
    | 'promos'
    | 'shop'
    | 'rules'
    | 'stats';

  const [activeTab, setActiveTab] = useState<AdminTabId>(() =>
    user?.role_id === 'moderator' ? 'moderation' : 'discography'
  );
  const [stats, setStats] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [albumsList, setAlbumsList] = useState<any[]>([]);
  const [singlesList, setSinglesList] = useState<any[]>([]);
  const [mediaFilesList, setMediaFilesList] = useState<any[]>([]);
  const [gameTracksList, setGameTracksList] = useState<any[]>([]);
  const [quizQuestionsList, setQuizQuestionsList] = useState<any[]>([]);
  const [adminLeaderboard, setAdminLeaderboard] = useState<any[]>([]);
  const [adminLeaderboardSummary, setAdminLeaderboardSummary] = useState<any | null>(null);
  const [lbTimeframe, setLbTimeframe] = useState<'all' | 'weekly' | 'monthly'>('all');
  const [lbGameFilter, setLbGameFilter] = useState<
    'all' | 'guess-track' | 'daily-quiz' | 'guess-lyrics' | 'reverse-track' | 'speed-track'
  >('all');
  const [lbSearch, setLbSearch] = useState('');
  const [lbLoading, setLbLoading] = useState(false);
  const [allPostsList, setAllPostsList] = useState<any[]>([]);
  const [allCreationsList, setAllCreationsList] = useState<any[]>([]);
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [moderationSection, setModerationSection] = useState<'posts' | 'creations' | 'comments' | 'reports'>('posts');
  const [moderationStatusFilter, setModerationStatusFilter] = useState<'pending' | 'all'>('pending');
  const [creationCategoryOverrides, setCreationCategoryOverrides] = useState<Record<string, 'art' | 'meme'>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isModerator && activeTab !== 'moderation' && activeTab !== 'rules') {
      setActiveTab('moderation');
    }
  }, [isModerator, activeTab]);

  // User Management & Statistics State
  const [userSearch, setUserSearch] = useState('');
  const [userSort, setUserSort] = useState<
    'registered_desc' | 'registered_asc' | 'xp_desc' | 'level_desc' | 'games_desc' | 'active_desc' | 'username_asc'
  >('registered_desc');
  const [usersSummary, setUsersSummary] = useState<{
    total_users: number;
    new_last_24h: number;
    total_games_played: number;
    total_quizzes_played: number;
    total_guess_track_played: number;
  } | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [resetPassModal, setResetPassModal] = useState<{ id: string; nickname: string; display_name?: string } | null>(null);
  const [resetPassValue, setResetPassValue] = useState('');
  const [resetPassConfirm, setResetPassConfirm] = useState('');
  const [showResetPass, setShowResetPass] = useState(false);
  const [resettingPass, setResettingPass] = useState(false);
  const [userDetailsModal, setUserDetailsModal] = useState<AdminUserDetailsPayload | null>(null);
  const [loadingUserDetails, setLoadingUserDetails] = useState(false);

  const [quizPoolMeta, setQuizPoolMeta] = useState<{
    custom_active_count: number;
    generated_pool_count: number;
    total_pool_count: number;
  } | null>(null);

  // In-UI Delete Confirmation Modal
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!deleteModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) setDeleteModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteModal, isDeleting]);

  // Admin account bind state
  const [isBinding, setIsBinding] = useState(false);
  const [bindResult, setBindResult] = useState<{ success: boolean; message: string } | null>(null);

  // Status toasts
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Separate refs to avoid ref collision
  const albumCoverInputRef = useRef<HTMLInputElement>(null);
  const trackAudioInputRef = useRef<HTMLInputElement>(null);
  const singleCoverInputRef = useRef<HTMLInputElement>(null);
  const singleAudioInputRef = useRef<HTMLInputElement>(null);
  const mediaStorageInputRef = useRef<HTMLInputElement>(null);

  // Upload & form submit loading flags
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [savingSingle, setSavingSingle] = useState(false);
  const [savingTrack, setSavingTrack] = useState(false);
  const [healthStatus, setHealthStatus] = useState<any>(null);

  // Album Form State
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumFormat, setAlbumFormat] = useState<'album' | 'ep'>('album');
  const [albumYear, setAlbumYear] = useState('2025');
  const [albumDate, setAlbumDate] = useState('2025-01-01');
  const [albumCoverUrl, setAlbumCoverUrl] = useState('');
  const [albumDesc, setAlbumDesc] = useState('');
  const [albumSpotify, setAlbumSpotify] = useState('');
  const [albumApple, setAlbumApple] = useState('');
  const [albumYandex, setAlbumYandex] = useState('');
  const [albumVk, setAlbumVk] = useState('');
  const [albumSoundcloud, setAlbumSoundcloud] = useState('');
  const [albumYoutube, setAlbumYoutube] = useState('');

  // Single Form State
  const [editingSingleId, setEditingSingleId] = useState<string | null>(null);
  const [singleTitle, setSingleTitle] = useState('');
  const [singleYear, setSingleYear] = useState('2025');
  const [singleDate, setSingleDate] = useState('2025-01-01');
  const [singleCoverUrl, setSingleCoverUrl] = useState('');
  const [singleAudioUrl, setSingleAudioUrl] = useState('');
  const [singleDuration, setSingleDuration] = useState('180');
  const [singleDesc, setSingleDesc] = useState('');
  const [singleLyrics, setSingleLyrics] = useState('');
  const [singleSpotify, setSingleSpotify] = useState('');
  const [singleApple, setSingleApple] = useState('');
  const [singleYandex, setSingleYandex] = useState('');
  const [singleVk, setSingleVk] = useState('');
  const [singleSoundcloud, setSingleSoundcloud] = useState('');
  const [singleYoutube, setSingleYoutube] = useState('');

  // Track Form State (inside Album)
  const [trackAlbumId, setTrackAlbumId] = useState('');
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackNumber, setTrackNumber] = useState('1');
  const [trackAudioUrl, setTrackAudioUrl] = useState('');
  const [trackDuration, setTrackDuration] = useState('180');
  const [trackLyrics, setTrackLyrics] = useState('');

  // Refs synced with media URL states so rapid submits right after upload never read stale values
  const albumCoverUrlRef = useRef('');
  const singleCoverUrlRef = useRef('');
  const singleAudioUrlRef = useRef('');
  const trackAudioUrlRef = useRef('');

  const updateAlbumCoverUrl = (val: string) => {
    albumCoverUrlRef.current = val;
    setAlbumCoverUrl(val);
  };
  const updateSingleCoverUrl = (val: string) => {
    singleCoverUrlRef.current = val;
    setSingleCoverUrl(val);
  };
  const updateSingleAudioUrl = (val: string) => {
    singleAudioUrlRef.current = val;
    setSingleAudioUrl(val);
  };
  const updateTrackAudioUrl = (val: string) => {
    trackAudioUrlRef.current = val;
    setTrackAudioUrl(val);
  };

  // Clear toast timer
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const fetchAdminLeaderboard = async (
    tf: 'all' | 'weekly' | 'monthly' = lbTimeframe,
    game: 'all' | 'guess-track' | 'daily-quiz' | 'guess-lyrics' | 'reverse-track' | 'speed-track' = lbGameFilter,
    searchQuery: string = lbSearch
  ) => {
    setLbLoading(true);
    try {
      const qs = new URLSearchParams({
        timeframe: tf,
        game,
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
      });
      const res = await authFetch(`/api/admin/leaderboard?${qs.toString()}`, { cache: 'no-store' });
      const data = await safeJson<any>(res, null);
      if (res.ok && data) {
        setAdminLeaderboard(data.leaders || []);
        setAdminLeaderboardSummary(data.summary || null);
      } else if (data?.error) {
        setErrorMessage(data.error);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to load leaderboard');
    } finally {
      setLbLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || activeTab !== 'leaderboard') return;
    const timer = window.setTimeout(() => {
      fetchAdminLeaderboard(lbTimeframe, lbGameFilter, lbSearch);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [isAdmin, activeTab, lbTimeframe, lbGameFilter, lbSearch]);

  const fetchAdminUsers = async (
    searchQuery: string = userSearch,
    sortKey: typeof userSort = userSort
  ) => {
    if (!isAdmin) return;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (sortKey) params.set('sort', sortKey);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await authFetch(`/api/admin/users${qs}`, { cache: 'no-store' });
      const data = await safeJson<any>(res, null);
      if (res.ok && data) {
        setUsersList(data.users || []);
        if (data.summary) setUsersSummary(data.summary);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin || (activeTab !== 'users' && activeTab !== 'user_reset')) return;
    const timer = window.setTimeout(() => {
      fetchAdminUsers(userSearch, userSort);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isAdmin, activeTab, userSearch, userSort]);

  const openUserDetails = async (userId: string) => {
    setLoadingUserDetails(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/details`, { cache: 'no-store' });
      const data = await safeJson<AdminUserDetailsPayload & { error?: string }>(res, null as any);
      if (res.ok && data?.user) {
        setUserDetailsModal(data);
      } else {
        setErrorMessage(data?.error || (lang === 'ru' ? 'Не удалось загрузить профиль пользователя' : 'Failed to load user details'));
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Network error');
    } finally {
      setLoadingUserDetails(false);
    }
  };

  const handleResetUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPassModal || resettingPass) return;
    if (resetPassValue.length < 8) {
      setErrorMessage(lang === 'ru' ? 'Новый пароль должен содержать минимум 8 символов.' : 'New password must be at least 8 characters.');
      return;
    }
    if (resetPassValue !== resetPassConfirm) {
      setErrorMessage(lang === 'ru' ? 'Пароли не совпадают.' : 'Passwords do not match.');
      return;
    }

    setResettingPass(true);
    try {
      const res = await authFetch(`/api/admin/users/${resetPassModal.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: resetPassValue }),
      });
      const data = await safeJson<any>(res, {});
      if (res.ok) {
        setStatusMessage(data.message || (lang === 'ru' ? 'Пароль пользователя обновлён.' : 'User password updated.'));
        setResetPassModal(null);
        setResetPassValue('');
        setResetPassConfirm('');
        setShowResetPass(false);
        fetchAdminUsers(userSearch);
      } else {
        setErrorMessage(data.error || (lang === 'ru' ? 'Не удалось сбросить пароль.' : 'Failed to reset password.'));
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Network error');
    } finally {
      setResettingPass(false);
    }
  };

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const noStoreInit: RequestInit = { cache: 'no-store' };
      const adminFlag = user?.role_id === 'admin';

      const [resPosts, resCreations, resReports, resHealth] = await Promise.all([
        authFetch('/api/community/posts?status=all', noStoreInit),
        authFetch('/api/creations?status=all', noStoreInit),
        authFetch('/api/admin/reports', noStoreInit),
        fetch('/api/health', noStoreInit),
      ]);

      if (resPosts.ok) setAllPostsList((await safeJson<any>(resPosts, {})).posts || []);
      if (resCreations.ok) setAllCreationsList((await safeJson<any>(resCreations, {})).creations || []);
      if (resReports.ok) setReportsList((await safeJson<any>(resReports, {})).reports || []);
      if (resHealth.ok) setHealthStatus(await safeJson<any>(resHealth, null));

      if (adminFlag) {
        const [resStats, resUsers, resAlb, resSng, resAud, resGame, resQuiz, resLb] = await Promise.all([
          authFetch('/api/admin/stats', noStoreInit),
          authFetch('/api/admin/users', noStoreInit),
          authFetch('/api/archive/albums', noStoreInit),
          authFetch('/api/archive/singles', noStoreInit),
          authFetch('/api/admin/audio-files', noStoreInit),
          authFetch('/api/admin/game-tracks', noStoreInit),
          authFetch('/api/admin/quiz-questions', noStoreInit),
          authFetch(`/api/admin/leaderboard?timeframe=${encodeURIComponent(lbTimeframe)}&game=${encodeURIComponent(lbGameFilter)}`, noStoreInit),
        ]);

        if (resStats.ok) setStats((await safeJson<any>(resStats, {})).stats);
        if (resUsers.ok) {
          const uData = await safeJson<any>(resUsers, {});
          setUsersList(uData.users || []);
          if (uData.summary) setUsersSummary(uData.summary);
        }
        if (resAlb.ok) {
          const albs = (await safeJson<any>(resAlb, {})).albums || [];
          setAlbumsList(albs);
          setTrackAlbumId((prev) => {
            if (albs.length === 0) return '';
            if (prev && albs.some((a: any) => a.id === prev)) return prev;
            return albs[0].id;
          });
        }
        if (resSng.ok) setSinglesList((await safeJson<any>(resSng, {})).singles || []);
        if (resAud.ok) setMediaFilesList((await safeJson<any>(resAud, {})).files || []);
        if (resGame.ok) setGameTracksList((await safeJson<any>(resGame, {})).tracks || []);
        if (resQuiz.ok) {
          const qData = await safeJson<any>(resQuiz, {});
          setQuizQuestionsList(qData.questions || []);
          setQuizPoolMeta({
            custom_active_count: qData.custom_active_count ?? 0,
            generated_pool_count: qData.generated_pool_count ?? 0,
            total_pool_count: qData.total_pool_count ?? (qData.questions || []).length,
          });
        }
        if (resLb.ok) {
          const lbData = await safeJson<any>(resLb, null);
          if (lbData) {
            setAdminLeaderboard(lbData.leaders || []);
            setAdminLeaderboardSummary(lbData.summary || null);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  const pendingPosts = allPostsList.filter((p) => p.status === 'pending');
  const pendingCreations = allCreationsList.filter((c) => c.status === 'pending');
  const pendingReports = reportsList.filter((r) => r.status === 'pending');

  const handleToggleGameTrack = async (id: string, currentVal: number) => {
    try {
      const res = await authFetch(`/api/admin/game-tracks/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_eligible: !currentVal }),
      });
      if (res.ok) {
        setStatusMessage('Статус аудиозаписи в игре успешно обновлен');
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Не удалось обновить статус трека');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Ошибка сети');
    }
  };

  const handleTogglePinPost = async (id: string) => {
    try {
      const res = await authFetch(`/api/admin/community/posts/${id}/pin`, { method: 'POST' });
      const data = await safeJson<{ is_pinned?: number; error?: string }>(res, {});
      if (res.ok) {
        setStatusMessage(
          data.is_pinned
            ? (lang === 'ru' ? 'Тема закреплена' : 'Post pinned')
            : (lang === 'ru' ? 'Тема откреплена' : 'Post unpinned')
        );
        fetchAdminData();
      } else {
        setErrorMessage(data.error || 'Failed to toggle pin');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Network error');
    }
  };

  const handleToggleLockPost = async (id: string) => {
    try {
      const res = await authFetch(`/api/admin/community/posts/${id}/lock`, { method: 'POST' });
      const data = await safeJson<{ is_locked?: number; error?: string }>(res, {});
      if (res.ok) {
        setStatusMessage(
          data.is_locked
            ? (lang === 'ru' ? 'Обсуждение закрыто' : 'Discussion locked')
            : (lang === 'ru' ? 'Обсуждение открыто' : 'Discussion unlocked')
        );
        fetchAdminData();
      } else {
        setErrorMessage(data.error || 'Failed to toggle lock');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Network error');
    }
  };

  const handleModeratePost = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const res = await authFetch(`/api/admin/community/posts/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setStatusMessage(status === 'approved' ? (lang === 'ru' ? 'Тема форума одобрена' : 'Post approved') : (lang === 'ru' ? 'Тема форума отклонена' : 'Post rejected'));
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Moderation error');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Network error');
    }
  };

  const handleModerateCreation = async (
    id: string,
    status: 'approved' | 'rejected',
    category?: 'art' | 'meme'
  ) => {
    try {
      const res = await authFetch(`/api/admin/creations/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(category ? { category } : {}) }),
      });
      if (res.ok) {
        setStatusMessage(status === 'approved' ? 'Работа галереи одобрена' : 'Работа галереи отклонена');
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Ошибка модерации');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Ошибка сети');
    }
  };

  const handleResolveReport = async (id: string, status: 'resolved' | 'dismissed') => {
    try {
      const res = await authFetch(`/api/admin/reports/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setStatusMessage(status === 'resolved' ? 'Жалоба закрыта' : 'Жалоба отклонена');
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Ошибка обработки жалобы');
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Ошибка сети');
    }
  };

  useEffect(() => {
    if (user?.role_id === 'admin' || user?.role_id === 'moderator') {
      fetchAdminData();
    }
  }, [user]);

  // Audio Duration Auto-Detection Helper
  const autoDetectDuration = (url: string, callback: (duration: number) => void) => {
    if (!url) return;
    try {
      const tempAudio = new Audio();
      tempAudio.src = url;
      tempAudio.addEventListener('loadedmetadata', () => {
        if (tempAudio.duration && isFinite(tempAudio.duration)) {
          callback(Math.round(tempAudio.duration));
        }
      });
    } catch {
      // Audio duration detection fallback
    }
  };

  // General Upload Handler (compresses images to WebP 1200px, enforces MP3/OGG/M4A <= 12MB, uses Supabase signed-url + fallback)
  const handleUploadFile = async (
    file: File,
    targetField: 'albumCover' | 'singleCover' | 'trackAudio' | 'singleAudio' | 'mediaStorage'
  ) => {
    if (!file || file.size === 0) {
      setErrorMessage(lang === 'ru' ? 'Выбран пустой файл.' : 'Selected file is empty.');
      return;
    }

    const allowAudio =
      targetField === 'trackAudio' || targetField === 'singleAudio' || targetField === 'mediaStorage';
    const allowImage =
      targetField === 'albumCover' || targetField === 'singleCover' || targetField === 'mediaStorage';
    const allowVideo = targetField === 'mediaStorage';

    setUploadingField(targetField);
    setStatusMessage(lang === 'ru' ? 'Загрузка файла...' : 'Uploading file...');
    setErrorMessage(null);

    try {
      const uploaded = await prepareAndUploadMedia(file, {
        imageMode: 'artwork',
        authFetch,
        lang,
        allowAudio,
        allowImage,
        allowVideo,
      });

      const normalizedUrl = uploaded.url.trim();
      if (targetField === 'albumCover') {
        updateAlbumCoverUrl(normalizedUrl);
      } else if (targetField === 'singleCover') {
        updateSingleCoverUrl(normalizedUrl);
      } else if (targetField === 'trackAudio') {
        updateTrackAudioUrl(normalizedUrl);
        if (normalizedUrl) autoDetectDuration(normalizedUrl, (sec) => setTrackDuration(String(sec)));
      } else if (targetField === 'singleAudio') {
        updateSingleAudioUrl(normalizedUrl);
        if (normalizedUrl) autoDetectDuration(normalizedUrl, (sec) => setSingleDuration(String(sec)));
      }
      setStatusMessage(
        lang === 'ru'
          ? `Файл загружен и привязан к форме: ${uploaded.filename || file.name}. Нажмите «Сохранить» для записи в архив.`
          : `Uploaded and attached to form: ${uploaded.filename || file.name}. Click Save to persist.`
      );
      await fetchAdminData();
    } catch (err: any) {
      setErrorMessage(
        err?.message || (lang === 'ru' ? 'Ошибка сети при загрузке файла' : 'Upload failed due to network error')
      );
      setStatusMessage(null);
    } finally {
      setUploadingField(null);
    }
  };

  // Album Save / Update
  const handleSaveAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingAlbum || uploadingField === 'albumCover' || !albumTitle.trim()) return;

    const streaming_links = {
      spotify: albumSpotify.trim() || undefined,
      apple_music: albumApple.trim() || undefined,
      yandex_music: albumYandex.trim() || undefined,
      vk_music: albumVk.trim() || undefined,
      soundcloud: albumSoundcloud.trim() || undefined,
      youtube_music: albumYoutube.trim() || undefined,
    };

    const effectiveCoverUrl = (albumCoverUrlRef.current || albumCoverUrl).trim();
    const payload = {
      title: albumTitle.trim(),
      format_type: albumFormat,
      release_year: parseInt(albumYear, 10) || 2025,
      release_date: albumDate.trim() || `${albumYear}-01-01`,
      cover_url: effectiveCoverUrl || null,
      description: albumDesc.trim(),
      streaming_links,
    };

    setSavingAlbum(true);
    setErrorMessage(null);
    try {
      const res = editingAlbumId
        ? await authFetch(`/api/archive/albums/${editingAlbumId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch('/api/archive/albums', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await safeJson<{ ok?: boolean; error?: string }>(res, {});
      if (!res.ok) {
        setErrorMessage(data.error || `Failed to save album (HTTP ${res.status})`);
        return;
      }

      setStatusMessage(
        editingAlbumId
          ? lang === 'ru' ? 'Релиз успешно обновлен' : 'Album updated successfully'
          : lang === 'ru' ? 'Новый релиз добавлен в архив' : 'New album created'
      );
      resetAlbumForm();
      await fetchAdminData();
    } catch (e: any) {
      setErrorMessage(e.message || 'Server connection error');
    } finally {
      setSavingAlbum(false);
    }
  };

  const handleEditAlbum = (alb: any) => {
    setEditingAlbumId(alb.id);
    setAlbumTitle(alb.title || '');
    setAlbumFormat(alb.format_type || 'album');
    setAlbumYear(String(alb.release_year || '2025'));
    setAlbumDate(alb.release_date || `${alb.release_year}-01-01`);
    updateAlbumCoverUrl(alb.cover_url || '');
    setAlbumDesc(alb.description || '');
    const sl = alb.streaming_links || {};
    setAlbumSpotify(sl.spotify || '');
    setAlbumApple(sl.apple_music || '');
    setAlbumYandex(sl.yandex_music || '');
    setAlbumVk(sl.vk_music || '');
    setAlbumSoundcloud(sl.soundcloud || '');
    setAlbumYoutube(sl.youtube_music || '');
  };

  const resetAlbumForm = () => {
    setEditingAlbumId(null);
    setAlbumTitle('');
    setAlbumFormat('album');
    setAlbumYear('2025');
    setAlbumDate('2025-01-01');
    updateAlbumCoverUrl('');
    setAlbumDesc('');
    setAlbumSpotify('');
    setAlbumApple('');
    setAlbumYandex('');
    setAlbumVk('');
    setAlbumSoundcloud('');
    setAlbumYoutube('');
  };

  // Single Save / Update
  const handleSaveSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSingle || uploadingField === 'singleCover' || uploadingField === 'singleAudio' || !singleTitle.trim()) return;

    const streaming_links = {
      spotify: singleSpotify.trim() || undefined,
      apple_music: singleApple.trim() || undefined,
      yandex_music: singleYandex.trim() || undefined,
      vk_music: singleVk.trim() || undefined,
      soundcloud: singleSoundcloud.trim() || undefined,
      youtube_music: singleYoutube.trim() || undefined,
    };

    const effectiveCoverUrl = (singleCoverUrlRef.current || singleCoverUrl).trim();
    const effectiveAudioUrl = (singleAudioUrlRef.current || singleAudioUrl).trim();
    const payload = {
      title: singleTitle.trim(),
      release_year: parseInt(singleYear, 10) || 2025,
      release_date: singleDate.trim() || `${singleYear}-01-01`,
      cover_url: effectiveCoverUrl || null,
      audio_url: effectiveAudioUrl || '',
      duration_seconds: parseInt(singleDuration, 10) || 180,
      description: singleDesc.trim(),
      lyrics: singleLyrics.trim(),
      streaming_links,
    };

    setSavingSingle(true);
    setErrorMessage(null);
    try {
      const res = editingSingleId
        ? await authFetch(`/api/archive/singles/${editingSingleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch('/api/archive/singles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await safeJson<{ ok?: boolean; error?: string }>(res, {});
      if (!res.ok) {
        setErrorMessage(data.error || `Failed to save single (HTTP ${res.status})`);
        return;
      }

      setStatusMessage(
        editingSingleId
          ? lang === 'ru' ? 'Сингл успешно обновлен' : 'Single updated'
          : lang === 'ru' ? 'Сингл добавлен в архив' : 'Single inscribed'
      );
      resetSingleForm();
      await fetchAdminData();
    } catch (e: any) {
      setErrorMessage(e.message || 'Server connection error');
    } finally {
      setSavingSingle(false);
    }
  };

  const handleEditSingle = (sng: any) => {
    setEditingSingleId(sng.id);
    setSingleTitle(sng.title || '');
    setSingleYear(String(sng.release_year || '2025'));
    setSingleDate(sng.release_date || `${sng.release_year}-01-01`);
    updateSingleCoverUrl(sng.cover_url || '');
    updateSingleAudioUrl(sng.audio_url || '');
    setSingleDuration(String(sng.duration_seconds || '180'));
    setSingleDesc(sng.description || '');
    setSingleLyrics(sng.lyrics || '');
    const sl = sng.streaming_links || {};
    setSingleSpotify(sl.spotify || '');
    setSingleApple(sl.apple_music || '');
    setSingleYandex(sl.yandex_music || '');
    setSingleVk(sl.vk_music || '');
    setSingleSoundcloud(sl.soundcloud || '');
    setSingleYoutube(sl.youtube_music || '');
  };

  const resetSingleForm = () => {
    setEditingSingleId(null);
    setSingleTitle('');
    setSingleYear('2025');
    setSingleDate('2025-01-01');
    updateSingleCoverUrl('');
    updateSingleAudioUrl('');
    setSingleDuration('180');
    setSingleDesc('');
    setSingleLyrics('');
    setSingleSpotify('');
    setSingleApple('');
    setSingleYandex('');
    setSingleVk('');
    setSingleSoundcloud('');
    setSingleYoutube('');
  };

  // Track Save / Update (in Album)
  const handleSaveTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingTrack || uploadingField === 'trackAudio') return;
    if (!trackTitle.trim() || !trackAlbumId) {
      setErrorMessage(lang === 'ru' ? 'Укажите название трека и выберите альбом' : 'Provide track title and album');
      return;
    }

    const effectiveAudioUrl = (trackAudioUrlRef.current || trackAudioUrl).trim();
    const payload = {
      album_id: trackAlbumId,
      title: trackTitle.trim(),
      track_number: parseInt(trackNumber, 10) || 1,
      audio_url: effectiveAudioUrl,
      duration_seconds: parseInt(trackDuration, 10) || 180,
      lyrics: trackLyrics.trim(),
    };

    setSavingTrack(true);
    setErrorMessage(null);
    try {
      const res = editingTrackId
        ? await authFetch(`/api/archive/tracks/${editingTrackId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await authFetch('/api/archive/tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data = await safeJson<{ ok?: boolean; error?: string }>(res, {});
      if (!res.ok) {
        setErrorMessage(data.error || `Failed to save track (HTTP ${res.status})`);
        return;
      }

      setStatusMessage(
        editingTrackId
          ? lang === 'ru' ? 'Трек успешно обновлен и сохранён' : 'Track updated and saved'
          : lang === 'ru' ? 'Трек добавлен в альбом и сохранён' : 'Track added to album'
      );
      resetTrackForm();
      await fetchAdminData();
    } catch (e: any) {
      setErrorMessage(e.message || 'Server connection error');
    } finally {
      setSavingTrack(false);
    }
  };

  const handleEditTrack = (trk: any) => {
    setEditingTrackId(trk.id);
    setTrackAlbumId(trk.album_id);
    setTrackTitle(trk.title || '');
    setTrackNumber(String(trk.track_number || 1));
    updateTrackAudioUrl(trk.audio_url || '');
    setTrackDuration(String(trk.duration_seconds || 180));
    setTrackLyrics(trk.lyrics || '');
  };

  const resetTrackForm = () => {
    setEditingTrackId(null);
    setTrackTitle('');
    setTrackNumber('1');
    updateTrackAudioUrl('');
    setTrackDuration('180');
    setTrackLyrics('');
  };

  // Delete Action Executor (Invoked from In-UI Confirmation Modal)
  const handleConfirmDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      let res: Response;
      if (deleteModal.type === 'track') {
        res = await authFetch(`/api/archive/tracks/${deleteModal.id}`, { method: 'DELETE' });
      } else if (deleteModal.type === 'album') {
        res = await authFetch(`/api/archive/albums/${deleteModal.id}`, { method: 'DELETE' });
      } else if (deleteModal.type === 'single') {
        res = await authFetch(`/api/archive/singles/${deleteModal.id}`, { method: 'DELETE' });
      } else if (deleteModal.type === 'post') {
        res = await authFetch(`/api/community/posts/${deleteModal.id}`, { method: 'DELETE' });
      } else if (deleteModal.type === 'creation') {
        res = await authFetch(`/api/creations/${deleteModal.id}`, { method: 'DELETE' });
      } else if (deleteModal.type === 'quiz') {
        res = await authFetch(`/api/admin/quiz-questions/${deleteModal.id}`, { method: 'DELETE' });
      } else if (deleteModal.type === 'file') {
        res = await authFetch('/api/admin/delete-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: deleteModal.id }),
        });
      } else if (deleteModal.type === 'leaderboard_clear') {
        res = await authFetch('/api/admin/leaderboard/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: deleteModal.scope || 'all' }),
        });
      } else if (deleteModal.type === 'leaderboard_user_reset') {
        const scopeParam = encodeURIComponent(deleteModal.scope || 'all');
        res = await authFetch(`/api/admin/leaderboard/users/${encodeURIComponent(deleteModal.id)}?scope=${scopeParam}`, {
          method: 'DELETE',
        });
      } else {
        return;
      }

      if (res.ok) {
        if (deleteModal.type === 'album') {
          if (editingAlbumId === deleteModal.id) resetAlbumForm();
          if (trackAlbumId === deleteModal.id) resetTrackForm();
        } else if (deleteModal.type === 'track' && editingTrackId === deleteModal.id) {
          resetTrackForm();
        } else if (deleteModal.type === 'single' && editingSingleId === deleteModal.id) {
          resetSingleForm();
        }

        if (deleteModal.type === 'leaderboard_clear') {
          setStatusMessage(
            lang === 'ru'
              ? `Таблица лидеров успешно очищена (${deleteModal.name}). Аккаунты пользователей сохранены.`
              : `Leaderboard cleared successfully (${deleteModal.name}). User accounts preserved.`
          );
        } else if (deleteModal.type === 'leaderboard_user_reset') {
          setStatusMessage(
            lang === 'ru'
              ? `Игровой рейтинг пользователя «${deleteModal.name}» сброшен. Аккаунт сохранён.`
              : `Leaderboard results reset for «${deleteModal.name}». Account preserved.`
          );
        } else {
          setStatusMessage(
            lang === 'ru'
              ? `«${deleteModal.name}» успешно удален(о)`
              : `«${deleteModal.name}» deleted successfully`
          );
        }

        setDeleteModal(null);
        await fetchAdminData();
        if (deleteModal.type === 'leaderboard_clear' || deleteModal.type === 'leaderboard_user_reset') {
          await Promise.all([
            fetchAdminLeaderboard(lbTimeframe, lbGameFilter, lbSearch),
            refresh(),
          ]);
        }
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || `Operation failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error during operation');
    } finally {
      setIsDeleting(false);
    }
  };

  // User Management
  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      const res = await authFetch(`/api/admin/users/${userId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: newRole }),
      });
      if (res.ok) {
        setStatusMessage(lang === 'ru' ? 'Роль пользователя обновлена' : 'User role updated');
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || (lang === 'ru' ? 'Недостаточно прав для смены роли' : 'Insufficient rights to change role'));
      }
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  const handleToggleBan = async (userId: string, currentlyBanned: boolean) => {
    try {
      const res = await authFetch(`/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_banned: currentlyBanned ? 0 : 1 }),
      });
      if (res.ok) {
        setStatusMessage(
          currentlyBanned
            ? lang === 'ru' ? 'Пользователь разблокирован' : 'User unbanned'
            : lang === 'ru' ? 'Пользователь заблокирован' : 'User banned'
        );
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Failed to update ban status');
      }
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  };

  // Bind Admin Account
  const handleBindAdmin = async () => {
    setIsBinding(true);
    setBindResult(null);
    try {
      const res = await bindAdmin();
      if (res.success) {
        setBindResult({
          success: true,
          message:
            lang === 'ru'
              ? 'Права администратора успешно привязаны к вашей текущей учетной записи!'
              : 'Administrator permissions successfully bound to your current account!',
        });
        fetchAdminData();
      } else {
        setBindResult({
          success: false,
          message: res.error || (lang === 'ru' ? 'Ошибка привязки' : 'Binding failed'),
        });
      }
    } catch (err: any) {
      setBindResult({
        success: false,
        message: err.message || 'Error binding admin account',
      });
    } finally {
      setIsBinding(false);
    }
  };

  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedUrl(text);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopiedUrl(null), 2500);
  };

  // Access Control Guard
  if (!user || (user.role_id !== 'admin' && user.role_id !== 'moderator')) {
    return (
      <div className="max-w-xl mx-auto py-20 px-4">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#121116] border border-[#721b2b]/40 rounded-xl p-8 text-center space-y-6 shadow-2xl"
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-[#200f16] border border-[#821c2c]/60 flex items-center justify-center">
            <Shield className="w-8 h-8 text-[#e4a4ad]" />
          </div>

          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#c49298]">
              Apostles of deathmarried
            </span>
            <h2 className="font-title text-3xl sm:text-4xl text-ivory tracking-wide uppercase font-light mt-1">
              {lang === 'ru' ? 'Панель администратора' : 'Archive Management Studio'}
            </h2>
          </div>

          <p className="text-xs text-ash/90 leading-relaxed font-sans max-w-md mx-auto">
            {lang === 'ru'
              ? 'Для управления релизами, треклистами, загрузки файлов MP3/WAV и модерации требуется учётная запись с правами администратора или модератора.'
              : 'Administrator or moderator authorization is required to edit releases, tracklists, upload MP3/WAV files, and moderate archive content.'}
          </p>

          <div className="pt-2 space-y-3 max-w-sm mx-auto">
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="w-full py-3 px-4 bg-[#6b1826] hover:bg-[#821c2c] text-white text-xs font-semibold uppercase tracking-widest border border-[#962537] transition-all rounded shadow-lg cursor-pointer flex items-center justify-center gap-2"
            >
              <Key className="w-4 h-4" />
              <span>{lang === 'ru' ? 'Войти в аккаунт' : 'Sign in with credentials'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      {/* Toast Messages */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-3 right-3 sm:left-auto sm:right-6 z-50 bg-[#162218] border border-green-600/60 text-green-200 px-4 py-3 rounded-lg shadow-2xl flex items-center justify-between gap-3 font-sans text-xs"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Check className="w-4 h-4 text-green-400 shrink-0" />
              <span className="break-words">{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-green-400 hover:text-white ml-2 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-3 right-3 sm:left-auto sm:right-6 z-50 bg-[#280f14] border border-red-700 text-red-200 px-4 py-3 rounded-lg shadow-2xl flex items-center justify-between gap-3 font-sans text-xs"
          >
            <div className="flex items-center gap-3 min-w-0">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="break-words">{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white ml-2 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header & Account Quick Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-ash/80">
            Apostles of deathmarried · Control Suite
          </span>
          <h1 className="font-title text-3xl sm:text-4xl text-ivory tracking-wide uppercase font-light">
            {lang === 'ru' ? 'Панель управления архивом' : 'Archive Management Studio'}
          </h1>
        </div>

        <div className="flex items-center gap-3 bg-[#131217] border border-white/[0.08] px-4 py-2.5 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-[#200f16] border border-[#821c2c] flex items-center justify-center text-[#e4a4ad]">
            <Shield className="w-4 h-4" />
          </div>
          <div className="text-left font-mono">
            <div className="text-xs text-white flex items-center gap-2">
              <span className="font-semibold">{user.nickname}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#821c2c]/40 text-[#f5c6cb] border border-[#821c2c]">
                {user.role_id.toUpperCase()}
              </span>
            </div>
            <div className="text-[10px] text-ash/70">{user.email || `@${user.nickname}`}</div>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation (RBAC Filtered & Wrapped) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-3 w-full">
        {([
          { id: 'discography', label: lang === 'ru' ? 'Альбомы & EP' : 'Albums & EPs', icon: Disc, count: albumsList.length, adminOnly: true },
          { id: 'singles', label: lang === 'ru' ? 'Синглы' : 'Singles', icon: Music, count: singlesList.length, adminOnly: true },
          { id: 'media', label: lang === 'ru' ? 'Медиатека' : 'Media', icon: Library, count: mediaFilesList.length, adminOnly: true },
          { id: 'gametracks', label: lang === 'ru' ? 'Аудио игр' : 'Game Audio', icon: Volume2, count: gameTracksList.length, adminOnly: true },
          { id: 'quiz', label: lang === 'ru' ? 'Викторина' : 'Quiz', icon: Sparkles, count: quizPoolMeta?.total_pool_count ?? quizQuestionsList.length, adminOnly: true },
          { id: 'leaderboard', label: lang === 'ru' ? 'Лидеры' : 'Leaderboards', icon: Trophy, count: adminLeaderboardSummary?.total_ranked ?? adminLeaderboard.length, adminOnly: true },
          { id: 'moderation', label: lang === 'ru' ? 'Модерация' : 'Moderation', icon: ShieldAlert, count: pendingPosts.length + pendingCreations.length + pendingReports.length, adminOnly: false },
          { id: 'users', label: lang === 'ru' ? 'Пользователи' : 'Users', icon: Users, count: usersSummary?.total_users ?? usersList.length, adminOnly: true },
          { id: 'user_reset', label: lang === 'ru' ? 'Сброс пользователей' : 'User Reset', icon: RotateCcw, adminOnly: true },
          { id: 'news', label: lang === 'ru' ? 'Новости сайта' : 'Site News', icon: Megaphone, adminOnly: true },
          { id: 'promos', label: lang === 'ru' ? 'Промокоды' : 'Promo Codes', icon: Ticket, adminOnly: true },
          { id: 'shop', label: lang === 'ru' ? 'Магазин и Шилды' : 'Shop & Shields', icon: Store, adminOnly: true },
          { id: 'rules', label: lang === 'ru' ? 'Правила' : 'Rules', icon: BookOpen, adminOnly: false },
          { id: 'stats', label: lang === 'ru' ? 'Статистика' : 'Statistics', icon: Activity, adminOnly: true },
        ] as Array<{ id: AdminTabId; label: string; icon: any; count?: number; adminOnly?: boolean }>)
          .filter((tab) => isAdmin || !tab.adminOnly)
          .map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono uppercase tracking-wider transition-all shrink-0 rounded-lg cursor-pointer ${
                  isActive
                    ? 'bg-white/[0.12] text-white font-medium border border-white/20 shadow-md'
                    : 'text-ash hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/[0.08] text-ash">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: ALBUMS & EPS (DISCOGRAPHY - ADMIN ONLY) */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'discography' && (
        <motion.div
          key="discography"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
          {/* Left Column: Album Form */}
          <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="font-title text-2xl text-ivory font-light uppercase tracking-wider">
                {editingAlbumId
                  ? lang === 'ru' ? 'Редактировать релиз' : 'Edit Release'
                  : lang === 'ru' ? 'Новый альбом / EP' : 'New Album / EP'}
              </h3>
              {editingAlbumId && (
                <button
                  onClick={resetAlbumForm}
                  className="font-mono text-[11px] uppercase text-ash hover:text-white flex items-center gap-1.5 cursor-pointer px-2 py-1 bg-white/[0.04] rounded"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{lang === 'ru' ? 'Сбросить' : 'Reset'}</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSaveAlbum} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Название релиза' : 'Release Title'} *
                </label>
                <input
                  type="text"
                  required
                  value={albumTitle}
                  onChange={(e) => setAlbumTitle(e.target.value)}
                  placeholder="e.g. nightmortan"
                  className="w-full px-3.5 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                    {lang === 'ru' ? 'Формат' : 'Format'}
                  </label>
                  <select
                    value={albumFormat}
                    onChange={(e) => setAlbumFormat(e.target.value as any)}
                    className="w-full px-3 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                  >
                    <option value="album">Studio Album (LP)</option>
                    <option value="ep">EP / Mini-Album</option>
                  </select>
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                    {lang === 'ru' ? 'Год выпуска' : 'Release Year'}
                  </label>
                  <input
                    type="number"
                    value={albumYear}
                    onChange={(e) => setAlbumYear(e.target.value)}
                    className="w-full px-3 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Точная дата выхода (YYYY-MM-DD)' : 'Exact Release Date'}
                </label>
                <input
                  type="text"
                  value={albumDate}
                  onChange={(e) => setAlbumDate(e.target.value)}
                  placeholder="2025-01-01"
                  className="w-full px-3.5 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono"
                />
              </div>

              {/* Cover URL + Upload Button */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash">
                    {lang === 'ru' ? 'Оригинальная обложка' : 'Cover Artwork'}
                  </label>
                  <button
                    type="button"
                    onClick={() => albumCoverInputRef.current?.click()}
                    disabled={uploadingField === 'albumCover'}
                    className="font-mono text-[10px] text-bone hover:text-white flex items-center gap-1.5 cursor-pointer underline disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                    <span>
                      {uploadingField === 'albumCover'
                        ? lang === 'ru' ? 'Загрузка...' : 'Uploading...'
                        : lang === 'ru' ? 'Загрузить файл' : 'Upload File'}
                    </span>
                  </button>
                </div>
                <input
                  type="text"
                  value={albumCoverUrl}
                  onChange={(e) => updateAlbumCoverUrl(e.target.value)}
                  placeholder="https://... or /uploads/..."
                  className="w-full px-3.5 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono text-[11px]"
                />
                <input
                  type="file"
                  ref={albumCoverInputRef}
                  accept="image/*,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleUploadFile(f, 'albumCover');
                  }}
                  className="hidden"
                />

                {albumCoverUrl && (
                  <div className="mt-2.5 flex items-center justify-between gap-3 p-2 bg-[#16151a] border border-white/[0.06] rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={albumCoverUrl}
                        alt="Album cover preview"
                        loading="lazy"
                        className="w-12 h-12 object-cover rounded shadow shrink-0"
                        onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                      />
                      <div className="text-[11px] text-ash truncate">
                        {lang === 'ru' ? 'Предпросмотр обложки' : 'Cover Preview'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateAlbumCoverUrl('')}
                      className="text-[10px] font-mono text-ash hover:text-red-400 px-2 py-1 cursor-pointer shrink-0"
                    >
                      {lang === 'ru' ? 'Убрать' : 'Clear'}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Описание релиза' : 'Description'}
                </label>
                <textarea
                  rows={2}
                  value={albumDesc}
                  onChange={(e) => setAlbumDesc(e.target.value)}
                  placeholder={lang === 'ru' ? 'Концепт, звучание, контекст...' : 'Concept, sonic textures, notes...'}
                  className="w-full px-3.5 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                />
              </div>

              {/* Streaming Links */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-ash/80">
                  {lang === 'ru' ? 'Ссылки на стриминг' : 'Official Streaming Links'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={albumSpotify}
                    onChange={(e) => setAlbumSpotify(e.target.value)}
                    placeholder="Spotify URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={albumApple}
                    onChange={(e) => setAlbumApple(e.target.value)}
                    placeholder="Apple Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={albumYandex}
                    onChange={(e) => setAlbumYandex(e.target.value)}
                    placeholder="Yandex Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={albumVk}
                    onChange={(e) => setAlbumVk(e.target.value)}
                    placeholder="VK Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={albumSoundcloud}
                    onChange={(e) => setAlbumSoundcloud(e.target.value)}
                    placeholder="SoundCloud URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={albumYoutube}
                    onChange={(e) => setAlbumYoutube(e.target.value)}
                    placeholder="YouTube Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingAlbum || uploadingField === 'albumCover'}
                className="w-full py-3 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.18] disabled:opacity-50 text-white border border-white/20 rounded-lg transition-all cursor-pointer font-semibold shadow-md"
              >
                {uploadingField === 'albumCover'
                  ? lang === 'ru' ? 'Загрузка обложки...' : 'Uploading Cover...'
                  : savingAlbum
                    ? lang === 'ru' ? 'Сохранение...' : 'Saving...'
                    : editingAlbumId
                      ? lang === 'ru' ? 'Сохранить изменения' : 'Save Changes'
                      : lang === 'ru' ? 'Создать релиз' : 'Create Release'}
              </button>
            </form>
          </div>

          {/* Right Column: Album List & Detailed Tracklist Management */}
          <div className="lg:col-span-7 space-y-6">
            {/* Albums List */}
            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
              <h3 className="font-title text-2xl text-ivory font-light uppercase tracking-wider">
                {lang === 'ru' ? 'Каталог альбомов и EP' : 'Albums & EPs Catalog'} ({albumsList.length})
              </h3>

              <div className="divide-y divide-white/[0.06]">
                {albumsList.map((alb) => (
                  <div key={alb.id} className="py-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <CoverArt
                          title={alb.title}
                          coverUrl={alb.cover_url}
                          format={alb.format_type === 'ep' ? 'EP' : 'LP'}
                          year={alb.release_year}
                          className="w-14 h-14 rounded-lg shrink-0 aspect-square shadow"
                        />
                        <div className="min-w-0">
                          <div className="font-title text-lg text-ivory uppercase tracking-wider truncate">
                            {alb.title}
                          </div>
                          <div className="font-mono text-[11px] text-ash/80 mt-0.5">
                            {alb.format_type === 'ep' ? 'EP' : 'ALBUM'} · {alb.release_year} · {alb.tracks?.length || 0} {lang === 'ru' ? 'треков' : 'tracks'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setTrackAlbumId(alb.id);
                            resetTrackForm();
                          }}
                          className="px-2.5 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs font-mono text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Add track to this album"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{lang === 'ru' ? 'Добавить трек' : 'Add Track'}</span>
                        </button>
                        <button
                          onClick={() => handleEditAlbum(alb)}
                          className="p-2 rounded hover:bg-white/[0.08] text-ash hover:text-white transition-colors cursor-pointer"
                          title="Edit Release"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            setDeleteModal({
                              type: 'album',
                              id: alb.id,
                              name: alb.title,
                              subtext:
                                lang === 'ru'
                                  ? 'Все треки этого альбома также будут безвозвратно удалены из базы данных.'
                                  : 'All tracks belonging to this album will also be permanently removed.',
                            })
                          }
                          className="p-2 rounded hover:bg-red-950/60 text-ash hover:text-red-400 transition-colors cursor-pointer"
                          title="Delete Release"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Tracklist Table */}
                    {alb.tracks && alb.tracks.length > 0 && (
                      <div className="pl-3 sm:pl-5 border-l-2 border-white/[0.08] space-y-1.5 pt-1">
                        {alb.tracks.map((trk: any) => (
                          <div
                            key={trk.id}
                            className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-white/[0.03] text-bone/90 hover:text-white group transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-2">
                              <span className="font-mono text-[11px] text-ash/60 w-5 text-right shrink-0">
                                {trk.track_number}.
                              </span>
                              <span className="truncate font-sans font-medium text-white">{trk.title}</span>
                              {trk.audio_url ? (
                                <span className="font-mono text-[9px] px-1.5 py-0.2 bg-green-950/70 text-green-300 border border-green-700/60 rounded shrink-0 flex items-center gap-1">
                                  <Volume2 className="w-2.5 h-2.5" />
                                  <span>MP3/WAV</span>
                                </span>
                              ) : (
                                <span className="font-mono text-[9px] px-1.5 py-0.2 bg-yellow-950/40 text-yellow-400/80 border border-yellow-700/40 rounded shrink-0">
                                  no audio
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="font-mono text-[10px] text-ash/70">
                                {formatDuration(trk.duration_seconds)}
                              </span>

                              {trk.audio_url && (
                                <button
                                  onClick={() =>
                                    playTrack({
                                      id: trk.id,
                                      title: trk.title,
                                      duration_seconds: trk.duration_seconds,
                                      audio_url: trk.audio_url,
                                      album_title: alb.title,
                                      cover_url: alb.cover_url,
                                      has_local_audio: true,
                                    })
                                  }
                                  className="text-ash hover:text-white p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                                  title="Play in global player"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                              )}

                              <button
                                onClick={() => handleEditTrack(trk)}
                                className="text-ash hover:text-white p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                                title="Edit Track"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() =>
                                  setDeleteModal({
                                    type: 'track',
                                    id: trk.id,
                                    name: trk.title,
                                    subtext:
                                      lang === 'ru'
                                        ? `Трек будет удален из альбома «${alb.title}».`
                                        : `Track will be removed from «${alb.title}».`,
                                  })
                                }
                                className="text-ash hover:text-red-400 p-1 rounded hover:bg-red-950/50 transition-colors cursor-pointer"
                                title="Delete Track"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Inscribe / Edit Track Form */}
            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <h4 className="font-title text-xl text-ivory font-light uppercase tracking-wider flex items-center gap-2">
                  <Music className="w-5 h-5 text-[#c49298]" />
                  <span>
                    {editingTrackId
                      ? lang === 'ru' ? 'Редактировать трек альбома' : 'Edit Album Track'
                      : lang === 'ru' ? 'Добавить трек к альбому' : 'Inscribe Track to Album'}
                  </span>
                </h4>
                {editingTrackId && (
                  <button
                    onClick={resetTrackForm}
                    className="font-mono text-[10px] uppercase text-ash hover:text-white flex items-center gap-1 cursor-pointer px-2 py-1 bg-white/[0.04] rounded"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{lang === 'ru' ? 'Сброс' : 'Reset'}</span>
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveTrack} className="space-y-4 text-xs font-sans">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                      {lang === 'ru' ? 'Целевой альбом' : 'Target Album'} *
                    </label>
                    <select
                      value={trackAlbumId}
                      onChange={(e) => setTrackAlbumId(e.target.value)}
                      className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono text-xs"
                    >
                      {albumsList.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title} ({a.format_type ? a.format_type.toUpperCase() : 'LP'}, {a.release_year})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                      {lang === 'ru' ? 'Порядковый номер' : 'Track Number'}
                    </label>
                    <input
                      type="number"
                      value={trackNumber}
                      onChange={(e) => setTrackNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                      {lang === 'ru' ? 'Название композиции' : 'Track Title'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={trackTitle}
                      onChange={(e) => setTrackTitle(e.target.value)}
                      placeholder="e.g. twilight"
                      className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                      {lang === 'ru' ? 'Длительность (в секундах)' : 'Duration (Seconds)'}
                    </label>
                    <input
                      type="number"
                      value={trackDuration}
                      onChange={(e) => setTrackDuration(e.target.value)}
                      className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Audio File Selection & Upload */}
                <div className="space-y-2 p-3 bg-[#16151a] border border-white/[0.08] rounded-lg">
                  <div className="flex items-center justify-between">
                    <label className="block font-mono text-[10px] uppercase tracking-wider text-ash">
                      {lang === 'ru' ? 'Аудиофайл (MP3 / WAV / OGG / FLAC)' : 'Audio File'}
                    </label>
                    <button
                      type="button"
                      onClick={() => trackAudioInputRef.current?.click()}
                      disabled={uploadingField === 'trackAudio'}
                      className="font-mono text-[10px] text-white bg-white/[0.1] hover:bg-white/[0.2] px-2.5 py-1 rounded flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Upload className="w-3 h-3" />
                      <span>
                        {uploadingField === 'trackAudio'
                          ? lang === 'ru' ? 'Загрузка...' : 'Uploading...'
                          : lang === 'ru' ? 'Загрузить с диска' : 'Upload File'}
                      </span>
                    </button>
                  </div>

                  <input
                    type="text"
                    value={trackAudioUrl}
                    onChange={(e) => {
                      updateTrackAudioUrl(e.target.value);
                      autoDetectDuration(e.target.value, (sec) => setTrackDuration(String(sec)));
                    }}
                    placeholder="/uploads/... or /audio/... or https://..."
                    className="w-full px-3 py-2 bg-[#100f13] border border-white/[0.1] rounded text-white focus:outline-none font-mono text-xs"
                  />
                  <input
                    type="file"
                    ref={trackAudioInputRef}
                    accept={AUDIO_ACCEPT_ATTR}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleUploadFile(f, 'trackAudio');
                    }}
                    className="hidden"
                  />

                  {/* Quick Select from Preserved Media Storage */}
                  {mediaFilesList.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                      <span className="text-ash/70 font-mono text-[10px]">
                        {lang === 'ru' ? 'Или выбрать из медиатеки:' : 'Or pick from storage:'}
                      </span>
                      <select
                        value={mediaFilesList.some((m) => m.storage_path === trackAudioUrl) ? trackAudioUrl : ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            updateTrackAudioUrl(e.target.value);
                            autoDetectDuration(e.target.value, (sec) => setTrackDuration(String(sec)));
                          }
                        }}
                        className="min-w-0 max-w-full sm:max-w-xs bg-[#100f13] border border-white/10 rounded px-2 py-1 text-bone text-xs font-mono truncate"
                      >
                        <option value="">{lang === 'ru' ? '-- Выберите файл --' : '-- Select file --'}</option>
                        {mediaFilesList.map((m) => (
                          <option key={m.id} value={m.storage_path}>
                            {m.filename}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Inline Audio Preview Player */}
                  {trackAudioUrl && (
                    <div className="pt-2 space-y-1.5">
                      <div className="font-mono text-[10px] text-green-300/90 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 truncate">
                          <Check className="w-3 h-3 text-green-400 shrink-0" />
                          <span className="truncate">
                            {lang === 'ru' ? `Привязано: ${trackAudioUrl}` : `Attached: ${trackAudioUrl}`}
                          </span>
                        </span>
                      </div>
                      <audio controls preload="none" src={trackAudioUrl} className="w-full h-8 rounded" />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                    {lang === 'ru' ? 'Текст песни (Lyrics)' : 'Lyrics'}
                  </label>
                  <textarea
                    rows={2}
                    value={trackLyrics}
                    onChange={(e) => setTrackLyrics(e.target.value)}
                    placeholder={lang === 'ru' ? 'Вставьте текст композиции...' : 'Paste lyrics here...'}
                    className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingTrack || uploadingField === 'trackAudio'}
                  className="py-2.5 px-6 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.2] disabled:opacity-50 text-white border border-white/20 rounded-lg transition-colors cursor-pointer font-semibold"
                >
                  {uploadingField === 'trackAudio'
                    ? lang === 'ru' ? 'Загрузка аудио...' : 'Uploading Audio...'
                    : savingTrack
                      ? lang === 'ru' ? 'Сохранение...' : 'Saving...'
                      : editingTrackId
                        ? lang === 'ru' ? 'Сохранить трек' : 'Update Track'
                        : lang === 'ru' ? 'Добавить трек' : 'Inscribe Track'}
                </button>
              </form>
            </div>
          </div>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: SINGLES MANAGEMENT */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'singles' && (
        <motion.div
          key="singles"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
          {/* Left: Single Form */}
          <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="font-title text-2xl text-ivory font-light uppercase tracking-wider">
                {editingSingleId
                  ? lang === 'ru' ? 'Редактировать сингл' : 'Edit Single'
                  : lang === 'ru' ? 'Добавить сингл' : 'Add Single'}
              </h3>
              {editingSingleId && (
                <button
                  onClick={resetSingleForm}
                  className="font-mono text-[11px] uppercase text-ash hover:text-white flex items-center gap-1.5 cursor-pointer px-2 py-1 bg-white/[0.04] rounded"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{lang === 'ru' ? 'Сбросить' : 'Reset'}</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSaveSingle} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Название сингла' : 'Single Title'} *
                </label>
                <input
                  type="text"
                  required
                  value={singleTitle}
                  onChange={(e) => setSingleTitle(e.target.value)}
                  placeholder="e.g. deathmarried"
                  className="w-full px-3.5 py-2.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none focus:border-white/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                    {lang === 'ru' ? 'Год выпуска' : 'Release Year'}
                  </label>
                  <input
                    type="number"
                    value={singleYear}
                    onChange={(e) => setSingleYear(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                    {lang === 'ru' ? 'Длительность (сек)' : 'Duration (Sec)'}
                  </label>
                  <input
                    type="number"
                    value={singleDuration}
                    onChange={(e) => setSingleDuration(e.target.value)}
                    className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Дата выхода (YYYY-MM-DD)' : 'Exact Release Date'}
                </label>
                <input
                  type="text"
                  value={singleDate}
                  onChange={(e) => setSingleDate(e.target.value)}
                  placeholder="2025-01-01"
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono"
                />
              </div>

              {/* Cover URL + Upload */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash">
                    {lang === 'ru' ? 'Обложка сингла' : 'Cover Artwork'}
                  </label>
                  <button
                    type="button"
                    onClick={() => singleCoverInputRef.current?.click()}
                    disabled={uploadingField === 'singleCover'}
                    className="font-mono text-[10px] text-bone hover:text-white flex items-center gap-1.5 cursor-pointer underline disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                    <span>
                      {uploadingField === 'singleCover'
                        ? lang === 'ru' ? 'Загрузка...' : 'Uploading...'
                        : lang === 'ru' ? 'Загрузить файл' : 'Upload File'}
                    </span>
                  </button>
                </div>
                <input
                  type="text"
                  value={singleCoverUrl}
                  onChange={(e) => updateSingleCoverUrl(e.target.value)}
                  placeholder="https://... or /uploads/..."
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none font-mono text-xs"
                />
                <input
                  type="file"
                  ref={singleCoverInputRef}
                  accept="image/*,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleUploadFile(f, 'singleCover');
                  }}
                  className="hidden"
                />

                {singleCoverUrl && (
                  <div className="mt-2 flex items-center justify-between gap-3 p-2 bg-[#16151a] border border-white/[0.06] rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={singleCoverUrl}
                        alt="Single cover preview"
                        loading="lazy"
                        className="w-12 h-12 object-cover rounded shadow shrink-0"
                        onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                      />
                      <div className="text-[11px] text-ash truncate">
                        {lang === 'ru' ? 'Предпросмотр обложки' : 'Cover Preview'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSingleCoverUrl('')}
                      className="text-[10px] font-mono text-ash hover:text-red-400 px-2 py-1 cursor-pointer shrink-0"
                    >
                      {lang === 'ru' ? 'Убрать' : 'Clear'}
                    </button>
                  </div>
                )}
              </div>

              {/* Audio URL + Upload */}
              <div className="p-3 bg-[#16151a] border border-white/[0.08] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-ash">
                    {lang === 'ru' ? 'Аудиофайл сингла (MP3 / WAV)' : 'Audio File (MP3 / WAV)'}
                  </label>
                  <button
                    type="button"
                    onClick={() => singleAudioInputRef.current?.click()}
                    disabled={uploadingField === 'singleAudio'}
                    className="font-mono text-[10px] text-white bg-white/[0.1] hover:bg-white/[0.2] px-2.5 py-1 rounded flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" />
                    <span>
                      {uploadingField === 'singleAudio'
                        ? lang === 'ru' ? 'Загрузка...' : 'Uploading...'
                        : lang === 'ru' ? 'Загрузить файл' : 'Upload File'}
                    </span>
                  </button>
                </div>
                <input
                  type="text"
                  value={singleAudioUrl}
                  onChange={(e) => {
                    updateSingleAudioUrl(e.target.value);
                    autoDetectDuration(e.target.value, (sec) => setSingleDuration(String(sec)));
                  }}
                  placeholder="/uploads/... or /audio/..."
                  className="w-full px-3 py-2 bg-[#100f13] border border-white/[0.1] rounded text-white focus:outline-none font-mono text-xs"
                />
                <input
                  type="file"
                  ref={singleAudioInputRef}
                  accept={AUDIO_ACCEPT_ATTR}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleUploadFile(f, 'singleAudio');
                  }}
                  className="hidden"
                />

                {mediaFilesList.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <span className="text-ash/70 font-mono text-[10px]">
                      {lang === 'ru' ? 'Или выбрать из медиатеки:' : 'Or pick from storage:'}
                    </span>
                    <select
                      value={mediaFilesList.some((m) => m.storage_path === singleAudioUrl) ? singleAudioUrl : ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          updateSingleAudioUrl(e.target.value);
                          autoDetectDuration(e.target.value, (sec) => setSingleDuration(String(sec)));
                        }
                      }}
                      className="min-w-0 max-w-full sm:max-w-xs bg-[#100f13] border border-white/10 rounded px-2 py-1 text-bone text-xs font-mono truncate"
                    >
                      <option value="">{lang === 'ru' ? '-- Выберите файл --' : '-- Select file --'}</option>
                      {mediaFilesList.map((m) => (
                        <option key={m.id} value={m.storage_path}>
                          {m.filename}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {singleAudioUrl && (
                  <div className="pt-2 space-y-1.5">
                    <div className="font-mono text-[10px] text-green-300/90 flex items-center gap-1.5 truncate">
                      <Check className="w-3 h-3 text-green-400 shrink-0" />
                      <span className="truncate">
                        {lang === 'ru' ? `Привязано: ${singleAudioUrl}` : `Attached: ${singleAudioUrl}`}
                      </span>
                    </div>
                    <audio controls preload="none" src={singleAudioUrl} className="w-full h-8 rounded" />
                  </div>
                )}
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Описание сингла' : 'Description'}
                </label>
                <textarea
                  rows={2}
                  value={singleDesc}
                  onChange={(e) => setSingleDesc(e.target.value)}
                  placeholder="Context and details..."
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ash mb-1">
                  {lang === 'ru' ? 'Текст сингла' : 'Lyrics'}
                </label>
                <textarea
                  rows={2}
                  value={singleLyrics}
                  onChange={(e) => setSingleLyrics(e.target.value)}
                  placeholder="Lyrics..."
                  className="w-full px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-white focus:outline-none"
                />
              </div>

              {/* Streaming Links */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-ash/80">
                  {lang === 'ru' ? 'Ссылки на стриминг' : 'Official Streaming Links'}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={singleSpotify}
                    onChange={(e) => setSingleSpotify(e.target.value)}
                    placeholder="Spotify URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={singleApple}
                    onChange={(e) => setSingleApple(e.target.value)}
                    placeholder="Apple Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={singleYandex}
                    onChange={(e) => setSingleYandex(e.target.value)}
                    placeholder="Yandex Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={singleVk}
                    onChange={(e) => setSingleVk(e.target.value)}
                    placeholder="VK Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={singleSoundcloud}
                    onChange={(e) => setSingleSoundcloud(e.target.value)}
                    placeholder="SoundCloud URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                  <input
                    type="text"
                    value={singleYoutube}
                    onChange={(e) => setSingleYoutube(e.target.value)}
                    placeholder="YouTube Music URL"
                    className="px-2.5 py-1.5 bg-[#16151a] border border-white/[0.08] rounded text-xs text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSingle || uploadingField === 'singleCover' || uploadingField === 'singleAudio'}
                className="w-full py-3 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.2] disabled:opacity-50 text-white border border-white/20 rounded-lg transition-all cursor-pointer font-semibold shadow-md"
              >
                {uploadingField === 'singleCover' || uploadingField === 'singleAudio'
                  ? lang === 'ru' ? 'Загрузка файла...' : 'Uploading File...'
                  : savingSingle
                    ? lang === 'ru' ? 'Сохранение...' : 'Saving...'
                    : editingSingleId
                      ? lang === 'ru' ? 'Сохранить сингл' : 'Save Single'
                      : lang === 'ru' ? 'Создать сингл' : 'Create Single'}
              </button>
            </form>
          </div>

          {/* Right: Singles List */}
          <div className="lg:col-span-7 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
            <h3 className="font-title text-2xl text-ivory font-light uppercase tracking-wider">
              {lang === 'ru' ? 'Архив синглов deathmarried' : 'Preserved Singles Catalog'} ({singlesList.length})
            </h3>

            <div className="divide-y divide-white/[0.06]">
              {singlesList.map((sng) => (
                <div key={sng.id} className="py-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <CoverArt
                      title={sng.title}
                      coverUrl={sng.cover_url}
                      format="SINGLE"
                      year={sng.release_year}
                      className="w-12 h-12 rounded-lg shrink-0 aspect-square shadow"
                    />
                    <div className="min-w-0">
                      <div className="font-title text-lg text-ivory uppercase tracking-wider truncate">
                        {sng.title}
                      </div>
                      <div className="font-mono text-[10px] text-ash/80 flex items-center gap-2 mt-0.5">
                        <span>SINGLE · {sng.release_year}</span>
                        <span>· {formatDuration(sng.duration_seconds)}</span>
                        {sng.audio_url && (
                          <span className="px-1.5 py-0.2 bg-green-950/70 text-green-300 border border-green-800 rounded text-[9px]">
                            MP3/WAV
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {sng.audio_url && (
                      <button
                        onClick={() =>
                          playTrack({
                            id: sng.id,
                            title: sng.title,
                            duration_seconds: sng.duration_seconds,
                            audio_url: sng.audio_url,
                            album_title: 'Single',
                            cover_url: sng.cover_url,
                            has_local_audio: true,
                          })
                        }
                        className="p-2 rounded hover:bg-white/[0.1] text-bone transition-colors cursor-pointer"
                        title="Play in console"
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                    )}
                    <button
                      onClick={() => handleEditSingle(sng)}
                      className="p-2 rounded hover:bg-white/[0.08] text-ash hover:text-white transition-colors cursor-pointer"
                      title="Edit Single"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        setDeleteModal({
                          type: 'single',
                          id: sng.id,
                          name: sng.title,
                          subtext:
                            lang === 'ru'
                              ? 'Сингл будет удален из цифрового каталога архива.'
                              : 'Single will be removed from the archive catalog.',
                        })
                      }
                      className="p-2 rounded hover:bg-red-950/60 text-ash hover:text-red-400 transition-colors cursor-pointer"
                      title="Delete Single"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {singlesList.length === 0 && (
                <div className="text-center py-12 font-mono text-xs text-ash/60">
                  {lang === 'ru' ? 'В архиве пока нет синглов.' : 'No singles inscribed yet.'}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: MEDIA STORAGE (MP3, WAV, COVERS) */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'media' && (
        <motion.div
          key="media"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* Upload Drop Zone / Action Banner */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-title text-2xl text-ivory font-light uppercase tracking-wider flex items-center gap-2">
                  <Library className="w-6 h-6 text-[#c49298]" />
                  <span>{lang === 'ru' ? 'Хранилище медиафайлов (MP3, OGG, M4A, Обложки)' : 'Media Storage Repository'}</span>
                </h3>
                <p className="font-sans text-xs text-ash mt-1 max-w-xl">
                  {lang === 'ru'
                    ? 'Загружайте треки в форматах MP3, OGG, M4A (до 12 МБ) или изображения обложек (автосжатие в WebP). После загрузки вы можете скопировать ссылку в один клик или вставить файл в треклист.'
                    : 'Upload audio tracks in MP3, OGG, M4A formats (up to 12 MB) or cover artwork (auto-compressed to WebP). Copy direct paths with 1-click or assign to tracks.'}
                </p>
              </div>

              <div>
                <button
                  onClick={() => mediaStorageInputRef.current?.click()}
                  disabled={uploadingField === 'mediaStorage'}
                  className="inline-flex items-center gap-2.5 font-mono text-xs uppercase tracking-widest px-5 py-3 rounded-lg bg-[#821c2c] hover:bg-[#962537] text-white border border-[#962537] transition-all cursor-pointer font-semibold shadow-lg disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {uploadingField === 'mediaStorage'
                      ? lang === 'ru' ? 'Загрузка файла...' : 'Uploading...'
                      : lang === 'ru' ? 'Загрузить файл' : 'Upload File'}
                  </span>
                </button>
                <input
                  type="file"
                  ref={mediaStorageInputRef}
                  accept={`${AUDIO_ACCEPT_ATTR},image/*,.jpg,.jpeg,.png,.webp`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleUploadFile(f, 'mediaStorage');
                  }}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {/* Files List */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-bone font-medium">
                {lang === 'ru' ? 'Сохраненные медиафайлы' : 'Preserved Media Files'} ({mediaFilesList.length})
              </span>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {mediaFilesList.map((file) => {
                const isAudio =
                  file.storage_path?.endsWith('.mp3') ||
                  file.storage_path?.endsWith('.wav') ||
                  file.storage_path?.endsWith('.ogg') ||
                  file.storage_path?.endsWith('.flac') ||
                  file.storage_path?.endsWith('.m4a') ||
                  file.mime_type?.startsWith('audio/');

                return (
                  <div key={file.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                        {isAudio ? (
                          <Music className="w-5 h-5 text-[#c49298]" />
                        ) : (
                          <Image className="w-5 h-5 text-ash" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-bone font-medium truncate">{file.filename}</div>
                        <div className="font-mono text-[10px] text-ash/60 mt-0.5">
                          {(file.byte_size / (1024 * 1024)).toFixed(2)} MB · {file.mime_type} ·{' '}
                          {formatAdminDate(file.created_at)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {isAudio && (
                        <button
                          onClick={() =>
                            playTrack({
                              id: file.id,
                              title: file.filename,
                              duration_seconds: 180,
                              audio_url: file.storage_path,
                              album_title: 'Preview Storage',
                              has_local_audio: true,
                            })
                          }
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 text-bone hover:text-white cursor-pointer transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Play</span>
                        </button>
                      )}

                      <button
                        onClick={() => copyToClipboard(file.storage_path)}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/30 text-ash hover:text-white cursor-pointer transition-colors"
                      >
                        {copiedUrl === file.storage_path ? (
                          <>
                            <CheckCheck className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-green-300">{lang === 'ru' ? 'Скопировано' : 'Copied'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{lang === 'ru' ? 'Копировать ссылку' : 'Copy Path'}</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() =>
                          setDeleteModal({
                            type: 'file',
                            id: file.storage_path,
                            name: file.filename,
                            subtext:
                              lang === 'ru'
                                ? 'Файл будет физически удален с диска сервера и из базы данных.'
                                : 'File will be permanently unlinked from server disk and database.',
                          })
                        }
                        className="p-2 rounded-lg hover:bg-red-950/60 text-ash hover:text-red-400 border border-transparent hover:border-red-900/60 transition-colors cursor-pointer"
                        title="Delete file"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {mediaFilesList.length === 0 && (
                <div className="text-center py-14 font-mono text-xs text-ash/60">
                  {lang === 'ru' ? 'В хранилище пока нет загруженных файлов.' : 'No media files stored yet.'}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: USERS & ADMIN ACCOUNT BINDING */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'users' && (
        <motion.div
          key="users"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* Admin Account Binding Hero Box (only shown to admins) */}
          {user.role_id === 'admin' && (
            <div className="bg-gradient-to-r from-[#1c0f16] via-[#141014] to-[#100f13] border border-[#821c2c]/50 rounded-xl p-6 sm:p-8 space-y-4 shadow-2xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#821c2c]/30 border border-[#821c2c]/60 text-[#e4a4ad] text-[10px] font-mono uppercase tracking-wider">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{lang === 'ru' ? 'Главная учетная запись администратора' : 'Master Administrator Account'}</span>
                  </div>
                  <h3 className="font-title text-2xl sm:text-3xl text-ivory tracking-wide uppercase font-light">
                    {user.email || user.nickname}
                  </h3>
                  <p className="text-xs text-ash font-sans max-w-xl leading-relaxed">
                    {lang === 'ru'
                      ? 'Ваш аккаунт привязан к роли главного администратора архива. Вы можете синхронизировать права доступа и адрес администратора sushkanov097@gmail.com.'
                      : 'Your account has administrator privileges. You can synchronize administrator rights and primary email binding.'}
                  </p>
                </div>

                <div className="shrink-0 flex flex-col gap-2">
                  <button
                    onClick={handleBindAdmin}
                    disabled={isBinding}
                    className="px-5 py-3 rounded-lg bg-[#821c2c] hover:bg-[#962537] text-white text-xs font-mono font-semibold uppercase tracking-widest border border-[#962537] shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <UserCheck className="w-4 h-4" />
                    <span>
                      {isBinding
                        ? lang === 'ru' ? 'Синхронизация...' : 'Syncing...'
                        : lang === 'ru' ? 'Синхронизировать права' : 'Sync Admin Binding'}
                    </span>
                  </button>

                  <div className="text-[10px] font-mono text-ash/70 text-center">
                    {lang === 'ru' ? 'Автоматическая синхронизация сессии' : 'Session auto-sync enabled'}
                  </div>
                </div>
              </div>

              {bindResult && (
                <div
                  className={`p-3 rounded-lg border text-xs font-mono flex items-center gap-2.5 ${
                    bindResult.success
                      ? 'bg-green-950/60 border-green-700 text-green-200'
                      : 'bg-red-950/60 border-red-700 text-red-200'
                  }`}
                >
                  {bindResult.success ? <Check className="w-4 h-4 text-green-400" /> : <AlertCircle className="w-4 h-4 text-red-400" />}
                  <span>{bindResult.message}</span>
                </div>
              )}
            </div>
          )}

          {/* Read-only KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
            <div className="p-4 rounded-xl bg-[#100f13] border border-white/[0.08] space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-ash/70">
                {lang === 'ru' ? 'Всего пользователей' : 'Total Users'}
              </div>
              <div className="text-2xl font-semibold text-ivory">
                {usersSummary?.total_users ?? usersList.length}
              </div>
              <div className="text-[10px] text-ash/60">
                {lang === 'ru' ? 'зарегистрировано в архиве' : 'registered accounts'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#100f13] border border-white/[0.08] space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-ash/70">
                {lang === 'ru' ? 'Новых за 24 часа' : 'New (Last 24h)'}
              </div>
              <div className="text-2xl font-semibold text-[#6ee7b7]">
                +{usersSummary?.new_last_24h ?? 0}
              </div>
              <div className="text-[10px] text-ash/60">
                {lang === 'ru' ? 'регистраций за сутки' : 'signups in 24h'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#100f13] border border-white/[0.08] space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-ash/70">
                {lang === 'ru' ? 'Всего сыграно игр' : 'Total Games Played'}
              </div>
              <div className="text-2xl font-semibold text-ivory">
                {usersSummary?.total_games_played ?? 0}
              </div>
              <div className="text-[10px] text-ash/60">
                {lang === 'ru' ? 'все попытки пользователей' : 'all game attempts'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#100f13] border border-white/[0.08] space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-ash/70">
                {lang === 'ru' ? 'Викторина / Угадай трек' : 'Quiz / Guess Track'}
              </div>
              <div className="text-2xl font-semibold text-[#e4a4ad]">
                {usersSummary?.total_quizzes_played ?? 0}
                <span className="text-sm text-ash/50 mx-1">/</span>
                {usersSummary?.total_guess_track_played ?? 0}
              </div>
              <div className="text-[10px] text-ash/60">
                {lang === 'ru' ? 'распределение по режимам' : 'breakdown by game'}
              </div>
            </div>
          </div>

          {/* Registered Users List */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/[0.06] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs uppercase tracking-wider text-bone font-medium">
                  {lang === 'ru' ? 'Пользователи и статистика' : 'Users & Statistics'} ({usersList.length})
                </span>
                {usersLoading && (
                  <span className="font-mono text-[10px] text-ash/60 uppercase">
                    {lang === 'ru' ? 'Обновление...' : 'Loading...'}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
                <select
                  value={userSort}
                  onChange={(e) => setUserSort(e.target.value as typeof userSort)}
                  aria-label={lang === 'ru' ? 'Сортировка пользователей' : 'Sort users'}
                  className="px-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-[#821c2c] cursor-pointer"
                >
                  <option value="registered_desc">{lang === 'ru' ? 'Сначала новые' : 'Newest first'}</option>
                  <option value="active_desc">{lang === 'ru' ? 'По последней активности' : 'Last active'}</option>
                  <option value="xp_desc">{lang === 'ru' ? 'По Total XP (убыв.)' : 'Highest XP'}</option>
                  <option value="level_desc">{lang === 'ru' ? 'По уровню (убыв.)' : 'Highest Level'}</option>
                  <option value="games_desc">{lang === 'ru' ? 'По числу игр' : 'Most games'}</option>
                  <option value="username_asc">{lang === 'ru' ? 'По @username (A–Z)' : 'Username A–Z'}</option>
                  <option value="registered_asc">{lang === 'ru' ? 'Сначала старые' : 'Oldest first'}</option>
                </select>

                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-ash/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder={lang === 'ru' ? 'Поиск по имени, @username или email...' : 'Search by name, @username or email...'}
                    className="w-full pl-9 pr-8 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-xs font-mono text-white placeholder:text-ash/40 focus:outline-none focus:border-[#821c2c]"
                  />
                  {userSearch && (
                    <button
                      type="button"
                      onClick={() => setUserSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ash/60 hover:text-white cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {usersList.length === 0 && !usersLoading && (
                <div className="p-10 text-center font-mono text-xs text-ash/60">
                  {lang === 'ru' ? 'Пользователи по вашему запросу не найдены.' : 'No users match your search.'}
                </div>
              )}

              {usersList.map((u) => {
                const isCurrentUser = u.id === user.id;
                const isMasterAdmin = u.nickname === 'sushkanov097' || u.email === 'sushkanov097@gmail.com';
                const displayName = u.display_name || u.nickname;
                const isLocked = Boolean(u.locked_until && new Date(u.locked_until).getTime() > Date.now());

                return (
                  <div key={u.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-white/[0.015] transition-colors">
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-[#1c1a24] border border-white/10 flex items-center justify-center font-title text-base text-ivory uppercase overflow-hidden shrink-0">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt={displayName} loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          displayName?.[0] || 'A'
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-serif text-base text-ivory font-medium truncate">
                            {displayName}
                          </span>
                          <span className="font-mono text-[11px] text-ash/75">
                            {formatHandle(u.nickname)}
                          </span>
                          {isCurrentUser && (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-bone">
                              {lang === 'ru' ? 'Вы' : 'You'}
                            </span>
                          )}
                          {isMasterAdmin && (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#821c2c]/40 text-[#f5c6cb] border border-[#821c2c]">
                              Master
                            </span>
                          )}
                          {Boolean(u.is_banned) && (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-red-950/70 text-red-300 border border-red-800/70">
                              {lang === 'ru' ? 'Заблокирован' : 'Banned'}
                            </span>
                          )}
                          {isLocked && (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-700/60">
                              {lang === 'ru' ? 'Временная блокировка входа' : 'Login Locked'}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-ash/65 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                          <span>{u.email || '—'}</span>
                          <span>·</span>
                          <span>LVL {u.level || 1} ({u.xp || 0} XP / {u.total_xp ?? u.xp ?? 0} Total)</span>
                          <span>·</span>
                          <span>
                            {lang === 'ru' ? 'Игр' : 'Games'}: {u.games_played || 0}
                            {(u.daily_quiz_played || u.guess_track_played) ? (
                              <span className="text-ash/45">
                                {' '}({lang === 'ru' ? 'викт.' : 'quiz'} {u.daily_quiz_played || 0} / {lang === 'ru' ? 'трек' : 'track'} {u.guess_track_played || 0})
                              </span>
                            ) : null}
                          </span>
                          <span>·</span>
                          <span>{lang === 'ru' ? 'Достижений' : 'Ach'}: {u.achievements_count || 0}</span>
                          <span>·</span>
                          <span>{lang === 'ru' ? 'Предметов' : 'Items'}: {u.inventory_count || 0}</span>
                          <span>·</span>
                          <span>{lang === 'ru' ? 'Рег.' : 'Joined'}: {formatAdminDate(u.registered_at)}</span>
                          <span>·</span>
                          <span className="text-[#c49298]">
                            {lang === 'ru' ? 'Активность' : 'Active'}: {formatAdminDateTime(u.last_active_at || u.registered_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openUserDetails(u.id)}
                        disabled={loadingUserDetails}
                        className="font-mono text-[10px] uppercase px-3 py-1.5 rounded-lg border border-white/[0.12] bg-[#16151a] text-bone hover:border-white/30 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>{lang === 'ru' ? 'Профиль и права' : 'Manage'}</span>
                      </button>

                      {user.role_id === 'admin' && (!isMasterAdmin || isCurrentUser) && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetPassModal({ id: u.id, nickname: u.nickname, display_name: displayName });
                            setResetPassValue('');
                            setResetPassConfirm('');
                            setShowResetPass(false);
                          }}
                          className="font-mono text-[10px] uppercase px-3 py-1.5 rounded-lg border border-amber-800/70 bg-amber-950/30 text-amber-200 hover:bg-amber-950/60 transition-colors cursor-pointer flex items-center gap-1.5"
                        >
                          <Key className="w-3 h-3" />
                          <span>{lang === 'ru' ? 'Сброс пароля' : 'Reset Password'}</span>
                        </button>
                      )}

                      <select
                        value={u.role_id}
                        disabled={(isMasterAdmin && !isCurrentUser) || user.role_id !== 'admin'}
                        onChange={(e) => handleChangeRole(u.id, e.target.value)}
                        className="px-3 py-1.5 bg-[#16151a] border border-white/[0.1] rounded-lg text-white font-mono text-xs cursor-pointer focus:outline-none disabled:opacity-50"
                      >
                        <option value="user">User</option>
                        <option value="moderator">Moderator</option>
                        <option value="admin">Admin</option>
                      </select>

                      {!isMasterAdmin && (
                        <button
                          onClick={() => handleToggleBan(u.id, Boolean(u.is_banned))}
                          className={`font-mono text-[10px] uppercase px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                            u.is_banned
                              ? 'border-green-800 text-green-300 hover:bg-green-950/50'
                              : 'border-red-900 text-red-400 hover:bg-red-950/50'
                          }`}
                        >
                          {u.is_banned
                            ? lang === 'ru' ? 'Разблокировать' : 'Unban'
                            : lang === 'ru' ? 'Заблокировать' : 'Ban'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: STATS */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'stats' && (
        <motion.div
          key="stats"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-[#100f13] border border-white/[0.08] p-5 rounded-xl space-y-1">
              <span className="font-mono text-[10px] uppercase text-ash tracking-wider">
                {lang === 'ru' ? 'Всего альбомов и EP' : 'Albums & EPs'}
              </span>
              <div className="font-title text-3xl text-ivory">{albumsList.length}</div>
            </div>
            <div className="bg-[#100f13] border border-white/[0.08] p-5 rounded-xl space-y-1">
              <span className="font-mono text-[10px] uppercase text-ash tracking-wider">
                {lang === 'ru' ? 'Официальных синглов' : 'Official Singles'}
              </span>
              <div className="font-title text-3xl text-ivory">{singlesList.length}</div>
            </div>
            <div className="bg-[#100f13] border border-white/[0.08] p-5 rounded-xl space-y-1">
              <span className="font-mono text-[10px] uppercase text-ash tracking-wider">
                {lang === 'ru' ? 'Загруженных файлов' : 'Media Storage Files'}
              </span>
              <div className="font-title text-3xl text-ivory">{mediaFilesList.length}</div>
            </div>
            <div className="bg-[#100f13] border border-white/[0.08] p-5 rounded-xl space-y-1">
              <span className="font-mono text-[10px] uppercase text-ash tracking-wider">
                {lang === 'ru' ? 'Зарегистрировано слушателей' : 'Registered Members'}
              </span>
              <div className="font-title text-3xl text-ivory">{usersList.length}</div>
            </div>
          </div>

          {healthStatus && (
            <div className="bg-[#100f13] border border-white/[0.08] p-5 rounded-xl space-y-3 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5">
                <span className="uppercase tracking-wider text-bone">
                  {lang === 'ru' ? 'Хранилище и синхронизация Supabase' : 'Storage & Supabase Cloud Sync'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] uppercase border ${
                    healthStatus.cloud_persistence_enabled
                      ? 'bg-green-950/60 border-green-700 text-green-300'
                      : 'bg-yellow-950/40 border-yellow-700/60 text-yellow-300'
                  }`}
                >
                  {healthStatus.cloud_persistence_enabled
                    ? (lang === 'ru' ? 'Supabase подключён' : 'Supabase Connected')
                    : (lang === 'ru' ? 'Локальный режим SQLite' : 'Local SQLite Mode')}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-ash">
                <div>
                  <span className="text-ash/60 block">{lang === 'ru' ? 'Режим:' : 'Mode:'}</span>
                  <span className="text-ivory">{healthStatus.storage_mode}</span>
                </div>
                <div>
                  <span className="text-ash/60 block">{lang === 'ru' ? 'Прямая загрузка MP3 в облако:' : 'Direct Cloud MP3 Upload:'}</span>
                  <span className="text-ivory">
                    {healthStatus.direct_media_upload_enabled
                      ? (lang === 'ru' ? 'Активна (аудио до 12 МБ)' : 'Active (audio up to 12 MB)')
                      : (lang === 'ru' ? 'Ожидает ключи Supabase' : 'Requires Supabase env keys')}
                  </span>
                </div>
                <div>
                  <span className="text-ash/60 block">{lang === 'ru' ? 'Последний облачный бэкап:' : 'Last Cloud Backup:'}</span>
                  <span className="text-ivory">
                    {healthStatus.last_backup_at ? formatAdminDate(healthStatus.last_backup_at) : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB: GAME AUDIO POOL (AUTOMATIC LINKING - ADMIN ONLY) */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'gametracks' && (
        <motion.div
          key="gametracks"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* Header Explanation */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-2 font-mono text-xs">
            <div className="flex items-center gap-2 text-white font-medium text-sm">
              <Volume2 className="w-4 h-4 text-[#821c2c]" />
              <span>
                {lang === 'ru'
                  ? 'Автоматический пул треков для музыкальных режимов (Угадай трек / Реверс / 0.5x–2.5x)'
                  : 'Automatic Track Pool for Music Modes'}
              </span>
            </div>
            <p className="text-ash leading-relaxed font-sans">
              {lang === 'ru'
                ? 'Любая аудиозапись (трек альбома или сингл), добавленная в архив и имеющая локальный MP3/WAV файл, автоматически становится частью испытания на слух. Ниже вы можете переключать участие отдельных треков в игровом пуле.'
                : 'Every album track or single with a valid local MP3/WAV audio file is eligible for audio snippet rounds. Toggle individual track participation below.'}
            </p>
          </div>

          {/* Tracks Table */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden font-mono text-xs shadow-xl">
            <div className="grid grid-cols-12 px-3.5 sm:px-5 py-3 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-ash/80 gap-2">
              <span className="col-span-5 sm:col-span-4">{lang === 'ru' ? 'Название трека' : 'Track Title'}</span>
              <span className="col-span-4 sm:col-span-3">{lang === 'ru' ? 'Релиз / Альбом' : 'Release / Album'}</span>
              <span className="hidden sm:block sm:col-span-2 text-center">{lang === 'ru' ? 'Длительность' : 'Duration'}</span>
              <span className="hidden sm:block sm:col-span-1 text-center">{lang === 'ru' ? 'Прослушать' : 'Preview'}</span>
              <span className="col-span-3 sm:col-span-2 text-right">{lang === 'ru' ? 'Статус' : 'Status'}</span>
            </div>

            {gameTracksList.length === 0 ? (
              <div className="py-12 text-center text-ash font-mono text-xs">
                {lang === 'ru' ? 'В архиве пока нет треков с локальными аудиофайлами.' : 'No tracks with local audio files yet.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {gameTracksList.map((trk) => {
                  const isEligible = trk.is_game_eligible !== 0;

                  return (
                    <div
                      key={trk.id}
                      className="grid grid-cols-12 items-center px-3.5 sm:px-5 py-3 text-xs transition-colors hover:bg-white/[0.02] gap-2"
                    >
                      <div className="col-span-5 sm:col-span-4 flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0 bg-[#821c2c]" />
                        <span className="text-white truncate font-medium">{trk.title}</span>
                      </div>

                      <div className="col-span-4 sm:col-span-3 text-ash truncate min-w-0">
                        {trk.release_title || (lang === 'ru' ? 'Сингл' : 'Single')}
                      </div>

                      <div className="hidden sm:block sm:col-span-2 text-center text-ash tabular-nums">
                        {formatDuration(trk.duration_seconds || 180)}
                      </div>

                      <div className="hidden sm:flex sm:col-span-1 justify-center">
                        <button
                          type="button"
                          onClick={() => playTrack(trk as any)}
                          className="p-1 rounded bg-white/[0.05] hover:bg-white/[0.12] text-white cursor-pointer"
                          title={t('playTrack')}
                        >
                          <Play className="w-3 h-3 fill-current ml-0.5" />
                        </button>
                      </div>

                      <div className="col-span-3 sm:col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleToggleGameTrack(trk.id, isEligible ? 1 : 0)}
                          className={`px-3 py-1 rounded text-[11px] uppercase tracking-wider transition-all cursor-pointer font-semibold ${
                            isEligible
                              ? 'bg-[#1a3820] border border-[#388548] text-[#6ee7b7] hover:bg-[#234b2b]'
                              : 'bg-white/[0.05] border border-white/10 text-ash hover:text-white'
                          }`}
                        >
                          {isEligible ? (lang === 'ru' ? 'В игре' : 'Active') : (lang === 'ru' ? 'Исключён' : 'Excluded')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB: DEDICATED QUIZ MANAGEMENT (ADMIN ONLY) */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'quiz' && (
        <AdminQuizTab
          lang={lang}
          quizQuestionsList={quizQuestionsList}
          quizPoolMeta={quizPoolMeta}
          onRefresh={fetchAdminData}
          onRequestDeleteQuiz={(q) => setDeleteModal({ type: 'quiz', id: q.id, name: q.question_ru })}
          onNotify={(msg) => setStatusMessage(msg)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {/* ==================================================================== */}
      {/* TAB: MODERATION (FORUM, CREATIONS & REPORTS) */}
      {/* ==================================================================== */}
      {activeTab === 'moderation' && (
        <motion.div
          key="moderation"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* Subtabs & Status Filter for Moderation */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-3 font-mono text-xs">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setModerationSection('posts')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all cursor-pointer uppercase shrink-0 ${
                  moderationSection === 'posts'
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'text-ash hover:text-white'
                }`}
              >
                <span>Темы форума</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/[0.08]">
                  {moderationStatusFilter === 'pending' ? pendingPosts.length : allPostsList.length}
                </span>
              </button>

              <button
                onClick={() => setModerationSection('creations')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all cursor-pointer uppercase shrink-0 ${
                  moderationSection === 'creations'
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'text-ash hover:text-white'
                }`}
              >
                <span>{lang === 'ru' ? 'Творчество и мемы' : 'Gallery & Memes'}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/[0.08]">
                  {moderationStatusFilter === 'pending' ? pendingCreations.length : allCreationsList.length}
                </span>
              </button>

              <button
                onClick={() => setModerationSection('comments')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all cursor-pointer uppercase shrink-0 ${
                  moderationSection === 'comments'
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'text-ash hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{lang === 'ru' ? 'Комментарии' : 'Comments'}</span>
              </button>

              <button
                onClick={() => setModerationSection('reports')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all cursor-pointer uppercase shrink-0 ${
                  moderationSection === 'reports'
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'text-ash hover:text-white'
                }`}
              >
                <span>{lang === 'ru' ? 'Жалобы' : 'Reports'}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#821c2c]/60 text-white">
                  {pendingReports.length}
                </span>
              </button>
            </div>

            {(moderationSection === 'posts' || moderationSection === 'creations') && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setModerationStatusFilter('pending')}
                  className={`px-3 py-1.5 rounded text-[11px] uppercase cursor-pointer ${
                    moderationStatusFilter === 'pending'
                      ? 'bg-[#821c2c]/40 text-white border border-[#821c2c]'
                      : 'text-ash hover:text-white border border-white/10'
                  }`}
                >
                  На проверке ({moderationSection === 'posts' ? pendingPosts.length : pendingCreations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setModerationStatusFilter('all')}
                  className={`px-3 py-1.5 rounded text-[11px] uppercase cursor-pointer ${
                    moderationStatusFilter === 'all'
                      ? 'bg-white/[0.1] text-white border border-white/20'
                      : 'text-ash hover:text-white border border-white/10'
                  }`}
                >
                  Все ({moderationSection === 'posts' ? allPostsList.length : allCreationsList.length})
                </button>
              </div>
            )}
          </div>

          {/* Posts Moderation & Management Section */}
          {moderationSection === 'posts' && (() => {
            const visiblePosts = moderationStatusFilter === 'pending' ? pendingPosts : allPostsList;
            return (
              <div className="space-y-4">
                {visiblePosts.length === 0 ? (
                  <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-12 text-center text-ash font-mono text-xs">
                    {moderationStatusFilter === 'pending'
                      ? 'Нет тем форума, ожидающих модерации. Все записи проверены!'
                      : 'Тем на форуме пока нет.'}
                  </div>
                ) : (
                  visiblePosts.map((post) => (
                    <div
                      key={post.id}
                      className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-4 shadow-xl"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ash">
                            <span className="uppercase">{post.category_name_ru || post.category_name_en}</span>
                            <span>·</span>
                            <span>Автор: <strong className="text-white">@{post.author_nickname}</strong></span>
                            <span>·</span>
                            <span>{formatAdminDate(post.created_at)}</span>
                            <span className={`px-1.5 py-0.2 rounded uppercase ${
                              post.status === 'approved'
                                ? 'bg-[#1a3820]/60 text-[#6ee7b7]'
                                : post.status === 'rejected'
                                ? 'bg-[#3d1820]/60 text-[#f87171]'
                                : 'bg-yellow-950/60 text-yellow-300'
                            }`}>
                              {post.status}
                            </span>
                          </div>
                          <h3 className="font-title text-xl text-white font-medium break-words">
                            {post.title}
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs shrink-0">
                          {post.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleModeratePost(post.id, 'approved')}
                              className="px-3 py-1.5 rounded-lg bg-[#1a3820] hover:bg-[#234b2b] border border-[#388548] text-[#6ee7b7] cursor-pointer font-semibold"
                            >
                              {t('approveAction')}
                            </button>
                          )}
                          {post.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => handleModeratePost(post.id, 'rejected')}
                              className="px-3 py-1.5 rounded-lg bg-[#3d1820] hover:bg-[#4d1f2a] border border-[#8a2a38] text-white cursor-pointer"
                            >
                              {t('rejectAction')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleTogglePinPost(post.id)}
                            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                              post.is_pinned
                                ? 'bg-white/[0.12] border-white/25 text-white'
                                : 'border-white/10 text-ash hover:text-white'
                            }`}
                            title={post.is_pinned ? t('unpinBtn') : t('pinBtn')}
                          >
                            <Pin className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleLockPost(post.id)}
                            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                              post.is_locked
                                ? 'bg-amber-950/40 border-amber-700/40 text-amber-300'
                                : 'border-white/10 text-ash hover:text-white'
                            }`}
                            title={post.is_locked ? t('unlockBtn') : t('lockBtn')}
                          >
                            {post.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteModal({
                                type: 'post',
                                id: post.id,
                                name: post.title,
                                subtext: lang === 'ru'
                                  ? `Тема автора @${post.author_nickname} и все комментарии в ней будут удалены.`
                                  : `Topic by @${post.author_nickname} and all comments will be removed.`,
                              })
                            }
                            className="p-2 rounded-lg hover:bg-red-950/60 text-ash hover:text-red-400 border border-white/10 hover:border-red-800 transition-colors cursor-pointer"
                            title={t('deleteBtn')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-bone leading-relaxed whitespace-pre-line font-sans bg-[#151419] p-4 rounded-lg border border-white/[0.04]">
                        {post.content}
                      </p>

                      {post.media_url && (
                        <div className="rounded-lg overflow-hidden max-h-60 border border-white/10 bg-black">
                          <img src={post.media_url} alt={post.title} loading="lazy" className="max-h-60 object-contain" />
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            );
          })()}

          {/* Creations Moderation & Management Section */}
          {moderationSection === 'creations' && (() => {
            const visibleCreations = moderationStatusFilter === 'pending' ? pendingCreations : allCreationsList;
            return (
              <div className="space-y-4">
                {visibleCreations.length === 0 ? (
                  <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-12 text-center text-ash font-mono text-xs">
                    {moderationStatusFilter === 'pending'
                      ? 'Нет творческих работ, ожидающих модерации. Все материалы рассмотрены!'
                      : 'Работ в галерее пока нет.'}
                  </div>
                ) : (
                  visibleCreations.map((creation) => (
                    <div
                      key={creation.id}
                      className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 sm:p-6 space-y-4 shadow-xl"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ash">
                            <span className="uppercase">{creation.category}</span>
                            <span>·</span>
                            <span>Автор: <strong className="text-white">@{creation.author_nickname}</strong></span>
                            <span>·</span>
                            <span>{formatAdminDate(creation.created_at)}</span>
                            <span className={`px-1.5 py-0.2 rounded uppercase ${
                              creation.status === 'approved'
                                ? 'bg-[#1a3820]/60 text-[#6ee7b7]'
                                : creation.status === 'rejected'
                                ? 'bg-[#3d1820]/60 text-[#f87171]'
                                : 'bg-yellow-950/60 text-yellow-300'
                            }`}>
                              {creation.status}
                            </span>
                          </div>
                          <h3 className="font-title text-xl text-white font-medium break-words">
                            {creation.title}
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 font-mono text-xs shrink-0">
                          <select
                            value={creationCategoryOverrides[creation.id] ?? (creation.category === 'meme' ? 'meme' : 'art')}
                            onChange={(e) =>
                              setCreationCategoryOverrides((prev) => ({
                                ...prev,
                                [creation.id]: e.target.value === 'meme' ? 'meme' : 'art',
                              }))
                            }
                            aria-label="Категория публикации"
                            className="px-2.5 py-1.5 rounded-lg bg-[#16151a] border border-white/[0.14] text-white text-[11px] focus:outline-none focus:border-white/30"
                          >
                            <option value="art">Творчество (15 XP)</option>
                            <option value="meme">Мемы (5 XP)</option>
                          </select>
                          {creation.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleModerateCreation(
                                  creation.id,
                                  'approved',
                                  creationCategoryOverrides[creation.id] ?? (creation.category === 'meme' ? 'meme' : 'art')
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-[#1a3820] hover:bg-[#234b2b] border border-[#388548] text-[#6ee7b7] cursor-pointer font-semibold"
                            >
                              Одобрить
                            </button>
                          )}
                          {creation.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleModerateCreation(
                                  creation.id,
                                  'rejected',
                                  creationCategoryOverrides[creation.id] ?? (creation.category === 'meme' ? 'meme' : 'art')
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-[#3d1820] hover:bg-[#4d1f2a] border border-[#8a2a38] text-white cursor-pointer"
                            >
                              Отклонить
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteModal({
                                type: 'creation',
                                id: creation.id,
                                name: creation.title,
                                subtext: `Работа автора @${creation.author_nickname} будет навсегда удалена из галереи.`,
                              })
                            }
                            className="p-2 rounded-lg hover:bg-red-950/60 text-ash hover:text-red-400 border border-white/10 hover:border-red-800 transition-colors cursor-pointer"
                            title="Удалить работу"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {creation.description && (
                        <p className="text-xs text-bone leading-relaxed font-sans">
                          {creation.description}
                        </p>
                      )}

                      {creation.media_url && (
                        <div className="rounded-lg overflow-hidden max-h-72 border border-white/10 bg-black flex items-center justify-center p-2">
                          {creation.media_type === 'image' ? (
                            <img src={creation.media_url} alt={creation.title} loading="lazy" className="max-h-72 object-contain" />
                          ) : creation.media_type === 'video' ? (
                            <video src={creation.media_url} controls className="max-h-72 w-full" />
                          ) : (
                            <audio src={creation.media_url} controls preload="none" className="w-full max-w-md my-4" />
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            );
          })()}

          {/* Reports Inbox Section */}
          {moderationSection === 'reports' && (
            <div className="space-y-4">
              {reportsList.length === 0 ? (
                <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-12 text-center text-ash font-mono text-xs">
                  Поступивших жалоб пока нет.
                </div>
              ) : (
                reportsList.map((rep) => (
                  <div key={rep.id} className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 space-y-3 shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 font-mono text-xs">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-ash">
                          <span className="uppercase px-1.5 py-0.5 rounded bg-white/[0.06] text-white">
                            {rep.target_type} · {rep.target_id}
                          </span>
                          <span>От: <strong className="text-white">@{rep.reporter_nickname}</strong></span>
                          <span>{formatAdminDate(rep.created_at)}</span>
                          <span className={`px-1.5 py-0.2 rounded uppercase ${
                            rep.status === 'pending' ? 'bg-yellow-950/60 text-yellow-300' : 'bg-white/[0.06] text-ash'
                          }`}>
                            {rep.status}
                          </span>
                        </div>
                        <p className="text-xs text-bone font-sans pt-1">{rep.reason}</p>
                      </div>

                      <div className="flex items-center gap-2 font-mono text-xs shrink-0">
                        {rep.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleResolveReport(rep.id, 'resolved')}
                              className="px-3 py-1.5 rounded-lg bg-[#1a3820] hover:bg-[#234b2b] border border-[#388548] text-[#6ee7b7] cursor-pointer"
                            >
                              Решено
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResolveReport(rep.id, 'dismissed')}
                              className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-ash hover:text-white cursor-pointer"
                            >
                              Отклонить
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Comments Moderation Subtab */}
          {moderationSection === 'comments' && (
            <AdminCommentsSubtab
              lang={lang}
              onNotify={(msg) => setStatusMessage(msg)}
              onError={(msg) => setErrorMessage(msg)}
            />
          )}
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* ADMIN-ONLY NEW TABS: USER RESET, NEWS, PROMOS, SHOP, + SHARED RULES  */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'user_reset' && (
        <AdminUserResetTab
          usersList={usersList}
          lang={lang}
          onResetComplete={async () => {
            await Promise.all([
              fetchAdminUsers(userSearch, userSort),
              fetchAdminLeaderboard(lbTimeframe, lbGameFilter, lbSearch),
              refresh(),
            ]);
          }}
          onNotify={(msg) => setStatusMessage(msg)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {isAdmin && activeTab === 'news' && (
        <AdminNewsTab
          lang={lang}
          onNotify={(msg) => setStatusMessage(msg)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {isAdmin && activeTab === 'promos' && (
        <AdminPromosTab
          lang={lang}
          onNotify={(msg) => setStatusMessage(msg)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {isAdmin && activeTab === 'shop' && (
        <AdminShopTab
          lang={lang}
          onNotify={(msg) => setStatusMessage(msg)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {activeTab === 'rules' && (
        <AdminRulesTab
          lang={lang}
          readOnly={!isAdmin}
          onNotify={(msg) => setStatusMessage(msg)}
          onError={(msg) => setErrorMessage(msg)}
        />
      )}

      {/* ==================================================================== */}
      {/* TAB: LEADERBOARD MANAGEMENT (SAFE GAME-ONLY RESETS) */}
      {/* ==================================================================== */}
      {isAdmin && activeTab === 'leaderboard' && (
        <motion.div
          key="leaderboard"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* Daily UTC Challenges Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-4 space-y-1">
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ash">
                <Clock className="w-3.5 h-3.5 text-[#821c2c]" />
                <span>{lang === 'ru' ? 'Дата UTC' : 'UTC Date'}</span>
              </div>
              <div className="font-mono text-lg text-ivory">
                {adminLeaderboardSummary?.today_utc || new Date().toISOString().slice(0, 10)}
              </div>
              <div className="font-mono text-[10px] text-ash/70">
                {lang === 'ru' ? 'Обновление ежедневно в 00:00 UTC' : 'Resets daily at 00:00 UTC'}
              </div>
            </div>

            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-4 space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ash">
                {lang === 'ru' ? 'Трек дня (5 сек)' : 'Daily Track (5s)'}
              </div>
              <div className="font-display text-lg text-ivory truncate">
                {adminLeaderboardSummary?.today_track_title || '—'}
              </div>
              <div className="font-mono text-[10px] text-ash/70">
                {adminLeaderboardSummary?.today_track_snippet_start !== null && adminLeaderboardSummary?.today_track_snippet_start !== undefined
                  ? `${formatDuration(adminLeaderboardSummary.today_track_snippet_start)} – ${formatDuration(
                      adminLeaderboardSummary.today_track_snippet_start + (adminLeaderboardSummary.today_track_snippet_duration || 5)
                    )} · ${adminLeaderboardSummary.today_track_attempts || 0} ${lang === 'ru' ? 'попыток' : 'plays'}`
                  : '—'}
              </div>
            </div>

            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-4 space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ash">
                {lang === 'ru' ? 'Викторина дня' : 'Daily Quiz'}
              </div>
              <div className="font-mono text-lg text-ivory">
                {adminLeaderboardSummary?.today_quiz_count ?? 0}{' '}
                <span className="text-xs text-ash">{lang === 'ru' ? 'вопросов' : 'questions'}</span>
              </div>
              <div className="font-mono text-[10px] text-ash/70">
                {adminLeaderboardSummary?.today_quiz_attempts || 0}{' '}
                {lang === 'ru' ? 'прохождений сегодня' : 'completions today'}
              </div>
            </div>

            <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-4 space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ash">
                {lang === 'ru' ? 'В таблице лидеров' : 'Ranked Members'}
              </div>
              <div className="font-mono text-lg text-ivory">
                {adminLeaderboard.length}{' '}
                <span className="text-xs text-ash">/ {adminLeaderboardSummary?.total_attempts ?? 0} {lang === 'ru' ? 'игр' : 'plays'}</span>
              </div>
              <div className="font-mono text-[10px] text-ash/70">
                {lang === 'ru' ? 'С учётом текущих фильтров' : 'Matching active filters'}
              </div>
            </div>
          </div>

          {/* Safe Bulk Clear Controls (Admin Only) */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="font-title text-xl text-ivory uppercase tracking-wide flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-[#c49298]" />
                  <span>{lang === 'ru' ? 'Управление таблицами лидеров' : 'Leaderboard Management'}</span>
                </h3>
                <p className="text-xs text-ash font-sans leading-relaxed">
                  {lang === 'ru'
                    ? 'Очистка удаляет только игровые результаты, попытки и рейтинг. Аккаунты пользователей, пароли, профили, аватары и покупки в магазине полностью сохраняются.'
                    : 'Clearing removes only game results, attempts, and rankings. User accounts, passwords, profiles, avatars, and shop items are strictly preserved.'}
                </p>
              </div>
            </div>

            {user.role_id === 'admin' ? (
              <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      type: 'leaderboard_clear',
                      id: 'all',
                      scope: 'all',
                      name: lang === 'ru' ? 'Вся таблица лидеров (за всё время)' : 'Entire All-Time Leaderboard',
                      subtext:
                        lang === 'ru'
                          ? 'Будут сброшены все игровые попытки, ежедневные прохождения и рейтинговый XP всех пользователей. Аккаунты, пароли и профили НЕ будут удалены.'
                          : 'All game attempts, daily completions, and ranking XP will be reset for all users. User accounts, passwords, and profiles will NOT be deleted.',
                    })
                  }
                  className="px-3.5 py-2 rounded-lg bg-red-950/70 hover:bg-red-900/80 border border-red-800/80 text-red-200 uppercase tracking-wider cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{lang === 'ru' ? 'Очистить всю таблицу' : 'Clear All-Time'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      type: 'leaderboard_clear',
                      id: 'weekly',
                      scope: 'weekly',
                      name: lang === 'ru' ? 'Таблица лидеров за 7 дней' : 'Weekly Leaderboard (7 days)',
                      subtext:
                        lang === 'ru'
                          ? 'Будут удалены игровые результаты и XP за последние 7 дней. Аккаунты и более старая история сохраняются.'
                          : 'Game results and XP from the last 7 days will be cleared. User accounts remain intact.',
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[#16151a] hover:bg-white/[0.08] border border-white/[0.1] text-bone uppercase tracking-wider cursor-pointer transition-colors"
                >
                  {lang === 'ru' ? 'Очистить 7 дней' : 'Clear 7 Days'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      type: 'leaderboard_clear',
                      id: 'monthly',
                      scope: 'monthly',
                      name: lang === 'ru' ? 'Таблица лидеров за 30 дней' : 'Monthly Leaderboard (30 days)',
                      subtext:
                        lang === 'ru'
                          ? 'Будут удалены игровые результаты и XP за последние 30 дней. Аккаунты пользователей не затрагиваются.'
                          : 'Game results and XP from the last 30 days will be cleared. User accounts remain intact.',
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[#16151a] hover:bg-white/[0.08] border border-white/[0.1] text-bone uppercase tracking-wider cursor-pointer transition-colors"
                >
                  {lang === 'ru' ? 'Очистить 30 дней' : 'Clear 30 Days'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      type: 'leaderboard_clear',
                      id: 'guess-track',
                      scope: 'guess-track',
                      name: lang === 'ru' ? 'Результаты «Угадай трек»' : 'Guess The Track Leaderboard',
                      subtext:
                        lang === 'ru'
                          ? 'Будут сброшены только результаты и попытки игры «Угадай трек». Аккаунты и результаты викторины сохраняются.'
                          : 'Only Guess The Track results and attempts will be cleared. Accounts and Quiz scores remain intact.',
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[#16151a] hover:bg-white/[0.08] border border-white/[0.1] text-bone uppercase tracking-wider cursor-pointer transition-colors"
                >
                  {lang === 'ru' ? 'Сбросить «Угадай трек»' : 'Clear Guess Track'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      type: 'leaderboard_clear',
                      id: 'daily-quiz',
                      scope: 'daily-quiz',
                      name: lang === 'ru' ? 'Результаты «Ежедневной викторины»' : 'Daily Quiz Leaderboard',
                      subtext:
                        lang === 'ru'
                          ? 'Будут сброшены только результаты и попытки викторины. Аккаунты и результаты «Угадай трек» сохраняются.'
                          : 'Only Daily Quiz results and attempts will be cleared. Accounts and Guess Track scores remain intact.',
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[#16151a] hover:bg-white/[0.08] border border-white/[0.1] text-bone uppercase tracking-wider cursor-pointer transition-colors"
                >
                  {lang === 'ru' ? 'Сбросить «Викторину»' : 'Clear Daily Quiz'}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setDeleteModal({
                      type: 'leaderboard_clear',
                      id: 'daily-attempts',
                      scope: 'daily-attempts',
                      name: lang === 'ru' ? 'Сегодняшние попытки (UTC)' : "Today's Daily Attempts (UTC)",
                      subtext:
                        lang === 'ru'
                          ? 'Сбросит только блокировку повторного прохождения за сегодня (UTC) — исторический XP и рейтинг сохранятся.'
                          : 'Resets only today’s UTC daily completion locks while preserving historical XP and rankings.',
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[#16151a] hover:bg-white/[0.08] border border-white/[0.1] text-ash hover:text-white uppercase tracking-wider cursor-pointer transition-colors"
                >
                  {lang === 'ru' ? 'Сбросить попытки сегодня' : "Reset Today's Locks"}
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] font-mono text-xs text-ash">
                {lang === 'ru'
                  ? 'Очистка и сброс таблицы лидеров доступны только администратору.'
                  : 'Clearing or resetting leaderboards requires Administrator privileges.'}
              </div>
            )}
          </div>

          {/* Filters & Search */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              {(['all', 'weekly', 'monthly'] as const).map((tf) => (
                <button
                  type="button"
                  key={tf}
                  onClick={() => setLbTimeframe(tf)}
                  className={`px-3 py-1.5 rounded-lg uppercase tracking-wider transition-colors cursor-pointer ${
                    lbTimeframe === tf
                      ? 'bg-white/[0.12] text-white border border-white/20'
                      : 'text-ash hover:text-white bg-white/[0.03] border border-white/[0.06]'
                  }`}
                >
                  {tf === 'all'
                    ? lang === 'ru' ? 'Всё время' : 'All-Time'
                    : tf === 'weekly'
                      ? lang === 'ru' ? '7 дней' : '7 Days'
                      : lang === 'ru' ? '30 дней' : '30 Days'}
                </button>
              ))}

              <span className="text-white/15 hidden sm:inline">|</span>

              {([
                { id: 'all', label: lang === 'ru' ? 'Все игры' : 'All Games' },
                { id: 'guess-track', label: lang === 'ru' ? 'Угадай трек' : 'Guess Track' },
                { id: 'daily-quiz', label: lang === 'ru' ? 'Викторина' : 'Daily Quiz' },
                { id: 'guess-lyrics', label: lang === 'ru' ? 'Строчка' : 'Lyrics' },
                { id: 'reverse-track', label: lang === 'ru' ? 'Реверс' : 'Reverse' },
                { id: 'speed-track', label: '0.5x / 2.5x' },
              ] as const).map((g) => (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => setLbGameFilter(g.id)}
                  className={`px-3 py-1.5 rounded-lg uppercase tracking-wider transition-colors cursor-pointer ${
                    lbGameFilter === g.id
                      ? 'bg-[#821c2c]/35 text-[#f5c6cb] border border-[#821c2c]/70'
                      : 'text-ash hover:text-white bg-white/[0.03] border border-white/[0.06]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="w-3.5 h-3.5 text-ash absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={lbSearch}
                onChange={(e) => setLbSearch(e.target.value)}
                placeholder={lang === 'ru' ? 'Поиск игрока по нику...' : 'Search member...'}
                className="w-full pl-9 pr-3 py-2 bg-[#16151a] border border-white/[0.1] rounded-lg text-xs text-white font-mono focus:outline-none focus:border-white/30"
              />
            </div>
          </div>

          {/* Ranked Players Table */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between font-mono text-xs">
              <span className="uppercase tracking-wider text-bone font-medium">
                {lang === 'ru' ? 'Записи таблицы лидеров' : 'Leaderboard Entries'} ({adminLeaderboard.length})
              </span>
              <button
                type="button"
                onClick={() => fetchAdminLeaderboard(lbTimeframe, lbGameFilter, lbSearch)}
                className="text-[11px] text-ash hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{lang === 'ru' ? 'Обновить' : 'Refresh'}</span>
              </button>
            </div>

            {lbLoading ? (
              <div className="p-10 text-center font-mono text-xs text-ash">
                {lang === 'ru' ? 'Загрузка таблицы лидеров...' : 'Loading leaderboard entries...'}
              </div>
            ) : adminLeaderboard.length === 0 ? (
              <div className="p-12 text-center font-mono text-xs text-ash">
                {lang === 'ru'
                  ? 'Записи не найдены — таблица лидеров пуста для выбранного фильтра.'
                  : 'No entries found — leaderboard is empty for the selected filter.'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {adminLeaderboard.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span className="font-mono text-xs font-bold text-ash w-7 shrink-0">
                        #{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                      </span>
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-black border border-white/10 shrink-0">
                        <img
                          src={entry.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                          alt={entry.nickname}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-white font-medium flex flex-wrap items-center gap-2">
                          <span className="truncate">{entry.display_name || entry.nickname}</span>
                          <span className="text-[10px] text-ash/70">@{entry.nickname}</span>
                          {entry.role_id !== 'user' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#821c2c]/40 text-[#f5c6cb] border border-[#821c2c] uppercase">
                              {entry.role_id}
                            </span>
                          )}
                          {entry.completed_today_track && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-green-950/60 text-green-300 border border-green-800/70">
                              {lang === 'ru' ? 'Трек ✓' : 'Track ✓'}
                            </span>
                          )}
                          {entry.completed_today_quiz && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-green-950/60 text-green-300 border border-green-800/70">
                              {lang === 'ru' ? 'Квиз ✓' : 'Quiz ✓'}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-ash/75 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span>
                            {lang === 'ru' ? 'Уровень' : 'Lvl'}: <strong className="text-white">L{entry.level}</strong>
                          </span>
                          <span>
                            Total XP: <strong className="text-ivory">{entry.total_xp ?? entry.rank_xp}</strong>
                          </span>
                          {lbTimeframe !== 'all' || lbGameFilter !== 'all' ? (
                            <span>
                              {lang === 'ru' ? 'В фильтре' : 'Scoped XP'}: <strong className="text-bone">{entry.rank_xp}</strong>
                            </span>
                          ) : null}
                          <span>
                            {lang === 'ru' ? 'Очки' : 'Score'}: <strong className="text-bone">{entry.game_score}</strong>
                          </span>
                          <span>
                            {lang === 'ru' ? 'Игр' : 'Plays'}: <strong className="text-bone">{entry.scoped_games_played}</strong>{' '}
                            <span className="text-ash/60">
                              ({entry.guess_track_played}/{entry.daily_quiz_played})
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {user.role_id === 'admin' && (
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] shrink-0">
                        {(entry.completed_today_track || entry.completed_today_quiz) && (
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteModal({
                                type: 'leaderboard_user_reset',
                                id: entry.id,
                                scope: 'daily-attempts',
                                name: entry.nickname,
                                subtext:
                                  lang === 'ru'
                                    ? `Сбросить только сегодняшние ежедневные попытки (UTC) для @${entry.nickname}. Аккаунт и накопленный XP сохраняются.`
                                    : `Reset only today’s UTC daily completion locks for @${entry.nickname}. Account and accumulated XP remain intact.`,
                              })
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/15 text-ash hover:text-white uppercase cursor-pointer transition-colors"
                          >
                            {lang === 'ru' ? 'Сбросить сегодня' : 'Reset Today'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteModal({
                              type: 'leaderboard_user_reset',
                              id: entry.id,
                              scope: lbGameFilter === 'all' ? 'all' : lbGameFilter,
                              name: entry.nickname,
                              subtext:
                                lbGameFilter === 'all'
                                  ? lang === 'ru'
                                    ? `Удалить все игровые результаты и сбросить рейтинговый XP пользователя @${entry.nickname}. Учётная запись, пароль и профиль НЕ будут удалены.`
                                    : `Remove all leaderboard results and reset ranking XP for @${entry.nickname}. Account, password, and profile will NOT be deleted.`
                                  : lang === 'ru'
                                    ? `Сбросить результаты выбранной игры (${lbGameFilter}) пользователя @${entry.nickname}. Аккаунт сохранится.`
                                    : `Reset ${lbGameFilter} scores for @${entry.nickname}. Account remains intact.`,
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 border border-red-800/80 text-red-200 uppercase cursor-pointer transition-colors flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>
                            {lbGameFilter === 'all'
                              ? lang === 'ru' ? 'Убрать из рейтинга' : 'Reset Score'
                              : lang === 'ru' ? 'Сбросить игру' : 'Reset Game'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* IN-UI CONFIRMATION MODAL FOR DELETIONS & LEADERBOARD RESETS */}
      {/* ==================================================================== */}
      <AnimatePresence>
        {deleteModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setDeleteModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[#141217] border border-red-900/60 rounded-xl p-5 sm:p-6 shadow-2xl space-y-5 z-10"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800 flex items-center justify-center text-red-400 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-title text-xl text-ivory uppercase tracking-wide">
                    {deleteModal.type === 'leaderboard_clear' || deleteModal.type === 'leaderboard_user_reset'
                      ? lang === 'ru' ? 'Подтверждение сброса' : 'Confirm Reset'
                      : lang === 'ru' ? 'Подтверждение удаления' : 'Confirm Deletion'}
                  </h3>
                  <div className="font-mono text-[11px] text-ash">
                    {deleteModal.type === 'track' && (lang === 'ru' ? 'Удаление трека' : 'Track Deletion')}
                    {deleteModal.type === 'album' && (lang === 'ru' ? 'Удаление релиза' : 'Release Deletion')}
                    {deleteModal.type === 'single' && (lang === 'ru' ? 'Удаление сингла' : 'Single Deletion')}
                    {deleteModal.type === 'file' && (lang === 'ru' ? 'Удаление файла' : 'File Deletion')}
                    {deleteModal.type === 'post' && (lang === 'ru' ? 'Удаление темы форума' : 'Post Deletion')}
                    {deleteModal.type === 'creation' && (lang === 'ru' ? 'Удаление работы галереи' : 'Creation Deletion')}
                    {deleteModal.type === 'quiz' && (lang === 'ru' ? 'Удаление вопроса викторины' : 'Quiz Question Deletion')}
                    {deleteModal.type === 'leaderboard_clear' && (lang === 'ru' ? 'Очистка таблицы лидеров' : 'Leaderboard Clear')}
                    {deleteModal.type === 'leaderboard_user_reset' && (lang === 'ru' ? 'Сброс результата игрока' : 'User Leaderboard Reset')}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#1a171f] rounded-lg border border-white/[0.06] space-y-1">
                <div className="text-white font-medium text-sm truncate font-sans">
                  «{deleteModal.name}»
                </div>
                {deleteModal.subtext && (
                  <p className="text-xs text-ash/80 leading-relaxed font-sans">{deleteModal.subtext}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteModal(null)}
                  className="px-4 py-2 font-mono text-xs uppercase tracking-wider text-ash hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
                >
                  {lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>

                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 font-mono text-xs uppercase tracking-wider bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-700 rounded-lg transition-all cursor-pointer font-semibold shadow-lg disabled:opacity-50 flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {isDeleting
                      ? lang === 'ru' ? 'Выполнение...' : 'Processing...'
                      : deleteModal.type === 'leaderboard_clear' || deleteModal.type === 'leaderboard_user_reset'
                        ? lang === 'ru' ? 'Подтвердить сброс' : 'Confirm Reset'
                        : lang === 'ru' ? 'Удалить' : 'Delete'}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================================================================== */}
      {/* SAFE ADMIN PASSWORD RESET MODAL (NEVER DISPLAYS OLD PASSWORD) */}
      {/* ==================================================================== */}
      <AnimatePresence>
        {resetPassModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !resettingPass && setResetPassModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[#141217] border border-amber-800/60 rounded-xl p-5 sm:p-6 shadow-2xl space-y-5 z-10"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-950/60 border border-amber-700/70 flex items-center justify-center text-amber-300 shrink-0">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-title text-xl text-ivory uppercase tracking-wide">
                      {lang === 'ru' ? 'Безопасный сброс пароля' : 'Safe Password Reset'}
                    </h3>
                    <div className="font-mono text-[11px] text-ash">
                      {resetPassModal.display_name || resetPassModal.nickname} ({formatHandle(resetPassModal.nickname)})
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !resettingPass && setResetPassModal(null)}
                  className="text-ash hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3 rounded-lg bg-[#1a171f] border border-white/[0.06] text-xs font-sans text-ash/90 leading-relaxed">
                {lang === 'ru'
                  ? 'Текущий пароль пользователя хранится в виде криптографического хеша и недоступен для просмотра. Установка нового пароля сразу завершит все активные сессии пользователя и снимет временную блокировку входа.'
                  : 'The existing password is stored as a one-way hash and cannot be viewed. Setting a new password immediately invalidates all active sessions and clears any login lockout.'}
              </div>

              <form onSubmit={handleResetUserPassword} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-bone">
                    {lang === 'ru' ? 'Новый временный пароль (мин. 8 символов)' : 'New Temporary Password (min. 8 chars)'}
                  </label>
                  <div className="relative">
                    <input
                      type={showResetPass ? 'text' : 'password'}
                      value={resetPassValue}
                      onChange={(e) => setResetPassValue(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 pr-10 bg-[#1a1820] border border-white/10 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-amber-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPass((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ash hover:text-white cursor-pointer"
                      aria-label={showResetPass ? 'Hide password' : 'Show password'}
                    >
                      {showResetPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block font-mono text-[10px] uppercase tracking-wider text-bone">
                    {lang === 'ru' ? 'Повторите новый пароль' : 'Confirm New Password'}
                  </label>
                  <input
                    type={showResetPass ? 'text' : 'password'}
                    value={resetPassConfirm}
                    onChange={(e) => setResetPassConfirm(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 bg-[#1a1820] border border-white/10 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-amber-600"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    disabled={resettingPass}
                    onClick={() => setResetPassModal(null)}
                    className="px-4 py-2 font-mono text-xs uppercase tracking-wider text-ash hover:text-white rounded-lg border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
                  >
                    {lang === 'ru' ? 'Отмена' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPass}
                    className="px-4 py-2 font-mono text-xs uppercase tracking-wider bg-amber-900/70 hover:bg-amber-800/80 text-amber-100 border border-amber-600/80 rounded-lg transition-all cursor-pointer font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>
                      {resettingPass
                        ? lang === 'ru' ? 'Обновление...' : 'Updating...'
                        : lang === 'ru' ? 'Установить пароль' : 'Set Password'}
                    </span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================================================================== */}
      {/* FULL USER PROFILE, PROGRESS, ACHIEVEMENTS & SHIELDS EDITOR MODAL     */}
      {/* ==================================================================== */}
      <AnimatePresence>
        {userDetailsModal && (
          <AdminUserEditorModal
            details={userDetailsModal}
            currentAdminId={user.id}
            lang={lang}
            onClose={() => setUserDetailsModal(null)}
            onReloadDetails={openUserDetails}
            onSaved={async (meta) => {
              if (meta?.token) {
                setStoredToken(meta.token);
              }
              if (meta?.userId === user.id) {
                await refresh();
              }
              await fetchAdminUsers(userSearch, userSort);
            }}
            onNotify={(msg) => setStatusMessage(msg)}
            onError={(msg) => setErrorMessage(msg)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
