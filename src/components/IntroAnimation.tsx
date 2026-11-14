import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useI18n } from '../context/I18nContext.js';

interface IntroAnimationProps {
  onComplete: () => void;
}

export const IntroAnimation: React.FC<IntroAnimationProps> = ({ onComplete }) => {
  const { lang } = useI18n();
  const [phase, setPhase] = useState<'dark' | 'reveal' | 'dissolve'>('dark');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sessionSeen = sessionStorage.getItem('apostles_intro_seen') === '1';

    if (params.get('autostart') === '1' || prefersReduced || sessionSeen) {
      onComplete();
      return;
    }

    sessionStorage.setItem('apostles_intro_seen', '1');

    const tReveal = setTimeout(() => {
      setPhase('reveal');
    }, 250);

    const tDissolve = setTimeout(() => {
      setPhase('dissolve');
    }, 1800);

    const tComplete = setTimeout(() => {
      onComplete();
    }, 2200);

    return () => {
      clearTimeout(tReveal);
      clearTimeout(tDissolve);
      clearTimeout(tComplete);
    };
  }, [onComplete]);

  const handleSkip = () => {
    sessionStorage.setItem('apostles_intro_seen', '1');
    onComplete();
  };

  return (
    <AnimatePresence>
      {phase !== 'dissolve' ? (
        <motion.div
          key="intro-curtain"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }}
          onClick={handleSkip}
          className="fixed inset-0 z-50 bg-[#08080a] flex flex-col items-center justify-center select-none overflow-hidden cursor-pointer"
          role="dialog"
          aria-label="Prologue"
        >
          {/* Subtle analog texture */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(35,32,38,0.3)_0%,rgba(8,8,10,0.95)_75%)] pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center text-center px-4 max-w-md">
            {/* Blended Rose canvas */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, filter: 'blur(6px)' }}
              animate={
                phase === 'reveal'
                  ? { opacity: 1, scale: 1, filter: 'blur(0px)' }
                  : { opacity: 0, scale: 0.94, filter: 'blur(6px)' }
              }
              transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-44 h-44 sm:w-52 sm:h-52 mb-6"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(75,25,35,0.25)_0%,transparent_70%)] blur-2xl" />
              <div
                className="w-full h-full relative mix-blend-lighten flex items-center justify-center"
                style={{
                  maskImage: 'radial-gradient(circle at 50% 50%, black 24%, rgba(0,0,0,0.72) 48%, transparent 76%)',
                  WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 24%, rgba(0,0,0,0.72) 48%, transparent 76%)',
                }}
              >
                <img
                  src="/assets/aistudio/photo_2026-09-21_19-56-44_8c854c0f.jpg"
                  alt="Apostles of deathmarried"
                  className="w-full h-full object-contain scale-[1.3] filter contrast-125 brightness-95"
                />
              </div>
            </motion.div>

            {/* Title */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={
                phase === 'reveal'
                  ? { opacity: 1, y: 0 }
                  : { opacity: 0, y: 8 }
              }
              transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
              className="space-y-1.5"
            >
              <h1 className="font-display text-xs sm:text-base tracking-[0.16em] sm:tracking-[0.35em] text-[#f0ede6] uppercase font-light break-words text-center px-3 max-w-full">
                APOSTLES OF DEATHMARRIED
              </h1>
              <p className="font-mono text-[10px] text-[#736c64] uppercase tracking-widest pt-2">
                {lang === 'ru' ? '[ нажмите для пропуска ]' : '[ click to skip ]'}
              </p>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

