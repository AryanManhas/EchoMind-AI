'use client';

interface Memory {
  id: string;
  title: string;
  summary: string;
  category: 'Task' | 'Fact' | 'Idea';
  importance: number;
  createdAt: string;
  nextActionDate?: string;
}

const CATEGORY_STYLES: Record<Memory['category'], { badge: string; dot: string; glow: string }> = {
  Task: {
    badge: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    dot:   'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]',
    glow:  'hover:shadow-[0_0_20px_rgba(96,165,250,0.15)]',
  },
  Fact: {
    badge: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    dot:   'bg-purple-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]',
    glow:  'hover:shadow-[0_0_20px_rgba(167,139,250,0.15)]',
  },
  Idea: {
    badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    dot:   'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
    glow:  'hover:shadow-[0_0_20px_rgba(52,211,153,0.15)]',
  },
};

const IMPORTANCE_BARS = 5;

export default function MemoryCard({ memory }: { memory: Memory }) {
  const style  = CATEGORY_STYLES[memory.category] ?? CATEGORY_STYLES.Fact;
  const filled = Math.round((memory.importance / 10) * IMPORTANCE_BARS);

  const timeLabel = new Date(memory.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={`glass relative overflow-hidden rounded-2xl p-4 flex flex-col gap-2 border border-white/10
        transition-shadow duration-300 ${style.glow}`}
    >
      {/* Shimmer sweep on mount */}
      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/[0.03] to-white/0
        -translate-x-full animate-[shimmer_1.2s_ease-out_forwards] pointer-events-none" />

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
          <span className="font-semibold text-sm leading-tight line-clamp-1">{memory.title}</span>
        </div>

        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${style.badge}`}>
          {memory.category}
        </span>
      </div>

      {/* Summary */}
      <p className="text-xs text-white/50 leading-relaxed line-clamp-2 pl-4">
        {memory.summary}
      </p>

      {/* Footer: importance bars + timestamp */}
      <div className="flex items-center justify-between pt-1 pl-4">
        {/* Importance dots */}
        <div className="flex gap-[3px]" aria-label={`Importance ${memory.importance}/10`}>
          {Array.from({ length: IMPORTANCE_BARS }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i < filled ? 'bg-white/60' : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Next action date for Tasks */}
        {memory.category === 'Task' && memory.nextActionDate && (
          <span className="text-[10px] text-blue-300/60">
            Due {new Date(memory.nextActionDate).toLocaleDateString()}
          </span>
        )}

        <span className="text-[10px] text-white/30">{timeLabel}</span>
      </div>
    </div>
  );
}
