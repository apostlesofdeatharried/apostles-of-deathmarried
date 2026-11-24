import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { Creation } from '../types/index.js';
import { safeJson } from '../utils/logic.js';
import { prepareAndUploadMedia, AUDIO_ACCEPT_ATTR } from '../utils/mediaCompression.js';
import { formatHandle } from '../utils/cosmetics.js';
import { RulesModal, hasAcceptedRules } from '../components/RulesModal.js';
import { dispatchAchievementUnlocked } from '../components/AchievementToast.js';
import {
  Sparkles,
  Search,
  Plus,
  Play,
  Pause,
  Music,
  Video,
  FileText,
  X,
  Upload,
  Trash2,
  Brush,
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  CheckCircle2,
  Edit2,
  Bookmark,
  CornerDownRight,
  Reply,
  Smile,
  UserCheck,
  UserPlus,
} from 'lucide-react';

export const CreationsView: React.FC = () => {
  const { t, lang } = useI18n();
  const { user, openAuth, refresh } = useAuth();

  const [creations, setCreations] = useState<Creation[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Selected creation modal state
  const [activeCreation, setActiveCreation] = useState<Creation | null>(null);
  const [creationComments, setCreationComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [userReaction, setUserReaction] = useState<'rose' | 'skull' | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);

  // Publish modal state
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<Creation['category'] | ''>('');
  const [newDesc, setNewDesc] = useState('');
  const [newMediaUrl, setNewMediaUrl] = useState('');
  const [newMediaType, setNewMediaType] = useState<'image' | 'audio' | 'video'>('image');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<Creation['category']>('art');
  const [editDesc, setEditDesc] = useState('');
  const [editMediaUrl, setEditMediaUrl] = useState('');
  const [editMediaType, setEditMediaType] = useState<'image' | 'audio' | 'video'>('image');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Moderation & follow state
  const [moderateCategory, setModerateCategory] = useState<'art' | 'meme'>('art');
  const [followBusy, setFollowBusy] = useState(false);

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'creation' | 'comment'; id: string; label: string } | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [rulesModalMode, setRulesModalMode] = useState<'accept' | 'view' | null>(null);
  const pendingRulesActionRef = useRef<(() => void) | null>(null);

  const isStaff = Boolean(user && (user.role_id === 'admin' || user.role_id === 'moderator'));

  const requireRulesThen = (action: () => void) => {
    if (!user) {
      openAuth('login');
      return;
    }
    if (!hasAcceptedRules(user)) {
      pendingRulesActionRef.current = action;
      setRulesModalMode('accept');
      return;
    }
    action();
  };

  const goToProfile = (nickname?: string) => {
    if (!nickname) return;
    window.dispatchEvent(new CustomEvent('navigate-profile', { detail: nickname }));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget && !deletingTarget) setDeleteTarget(null);
      else if (editModalOpen) setEditModalOpen(false);
      else if (publishModalOpen) setPublishModalOpen(false);
      else if (activeCreation) setActiveCreation(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteTarget, deletingTarget, editModalOpen, publishModalOpen, activeCreation]);

  const formatCreationDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
  };

  const fetchCreations = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (search.trim()) params.set('search', search.trim());

      const res = await authFetch(`/api/creations?${params.toString()}`);
      const data = await safeJson<{ creations?: Creation[] }>(res, { creations: [] });
      setCreations(data.creations || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCreations();
  }, [selectedCategory, search, user?.id]);

  const openCreationById = async (creationId: string, initialCreation?: Creation) => {
    if (initialCreation) {
      setActiveCreation(initialCreation);
      setUserReaction(initialCreation.user_reaction ?? null);
      setModerateCategory(initialCreation.category === 'meme' ? 'meme' : 'art');
    }
    setReplyToCommentId(null);
    try {
      const res = await authFetch(`/api/creations/${creationId}`);
      const data = await safeJson<{
        creation?: Creation;
        comments?: any[];
        userReaction?: 'rose' | 'skull' | null;
        favorited?: boolean;
        error?: string;
      }>(res, {});
      if (res.ok) {
        if (data.creation) {
          setActiveCreation(data.creation);
          setModerateCategory(data.creation.category === 'meme' ? 'meme' : 'art');
        }
        setCreationComments(data.comments || []);
        setUserReaction(data.userReaction ?? data.creation?.user_reaction ?? null);
        setIsFavorited(Boolean(data.favorited));
      } else {
        setToastMessage(data.error || (lang === 'ru' ? 'Не удалось загрузить работу' : 'Failed to load creation'));
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openCreationDetail = async (creation: Creation) => {
    await openCreationById(creation.id, creation);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialId = params.get('creation');
    if (initialId) {
      openCreationById(initialId);
    }
    const handleOpenCreationEvent = (e: CustomEvent<string>) => {
      if (e.detail) openCreationById(e.detail);
    };
    window.addEventListener('open-creation', handleOpenCreationEvent as EventListener);
    return () => {
      window.removeEventListener('open-creation', handleOpenCreationEvent as EventListener);
    };
  }, []);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const data = await prepareAndUploadMedia(file, {
        imageMode: 'artwork',
        authFetch,
        lang,
      });
      setNewMediaUrl(data.url);
      if (data.is_audio) {
        setNewMediaType('audio');
      } else if (data.is_video) {
        setNewMediaType('video');
      } else {
        setNewMediaType('image');
      }
    } catch (e: any) {
      console.error(e);
      setUploadError(e?.message || (lang === 'ru' ? 'Ошибка загрузки файла' : 'File upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuth('login');
      return;
    }
    if (!newCategory) {
      setUploadError(lang === 'ru' ? 'Выберите категорию: Творчество или Мемы.' : 'Select a category: Creative or Memes.');
      return;
    }
    if (!newTitle.trim() || !newMediaUrl.trim()) {
      setUploadError('Укажите название и загрузите файл или вставьте ссылку.');
      return;
    }

    setIsSubmitting(true);
    setUploadError(null);
    try {
      const res = await authFetch('/api/creations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          category: newCategory,
          description: newDesc.trim(),
          media_url: newMediaUrl.trim(),
          media_type: newMediaType,
        }),
      });
      const data = await safeJson<{ status?: string; error?: string }>(res, {});
      if (res.ok) {
        setPublishModalOpen(false);
        setNewTitle('');
        setNewCategory('');
        setNewDesc('');
        setNewMediaUrl('');
        setSelectedCategory('all');
        setToastMessage(
          data.status === 'pending'
            ? (lang === 'ru' ? 'Отправлено на модерацию' : 'Submitted for review')
            : (lang === 'ru' ? 'Публикация добавлена' : 'Creation published')
        );
        setTimeout(() => setToastMessage(null), 4000);
        fetchCreations();
        refresh();
      } else {
        setUploadError(data.error || 'Не удалось опубликовать работу');
      }
    } catch (e: any) {
      setUploadError(e?.message || 'Ошибка сети при публикации');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModerateCreation = async (
    creationId: string,
    status: 'approved' | 'rejected',
    categoryOverride?: 'art' | 'meme'
  ) => {
    try {
      const res = await authFetch(`/api/admin/creations/${creationId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(categoryOverride ? { category: categoryOverride } : {}),
        }),
      });
      if (res.ok) {
        fetchCreations();
        refresh();
        if (activeCreation && activeCreation.id === creationId) {
          setActiveCreation((prev) =>
            prev
              ? {
                  ...prev,
                  status,
                  ...(categoryOverride ? { category: categoryOverride } : {}),
                }
              : null
          );
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleFollowAuthor = async () => {
    if (!activeCreation) return;
    if (!user) {
      openAuth('login');
      return;
    }
    if (user.id === activeCreation.user_id || followBusy) return;
    setFollowBusy(true);
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(activeCreation.author_nickname)}/follow`, {
        method: 'POST',
      });
      const data = await safeJson<{
        following?: boolean;
        followers_count?: number;
        newly_unlocked_achievements?: any[];
      }>(res, {});
      if (res.ok) {
        setActiveCreation((prev) =>
          prev
            ? {
                ...prev,
                author_is_following: Boolean(data.following),
                author_followers_count:
                  typeof data.followers_count === 'number'
                    ? data.followers_count
                    : prev.author_followers_count,
              }
            : null
        );
        if (data.newly_unlocked_achievements?.length) {
          dispatchAchievementUnlocked(data.newly_unlocked_achievements);
        }
        refresh();
      }
    } finally {
      setFollowBusy(false);
    }
  };

  const handleReactCreation = async (creationId: string, reactionType: 'rose' | 'skull') => {
    if (!user) {
      openAuth('login');
      return;
    }

    const prevCreations = creations;
    const prevActive = activeCreation;
    const prevReactionState = userReaction;

    const target =
      (activeCreation && activeCreation.id === creationId ? activeCreation : null) ||
      creations.find((c) => c.id === creationId);
    if (!target) return;

    const currentReaction: 'rose' | 'skull' | null =
      activeCreation?.id === creationId ? userReaction : (target.user_reaction ?? null);
    const nextReaction: 'rose' | 'skull' | null = currentReaction === reactionType ? null : reactionType;

    let nextRose = Number(target.rose_count ?? 0);
    let nextSkull = Number(target.skull_count ?? 0);
    if (currentReaction === 'rose') nextRose = Math.max(0, nextRose - 1);
    if (currentReaction === 'skull') nextSkull = Math.max(0, nextSkull - 1);
    if (nextReaction === 'rose') nextRose += 1;
    if (nextReaction === 'skull') nextSkull += 1;
    const nextTotal = nextRose + nextSkull;

    // Instant Optimistic UI
    if (activeCreation?.id === creationId) {
      setUserReaction(nextReaction);
      setActiveCreation((prev) =>
        prev
          ? { ...prev, rose_count: nextRose, skull_count: nextSkull, likes_count: nextTotal, user_reaction: nextReaction }
          : null
      );
    }
    setCreations((curr) =>
      curr.map((c) =>
        c.id === creationId
          ? { ...c, rose_count: nextRose, skull_count: nextSkull, likes_count: nextTotal, user_reaction: nextReaction }
          : c
      )
    );

    try {
      const res = await authFetch(`/api/creations/${creationId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction_type: reactionType }),
      });
      const data = await safeJson<{
        reacted?: boolean;
        reaction_type?: 'rose' | 'skull' | null;
        rose_count?: number;
        skull_count?: number;
        likes_count?: number;
      }>(res, {});
      if (res.ok) {
        const syncedReaction = data.reacted ? (data.reaction_type ?? null) : null;
        const syncedRose = typeof data.rose_count === 'number' ? data.rose_count : nextRose;
        const syncedSkull = typeof data.skull_count === 'number' ? data.skull_count : nextSkull;
        const syncedTotal = typeof data.likes_count === 'number' ? data.likes_count : syncedRose + syncedSkull;

        if (activeCreation?.id === creationId) {
          setUserReaction(syncedReaction);
          setActiveCreation((prev) =>
            prev
              ? { ...prev, rose_count: syncedRose, skull_count: syncedSkull, likes_count: syncedTotal, user_reaction: syncedReaction }
              : null
          );
        }
        setCreations((curr) =>
          curr.map((c) =>
            c.id === creationId
              ? { ...c, rose_count: syncedRose, skull_count: syncedSkull, likes_count: syncedTotal, user_reaction: syncedReaction }
              : c
          )
        );
      } else {
        setCreations(prevCreations);
        setActiveCreation(prevActive);
        setUserReaction(prevReactionState);
      }
    } catch (e) {
      console.error(e);
      setCreations(prevCreations);
      setActiveCreation(prevActive);
      setUserReaction(prevReactionState);
    }
  };

  const handleToggleFavorite = async (creationId: string) => {
    if (!user) {
      openAuth('login');
      return;
    }
    try {
      const res = await authFetch(`/api/creations/${creationId}/favorite`, { method: 'POST' });
      const data = await safeJson<{ favorited?: boolean; error?: string }>(res, {});
      if (res.ok) {
        setIsFavorited(Boolean(data.favorited));
        setToastMessage(
          data.favorited
            ? (lang === 'ru' ? 'Добавлено в избранное' : 'Added to favorites')
            : (lang === 'ru' ? 'Убрано из избранного' : 'Removed from favorites')
        );
        setTimeout(() => setToastMessage(null), 3000);
      } else {
        setToastMessage(data.error || 'Failed');
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenEditModal = () => {
    if (!activeCreation) return;
    setEditError(null);
    setEditTitle(activeCreation.title || '');
    setEditCategory(activeCreation.category || 'artwork');
    setEditDesc(activeCreation.description || '');
    setEditMediaUrl(activeCreation.media_url || '');
    setEditMediaType(activeCreation.media_type || 'image');
    setEditModalOpen(true);
  };

  const handleSaveEditCreation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCreation || !editTitle.trim() || !editMediaUrl.trim()) {
      setEditError(lang === 'ru' ? 'Укажите название и ссылку на файл' : 'Title and media URL are required');
      return;
    }
    setSubmittingEdit(true);
    setEditError(null);
    try {
      const res = await authFetch(`/api/creations/${activeCreation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          category: editCategory,
          description: editDesc.trim(),
          media_url: editMediaUrl.trim(),
          media_type: editMediaType,
        }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (res.ok) {
        setEditModalOpen(false);
        setToastMessage(lang === 'ru' ? 'Работа обновлена' : 'Creation updated');
        setTimeout(() => setToastMessage(null), 3000);
        await openCreationDetail(activeCreation);
        fetchCreations();
      } else {
        setEditError(data.error || (lang === 'ru' ? 'Не удалось обновить работу' : 'Failed to update creation'));
      }
    } catch (e: any) {
      setEditError(e?.message || 'Network error');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const submitCreationCommentNow = async () => {
    if (!user || !activeCreation || !newComment.trim()) return;

    try {
      const res = await authFetch(`/api/creations/${activeCreation.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          parent_id: replyToCommentId,
        }),
      });
      const data = await safeJson<{ error?: string }>(res, {});
      if (res.ok) {
        setNewComment('');
        setReplyToCommentId(null);
        refresh();
        openCreationDetail(activeCreation);
      } else {
        setToastMessage(data.error || (lang === 'ru' ? 'Не удалось добавить комментарий' : 'Failed to add comment'));
        setTimeout(() => setToastMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCreationComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCreation || !newComment.trim()) return;
    requireRulesThen(() => {
      submitCreationCommentNow();
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingTarget(true);
    try {
      if (deleteTarget.type === 'creation') {
        const res = await authFetch(`/api/creations/${deleteTarget.id}`, { method: 'DELETE' });
        if (res.ok) {
          setDeleteTarget(null);
          setActiveCreation(null);
          setToastMessage(lang === 'ru' ? 'Публикация удалена' : 'Creation deleted');
          setTimeout(() => setToastMessage(null), 3000);
          fetchCreations();
          refresh();
        }
      } else if (deleteTarget.type === 'comment') {
        const res = await authFetch(`/api/community/comments/${deleteTarget.id}`, { method: 'DELETE' });
        if (res.ok) {
          setDeleteTarget(null);
          refresh();
          if (activeCreation) openCreationDetail(activeCreation);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingTarget(false);
    }
  };

  const filterTabs = [
    { key: 'art', labelRu: 'Творчество', labelEn: 'Creative', icon: Brush },
    { key: 'meme', labelRu: 'Мемы', labelEn: 'Memes', icon: Smile },
  ] as const;

  const categoryLabels: { [key: string]: { labelRu: string; labelEn: string } } = {
    art: { labelRu: 'Творчество', labelEn: 'Creative' },
    meme: { labelRu: 'Мемы', labelEn: 'Memes' },
    artwork: { labelRu: 'Творчество · Арт', labelEn: 'Artworks' },
    covers: { labelRu: 'Творчество · Кавер', labelEn: 'Covers' },
    beats: { labelRu: 'Творчество · Бит', labelEn: 'Beats' },
    video: { labelRu: 'Творчество · Видео', labelEn: 'Video Edits' },
    lyrics: { labelRu: 'Творчество · Лирика', labelEn: 'Lyrics' },
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 animate-fadeIn">
      {/* Toast */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 rounded-lg bg-[#141d16] border border-[#2b6637] text-xs text-[#6ee7b7] shadow-xl animate-fadeIn">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1 className="font-display text-2xl sm:text-4xl tracking-[0.2em] uppercase text-[#f2eee9] font-medium">
            {t('creationsTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-[#8e877e] mt-1 leading-relaxed">
            {t('creationsSubtitle')}
          </p>
        </div>

        <button
          onClick={() =>
            requireRulesThen(() => {
              setUploadError(null);
              setNewCategory('');
              setPublishModalOpen(true);
            })
          }
          className="flex items-center gap-2 font-mono text-xs tracking-wider uppercase px-5 py-2.5 bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.15] text-white rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {t('publishCreation')}
        </button>
      </div>

      {/* Filter and Categories Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full max-w-full min-w-0">
        {/* Category buttons */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1.5 font-mono text-xs w-full max-w-full min-w-0">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`shrink-0 px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-white/[0.1] text-white border border-white/20'
                : 'bg-[#100f13] text-[#8e877e] border border-white/[0.06] hover:text-white'
            }`}
          >
            {t('categoryAll')}
          </button>
          {filterTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setSelectedCategory(item.key)}
                className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                  selectedCategory === item.key
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'bg-[#100f13] text-[#8e877e] border border-white/[0.06] hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{lang === 'ru' ? item.labelRu : item.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative max-w-xs">
          <Search className="w-4 h-4 text-[#736c64] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            className="w-full bg-[#100f13] border border-white/[0.08] rounded-lg pl-9 pr-4 py-1.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/20 font-sans"
          />
        </div>
      </div>

      {/* Gallery Grid */}
      {loading ? (
        <div className="py-20 text-center font-mono text-xs text-[#8e877e]">
          {lang === 'ru' ? 'Загрузка галереи авторов...' : 'Loading creators gallery...'}
        </div>
      ) : creations.length === 0 ? (
        <div className="py-20 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
          {t('noCreations')}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {creations.map((creation) => (
            <div
              key={creation.id}
              onClick={() => openCreationDetail(creation)}
              className="group rounded-xl bg-[#100f13] border border-white/[0.07] hover:border-white/20 overflow-hidden transition-all duration-300 flex flex-col justify-between shadow-lg cursor-pointer"
            >
              {/* Media Thumbnail */}
              <div className="relative aspect-video w-full bg-[#0a0a0d] overflow-hidden flex items-center justify-center">
                {creation.media_type === 'image' ? (
                  <img
                    src={creation.media_url}
                    alt={creation.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : creation.media_type === 'video' ? (
                  <div className="flex flex-col items-center justify-center text-[#8e877e] group-hover:text-white transition-colors">
                    <Video className="w-10 h-10 mb-2" />
                    <span className="text-xs font-mono uppercase tracking-wider">{t('videoLabel')}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-[#8e877e] group-hover:text-white transition-colors">
                    <Music className="w-10 h-10 mb-2" />
                    <span className="text-xs font-mono uppercase tracking-wider">{t('audioTrackLabel')}</span>
                  </div>
                )}

                {/* Status badge */}
                {creation.status === 'pending' && (
                  <div className="absolute top-2.5 left-2.5 font-mono text-[10px] px-2 py-0.5 rounded bg-[#fbbf24]/20 border border-[#fbbf24]/40 text-[#fbbf24] backdrop-blur-sm">
                    {t('statusPending')}
                  </div>
                )}

                {/* Category tag */}
                <div className="absolute bottom-2.5 left-2.5 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-black/60 border border-white/10 text-[#ded8ce] backdrop-blur-sm">
                  {lang === 'ru'
                    ? (categoryLabels[creation.category]?.labelRu || creation.category)
                    : (categoryLabels[creation.category]?.labelEn || creation.category)}
                </div>
              </div>

              {/* Info & Author */}
              <div className="p-4 space-y-2">
                <h3 className="font-display text-base text-[#f2eee9] group-hover:text-white transition-colors truncate">
                  {creation.title}
                </h3>

                {creation.description && (
                  <p className="text-xs text-[#8e877e] line-clamp-2 leading-relaxed font-sans">
                    {creation.description}
                  </p>
                )}

                <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between font-mono text-xs text-[#736c64]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToProfile(creation.author_nickname);
                    }}
                    className="flex items-center gap-2 hover:underline cursor-pointer min-w-0"
                  >
                    <div className={`w-5 h-5 rounded-full overflow-hidden bg-black shrink-0 ${creation.author_frame || 'border border-white/10'}`}>
                      <img
                        src={creation.author_avatar || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                        alt={creation.author_name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <span className={`truncate text-xs ${creation.author_name_style || 'text-[#c5beb2]'}`}>
                      {creation.author_name || creation.author_nickname}
                    </span>
                    <span className="truncate text-[10px] text-[#736c64]">
                      {formatHandle(creation.author_nickname)}
                    </span>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReactCreation(creation.id, 'rose');
                      }}
                      title="Роза"
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                        creation.user_reaction === 'rose'
                          ? 'bg-[#821c2c]/30 border-[#a4283c] text-white'
                          : 'bg-white/[0.03] border-white/[0.07] text-[#c49298] hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <span>🌹</span>
                      <span>{creation.rose_count ?? 0}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReactCreation(creation.id, 'skull');
                      }}
                      title="Череп"
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                        creation.user_reaction === 'skull'
                          ? 'bg-white/[0.16] border-white/40 text-white'
                          : 'bg-white/[0.03] border-white/[0.07] text-[#8e877e] hover:border-white/20 hover:text-white'
                      }`}
                    >
                      <span>💀</span>
                      <span>{creation.skull_count ?? 0}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DETAIL MODAL */}
      {activeCreation && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-3xl bg-[#0c0b0e] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-white/[0.08] bg-[#111015]">
              <div className="flex flex-wrap items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveCreation(null);
                    goToProfile(activeCreation.author_nickname);
                  }}
                  className="flex items-center gap-3 text-left hover:underline cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-full overflow-hidden bg-black ${activeCreation.author_frame || 'border border-white/10'}`}>
                    <img
                      src={activeCreation.author_avatar || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                      alt={activeCreation.author_name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className={`text-xs font-semibold ${activeCreation.author_name_style || 'text-white'}`}>
                        {activeCreation.author_name || activeCreation.author_nickname}
                      </h3>
                      <span className="text-[10px] font-mono text-[#8e877e]">
                        {formatHandle(activeCreation.author_nickname)}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#736c64]">
                      {formatCreationDate(activeCreation.created_at)}
                    </span>
                  </div>
                </button>

                {(!user || user.id !== activeCreation.user_id) && (
                  <button
                    type="button"
                    disabled={followBusy}
                    onClick={handleToggleFollowAuthor}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono text-[11px] border transition-colors cursor-pointer disabled:opacity-50 ${
                      activeCreation.author_is_following
                        ? 'bg-white/[0.08] border-white/20 text-[#ded8ce] hover:bg-white/[0.14]'
                        : 'bg-[#821c2c]/30 border-[#a4283c]/70 text-[#f5c6cb] hover:bg-[#821c2c]/50'
                    }`}
                  >
                    {activeCreation.author_is_following ? (
                      <UserCheck className="w-3 h-3" />
                    ) : (
                      <UserPlus className="w-3 h-3" />
                    )}
                    <span>
                      {activeCreation.author_is_following
                        ? lang === 'ru' ? 'Вы подписаны' : 'Following'
                        : lang === 'ru' ? 'Подписаться' : 'Follow'}
                    </span>
                    {typeof activeCreation.author_followers_count === 'number' && (
                      <span className="opacity-75 tabular-nums">({activeCreation.author_followers_count})</span>
                    )}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Moderation actions for staff */}
                {isStaff && activeCreation.status === 'pending' && (
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <select
                      value={moderateCategory}
                      onChange={(e) => setModerateCategory(e.target.value === 'meme' ? 'meme' : 'art')}
                      className="px-2 py-1 rounded bg-[#16151a] border border-white/[0.14] text-white text-[11px] focus:outline-none"
                    >
                      <option value="art">Творчество</option>
                      <option value="meme">Мемы</option>
                    </select>
                    <button
                      onClick={() => handleModerateCreation(activeCreation.id, 'approved', moderateCategory)}
                      className="px-2.5 py-1 rounded bg-[#1a3820] border border-[#388548] text-white hover:bg-[#22482a] cursor-pointer"
                    >
                      {t('approveAction')}
                    </button>
                    <button
                      onClick={() => handleModerateCreation(activeCreation.id, 'rejected', moderateCategory)}
                      className="px-2.5 py-1 rounded bg-[#3d1820] border border-[#8a2a38] text-white hover:bg-[#4d1f2a] cursor-pointer"
                    >
                      {t('rejectAction')}
                    </button>
                  </div>
                )}
                {user && (user.id === activeCreation.user_id || isStaff) && (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenEditModal}
                      className="p-1.5 text-[#736c64] hover:text-white transition-colors cursor-pointer"
                      title={t('editBtn')}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ type: 'creation', id: activeCreation.id, label: activeCreation.title })}
                      className="p-1.5 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                      title={t('deleteBtn')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setActiveCreation(null)}
                  aria-label={t('closeBtn')}
                  className="p-1 text-[#8e877e] hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 font-sans">
              {/* Media viewer */}
              <div className="rounded-xl overflow-hidden bg-black border border-white/[0.08] max-h-96 flex items-center justify-center">
                {activeCreation.media_type === 'image' ? (
                  <img
                    src={activeCreation.media_url}
                    alt={activeCreation.title}
                    loading="lazy"
                    className="max-h-96 w-full object-contain"
                  />
                ) : activeCreation.media_type === 'audio' ? (
                  <div className="w-full p-8 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-white/[0.08] border border-white/20 flex items-center justify-center mx-auto text-white">
                      <Music className="w-8 h-8" />
                    </div>
                    <audio src={activeCreation.media_url} controls preload="none" className="w-full" />
                  </div>
                ) : (
                  <video src={activeCreation.media_url} controls preload="metadata" className="max-h-96 w-full" />
                )}
              </div>

              {/* Title & Description */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-xl sm:text-2xl text-[#f2eee9] font-medium">
                    {activeCreation.title}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(activeCreation.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer ${
                        isFavorited
                          ? 'bg-white/[0.12] border-white/30 text-white'
                          : 'bg-white/[0.04] border-white/[0.08] text-[#8e877e] hover:text-white'
                      }`}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current text-[#f2eee9]' : ''}`} />
                      <span>{isFavorited ? t('favoritedBtn') : t('favoriteBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReactCreation(activeCreation.id, 'rose')}
                      title="Роза"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer tabular-nums ${
                        userReaction === 'rose'
                          ? 'bg-[#821c2c]/30 border-[#a4283c] text-white'
                          : 'bg-white/[0.04] border-white/[0.08] text-[#8e877e] hover:text-white'
                      }`}
                    >
                      <span>🌹</span>
                      <span>{activeCreation.rose_count ?? 0}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReactCreation(activeCreation.id, 'skull')}
                      title="Череп"
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs transition-colors cursor-pointer tabular-nums ${
                        userReaction === 'skull'
                          ? 'bg-white/[0.16] border-white/40 text-white'
                          : 'bg-white/[0.04] border-white/[0.08] text-[#8e877e] hover:text-white'
                      }`}
                    >
                      <span>💀</span>
                      <span>{activeCreation.skull_count ?? 0}</span>
                    </button>
                  </div>
                </div>
                {activeCreation.description && (
                  <p className="text-xs text-[#ded8ce] leading-relaxed">
                    {activeCreation.description}
                  </p>
                )}
              </div>

              {/* Comments on creation */}
              <div className="space-y-4 pt-4 border-t border-white/[0.06]">
                <h4 className="font-display text-base uppercase text-[#f2eee9] flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#8e877e]" />
                  {t('commentsTitle')} ({creationComments.length})
                </h4>

                <form onSubmit={handleAddCreationComment} className="space-y-2">
                  {replyToCommentId && (
                    <div className="flex items-center justify-between px-3 py-1.5 rounded bg-white/[0.04] border border-white/10 text-xs font-mono text-[#a39b8b]">
                      <span className="flex items-center gap-1.5">
                        <CornerDownRight className="w-3.5 h-3.5" />
                        {lang === 'ru' ? 'Ответ на комментарий' : 'Replying to comment'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplyToCommentId(null)}
                        className="hover:text-white cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={
                        user
                          ? replyToCommentId
                            ? t('replyPlaceholder')
                            : t('writeComment')
                          : lang === 'ru'
                            ? 'Войдите, чтобы комментировать...'
                            : 'Sign in to comment...'
                      }
                      disabled={!user}
                      className="flex-1 bg-[#151419] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="submit"
                      disabled={!user || !newComment.trim()}
                      aria-label={lang === 'ru' ? 'Отправить комментарий' : 'Send comment'}
                      title={lang === 'ru' ? 'Отправить' : 'Send'}
                      className="px-4 bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </form>

                <div className="space-y-2.5">
                  {creationComments.length === 0 ? (
                    <div className="text-xs text-[#8e877e] py-3 text-center">
                      {lang === 'ru' ? 'Пока нет комментариев к этой работе.' : 'No comments on this work yet.'}
                    </div>
                  ) : (
                    creationComments.filter((c: any) => !c.parent_id).map((cm: any) => {
                      const replies = creationComments.filter((r: any) => r.parent_id === cm.id);
                      return (
                        <div key={cm.id} className="space-y-2">
                          <div className="p-3 rounded-lg bg-[#141318] border border-white/[0.04] space-y-1">
                            <div className="flex items-center justify-between text-xs font-mono">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveCreation(null);
                                  goToProfile(cm.author_nickname);
                                }}
                                className={`font-semibold hover:underline cursor-pointer flex items-center gap-1.5 ${cm.author_name_style || 'text-white'}`}
                              >
                                <span>{cm.author_name || cm.author_nickname}</span>
                                <span className="text-[10px] font-normal text-[#736c64]">{formatHandle(cm.author_nickname)}</span>
                              </button>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[#736c64]">
                                  {formatCreationDate(cm.created_at)}
                                </span>
                                {user && (user.id === cm.user_id || isStaff) && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget({ type: 'comment', id: cm.id, label: cm.content.slice(0, 60) })}
                                    className="p-0.5 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                                    title={t('deleteBtn')}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-[#ded8ce] leading-relaxed">
                              {cm.content}
                            </p>
                            <div className="pt-1 flex items-center gap-3 font-mono text-[10px]">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!user) openAuth('login');
                                  else setReplyToCommentId(cm.id);
                                }}
                                className="text-[#8e877e] hover:text-white flex items-center gap-1 cursor-pointer"
                              >
                                <Reply className="w-3 h-3" />
                                {t('replyBtn')}
                              </button>
                            </div>
                          </div>

                          {replies.length > 0 && (
                            <div className="pl-5 space-y-1.5 border-l border-white/[0.06] ml-3">
                              {replies.map((rep: any) => (
                                <div key={rep.id} className="p-2.5 rounded-lg bg-[#18171f] border border-white/[0.04] space-y-1">
                                  <div className="flex items-center justify-between text-[11px] font-mono">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveCreation(null);
                                        goToProfile(rep.author_nickname);
                                      }}
                                      className={`font-semibold hover:underline cursor-pointer flex items-center gap-1.5 ${rep.author_name_style || 'text-white'}`}
                                    >
                                      <span>{rep.author_name || rep.author_nickname}</span>
                                      <span className="text-[10px] font-normal text-[#736c64]">{formatHandle(rep.author_nickname)}</span>
                                    </button>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-[#736c64]">
                                        {formatCreationDate(rep.created_at)}
                                      </span>
                                      {user && (user.id === rep.user_id || isStaff) && (
                                        <button
                                          type="button"
                                          onClick={() => setDeleteTarget({ type: 'comment', id: rep.id, label: rep.content.slice(0, 60) })}
                                          className="p-0.5 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                                          title={t('deleteBtn')}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-xs text-[#ded8ce] leading-relaxed">{rep.content}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PUBLISH MODAL */}
      {publishModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-lg bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="font-display text-lg tracking-wider uppercase text-[#f2eee9] font-medium">
                {t('publishCreation')}
              </h2>
              <button
                onClick={() => setPublishModalOpen(false)}
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {uploadError && (
              <div className="p-3 rounded bg-[#3d1820] border border-[#8a2a38] text-xs text-white">
                {uploadError}
              </div>
            )}

            <form onSubmit={handlePublish} className="space-y-4 font-sans text-xs">
              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workCategory')} *
                </label>
                <select
                  required
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                >
                  <option value="">
                    {lang === 'ru' ? 'Выберите категорию...' : 'Select a category...'}
                  </option>
                  <option value="art">
                    {lang === 'ru' ? 'Творчество (+15 XP после одобрения)' : 'Creative (+15 XP on approval)'}
                  </option>
                  <option value="meme">
                    {lang === 'ru' ? 'Мемы (+5 XP после одобрения)' : 'Memes (+5 XP on approval)'}
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workTitle')}
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={lang === 'ru' ? 'Например: Dark Resonance [Art edit]' : 'e.g. Dark Resonance [Art edit]'}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workDescription')}
                </label>
                <textarea
                  rows={3}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={lang === 'ru' ? 'Опишите концепцию, материалы или инструменты...' : 'Describe concept, materials or tools...'}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25 resize-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workImage')}
                </label>
                <div className="space-y-2">
                  <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-white/20 hover:border-white/40 bg-[#151419] cursor-pointer text-[#a39b8b] hover:text-white transition-colors">
                    <Upload className="w-4 h-4" />
                    <span>{uploading ? (lang === 'ru' ? 'Загрузка...' : 'Uploading...') : t('uploadFile')}</span>
                    <input
                      type="file"
                      accept={`image/*,video/*,${AUDIO_ACCEPT_ATTR}`}
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) handleFileUpload(file);
                      }}
                    />
                  </label>

                  <input
                    type="text"
                    value={newMediaUrl}
                    onChange={(e) => setNewMediaUrl(e.target.value)}
                    placeholder={t('imageUrlOrUpload')}
                    className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPublishModalOpen(false)}
                  className="px-4 py-2 font-mono text-xs uppercase text-[#8e877e] hover:text-white cursor-pointer"
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newCategory || !newTitle.trim() || !newMediaUrl.trim()}
                  className="px-5 py-2 font-mono text-xs uppercase tracking-wider rounded-lg bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] text-white disabled:opacity-40 cursor-pointer"
                >
                  {isSubmitting
                    ? (lang === 'ru' ? 'Отправка...' : 'Publishing...')
                    : t('postTopic')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT CREATION MODAL */}
      {editModalOpen && activeCreation && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-lg bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="font-display text-lg tracking-wider uppercase text-[#f2eee9] font-medium">
                {t('editBtn')}
              </h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded bg-[#3d1820] border border-[#8a2a38] text-xs text-white">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEditCreation} className="space-y-4 font-sans text-xs">
              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workCategory')}
                </label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as any)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                >
                  <option value="art">{lang === 'ru' ? 'Творчество' : 'Creative'}</option>
                  <option value="meme">{lang === 'ru' ? 'Мемы' : 'Memes'}</option>
                  <option value="artwork">{t('categoryArtwork')}</option>
                  <option value="covers">{t('categoryCover')}</option>
                  <option value="beats">{t('categoryBeat')}</option>
                  <option value="video">{t('categoryEdit')}</option>
                  <option value="lyrics">{t('categoryLyrics')}</option>
                </select>
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workTitle')}
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('workDescription')}
                </label>
                <textarea
                  rows={3}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white focus:outline-none focus:border-white/25 resize-none"
                />
              </div>

              <div>
                <label className="block font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('imageUrlOrUpload')}
                </label>
                <input
                  type="text"
                  required
                  value={editMediaUrl}
                  onChange={(e) => setEditMediaUrl(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 font-mono text-xs uppercase text-[#8e877e] hover:text-white cursor-pointer"
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="px-5 py-2 font-mono text-xs uppercase tracking-wider rounded-lg bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] text-white disabled:opacity-40 cursor-pointer"
                >
                  {submittingEdit ? (lang === 'ru' ? 'Сохранение...' : 'Saving...') : t('saveBtn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-md bg-[#121016] border border-red-900/60 rounded-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-lg text-[#f2eee9] uppercase tracking-wider">
                  {deleteTarget.type === 'creation'
                    ? (lang === 'ru' ? 'Удалить работу?' : 'Delete creation?')
                    : (lang === 'ru' ? 'Удалить комментарий?' : 'Delete comment?')}
                </h3>
                <p className="font-mono text-[11px] text-[#8e877e]">
                  {lang === 'ru' ? 'Действие нельзя отменить.' : 'This action cannot be undone.'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#191720] border border-white/[0.06] text-xs text-[#ded8ce] truncate">
              «{deleteTarget.label}»
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                disabled={deletingTarget}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 font-mono text-xs uppercase text-[#8e877e] hover:text-white cursor-pointer"
              >
                {t('cancelBtn')}
              </button>
              <button
                type="button"
                disabled={deletingTarget}
                onClick={handleConfirmDelete}
                className="px-5 py-2 font-mono text-xs uppercase tracking-wider rounded-lg bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-100 cursor-pointer disabled:opacity-50"
              >
                {deletingTarget ? (lang === 'ru' ? 'Удаление...' : 'Deleting...') : t('deleteBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Creations Rules Footer Link */}
      <div className="pt-4 border-t border-white/[0.05] flex items-center justify-between text-[11px] font-mono text-[#736c64]">
        <span>Галерея творчества Apostles of deathmarried</span>
        <button
          type="button"
          onClick={() => setRulesModalMode('view')}
          className="inline-flex items-center gap-1.5 text-[#8e877e] hover:text-[#f2eee9] transition-colors cursor-pointer"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-[#821c2c]" />
          <span>Правила</span>
        </button>
      </div>

      {/* Rules Modal */}
      <RulesModal
        isOpen={rulesModalMode !== null}
        mode={rulesModalMode || 'view'}
        userId={user?.id}
        onClose={() => {
          setRulesModalMode(null);
          pendingRulesActionRef.current = null;
        }}
        onAccepted={() => {
          setRulesModalMode(null);
          refresh();
          const nextAction = pendingRulesActionRef.current;
          pendingRulesActionRef.current = null;
          nextAction?.();
        }}
      />
    </div>
  );
};
