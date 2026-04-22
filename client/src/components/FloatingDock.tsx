'use client';

import { motion } from 'framer-motion';
import { Mic, Library, Settings, Search, Database } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { id: 'capture', icon: Mic, path: '/', label: 'Capture' },
  { id: 'search', icon: Search, path: '/search', label: 'Search' },
  { id: 'memory-vault', icon: Database, path: '/memory-vault', label: 'Memories' },
  { id: 'vault', icon: Library, path: '/vault', label: 'Archive' },
  { id: 'settings', icon: Settings, path: '/settings', label: 'Setup' },
];


export default function FloatingDock() {
  const pathname = usePathname();

  const handleTabClick = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  return (
    <div className="fixed bottom-8 left-0 right-0 z-50 flex justify-center px-6 pointer-events-none">
      <motion.nav 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="glass p-2 flex items-center gap-1 pointer-events-auto shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-white/5"
      >
        {TABS.map((tab) => {
          const isActive = pathname === tab.path;
          return (
            <Link 
              key={tab.id} 
              href={tab.path}
              onClick={handleTabClick}
              className="relative p-3 px-6 md:px-8 rounded-2xl transition-all duration-300 group overflow-hidden"
            >
              {isActive && (
                <motion.div
                  layoutId="active-tab"
                  className="absolute inset-0 bg-[#c799ff]/10 border border-[#c799ff]/20 rounded-2xl"
                  transition={{ type: 'spring', damping: 15, stiffness: 200 }}
                />
              )}
              
              <div className="relative flex flex-col items-center gap-1">
                <tab.icon 
                  className={`w-6 h-6 transition-all duration-300 ${
                    isActive ? 'text-[#c799ff] scale-110' : 'text-white/30 group-hover:text-white/60'
                  }`}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                <span className={`text-[10px] font-bold tracking-widest transition-all duration-300 ${
                  isActive ? 'text-[#c799ff] opacity-100' : 'text-white/20 group-hover:text-white/40'
                }`}>
                  {tab.label.toUpperCase()}
                </span>
              </div>
            </Link>
          );
        })}
      </motion.nav>
    </div>
  );
}
