'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Brain, Zap, TrendingUp, Clock } from 'lucide-react';

interface Stats {
  total: number;
  tasks: number;
  ideas: number;
  facts: number;
  thisWeek: number;
}

function StatCard({ icon: Icon, label, value, color, delay }: {
  icon: any; label: string; value: string | number; color: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass p-6 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <span className="text-2xl font-bold text-display">{value}</span>
      </div>
      <span className="text-label text-white/30">{label}</span>
    </motion.div>
  );
}

function ActivityBar({ label, value, max, color, delay }: {
  label: string; value: number; max: number; color: string; delay: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-center gap-4"
    >
      <span className="text-xs text-white/30 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.2, duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-white/40 w-6 text-right">{value}</span>
    </motion.div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, tasks: 0, ideas: 0, facts: 0, thisWeek: 0 });
  const [memories, setMemories] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
        const res = await fetch(`${apiUrl}/api/memories`);
        if (res.ok) {
          const data = await res.json();
          const mems = data.memories || data || [];
          setMemories(mems);

          const now = new Date();
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          setStats({
            total: mems.length,
            tasks: mems.filter((m: any) => m.category === 'Task').length,
            ideas: mems.filter((m: any) => m.category === 'Idea').length,
            facts: mems.filter((m: any) => m.category === 'Fact').length,
            thisWeek: mems.filter((m: any) => new Date(m.createdAt) > weekAgo).length,
          });
        }
      } catch {
        // Silently handle — analytics page is non-critical
      }
    };
    fetchData();
  }, []);

  const maxCategory = Math.max(stats.tasks, stats.ideas, stats.facts, 1);

  // Build recent activity by day
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayCounts = dayLabels.map((_, i) => {
    const dayMemories = memories.filter((m) => {
      const d = new Date(m.createdAt);
      return d.getDay() === (i + 1) % 7;
    });
    return dayMemories.length;
  });
  const maxDay = Math.max(...dayCounts, 1);

  return (
    <div className="relative z-10 min-h-screen px-6 pt-16 pb-36">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-10"
        >
          <div className="w-10 h-10 rounded-2xl bg-[#4af8e3]/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-[#4af8e3]" />
          </div>
          <div>
            <h1 className="text-display text-2xl font-bold">Neural Insights</h1>
            <p className="text-xs text-white/30 mt-1">Your brain activity at a glance</p>
          </div>
        </motion.div>

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          <StatCard icon={Brain} label="Total Memories" value={stats.total} color="#c799ff" delay={0.1} />
          <StatCard icon={Zap} label="This Week" value={stats.thisWeek} color="#4af8e3" delay={0.15} />
          <StatCard icon={TrendingUp} label="Ideas Captured" value={stats.ideas} color="#4af8e3" delay={0.2} />
          <StatCard icon={Clock} label="Pending Tasks" value={stats.tasks} color="#ff6c95" delay={0.25} />
        </div>

        {/* Category Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass p-6 mb-6"
        >
          <h2 className="text-label text-white/30 mb-6">Topics Discussed</h2>
          <div className="flex flex-col gap-4">
            <ActivityBar label="Tasks" value={stats.tasks} max={maxCategory} color="#c799ff" delay={0.35} />
            <ActivityBar label="Ideas" value={stats.ideas} max={maxCategory} color="#4af8e3" delay={0.4} />
            <ActivityBar label="Facts" value={stats.facts} max={maxCategory} color="#ff6c95" delay={0.45} />
          </div>
        </motion.div>

        {/* Weekly Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="glass p-6"
        >
          <h2 className="text-label text-white/30 mb-6">Weekly Activity</h2>
          <div className="flex items-end justify-between gap-2 h-32">
            {dayLabels.map((day, i) => (
              <div key={day} className="flex flex-col items-center gap-2 flex-1">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(dayCounts[i] / maxDay) * 100}%` }}
                  transition={{ delay: 0.6 + i * 0.05, duration: 0.6, ease: 'easeOut' }}
                  className="w-full max-w-[32px] rounded-lg bg-gradient-to-t from-[#c799ff]/40 to-[#4af8e3]/30 min-h-[4px]"
                />
                <span className="text-[9px] text-white/25 font-medium">{day}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
