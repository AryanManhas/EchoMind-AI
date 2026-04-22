"use client";

import React, { useState, useEffect } from "react";
import { memoryService, Memory } from "../services/memoryService";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle, Lightbulb, BookOpen, Layers } from "lucide-react";

type TabType = "All" | "Task" | "Fact" | "Idea";

const TABS: { label: string; value: TabType; icon: React.ReactNode }[] = [
  { label: "All Memories", value: "All", icon: <Layers className="w-4 h-4" /> },
  { label: "Tasks", value: "Task", icon: <CheckCircle className="w-4 h-4" /> },
  { label: "Facts", value: "Fact", icon: <BookOpen className="w-4 h-4" /> },
  { label: "Ideas", value: "Idea", icon: <Lightbulb className="w-4 h-4" /> },
];

export function MemoryVault() {
  const [activeTab, setActiveTab] = useState<TabType>("All");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchMemories() {
      setLoading(true);
      setError(null);
      try {
        // Fetch memories filtered by the selected category from the backend
        const data = await memoryService.fetchAllMemories(undefined, activeTab);
        if (isMounted) {
          setMemories(data);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load memories");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchMemories();

    return () => {
      isMounted = false;
    };
  }, [activeTab]);

  const getBadgeColor = (category: string) => {
    switch (category?.toLowerCase()) {
      case "task":
        return "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20";
      case "idea":
        return "bg-amber-500/10 text-amber-400 ring-amber-500/20";
      case "fact":
        return "bg-blue-500/10 text-blue-400 ring-blue-500/20";
      default:
        return "bg-indigo-500/10 text-indigo-400 ring-indigo-500/20";
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto p-6 md:p-8 font-sans">
      
      {/* Header and Tabs */}
      <div className="mb-10 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white mb-2">Memory Vault</h2>
            <p className="text-neutral-400">Browse and filter all your extracted knowledge.</p>
          </div>
        </div>

        {/* Custom Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar pb-2">
          <div className="flex space-x-2 bg-neutral-900/50 p-1.5 rounded-2xl ring-1 ring-white/10 backdrop-blur-md">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 outline-none ${
                    isActive ? "text-white" : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-tab-indicator"
                      className="absolute inset-0 bg-neutral-800 rounded-xl shadow-sm ring-1 ring-white/10"
                      initial={false}
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    {tab.icon}
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center mb-8">
          {error}
        </div>
      )}

      {/* Memories Grid */}
      <div className="relative min-h-[400px]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : memories.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500"
          >
            <Layers className="w-12 h-12 mb-4 opacity-20" />
            <p>No memories found in this category.</p>
          </motion.div>
        ) : (
          <motion.div 
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {memories.map((memory, index) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  transition={{ 
                    duration: 0.3,
                    delay: index * 0.05,
                    layout: { type: "spring", bounce: 0.2, duration: 0.6 }
                  }}
                  key={memory.id}
                  className="group bg-neutral-900 border border-white/5 rounded-2xl p-6 hover:bg-neutral-800/80 transition-all duration-300 flex flex-col hover:shadow-xl hover:ring-1 hover:ring-white/10"
                >
                  <div className="flex justify-between items-start mb-4 gap-4">
                    <h3 className="text-lg font-semibold text-neutral-100 line-clamp-2 leading-tight group-hover:text-white transition-colors">
                      {memory.title}
                    </h3>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${getBadgeColor(memory.category)}`}>
                      {memory.category}
                    </span>
                  </div>
                  
                  <p className="text-neutral-400 leading-relaxed text-sm line-clamp-4 flex-grow mb-6">
                    {memory.summary}
                  </p>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-auto">
                    <span className="text-xs text-neutral-500 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${memory.importance > 0.7 ? 'bg-red-400' : memory.importance > 0.4 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      Importance: {Math.round(memory.importance * 100)}%
                    </span>
                    {memory.createdAt && (
                      <span className="text-xs text-neutral-500">
                        {new Date(memory.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
