'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── env ─────────────────────────────────────────────────────────────────── */
const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080/ws/stream';

/* ─── types ───────────────────────────────────────────────────────────────── */
interface Memory {
  id: string;
  title: string;
  summary: string;
  category: 'Task' | 'Fact' | 'Idea';
  importance: number;
  createdAt: string;
}

interface AudioRecorderProps {
  onNewMemory?: (memory: Memory) => void;
  onError?: (err: string) => void;
}

/* ─── MicIcon ─────────────────────────────────────────────────────────────── */
function MicIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  );
}

function StopIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

/* ─── component ───────────────────────────────────────────────────────────── */
export default function AudioRecorder({ onNewMemory, onError }: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [ripple, setRipple] = useState(false);
  const [volume, setVolume] = useState(0); // 0–100

  const socketRef      = useRef<WebSocket | null>(null);
  const recorderRef    = useRef<MediaRecorder | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const dataRef        = useRef<Uint8Array | null>(null);
  const rafRef         = useRef<number | null>(null);

  /* volume analyser loop */
  const startAnalyser = useCallback((stream: MediaStream) => {
    const Ctx =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx      = new Ctx();
    const source   = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    audioCtxRef.current  = ctx;
    analyserRef.current  = analyser;
    dataRef.current      = data;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setVolume(Math.min(avg, 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stopAnalyser = useCallback(() => {
    if (rafRef.current)           cancelAnimationFrame(rafRef.current);
    if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setVolume(0);
  }, []);

  /* start recording */
  const handleStart = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: { ideal: 16000 },
          channelCount: { ideal: 1 },
        },
      });

      /* open WebSocket */
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen  = () => console.log('[AudioRecorder] WS connected');
      ws.onerror = () => onError?.('WebSocket error – check server');
      ws.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data as string);
          if (payload.type === 'processing_memory') {
            setIsThinking(true);
          } else if (payload.type === 'MEMORY_SAVED') {
            setIsThinking(false);
            setRipple(true);
            onNewMemory?.(payload.data as Memory);
            navigator.vibrate?.([80, 40, 80]);
            setTimeout(() => setRipple(false), 1200);
          }
        } catch { /* binary / non-JSON frame */ }
      };

      /* MediaRecorder → 250 ms chunks */
      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      recorder.start(250); // timeslice = 250 ms packets
      startAnalyser(stream);
      setIsRecording(true);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Mic access denied');
    }
  }, [startAnalyser, onNewMemory, onError]);

  /* stop recording */
  const handleStop = useCallback(() => {
    /* stop MediaRecorder + release tracks */
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      recorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    recorderRef.current = null;

    /* send STOP_RECORDING then close socket */
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'STOP_RECORDING' }));
      ws.close();
    }
    socketRef.current = null;

    stopAnalyser();
    setIsRecording(false);
    setIsThinking(false);
  }, [stopAnalyser]);

  const handleToggle = () => (isRecording ? handleStop() : handleStart());

  /* cleanup on unmount */
  useEffect(() => () => { if (isRecording) handleStop(); }, []); // eslint-disable-line

  /* ─── derived visuals ──────────────────────────────────────────────────── */
  // Fluid pulse: scale rings proportionally to microphone volume (0–100)
  const volumeNorm  = volume / 100;                        // 0.0 – 1.0
  const ring1Scale  = 1 + volumeNorm * 0.9;               // 1.0 – 1.9
  const ring2Scale  = 1 + volumeNorm * 1.5;               // 1.0 – 2.5
  const ring3Scale  = 1 + volumeNorm * 2.2;               // 1.0 – 3.2
  const glowSize    = 72 + volume * 0.8;
  const glowOpacity = 0.25 + volumeNorm * 0.35;

  const fabColour = isThinking
    ? 'bg-amber-500 shadow-[0_0_32px_rgba(251,191,36,0.6)]'
    : isRecording
    ? 'bg-red-500 shadow-[0_0_32px_rgba(239,68,68,0.6)]'
    : 'bg-primary shadow-[0_0_24px_rgba(59,130,246,0.4)] hover:bg-blue-500';

  return (
    <div className="fixed bottom-8 right-8 flex items-center justify-center z-50">

      {/* ── Dynamic glow halo ── */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            key="halo"
            animate={{ opacity: glowOpacity, width: glowSize, height: glowSize }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={`absolute rounded-full blur-[28px] pointer-events-none transition-colors duration-200
              ${isThinking ? 'bg-amber-400' : 'bg-primary'}`}
            style={{ width: glowSize, height: glowSize }}
          />
        )}
      </AnimatePresence>

      {/* ── Fluid pulse rings (volume-reactive) ── */}
      <AnimatePresence>
        {isRecording && !isThinking && (
          <>
            {/* ring 1 – tightest */}
            <motion.div
              key="ring1"
              animate={{ scale: ring1Scale, opacity: 0.5 - volumeNorm * 0.25 }}
              transition={{ type: 'spring', stiffness: 180, damping: 14 }}
              className="absolute w-16 h-16 rounded-full border border-white/25 pointer-events-none"
            />
            {/* ring 2 – mid */}
            <motion.div
              key="ring2"
              animate={{ scale: ring2Scale, opacity: 0.3 - volumeNorm * 0.15 }}
              transition={{ type: 'spring', stiffness: 140, damping: 18 }}
              className="absolute w-16 h-16 rounded-full border border-white/15 pointer-events-none"
            />
            {/* ring 3 – outermost */}
            <motion.div
              key="ring3"
              animate={{ scale: ring3Scale, opacity: 0.15 - volumeNorm * 0.08 }}
              transition={{ type: 'spring', stiffness: 100, damping: 22 }}
              className="absolute w-16 h-16 rounded-full border border-white/10 pointer-events-none"
            />
          </>
        )}
      </AnimatePresence>

      {/* ── Memory-saved ripple ── */}
      <AnimatePresence>
        {ripple && (
          <motion.div
            key="ripple"
            initial={{ scale: 0.8, opacity: 0.7 }}
            animate={{ scale: 3.5, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            className="absolute w-16 h-16 rounded-full border-2 border-emerald-400
              bg-emerald-400/20 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* ── FAB button ── */}
      <motion.button
        onClick={handleToggle}
        whileTap={{ scale: 0.88 }}
        animate={
          isRecording && !isThinking
            ? { scale: [1, 1.08, 1] }
            : { scale: 1 }
        }
        transition={
          isRecording && !isThinking
            ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.2 }
        }
        id="audio-recorder-fab"
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        className={`relative z-10 w-16 h-16 rounded-full flex items-center justify-center
          text-white transition-all duration-300 cursor-pointer border border-white/10
          ${fabColour}`}
      >
        <AnimatePresence mode="wait">
          {isRecording ? (
            <motion.span
              key="stop"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <StopIcon size={20} />
            </motion.span>
          ) : (
            <motion.span
              key="mic"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <MicIcon size={26} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── Tooltip label ── */}
      <AnimatePresence>
        {isThinking && (
          <motion.span
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="absolute right-20 text-xs text-amber-300/80 glass
              px-3 py-1 rounded-full whitespace-nowrap border-amber-400/20"
          >
            Processing memory…
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
