'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import { AudioStreamer } from '@/lib/audioStreamer';

export default function PulseRecorder({ 
  onNewMemory, 
  onError 
}: { 
  onNewMemory: (memory: any) => void;
  onError: (err: string | null) => void;
}) {
  const [active, setActive] = useState(false);
  const [volume, setVolume] = useState(0);
  
  // Explicitly mapping user request:
  const [isThinking, setIsThinking] = useState(false);
  const [showRipple, setShowRipple] = useState(false);
  
  const streamerRef = useRef<AudioStreamer | null>(null);

  // Animations for the Aura Pulse
  const controls1 = useAnimation();
  const controls2 = useAnimation();
  const [pulseScale, setPulseScale] = useState(1);

  useEffect(() => {
    return () => {
      if (streamerRef.current) {
        streamerRef.current.stop();
      }
    };
  }, []);

  // Update Aura Pulse scaling based on volume
  useEffect(() => {
    if (active) {
      const targetScale = 1 + (volume / 200); 
      setPulseScale(targetScale > 2.5 ? 2.5 : targetScale);
      
      controls1.start({
        scale: [pulseScale, targetScale],
        rotate: [0, 360],
        transition: { duration: 3, repeat: Infinity, ease: 'linear' }
      });
      controls2.start({
        scale: [pulseScale * 0.9, targetScale * 0.9],
        rotate: [360, 0],
        transition: { duration: 4, repeat: Infinity, ease: 'linear' }
      });
    } else {
      setPulseScale(1);
      controls1.stop();
      controls2.stop();
      controls1.start({ scale: 1, transition: { duration: 0.5 } });
      controls2.start({ scale: 0.8, transition: { duration: 0.5 } });
    }
  }, [active, volume, controls1, controls2, pulseScale]);

  const handleToggle = async () => {
    onError(null);
    if (active) {
      setActive(false);
      setIsThinking(false);
      setShowRipple(false);
      if (streamerRef.current) {
        streamerRef.current.stop();
        streamerRef.current = null;
      }
    } else {
      setActive(true);
      setShowRipple(false);
      setIsThinking(false);
      
      const streamer = new AudioStreamer(
        (vol) => setVolume(vol),
        (memory) => {
          // Trigger Success Ripple!
          setShowRipple(true);
          setIsThinking(false);
          onNewMemory(memory);
          
          // Clear Ripple after 1.5s
          setTimeout(() => {
             setShowRipple(false);
          }, 1500);
        },
        (err) => {
          onError(err);
          setActive(false);
          setIsThinking(false);
        },
        (internalStatus) => {
          // When chunk is processing, set thinking to true!
          if (internalStatus === 'thinking') {
             setIsThinking(true);
          }
        }
      );
      streamerRef.current = streamer;
      await streamer.start();
    }
  };

  return (
    <div className="flex flex-col items-center gap-8 w-full">
      {/* Visualizer Area */}
      <div className="relative w-full h-[300px] flex items-center justify-center pointer-events-none mt-8">
        
        {/* Background glow base */}
        <div className="absolute w-[200px] h-[200px] rounded-full bg-primary/20 blur-[60px]" />
        
        {/* Animated layer 1 */}
        <motion.div
          animate={controls1}
          initial={{ scale: 1, rotate: 0 }}
          className={`absolute w-[180px] h-[180px] rounded-[40%] blur-[20px] opacity-60 mix-blend-screen bg-gradient-to-tr transition-colors duration-500 ${
            isThinking ? 'from-[#FFD700] to-[#FFA500]' : 'from-primary to-secondary'
          }`}
        />
        
        {/* Animated layer 2 */}
        <motion.div
          animate={controls2}
          initial={{ scale: 0.8, rotate: 0 }}
          className={`absolute w-[150px] h-[150px] rounded-[35%] blur-[15px] opacity-70 mix-blend-screen bg-gradient-to-bl transition-colors duration-500 ${
            isThinking ? 'from-[#FFD700] to-[#FFA500]' : 'from-secondary to-accent'
          }`}
        />

        {/* Success Ripple Animation Overlay */}
        <AnimatePresence>
          {showRipple && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0.8 }}
              animate={{ scale: 3.5, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="absolute w-[150px] h-[150px] rounded-full border-4 border-[#00FF00] bg-[#00FF00]/20 z-0"
            />
          )}
        </AnimatePresence>

        {/* Center core */}
        <motion.div
          animate={{ scale: active && !isThinking ? [0.95, 1.05, 0.95] : 1 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="relative z-10 w-16 h-16 rounded-full glass bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.2)] flex items-center justify-center overflow-hidden"
        >
          <div className="w-10 h-10 rounded-full bg-white/20 blur-[4px]" />
        </motion.div>
      </div>

      {/* Control Button */}
      <button 
        onClick={handleToggle}
        className={`relative overflow-hidden group glass px-12 py-4 rounded-full font-medium tracking-wide transition-all duration-300 pointer-events-auto ${active ? 'bg-red-500/20 text-red-200 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : 'hover:bg-white/10'}`}
      >
        {active ? 'Stop Recording' : 'Start Recording'}
      </button>
    </div>
  );
}
