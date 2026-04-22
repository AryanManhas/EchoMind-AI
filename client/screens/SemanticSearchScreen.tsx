"use client";

import React, { useState, KeyboardEvent } from "react";
import { Search, Loader2, Sparkles, BrainCircuit } from "lucide-react";
import { useSemanticSearch } from "../hooks/useSemanticSearch";
import { motion, AnimatePresence } from "framer-motion";

export function SemanticSearchScreen() {
  const [inputValue, setInputValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  // We pass submittedQuery to the hook so it only searches when explicitly requested,
  // bypassing the "search as you type" behavior if we just used inputValue.
  const { memories, loading, error } = useSemanticSearch(submittedQuery, 10, 0);

  const handleSearch = () => {
    if (inputValue.trim()) {
      setSubmittedQuery(inputValue);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 md:p-12 font-sans selection:bg-indigo-500/30">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header section */}
        <header className="space-y-4 text-center">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-2xl ring-1 ring-indigo-500/20 mb-4"
          >
            <BrainCircuit className="w-8 h-8 text-indigo-400" />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-br from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent"
          >
            Semantic Memory Search
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-neutral-400 text-lg max-w-xl mx-auto"
          >
            Find exactly what you're looking for, even if you don't remember the exact words.
          </motion.p>
        </header>

        {/* Search Bar */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="relative group max-w-2xl mx-auto"
        >
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500"></div>
          <div className="relative flex items-center bg-neutral-900 ring-1 ring-white/10 rounded-2xl overflow-hidden shadow-2xl transition-all focus-within:ring-indigo-500/50">
            <div className="pl-6">
              <Search className="w-5 h-5 text-neutral-400" />
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What are you trying to remember?"
              className="w-full bg-transparent border-none py-5 px-4 text-lg text-white placeholder-neutral-500 focus:outline-none"
            />
            <button
              onClick={handleSearch}
              disabled={loading || !inputValue.trim()}
              className="mr-3 px-6 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span>Search</span>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </button>
          </div>
        </motion.div>

        {/* Error State */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-center max-w-2xl mx-auto space-y-3"
          >
            <p className="font-semibold text-lg">Search Unavailable</p>
            <p>{error}</p>
            <div className="bg-red-500/10 p-3 rounded-xl text-sm border border-red-500/20 inline-block text-left">
              <p className="font-medium text-red-300 mb-1">💡 Hint for existing data:</p>
              <p className="opacity-90">If you are trying to search through historical memories, make sure you've generated their vector embeddings by running the backfill script on your backend server:</p>
              <code className="block bg-red-950/50 px-3 py-2 rounded-lg mt-2 text-red-200 font-mono text-xs">
                npx ts-node server/src/scripts/backfill_embeddings.ts
              </code>
            </div>
          </motion.div>
        )}

        {/* Results Section */}
        <div className="space-y-6">
          {submittedQuery && !loading && memories.length === 0 && !error && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-neutral-500 py-12"
            >
              No memories found matching that conceptual meaning.
            </motion.div>
          )}

          <AnimatePresence>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {memories.map((memory, index) => (
                <motion.div
                  key={memory.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  className="group relative bg-neutral-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:bg-neutral-800/50 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/5"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                  
                  <div className="relative z-10 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xl font-semibold text-neutral-100 line-clamp-2">
                        {memory.title}
                      </h3>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 ring-1 ring-inset ring-indigo-500/20 whitespace-nowrap ml-4">
                        {(memory.similarity ? (memory.similarity * 100).toFixed(0) : 100)}% Match
                      </span>
                    </div>
                    
                    <p className="text-neutral-400 leading-relaxed text-sm line-clamp-3 mb-6 flex-grow">
                      {memory.summary}
                    </p>
                    
                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                      <span className="text-xs text-neutral-500">
                        {memory.category}
                      </span>
                      {memory.createdAt && (
                        <span className="text-xs text-neutral-500">
                          {new Date(memory.createdAt).toLocaleDateString(undefined, { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
