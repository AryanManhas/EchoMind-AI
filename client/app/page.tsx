'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMicrophone } from '@/hooks/useMicrophone';
import NeuralOrb from '@/src/components/NeuralOrb';
import MemoryCard from '@/src/components/MemoryCard';
import TopBar from '@/src/components/TopBar';
import BackendSyncStatus from '@/src/components/BackendSyncStatus';
import { useBackendSync } from '@/hooks/useBackendSync';

export default function CapturePage() {
  const [memories, setMemories] = useState<any[]>([]);
  
  // Backend Sync Hook
  const syncService = useBackendSync();

  const { active, audioLevel, isThinking, error, isConnected, startCapture, stopCapture } =
    useMicrophone((m) => {
      setMemories((prev) => [m, ...prev]);
      
      // Enqueue for backend sync
      syncService.enqueueSync(`memory_${m.id}`, 'memory', m).catch(console.error);
    });

  const handleToggle = () => (active ? stopCapture() : startCapture());

  const orbStatus = error ? 'error' as const : isThinking ? 'thinking' as const : active ? 'active' as const : undefined;

  return (
    <>
      <TopBar isConnected={isConnected} />

      <div className="relative z-10 flex flex-col items-center w-full min-h-screen px-6 pt-28 pb-36">
        {/* ── The Capture Nexus ── */}
        <section className="flex flex-col items-center mt-8 mb-16 relative">
          <AnimatePresence>
            {active && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute -top-12 flex items-center gap-3 bg-red-500/10 border border-red-500/20 px-4 py-1.5 rounded-full"
              >
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-semibold text-red-400 tracking-wide uppercase">Meeting Active</span>
                <div className="w-px h-3 bg-red-500/20 mx-1" />
                <span className="text-xs text-red-400/80">3 Participants</span>
              </motion.div>
            )}
          </AnimatePresence>
          
          <NeuralOrb
            isRecording={active}
            audioLevel={audioLevel}
            isThinking={isThinking}
            status={orbStatus}
            onToggle={handleToggle}
          />

          <AnimatePresence>
            {isThinking && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -bottom-10 flex gap-2"
              >
                <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] text-blue-300">
                  Extracting Action Items...
                </div>
                <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300">
                  Identifying Deadlines...
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="glass-subtle flex flex-col items-center justify-center py-20 px-8 max-w-md mx-auto text-center transition-all"
          >
            <div className="w-14 h-14 rounded-2xl bg-[#c799ff]/10 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(199,153,255,0.1)]">
              <div className="w-3 h-3 rounded-full bg-[#c799ff]/50 shadow-[0_0_10px_rgba(199,153,255,0.5)] animate-pulse" />
            </div>
            <p className="text-[15px] font-medium text-white/40 tracking-wide">
              EchoMind is ready to listen.
            </p>
            <p className="text-sm text-white/20 mt-2">
              Your conversations will appear here.
            </p>
          </motion.div>
        )}

        {/* ── Validation UI: Backend Sync Status ── */}
        <BackendSyncStatus 
          syncState={syncService} 
          onForceReconnect={syncService.forceReconnect} 
        />
      </div>
    </>
  );
}
