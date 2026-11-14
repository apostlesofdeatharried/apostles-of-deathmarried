import React, { useState } from 'react';
import { useI18n } from '../context/I18nContext.js';
import { useAuth } from '../context/AuthContext.js';
import { ShopModal } from './ShopModal.js';
import { Menu, X, Shield, User, LogOut, ChevronDown, ShoppingBag } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onSelectTab }) => {
  const { lang, setLang, t } = useI18n();
  const { user, openAuth, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);

  const navItems = [
    { id: 'home', label: t('navHome') },
    { id: 'archive', label: t('navArchive') },
    { id: 'games', label: t('navGames') },
    { id: 'community', label: t('navCommunity') },
    { id: 'creations', label: t('navCreations') },
  ];

  const handleTabClick = (id: string) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
    setUserDropdownOpen(false);
  };

  const isAdminOrMod = user?.role_id === 'admin' || user?.role_id === 'moderator';

  return (
    <>
      <ShopModal isOpen={shopOpen} onClose={() => setShopOpen(false)} />

      <header className="sticky top-0 z-40 w-full bg-[#08080a]/92 backdrop-blur-md border-b border-white/[0.06] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand Logo & Desktop Navigation */}
          <div className="flex items-center gap-4 2xl:gap-7 shrink-0">
            <button
              onClick={() => handleTabClick('home')}
              className="flex items-center gap-2.5 shrink-0 group text-left focus:outline-none cursor-pointer whitespace-nowrap"
              aria-label="Apostles of deathmarried home"
            >
              <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/[0.12] group-hover:border-white/40 transition-colors shrink-0">
                <img
                  src="/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg"
                  alt="Rose"
                  className="w-full h-full object-cover scale-105 group-hover:scale-115 transition-transform duration-500"
                />
              </div>
              <span className="font-display text-xs xl:text-[13px] tracking-[0.09em] 2xl:tracking-[0.14em] text-[#f2eee9] group-hover:text-white transition-colors uppercase font-light truncate max-w-[170px] sm:max-w-none">
                Apostles of deathmarried
              </span>
            </button>

            {/* Desktop Navigation */}
            <nav className="hidden xl:flex items-center gap-4 2xl:gap-5 shrink-0" aria-label="Main Navigation">
              {navItems.map((item) => {
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleTabClick(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`text-[11px] tracking-[0.09em] 2xl:tracking-[0.12em] uppercase transition-colors relative py-1 cursor-pointer font-sans whitespace-nowrap shrink-0 ${
                      isActive ? 'text-[#f2eee9] font-medium' : 'text-[#8e877e] hover:text-[#ded8ce]'
                    }`}
                  >
                    {item.label}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 w-full h-[1px] bg-[#ded8ce]" />
                    )}
                  </button>
                );
              })}

              {isAdminOrMod && (
                <button
                  onClick={() => handleTabClick('admin')}
                  aria-current={currentTab === 'admin' ? 'page' : undefined}
                  className={`flex items-center gap-1.5 text-[11px] tracking-[0.09em] 2xl:tracking-[0.12em] uppercase transition-colors relative py-1 cursor-pointer font-sans whitespace-nowrap shrink-0 ${
                    currentTab === 'admin'
                      ? 'text-[#e8909c] font-medium'
                      : 'text-[#c49298] hover:text-[#f2eee9]'
                  }`}
                  title={t('navAdmin')}
                >
                  <Shield className="w-3.5 h-3.5 text-[#821c2c] shrink-0" />
                  <span>{t('navAdmin')}</span>
                  {currentTab === 'admin' && (
                    <span className="absolute bottom-0 left-0 w-full h-[1px] bg-[#e8909c]" />
                  )}
                </button>
              )}
            </nav>
          </div>

          {/* Right tools: Language switch & Auth */}
          <div className="hidden xl:flex items-center gap-2.5 shrink-0">
            {/* Quick XP Shop button */}
            <button
              onClick={() => setShopOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] font-mono text-[#ded8ce] hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title={t('navShop')}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-[#821c2c] shrink-0" />
              <span>{t('navShop')}</span>
            </button>

            {/* Language Switcher */}
            <div className="flex items-center gap-1 font-mono text-xs border border-white/[0.08] rounded px-2 py-0.5 bg-[#100f13] shrink-0 whitespace-nowrap">
              <button
                onClick={() => setLang('ru')}
                className={`px-1 py-0.5 rounded transition-colors cursor-pointer ${
                  lang === 'ru' ? 'text-[#f2eee9] font-bold' : 'text-[#736c64] hover:text-[#ded8ce]'
                }`}
              >
                RU
              </button>
              <span className="text-[#3b3730]">/</span>
              <button
                onClick={() => setLang('en')}
                className={`px-1 py-0.5 rounded transition-colors cursor-pointer ${
                  lang === 'en' ? 'text-[#f2eee9] font-bold' : 'text-[#736c64] hover:text-[#ded8ce]'
                }`}
              >
                EN
              </button>
            </div>

            {/* User profile dropdown or Auth button */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className="flex items-center gap-2 p-1 pl-2 rounded-lg border border-white/[0.08] bg-[#100f13] hover:border-white/20 transition-all cursor-pointer"
                  aria-label="User profile menu"
                >
                  <div className={`w-6 h-6 rounded-full overflow-hidden bg-black ${user.equipped_frame || 'border border-white/10'}`}>
                    <img
                      src={user.avatar_url || '/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg'}
                      alt={user.nickname}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className={`text-xs max-w-[90px] truncate ${user.equipped_name_style || 'text-[#ded8ce]'}`}>
                    {user.nickname}
                  </span>
                  <span className="font-mono text-[9px] text-[#8e877e] px-1 bg-white/[0.04] rounded">
                    L{user.level}
                  </span>
                  <ChevronDown className="w-3 h-3 text-[#736c64]" />
                </button>

                {userDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-[#121115] border border-white/[0.08] rounded-xl shadow-2xl py-1 z-50 font-sans">
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <div className="text-xs font-medium text-white truncate">{user.display_name}</div>
                      <div className="font-mono text-[10px] text-[#8e877e]">
                        {user.xp} XP · {user.role_id}
                      </div>
                    </div>
                    <button
                      onClick={() => handleTabClick('profile')}
                      className="w-full text-left px-3 py-2 text-xs text-[#ded8ce] hover:bg-white/[0.04] flex items-center gap-2 cursor-pointer"
                    >
                      <User className="w-3.5 h-3.5 text-[#8e877e]" />
                      {t('navProfile')}
                    </button>
                    <button
                      onClick={() => {
                        setUserDropdownOpen(false);
                        setShopOpen(true);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[#ded8ce] hover:bg-white/[0.04] flex items-center gap-2 cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5 text-[#821c2c]" />
                      {t('navShop')}
                    </button>
                    {isAdminOrMod && (
                      <button
                        onClick={() => handleTabClick('admin')}
                        className="w-full text-left px-3 py-2 text-xs text-[#c49298] hover:bg-white/[0.04] flex items-center gap-2 cursor-pointer"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        {t('navAdmin')}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        logout();
                        setUserDropdownOpen(false);
                        if (currentTab === 'admin') {
                          onSelectTab('home');
                        }
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-[#8e877e] hover:text-[#d9777f] hover:bg-white/[0.04] flex items-center gap-2 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {t('navLogout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => openAuth('login')}
                className="font-mono text-xs tracking-wider uppercase px-3.5 py-1.5 border border-white/[0.12] hover:border-white/30 text-[#ded8ce] hover:text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {t('navLogin')}
              </button>
            )}
          </div>

          {/* Mobile menu trigger */}
          <div className="flex xl:hidden items-center gap-2 shrink-0">
            <button
              onClick={() => setShopOpen(true)}
              className="p-1.5 text-[#ded8ce] hover:text-white cursor-pointer"
              title={t('navShop')}
              aria-label={t('navShop')}
            >
              <ShoppingBag className="w-4 h-4 text-[#821c2c]" />
            </button>
            <button
              onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
              className="font-mono text-[10px] px-2 py-1 border border-white/[0.08] rounded text-[#8e877e]"
            >
              {lang.toUpperCase()}
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 text-[#8e877e] hover:text-white focus:outline-none cursor-pointer"
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="xl:hidden bg-[#0c0b0e] border-b border-white/[0.08] px-4 pt-3 pb-6 space-y-2.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className={`block w-full text-left font-mono text-xs tracking-[0.16em] uppercase py-2 border-b border-white/[0.04] ${
                  currentTab === item.id ? 'text-white font-semibold' : 'text-[#8e877e]'
                }`}
              >
                {item.label}
              </button>
            ))}

            {isAdminOrMod && (
              <button
                onClick={() => handleTabClick('admin')}
                className="flex items-center gap-2 w-full text-left text-xs tracking-[0.16em] uppercase py-2 border-b border-white/[0.04] text-[#c49298] font-semibold"
              >
                <Shield className="w-3.5 h-3.5 text-[#821c2c]" />
                <span>{t('navAdmin')}</span>
              </button>
            )}

            <div className="pt-2">
              {user ? (
                <div className="space-y-2">
                  <button
                    onClick={() => handleTabClick('profile')}
                    className="flex items-center gap-2 w-full text-left py-2 text-xs text-[#ded8ce]"
                  >
                    <User className="w-3.5 h-3.5 text-[#8e877e]" />
                    {user.display_name} ({t('navProfile')})
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setShopOpen(true);
                    }}
                    className="flex items-center gap-2 w-full text-left py-2 text-xs text-[#ded8ce]"
                  >
                    <ShoppingBag className="w-3.5 h-3.5 text-[#821c2c]" />
                    {t('navShop')}
                  </button>
                  <button
                    onClick={() => {
                      logout();
                      setMobileMenuOpen(false);
                      if (currentTab === 'admin') {
                        onSelectTab('home');
                      }
                    }}
                    className="flex items-center gap-2 w-full text-left py-2 text-xs text-[#8e877e]"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    {t('navLogout')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    openAuth('login');
                    setMobileMenuOpen(false);
                  }}
                  className="w-full text-center py-2 font-mono text-xs tracking-wider uppercase border border-white/[0.12] text-[#ded8ce] rounded-lg"
                >
                  {t('navLogin')}
                </button>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  );
};
