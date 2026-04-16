'use client';

import { motion } from 'framer-motion';

interface HardwareLinkProps {
  isConnected: boolean;
}

export default function HardwareLink({ isConnected }: HardwareLinkProps) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Glowing LED */}
      <div className="relative">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected ? 'bg-emerald-400' : 'bg-red-400'
          }`}
        />
        <motion.div
          className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${
            isConnected ? 'bg-emerald-400' : 'bg-red-400'
          }`}
          animate={{
            scale: [1, 2.2, 1],
            opacity: [0.6, 0, 0.6],
          }}
          transition={{
            duration: isConnected ? 2 : 1.2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>
      <span className="text-[10px] font-semibold tracking-wider uppercase text-white/50">
        {isConnected ? 'Live' : 'Offline'}
      </span>
    </div>
  );
}
