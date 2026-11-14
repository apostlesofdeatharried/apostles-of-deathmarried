import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { useI18n } from '../context/I18nContext.js';
import { usePlayer } from '../context/PlayerContext.js';
import { CoverArt } from '../components/CoverArt.js';
import { formatDuration, safeJson } from '../utils/logic.js';
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
} from 'lucide-react';

interface DeleteModalState {
  type: 'track' | 'album' | 'single' | 'file' | 'post' | 'creation' | 'quiz';
  id: string;
  name: string;
  subtext?: string;
}

const formatAdminDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
};

export const AdminView: React.FC = () => {
  const { user, bindAdmin, openAuth } = useAuth();
  const { t, lang } = useI18n();
  const { playTrack } = usePlayer();

  const [activeTab, setActiveTab] = useState<'discography' | 'singles' | 'media' | 'gametracks' | 'moderation' | 'users' | 'stats'>('discography');
  const [stats, setStats] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [albumsList, setAlbumsList] = useState<any[]>([]);
  const [singlesList, setSinglesList] = useState<any[]>([]);
  const [mediaFilesList, setMediaFilesList] = useState<any[]>([]);
  const [gameTracksList, setGameTracksList] = useState<any[]>([]);
  const [quizQuestionsList, setQuizQuestionsList] = useState<any[]>([]);
  const [allPostsList, setAllPostsList] = useState<any[]>([]);
  const [allCreationsList, setAllCreationsList] = useState<any[]>([]);
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [moderationSection, setModerationSection] = useState<'posts' | 'creations' | 'reports'>('posts');
  const [moderationStatusFilter, setModerationStatusFilter] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);

  // Quiz Question Form State
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

  // Upload loading flags
  const [uploadingField, setUploadingField] = useState<string | null>(null);

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

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [resStats, resUsers, resAlb, resSng, resAud, resGame, resQuiz, resPosts, resCreations, resReports] = await Promise.all([
        authFetch('/api/admin/stats'),
        authFetch('/api/admin/users'),
        authFetch('/api/archive/albums'),
        authFetch('/api/archive/singles'),
        authFetch('/api/admin/audio-files'),
        authFetch('/api/admin/game-tracks'),
        authFetch('/api/admin/quiz-questions'),
        authFetch('/api/community/posts?status=all'),
        authFetch('/api/creations?status=all'),
        authFetch('/api/admin/reports'),
      ]);

      if (resStats.ok) setStats((await safeJson<any>(resStats, {})).stats);
      if (resUsers.ok) setUsersList((await safeJson<any>(resUsers, {})).users || []);
      if (resAlb.ok) {
        const albs = (await safeJson<any>(resAlb, {})).albums || [];
        setAlbumsList(albs);
        if (albs.length > 0 && !trackAlbumId) {
          setTrackAlbumId(albs[0].id);
        }
      }
      if (resSng.ok) setSinglesList((await safeJson<any>(resSng, {})).singles || []);
      if (resAud.ok) setMediaFilesList((await safeJson<any>(resAud, {})).files || []);
      if (resGame.ok) setGameTracksList((await safeJson<any>(resGame, {})).tracks || []);
      if (resQuiz.ok) setQuizQuestionsList((await safeJson<any>(resQuiz, {})).questions || []);
      if (resPosts.ok) setAllPostsList((await safeJson<any>(resPosts, {})).posts || []);
      if (resCreations.ok) setAllCreationsList((await safeJson<any>(resCreations, {})).creations || []);
      if (resReports.ok) setReportsList((await safeJson<any>(resReports, {})).reports || []);
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
    const opts = [quizOpt0.trim(), quizOpt1.trim(), quizOpt2.trim(), quizOpt3.trim()].filter(Boolean);
    if (!quizQuestionRu.trim() || opts.length < 2) {
      setErrorMessage(lang === 'ru' ? 'Введите вопрос и минимум 2 варианта ответа' : 'Provide question and at least 2 options');
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
        setStatusMessage(
          editingQuizId
            ? (lang === 'ru' ? 'Вопрос викторины обновлён' : 'Quiz question updated')
            : (lang === 'ru' ? 'Вопрос викторины добавлен' : 'Quiz question added')
        );
        resetQuizForm();
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || (lang === 'ru' ? 'Не удалось сохранить вопрос' : 'Failed to save question'));
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Network error');
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

  const handleModerateCreation = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const res = await authFetch(`/api/admin/creations/${id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
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

  // General Upload Handler
  const handleUploadFile = async (
    file: File,
    targetField: 'albumCover' | 'singleCover' | 'trackAudio' | 'singleAudio' | 'mediaStorage'
  ) => {
    setUploadingField(targetField);
    setStatusMessage(lang === 'ru' ? 'Загрузка файла на сервер...' : 'Uploading file to server...');
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await authFetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await safeJson<{ url?: string; error?: string; filename?: string }>(res, {});

      if (!res.ok) {
        setErrorMessage(data.error || 'Upload error');
        setStatusMessage(null);
        return;
      }

      setStatusMessage(lang === 'ru' ? `Файл успешно загружен: ${data.filename || ''}` : `Uploaded: ${data.filename || ''}`);

      if (targetField === 'albumCover') {
        setAlbumCoverUrl(data.url || '');
      } else if (targetField === 'singleCover') {
        setSingleCoverUrl(data.url || '');
      } else if (targetField === 'trackAudio') {
        setTrackAudioUrl(data.url || '');
        if (data.url) autoDetectDuration(data.url, (sec) => setTrackDuration(String(sec)));
      } else if (targetField === 'singleAudio') {
        setSingleAudioUrl(data.url || '');
        if (data.url) autoDetectDuration(data.url, (sec) => setSingleDuration(String(sec)));
      }

      fetchAdminData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Upload failed due to network error');
      setStatusMessage(null);
    } finally {
      setUploadingField(null);
    }
  };

  // Album Save / Update
  const handleSaveAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!albumTitle.trim()) return;

    const streaming_links = {
      spotify: albumSpotify.trim() || undefined,
      apple_music: albumApple.trim() || undefined,
      yandex_music: albumYandex.trim() || undefined,
      vk_music: albumVk.trim() || undefined,
      soundcloud: albumSoundcloud.trim() || undefined,
      youtube_music: albumYoutube.trim() || undefined,
    };

    const payload = {
      title: albumTitle.trim(),
      format_type: albumFormat,
      release_year: parseInt(albumYear, 10) || 2025,
      release_date: albumDate.trim() || `${albumYear}-01-01`,
      cover_url: albumCoverUrl.trim() || null,
      description: albumDesc.trim(),
      streaming_links,
    };

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

      if (!res.ok) {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Failed to save album');
        return;
      }

      setStatusMessage(
        editingAlbumId
          ? lang === 'ru' ? 'Релиз успешно обновлен' : 'Album updated successfully'
          : lang === 'ru' ? 'Новый релиз добавлен в архив' : 'New album created'
      );
      resetAlbumForm();
      fetchAdminData();
    } catch (e: any) {
      setErrorMessage(e.message || 'Server connection error');
    }
  };

  const handleEditAlbum = (alb: any) => {
    setEditingAlbumId(alb.id);
    setAlbumTitle(alb.title || '');
    setAlbumFormat(alb.format_type || 'album');
    setAlbumYear(String(alb.release_year || '2025'));
    setAlbumDate(alb.release_date || `${alb.release_year}-01-01`);
    setAlbumCoverUrl(alb.cover_url || '');
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
    setAlbumCoverUrl('');
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
    if (!singleTitle.trim()) return;

    const streaming_links = {
      spotify: singleSpotify.trim() || undefined,
      apple_music: singleApple.trim() || undefined,
      yandex_music: singleYandex.trim() || undefined,
      vk_music: singleVk.trim() || undefined,
      soundcloud: singleSoundcloud.trim() || undefined,
      youtube_music: singleYoutube.trim() || undefined,
    };

    const payload = {
      title: singleTitle.trim(),
      release_year: parseInt(singleYear, 10) || 2025,
      release_date: singleDate.trim() || `${singleYear}-01-01`,
      cover_url: singleCoverUrl.trim() || null,
      audio_url: singleAudioUrl.trim() || null,
      duration_seconds: parseInt(singleDuration, 10) || 180,
      description: singleDesc.trim(),
      lyrics: singleLyrics.trim(),
      streaming_links,
    };

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

      if (!res.ok) {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Failed to save single');
        return;
      }

      setStatusMessage(
        editingSingleId
          ? lang === 'ru' ? 'Сингл успешно обновлен' : 'Single updated'
          : lang === 'ru' ? 'Сингл добавлен в архив' : 'Single inscribed'
      );
      resetSingleForm();
      fetchAdminData();
    } catch (e: any) {
      setErrorMessage(e.message || 'Server connection error');
    }
  };

  const handleEditSingle = (sng: any) => {
    setEditingSingleId(sng.id);
    setSingleTitle(sng.title || '');
    setSingleYear(String(sng.release_year || '2025'));
    setSingleDate(sng.release_date || `${sng.release_year}-01-01`);
    setSingleCoverUrl(sng.cover_url || '');
    setSingleAudioUrl(sng.audio_url || '');
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
    setSingleCoverUrl('');
    setSingleAudioUrl('');
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
    if (!trackTitle.trim() || !trackAlbumId) {
      setErrorMessage(lang === 'ru' ? 'Укажите название трека и выберите альбом' : 'Provide track title and album');
      return;
    }

    const payload = {
      album_id: trackAlbumId,
      title: trackTitle.trim(),
      track_number: parseInt(trackNumber, 10) || 1,
      audio_url: trackAudioUrl.trim(),
      duration_seconds: parseInt(trackDuration, 10) || 180,
      lyrics: trackLyrics.trim(),
    };

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

      if (!res.ok) {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Failed to save track');
        return;
      }

      setStatusMessage(
        editingTrackId
          ? lang === 'ru' ? 'Трек успешно обновлен' : 'Track updated'
          : lang === 'ru' ? 'Трек добавлен в альбом' : 'Track added to album'
      );
      resetTrackForm();
      fetchAdminData();
    } catch (e: any) {
      setErrorMessage(e.message || 'Server connection error');
    }
  };

  const handleEditTrack = (trk: any) => {
    setEditingTrackId(trk.id);
    setTrackAlbumId(trk.album_id);
    setTrackTitle(trk.title || '');
    setTrackNumber(String(trk.track_number || 1));
    setTrackAudioUrl(trk.audio_url || '');
    setTrackDuration(String(trk.duration_seconds || 180));
    setTrackLyrics(trk.lyrics || '');
  };

  const resetTrackForm = () => {
    setEditingTrackId(null);
    setTrackTitle('');
    setTrackNumber('1');
    setTrackAudioUrl('');
    setTrackDuration('180');
    setTrackLyrics('');
  };

  // Delete Action Executor (Invoked from In-UI Confirmation Modal)
  const handleConfirmDelete = async () => {
    if (!deleteModal) return;
    setIsDeleting(true);

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
      } else {
        return;
      }

      if (res.ok) {
        setStatusMessage(
          lang === 'ru'
            ? `«${deleteModal.name}» успешно удален(о)`
            : `«${deleteModal.name}» deleted successfully`
        );
        setDeleteModal(null);
        fetchAdminData();
      } else {
        const data = await safeJson<{ error?: string }>(res, {});
        setErrorMessage(data.error || 'Failed to delete');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error during deletion');
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2500);
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
            className="fixed top-20 right-6 z-50 bg-[#162218] border border-green-600/60 text-green-200 px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 font-sans text-xs"
          >
            <Check className="w-4 h-4 text-green-400 shrink-0" />
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage(null)} className="text-green-400 hover:text-white ml-2">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-6 z-50 bg-[#280f14] border border-red-700 text-red-200 px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 font-sans text-xs"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white ml-2">
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

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-2 overflow-x-auto no-scrollbar w-full max-w-full">
        {[
          { id: 'discography', label: lang === 'ru' ? 'Альбомы & EP' : 'Albums & EPs', icon: Disc, count: albumsList.length },
          { id: 'singles', label: lang === 'ru' ? 'Синглы' : 'Singles', icon: Music, count: singlesList.length },
          { id: 'media', label: lang === 'ru' ? 'Медиатека (MP3 / WAV)' : 'Media Storage', icon: Library, count: mediaFilesList.length },
          { id: 'gametracks', label: lang === 'ru' ? 'Игры & Викторина' : 'Games & Quiz', icon: Volume2, count: gameTracksList.length },
          { id: 'moderation', label: lang === 'ru' ? 'Модерация & Посты' : 'Moderation', icon: ShieldAlert, count: pendingPosts.length + pendingCreations.length + pendingReports.length },
          { id: 'users', label: lang === 'ru' ? 'Аккаунты & Доступ' : 'Accounts & RBAC', icon: Users, count: usersList.length },
          { id: 'stats', label: lang === 'ru' ? 'Статистика' : 'Statistics', icon: Activity },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-all shrink-0 rounded-lg cursor-pointer ${
                isActive
                  ? 'bg-white/[0.12] text-white font-medium border border-white/20 shadow-md'
                  : 'text-ash hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.08] text-ash">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: ALBUMS & EPS (DISCOGRAPHY) */}
      {/* ==================================================================== */}
      {activeTab === 'discography' && (
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
                  onChange={(e) => setAlbumCoverUrl(e.target.value)}
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
                        className="w-12 h-12 object-cover rounded shadow shrink-0"
                        onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                      />
                      <div className="text-[11px] text-ash truncate">
                        {lang === 'ru' ? 'Предпросмотр обложки' : 'Cover Preview'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAlbumCoverUrl('')}
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
                className="w-full py-3 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.18] text-white border border-white/20 rounded-lg transition-all cursor-pointer font-semibold shadow-md"
              >
                {editingAlbumId
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
                      setTrackAudioUrl(e.target.value);
                      autoDetectDuration(e.target.value, (sec) => setTrackDuration(String(sec)));
                    }}
                    placeholder="/uploads/... or /audio/... or https://..."
                    className="w-full px-3 py-2 bg-[#100f13] border border-white/[0.1] rounded text-white focus:outline-none font-mono text-xs"
                  />
                  <input
                    type="file"
                    ref={trackAudioInputRef}
                    accept="audio/*,.mp3,.wav,.wave,.flac,.ogg,.m4a"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleUploadFile(f, 'trackAudio');
                    }}
                    className="hidden"
                  />

                  {/* Quick Select from Preserved Media Storage */}
                  {mediaFilesList.length > 0 && (
                    <div className="flex items-center gap-2 pt-1 text-[11px]">
                      <span className="text-ash/70 font-mono text-[10px]">
                        {lang === 'ru' ? 'Или выбрать из медиатеки:' : 'Or pick from storage:'}
                      </span>
                      <select
                        value={mediaFilesList.some((m) => m.storage_path === trackAudioUrl) ? trackAudioUrl : ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            setTrackAudioUrl(e.target.value);
                            autoDetectDuration(e.target.value, (sec) => setTrackDuration(String(sec)));
                          }
                        }}
                        className="bg-[#100f13] border border-white/10 rounded px-2 py-1 text-bone text-xs font-mono max-w-xs truncate"
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
                    <div className="pt-2">
                      <div className="font-mono text-[10px] text-ash/80 mb-1 flex items-center gap-1.5">
                        <Volume2 className="w-3 h-3 text-green-400" />
                        <span>{lang === 'ru' ? 'Предпрослушивание трека:' : 'Audio Preview:'}</span>
                      </div>
                      <audio controls src={trackAudioUrl} className="w-full h-8 rounded" />
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
                  className="py-2.5 px-6 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.2] text-white border border-white/20 rounded-lg transition-colors cursor-pointer font-semibold"
                >
                  {editingTrackId
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
      {activeTab === 'singles' && (
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
                  onChange={(e) => setSingleCoverUrl(e.target.value)}
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
                        className="w-12 h-12 object-cover rounded shadow shrink-0"
                        onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                      />
                      <div className="text-[11px] text-ash truncate">
                        {lang === 'ru' ? 'Предпросмотр обложки' : 'Cover Preview'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSingleCoverUrl('')}
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
                    setSingleAudioUrl(e.target.value);
                    autoDetectDuration(e.target.value, (sec) => setSingleDuration(String(sec)));
                  }}
                  placeholder="/uploads/... or /audio/..."
                  className="w-full px-3 py-2 bg-[#100f13] border border-white/[0.1] rounded text-white focus:outline-none font-mono text-xs"
                />
                <input
                  type="file"
                  ref={singleAudioInputRef}
                  accept="audio/*,.mp3,.wav,.wave,.flac,.ogg,.m4a"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleUploadFile(f, 'singleAudio');
                  }}
                  className="hidden"
                />

                {mediaFilesList.length > 0 && (
                  <div className="flex items-center gap-2 pt-1 text-[11px]">
                    <span className="text-ash/70 font-mono text-[10px]">
                      {lang === 'ru' ? 'Или выбрать из медиатеки:' : 'Or pick from storage:'}
                    </span>
                    <select
                      value={mediaFilesList.some((m) => m.storage_path === singleAudioUrl) ? singleAudioUrl : ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          setSingleAudioUrl(e.target.value);
                          autoDetectDuration(e.target.value, (sec) => setSingleDuration(String(sec)));
                        }
                      }}
                      className="bg-[#100f13] border border-white/10 rounded px-2 py-1 text-bone text-xs font-mono max-w-xs truncate"
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
                  <div className="pt-2">
                    <div className="font-mono text-[10px] text-ash/80 mb-1 flex items-center gap-1.5">
                      <Volume2 className="w-3 h-3 text-green-400" />
                      <span>{lang === 'ru' ? 'Предпрослушивание сингла:' : 'Audio Preview:'}</span>
                    </div>
                    <audio controls src={singleAudioUrl} className="w-full h-8 rounded" />
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
                className="w-full py-3 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.2] text-white border border-white/20 rounded-lg transition-all cursor-pointer font-semibold shadow-md"
              >
                {editingSingleId
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
      {activeTab === 'media' && (
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
                  <span>{lang === 'ru' ? 'Хранилище медиафайлов (MP3, WAV, Обложки)' : 'Media Storage Repository'}</span>
                </h3>
                <p className="font-sans text-xs text-ash mt-1 max-w-xl">
                  {lang === 'ru'
                    ? 'Загружайте любые треки в форматах MP3, WAV, OGG, FLAC (до 100 МБ) или изображения обложек. После загрузки вы можете скопировать ссылку в один клик или вставить файл в треклист.'
                    : 'Upload any audio tracks in MP3, WAV, OGG, FLAC formats (up to 100 MB) or cover artwork. Copy direct paths with 1-click or assign to tracks.'}
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
                  accept="audio/*,image/*,.mp3,.wav,.wave,.flac,.ogg,.m4a,.jpg,.jpeg,.png,.webp"
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
      {activeTab === 'users' && (
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

          {/* Registered Users List */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-bone font-medium">
                {lang === 'ru' ? 'Зарегистрированные пользователи' : 'Archive Registered Members'} ({usersList.length})
              </span>
            </div>

            <div className="divide-y divide-white/[0.04]">
              {usersList.map((u) => {
                const isCurrentUser = u.id === user.id;
                const isMasterAdmin = u.nickname === 'sushkanov097' || u.email === 'sushkanov097@gmail.com';

                return (
                  <div key={u.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-full bg-[#1c1a24] border border-white/10 flex items-center justify-center font-title text-base text-ivory uppercase">
                        {u.nickname?.[0] || 'A'}
                      </div>
                      <div>
                        <div className="font-mono text-xs text-white font-medium flex items-center gap-2">
                          <span>{u.nickname}</span>
                          {isCurrentUser && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-bone">
                              {lang === 'ru' ? 'Вы' : 'You'}
                            </span>
                          )}
                          {isMasterAdmin && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#821c2c]/40 text-[#f5c6cb] border border-[#821c2c]">
                              Master
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-ash/60 mt-0.5">
                          {u.email || '—'} · Level {u.level || 1} ({u.xp || 0} XP) · {formatAdminDate(u.registered_at)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
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
      {activeTab === 'stats' && (
        <motion.div
          key="stats"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
        >
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
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* TAB: GAME AUDIO POOL (AUTOMATIC LINKING) */}
      {/* ==================================================================== */}
      {activeTab === 'gametracks' && (
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
                  ? 'Автоматический пул треков для испытания «Угадай трек»'
                  : 'Automatic Track Pool for «Guess The Track»'}
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
            <div className="grid grid-cols-12 px-5 py-3 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-ash/80">
              <span className="col-span-5 sm:col-span-4">{lang === 'ru' ? 'Название трека' : 'Track Title'}</span>
              <span className="col-span-4 sm:col-span-3">{lang === 'ru' ? 'Релиз / Альбом' : 'Release / Album'}</span>
              <span className="col-span-2 text-center">{lang === 'ru' ? 'Длительность' : 'Duration'}</span>
              <span className="col-span-1 hidden sm:block text-center">{lang === 'ru' ? 'Прослушать' : 'Preview'}</span>
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
                      className="grid grid-cols-12 items-center px-5 py-3 text-xs transition-colors hover:bg-white/[0.02]"
                    >
                      <div className="col-span-5 sm:col-span-4 flex items-center gap-2 truncate">
                        <span className="w-2 h-2 rounded-full shrink-0 bg-[#821c2c]" />
                        <span className="text-white truncate font-medium">{trk.title}</span>
                      </div>

                      <div className="col-span-4 sm:col-span-3 text-ash truncate">
                        {trk.release_title || (lang === 'ru' ? 'Сингл' : 'Single')}
                      </div>

                      <div className="col-span-2 text-center text-ash">
                        {formatDuration(trk.duration_seconds || 180)}
                      </div>

                      <div className="col-span-1 hidden sm:flex justify-center">
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

          {/* Daily Quiz Questions Manager */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            <div className="lg:col-span-5 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <h3 className="font-title text-xl text-ivory font-light uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#c49298]" />
                  <span>
                    {editingQuizId
                      ? (lang === 'ru' ? 'Редактировать вопрос' : 'Edit Quiz Question')
                      : (lang === 'ru' ? 'Добавить вопрос викторины' : 'Add Quiz Question')}
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
                <button type="submit" className="w-full py-2.5 font-mono text-xs uppercase tracking-widest bg-white/[0.1] hover:bg-white/[0.2] text-white border border-white/20 rounded-lg cursor-pointer">
                  {editingQuizId
                    ? t('saveBtn')
                    : (lang === 'ru' ? 'Добавить вопрос' : 'Add Question')}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 bg-[#100f13] border border-white/[0.08] rounded-xl p-6 space-y-4">
              <h3 className="font-title text-xl text-ivory font-light uppercase tracking-wider">
                {lang === 'ru' ? 'Банк вопросов викторины' : 'Quiz Question Bank'} ({quizQuestionsList.length})
              </h3>
              <div className="divide-y divide-white/[0.05] max-h-[420px] overflow-y-auto pr-1">
                {quizQuestionsList.map((q) => (
                  <div key={q.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="text-xs text-white font-sans">{lang === 'ru' ? q.question_ru : q.question_en}</div>
                      <div className="font-mono text-[10px] text-ash/70">
                        {t('level')}: {q.difficulty || 1} · {formatAdminDate(q.created_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEditQuizQuestion(q)}
                        className="p-1.5 rounded hover:bg-white/[0.08] text-ash hover:text-white transition-colors cursor-pointer"
                        title={t('editBtn')}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteModal({ type: 'quiz', id: q.id, name: q.question_ru })}
                        className="p-1.5 rounded hover:bg-red-950/60 text-ash hover:text-red-400 transition-colors cursor-pointer"
                        title={t('deleteBtn')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
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
                <span>Работы галереи</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/[0.08]">
                  {moderationStatusFilter === 'pending' ? pendingCreations.length : allCreationsList.length}
                </span>
              </button>

              <button
                onClick={() => setModerationSection('reports')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all cursor-pointer uppercase shrink-0 ${
                  moderationSection === 'reports'
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'text-ash hover:text-white'
                }`}
              >
                <span>Жалобы</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#821c2c]/60 text-white">
                  {pendingReports.length}
                </span>
              </button>
            </div>

            {moderationSection !== 'reports' && (
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
                          <img src={post.media_url} alt={post.title} className="max-h-60 object-contain" />
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

                        <div className="flex items-center gap-2 font-mono text-xs shrink-0">
                          {creation.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleModerateCreation(creation.id, 'approved')}
                              className="px-3 py-1.5 rounded-lg bg-[#1a3820] hover:bg-[#234b2b] border border-[#388548] text-[#6ee7b7] cursor-pointer font-semibold"
                            >
                              Одобрить
                            </button>
                          )}
                          {creation.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => handleModerateCreation(creation.id, 'rejected')}
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
                            <img src={creation.media_url} alt={creation.title} className="max-h-72 object-contain" />
                          ) : creation.media_type === 'video' ? (
                            <video src={creation.media_url} controls className="max-h-72 w-full" />
                          ) : (
                            <audio src={creation.media_url} controls className="w-full max-w-md my-4" />
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
        </motion.div>
      )}

      {/* ==================================================================== */}
      {/* IN-UI CONFIRMATION MODAL FOR DELETIONS (REPLACES WINDOW.CONFIRM) */}
      {/* ==================================================================== */}
      <AnimatePresence>
        {deleteModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
              className="relative w-full max-w-md bg-[#141217] border border-red-900/60 rounded-xl p-6 shadow-2xl space-y-5 z-10"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800 flex items-center justify-center text-red-400 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-title text-xl text-ivory uppercase tracking-wide">
                    {lang === 'ru' ? 'Подтверждение удаления' : 'Confirm Deletion'}
                  </h3>
                  <div className="font-mono text-[11px] text-ash">
                    {deleteModal.type === 'track' && (lang === 'ru' ? 'Удаление трека' : 'Track Deletion')}
                    {deleteModal.type === 'album' && (lang === 'ru' ? 'Удаление релиза' : 'Release Deletion')}
                    {deleteModal.type === 'single' && (lang === 'ru' ? 'Удаление сингла' : 'Single Deletion')}
                    {deleteModal.type === 'file' && (lang === 'ru' ? 'Удаление файла' : 'File Deletion')}
                    {deleteModal.type === 'post' && (lang === 'ru' ? 'Удаление темы форума' : 'Post Deletion')}
                    {deleteModal.type === 'creation' && (lang === 'ru' ? 'Удаление работы галереи' : 'Creation Deletion')}
                    {deleteModal.type === 'quiz' && (lang === 'ru' ? 'Удаление вопроса викторины' : 'Quiz Question Deletion')}
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
                      ? lang === 'ru' ? 'Удаление...' : 'Deleting...'
                      : lang === 'ru' ? 'Удалить' : 'Delete'}
                  </span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
