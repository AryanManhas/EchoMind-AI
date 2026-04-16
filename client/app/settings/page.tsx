'use client';

import { motion } from 'framer-motion';
import { Settings, Bluetooth, Wifi, Volume2, Moon, Info } from 'lucide-react';

function SettingRow({ icon: Icon, label, value, color }: {
  icon: any; label: string; value: string; color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="w-4 h-4 text-white/30" />
        <span className="text-sm text-white/60">{label}</span>
      </div>
      <span className="text-xs font-medium" style={{ color: color || 'rgba(255,255,255,0.3)' }}>
        {value}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="relative z-10 min-h-screen px-6 pt-16 pb-36">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-10"
        >
          <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center">
            <Settings className="w-5 h-5 text-white/50" />
          </div>
          <h1 className="text-display text-2xl font-bold">Settings</h1>
        </motion.div>

        {/* Hardware Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass p-6 mb-5"
        >
          <h2 className="text-label text-white/30 mb-4">Hardware</h2>
          <SettingRow icon={Bluetooth} label="Audio Input" value="Default Microphone" />
          <SettingRow icon={Wifi} label="WebSocket Server" value="ws://localhost:8080" />
          <SettingRow icon={Volume2} label="Sample Rate" value="16kHz" />
        </motion.div>

        {/* Appearance Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass p-6 mb-5"
        >
          <h2 className="text-label text-white/30 mb-4">Appearance</h2>
          <SettingRow icon={Moon} label="Theme" value="Celestial Dark" color="#c799ff" />
        </motion.div>

        {/* About Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass p-6"
        >
          <h2 className="text-label text-white/30 mb-4">About</h2>
          <SettingRow icon={Info} label="Version" value="1.0.0-alpha" />
          <SettingRow icon={Info} label="Engine" value="Gemini 3 Flash" color="#4af8e3" />
        </motion.div>
      </div>
    </div>
  );
}
