import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'ru' | 'en';

export interface Translations {
  [key: string]: {
    ru: string;
    en: string;
  };
}

const dictionary: Translations = {
  // Brand
  siteTitle: { ru: 'Apostles of deathmarried', en: 'Apostles of deathmarried' },
  tagline: {
    ru: 'Цифровой музыкальный архив и сообщество deathmarried',
    en: 'Digital music archive and community of deathmarried',
  },
  disclaimer: {
    ru: 'Независимый фанатский проект, посвящённый исключительно артисту deathmarried. Не является официальным сайтом артиста. Все материалы используются в некоммерческих ознакомительных целях.',
    en: 'Independent fan project dedicated solely to artist deathmarried. Not an official artist website. All materials are used for non-commercial archival and community purposes.',
  },

  // Navigation
  navHome: { ru: 'ГЛАВНАЯ', en: 'HOME' },
  navArchive: { ru: 'АРХИВ', en: 'ARCHIVE' },
  navGames: { ru: 'ИГРЫ', en: 'GAMES' },
  navCommunity: { ru: 'СООБЩЕСТВО', en: 'COMMUNITY' },
  navCreations: { ru: 'ТВОРЧЕСТВО', en: 'CREATIONS' },
  navProfile: { ru: 'ПРОФИЛЬ', en: 'PROFILE' },
  navAdmin: { ru: 'АДМИН', en: 'ADMIN' },
  navLogin: { ru: 'ВОЙТИ', en: 'SIGN IN' },
  navLogout: { ru: 'ВЫЙТИ', en: 'SIGN OUT' },

  // Intro
  introEnter: { ru: 'ПРОДОЛЖИТЬ', en: 'ENTER ARCHIVE' },
  introSkip: { ru: 'Пропустить заставку', en: 'Skip prologue' },
  introQuote: {
    ru: 'В темноте бархата рождается истинный звук.',
    en: 'From the deepest velvet shadows, the true sound emerges.',
  },

  // Archive
  archiveTitle: { ru: 'Дискография', en: 'Discography' },
  archiveSubtitle: {
    ru: 'Студийные альбомы, мини-альбомы и официальные синглы deathmarried.',
    en: 'Studio albums, EPs, and official singles by deathmarried.',
  },
  albumsSection: { ru: 'АЛЬБОМЫ', en: 'ALBUMS' },
  singlesSection: { ru: 'СИНГЛЫ', en: 'SINGLES' },
  tracklist: { ru: 'Список композиций', en: 'Tracklist' },
  playAll: { ru: 'Слушать альбом', en: 'Play Album' },
  playTrack: { ru: 'Слушать', en: 'Play' },
  viewLyrics: { ru: 'Текст', en: 'Lyrics' },
  duration: { ru: 'Длительность', en: 'Duration' },
  year: { ru: 'Год выпуска', en: 'Release Year' },

  // Games & Challenges
  gamesTitle: { ru: 'ИНТЕРАКТИВНЫЕ ИСПЫТАНИЯ', en: 'INTERACTIVE CHALLENGES' },
  gamesSubtitle: {
    ru: 'Проверь свою музыкальную память, участвуй в испытаниях и зарабатывай опыт.',
    en: 'Test your musical memory, participate in challenges and earn experience.',
  },
  gameGuessTrack: { ru: 'УГАДАЙ ТРЕК', en: 'GUESS THE TRACK' },
  gameDailyQuiz: { ru: 'ЕЖЕДНЕВНАЯ ВИКТОРИНА', en: 'DAILY QUIZ' },
  gameLeaderboard: { ru: 'ТАБЛИЦА ЛИДЕРОВ', en: 'LEADERBOARD' },
  guessListenSnippet: { ru: 'Слушайте фрагмент и выберите композицию', en: 'Listen to the fragment and identify the track' },
  guessNextRound: { ru: 'Следующий раунд', en: 'Next Round' },
  dailyQuizNotice: { ru: 'Единый набор вопросов для всех участников каждый день.', en: 'One synchronized set of questions for all listeners daily.' },
  dailyStreak: { ru: 'Серия дней', en: 'Daily Streak' },
  submitAnswers: { ru: 'Отправить ответы', en: 'Submit Answers' },
  rank: { ru: 'Ранг', en: 'Rank' },
  apostle: { ru: 'Участник', en: 'Member' },
  level: { ru: 'Уровень', en: 'Level' },
  xp: { ru: 'Опыт (XP)', en: 'XP' },
  allTime: { ru: 'За всё время', en: 'All-Time' },
  weekly: { ru: 'За неделю', en: 'Weekly' },
  monthly: { ru: 'За месяц', en: 'Monthly' },
  guessSongPrompt: { ru: 'Слушайте фрагмент и выберите композицию', en: 'Listen to the fragment and select the composition' },
  clickToHear: { ru: 'Нажмите для воспроизведения фрагмента', en: 'Click to play audio fragment' },
  playingSnippet: { ru: 'Звучит фрагмент...', en: 'Playing fragment...' },
  score: { ru: 'Счёт', en: 'Score' },
  correct: { ru: 'Верно!', en: 'Correct!' },
  wrong: { ru: 'Неверно', en: 'Incorrect' },
  tryAgain: { ru: 'Попробовать снова', en: 'Try Again' },
  streak: { ru: 'Серия побед', en: 'Win Streak' },
  dailyQuizComplete: { ru: 'Викторина пройдена!', en: 'Daily Quiz Completed!' },
  dailyQuizScore: { ru: 'Ваш результат', en: 'Your Result' },
  returnTomorrow: { ru: 'Возвращайтесь завтра за новыми вопросами!', en: 'Return tomorrow for new questions!' },
  leaderboardEmpty: { ru: 'Таблица лидеров пуста. Будьте первым!', en: 'Leaderboard is empty. Be the first to rank!' },
  signInToSaveScore: { ru: 'Войдите, чтобы сохранять результаты и повышать уровень →', en: 'Sign in to record your scores and ascend the ranks →' },
  sonicTrial: { ru: 'ЗВУКОВОЕ ИСПЫТАНИЕ', en: 'SOUND CHALLENGE' },
  nextRound: { ru: 'Следующий раунд', en: 'Next Round' },

  // Community
  communityTitle: { ru: 'Сообщество', en: 'Community' },
  communitySubtitle: {
    ru: 'Обсуждение релизов, звучания, текстов и новостей deathmarried.',
    en: 'Discussion of releases, sonic textures, lyrics and news.',
  },
  newTopic: { ru: 'Создать тему', en: 'Start Discussion' },
  searchPlaceholder: { ru: 'Поиск по обсуждениям...', en: 'Search discussions...' },
  sortNew: { ru: 'Новые', en: 'Newest' },
  sortPopular: { ru: 'Популярные', en: 'Most Popular' },
  sortDiscussed: { ru: 'Обсуждаемые', en: 'Most Discussed' },
  comments: { ru: 'Комментарии', en: 'Comments' },
  writeComment: { ru: 'Написать комментарий...', en: 'Write a comment...' },
  sendComment: { ru: 'Ответить', en: 'Post Reply' },
  createTopic: { ru: 'Создать тему', en: 'Start Discussion' },
  topicTitle: { ru: 'Заголовок темы', en: 'Topic Title' },
  topicCategory: { ru: 'Категория', en: 'Category' },
  topicContent: { ru: 'Текст сообщения', en: 'Message Content' },
  postTopic: { ru: 'Опубликовать', en: 'Publish' },
  allCategories: { ru: 'Все категории', en: 'All Topics' },
  noTopics: { ru: 'В этой категории пока нет тем.', en: 'No discussions in this category yet.' },
  commentsCount: { ru: 'ответов', en: 'replies' },
  replyPlaceholder: { ru: 'Написать ответ...', en: 'Write a reply...' },
  replyBtn: { ru: 'Ответить', en: 'Reply' },

  // Creations
  creationsTitle: { ru: 'Творчество', en: 'Creations Gallery' },
  creationsSubtitle: {
    ru: 'Фанатские обложки, арты, видеомонтажи, авторские биты и тексты.',
    en: 'Fan artwork, covers, video edits, beats, remixes and poetry.',
  },
  publishCreation: { ru: 'Опубликовать работу', en: 'Publish Creation' },
  categoryAll: { ru: 'Все работы', en: 'All Works' },
  categoryArtwork: { ru: 'Арты & Фото', en: 'Art & Photography' },
  categoryCover: { ru: 'Альтернативные обложки', en: 'Alternative Covers' },
  categoryEdit: { ru: 'Видеоэдиты', en: 'Video Edits' },
  categoryBeat: { ru: 'Биты & Ремиксы', en: 'Beats & Remixes' },
  categoryLyrics: { ru: 'Тексты & Поэзия', en: 'Lyrics & Verses' },
  submitWork: { ru: 'Опубликовать работу', en: 'Submit Work' },
  workTitle: { ru: 'Название работы', en: 'Title' },
  workCategory: { ru: 'Категория', en: 'Category' },
  workDescription: { ru: 'Описание', en: 'Description' },
  workImage: { ru: 'Изображение / Аудио', en: 'Image / Audio' },
  uploadFile: { ru: 'Загрузить файл', en: 'Upload File' },
  imageUrlOrUpload: { ru: 'Или укажите прямую ссылку', en: 'Or direct URL' },
  noWorks: { ru: 'В галерее пока нет опубликованных работ. Будьте первым!', en: 'No community creations published yet. Be the first to share!' },
  noCreations: { ru: 'В галерее пока нет опубликованных работ. Будьте первым!', en: 'No community creations published yet. Be the first to share!' },
  by: { ru: 'Автор', en: 'By' },

  // Profile
  profileTitle: { ru: 'Профиль', en: 'Profile' },
  achievements: { ru: 'Достижения', en: 'Achievements' },
  followers: { ru: 'Подписчики', en: 'Followers' },
  following: { ru: 'Подписки', en: 'Following' },
  followBtn: { ru: 'Подписаться', en: 'Follow' },
  unfollowBtn: { ru: 'Отписаться', en: 'Unfollow' },
  editProfile: { ru: 'Редактировать', en: 'Edit Profile' },
  myWorks: { ru: 'Работы в галерее', en: 'Published Works' },
  myPosts: { ru: 'Темы на форуме', en: 'Forum Topics' },
  editProfileTitle: { ru: 'Редактировать профиль', en: 'Edit Profile' },
  displayName: { ru: 'Отображаемое имя', en: 'Display Name' },
  bio: { ru: 'О себе', en: 'Bio' },
  customStatus: { ru: 'Статус / Настроение', en: 'Status / Mood' },
  avatarUrl: { ru: 'Ссылка на аватар', en: 'Avatar URL' },
  saveBtn: { ru: 'Сохранить', en: 'Save' },
  cancelBtn: { ru: 'Отмена', en: 'Cancel' },
  xpToNext: { ru: 'XP до следующего уровня', en: 'XP to next level' },
  unlockedOn: { ru: 'Разблокировано', en: 'Unlocked' },
  noAchievements: { ru: 'Достижения пока не разблокированы. Пройдите испытания в разделе Игры!', en: 'No achievements unlocked yet. Complete challenges in Games section!' },
  noUserWorks: { ru: 'У этого пользователя пока нет опубликованных работ.', en: 'No works published by this user yet.' },
  noUserPosts: { ru: 'У этого пользователя пока нет тем на форуме.', en: 'No discussions started by this user yet.' },
  tabOverview: { ru: 'Обзор', en: 'Overview' },
  tabPosts: { ru: 'Публикации', en: 'Discussions' },
  tabCreations: { ru: 'Творчество', en: 'Creations' },
  tabAchievements: { ru: 'Достижения', en: 'Achievements' },
  tabCollection: { ru: 'Коллекция', en: 'Collection' },
  tabActivity: { ru: 'Активность', en: 'Activity' },

  // XP Shop
  shopTitle: { ru: 'МАГАЗИН КАСТОМИЗАЦИИ', en: 'CUSTOMIZATION SHOP' },
  shopSubtitle: {
    ru: 'Тратьте заработанный опыт (XP) на эксклюзивные рамки аватара, фоны и оформление профиля.',
    en: 'Spend your earned XP on exclusive avatar frames, profile banners, and styling.',
  },
  shopFrames: { ru: 'Рамки аватара', en: 'Avatar Frames' },
  shopBanners: { ru: 'Фоны профиля', en: 'Profile Banners' },
  shopNameStyles: { ru: 'Стили никнейма', en: 'Name Styles' },
  shopBadges: { ru: 'Значки', en: 'Badges' },
  buyBtn: { ru: 'Купить', en: 'Purchase' },
  equipBtn: { ru: 'Надеть', en: 'Equip' },
  unequipBtn: { ru: 'Снять', en: 'Unequip' },
  equippedBadge: { ru: 'Активно', en: 'Equipped' },
  ownedBadge: { ru: 'В коллекции', en: 'Owned' },
  insufficientXp: { ru: 'Недостаточно XP', en: 'Insufficient XP' },
  previewItem: { ru: 'Предпросмотр', en: 'Live Preview' },
  balanceLabel: { ru: 'Доступно XP', en: 'Available XP' },

  // Moderation
  statusPending: { ru: 'На проверке', en: 'Pending Review' },
  statusApproved: { ru: 'Одобрено', en: 'Approved' },
  statusRejected: { ru: 'Отклонено', en: 'Rejected' },
  approveAction: { ru: 'Одобрить', en: 'Approve' },
  rejectAction: { ru: 'Отклонить', en: 'Reject' },
  moderationNotice: { ru: 'Публикация находится на модерации и будет видна всем после проверки.', en: 'Post is under review and will appear publicly once approved.' },
  officialBadge: { ru: 'Официально', en: 'Official' },

  // Auth
  authTitleLogin: { ru: 'Вход в аккаунт', en: 'Sign In' },
  authTitleRegister: { ru: 'Регистрация аккаунта', en: 'Create Account' },
  nicknameLabel: { ru: 'Никнейм или Email', en: 'Nickname or Email' },
  passwordLabel: { ru: 'Пароль', en: 'Password' },
  noEmailNote: { ru: 'Используйте никнейм или email для входа в аккаунт.', en: 'Use your nickname or email to sign in to your account.' },
  loginBtn: { ru: 'Войти', en: 'Sign In' },
  registerBtn: { ru: 'Зарегистрироваться', en: 'Register' },
  switchRegister: { ru: 'Нет аккаунта? Зарегистрироваться', en: "Don't have an account? Register" },
  switchLogin: { ru: 'Уже есть аккаунт? Войти', en: 'Already have an account? Sign In' },

  // Player
  playerNowPlaying: { ru: 'СЕЙЧАС ИГРАЕТ', en: 'NOW PLAYING' },
  playerQueue: { ru: 'Очередь', en: 'Queue' },
  playerShuffle: { ru: 'Случайно', en: 'Shuffle' },
  playerRepeat: { ru: 'Повтор', en: 'Repeat' },
  playerNoAudio: { ru: 'Нет локального аудиофайла', en: 'No local audio file' },
  playerStreamOnly: { ru: 'Только онлайн стриминг', en: 'Stream Only' },
  playerVolume: { ru: 'Громкость', en: 'Volume' },

  // Detailed Archive & Releases
  officialCanon: { ru: 'ДИСКОГРАФИЯ', en: 'DISCOGRAPHY' },
  studioAlbums: { ru: 'СТУДИЙНЫЕ АЛЬБОМЫ', en: 'STUDIO ALBUMS' },
  epsSection: { ru: 'МИНИ-АЛЬБОМЫ И EP', en: 'EPS & MINI-ALBUMS' },
  verifiedCanon: { ru: 'ОФИЦИАЛЬНЫЙ РЕЛИЗ', en: 'OFFICIAL RELEASE' },
  verifiedSource: { ru: 'Источник', en: 'Source' },
  lastVerified: { ru: 'Дата', en: 'Date' },
  singleDetails: { ru: 'Информация о сингле', en: 'Single Details' },
  listenOnPlatforms: { ru: 'Слушать на стриминговых сервисах', en: 'Stream on music platforms' },
  streamingPlatforms: { ru: 'Стриминговые платформы', en: 'Streaming Platforms' },
  streamOn: { ru: 'Слушать на', en: 'Listen on' },
  streamTrack: { ru: 'Слушать онлайн', en: 'Stream' },
  playSnippet: { ru: 'Воспроизвести фрагмент', en: 'Play Preview' },
  noAudioNotice: {
    ru: 'Официальный MP3 файл ещё не загружен в архив. Релиз доступен на стриминговых платформах.',
    en: 'Audio file is not uploaded to archive yet. Listen on streaming platforms.',
  },
  backToDiscography: { ru: '← Назад к дискографии', en: '← Back to Discography' },
  tracksCount: { ru: 'композиций', en: 'tracks' },
  totalDuration: { ru: 'Длительность', en: 'Duration' },
  releaseDate: { ru: 'Дата выхода', en: 'Release Date' },
  lyricsFor: { ru: 'Текст', en: 'Lyrics' },
  noLyrics: { ru: 'Текст композиции отсутствует.', en: 'Lyrics not available.' },
  closeBtn: { ru: 'Закрыть', en: 'Close' },
  searchArchive: { ru: 'Поиск по дискографии...', en: 'Search discography...' },
  noReleasesFound: { ru: 'Релизы не найдены', en: 'No releases found' },
  officialSourceBtn: { ru: 'ИСТОЧНИК', en: 'SOURCE' },

  // Footer & Misc
  streamNoticeHeader: { ru: 'ДОСТУПНО НА СТРИМИНГОВЫХ СЕРВИСАХ', en: 'AVAILABLE ON STREAMING SERVICES' },
  reportSuccess: { ru: 'Жалоба передана модераторам.', en: 'Report dispatched to moderators.' },
  fileUploadError: { ru: 'Ошибка загрузки файла. Допустимы файлы до 100 МБ.', en: 'Upload failed. Files up to 100MB are accepted.' },
  channel: { ru: 'Telegram-канал', en: 'Telegram Channel' },
  bot: { ru: 'Архивный бот', en: 'Archive Bot' },
  emailContact: { ru: 'Почта', en: 'Email' },
  addTrackBtn: { ru: 'Добавить трек', en: 'Add Track' },
  commentsTitle: { ru: 'Комментарии', en: 'Comments' },
  search: { ru: 'Поиск...', en: 'Search...' },
  noTopicsFound: { ru: 'Обсуждений не найдено.', en: 'No discussions found.' },
  profileSettings: { ru: 'Настройки', en: 'Settings' },
  profileAchievements: { ru: 'Достижения', en: 'Achievements' },
  profileCreations: { ru: 'Творчество', en: 'Creations' },
  profileDiscussions: { ru: 'Обсуждения', en: 'Discussions' },
  profileInventory: { ru: 'Коллекция', en: 'Collection' },
  profileActivity: { ru: 'Активность', en: 'Activity' },
  shopEquipped: { ru: 'Активно', en: 'Equipped' },
  shopUnequip: { ru: 'Снять', en: 'Unequip' },
  shopEquip: { ru: 'Надеть', en: 'Equip' },
  shopBuy: { ru: 'Купить', en: 'Purchase' },
  navShop: { ru: 'Магазин XP', en: 'XP Shop' },
  notFoundTitle: { ru: 'Страница не найдена', en: 'Page Not Found' },
  notFoundSubtitle: {
    ru: 'Запрошенный раздел архива не существует или был перемещён.',
    en: 'The requested archive route does not exist or has been moved.',
  },
  returnHome: { ru: 'Вернуться на главную', en: 'Return Home' },
  newReleaseBtn: { ru: 'Новый релиз', en: 'New Release' },
  newAlbumBtn: { ru: 'Новый альбом / EP', en: 'New Album / EP' },
  pinBtn: { ru: 'Закрепить', en: 'Pin' },
  unpinBtn: { ru: 'Открепить', en: 'Unpin' },
  lockBtn: { ru: 'Закрыть', en: 'Lock' },
  unlockBtn: { ru: 'Открыть', en: 'Unlock' },
  editBtn: { ru: 'Редактировать', en: 'Edit' },
  deleteBtn: { ru: 'Удалить', en: 'Delete' },
  favoriteBtn: { ru: 'В избранное', en: 'Favorite' },
  favoritedBtn: { ru: 'В избранном', en: 'Favorited' },
  tabFavorites: { ru: 'Избранное', en: 'Favorites' },
  noFavorites: { ru: 'Избранных работ пока нет.', en: 'No favorited works yet.' },
  videoLabel: { ru: 'Видео', en: 'Video' },
  audioTrackLabel: { ru: 'Аудио трек', en: 'Audio Track' },
};

interface I18nContextType {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'ru',
  setLang: () => {},
  t: (k) => k,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('apostle_lang') as Language;
      return saved === 'en' ? 'en' : 'ru';
    } catch {
      return 'ru';
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem('apostle_lang', newLang);
    } catch {}
  };

  const t = (key: string): string => {
    const entry = dictionary[key];
    if (!entry) return key;
    return entry[lang] || entry.ru || key;
  };

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);

