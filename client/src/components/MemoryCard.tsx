'use client';

import { motion } from 'framer-motion';
import { CheckCircle, Lightbulb, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Memory {
  id: string;
  title: string;
  summary: string;
  category: 'Task' | 'Fact' | 'Idea';
  importance: number;
  createdAt: string;
  nextActionDate?: string;
}

interface MemoryCardProps {
  memory: Memory;
  index?: number;
  onClick?: () => void;
}

const CATEGORY_MAP = {
  Task: { icon: CheckCircle, color: '#c799ff', label: 'Action' },
  Idea: { icon: Lightbulb, color: '#4af8e3', label: 'Spark' },
  Fact: { icon: Info, color: '#ff6c95', label: 'Knowledge' },
};

export default function MemoryCard({ memory, index = 0, onClick }: MemoryCardProps) {
  const meta = CATEGORY_MAP[memory.category] || CATEGORY_MAP.Fact;
  const Icon = meta.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 40, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: index * 0.06, type: 'spring', damping: 20 }}
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      onClick={onClick}
      className={`glass relative p-5 flex flex-col gap-4 group select-none ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {/* Category Pill */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: meta.color, boxShadow: `0 0 10px ${meta.color}60` }}
          />
          <span className="text-label text-white/30">{meta.label}</span>
        </div>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center opacity-40 group-hover:opacity-80 transition-opacity"
          style={{ backgroundColor: `${meta.color}15` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2">
        <h3 className="text-display text-base font-semibold leading-snug">{memory.title}</h3>
        <p className="text-[13px] text-white/45 leading-relaxed line-clamp-4">{memory.summary}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 opacity-30">
        <span className="text-[10px] font-medium">
          {formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}
        </span>
        <div className="flex gap-0.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: i <= memory.importance ? meta.color : 'rgba(255,255,255,0.1)' }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
