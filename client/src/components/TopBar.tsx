'use client';

import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import HardwareLink from './HardwareLink';

interface TopBarProps {
  isConnected: boolean;
}

export default function TopBar({ isConnected }: TopBarProps) {
  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 left-0 right-0 z-40 px-5 pt-5"
    >
      <div className="glass-strong !rounded-full max-w-xl mx-auto flex items-center gap-4 px-5 py-2.5">
        {/* Brand Mark */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#c799ff] to-[#7c3aed] flex items-center justify-center shrink-0">
          <div className="w-2 h-2 bg-white rounded-full" />
        </div>

        {/* Search Capsule */}
        <div className="flex-1 relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 group-focus-within:text-[#c799ff] transition-colors" />
          <input
            type="text"
            placeholder="Search memories..."
            className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-9 pr-4 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-[#c799ff]/30 focus:bg-white/8 transition-all"
          />
        </div>

        {/* Hardware LED */}
        <HardwareLink isConnected={isConnected} />
      </div>
    </motion.header>
  );
}
