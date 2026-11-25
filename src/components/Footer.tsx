import React from 'react';
import { useI18n } from '../context/I18nContext.js';
import { Send, Bot, Mail, ShieldAlert } from 'lucide-react';

export const Footer: React.FC = () => {
  const { t, lang } = useI18n();

  return (
    <footer className="w-full bg-[#060608] border-t border-white/[0.08] pt-12 pb-24 sm:pb-20 text-[#827a74] text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6 pb-8 border-b border-white/[0.06]">
          <div className="text-xs tracking-[0.18em] uppercase text-[#a39b8b] font-sans">
            {lang === 'ru' ? 'Связь и ресурсы архива' : 'Archive Contacts & Links'}
          </div>

          {/* Real Project Contacts: Telegram channel, Archive bot, and Email */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://t.me/apostlesofdeathmarried"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 border border-white/[0.1] bg-[#0c0b0e] hover:border-white/[0.25] text-[#ded8ce] text-xs uppercase tracking-wider transition-colors rounded cursor-pointer"
              aria-label="Telegram Channel"
            >
              <Send className="w-3.5 h-3.5 text-[#c49298]" />
              <span>{t('channel')}</span>
            </a>
            <a
              href="https://t.me/deathmrd_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 border border-white/[0.1] bg-[#0c0b0e] hover:border-white/[0.25] text-[#ded8ce] text-xs uppercase tracking-wider transition-colors rounded cursor-pointer"
              aria-label="Telegram Bot"
            >
              <Bot className="w-3.5 h-3.5 text-[#c49298]" />
              <span>{t('bot')}</span>
            </a>
            <a
              href="mailto:deathmarriedthoughts@gmail.com"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 border border-white/[0.1] bg-[#0c0b0e] hover:border-white/[0.25] text-[#ded8ce] text-xs uppercase tracking-wider transition-colors rounded cursor-pointer"
              aria-label="Email"
            >
              <Mail className="w-3.5 h-3.5 text-[#c49298]" />
              <span>{t('emailContact')}</span>
            </a>
          </div>
        </div>

        {/* Legal & DMCA Notice */}
        <div data-nosnippet="" className="space-y-2 text-center md:text-left max-w-4xl">
          <div className="flex items-center justify-center md:justify-start gap-1.5 text-[11px] text-[#a84450] tracking-wider uppercase">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>DISCLAIMER & DMCA</span>
          </div>
          <p className="text-xs leading-relaxed text-[#827a74]">
            {t('disclaimer')} DMCA notices & copyright requests: deathmarriedthoughts@gmail.com.
          </p>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono text-[#736c64] tracking-wider uppercase text-center sm:text-left">
          <div>© {new Date().getFullYear()} · {lang === 'ru' ? 'Некоммерческий музыкальный архив' : 'Non-commercial music archive'}</div>
          <div>{lang === 'ru' ? 'Дискография, творчество и сообщество' : 'Discography, community & creations'}</div>
        </div>
      </div>
    </footer>
  );
};

