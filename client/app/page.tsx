'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMicrophone } from '@/hooks/useMicrophone';
import NeuralOrb from '@/src/components/NeuralOrb';
import MemoryCard from '@/src/components/MemoryCard';
import TopBar from '@/src/components/TopBar';

export default function CapturePage() {
  const [memories, setMemories] = useState<any[]>([]);
  const { active, audioLevel, isThinking, error, isConnected, startCapture, stopCapture } =
    useMicrophone((m) => setMemories((prev) => [m, ...prev]));

  const handleToggle = () => (active ? stopCapture() : startCapture());

  const orbStatus = error ? 'error' as const : isThinking ? 'thinking' as const : active ? 'active' as const : undefined;

  return (
    <>
      <TopBar isConnected={isConnected} />

      <div className="relative z-10 flex flex-col items-center w-full min-h-screen px-6 pt-28 pb-36">
        {/* ── The Capture Nexus ── */}
        <section className="flex flex-col items-center mt-8 mb-20">
          <NeuralOrb
            isRecording={active}
            audioLevel={audioLevel}
            isThinking={isThinking}
            status={orbStatus}
            onToggle={handleToggle}
          />
        </section>

        {/* ── Recent Captures ── */}
        {memories.length > 0 && (
          <section className="w-full max-w-2xl mx-auto">
            {/* The Stitch Card (Latest) */}
            <div className="mb-12">
              <div className="flex items-center gap-4 mb-6">
                <h2 className="text-label text-white/30">Just Captured</h2>
                <div className="h-px flex-1 bg-gradient-to-r from-[#c799ff]/30 to-transparent" />
              </div>
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={memories[0].id}
                  initial={{ opacity: 0, y: 100, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 100 }}
                  className="relative"
                >
                  <div className="absolute -inset-4 bg-[#c799ff]/5 blur-3xl rounded-full" />
                  <MemoryCard memory={memories[0]} />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Past Memories */}
            {memories.length > 1 && (
              <>
                <div className="flex items-center gap-4 mb-8">
                  <h2 className="text-label text-white/30">Past Memories</h2>
                  <div className="h-px flex-1 bg-gradient-to-r from-white/8 to-transparent" />
                </div>
                <motion.div layout className="flex flex-col gap-4">
                  <AnimatePresence mode="popLayout">
                    {memories.slice(1, 5).map((m, i) => (
                      <MemoryCard key={m.id} memory={m} index={i} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              </>
            )}
          </section>
        )}

        {/* ── Empty State ── */}
        {memories.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="glass-subtle flex flex-col items-center justify-center py-20 px-8 max-w-md mx-auto text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#c799ff]/8 flex items-center justify-center mb-6">
              <div className="w-3 h-3 rounded-full bg-[#c799ff]/30" />
            </div>
            <p className="text-label text-white/20 leading-loose">
              Tap the orb to begin capturing
            </p>
          </motion.div>
        )}
      </div>
    </>
  );
}
