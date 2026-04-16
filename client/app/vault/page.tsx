'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MemoryCard from '@/src/components/MemoryCard';
import SearchInput from '@/src/components/SearchInput';
import MemoryDrawer from '@/src/components/MemoryDrawer';
import ErrorBoundary from '@/src/components/ErrorBoundary';
import { Archive, Filter, Database, BrainCircuit } from 'lucide-react';

const FILTERS = ['All', 'Task', 'Idea', 'Fact'] as const;

function VaultPage() {
  const [memories, setMemories] = useState<any[]>([]);
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedMemory, setSelectedMemory] = useState<any | null>(null);

  // Debounce Search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const fetchMemories = useCallback(async () => {
    try {
      setLoading(true);
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const params = new URLSearchParams();
      if (filter !== 'All') params.append('category', filter);
      if (debouncedQuery) params.append('q', debouncedQuery);

      const res = await fetch(`${apiUrl}/api/memories?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (err) {
      console.warn('[Vault] Could not load memories:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQuery]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  return (
    <div className="relative z-10 min-h-screen px-6 pt-16 pb-36">
      <div className="max-w-6xl mx-auto">
        {/* Header & Search */}
        <div className="mb-10 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-2xl bg-[#c799ff]/10 flex items-center justify-center">
              <Database className="w-5 h-5 text-[#c799ff]" />
            </div>
            <div>
              <h1 className="text-display text-2xl font-bold">Memory Vault</h1>
              <p className="text-xs text-white/40 mt-1">High-density neural retrieval</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="max-w-md"
          >
            <SearchInput 
              value={searchQuery} 
              onChange={setSearchQuery} 
              isLoading={loading && !!searchQuery} 
            />
          </motion.div>
        </div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex items-center gap-2 mb-8 flex-wrap"
        >
          <Filter className="w-3.5 h-3.5 text-white/20 mr-1" />
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-wider uppercase transition-all duration-300 ${
                filter === f
                  ? 'bg-white/10 text-white border border-[#c799ff]/40 shadow-[0_0_20px_rgba(199,153,255,0.15)] backdrop-blur-md'
                  : 'bg-white/5 text-white/30 border border-transparent hover:text-white/60 hover:bg-white/10'
              }`}
            >
              {f}
            </button>
          ))}
        </motion.div>

        {/* Masonry Grid */}
        {loading && memories.length === 0 ? (
          <motion.div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-5 space-y-5">
             {[...Array(6)].map((_, i) => (
                <div key={i} className="break-inside-avoid glass rounded-2xl h-40 animate-pulse bg-white/5 border border-white/5" />
             ))}
          </motion.div>
        ) : memories.length > 0 ? (
          <motion.div layout className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-5 space-y-5">
            <AnimatePresence mode="popLayout">
              {memories.map((m, i) => (
                <motion.div 
                   key={m.id} 
                   layoutId={m.id}
                   className="break-inside-avoid"
                >
                  <MemoryCard memory={m} index={i} onClick={() => setSelectedMemory(m)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-32 text-center"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-[#4af8e3]/10 blur-[40px] rounded-full" />
              <BrainCircuit className="w-16 h-16 text-white/10 mb-6 drop-shadow-2xl relative z-10" />
            </div>
            <h3 className="text-display text-xl font-semibold mb-2">Void State</h3>
            <p className="text-sm text-white/30 max-w-xs">
              {searchQuery 
                ? 'No neural signatures match this frequency. Modify your search vectors.' 
                : 'Your Vault is empty. Initialize the Orb to capture a new memory.'}
            </p>
          </motion.div>
        )}
      </div>

      <MemoryDrawer memory={selectedMemory} onClose={() => setSelectedMemory(null)} />
    </div>
  );
}

export default function VaultPageWrapper() {
  return (
    <ErrorBoundary>
      <VaultPage />
    </ErrorBoundary>
  );
}
