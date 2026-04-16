import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Share, Clock, FileText, CheckCircle, Info, Lightbulb, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const CATEGORY_MAP = {
  Task: { icon: CheckCircle, color: '#c799ff', label: 'Action' },
  Idea: { icon: Lightbulb, color: '#4af8e3', label: 'Spark' },
  Fact: { icon: Info, color: '#ff6c95', label: 'Knowledge' },
};

interface MemoryDrawerProps {
  memory: any;
  onClose: () => void;
}

export default function MemoryDrawer({ memory, onClose }: MemoryDrawerProps) {
  const [isRetrying, setIsRetrying] = useState(false);

  if (!memory) return null;

  const meta = CATEGORY_MAP[memory.category as 'Task' | 'Fact' | 'Idea'] || CATEGORY_MAP.Fact;

  const handleCopy = () => {
    navigator.clipboard.writeText(memory.summary);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: memory.title,
          text: memory.summary,
        });
        } catch (err) {
          console.warn('Share error', err);
        }
      } else {
        handleCopy();
      }
    };

    const handleRetry = async () => {
      setIsRetrying(true);
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const res = await fetch(`${apiUrl}/api/memories/${memory.id}/retry`, { method: 'POST' });
        if (res.ok) {
          // Ideally refresh parent list or rely on socket, 
          // For now simply close drawer so it re-fetches or user notices change
          onClose();
        }
      } catch (err) {
        console.error('Failed to retry extraction', err);
      } finally {
        setIsRetrying(false);
      }
    };

    return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="w-full max-w-2xl h-full bg-[#0a0a0a] border-l border-white/10 shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-white/5">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: meta.color, boxShadow: `0 0 10px ${meta.color}80` }}
                />
                <span className="text-xs tracking-widest uppercase font-semibold text-white/50">{meta.label}</span>
                <span className="text-white/20 px-1">•</span>
                <span className="text-xs text-white/40 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}
                </span>
              </div>
              <h2 className="text-display text-2xl font-bold leading-tight">{memory.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content Body: Side-by-Side on wide screens, stacked on small */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-8">
            
            {/* Left: Original Transcript */}
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2 text-[#c799ff]">
                <FileText className="w-4 h-4" />
                <h3 className="text-sm font-semibold tracking-wide uppercase">Raw Transcript</h3>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4 text-[13px] leading-relaxed text-white/50 break-words whitespace-pre-wrap">
                {memory.rawTranscript || "No raw transcript available."}
              </div>
            </div>

            {/* Right: Synthesis & Actions */}
            <div className="flex-1 space-y-6">
              
              {memory.title === 'Captured Memory' && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
                  <div className="text-red-400 text-xs">
                    <span className="font-semibold block mb-0.5">Classification Failed</span>
                    Neural extraction encountered an anomaly.
                  </div>
                  <button 
                    onClick={handleRetry} 
                    disabled={isRetrying}
                    className="flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    {isRetrying ? 'Retrying...' : 'Retry Extraction'}
                  </button>
                </div>
              )}

              <div className="space-y-4">
                <div className="flex items-center justify-between text-[#4af8e3]">
                  <div className="flex items-center gap-2">
                    <meta.icon className="w-4 h-4" />
                    <h3 className="text-sm font-semibold tracking-wide uppercase">AI Synthesis</h3>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white transition-all">
                      <Copy className="w-4 h-4" />
                    </button>
                    <button onClick={handleShare} className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white transition-all">
                      <Share className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="text-[14px] leading-relaxed text-white/80 p-2">
                  {memory.summary}
                </div>
              </div>

              {/* Action Items / Tags could go here */}
              <div className="pt-4 border-t border-white/5">
                <h3 className="text-xs font-semibold tracking-wide uppercase text-white/30 mb-3">Importance Score</h3>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((i) => {
                    const threshold = i / 5;
                    const isActive = memory.importance >= threshold - 0.1;
                    return (
                      <div
                        key={i}
                        className="h-2 flex-1 rounded-full"
                        style={{ backgroundColor: isActive ? meta.color : 'rgba(255,255,255,0.05)' }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
