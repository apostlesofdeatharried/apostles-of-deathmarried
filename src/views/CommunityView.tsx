import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth, authFetch } from '../context/AuthContext.js';
import { Post, PostCategory, Comment } from '../types/index.js';
import { safeJson } from '../utils/logic.js';
import { prepareAndUploadMedia } from '../utils/mediaCompression.js';
import { formatHandle, renderEquippedBadge, renderEquippedTitle } from '../utils/cosmetics.js';
import { RulesModal, hasAcceptedRules } from '../components/RulesModal.js';
import { dispatchAchievementUnlocked } from '../components/AchievementToast.js';
import {
  MessageSquare,
  Clock,
  Search,
  Plus,
  Send,
  Flag,
  Trash2,
  ChevronLeft,
  X,
  CheckCircle2,
  XCircle,
  Shield,
  ShieldAlert,
  CornerDownRight,
  Reply,
  Upload,
  Lock,
  Unlock,
  Pin,
  Edit2,
  UserCheck,
  UserPlus,
} from 'lucide-react';

const formatCommunityDate = (dateStr?: string) => {
  if (!dateStr) return '—';
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
};

export const CommunityView: React.FC = () => {
  const { t, lang } = useI18n();
  const { user, openAuth, refresh } = useAuth();

  const [categories, setCategories] = useState<PostCategory[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sort, setSort] = useState<'new' | 'popular' | 'discussed'>('new');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Single post thread view
  const [activePost, setActivePost] = useState<Post | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [followBusy, setFollowBusy] = useState(false);

  // Create Post Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState('');
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostCategory, setNewPostCategory] = useState('');
  const [newPostMediaUrl, setNewPostMediaUrl] = useState('');
  const [newPostMediaType, setNewPostMediaType] = useState('image');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Post Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editPostTitle, setEditPostTitle] = useState('');
  const [editPostContent, setEditPostContent] = useState('');
  const [editPostMediaUrl, setEditPostMediaUrl] = useState('');
  const [editPostMediaType, setEditPostMediaType] = useState('image');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'post' | 'comment'; id: string; label: string } | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);

  // Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: string; id: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Rules Modal
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
      else if (reportModalOpen) setReportModalOpen(false);
      else if (editModalOpen) setEditModalOpen(false);
      else if (createModalOpen) setCreateModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteTarget, deletingTarget, reportModalOpen, editModalOpen, createModalOpen]);

  const toastTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 4000);
  };

  const showError = (msg: string) => {
    setErrorBanner(msg);
    if (errorTimerRef.current !== null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setErrorBanner(null), 5000);
  };

  const getDefaultCategoryId = (cats: PostCategory[]) => {
    const eligible = isStaff ? cats : cats.filter((c) => !c.is_official);
    return (eligible[0] || cats[0])?.id || '';
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/community/categories', { cache: 'no-store' });
      const data = await safeJson<{ categories?: PostCategory[] }>(res, { categories: [] });
      const cats = data.categories || [];
      setCategories(cats);
      if (cats.length > 0 && !newPostCategory) {
        setNewPostCategory(getDefaultCategoryId(cats));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (sort) params.set('sort', sort);
      if (search.trim()) params.set('search', search.trim());

      const res = await authFetch(`/api/community/posts?${params.toString()}`);
      const data = await safeJson<{ posts?: Post[]; error?: string }>(res, { posts: [] });
      if (!res.ok) {
        showError(data?.error || (lang === 'ru' ? 'Не удалось загрузить обсуждения' : 'Failed to load discussions'));
      }
      setPosts(data.posts || []);
    } catch (e: any) {
      showError(e?.message || (lang === 'ru' ? 'Ошибка сети' : 'Network error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [selectedCategory, sort, search, user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialPostId = params.get('post');
    if (initialPostId) {
      loadPostThread(initialPostId);
    }
    const handleOpenPostEvent = (e: CustomEvent<string>) => {
      if (e.detail) loadPostThread(e.detail);
    };
    window.addEventListener('open-community-post', handleOpenPostEvent as EventListener);
    return () => {
      window.removeEventListener('open-community-post', handleOpenPostEvent as EventListener);
    };
  }, []);

  const loadPostThread = async (postId: string) => {
    setLoadingThread(true);
    try {
      const res = await authFetch(`/api/community/posts/${postId}`);
      const data = await safeJson<{ post?: Post; comments?: Comment[]; userReaction?: string | null; error?: string } | null>(res, null);
      if (res.ok && data?.post) {
        setActivePost(data.post);
        setComments(data.comments || []);
        setUserReaction(data.userReaction ?? null);
      } else {
        showError(data?.error || (lang === 'ru' ? 'Не удалось открыть обсуждение' : 'Failed to open thread'));
      }
    } catch (e: any) {
      showError(e?.message || (lang === 'ru' ? 'Ошибка загрузки темы' : 'Failed to load topic'));
    } finally {
      setLoadingThread(false);
    }
  };

  const handleOpenCreateModal = () => {
    requireRulesThen(() => {
      setCreateError(null);
      if (!newPostCategory || (!isStaff && categories.find((c) => c.id === newPostCategory)?.is_official)) {
        setNewPostCategory(getDefaultCategoryId(categories));
      }
      setCreateModalOpen(true);
    });
  };

  const handleUploadPostMedia = async (file: File) => {
    setUploadingMedia(true);
    setCreateError(null);
    try {
      const data = await prepareAndUploadMedia(file, {
        imageMode: 'artwork',
        authFetch,
        lang,
        allowAudio: false,
        allowVideo: false,
        allowImage: true,
      });
      setNewPostMediaUrl(data.url);
      setNewPostMediaType('image');
    } catch (e: any) {
      setCreateError(e?.message || t('fileUploadError'));
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuth('login');
      return;
    }
    const categoryIdToUse = newPostCategory || getDefaultCategoryId(categories);
    if (!newPostTitle.trim() || !newPostContent.trim() || !categoryIdToUse) {
      setCreateError(lang === 'ru' ? 'Заполните заголовок, текст и выберите категорию' : 'Fill title, content and category');
      return;
    }
    setSubmittingPost(true);
    setCreateError(null);
    try {
      const res = await authFetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newPostTitle.trim(),
          content: newPostContent.trim(),
          category_id: categoryIdToUse,
          media_url: newPostMediaUrl.trim() || null,
          media_type: newPostMediaUrl.trim() ? newPostMediaType : null,
        }),
      });
      const data = await safeJson<{ ok?: boolean; id?: string; status?: string; error?: string } | null>(res, null);
      if (res.ok && data?.id) {
        setCreateModalOpen(false);
        setNewPostTitle('');
        setNewPostContent('');
        setNewPostMediaUrl('');
        setSelectedCategory('all');
        setSearch('');
        if (data.status === 'pending') {
          showToast(lang === 'ru' ? 'Тема отправлена на модерацию' : 'Post submitted for moderation');
        } else {
          showToast(lang === 'ru' ? 'Тема опубликована' : 'Topic published');
        }
        refresh();
        await fetchPosts();
        await loadPostThread(data.id);
      } else {
        setCreateError(data?.error || (lang === 'ru' ? 'Не удалось создать тему' : 'Failed to create post'));
      }
    } catch (e: any) {
      setCreateError(e?.message || 'Error occurred');
    } finally {
      setSubmittingPost(false);
    }
  };

  const handleOpenEditModal = () => {
    if (!activePost) return;
    setEditError(null);
    setEditPostTitle(activePost.title || '');
    setEditPostContent(activePost.content || '');
    setEditPostMediaUrl(activePost.media_url || '');
    setEditPostMediaType(activePost.media_type || 'image');
    setEditModalOpen(true);
  };

  const handleSaveEditPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePost || !editPostTitle.trim() || !editPostContent.trim()) {
      setEditError(lang === 'ru' ? 'Заполните заголовок и текст' : 'Title and content are required');
      return;
    }
    setSubmittingEdit(true);
    setEditError(null);
    try {
      const res = await authFetch(`/api/community/posts/${activePost.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editPostTitle.trim(),
          content: editPostContent.trim(),
          media_url: editPostMediaUrl.trim() || null,
          media_type: editPostMediaUrl.trim() ? editPostMediaType : null,
        }),
      });
      const data = await safeJson<{ error?: string } | null>(res, null);
      if (res.ok) {
        setEditModalOpen(false);
        showToast(lang === 'ru' ? 'Тема обновлена' : 'Topic updated');
        await loadPostThread(activePost.id);
        fetchPosts();
      } else {
        setEditError(data?.error || (lang === 'ru' ? 'Не удалось обновить тему' : 'Failed to update topic'));
      }
    } catch (e: any) {
      setEditError(e?.message || 'Error occurred');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleTogglePin = async (postId: string) => {
    try {
      const res = await authFetch(`/api/admin/community/posts/${postId}/pin`, { method: 'POST' });
      const data = await safeJson<{ is_pinned?: number; error?: string } | null>(res, null);
      if (res.ok) {
        showToast(
          data?.is_pinned
            ? (lang === 'ru' ? 'Тема закреплена' : 'Topic pinned')
            : (lang === 'ru' ? 'Тема откреплена' : 'Topic unpinned')
        );
        fetchPosts();
        if (activePost && activePost.id === postId) {
          loadPostThread(postId);
        }
      } else {
        showError(data?.error || 'Failed to update pin status');
      }
    } catch (e: any) {
      showError(e?.message || 'Error');
    }
  };

  const handleToggleLock = async (postId: string) => {
    try {
      const res = await authFetch(`/api/admin/community/posts/${postId}/lock`, { method: 'POST' });
      const data = await safeJson<{ is_locked?: number; error?: string } | null>(res, null);
      if (res.ok) {
        showToast(
          data?.is_locked
            ? (lang === 'ru' ? 'Обсуждение закрыто' : 'Discussion locked')
            : (lang === 'ru' ? 'Обсуждение открыто' : 'Discussion unlocked')
        );
        fetchPosts();
        if (activePost && activePost.id === postId) {
          loadPostThread(postId);
        }
      } else {
        showError(data?.error || 'Failed to update lock status');
      }
    } catch (e: any) {
      showError(e?.message || 'Error');
    }
  };

  const handleModeratePost = async (postId: string, status: 'approved' | 'rejected') => {
    try {
      const res = await authFetch(`/api/admin/community/posts/${postId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await safeJson<{ error?: string } | null>(res, null);
      if (res.ok) {
        showToast(status === 'approved' ? (lang === 'ru' ? 'Тема одобрена' : 'Topic approved') : (lang === 'ru' ? 'Тема отклонена' : 'Topic rejected'));
        fetchPosts();
        if (activePost && activePost.id === postId) {
          loadPostThread(postId);
        }
      } else {
        showError(data?.error || 'Moderation failed');
      }
    } catch (e: any) {
      showError(e?.message || 'Error');
    }
  };

  const handleToggleFollowAuthor = async () => {
    if (!activePost) return;
    if (!user) {
      openAuth('login');
      return;
    }
    if (user.id === activePost.user_id || followBusy) return;
    setFollowBusy(true);
    try {
      const res = await authFetch(`/api/profiles/${encodeURIComponent(activePost.author_nickname)}/follow`, {
        method: 'POST',
      });
      const data = await safeJson<{
        following?: boolean;
        followers_count?: number;
        newly_unlocked_achievements?: any[];
      }>(res, {});
      if (res.ok) {
        setActivePost((curr) =>
          curr
            ? {
                ...curr,
                author_is_following: Boolean(data.following),
                author_followers_count:
                  typeof data.followers_count === 'number'
                    ? data.followers_count
                    : curr.author_followers_count,
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

  const submitCommentNow = async () => {
    if (!user || !activePost || !newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const res = await authFetch(`/api/community/posts/${activePost.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newComment.trim(),
          parent_id: replyToCommentId,
        }),
      });
      const data = await safeJson<{ error?: string } | null>(res, null);
      if (res.ok) {
        setNewComment('');
        setReplyToCommentId(null);
        refresh();
        await loadPostThread(activePost.id);
        fetchPosts();
      } else {
        showError(data?.error || (lang === 'ru' ? 'Не удалось отправить комментарий' : 'Failed to post comment'));
      }
    } catch (e: any) {
      showError(e?.message || (lang === 'ru' ? 'Ошибка отправки комментария' : 'Failed to post comment'));
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePost || !newComment.trim()) return;
    requireRulesThen(() => {
      submitCommentNow();
    });
  };

  const handleToggleReaction = async (reactionType: 'rose' | 'skull') => {
    if (!user) {
      openAuth('login');
      return;
    }
    if (!activePost) return;

    const prevPost = activePost;
    const prevReaction = userReaction;
    const prevPosts = posts;

    const nextReaction = prevReaction === reactionType ? null : reactionType;
    let nextRose = Number(prevPost.rose_count ?? 0);
    let nextSkull = Number(prevPost.skull_count ?? 0);

    if (prevReaction === 'rose') nextRose = Math.max(0, nextRose - 1);
    if (prevReaction === 'skull') nextSkull = Math.max(0, nextSkull - 1);
    if (nextReaction === 'rose') nextRose += 1;
    if (nextReaction === 'skull') nextSkull += 1;
    const nextTotal = nextRose + nextSkull;

    // Optimistic UI update
    setUserReaction(nextReaction);
    setActivePost({
      ...prevPost,
      rose_count: nextRose,
      skull_count: nextSkull,
      reactions_count: nextTotal,
      user_reaction: nextReaction,
    });
    setPosts((curr) =>
      curr.map((p) =>
        p.id === prevPost.id
          ? { ...p, rose_count: nextRose, skull_count: nextSkull, reactions_count: nextTotal, user_reaction: nextReaction }
          : p
      )
    );

    try {
      const res = await authFetch(`/api/community/posts/${prevPost.id}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction_type: reactionType }),
      });
      const data = await safeJson<{
        reacted?: boolean;
        reaction_type?: 'rose' | 'skull' | null;
        rose_count?: number;
        skull_count?: number;
        reactions_count?: number;
        error?: string;
      }>(res, {});
      if (res.ok) {
        const syncedReaction = data.reacted ? (data.reaction_type ?? null) : null;
        const syncedRose = typeof data.rose_count === 'number' ? data.rose_count : nextRose;
        const syncedSkull = typeof data.skull_count === 'number' ? data.skull_count : nextSkull;
        const syncedTotal = typeof data.reactions_count === 'number' ? data.reactions_count : syncedRose + syncedSkull;
        setUserReaction(syncedReaction);
        setActivePost((curr) =>
          curr && curr.id === prevPost.id
            ? { ...curr, rose_count: syncedRose, skull_count: syncedSkull, reactions_count: syncedTotal, user_reaction: syncedReaction }
            : curr
        );
        setPosts((curr) =>
          curr.map((p) =>
            p.id === prevPost.id
              ? { ...p, rose_count: syncedRose, skull_count: syncedSkull, reactions_count: syncedTotal, user_reaction: syncedReaction }
              : p
          )
        );
      } else {
        setUserReaction(prevReaction);
        setActivePost(prevPost);
        setPosts(prevPosts);
        showError(data?.error || 'Не удалось обновить реакцию');
      }
    } catch (e: any) {
      setUserReaction(prevReaction);
      setActivePost(prevPost);
      setPosts(prevPosts);
      showError(e?.message || 'Ошибка реакции');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingTarget(true);
    try {
      if (deleteTarget.type === 'post') {
        const res = await authFetch(`/api/community/posts/${deleteTarget.id}`, { method: 'DELETE' });
        const data = await safeJson<{ error?: string } | null>(res, null);
        if (res.ok) {
          if (activePost?.id === deleteTarget.id) {
            setActivePost(null);
          }
          setDeleteTarget(null);
          showToast(lang === 'ru' ? 'Пост удалён' : 'Post deleted');
          refresh();
          fetchPosts();
        } else {
          showError(data?.error || (lang === 'ru' ? 'Ошибка удаления поста' : 'Failed to delete post'));
        }
      } else if (deleteTarget.type === 'comment') {
        const res = await authFetch(`/api/community/comments/${deleteTarget.id}`, { method: 'DELETE' });
        const data = await safeJson<{ error?: string } | null>(res, null);
        if (res.ok) {
          setDeleteTarget(null);
          showToast(lang === 'ru' ? 'Комментарий удалён' : 'Comment deleted');
          refresh();
          if (activePost) {
            await loadPostThread(activePost.id);
          }
          fetchPosts();
        } else {
          showError(data?.error || (lang === 'ru' ? 'Ошибка удаления комментария' : 'Failed to delete comment'));
        }
      }
    } catch (e: any) {
      showError(e?.message || 'Delete failed');
    } finally {
      setDeletingTarget(false);
    }
  };

  const handleSendReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      openAuth('login');
      return;
    }
    if (!reportTarget || !reportReason.trim()) return;
    try {
      const res = await authFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: reportTarget.type,
          target_id: reportTarget.id,
          reason: reportReason.trim(),
        }),
      });
      const data = await safeJson<{ error?: string } | null>(res, null);
      if (res.ok) {
        setReportModalOpen(false);
        setReportReason('');
        setReportTarget(null);
        showToast(t('reportSuccess'));
      } else {
        showError(data?.error || 'Failed to send report');
      }
    } catch (e: any) {
      showError(e?.message || 'Failed to send report');
    }
  };

  // Group categories into Official vs Community
  const officialCategories = categories.filter((c) => Boolean(c.is_official));
  const communityCategories = categories.filter((c) => !c.is_official);

  // Group top-level and reply comments
  const topLevelComments = comments.filter((c) => !c.parent_id);
  const getReplies = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 animate-fadeIn">
      {/* Toast Notifications */}
      {toastMessage && (
        <div className="fixed top-20 left-3 right-3 sm:left-auto sm:right-6 z-50 px-4 py-2.5 rounded-lg bg-[#141d16] border border-[#2b6637] text-xs text-[#6ee7b7] shadow-xl animate-fadeIn">
          {toastMessage}
        </div>
      )}
      {errorBanner && (
        <div className="fixed top-20 left-3 right-3 sm:left-auto sm:right-6 z-50 px-4 py-2.5 rounded-lg bg-[#280f14] border border-red-700 text-xs text-red-200 shadow-xl animate-fadeIn">
          {errorBanner}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1 className="font-display text-2xl sm:text-4xl tracking-[0.2em] uppercase text-[#f2eee9] font-medium">
            {t('communityTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-[#8e877e] mt-1 leading-relaxed">
            {t('communitySubtitle')}
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-2 font-mono text-xs tracking-wider uppercase px-5 py-2.5 bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.15] text-white rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          {t('newTopic')}
        </button>
      </div>

      {activePost ? (
        /* SINGLE THREAD VIEW */
        <div className="space-y-6 animate-fadeIn">
          <button
            onClick={() => setActivePost(null)}
            className="flex items-center gap-2 font-mono text-xs tracking-wider uppercase text-[#8e877e] hover:text-[#f2eee9] py-1.5 px-3 rounded-lg border border-white/[0.08] bg-[#100f13] cursor-pointer transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {lang === 'ru' ? 'Назад к обсуждениям' : 'Back to discussions'}
          </button>

          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 sm:p-8 space-y-6 shadow-xl">
            {/* Header / Author */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => goToProfile(activePost.author_nickname)}
                  className={`w-10 h-10 rounded-full overflow-hidden bg-black shrink-0 cursor-pointer ${activePost.author_frame || 'border border-white/10'}`}
                >
                  <img
                    src={activePost.author_avatar || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                    alt={activePost.author_name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </button>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToProfile(activePost.author_nickname)}
                      className={`text-sm font-semibold hover:underline cursor-pointer ${activePost.author_name_style || 'text-white'}`}
                    >
                      {activePost.author_name || activePost.author_nickname}
                    </button>
                    <span className="font-mono text-[10px] text-[#8e877e]">
                      {formatHandle(activePost.author_nickname)}
                    </span>
                    <span className="font-mono text-[10px] text-[#8e877e] px-1.5 py-0.5 rounded bg-white/[0.04]">
                      L{activePost.author_level}
                    </span>
                    {renderEquippedTitle(activePost.author_title, lang, true)}
                    {renderEquippedBadge(activePost.author_badge, lang, true)}
                  </div>
                  <div className="font-mono text-xs text-[#736c64] mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span>{formatCommunityDate(activePost.created_at)}</span>
                    <span>·</span>
                    <span className="text-[#a39b8b]">
                      {lang === 'ru' ? activePost.category_name_ru : activePost.category_name_en}
                    </span>
                    {Boolean(activePost.is_pinned) && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[#ded8ce] px-1.5 py-0.5 rounded bg-white/[0.08] text-[10px]">
                        <Pin className="w-2.5 h-2.5" />
                        {lang === 'ru' ? 'Закреплено' : 'Pinned'}
                      </span>
                    )}
                    {activePost.status === 'pending' && (
                      <span className="ml-1 text-[#fbbf24] px-1.5 py-0.5 rounded bg-[#fbbf24]/10 text-[10px]">
                        {t('statusPending')}
                      </span>
                    )}
                    {Boolean(activePost.is_locked) && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[#a39b8b] px-1.5 py-0.5 rounded bg-white/[0.05] text-[10px]">
                        <Lock className="w-2.5 h-2.5" />
                        {t('lockBtn')}
                      </span>
                    )}
                    {(!user || user.id !== activePost.user_id) && (
                      <button
                        type="button"
                        disabled={followBusy}
                        onClick={handleToggleFollowAuthor}
                        className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] transition-colors cursor-pointer disabled:opacity-50 ${
                          activePost.author_is_following
                            ? 'bg-white/[0.08] border-white/20 text-[#ded8ce] hover:bg-white/[0.14]'
                            : 'bg-[#821c2c]/30 border-[#a4283c]/70 text-[#f5c6cb] hover:bg-[#821c2c]/50'
                        }`}
                      >
                        {activePost.author_is_following ? (
                          <UserCheck className="w-3 h-3" />
                        ) : (
                          <UserPlus className="w-3 h-3" />
                        )}
                        <span>
                          {activePost.author_is_following
                            ? lang === 'ru' ? 'Вы подписаны' : 'Following'
                            : lang === 'ru' ? 'Подписаться' : 'Follow'}
                        </span>
                        {typeof activePost.author_followers_count === 'number' && (
                          <span className="opacity-75 tabular-nums">({activePost.author_followers_count})</span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons (Pin / Lock / Edit / Delete / Report / Moderate) */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isStaff && activePost.status === 'pending' && (
                  <div className="flex items-center gap-1 font-mono text-xs">
                    <button
                      onClick={() => handleModeratePost(activePost.id, 'approved')}
                      className="px-2.5 py-1 rounded bg-[#1a3820] border border-[#388548] text-white hover:bg-[#22482a] cursor-pointer"
                    >
                      {t('approveAction')}
                    </button>
                    <button
                      onClick={() => handleModeratePost(activePost.id, 'rejected')}
                      className="px-2.5 py-1 rounded bg-[#3d1820] border border-[#8a2a38] text-white hover:bg-[#4d1f2a] cursor-pointer"
                    >
                      {t('rejectAction')}
                    </button>
                  </div>
                )}
                {isStaff && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleTogglePin(activePost.id)}
                      className={`p-1.5 rounded border transition-colors cursor-pointer ${
                        activePost.is_pinned
                          ? 'text-white bg-white/[0.1] border-white/20'
                          : 'text-[#736c64] border-transparent hover:text-white'
                      }`}
                      title={activePost.is_pinned ? t('unpinBtn') : t('pinBtn')}
                    >
                      <Pin className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleLock(activePost.id)}
                      className={`p-1.5 rounded border transition-colors cursor-pointer ${
                        activePost.is_locked
                          ? 'text-amber-300 bg-amber-950/40 border-amber-700/40'
                          : 'text-[#736c64] border-transparent hover:text-white'
                      }`}
                      title={activePost.is_locked ? t('unlockBtn') : t('lockBtn')}
                    >
                      {activePost.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    </button>
                  </>
                )}
                {user && (user.id === activePost.user_id || isStaff) && (
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
                      onClick={() => setDeleteTarget({ type: 'post', id: activePost.id, label: activePost.title })}
                      className="p-1.5 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                      title={t('deleteBtn')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      openAuth('login');
                      return;
                    }
                    setReportTarget({ type: 'post', id: activePost.id });
                    setReportModalOpen(true);
                  }}
                  className="p-1.5 text-[#736c64] hover:text-[#ded8ce] transition-colors cursor-pointer"
                  title={lang === 'ru' ? 'Пожаловаться' : 'Report'}
                >
                  <Flag className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Post Title & Content */}
            <div className="space-y-4">
              <h2 className="font-display text-xl sm:text-2xl text-[#f2eee9] font-medium leading-snug">
                {activePost.title}
              </h2>
              <div className="text-sm text-[#ded8ce] leading-relaxed whitespace-pre-line font-sans">
                {activePost.content}
              </div>

              {activePost.media_url && (
                <div className="rounded-lg overflow-hidden border border-white/[0.08] max-h-96 bg-black">
                  <img
                    src={activePost.media_url}
                    alt={activePost.title}
                    loading="lazy"
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
            </div>

            {/* Reactions Bar — Strictly 2 reactions: Rose & Skull */}
            <div className="flex items-center gap-2.5 pt-4 border-t border-white/[0.06] font-mono text-xs">
              <button
                type="button"
                onClick={() => handleToggleReaction('rose')}
                title="Роза"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all cursor-pointer tabular-nums ${
                  userReaction === 'rose'
                    ? 'bg-[#821c2c]/30 border-[#a4283c] text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-[#8e877e] hover:text-white hover:border-white/20'
                }`}
              >
                <span>🌹</span>
                <span>{activePost.rose_count ?? 0}</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleReaction('skull')}
                title="Череп"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all cursor-pointer tabular-nums ${
                  userReaction === 'skull'
                    ? 'bg-white/[0.16] border-white/40 text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-[#8e877e] hover:text-white hover:border-white/20'
                }`}
              >
                <span>💀</span>
                <span>{activePost.skull_count ?? 0}</span>
              </button>
            </div>
          </div>

          {/* Comments Section */}
          <div className="bg-[#100f13] border border-white/[0.08] rounded-xl p-6 sm:p-8 space-y-6">
            <h3 className="font-display text-lg uppercase tracking-wider text-[#f2eee9] font-medium flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#8e877e]" />
              {t('commentsTitle')} ({comments.length})
            </h3>

            {/* Add Comment Input */}
            {Boolean(activePost.is_locked) && !isStaff ? (
              <div className="p-3 rounded-lg bg-[#151419] border border-white/[0.06] text-xs font-mono text-[#8e877e] flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                <span>{lang === 'ru' ? 'Обсуждение закрыто модераторами архива.' : 'Discussion locked by archive moderators.'}</span>
              </div>
            ) : (
              <form onSubmit={handleAddComment} className="space-y-2">
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
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={
                      user
                        ? replyToCommentId
                          ? t('replyPlaceholder')
                          : t('writeComment')
                        : lang === 'ru'
                          ? 'Войдите, чтобы оставить комментарий...'
                          : 'Sign in to leave a comment...'
                    }
                    disabled={!user || submittingComment}
                    rows={2}
                    className="flex-1 min-w-0 bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/30 resize-none font-sans"
                  />
                  <button
                    type="submit"
                    disabled={!user || !newComment.trim() || submittingComment}
                    aria-label={lang === 'ru' ? 'Отправить комментарий' : 'Send comment'}
                    title={lang === 'ru' ? 'Отправить' : 'Send'}
                    className="px-4 bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] disabled:opacity-40 text-white rounded-lg transition-colors cursor-pointer self-end py-3 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}

            {/* Nested Comments List */}
            {comments.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8e877e] font-sans">
                {lang === 'ru'
                  ? 'Пока нет комментариев. Будьте первым, кто поделится мыслями!'
                  : 'No comments yet. Be the first to share your thoughts!'}
              </div>
            ) : (
              <div className="space-y-4 pt-2">
                {topLevelComments.map((cm) => {
                  const replies = getReplies(cm.id);
                  return (
                    <div key={cm.id} className="space-y-3">
                      {/* Top-level comment */}
                      <div className="p-4 rounded-lg bg-[#151419] border border-white/[0.06] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              onClick={() => goToProfile(cm.author_nickname)}
                              className={`w-7 h-7 rounded-full overflow-hidden bg-black shrink-0 cursor-pointer ${cm.author_frame || 'border border-white/10'}`}
                            >
                              <img
                                src={cm.author_avatar || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                                alt={cm.author_name}
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => goToProfile(cm.author_nickname)}
                              className={`text-xs font-semibold truncate hover:underline cursor-pointer ${cm.author_name_style || 'text-white'}`}
                            >
                              {cm.author_name || cm.author_nickname}
                            </button>
                            <span className="font-mono text-[10px] text-[#736c64] hidden sm:inline">
                              {formatHandle(cm.author_nickname)}
                            </span>
                            <span className="font-mono text-[10px] text-[#8e877e]">
                              L{cm.author_level}
                            </span>
                            {renderEquippedTitle(cm.author_title, lang, true)}
                            {renderEquippedBadge(cm.author_badge, lang, true)}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-[10px] text-[#736c64]">
                              {formatCommunityDate(cm.created_at)}
                            </span>
                            {user && (user.id === cm.user_id || isStaff) && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ type: 'comment', id: cm.id, label: cm.content.slice(0, 60) })}
                                className="p-1 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                                title={t('deleteBtn')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (!user) { openAuth('login'); return; }
                                setReportTarget({ type: 'comment', id: cm.id });
                                setReportModalOpen(true);
                              }}
                              className="p-1 text-[#736c64] hover:text-[#ded8ce] transition-colors cursor-pointer"
                              title={lang === 'ru' ? 'Пожаловаться' : 'Report'}
                            >
                              <Flag className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-[#ded8ce] leading-relaxed pl-9 font-sans">
                          {cm.content}
                        </p>

                        <div className="pl-9 pt-1 flex items-center gap-3 font-mono text-[10px]">
                          <button
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

                      {/* Nested Replies */}
                      {replies.length > 0 && (
                        <div className="pl-6 sm:pl-8 space-y-2 border-l border-white/[0.06] ml-4">
                          {replies.map((reply) => (
                            <div key={reply.id} className="p-3.5 rounded-lg bg-[#18171f] border border-white/[0.05] space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => goToProfile(reply.author_nickname)}
                                    className={`w-6 h-6 rounded-full overflow-hidden bg-black shrink-0 cursor-pointer ${reply.author_frame || 'border border-white/10'}`}
                                  >
                                    <img
                                      src={reply.author_avatar || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                                      alt={reply.author_name}
                                      loading="lazy"
                                      className="w-full h-full object-cover"
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => goToProfile(reply.author_nickname)}
                                    className={`text-xs font-semibold truncate hover:underline cursor-pointer ${reply.author_name_style || 'text-white'}`}
                                  >
                                    {reply.author_name || reply.author_nickname}
                                  </button>
                                  <span className="font-mono text-[10px] text-[#736c64] hidden sm:inline">
                                    {formatHandle(reply.author_nickname)}
                                  </span>
                                  <span className="font-mono text-[10px] text-[#8e877e]">
                                    L{reply.author_level}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="font-mono text-[10px] text-[#736c64]">
                                    {formatCommunityDate(reply.created_at)}
                                  </span>
                                  {user && (user.id === reply.user_id || isStaff) && (
                                    <button
                                      type="button"
                                      onClick={() => setDeleteTarget({ type: 'comment', id: reply.id, label: reply.content.slice(0, 60) })}
                                      className="p-1 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                                      title={t('deleteBtn')}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-[#ded8ce] leading-relaxed pl-8 font-sans">
                                {reply.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* DISCUSSIONS LIST VIEW */
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-[#736c64] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full bg-[#100f13] border border-white/[0.08] rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/20 font-sans"
              />
            </div>

            {/* Sort options */}
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <button
                onClick={() => setSort('new')}
                className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                  sort === 'new' ? 'bg-white/[0.08] text-white border border-white/15' : 'text-[#8e877e] hover:text-white'
                }`}
              >
                {t('sortNew')}
              </button>
              <button
                onClick={() => setSort('popular')}
                className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                  sort === 'popular' ? 'bg-white/[0.08] text-white border border-white/15' : 'text-[#8e877e] hover:text-white'
                }`}
              >
                {t('sortPopular')}
              </button>
              <button
                onClick={() => setSort('discussed')}
                className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                  sort === 'discussed' ? 'bg-white/[0.08] text-white border border-white/15' : 'text-[#8e877e] hover:text-white'
                }`}
              >
                {t('sortDiscussed')}
              </button>
            </div>
          </div>

          {/* Grouped Category Buttons */}
          <div className="space-y-2 w-full max-w-full">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1.5 font-mono text-xs w-full max-w-full">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`shrink-0 px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-white/[0.1] text-white border border-white/20'
                    : 'bg-[#100f13] text-[#8e877e] border border-white/[0.06] hover:text-white'
                }`}
              >
                {t('allCategories')}
              </button>

              {/* Official Category */}
              {officialCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.slug)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedCategory === cat.slug
                      ? 'bg-[#821c2c]/40 text-white border border-[#821c2c]'
                      : 'bg-[#100f13] text-[#c5c8cf] border border-[#821c2c]/30 hover:border-[#821c2c]'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 text-[#e8909c]" />
                  <span>{lang === 'ru' ? cat.name_ru : cat.name_en}</span>
                </button>
              ))}

              {/* Community Categories */}
              {communityCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.slug)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat.slug
                      ? 'bg-white/[0.1] text-white border border-white/20'
                      : 'bg-[#100f13] text-[#8e877e] border border-white/[0.06] hover:text-white'
                  }`}
                >
                  {lang === 'ru' ? cat.name_ru : cat.name_en}
                </button>
              ))}
            </div>
          </div>

          {/* Post Items */}
          {loading ? (
            <div className="py-16 text-center font-mono text-xs text-[#8e877e]">
              {lang === 'ru' ? 'Загрузка тем обсуждения...' : 'Loading discussions...'}
            </div>
          ) : posts.length === 0 ? (
            <div className="py-16 text-center text-xs text-[#8e877e] bg-[#100f13] rounded-xl border border-white/[0.06]">
              {t('noTopicsFound')}
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => loadPostThread(post.id)}
                  className="group p-5 rounded-xl bg-[#100f13] border border-white/[0.07] hover:border-white/20 hover:bg-[#141318] transition-all cursor-pointer space-y-3 shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {Boolean(post.is_pinned) && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/[0.08] border border-white/15 text-[#f2eee9]">
                            <Pin className="w-3 h-3" />
                            {lang === 'ru' ? 'Закреплено' : 'Pinned'}
                          </span>
                        )}
                        {Boolean(post.is_locked) && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/[0.05] text-[#8e877e]">
                            <Lock className="w-3 h-3" />
                          </span>
                        )}
                        {Boolean(post.category_is_official) && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#821c2c]/20 border border-[#821c2c]/40 text-[#e8909c]">
                            <Shield className="w-3 h-3" />
                            {t('officialBadge')}
                          </span>
                        )}
                        <span className="font-mono text-[10px] text-[#8e877e] uppercase tracking-wider">
                          {lang === 'ru' ? post.category_name_ru : post.category_name_en}
                        </span>
                        {post.status === 'pending' && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[#fbbf24]">
                            {t('statusPending')}
                          </span>
                        )}
                        {post.status === 'rejected' && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#e53e3e]/10 border border-[#e53e3e]/30 text-[#e53e3e]">
                            {t('statusRejected')}
                          </span>
                        )}
                      </div>

                      <h2 className="font-display text-base sm:text-lg text-[#f2eee9] group-hover:text-white transition-colors leading-snug">
                        {post.title}
                      </h2>

                      <p className="text-xs text-[#8e877e] line-clamp-2 leading-relaxed font-sans">
                        {post.content}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 font-mono text-xs text-[#736c64] pt-1 tabular-nums">
                      <div className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{post.comments_count || 0}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[#c49298]" title="Роза">
                        <span>🌹</span>
                        <span>{post.rose_count ?? 0}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[#9b948b]" title="Череп">
                        <span>💀</span>
                        <span>{post.skull_count ?? 0}</span>
                      </div>
                      {user && (user.id === post.user_id || isStaff) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ type: 'post', id: post.id, label: post.title });
                          }}
                          className="p-1.5 rounded hover:bg-red-950/60 text-[#736c64] hover:text-[#d9777f] transition-colors cursor-pointer"
                          title={t('deleteBtn')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Author footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.04] text-[11px] font-mono text-[#736c64]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        goToProfile(post.author_nickname);
                      }}
                      className="flex items-center gap-2 hover:underline cursor-pointer"
                    >
                      <div className={`w-5 h-5 rounded-full overflow-hidden bg-black ${post.author_frame || 'border border-white/10'}`}>
                        <img
                          src={post.author_avatar || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                          alt={post.author_name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className={post.author_name_style || 'text-[#c5beb2]'}>
                        {post.author_name || post.author_nickname}
                      </span>
                      <span className="text-[10px] text-[#736c64]">
                        {formatHandle(post.author_nickname)}
                      </span>
                    </button>
                    <span>{formatCommunityDate(post.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CREATE POST MODAL */}
      {createModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="font-display text-lg tracking-wider uppercase text-[#f2eee9] font-medium">
                {t('newTopic')}
              </h2>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded bg-[#3d1820] border border-[#8a2a38] text-xs text-white">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreatePost} className="space-y-4 font-sans">
              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('topicCategory')}
                </label>
                <select
                  value={newPostCategory}
                  onChange={(e) => setNewPostCategory(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                >
                  {(isStaff ? categories : categories.filter((c) => !c.is_official)).map((cat) => (
                    <option
                      key={cat.id}
                      value={cat.id}
                    >
                      {lang === 'ru' ? cat.name_ru : cat.name_en}{' '}
                      {cat.is_official && isStaff ? `★ [${t('officialBadge')}]` : ''}
                    </option>
                  ))}
                </select>
                {!isStaff && (
                  <p className="text-[11px] text-[#736c64] mt-1 font-mono">
                    {t('moderationNotice')}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('topicTitle')}
                </label>
                <input
                  type="text"
                  required
                  value={newPostTitle}
                  onChange={(e) => setNewPostTitle(e.target.value)}
                  placeholder={lang === 'ru' ? 'О чём пойдёт речь...' : 'Topic subject...'}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('topicContent')}
                </label>
                <textarea
                  required
                  rows={5}
                  value={newPostContent}
                  onChange={(e) => setNewPostContent(e.target.value)}
                  placeholder={lang === 'ru' ? 'Поделитесь мыслями, анализом или вопросом...' : 'Share your thoughts, analysis or question...'}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25 resize-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-mono text-[#8e877e] uppercase tracking-wider">
                    {lang === 'ru' ? 'Изображение (необязательно)' : 'Image (optional)'}
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#ded8ce] hover:text-white cursor-pointer underline">
                    <Upload className="w-3 h-3" />
                    <span>{uploadingMedia ? (lang === 'ru' ? 'Загрузка...' : 'Uploading...') : t('uploadFile')}</span>
                    <input
                      type="file"
                      accept="image/*,.jpg,.jpeg,.png,.webp,.gif"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) handleUploadPostMedia(f);
                      }}
                    />
                  </label>
                </div>
                <input
                  type="text"
                  value={newPostMediaUrl}
                  onChange={(e) => setNewPostMediaUrl(e.target.value)}
                  placeholder="https://... /uploads/..."
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 font-mono text-xs uppercase text-[#8e877e] hover:text-white cursor-pointer"
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  disabled={submittingPost || uploadingMedia}
                  className="px-5 py-2 font-mono text-xs uppercase tracking-wider rounded-lg bg-white/[0.1] hover:bg-white/[0.2] border border-white/[0.15] text-white disabled:opacity-40 cursor-pointer"
                >
                  {submittingPost ? (lang === 'ru' ? 'Публикация...' : 'Publishing...') : t('postTopic')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT POST MODAL */}
      {editModalOpen && activePost && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-5 sm:p-6 space-y-5 shadow-2xl">
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

            <form onSubmit={handleSaveEditPost} className="space-y-4 font-sans">
              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('topicTitle')}
                </label>
                <input
                  type="text"
                  required
                  value={editPostTitle}
                  onChange={(e) => setEditPostTitle(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-white/25"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {t('topicContent')}
                </label>
                <textarea
                  required
                  rows={6}
                  value={editPostContent}
                  onChange={(e) => setEditPostContent(e.target.value)}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white focus:outline-none focus:border-white/25 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1 uppercase tracking-wider">
                  {lang === 'ru' ? 'URL изображения (необязательно)' : 'Image URL (optional)'}
                </label>
                <input
                  type="text"
                  value={editPostMediaUrl}
                  onChange={(e) => setEditPostMediaUrl(e.target.value)}
                  placeholder="https://... /uploads/..."
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-2.5 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25"
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
          <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[#121016] border border-red-900/60 rounded-xl p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-lg text-[#f2eee9] uppercase tracking-wider">
                  {deleteTarget.type === 'post'
                    ? (lang === 'ru' ? 'Удалить тему?' : 'Delete topic?')
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

      {/* REPORT MODAL */}
      {reportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
        >
          <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[#0c0b0e] border border-white/[0.12] rounded-xl p-5 sm:p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h2 className="font-display text-base tracking-wider uppercase text-[#f2eee9]">
                {lang === 'ru' ? 'Пожаловаться на нарушение' : 'Report Violation'}
              </h2>
              <button
                onClick={() => setReportModalOpen(false)}
                className="text-[#8e877e] hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendReport} className="space-y-4 font-sans">
              <div>
                <label className="block text-xs font-mono text-[#8e877e] mb-1">
                  {lang === 'ru' ? 'Причина жалобы' : 'Reason'}
                </label>
                <textarea
                  required
                  rows={3}
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder={lang === 'ru' ? 'Спам, оскорбления, неуместный контент...' : 'Spam, harassment, inappropriate content...'}
                  className="w-full bg-[#151419] border border-white/[0.08] rounded-lg p-3 text-xs text-white placeholder-[#736c64] focus:outline-none focus:border-white/25 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReportModalOpen(false)}
                  className="px-4 py-2 font-mono text-xs uppercase text-[#8e877e] hover:text-white cursor-pointer"
                >
                  {t('cancelBtn')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-mono text-xs uppercase tracking-wider rounded-lg bg-[#3d1820] hover:bg-[#4d1f2a] border border-[#8a2a38] text-white cursor-pointer"
                >
                  {lang === 'ru' ? 'Отправить' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subtle Forum Rules Footer Link */}
      <div className="pt-4 border-t border-white/[0.05] flex items-center justify-between text-[11px] font-mono text-[#736c64]">
        <span>Обсуждения сообщества Apostles of deathmarried</span>
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
