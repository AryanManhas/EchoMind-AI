'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Mic } from 'lucide-react';
import { useMemo } from 'react';

interface NeuralOrbProps {
  isRecording: boolean;
  audioLevel: number;
  isThinking: boolean;
  status?: 'active' | 'thinking' | 'error';
  onToggle: () => void;
}

export default function NeuralOrb({ isRecording, audioLevel, isThinking, status, onToggle }: NeuralOrbProps) {
  const isActive = status === 'active' || isRecording;
  const effectiveThinking = status === 'thinking' || isThinking;
  const isError = status === 'error';
  const amp = Math.min(audioLevel, 100) / 100;

  const statusText = isError ? 'Connection Failed.' 
    : effectiveThinking ? 'Extracting memories...' 
    : isActive ? 'Listening...' 
    : 'Ready for capture.';

  // Generate multi-layered liquid wave paths
  const layers = useMemo(() => {
    const generatePath = (phase: number, freq: number, amplitude: number) => {
      const points: string[] = [];
      const segments = 60;
      const w = 300;
      const midY = 150;
      for (let i = 0; i <= segments; i++) {
        const x = (i / segments) * w;
        const y = midY + Math.sin((i / segments) * Math.PI * 2 * freq + phase) * amplitude;
        points.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
      }
      return points.join(' ');
    };

    const baseAmp = isActive ? 15 + amp * 40 : 6;
    return [
      generatePath(0, 2, baseAmp),
      generatePath(Math.PI / 2, 1.5, baseAmp * 0.8),
      generatePath(Math.PI, 2.5, baseAmp * 0.6),
    ];
  }, [isActive, amp]);

  return (
    <div className="flex flex-col items-center gap-12 no-select no-tap-highlight">
      {/* ── The Orb Container ── */}
      <motion.button
        onClick={onToggle}
        whileTap={{ scale: 0.92 }}
        className="relative w-[320px] h-[320px] rounded-full cursor-pointer outline-none group"
      >
        {/* Nerve Glow — pulsating outer ring */}
        <motion.div
          className="absolute -inset-8 rounded-full border border-[#c799ff]/20 bg-[#c799ff]/5"
          animate={{
            scale: isActive ? [1, 1.1, 1] : 1,
            opacity: isActive ? [0.1, 0.3, 0.1] : 0.05,
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        {/* Breathing Animation Wrapper */}
        <motion.div
          className="w-full h-full relative"
          animate={{
            scale: isActive ? [1, 1.02, 1] : [1, 1.01, 1],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* Glass Shell */}
          <div
            className="absolute inset-0 rounded-full glass-strong overflow-hidden flex items-center justify-center border-white/10 shadow-2xl"
            style={{
              boxShadow: isActive
                ? '0 0 80px rgba(139, 92, 246, 0.3), inset 0 2px 10px rgba(255,255,255,0.1)'
                : '0 0 20px rgba(139, 92, 246, 0.05), inset 0 1px 5px rgba(255,255,255,0.05)',
            }}
          >
            {/* Liquid Waves SVG */}
            <svg
              viewBox="0 0 300 300"
              className="absolute inset-0 w-full h-full opacity-60"
              preserveAspectRatio="none"
            >
              <defs>
                <filter id="wave-blur">
                  <feGaussianBlur stdDeviation="2" />
                </filter>
                <linearGradient id="wave-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#c799ff" stopOpacity="0" />
                  <stop offset="50%" stopColor="#c799ff" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#c799ff" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="wave-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4af8e3" stopOpacity="0" />
                  <stop offset="50%" stopColor="#4af8e3" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#4af8e3" stopOpacity="0" />
                </linearGradient>
              </defs>

              {layers.map((path, i) => (
                <motion.path
                  key={i}
                  d={path}
                  fill="none"
                  stroke={i % 2 === 0 ? 'url(#wave-grad-1)' : 'url(#wave-grad-2)'}
                  strokeWidth={isActive ? 4 - i : 2}
                  filter="url(#wave-blur)"
                  animate={{ 
                    translateX: isActive ? [0, -20, 0] : 0,
                    translateY: isActive ? [i * 5, -i * 5, i * 5] : 0 
                  }}
                  transition={{ 
                    duration: 3 + i, 
                    repeat: Infinity, 
                    ease: 'easeInOut' 
                  }}
                />
              ))}
            </svg>

            {/* Prismatic Fluid Overlay */}
            <AnimatePresence>
              {isActive && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.25 + amp * 0.4 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 rounded-full bg-gradient-to-br from-[#c799ff]/20 via-[#4af8e3]/10 to-transparent mix-blend-screen"
                />
              )}
            </AnimatePresence>

            {/* Core Mic UI */}
            <motion.div
              className="relative z-10 flex flex-col items-center justify-center gap-2"
              animate={{
                scale: isActive ? [1, 1.05, 1] : 1,
              }}
              transition={{ duration: 2, repeat: isActive ? Infinity : 0 }}
            >
              <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center border border-white/10 backdrop-blur-md">
                <Mic 
                  className={`w-10 h-10 transition-colors duration-500 ${isActive ? 'text-[#c799ff]' : 'text-white/20'}`} 
                  strokeWidth={1.5} 
                />
              </div>
            </motion.div>

            {/* Thinking Spinner */}
            <AnimatePresence>
              {effectiveThinking && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 360 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ rotate: { repeat: Infinity, duration: 3, ease: 'linear' } }}
                  className="absolute inset-8 border border-dashed border-[#c799ff]/40 rounded-full"
                />
              )}
            </AnimatePresence>

            {/* Glint */}
            <div className="absolute top-[12%] left-[18%] w-[28%] h-[14%] bg-white/15 blur-[12px] rounded-full rotate-[-25deg] pointer-events-none" />
          </div>
        </motion.div>
      </motion.button>

      {/* ── Contextual Status Bar ── */}
      <motion.div
        key={statusText}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className={`w-1.5 h-1.5 rounded-full ${
          isError ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]'
          : isActive ? 'bg-[#4af8e3] shadow-[0_0_8px_rgba(74,248,227,0.6)]'
          : 'bg-white/20'
        }`} />
        <span className="text-label text-white/40">{statusText}</span>
      </motion.div>
    </div>
  );
}
